/* Drill editor (R1 Drill Editor deep-dive): piece tray, rink with steps and playback, and a side panel
   with Piece, Step and Details tabs. Every change is saved on the device half a second later. */
import { el, fill, toast, dialog } from '../ui.js?v=1.3.1';
import { newId } from '../../vendor/bbl-kit/1.0.1/bbl-store.js';
import { SCHEMA_VERSION } from '../version.js?v=1.3.1';
import { Player } from '../engine/player.js?v=1.3.1';
import { PIECES, TEAMS, LINES, isPlayer, canMove, moveOf, movesIn, pathOf, positionsByStep, frame } from '../engine/model.js?v=1.3.1';
import { pieceSVG, radius, thumbnailSVG, ACCENT, MARK_COLOURS } from '../engine/render.js?v=1.3.1';
import { VIEWS } from '../engine/rink.js?v=1.3.1';
import { at } from '../engine/geometry.js?v=1.3.1';
import * as D from '../drills.js?v=1.3.1';
import { drillInfo } from './drillview.js?v=1.3.1';

const SVGNS = 'http://www.w3.org/2000/svg';
const TRAY = ['F', 'C', 'D', 'G', 'X', 'coach', 'puck', 'pile', 'pylon', 'net', 'board', 'deker', 'tire', 'stick', 'text'];
const NAMES = { F: 'Forward', C: 'Centre', D: 'Defence', G: 'Goalie', X: 'Skater', coach: 'Coach', puck: 'Puck', pile: 'Puck pile', pylon: 'Pylon', net: 'Net', board: 'Passer board', deker: 'Deker', tire: 'Tire', stick: 'Stick', text: 'Text' };
const LINE_NAMES = { skate: 'Skate', 'skate-puck': 'With puck', backward: 'Backward', pass: 'Pass', shot: 'Shot', carried: 'Carried' };
const TEAM_NAMES = { red: 'Red', black: 'Black', white: 'White', blue: 'Blue' };
const MARK_NAMES = { orange: 'Orange', navy: 'Navy', blue: 'Blue' };
const TOOLS = [['move', 'Move'], ['pass', '➜ Pass'], ['shoot', '⇒ Shoot'], ['pen', 'Pen'], ['arrow', 'Arrow'], ['box', 'Box'], ['text', 'Text'], ['erase', 'Eraser']];
const ROTATES = type => !!(PIECES[type] && PIECES[type].rotate);

const COMPACT = '(max-height: 500px) and (orientation: landscape)';
const NARROW = '(max-width: 640px)';
const DRAW_TOOLS = [['pen', 'Pen'], ['arrow', 'Arrow'], ['box', 'Box'], ['text', 'Text'], ['erase', 'Eraser']];
/** A phone held upright: plans stay read-only here. */
export const reviewOnly = () => matchMedia(NARROW).matches;
/** How the editor lays out: 'full' (tablet, PC), 'compact' (phone held sideways) or 'portrait' (phone upright: details only). */
export const editMode = () => (matchMedia(COMPACT).matches ? 'compact' : matchMedia(NARROW).matches ? 'portrait' : 'full');

function trayIcon(type, team) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '-6 -6 12 12'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'pp-tray-icon');
  svg.innerHTML = pieceSVG({ id: 'icon', type, team, x: 0, y: 0, ang: 0, opacity: 1, rotate: ROTATES(type) ? 0 : 0, text: 'Aa' });
  return svg;
}
const field = (label, input, hint) => el('label', { class: 'field' }, el('span', { class: 't-label' }, label), input, hint ? el('span', { class: 'muted pp-hint' }, hint) : null);
const seg = (name, options, value, onPick, { allowNone = false } = {}) => el('div', { class: 'pp-seg', role: 'group', 'aria-label': name },
  ...options.map(([v, label]) => el('button', { type: 'button', class: 'pp-segbtn', 'aria-pressed': String(v === value), onclick: () => onPick(allowNone && v === value ? '' : v) }, label)));

export function renderEditor(app, id) {
  const root = el('div', { class: 'pp-editor-screen' }, el('p', { class: 'muted' }, 'Opening the drill…'));
  open(app, id, root).catch(e => {
    fill(root, el('div', { class: 'card notice' }, el('p', {}, `This drill couldn’t be opened. ${e.message || ''}`), el('a', { class: 'btn', href: '#library' }, 'Back to the library')));
  });
  return root;
}

async function open(app, id, root) {
  const rec = await app.store.get('drills', id);
  if (!rec || rec.deletedAt) {
    fill(root, el('section', { class: 'card empty' }, el('h2', { class: 't-section' }, 'That drill isn’t here'),
      el('p', {}, rec ? 'It’s in Recently deleted. Restore it from the library first.' : 'It may have been deleted.'), el('a', { class: 'btn primary', href: '#library' }, 'Back to the library')));
    return;
  }
  if (rec.schemaVersion > SCHEMA_VERSION) return reviewView(app, rec, root);
  const ed = new Editor(app, rec, root);
  app.cleanup = () => ed.close();
}

/* Drills from a newer version: play and read, no editing. */
function reviewView(app, rec, root) {
  const host = el('div', { class: 'pp-review-player' });
  fill(root, 
    el('div', { class: 'screen-head' }, el('a', { class: 'btn', href: `#library/${rec.id}` }, '‹ Library'), el('h1', { class: 't-title pp-title-cut' }, rec.title)),
    el('div', { class: 'card notice' }, el('p', {}, 'This drill was saved by a newer version of Practice Pilot. Update to edit it.')),
    host, drillInfo(rec));
  const p = new Player(host, rec);
  app.cleanup = () => p.destroy();
}

class Editor {
  constructor(app, rec, root) {
    this.app = app; this.rec = rec; this.root = root;
    this.d = D.content(rec);
    for (const [k, v] of Object.entries({ view: { rink: 'full', flip: false }, start: {}, markup: [], steps: [], pieces: [], tags: [], ageGroups: [], coachingPoints: [], setupNotes: [], videoLinks: [], autoHighlight: true })) if (this.d[k] == null) this.d[k] = v;
    this.past = []; this.future = []; this.coalesceKey = null; this.coalesceAt = 0;
    this.sel = null; this.tool = 'move'; this.place = null; this.team = 'red';
    this.markColour = 'orange'; this.markAll = false; this.tab = 'piece';
    this.status = 'Saved'; this.saveTimer = 0; this.saving = Promise.resolve();
    this.customTags = [];
    this.mode = null; this.trayOpen = false; this.drawOpen = false; this.drawer = false;
    app.busy = true;
    this.build();
    this.setMode(editMode());
    this.mqs = [matchMedia(COMPACT), matchMedia(NARROW)];
    this.onMode = () => this.setMode(editMode());
    for (const m of this.mqs) m.addEventListener('change', this.onMode);
    app.store.get('meta', 'tags').then(t => { this.customTags = (t && t.value) || []; if (this.tab === 'details') this.renderPanel(); });
    this.onKey = e => this.key(e);
    document.addEventListener('keydown', this.onKey);
    this.onHide = () => { if (document.visibilityState === 'hidden') this.flush(); };
    document.addEventListener('visibilitychange', this.onHide);
    addEventListener('pagehide', this.onHide);
  }

