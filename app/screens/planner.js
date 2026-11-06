/* Plan builder (R2 Plan Builder deep-dive): the plan as blocks on the left with the ice-time bar,
   and a side panel: Add drills, Details, Equipment, or the selected block's options. Saves as you go. */
import { el, fill, toast, dialog } from '../ui.js?v=1.3.2';
import { inTeam, pubWords, canPublish, canDiscard, publishFlow, discardFlow, warnMark } from './publishui.js?v=1.3.2';
import { newId } from '../../vendor/bbl-kit/1.0.1/bbl-store.js';
import { History } from '../history.js?v=1.3.2';
import { Player } from '../engine/player.js?v=1.3.2';
import * as P from '../plans.js?v=1.3.2';
import { findDrills, DEFAULT_FILTERS, lengthLabel } from '../drills.js?v=1.3.2';
import { reviewOnly } from './editor.js?v=1.3.2';
import { planView, thumb, blockTitle, KIND_NAMES } from './plans.js?v=1.3.2';

const COLOURS = ['#F26A1B', '#1d9e75', '#3b5ba5', '#c2417e', '#8a6d1d', '#5a6b7d'];
const strip = r => { const { createdAt, updatedAt, updatedBy, schemaVersion, ...rest } = r; return rest; };
const field = (label, input, hint) => el('label', { class: 'field' }, el('span', { class: 't-label' }, label), input, hint ? el('span', { class: 'muted pp-hint' }, hint) : null);
const seg = (name, options, value, onPick) => el('div', { class: 'pp-seg', role: 'group', 'aria-label': name },
  ...options.map(([v, label]) => el('button', { type: 'button', class: 'pp-segbtn', 'aria-pressed': String(v === value), onclick: () => onPick(v) }, label)));

export function renderPlanner(app, id) {
  const root = el('div', { class: 'pp-editor-screen' }, el('p', { class: 'muted' }, 'Opening the plan…'));
  open(app, id, root).catch(e => fill(root, el('div', { class: 'card notice' }, el('p', {}, `This plan couldn’t be opened. ${e.message || ''}`), el('a', { class: 'btn', href: '#plans' }, 'Back to Plans'))));
  return root;
}

async function open(app, id, root) {
  const [rec, drills, plans] = await Promise.all([app.store.get('plans', id), app.store.all('drills'), app.store.all('plans')]);
  if (!rec || rec.deletedAt) {
    fill(root, el('section', { class: 'card empty' }, el('h2', { class: 't-section' }, 'That plan isn’t here'),
      el('p', {}, rec ? 'It’s in Recently deleted. Restore it from Plans first.' : 'It may have been deleted.'), el('a', { class: 'btn primary', href: '#plans' }, 'Back to Plans')));
    return;
  }
  const map = new Map(drills.map(d => [d.id, d]));
  const lookup = x => map.get(x) || null;
  if (reviewOnly()) {
    fill(root, el('div', { class: 'screen-head' }, el('a', { class: 'btn', href: `#plans/${rec.id}` }, '‹ Plans'), el('h1', { class: 't-title pp-title-cut' }, rec.title)),
      el('div', { class: 'card notice' }, el('p', {}, 'Edit on a tablet or PC. You can read the plan and open its drills here.')),
      planView(rec, { lookup, team: app.team, onDrill: d => { location.hash = `#library/${d.id}`; } }));
    return;
  }
  const pb = new Planner(app, rec, root, drills, plans);
  app.cleanup = () => pb.close();
}