  /* ---------- layout ---------- */
  build() {
    this.statusEl = el('span', { class: 'pp-status', 'aria-live': 'polite', id: 'save-status' }, 'Saved');
    this.titleEl = el('h1', { class: 't-section pp-title-cut', id: 'editor-title' }, this.d.title);
    const lbl = t => el('span', { class: 'pp-lbl' }, t);
    this.bUndo = el('button', { type: 'button', class: 'btn', id: 'undo', 'aria-label': 'Undo', title: 'Undo (Ctrl+Z)', onclick: () => this.undo() }, '↶', lbl(' Undo'));
    this.bRedo = el('button', { type: 'button', class: 'btn', id: 'redo', 'aria-label': 'Redo', title: 'Redo (Ctrl+Y)', onclick: () => this.redo() }, '↷', lbl(' Redo'));
    this.bOptions = el('button', { type: 'button', class: 'btn pp-only-compact', id: 'options-btn', 'aria-controls': 'panel', 'aria-expanded': 'false', onclick: () => this.setDrawer(!this.drawer) }, 'Options');
    const top = el('div', { class: 'pp-edtop' },
      el('a', { class: 'btn', href: `#library/${this.rec.id}`, id: 'editor-back', 'aria-label': 'Back to the library' }, '‹', lbl(' Library')),
      el('div', { class: 'grow pp-edtitle' }, this.titleEl, this.statusEl),
      this.bUndo, this.bRedo, this.bOptions,
      el('button', { type: 'button', class: 'btn', id: 'drill-menu', 'aria-label': 'More drill actions', onclick: () => this.menu() }, '⋮'));
    const rotate = el('p', { class: 'card notice pp-only-portrait', id: 'rotate-note' }, '↻ Turn your phone sideways to move pieces and add steps. You can change the drill’s details here.');

    this.tray = el('div', { class: 'pp-tray', id: 'tray', role: 'toolbar', 'aria-label': 'Pieces' });
    this.toolbar = el('div', { class: 'pp-tools', id: 'tools' });
    this.stepAdd = el('button', { type: 'button', class: 'pp-chip pp-chip-add', id: 'add-step', onclick: () => this.addStep() }, '+ Step');
    this.playerHost = el('div', { class: 'pp-edplayer' });
    this.panel = el('aside', { class: 'pp-panel card', id: 'panel', 'aria-label': 'Options' });
    fill(this.root, top, rotate, el('div', { class: 'pp-editor' }, this.tray, el('div', { class: 'pp-edcentre' }, this.toolbar, this.playerHost), this.panel));
    this.player = new Player(this.playerHost, this.d, { editing: true, chipsExtra: this.stepAdd, overlay: fr => this.overlay(fr), onStep: () => { if (this.built) { this.renderPanel(); this.renderTools(); this.showChip(); } } });
    this.player.host.querySelector('.pp-controls').after(this.player.chips);
    this.wirePointer();
    this.built = true;
    this.renderTray(); this.renderTools(); this.renderPanel(); this.renderTop();
  }

  get k() { return this.player.step(); }

  /** Switch layouts when the phone turns. Nothing is lost: same drill, step and selection. */
  setMode(m) {
    const was = this.mode;
    if (m === was) return;
    this.mode = m;
    this.root.dataset.mode = m;
    document.body.classList.toggle('pp-ed-compact', m === 'compact');
    document.body.classList.toggle('pp-ed-portrait', m === 'portrait');
    if (m !== 'compact') { this.trayOpen = false; this.drawOpen = false; this.drawer = false; }
    if (m === 'portrait') { this.action = null; this.place = null; this.tool = 'move'; this.tab = 'details'; this.playerHost.dataset.tool = 'move'; }
    this.renderTray(); this.renderTools(); this.renderPanel(); this.renderTop();
    requestAnimationFrame(() => { if (this.player) this.player.draw(); });
    if (m === 'compact') this.installTip();
  }

  /** The options drawer on a phone held sideways. */
  setDrawer(open) {
    this.drawer = !!open && this.mode === 'compact';
    if (this.drawer) { this.trayOpen = false; this.drawOpen = false; this.renderTray(); this.renderTools(); }
    this.panel.classList.toggle('open', this.drawer);
    this.bOptions.setAttribute('aria-expanded', String(this.drawer));
  }

  closePops() {
    if (!this.trayOpen && !this.drawOpen) return false;
    this.trayOpen = false; this.drawOpen = false; this.renderTray(); this.renderTools();
    return true;
  }