class Planner {
  constructor(app, rec, root, drills, plans) {
    this.app = app; this.rec = rec; this.root = root;
    this.drills = drills; this.map = new Map(drills.map(d => [d.id, d]));
    this.lookup = id => this.map.get(id) || null;
    this.helpers = P.helperNames(plans);
    this.sel = null; this.tab = 'add'; this.pick = null; this.q = '';
    this.h = new History(strip(rec), {
      onChange: (v, o) => this.changed(o),
      save: async v => { this.rec = await this.app.store.save('plans', { ...this.rec, ...v }); if (this.bPublish) this.renderTop(); },
    });
    app.busy = true;
    this.build();
    if (inTeam(app)) warnMark(app, 'plans', rec.id);
    this.onKey = e => this.key(e);
    document.addEventListener('keydown', this.onKey);
    this.onHide = () => { if (document.visibilityState === 'hidden') this.h.flush(); };
    document.addEventListener('visibilitychange', this.onHide);
    addEventListener('pagehide', this.onHide);
  }

  get p() { return this.h.value; }
  commit(next, opts) { this.h.commit(next, opts); }

  build() {
    this.titleEl = el('h1', { class: 't-section pp-title-cut', id: 'plan-title' });
    this.statusEl = el('span', { class: 'pp-status', 'aria-live': 'polite', id: 'save-status' }, 'Saved');
    this.bUndo = el('button', { type: 'button', class: 'btn', id: 'undo', 'aria-label': 'Undo', onclick: () => this.h.undo() }, '↶ Undo');
    this.bRedo = el('button', { type: 'button', class: 'btn', id: 'redo', 'aria-label': 'Redo', onclick: () => this.h.redo() }, '↷ Redo');
    this.bPublish = el('button', { type: 'button', class: 'btn primary', id: 'publish-btn', hidden: true, title: 'Publish to your team', onclick: () => this.publish() }, 'Publish');
    this.pubEl = el('span', { class: 'pp-status pp-pub', id: 'pub-status' });
    this.budgetEl = el('div', { class: 'pp-budget', id: 'budget', role: 'img' });
    this.blocksEl = el('div', { class: 'pp-blocks', id: 'blocks' });
    this.panel = el('aside', { class: 'pp-panel card', id: 'plan-panel', 'aria-label': 'Options' });
    fill(this.root,
      el('div', { class: 'pp-edtop' },
        el('a', { class: 'btn', href: `#plans/${this.rec.id}`, id: 'planner-back' }, '‹ Plans'),
        el('div', { class: 'grow pp-edtitle' }, this.titleEl, el('span', { class: 'row pp-statuses' }, this.statusEl, this.pubEl)),
        this.bUndo, this.bRedo, this.bPublish,
        el('button', { type: 'button', class: 'btn', id: 'print-btn', onclick: async () => { await this.h.flush(); location.hash = `#print/${this.rec.id}`; } }, 'Print'),
        el('button', { type: 'button', class: 'btn', id: 'plan-menu', 'aria-label': 'More plan actions', onclick: () => this.menu() }, '⋮')),
      this.budgetEl,
      el('div', { class: 'pp-planner' }, el('div', { class: 'stack' }, this.blocksEl, this.addRow()), this.panel));
    this.renderAll();
  }

  addRow() {
    return el('div', { class: 'row', id: 'add-row' },
      el('button', { type: 'button', class: 'btn primary', id: 'add-drill-btn', onclick: () => { this.pick = null; this.sel = null; this.tab = 'add'; this.renderPanel(); const s = this.panel.querySelector('#drill-search'); if (s) s.focus(); } }, '+ Drill'),
      el('button', { type: 'button', class: 'btn', id: 'add-stations-btn', onclick: () => this.addStations() }, '+ Stations'),
      el('button', { type: 'button', class: 'btn', id: 'add-activity-btn', onclick: () => this.addActivity() }, '+ Activity'));
  }

  changed({ quiet = false, statusOnly = false } = {}) {
    this.renderTop();
    if (statusOnly) {
      if (this.h.status === 'Not saved') {
        const e = this.h.error || {};
        toast(e.code === 'full' ? 'Your tablet is out of space. Your last saved version is kept.' : `Couldn’t save: ${e.message || ''}`, { error: true, action: ['Try again', () => this.h.save()] });
      }
      return;
    }
    if (this.sel && !this.p.blocks.some(b => b.id === this.sel)) this.sel = null;
    this.renderBudget(); this.renderBlocks();
    if (!quiet) this.renderPanel();
  }

  renderAll() { this.renderTop(); this.renderBudget(); this.renderBlocks(); this.renderPanel(); }

  renderTop() {
    this.titleEl.textContent = this.p.title || 'New plan';
    this.statusEl.textContent = this.h.status;
    this.statusEl.className = `pp-status${this.h.status === 'Not saved' ? ' bad' : ''}`;
    this.bUndo.disabled = !this.h.past.length; this.bRedo.disabled = !this.h.future.length;
    this.bPublish.hidden = !canPublish(this.app, this.rec);
    this.pubEl.textContent = pubWords(this.app, this.rec);
  }

  async publish() {
    const r = await publishFlow(this.app, 'plans', this.rec.id, { before: () => this.h.flush() });
    if (!r) return;
    const fresh = await this.app.store.get('plans', this.rec.id);
    if (!fresh || r.took.includes(this.rec.id)) { this.app.render(); return; }
    this.rec = fresh; this.renderTop();
  }

  renderBudget() {
    const b = P.budget(this.p, this.app.team), span = Math.max(b.ice, b.used) || 1;
    const sched = P.schedule(this.p, this.app.team);
    this.budgetEl.className = `pp-budget ${b.state}`;
    this.budgetEl.setAttribute('aria-label', b.words);
    fill(this.budgetEl,
      el('div', { class: 'pp-budget-bar' },
        ...sched.map((s, i) => el('span', { class: 'pp-budget-seg', title: `${blockTitle(this.p.blocks[i], this.lookup)} · ${s.minutes} min`, style: `left:${s.start / span * 100}%;width:${s.minutes / span * 100}%;background:${COLOURS[i % COLOURS.length]}` })),
        el('span', { class: 'pp-budget-end', style: `left:${b.ice / span * 100}%` })),
      el('span', { class: 'pp-budget-words', id: 'budget-words' }, b.words));
  }

  renderBlocks() {
    const sched = P.schedule(this.p, this.app.team);
    if (!this.p.blocks.length) {
      fill(this.blocksEl, el('section', { class: 'card empty', id: 'plan-empty' }, el('h2', { class: 't-section' }, 'Add your first drill'),
        el('p', {}, 'Tap + Add beside a drill on the right, or add stations or an activity below.')));
      return;
    }
    fill(this.blocksEl, ...this.p.blocks.map((b, i) => {
      const s = sched[i];
      const when = P.clock(this.p.startTime, s.start);
      const status = b.kind === 'drill' ? P.drillStatus(b.drillId, this.lookup) : 'ok';
      const d = b.kind === 'drill' ? this.lookup(b.drillId) : null;
      return el('div', { class: `pp-block card${this.sel === b.id ? ' selected' : ''}${s.over ? ' over' : ''}`, 'data-id': b.id, style: `--blk:${COLOURS[i % COLOURS.length]}` },
        el('button', { type: 'button', class: 'pp-block-main', 'aria-pressed': String(this.sel === b.id), 'aria-label': `${blockTitle(b, this.lookup)}, ${s.minutes} minutes`, onclick: () => this.select(b.id) },
          el('span', { class: 'pp-block-time' }, P.mmss(s.start), when ? el('span', { class: 'muted' }, when) : null),
          b.kind === 'drill' ? thumb(d, 'pp-thumb pp-block-thumb') : null,
          el('span', { class: 'pp-block-text' },
            el('span', { class: 'pp-block-title' }, blockTitle(b, this.lookup)),
            el('span', { class: 'muted pp-block-kind' }, [KIND_NAMES[b.kind], (b.helpers || []).length ? `Helpers: ${b.helpers.join(', ')}` : '', b.note].filter(Boolean).join(' · ')),
            status === 'deleted' ? el('span', { class: 'pp-overtag' }, 'This drill is in Recently deleted') : null,
            s.over ? el('span', { class: 'pp-overtag' }, 'Over time') : null),
          el('span', { class: 'pp-block-min' }, `${s.minutes} min`)),
        b.kind === 'stations' ? el('div', { class: 'pp-stations' }, ...b.stations.map(st => {
          const sd = this.lookup(st.drillId);
          return el('div', { class: 'pp-station' }, thumb(sd, 'pp-thumb'),
            el('b', {}, sd ? sd.title : 'Drill (deleted)'),
            el('span', { class: 'muted' }, [st.area, (st.helpers || []).length ? `Helper: ${st.helpers.join(', ')}` : ''].filter(Boolean).join(' · ')));
        }), b.stations.length < P.MAX_STATIONS ? el('button', { type: 'button', class: 'btn pp-station-add', onclick: () => this.startPick(b.id) }, '+ Station') : null) : null);
    }));
  }