  /** Keep the current step's chip in view when the steps scroll sideways. */
  showChip() {
    requestAnimationFrame(() => { const c = this.player && this.player.chips.querySelector('[aria-selected="true"]'); if (c && this.mode === 'compact') c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
  }

  /** Once: suggest putting the app on the home screen, which gives the rink the browser bar's height. */
  async installTip() {
    if (matchMedia('(display-mode: standalone)').matches) return;
    try {
      if (await this.app.store.get('meta', 'tip-phone-install')) return;
      await this.app.store.put('meta', { key: 'tip-phone-install', value: true });
    } catch { return; }
    toast('Tip: add Practice Pilot to your home screen for a bigger rink. Settings › This device › Install shows how.', { ms: 9000, scoped: true });
  }

  renderTop() {
    this.titleEl.textContent = this.d.title || 'New drill';
    this.statusEl.textContent = this.status;
    this.statusEl.className = `pp-status${this.status === 'Not saved' ? ' bad' : ''}`;
    this.bUndo.disabled = !this.past.length; this.bRedo.disabled = !this.future.length;
  }

  renderTray() {
    const n = this.d.pieces.length;
    fill(this.tray, 
      el('div', { class: 'pp-tray-teams', role: 'group', 'aria-label': 'Team colour for new players' },
        ...Object.keys(TEAMS).map(t => el('button', { type: 'button', class: 'pp-swatch', 'aria-pressed': String(this.team === t), 'aria-label': `${TEAM_NAMES[t]} team`, title: `${TEAM_NAMES[t]} team`, style: `--sw:${TEAMS[t]}`, onclick: () => { this.team = t; this.renderTray(); } }))),
      el('button', { type: 'button', class: 'pp-trayb', id: 'tray-move', 'aria-pressed': String(!this.place && this.tool === 'move'), onclick: () => { this.trayOpen = false; this.setTool('move'); } }, el('span', { class: 'pp-tray-glyph', 'aria-hidden': 'true' }, '✥'), el('span', {}, 'Move')),
      ...TRAY.map(type => el('button', { type: 'button', class: 'pp-trayb', 'data-type': type, 'aria-pressed': String(this.place === type), title: `Place: ${NAMES[type]}`, 'aria-label': `Place ${NAMES[type]}`, onclick: () => this.setPlace(type) },
        trayIcon(type, this.team), el('span', {}, type.length === 1 ? type : NAMES[type]))),
      n >= D.PIECE_WARNING ? el('p', { class: 'pp-warn', role: 'status' }, `${n} pieces: the drill may get hard to read.`) : null);
    this.tray.classList.toggle('open', this.trayOpen);
  }

  actionHint() {
    return el('div', { class: 'pp-actionbar', role: 'status', id: 'action-hint' },
      el('span', { class: 'grow' }, !this.action.passer ? (this.action.kind === 'pass' ? 'Pass: tap the player who passes.' : 'Shoot: tap the player who shoots.')
        : this.action.kind === 'pass' ? 'Now tap the teammate to pass to. The puck goes to where they end up in this step.' : 'Now tap the spot to shoot at.'),
      el('button', { type: 'button', class: 'btn', id: 'cancel-action', onclick: () => this.cancelAction() }, 'Cancel'));
  }

  /** Markup colour, which steps it shows on, and Clear markup. */
  markOptions() {
    return [
      el('div', { class: 'pp-seg', role: 'group', 'aria-label': 'Markup colour' }, ...Object.keys(MARK_COLOURS).map(c =>
        el('button', { type: 'button', class: 'pp-swatch', 'aria-pressed': String(this.markColour === c), 'aria-label': MARK_NAMES[c], title: MARK_NAMES[c], style: `--sw:${MARK_COLOURS[c]}`, onclick: () => { this.markColour = c; this.renderTools(); } }))),
      seg('Markup shows on', [[false, this.k ? 'This step only' : 'Setup only'], [true, 'All steps']], this.markAll, v2 => { this.markAll = v2; this.renderTools(); }),
      this.d.markup.length ? el('button', { type: 'button', class: 'btn', id: 'clear-markup', onclick: () => { this.commit(D.clearMarkup(this.d)); toast('Markup cleared', { action: ['Undo', () => this.undo()], scoped: true }); } }, 'Clear markup') : null];
  }

  /** Phone held sideways: a column of tools down the left; pieces and drawing tools open as pop-ups. */
  renderRail() {
    const drawing = DRAW_TOOLS.find(([t]) => t === this.tool && !this.place);
    const b = (id, label, on, onclick, extra = {}) => el('button', { type: 'button', class: 'pp-railb', id, 'aria-pressed': String(!!on), onclick, ...extra }, label);
    fill(this.toolbar,
      el('div', { class: 'pp-rail', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' },
        b('rail-piece', this.place ? `+ ${NAMES[this.place]}` : '+ Piece', this.trayOpen || this.place, () => { this.trayOpen = !this.trayOpen; this.drawOpen = false; this.setDrawer(false); this.renderTray(); this.renderTools(); }, { 'aria-expanded': String(this.trayOpen), 'aria-controls': 'tray' }),
        b('rail-move', 'Move', !this.action && !this.place && this.tool === 'move', () => { this.action = null; this.closePops(); this.setTool('move'); }),
        b('rail-pass', '➜ Pass', this.action && this.action.kind === 'pass', () => this.startAction('pass', null)),
        b('rail-shoot', '⇒ Shoot', this.action && this.action.kind === 'shoot', () => this.startAction('shoot', null)),
        b('rail-draw', drawing ? drawing[1] : 'Draw', drawing || this.drawOpen, () => { this.drawOpen = !this.drawOpen; this.trayOpen = false; this.setDrawer(false); this.renderTray(); this.renderTools(); }, { 'aria-expanded': String(this.drawOpen), 'aria-controls': 'draw-menu' })),
      this.action ? this.actionHint() : null,
      this.drawOpen ? el('div', { class: 'pp-pop stack', id: 'draw-menu' },
        el('div', { class: 'pp-seg', role: 'group', 'aria-label': 'Drawing tool' }, ...DRAW_TOOLS.map(([t, label]) =>
          el('button', { type: 'button', class: 'pp-segbtn', 'data-tool': t, 'aria-pressed': String(this.tool === t && !this.place), onclick: () => { this.drawOpen = false; this.setTool(t); } }, label))),
        ...this.markOptions()) : null);
  }

  renderTools() {
    if (this.mode === 'compact') return this.renderRail();
    if (this.action) { fill(this.toolbar, this.actionHint()); return; }
    const marking = this.tool !== 'move';
    const v = this.d.view || { rink: 'full', flip: false };
    fill(this.toolbar, 
      el('div', { class: 'pp-seg', role: 'group', 'aria-label': 'Tool' }, ...TOOLS.map(([t, label]) =>
        el('button', { type: 'button', class: 'pp-segbtn', 'data-tool': t, 'aria-pressed': String(this.tool === t && !this.place), onclick: () => (t === 'pass' || t === 'shoot' ? this.startAction(t, null) : this.setTool(t)) }, label))),
      ...(marking ? this.markOptions() : []),
      el('span', { class: 'grow' }),
      el('label', { class: 'pp-inline' }, el('span', { class: 'sr' }, 'Rink view'),
        el('select', { id: 'rink-view', onchange: e => this.commit(D.setDetails(this.d, { view: { ...v, rink: e.target.value } })) },
          ...VIEWS.map(([val, label]) => el('option', { value: val, selected: v.rink === val }, label)))),
      (v.rink === 'half' || v.rink === 'zone') ? el('button', { type: 'button', class: 'btn', id: 'flip', 'aria-pressed': String(!!v.flip), onclick: () => this.commit(D.setDetails(this.d, { view: { ...v, flip: !v.flip } })) }, '⇄ Flip') : null);
  }

  setTool(t) { this.tool = t; this.place = null; this.renderTray(); this.renderTools(); this.playerHost.dataset.tool = t; }
  setPlace(type) {
    this.trayOpen = false;
    if (this.place === type) return this.setTool('move');
    this.place = type; this.tool = 'move'; this.renderTray(); this.renderTools(); this.playerHost.dataset.tool = 'place';
  }

  /* ---------- the panel ---------- */
  renderPanel() {
    if (this.mode === 'portrait') this.tab = 'details';
    const tabs = this.mode === 'portrait' ? [['details', 'Details']] : [['piece', 'Piece'], ['step', this.k ? `Step ${this.k}` : 'Setup'], ['details', 'Details']];
    const body = this.tab === 'piece' ? this.piecePanel() : this.tab === 'step' ? this.stepPanel() : this.detailsPanel();
    const active = document.activeElement && this.panel.contains(document.activeElement) ? document.activeElement.id : null;
    fill(this.panel, 
      el('div', { class: 'pp-tabs' },
        el('div', { class: 'pp-tablist', role: 'tablist' }, ...tabs.map(([t, label]) => el('button', { type: 'button', role: 'tab', class: 'pp-tab', id: `tab-${t}`, 'aria-selected': String(this.tab === t), onclick: () => { this.tab = t; this.renderPanel(); } }, label))),
        this.mode === 'compact' ? el('button', { type: 'button', class: 'btn btn-quiet', id: 'close-drawer', 'aria-label': 'Close options', onclick: () => this.setDrawer(false) }, '✕') : null),
      el('div', { class: 'pp-panel-body stack', role: 'tabpanel' }, ...[].concat(body)));
    if (active) { const a = document.getElementById(active); if (a) a.focus(); }
  }

  piecePanel() {
    const p = this.d.pieces.find(x => x.id === this.sel);
    if (!p) return [el('p', { class: 'muted' }, 'Tap a piece on the rink to see its options.'),
      el('p', { class: 'muted' }, 'To add one, tap it in the tray, then tap the rink. It stays picked so you can drop several; tap Move to stop.')];
    const k = this.k, out = [];
    const nm = NAMES[p.type] + (p.team ? ` · ${TEAM_NAMES[p.team] || ''}` : '');
    out.push(el('h2', { class: 't-section', id: 'piece-name' }, nm));
    if (isPlayer(p.type)) out.push(field('Team colour', el('div', { class: 'pp-seg' }, ...Object.keys(TEAMS).map(t =>
      el('button', { type: 'button', class: 'pp-swatch', 'aria-pressed': String(p.team === t), 'aria-label': `${TEAM_NAMES[t]} team`, style: `--sw:${TEAMS[t]}`, onclick: () => this.commit(D.setPiece(this.d, p.id, { team: t })) })))));
    if (p.type === 'text') out.push(field('Text', el('input', { id: 'piece-text', value: p.text || '', maxlength: 30, oninput: e => this.commit(D.setPiece(this.d, p.id, { text: e.target.value || 'Text' }), { quiet: true, coalesce: `text-${p.id}` }) })));
    if (ROTATES(p.type)) out.push(field(`Rotate (${p.rotate || 0}°)`, el('div', { class: 'row' },
      el('button', { type: 'button', class: 'btn', id: 'rot-left', onclick: () => this.commit(D.setPiece(this.d, p.id, { rotate: (p.rotate || 0) - 15 })) }, '↺ 15°'),
      el('button', { type: 'button', class: 'btn', id: 'rot-right', onclick: () => this.commit(D.setPiece(this.d, p.id, { rotate: (p.rotate || 0) + 15 })) }, '↻ 15°'),
      el('input', { type: 'range', id: 'rot-slider', min: 0, max: 345, step: 15, value: p.rotate || 0, 'aria-label': 'Rotation', class: 'grow', oninput: e => this.commit(D.setPiece(this.d, p.id, { rotate: +e.target.value }), { coalesce: `rot-${p.id}`, quiet: true }), onchange: () => this.renderPanel() }))));

    if (isPlayer(p.type)) out.push(...this.puckActions(p, k));
    if (k > 0 && canMove(p.type)) out.push(...this.movePanel(p, k));
    else if (k === 0 && canMove(p.type)) out.push(el('p', { class: 'muted' }, 'This is where it starts. Pick a step, then drag it to make it move.'));
    if (k > 0 && (isPlayer(p.type) || p.type === 'coach')) out.push(...this.calloutPanel(p, k));

    const n = this.d.steps.length;
    out.push(el('div', { class: 'pp-two' },
      field('Appears in', el('select', { id: 'appears', onchange: e => this.commit(D.setPiece(this.d, p.id, { fromStep: +e.target.value || null })) },
        el('option', { value: 0, selected: !p.fromStep }, 'Setup'), ...Array.from({ length: n }, (_, i) => el('option', { value: i + 1, selected: p.fromStep === i + 1 }, `Step ${i + 1}`)))),
      field('Leaves after', el('select', { id: 'leaves', onchange: e => this.commit(D.setPiece(this.d, p.id, { untilStep: e.target.value === '' ? null : +e.target.value })) },
        el('option', { value: '', selected: p.untilStep == null }, 'Stays to the end'), ...Array.from({ length: n }, (_, i) => el('option', { value: i + 1, selected: p.untilStep === i + 1 }, `Step ${i + 1}`))))));
    out.push(el('div', { class: 'row' },
      el('button', { type: 'button', class: 'btn', id: 'dup-piece', onclick: () => { const nid = newId('pc'); this.commit(D.duplicatePiece(this.d, p.id, nid)); this.select(nid); } }, 'Duplicate'),
      el('button', { type: 'button', class: 'btn danger', id: 'remove-piece', onclick: () => this.removeSelected() }, 'Remove from drill')));
    return out;
  }

  /** Pass and Shoot for a player with the puck, and a quick way to select the puck itself. */
  puckActions(p, k) {
    const pk = this.puckFor(p.id, k);
    return [el('div', { class: 'pp-puckacts' },
      el('button', { type: 'button', class: 'btn primary', id: 'pass-btn', onclick: () => this.startAction('pass', p.id) }, '➜ Pass'),
      el('button', { type: 'button', class: 'btn primary', id: 'shoot-btn', onclick: () => this.startAction('shoot', p.id) }, '⇒ Shoot'),
      pk ? el('button', { type: 'button', class: 'btn', id: 'select-puck', onclick: () => this.select(pk.id) }, 'Select the puck') : null),
      pk ? null : el('p', { class: 'muted pp-hint', style: 'margin:0' }, 'No puck on their stick: the nearest puck moves to them first.')];
  }

  /** The puck this player has in step k (in Setup: the puck on their stick). */
  puckFor(id, k) {
    if (k > 0) return D.puckWith(this.d, k, id);
    const pos = positionsByStep(this.d)[0];
    return this.d.pieces.find(x => x.type === 'puck' && pos[x.id] && Math.hypot(pos[x.id][0] - pos[id][0], pos[x.id][1] - pos[id][1]) <= 4.5) || null;
  }

  selectedPlayer() { const p = this.d.pieces.find(x => x.id === this.sel); return p && isPlayer(p.type) ? p.id : null; }

  startAction(kind, passer) {
    this.action = { kind, passer: passer || null };
    this.trayOpen = false; this.drawOpen = false;
    if (this.drawer) this.setDrawer(false);
    this.setTool('move');
    this.renderTools();
  }
  cancelAction() { this.action = null; this.renderTools(); }

  /** A tap while passing or shooting. Passing or shooting while carrying the puck adds a step after the carry. */
  doAction(pt) {
    const { kind, passer } = this.action;
    if (!passer) {
      const id = this.nearest(pt, null, { players: true });
      if (!id) { toast(kind === 'pass' ? 'Tap the player who passes.' : 'Tap the player who shoots.'); return; }
      this.action.passer = id; this.select(id); this.renderTools();
      return;
    }
    let k = this.k, d = this.d, note = '';
    let receiver = null;
    if (kind === 'pass') {
      receiver = this.nearest(pt, null, { players: true, except: passer });
      if (!receiver) { toast('Tap the player to pass to.'); return; }
    }
    let pk = this.puckFor(passer, k);
    const carrying = pk && k > 0 && (d.steps[k - 1].moves || []).some(m => m.piece === pk.id && m.carriedBy === passer);
    // a player who receives the puck in this step passes or shoots it in the next one
    const ends = !pk && k > 0 && (() => { const end = positionsByStep(d)[k]; return d.pieces.find(x => x.type === 'puck' && end[x.id] && Math.hypot(end[x.id][0] - end[passer][0], end[x.id][1] - end[passer][1]) <= 4.5); })();
    if (k === 0 || carrying || ends) ({ drill: d, k } = D.addStep(d, k));
    if (ends) pk = ends;
    let puckId = pk && pk.id;
    if (!pk) {
      const pos = positionsByStep(d);
      const g = D.giveTo(d, k, passer, receiver ? pos[k][receiver] : pt, newId('pc'));
      d = g.drill; puckId = g.puck;
      note = g.how === 'pile' ? ' A puck from the pile goes on their stick.' : g.how === 'new' ? ' A puck was added on their stick.' : ' The puck starts on their stick.';
    }
    const earlier = (d.steps[k - 1].moves || []).find(m => m.piece === puckId && m.to && (m.line === 'pass' || m.line === 'shot'));
    if (earlier) note += ` It replaces their earlier ${earlier.line} in this step.`;
    d = kind === 'pass' ? D.passTo(d, k, passer, puckId, receiver) : D.shootAt(d, k, passer, puckId, pt);
    this.action = null;
    this.commit(d);
    this.player.goStep(k);
    this.select(passer);
    const r = receiver && this.d.pieces.find(x => x.id === receiver);
    toast((kind === 'pass' ? `Pass to the ${NAMES[r.type].toLowerCase()} in step ${k}.` : `Shot in step ${k}.`) + note, { action: ['Undo', () => this.undo()], scoped: true });
  }

  movePanel(p, k) {
    const m = moveOf(this.d.steps[k - 1], p.id);
    const moving = m && movesIn(this.d, k, p.id);
    if (!m || (!moving && !m.carriedBy)) return [el('p', { class: 'muted', id: 'no-move' }, `Not moving in step ${k}. Drag it on the rink to make it move.`)];
    const out = [];
    const lines = p.type === 'puck' ? LINES.puck : p.type === 'coach' ? LINES.coach : LINES.player;
    const line = m.carriedBy ? 'carried' : (m.line || (p.type === 'puck' ? 'pass' : 'skate'));
    if (lines.length > 1) out.push(field('Line', seg('Line', lines.map(l => [l, LINE_NAMES[l]]), line, v => this.commit(D.setMove(this.d, k, p.id, { line: v })))));
    if (m.carriedBy) {
      const c = this.d.pieces.find(x => x.id === m.carriedBy);
      out.push(el('p', { class: 'muted' }, `Carried by the ${c ? NAMES[c.type].toLowerCase() : 'player'} in this step.`));
      return out;
    }
    out.push(field('Path', el('div', { class: 'row' },
      el('button', { type: 'button', class: 'btn', id: 'add-bend', onclick: () => this.commit(D.addBend(this.d, k, p.id)) }, '+ Bend point'),
      (m.bends || []).length ? el('button', { type: 'button', class: 'btn', id: 'straighten', onclick: () => this.commit(D.setMove(this.d, k, p.id, { bends: [] })) }, 'Straighten') : null),
      'Drag the dot on the path to curve it.'));
    if (isPlayer(p.type) || p.type === 'coach') out.push(field('Finish', seg('Finish', [['', 'None'], ['stop', 'Stop'], ['pivot', 'Pivot']], m.finish || '', v => this.commit(D.setMove(this.d, k, p.id, { finish: v })))));
    const when = m.when || 'step';
    out.push(field('When', seg('When', [['step', 'With the step'], ['after', 'After skaters arrive'], ['custom', 'Custom']], when, v => this.commit(D.setMove(this.d, k, p.id, { when: v === 'step' ? '' : v })))));
    if (when === 'custom') {
      const s = Math.round((m.start ?? 0) * 100), e = Math.round((m.end ?? 1) * 100);
      const set = (key, val) => {
        let start = key === 'start' ? val : (m.start ?? 0), end = key === 'end' ? val : (m.end ?? 1);
        if (end - start < 0.1) { if (key === 'start') start = Math.max(0, end - 0.1); else end = Math.min(1, start + 0.1); }
        this.commit(D.setMove(this.d, k, p.id, { when: 'custom', start, end }), { coalesce: `win-${k}-${p.id}`, quiet: true });
      };
      out.push(el('div', { class: 'pp-two' },
        field(`Starts at ${s}%`, el('input', { type: 'range', id: 'win-start', min: 0, max: 90, step: 5, value: s, oninput: ev => set('start', ev.target.value / 100), onchange: () => this.renderPanel() })),
        field(`Ends at ${e}%`, el('input', { type: 'range', id: 'win-end', min: 10, max: 100, step: 5, value: e, oninput: ev => set('end', ev.target.value / 100), onchange: () => this.renderPanel() }))));
    }
    out.push(el('button', { type: 'button', class: 'btn', id: 'clear-move', onclick: () => this.commit(D.clearMove(this.d, k, p.id)) }, `Stay still in step ${k}`));
    return out;
  }

  calloutPanel(p, k) {
    const out = [el('h3', { class: 't-label' }, 'Callouts')];
    for (const c of D.calloutsFor(this.d, k, p.id)) {
      if (c.k !== k) { out.push(el('p', { class: 'muted' }, `“${c.text}” from step ${c.k}, until the end`)); continue; }
      const left = el('span', { class: 'muted pp-hint' }, `${D.CALLOUT_MAX - c.text.length} left`);
      out.push(el('div', { class: 'pp-callout-edit stack' },
        el('input', { 'aria-label': 'Callout text', class: 'callout-text', value: c.text, maxlength: D.CALLOUT_MAX, oninput: e => { left.textContent = `${D.CALLOUT_MAX - e.target.value.length} left`; this.commit(D.setCallout(this.d, k, c.i, { text: e.target.value }), { quiet: true, coalesce: `co-${k}-${c.i}` }); } }), left,
        el('div', { class: 'row' }, seg('Shows', [[false, 'This step'], [true, 'Until the end']], c.stay, v => this.commit(D.setCallout(this.d, k, c.i, { stay: v }))),
          el('button', { type: 'button', class: 'btn danger', onclick: () => { this.commit(D.removeCallout(this.d, k, c.i)); toast('Callout removed', { action: ['Undo', () => this.undo()], scoped: true }); } }, 'Remove callout'))));
    }
    out.push(el('button', { type: 'button', class: 'btn', id: 'add-callout', onclick: () => {
      this.commit(D.addCallout(this.d, k, p.id, ''));
      const inputs = this.panel.querySelectorAll('.callout-text'); const last = inputs[inputs.length - 1]; if (last) last.focus();
    } }, '+ Callout'));
    const lit = ((this.d.steps[k - 1] || {}).highlight || []).includes(p.id);
    out.push(el('label', { class: 'pp-check' }, el('input', { type: 'checkbox', id: 'highlight', checked: lit, onchange: e => this.commit(D.setHighlight(this.d, k, p.id, e.target.checked)) }), `Highlight in step ${k}`));
    return out;
  }

  stepPanel() {
    const k = this.k;
    if (!k) return [el('p', {}, 'Setup is where every piece starts. Drag pieces here to set their starting spots.'),
      this.listField('setupNotes', { label: 'Setup', item: 'Setup line', add: '+ Setup line', id: 'setup', hint: 'How to prep the ice for other coaches, e.g. “Pucks on both blue lines”, “Pylons on the dots”.' }),
      el('button', { type: 'button', class: 'btn primary', id: 'panel-add-step', onclick: () => this.addStep() }, this.d.steps.length ? '+ Step after Setup' : '+ Step 1')];
    const s = this.d.steps[k - 1], n = this.d.steps.length;
    const moving = D.movingIn(this.d, k);
    const label = pc => {
      const same = this.d.pieces.filter(x => x.type === pc.type && x.team === pc.team);
      return `${NAMES[pc.type]}${pc.team ? ` · ${TEAM_NAMES[pc.team]}` : ''}${same.length > 1 ? ` ${same.indexOf(pc) + 1}` : ''}`;
    };
    const whenOf = m => (m.carriedBy ? 'Carried' : m.when === 'after' ? 'After skaters arrive' : m.when === 'custom' ? 'Custom' : 'With the step');
    const movingList = el('div', { class: 'field', id: 'moving-list' }, el('span', { class: 't-label' }, 'Moving in this step'),
      el('span', { class: 'muted pp-hint' }, 'Everything here moves at the same time. Drag more pieces on the rink to add them; pick “After skaters arrive” to make one wait.'),
      moving.length ? el('ul', { class: 'pp-movelist' }, ...moving.map(({ piece, move }) => el('li', {},
        el('button', { type: 'button', class: 'btn pp-moveitem', onclick: () => this.select(piece.id) },
          el('span', { class: 'grow' }, label(piece)), el('span', { class: 'muted' }, `${LINE_NAMES[move.carriedBy ? 'carried' : move.line || (piece.type === 'puck' ? 'pass' : 'skate')]} · ${whenOf(move)}`)))))
        : el('p', { class: 'muted', style: 'margin:0' }, 'Nothing moves yet. Drag a piece on the rink.'));
    return [
      field('Caption', el('textarea', { id: 'caption', rows: 2, maxlength: 120, placeholder: 'The coaching cue for this step', oninput: e => this.commit(D.setStep(this.d, k, { caption: e.target.value }), { quiet: true, coalesce: `cap-${k}` }) }, s.caption || '')),
      movingList,
      field(`Step length: ${s.seconds || 2} s`, el('input', { type: 'range', id: 'step-length', min: D.STEP_MIN, max: D.STEP_MAX, step: 0.5, value: s.seconds || 2, oninput: e => { e.target.previousSibling.textContent = `Step length: ${e.target.value} s`; this.commit(D.setStep(this.d, k, { seconds: +e.target.value }), { quiet: true, coalesce: `len-${k}` }); } })),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn', id: 'step-earlier', disabled: k <= 1, onclick: () => { this.commit(D.moveStep(this.d, k, -1)); this.player.goStep(k - 1); } }, '← Move earlier'),
        el('button', { type: 'button', class: 'btn', id: 'step-later', disabled: k >= n, onclick: () => { this.commit(D.moveStep(this.d, k, 1)); this.player.goStep(k + 1); } }, 'Move later →')),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn', id: 'panel-add-step', onclick: () => this.addStep() }, `+ Step after ${k}`),
        el('button', { type: 'button', class: 'btn danger', id: 'remove-step', onclick: () => { this.commit(D.removeStep(this.d, k)); this.player.goStep(Math.min(k, this.d.steps.length)); toast(`Step ${k} removed`, { action: ['Undo', () => this.undo()], scoped: true }); } }, 'Remove step')),
    ];
  }

  detailsPanel() {
    const d = this.d;
    const set = (fields, opts) => this.commit(D.setDetails(this.d, fields), opts);
    const toggle = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
    const chip = (label, on, onclick) => el('button', { type: 'button', class: 'pp-tagchip', 'aria-pressed': String(on), onclick }, label);
    const tags = [...D.TAGS, ...this.customTags.filter(t => !D.TAGS.includes(t)), ...(d.tags || []).filter(t => !D.TAGS.includes(t) && !this.customTags.includes(t))];
    const tagInput = el('input', { id: 'new-tag', placeholder: 'New tag', maxlength: 24, 'aria-label': 'New tag', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } } });
    const addTag = async () => {
      const t = tagInput.value.trim().replace(/\s+/g, ' ');
      if (!t) return;
      const existing = tags.find(x => x.toLowerCase() === t.toLowerCase());
      if (!existing) { this.customTags = [...this.customTags, t]; await this.app.store.put('meta', { key: 'tags', value: this.customTags }); }
      const name = existing || t;
      if (!d.tags.includes(name)) set({ tags: [...d.tags, name] }); else this.renderPanel();
    };
    const linkErr = el('p', { class: 'pp-error', role: 'alert', id: 'link-error' });
    const linkInput = el('input', { id: 'new-link', type: 'url', inputmode: 'url', placeholder: 'Paste a YouTube or other video link', 'aria-label': 'Video link', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } } });
    const addLink = () => {
      const l = D.videoLink(linkInput.value);
      if (!l) { linkErr.textContent = 'That doesn’t look like a link.'; return; }
      set({ videoLinks: [...d.videoLinks, l] });
    };
    return [
      field('Title', el('input', { id: 'title', value: d.title, maxlength: 100, required: true,
        oninput: e => { this.commit(D.setDetails(this.d, { title: e.target.value }), { quiet: true, coalesce: 'title' }); this.titleEl.textContent = e.target.value || 'New drill'; },
        onblur: e => { if (!e.target.value.trim()) { e.target.value = 'New drill'; this.commit(D.setDetails(this.d, { title: 'New drill' }), { quiet: true, coalesce: 'title' }); } } })),
      field('Usual length (minutes)', el('input', { type: 'number', id: 'usual-minutes', min: 1, max: 60, inputmode: 'numeric', value: d.minutes || '', placeholder: '8',
        oninput: e => { const v = Math.round(Number(e.target.value)); set({ minutes: v >= 1 && v <= 60 ? v : null }, { quiet: true, coalesce: 'minutes' }); } }), 'Plans start this drill at this length.'),
      field('Description', el('textarea', { id: 'description', rows: 2, maxlength: 400, placeholder: 'What the drill is for', oninput: e => set({ description: e.target.value }, { quiet: true, coalesce: 'desc' }) }, d.description || '')),
      this.listField('setupNotes', { label: 'Setup', item: 'Setup line', add: '+ Setup line', id: 'setup', hint: 'How to prep the ice for other coaches, e.g. “Pucks on both blue lines”, “Pylons on the dots”.' }),
      field('Tags', el('div', { class: 'pp-chipwrap' }, ...tags.map(t => chip(t, d.tags.includes(t), () => set({ tags: toggle(d.tags, t) }))))),
      el('div', { class: 'row' }, tagInput, el('button', { type: 'button', class: 'btn', id: 'add-tag', onclick: addTag }, '+ Tag')),
      field('Age groups', el('div', { class: 'pp-chipwrap' }, ...D.AGES.map(a => chip(a, d.ageGroups.includes(a), () => set({ ageGroups: D.AGES.filter(x => x === a ? !d.ageGroups.includes(a) : d.ageGroups.includes(x)) }))))),
      field('Level', seg('Level', D.LEVELS.map(l => [l, l]), d.level || '', v => set({ level: v }), { allowNone: true })),
      this.listField('coachingPoints', { label: 'Coaching points', item: 'Coaching point', add: '+ Point', id: 'point' }),
      el('div', { class: 'field' }, el('span', { class: 't-label' }, 'Video links'),
        ...(d.videoLinks || []).map((l, i) => el('div', { class: 'row' }, el('a', { class: 'btn outline grow', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, `▶ ${l.site}`),
          el('button', { type: 'button', class: 'btn pp-mini', 'aria-label': `Remove ${l.site} link`, onclick: () => set({ videoLinks: d.videoLinks.filter((_, j) => j !== i) }) }, '✕'))),
        el('div', { class: 'row' }, linkInput, el('button', { type: 'button', class: 'btn', id: 'add-link', onclick: addLink }, 'Add')), linkErr),
      field('Goalie notes', el('textarea', { id: 'goalie-notes', rows: 2, maxlength: 300, oninput: e => set({ goalieNotes: e.target.value }, { quiet: true, coalesce: 'goalie' }) }, d.goalieNotes || '')),
      field('Visibility', el('div', { class: 'pp-seg' }, el('button', { type: 'button', class: 'pp-segbtn', 'aria-pressed': 'true' }, 'Private'), el('button', { type: 'button', class: 'pp-segbtn', disabled: true }, 'Public')), 'Public is available when sharing arrives.'),
      el('label', { class: 'pp-check' }, el('input', { type: 'checkbox', id: 'auto-glow', checked: d.autoHighlight !== false, onchange: e => set({ autoHighlight: e.target.checked }) }), 'Glow on the puck carrier'),
    ];
  }

  /** A numbered list the coach types into (coaching points, setup): add, edit, reorder, remove. */
  listField(key, { label, item, add, id, hint }) {
    const list = this.d[key] || [];
    const now = () => [...(this.d[key] || [])];          // read at tap time: typing doesn't redraw the list
    const set = (v, opts) => this.commit(D.setDetails(this.d, { [key]: v }), opts);
    const swap = (i, j) => { const c = now(); [c[i], c[j]] = [c[j], c[i]]; set(c); };
    return el('div', { class: 'field', id: `${id}-list` }, el('span', { class: 't-label' }, label),
      hint ? el('span', { class: 'muted pp-hint' }, hint) : null,
      el('ol', { class: 'pp-pointlist' }, ...list.map((text, i) => el('li', { class: 'pp-listitem' },
        el('textarea', { class: `${id}-text`, rows: 2, maxlength: 140, 'aria-label': `${item} ${i + 1}`, oninput: e => { const c = now(); c[i] = e.target.value; set(c, { quiet: true, coalesce: `${id}-${i}` }); } }, text),
        el('div', { class: 'pp-listbtns' },
          el('button', { type: 'button', class: 'btn pp-mini', 'aria-label': `Move ${item.toLowerCase()} ${i + 1} up`, disabled: i === 0, onclick: () => swap(i, i - 1) }, '↑'),
          el('button', { type: 'button', class: 'btn pp-mini', 'aria-label': `Move ${item.toLowerCase()} ${i + 1} down`, disabled: i === list.length - 1, onclick: () => swap(i, i + 1) }, '↓'),
          el('button', { type: 'button', class: 'btn pp-mini', 'aria-label': `Remove ${item.toLowerCase()} ${i + 1}`, onclick: () => set(now().filter((_, j) => j !== i)) }, '✕'))))),
      el('button', { type: 'button', class: 'btn', id: `add-${id}`, onclick: () => { set([...now(), '']); const all = this.panel.querySelectorAll(`.${id}-text`); all[all.length - 1] && all[all.length - 1].focus(); } }, add));
  }

  /* ---------- rink overlay: hit areas, path handles, grid, live markup ---------- */
  overlay(fr) {
    if (!this.built && !this.player) return '';
    const ctm = this.player.svg.getScreenCTM();
    const pxPerFt = ctm ? ctm.a : 4;
    const minR = 24 / pxPerFt;          // at least a 48 px target
    let s = '';
    if (this.grid) {
      s += '<g class="pp-grid" pointer-events="none">';
      for (let x = 0; x <= 200; x += 5) s += `<line x1="${x}" y1="0" x2="${x}" y2="85"/>`;
      for (let y = 0; y <= 85; y += 5) s += `<line x1="0" y1="${y}" x2="200" y2="${y}"/>`;
      s += '</g>';
    }
    const k = fr.k;
    if (this.sel && k > 0) {
      const p = this.d.pieces.find(x => x.id === this.sel);
      const m = p && moveOf(this.d.steps[k - 1], p.id);
      if (m && m.to && movesIn(this.d, k, p.id)) {
        const handles = (m.bends || []).length ? m.bends.map((b, i) => [b, i]) : (() => { const pl = pathOf(this.d, k, p.id); const q = at(pl, pl.L / 2); return [[[q.x, q.y], 'mid']]; })();
        for (const [[x, y], i] of handles) s += `<g class="pp-handle" data-bend="${i}"><circle cx="${x}" cy="${y}" r="${Math.max(minR * 0.75, 2)}" fill="transparent"/><circle cx="${x}" cy="${y}" r="1.4" fill="#fff" stroke="${ACCENT}" stroke-width=".6"/></g>`;
      }
    }
    for (const pc of fr.pieces) if (pc.opacity > 0.05) s += `<circle class="pp-hit" data-hit="${pc.id}" cx="${pc.x}" cy="${pc.y}" r="${Math.max(radius(pc.type) + 0.8, minR)}" fill="transparent"/>`;
    if (this.live) s += this.live;
    return s;
  }

  wirePointer() {
    const svg = this.player.svg;
    svg.addEventListener('pointerdown', e => this.down(e));
    svg.addEventListener('pointermove', e => this.moveP(e));
    svg.addEventListener('pointerup', e => this.up(e));
    svg.addEventListener('pointercancel', () => this.cancelDrag());
    svg.addEventListener('click', e => {
      if (this.tool !== 'erase') return;
      const m = e.target.closest('[data-mark]');
      if (m) { this.commit(D.removeMark(this.d, m.getAttribute('data-mark'))); toast('Mark erased', { action: ['Undo', () => this.undo()], scoped: true }); }
    });
  }

  down(e) {
    if (e.button > 0) return;
    if (this.player.playing) this.player.pause();
    if (this.mode === 'portrait') return;
    if (this.closePops()) return;      // a tap on the rink closes the pieces or drawing pop-up
    const pt = this.player.toRink(e), k = this.k;
    if (this.action) { this.doAction(pt); return; }
    if (this.place) {
      const id = newId('pc');
      this.commit(D.addPiece(this.d, { id, type: this.place, team: this.team, at: pt, step: k }));
      this.select(id, { tab: false });
      return;
    }
    if (this.tool === 'erase') return;
    if (this.tool === 'text') { this.textMark(pt); return; }
    if (this.tool !== 'move') {
      this.drag = { kind: 'mark', points: [pt], start: pt };
      this.player.svg.setPointerCapture(e.pointerId);
      return;
    }
    const bend = e.target.closest('[data-bend]');
    if (bend && this.sel) {
      this.drag = { kind: 'bend', i: bend.getAttribute('data-bend'), base: this.d, start: pt, moved: false };
    } else {
      const id = this.nearest(pt, e.target);
      if (!id) { if (this.sel) this.select(null); if (this.drawer) this.setDrawer(false); return; }
      const again = id === this.sel || (this.sel && this.under(pt).includes(this.sel));
      if (!again) this.select(id);
      const from = positionsByStep(this.d)[k][id];
      this.drag = { kind: 'piece', id, base: this.d, start: pt, moved: false, again, trail: [from ? [...from] : pt] };
    }
    this.player.svg.setPointerCapture(e.pointerId);
    this.armGrid();
  }

  /** The piece under a finger: the one whose centre is nearest, within its touch area. */
  nearest(pt, target, { players = false, except = null } = {}) {
    if (target && !target.closest('[data-hit],[data-piece]')) return null;
    const ctm = this.player.svg.getScreenCTM(), minR = 24 / (ctm ? ctm.a : 4);
    let best = null, bestD = Infinity;
    for (const pc of this.player.current().pieces) {
      if (pc.opacity <= 0.05 || pc.id === except || (players && !isPlayer(pc.type))) continue;
      const dd = Math.hypot(pc.x - pt[0], pc.y - pt[1]);
      if (dd <= Math.max(radius(pc.type) + 0.8, minR) && dd < bestD) { best = pc.id; bestD = dd; }
    }
    return best;
  }

  /** Every piece whose touch area covers this point, nearest first. */
  under(pt) {
    const ctm = this.player.svg.getScreenCTM(), minR = 24 / (ctm ? ctm.a : 4);
    return this.player.current().pieces
      .filter(pc => pc.opacity > 0.05)
      .map(pc => [pc.id, Math.hypot(pc.x - pt[0], pc.y - pt[1]), Math.max(radius(pc.type) + 0.8, minR)])
      .filter(([, dd, r]) => dd <= r).sort((a, b) => a[1] - b[1]).map(([id]) => id);
  }

  armGrid() { clearTimeout(this.gridTimer); this.gridTimer = setTimeout(() => { if (this.drag && this.drag.kind !== 'mark') { this.grid = true; this.player.draw(); } }, 500); }

  moveP(e) {
    if (!this.drag) return;
    const pt = this.player.toRink(e), dr = this.drag;
    if (dr.kind === 'mark') {
      if (this.tool === 'pen') dr.points.push(pt); else dr.points = [dr.start, pt];
      this.live = this.markPreview(dr.points);
      this.player.draw();
      return;
    }
    if (!dr.moved && Math.hypot(pt[0] - dr.start[0], pt[1] - dr.start[1]) < 0.8) return;
    if (dr.last && Math.hypot(pt[0] - dr.last[0], pt[1] - dr.last[1]) > 0.3) { this.grid = false; this.armGrid(); }
    if (!dr.moved && dr.kind === 'piece' && dr.id !== this.sel) this.select(dr.id);
    dr.moved = true; dr.last = pt;
    const k = this.k;
    if (dr.kind === 'piece') dr.trail.push(pt);
    dr.result = dr.kind === 'piece' ? D.traceMove(dr.base, k, dr.id, dr.trail)
      : D.moveBend(dr.base, k, this.sel, dr.i === 'mid' ? 0 : +dr.i, pt);
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.drag && this.drag.result) { this.d = this.drag.result; this.player.load(this.d); } });
  }

  up() {
    const dr = this.drag; this.drag = null;
    clearTimeout(this.gridTimer);
    const hadGrid = this.grid; this.grid = false;
    if (!dr) return;
    if (dr.kind === 'mark') {
      this.live = '';
      const pts = this.tool === 'pen' ? D.smoothStroke(dr.points) : dr.points;
      const big = pts.length > 1 && Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) > 1.5;
      if (big || (this.tool === 'pen' && pts.length > 2)) this.commit(D.addMark(this.d, { id: newId('mk'), step: this.markAll ? null : this.k, kind: this.tool, points: pts, colour: this.markColour }));
      else this.player.draw();
      return;
    }
    if (dr.moved && dr.result) { this.d = dr.base; this.commit(dr.result); return; }
    if (dr.kind === 'piece' && this.mode === 'compact') this.setDrawer(true);    // a tap (not a drag) opens its options
    if (dr.kind === 'piece' && dr.again) {
      // a second tap on pieces that overlap (a puck on a stick) selects the next one
      const ids = this.under(dr.start);
      if (ids.length > 1) { const next = ids[(ids.indexOf(this.sel) + 1) % ids.length]; this.select(next); toast(`${NAMES[this.d.pieces.find(x => x.id === next).type]} selected`, { ms: 1500 }); return; }
    }
    if (hadGrid) this.player.draw();
  }

  cancelDrag() {
    if (!this.drag) return;
    if (this.drag.base) { this.d = this.drag.base; this.player.load(this.d); }
    this.drag = null; this.grid = false; this.live = '';
  }

  markPreview(points) {
    const col = MARK_COLOURS[this.markColour];
    const a = points[0], b = points[points.length - 1];
    if (this.tool === 'box') return `<rect x="${Math.min(a[0], b[0])}" y="${Math.min(a[1], b[1])}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}" fill="none" stroke="${col}" stroke-width=".55" stroke-dasharray="1.4 1"/>`;
    return `<path d="M${points.map(p => p.join(',')).join(' L')}" fill="none" stroke="${col}" stroke-width=".55" stroke-linecap="round"/>`;
  }

  async textMark(pt) {
    const input = el('input', { id: 'mark-text', maxlength: 30, 'aria-label': 'Text', placeholder: 'A word or two' });
    const p = dialog({ title: 'Add text', body: input, buttons: [{ label: 'Cancel', value: null }, { label: 'Add', value: 'add', kind: 'primary' }] });
    setTimeout(() => input.focus(), 0);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.closest('.dialog').querySelector('[data-value="add"]').click(); } });
    if (await p === 'add' && input.value.trim()) this.commit(D.addMark(this.d, { id: newId('mk'), step: this.markAll ? null : this.k, kind: 'text', points: [pt], text: input.value.trim(), colour: this.markColour }));
  }

  select(id, { tab = true } = {}) {
    this.sel = id;
    this.player.select(id);
    if (tab && id) this.tab = 'piece';
    this.renderPanel();
  }

  /* ---------- changes, undo, saving ---------- */
  commit(next, { quiet = false, coalesce = null } = {}) {
    if (next === this.d) return;
    const now = Date.now();
    const merge = coalesce && coalesce === this.coalesceKey && now - this.coalesceAt < 1500;
    if (!merge) { this.past.push(JSON.stringify(this.d)); if (this.past.length > D.MAX_UNDO) this.past.shift(); this.future = []; }
    this.coalesceKey = coalesce; this.coalesceAt = now;
    this.d = next;
    this.changed({ quiet });
  }

  changed({ quiet = false } = {}) {
    if (this.sel && !this.d.pieces.some(p => p.id === this.sel)) this.sel = null;
    this.player.selected = this.sel;
    this.player.load(this.d);
    if (!quiet) { this.renderPanel(); this.renderTray(); this.renderTools(); }
    this.status = 'Saving…'; this.renderTop();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 500);
  }

  undo() {
    if (!this.past.length) return;
    this.future.push(JSON.stringify(this.d));
    this.d = JSON.parse(this.past.pop()); this.coalesceKey = null;
    this.changed();
  }
  redo() {
    if (!this.future.length) return;
    this.past.push(JSON.stringify(this.d));
    this.d = JSON.parse(this.future.pop()); this.coalesceKey = null;
    this.changed();
  }

  async save() {
    clearTimeout(this.saveTimer); this.saveTimer = 0;
    const snapshot = this.d;
    this.saving = this.saving.then(async () => {
      try {
        const thumb = await thumbnailSVG(snapshot, frame);
        this.rec = await this.app.store.save('drills', { ...this.rec, ...snapshot, thumb });
        if (this.d === snapshot) { this.status = 'Saved'; this.renderTop(); }
      } catch (e) {
        this.status = 'Not saved'; this.renderTop();
        if (e.code === 'full') toast('Your tablet is out of space. Your last saved version is kept.', { error: true, action: ['Try again', () => this.save()] });
        else toast(`Couldn’t save: ${e.message}`, { error: true, action: ['Try again', () => this.save()] });
      }
    });
    return this.saving;
  }

  flush() { if (this.saveTimer) return this.save(); return this.saving; }

  close() {
    this.flush();
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onHide);
    removeEventListener('pagehide', this.onHide);
    for (const m of this.mqs || []) m.removeEventListener('change', this.onMode);
    document.body.classList.remove('pp-ed-compact', 'pp-ed-portrait');
    this.player.destroy();
    this.app.busy = false;
    if (this.app.pendingUpdate) { this.app.pendingUpdate = null; this.app.checkUpdates(); }
  }

  /* ---------- actions ---------- */
  addStep() {
    const { drill, k } = D.addStep(this.d, this.k);
    this.commit(drill);
    this.player.goStep(k);
    this.tab = this.sel ? this.tab : 'step';
    this.renderPanel();
  }

  removeSelected() {
    const p = this.d.pieces.find(x => x.id === this.sel);
    if (!p) return;
    this.commit(D.removePiece(this.d, p.id));
    this.select(null);
    toast(`${NAMES[p.type]} removed`, { action: ['Undo', () => this.undo()], scoped: true });
  }

  key(e) {
    if (document.querySelector('.bbl-overlay')) return;
    const typing = e.target.closest && e.target.closest('input,textarea,select,[contenteditable]');
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !typing && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if (mod && !typing && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); this.redo(); return; }
    if (typing) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { e.preventDefault(); this.removeSelected(); return; }
    if (e.key === 'Escape' && this.action) { this.cancelAction(); return; }
    if (e.key === 'Escape') { if (this.place || this.tool !== 'move') this.setTool('move'); else if (this.sel) this.select(null); return; }
    if (e.shiftKey && this.sel && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const k = this.k, pos = positionsByStep(this.d)[k][this.sel];
      const dx = { ArrowLeft: -1, ArrowRight: 1 }[e.key] || 0, dy = { ArrowUp: -1, ArrowDown: 1 }[e.key] || 0;
      this.commit(D.dragPiece(this.d, k, this.sel, [pos[0] + dx, pos[1] + dy]), { coalesce: `nudge-${this.sel}-${k}`, quiet: true });
      return;
    }
    if (!e.target.closest || !e.target.closest('.pp-player')) {
      if (e.key === ' ') { e.preventDefault(); this.player.toggle(); }
      else if (e.key === 'ArrowLeft') this.player.goStep(this.k - 1);
      else if (e.key === 'ArrowRight') this.player.goStep(this.k + 1);
    }
  }

  async menu() {
    const view = this.d.view || { rink: 'full', flip: false };
    const flip = el('button', { type: 'button', class: 'btn', id: 'menu-flip', 'aria-pressed': String(!!view.flip), hidden: !['half', 'zone'].includes(view.rink),
      onclick: () => { const w = this.d.view; this.commit(D.setDetails(this.d, { view: { ...w, flip: !w.flip } })); flip.setAttribute('aria-pressed', String(!!this.d.view.flip)); } }, '⇄ Flip');
    const rinkView = this.mode === 'compact' ? el('div', { class: 'row' },
      el('label', { class: 'pp-inline' }, el('span', {}, 'Rink view '),
        el('select', { id: 'menu-rink-view', onchange: e => { this.commit(D.setDetails(this.d, { view: { ...this.d.view, rink: e.target.value } })); flip.hidden = !['half', 'zone'].includes(e.target.value); } },
          ...VIEWS.map(([val, label]) => el('option', { value: val, selected: view.rink === val }, label)))), flip) : null;
    const v = await dialog({ id: 'drill-actions', title: this.d.title || 'Drill', body: el('div', { class: 'stack' }, rinkView, el('p', { class: 'muted', style: 'margin:0' }, 'Your changes are already saved.')), buttons: [
      { label: 'Duplicate', value: 'dup' }, { label: 'Save as template', value: 'tmpl' }, { label: 'Delete', value: 'del', kind: 'danger' }, { label: 'Close', value: null }] });
    if (!v) return;
    await this.flush();
    if (v === 'dup') {
      const c = D.duplicateDrill(this.rec, newId('d'));
      await this.app.store.save('drills', { ...c, thumb: this.rec.thumb });
      toast(`“${c.title}” opened`);
      location.hash = `#edit/${c.id}`;
    } else if (v === 'tmpl') {
      const t = D.templateFrom(this.rec, newId('d'));
      await this.app.store.save('drills', { ...t, thumb: this.rec.thumb });
      toast('Saved as a template. New drill now offers it.');
    } else if (v === 'del') {
      const id = this.rec.id;
      await this.app.store.save('drills', { ...this.rec, deletedAt: new Date().toISOString() });
      location.hash = '#library';
      toast(`“${this.d.title}” moved to Recently deleted`, { action: ['Undo', async () => {
        const r = await this.app.store.get('drills', id); await this.app.store.save('drills', { ...r, deletedAt: null }); this.app.render();
      }] });
    }
  }
}