  select(id) { this.sel = this.sel === id ? null : id; this.pick = null; this.renderBlocks(); this.renderPanel(); }

  /* ---------- the side panel ---------- */
  renderPanel() {
    const active = document.activeElement && this.panel.contains(document.activeElement) ? document.activeElement.id : null;
    this.preview && this.preview.destroy(); this.preview = null;
    const b = this.p.blocks.find(x => x.id === this.sel);
    if (b && !this.pick) {
      fill(this.panel, el('div', { class: 'pp-panel-body stack', id: 'block-panel' }, ...this.blockPanel(b)));
    } else {
      const tabs = [['add', 'Add drills'], ['details', 'Details'], ['equipment', 'Equipment']];
      const body = this.pick || this.tab === 'add' ? this.addPanel() : this.tab === 'details' ? this.detailsPanel() : this.equipmentPanel();
      fill(this.panel,
        el('div', { class: 'pp-tabs', role: 'tablist' }, ...tabs.map(([t, label]) => el('button', { type: 'button', role: 'tab', class: 'pp-tab', id: `ptab-${t}`, 'aria-selected': String((this.pick ? 'add' : this.tab) === t), onclick: () => { this.tab = t; this.pick = null; this.renderPanel(); } }, label))),
        el('div', { class: 'pp-panel-body stack', role: 'tabpanel' }, ...body));
    }
    if (active) { const a = document.getElementById(active); if (a) a.focus(); }
  }

  addPanel() {
    const results = el('div', { class: 'pp-picklist', id: 'drill-results' });
    const draw = () => {
      const list = findDrills(this.drills, { ...DEFAULT_FILTERS, q: this.q, sort: 'az' });
      fill(results, ...(list.length ? list.map(d => el('div', { class: 'pp-pick' }, thumb(d, 'pp-thumb'),
        el('span', { class: 'pp-pick-text' }, el('b', {}, d.title), el('span', { class: 'muted' }, `${lengthLabel(d)} · ${P.usualMinutes(d)} min`)),
        el('button', { type: 'button', class: 'btn', 'aria-label': `Add ${d.title}`, 'data-drill': d.id, onclick: () => this.addDrill(d) }, '+ Add'))) : [el('p', { class: 'muted' }, 'No drills match.')]));
    };
    draw();
    const station = this.pick && this.p.blocks.find(x => x.id === this.pick.blockId);
    return [
      station ? el('div', { class: 'pp-actionbar', id: 'pick-hint' }, el('span', { class: 'grow' }, this.pick.stationId ? 'Pick the drill for this station.' : `Pick a drill for station ${station.stations.length + 1}.`),
        el('button', { type: 'button', class: 'btn', id: 'cancel-pick', onclick: () => { this.sel = this.pick.blockId; this.pick = null; this.renderPanel(); } }, 'Cancel')) : null,
      el('input', { type: 'search', id: 'drill-search', placeholder: 'Search drills', 'aria-label': 'Search drills', value: this.q, oninput: e => { this.q = e.target.value; draw(); } }),
      results].filter(Boolean);
  }

  detailsPanel() {
    const p = this.p, set = (f, o) => this.commit({ ...this.p, ...f }, o);
    const teamIce = (this.app.team && this.app.team.iceTimeMinutes) || 50;
    return [
      field('Title', el('input', { id: 'plan-title-input', value: p.title, maxlength: 100, oninput: e => set({ title: e.target.value }, { quiet: true, coalesce: 'title' }), onblur: e => { if (!e.target.value.trim()) { e.target.value = 'New plan'; set({ title: 'New plan' }); } } })),
      el('div', { class: 'pp-two' },
        field('Date', el('input', { type: 'date', id: 'plan-date', value: p.date || '', onchange: e => set({ date: e.target.value }) })),
        field('Start time', el('input', { type: 'time', id: 'plan-start', value: p.startTime || '', onchange: e => set({ startTime: e.target.value }) }))),
      field('Ice time (minutes)', el('input', { type: 'number', id: 'plan-ice', min: 10, max: 180, inputmode: 'numeric', value: p.iceMinutes || '', placeholder: String(teamIce),
        onchange: e => { const v = Math.round(Number(e.target.value)); set({ iceMinutes: v >= 10 && v <= 180 ? v : null }); } }), `Leave empty to use your team’s ${teamIce} minutes.`),
      field('Key themes', el('textarea', { id: 'plan-themes', rows: 2, maxlength: 200, placeholder: 'e.g. Support the puck, talk on the ice', oninput: e => set({ themes: e.target.value }, { quiet: true, coalesce: 'themes' }) }, p.themes || '')),
      field('Notes', el('textarea', { id: 'plan-notes', rows: 4, maxlength: 1000, placeholder: 'Notes for your staff', oninput: e => set({ notes: e.target.value }, { quiet: true, coalesce: 'notes' }) }, p.notes || '')),
    ];
  }

  equipmentPanel() {
    const eq = P.equipment(this.p, this.lookup), sheet = P.setupSheet(this.p, this.lookup);
    const extra = this.p.extraEquipment || [];
    const input = el('input', { id: 'new-equipment', placeholder: 'e.g. Pinnies, water bottles', maxlength: 40, 'aria-label': 'Add an item', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); add(); } } });
    const add = () => { const v = input.value.trim(); if (v) this.commit({ ...this.p, extraEquipment: [...extra, v] }); };
    return [
      el('p', { class: 'muted pp-hint', style: 'margin:0' }, 'Counted from the drills: the most needed at once. Stations running together add up.'),
      eq.length ? el('ul', { class: 'pp-equip', id: 'equipment-list' }, ...eq.map(e => el('li', {}, el('b', {}, String(e.count)), ` ${e.label}`))) : el('p', { class: 'muted', id: 'equipment-list' }, 'No equipment in these drills yet.'),
      ...extra.map((x, i) => el('div', { class: 'row' }, el('span', { class: 'grow' }, x), el('button', { type: 'button', class: 'btn pp-mini', 'aria-label': `Remove ${x}`, onclick: () => this.commit({ ...this.p, extraEquipment: extra.filter((_, j) => j !== i) }) }, '✕'))),
      el('div', { class: 'row' }, input, el('button', { type: 'button', class: 'btn', id: 'add-equipment', onclick: add }, 'Add')),
      sheet.length ? el('section', { id: 'setup-sheet' }, el('h3', { class: 't-label' }, 'Setup'), ...sheet.map(s => el('div', {}, el('b', {}, s.title), el('ol', { class: 'pp-points' }, ...s.lines.map(l => el('li', {}, l)))))) : null,
    ].filter(Boolean);
  }

  helperField(list, onSet, idBase) {
    const dl = `${idBase}-names`;
    const input = el('input', { id: `${idBase}-input`, list: dl, placeholder: 'Add a helper', maxlength: 40, 'aria-label': 'Helper name', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); add(); } } });
    const add = () => { const v = input.value.trim(); if (v && !list.includes(v)) { if (!this.helpers.includes(v)) this.helpers.push(v); onSet([...list, v]); } };
    return el('div', { class: 'field' }, el('span', { class: 't-label' }, 'Helpers'),
      list.length ? el('div', { class: 'pp-chipwrap' }, ...list.map(hn => el('button', { type: 'button', class: 'pp-tagchip', 'aria-pressed': 'true', 'aria-label': `Remove ${hn}`, onclick: () => onSet(list.filter(x => x !== hn)) }, `${hn} ✕`))) : null,
      el('div', { class: 'row' }, input, el('button', { type: 'button', class: 'btn', id: `${idBase}-add`, onclick: add }, 'Add')),
      el('datalist', { id: dl }, ...this.helpers.map(n => el('option', { value: n }))));
  }

  minutesField(value, onSet, id, label = 'Minutes') {
    return field(label, el('div', { class: 'row pp-minutes' },
      el('button', { type: 'button', class: 'btn pp-mini', 'aria-label': 'One minute less', id: `${id}-less`, onclick: () => onSet(value - 1) }, '−'),
      el('input', { type: 'number', id, min: 1, max: 120, inputmode: 'numeric', value, 'aria-label': label, onchange: e => onSet(Number(e.target.value)) }),
      el('button', { type: 'button', class: 'btn pp-mini', 'aria-label': 'One minute more', id: `${id}-more`, onclick: () => onSet(value + 1) }, '+')));
  }

  blockPanel(b) {
    const i = this.p.blocks.indexOf(b), n = this.p.blocks.length;
    const set = (f, o) => this.commit(P.setBlock(this.p, b.id, f), o);
    const out = [el('div', { class: 'row' }, el('h2', { class: 't-section grow', id: 'block-name' }, blockTitle(b, this.lookup)),
      el('button', { type: 'button', class: 'btn', id: 'close-block', 'aria-label': 'Close block options', onclick: () => this.select(b.id) }, '✕'))];
    if (b.kind === 'drill') {
      const d = this.lookup(b.drillId), status = P.drillStatus(b.drillId, this.lookup);
      if (status === 'deleted') out.push(el('div', { class: 'card notice stack' }, el('p', { style: 'margin:0' }, 'This drill is in Recently deleted.'),
        el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn primary', id: 'restore-drill', onclick: () => this.restoreDrill(d) }, 'Restore drill'),
          el('button', { type: 'button', class: 'btn', onclick: () => this.removeBlock(b) }, 'Remove from plan'))));
      if (d) {
        const host = el('div', { class: 'pp-block-preview' });
        out.push(host);
        queueMicrotask(() => { if (host.isConnected) this.preview = new Player(host, d); });
        out.push(el('div', { class: 'row' }, el('a', { class: 'btn', id: 'edit-drill-link', href: `#edit/${d.id}` }, 'Edit drill'), el('button', { type: 'button', class: 'btn', id: 'swap-drill', onclick: () => this.startPick(null, null, b.id) }, 'Change drill')));
      }
      out.push(this.minutesField(b.minutes, v => set({ minutes: v }), 'block-minutes'));
      out.push(this.helperField(b.helpers || [], v => set({ helpers: v }), 'block-helpers'));
    } else if (b.kind === 'activity') {
      out.push(field('What', el('input', { id: 'activity-label', value: b.label || '', list: 'activity-names', maxlength: 60, oninput: e => set({ label: e.target.value }, { quiet: true, coalesce: `label-${b.id}` }) }), 'e.g. Warm-up skate, water break, scrimmage'),
        el('datalist', { id: 'activity-names' }, ...P.ACTIVITIES.map(a => el('option', { value: a }))));
      out.push(this.minutesField(b.minutes, v => set({ minutes: v }), 'block-minutes'));
    } else {
      out.push(field('Groups', seg('Groups', [[true, 'Groups rotate'], [false, 'Groups stay']], b.rotate !== false, v => set({ rotate: v })),
        b.rotate !== false ? 'Every group does every station, moving on a whistle.' : 'Each group stays at its station for the whole block (e.g. D on one side, forwards on the other).'));
      out.push(b.rotate !== false ? this.minutesField(b.minutesPerStation, v => set({ minutesPerStation: v }), 'station-minutes', 'Minutes per station') : this.minutesField(b.minutes, v => set({ minutes: v }), 'block-minutes', 'Minutes for the block'));
      b.stations.forEach((st, k) => {
        const sd = this.lookup(st.drillId);
        const setSt = (f, o) => this.commit(P.setStation(this.p, b.id, st.id, f), o);
        out.push(el('div', { class: 'pp-callout-edit stack', 'data-station': st.id },
          el('div', { class: 'row' }, thumb(sd, 'pp-thumb pp-mini-thumb'), el('b', { class: 'grow' }, `${k + 1}. ${sd ? sd.title : 'Drill (deleted)'}`)),
          field('Area', el('input', { class: 'station-area', value: st.area || '', list: 'area-names', maxlength: 40, 'aria-label': `Station ${k + 1} area`, oninput: e => setSt({ area: e.target.value }, { quiet: true, coalesce: `area-${st.id}` }) })),
          this.helperField(st.helpers || [], v => setSt({ helpers: v }), `st-${st.id}`),
          el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', onclick: () => this.startPick(b.id, st.id) }, 'Change drill'),
            el('button', { type: 'button', class: 'btn danger', onclick: () => { this.commit(P.removeStation(this.p, b.id, st.id)); toast('Station removed', { action: ['Undo', () => this.h.undo()], scoped: true }); } }, 'Remove station'))));
      });
      out.push(el('datalist', { id: 'area-names' }, ...P.AREAS.map(a => el('option', { value: a }))));
      if (b.stations.length < P.MAX_STATIONS) out.push(el('button', { type: 'button', class: 'btn', id: 'add-station', onclick: () => this.startPick(b.id) }, '+ Station'));
    }
    out.push(field('Note for this practice', el('textarea', { id: 'block-note', rows: 2, maxlength: 200, oninput: e => set({ note: e.target.value }, { quiet: true, coalesce: `note-${b.id}` }) }, b.note || '')));
    out.push(el('div', { class: 'row' },
      el('button', { type: 'button', class: 'btn', id: 'block-up', disabled: i === 0, onclick: () => this.commit(P.moveBlock(this.p, b.id, -1)) }, '↑ Move up'),
      el('button', { type: 'button', class: 'btn', id: 'block-down', disabled: i === n - 1, onclick: () => this.commit(P.moveBlock(this.p, b.id, 1)) }, '↓ Move down')));
    out.push(el('button', { type: 'button', class: 'btn danger', id: 'remove-block', onclick: () => this.removeBlock(b) }, 'Remove from plan'));
    return out;
  }

  /* ---------- actions ---------- */
  startPick(blockId, stationId = null, swapBlock = null) { this.pick = { blockId, stationId, swapBlock }; this.renderPanel(); const s = this.panel.querySelector('#drill-search'); if (s) s.focus(); }

  addDrill(d) {
    const pk = this.pick;
    if (pk && pk.swapBlock) { this.pick = null; this.sel = pk.swapBlock; this.commit(P.setBlock(this.p, pk.swapBlock, { drillId: d.id })); return; }
    if (pk && pk.stationId) { this.pick = null; this.sel = pk.blockId; this.commit(P.setStation(this.p, pk.blockId, pk.stationId, { drillId: d.id })); return; }
    if (pk && pk.blockId) {
      this.commit(P.addStation(this.p, pk.blockId, { id: newId('st'), drillId: d.id }));
      const b = this.p.blocks.find(x => x.id === pk.blockId);
      if (b.stations.length >= P.MAX_STATIONS) { this.pick = null; this.sel = b.id; this.renderPanel(); }
      toast(`${d.title} added as station ${b.stations.length}`);
      return;
    }
    const at = this.sel ? this.p.blocks.findIndex(x => x.id === this.sel) : this.p.blocks.length - 1;
    this.commit(P.addBlock(this.p, P.drillBlock(newId('bk'), d), at), { quiet: true });
    toast(`${d.title} added · ${P.usualMinutes(d)} min`, { action: ['Undo', () => this.h.undo()], ms: 3000, scoped: true });
  }

  addStations() {
    const b = P.stationsBlock(newId('bk'));
    const at = this.sel ? this.p.blocks.findIndex(x => x.id === this.sel) : this.p.blocks.length - 1;
    this.commit(P.addBlock(this.p, b, at));
    this.startPick(b.id);
  }

  addActivity() {
    const b = P.activityBlock(newId('bk'));
    const at = this.sel ? this.p.blocks.findIndex(x => x.id === this.sel) : this.p.blocks.length - 1;
    this.sel = b.id;
    this.commit(P.addBlock(this.p, b, at));
  }

  removeBlock(b) {
    const name = blockTitle(b, this.lookup);
    this.sel = null;
    this.commit(P.removeBlock(this.p, b.id));
    toast(`${name} removed from the plan`, { action: ['Undo', () => this.h.undo()], scoped: true });
  }

  async restoreDrill(d) {
    const r = await this.app.store.save('drills', { ...d, deletedAt: null });
    this.map.set(r.id, r); this.drills = [...this.map.values()];
    toast(`“${d.title}” restored`); this.renderAll();
  }

  key(e) {
    if (document.querySelector('.bbl-overlay')) return;
    const typing = e.target.closest && e.target.closest('input,textarea,select,[contenteditable]');
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !typing && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) this.h.redo(); else this.h.undo(); }
    else if (mod && !typing && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); this.h.redo(); }
    else if (e.key === 'Escape' && !typing) { if (this.pick) { this.pick = null; this.renderPanel(); } else if (this.sel) this.select(this.sel); }
  }

  async menu() {
    const v = await dialog({ id: 'plan-actions', title: this.p.title || 'Plan', body: el('p', { class: 'muted', style: 'margin:0' }, 'Your changes are already saved.'),
      buttons: [...(canDiscard(this.app, this.rec) ? [{ label: 'Discard changes', value: 'discard' }] : []), { label: 'Duplicate', value: 'dup' }, { label: 'Save as template', value: 'tmpl' }, { label: 'Delete', value: 'del', kind: 'danger' }, { label: 'Close', value: null }] });
    if (!v) return;
    await this.h.flush();
    if (v === 'discard') { if (await discardFlow(this.app, 'plans', this.rec)) this.app.render(); return; }
    if (v === 'dup') { const c = P.duplicatePlan(this.rec, newId('p')); await this.app.store.save('plans', c); toast(`“${c.title}” opened`); location.hash = `#plan/${c.id}`; }
    else if (v === 'tmpl') { await this.app.store.save('plans', P.planTemplate(this.rec, newId('p'))); toast('Saved as a template. New plan now offers it.'); }
    else if (v === 'del') {
      const id = this.rec.id;
      await this.app.store.save('plans', { ...this.rec, deletedAt: new Date().toISOString() });
      location.hash = '#plans';
      toast(`“${this.p.title}” moved to Recently deleted`, { action: ['Undo', async () => { const r = await this.app.store.get('plans', id); await this.app.store.save('plans', { ...r, deletedAt: null }); this.app.render(); }] });
    }
  }

  close() {
    this.h.flush();
    this.preview && this.preview.destroy();
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onHide);
    removeEventListener('pagehide', this.onHide);
    this.app.busy = false;
    if (this.app.pendingUpdate) { this.app.pendingUpdate = null; this.app.checkUpdates(); }
  }
}
