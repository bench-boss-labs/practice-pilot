/* Library (R1 Library deep-dive): search, filters, sort, drill cards with pictures, a playing preview,
   New drill (blank or template), Duplicate, Save as template, Delete to Recently deleted. */
import { el, fill, toast, dialog, shortDate } from '../ui.js?v=1.3.2';
import { newId } from '../../vendor/bbl-kit/1.0.1/bbl-store.js';
import { SCHEMA_VERSION } from '../version.js?v=1.3.2';
import { newDrill } from '../schema.js?v=1.3.2';
import { Player } from '../engine/player.js?v=1.3.2';
import { frame } from '../engine/model.js?v=1.3.2';
import { thumbnailSVG } from '../engine/render.js?v=1.3.2';
import { VIEWS } from '../engine/rink.js?v=1.3.2';
import { firstRunSamples } from '../engine/samples.js?v=1.3.2';
import * as D from '../drills.js?v=1.3.2';
import { drillInfo, pills } from './drillview.js?v=1.3.2';
import { reviewOnly } from './editor.js?v=1.3.2';
import { findPlans, dayLabel, newPlan, addBlock, drillBlock } from '../plans.js?v=1.3.2';

const SHOW = [['drills', 'Drills'], ['templates', 'Templates'], ['samples', 'Samples only'], ['deleted', 'Recently deleted']];
const SORTS = [['edited', 'Recently edited'], ['az', 'A to Z'], ['steps', 'Most steps']];
const RINKS = VIEWS.map(([v, label]) => [v, label.replace(' ice', '').replace(' zone', '')]);

/** Add the sample drills (first run), or put back any that are missing or in the bin (Settings). */
export async function restoreSamples(app, { onlyFirstRun = false } = {}) {
  if (onlyFirstRun && await app.store.get('meta', 'samples-added')) return 0;
  let n = 0;
  for (const s of firstRunSamples()) {
    const have = await app.store.get('drills', s.id);
    if (have && !have.deletedAt) continue;
    await app.store.save('drills', { ...s, thumb: await thumbnailSVG(s, frame) });
    n++;
  }
  await app.store.put('meta', { key: 'samples-added', value: new Date().toISOString() });
  return n;
}

/** Give sample drills saved before 1.1.1 their setup lines (only fills the field when it's missing). */
export async function fillSampleSetup(app) {
  for (const s of firstRunSamples()) {
    const have = await app.store.get('drills', s.id);
    if (have && (!have.setupNotes || have.minutes === undefined)) await app.store.put('drills', { ...have, setupNotes: have.setupNotes || s.setupNotes, minutes: have.minutes === undefined ? s.minutes : have.minutes });
  }
}

/** Remove drills that have been in Recently deleted for more than 30 days. */
export async function emptyBin(app) {
  const ids = D.expired(await app.store.all('drills'));
  for (const id of ids) await app.store.delete('drills', id);
  return ids.length;
}

/** Create a drill (blank, or from a template) and open it in the editor. */
export async function newDrillFlow(app) {
  const templates = (await app.store.all('drills')).filter(d => d.template && !d.deletedAt).sort((a, b) => D.fold(a.title).localeCompare(D.fold(b.title)));
  let from = 'blank';
  if (templates.length) {
    from = await dialog({ id: 'new-drill', title: 'New drill', body: el('p', { style: 'margin:0' }, 'Start blank, or from one of your templates.'),
      buttons: [{ label: 'Blank', value: 'blank', kind: 'primary' }, ...templates.map(t => ({ label: t.title, value: t.id })), { label: 'Cancel', value: null }] });
    if (!from) return;
  }
  const id = newId('d');
  const t = templates.find(x => x.id === from);
  const d = t ? D.drillFromTemplate(t, id) : newDrill(id, { team: app.team ? app.team.id : '' });
  await app.store.save('drills', { ...d, thumb: t ? t.thumb : await thumbnailSVG(d, frame) });
  location.hash = `#edit/${id}`;
}

export function renderLibrary(app, sub) {
  const root = el('div', { class: 'pp-library' }, el('p', { class: 'muted' }, 'Opening the library…'));
  new Library(app, root, sub).start().catch(e => fill(root, el('div', { class: 'card notice' }, el('p', {}, `The library couldn’t open. ${e.message}`))));
  return root;
}

class Library {
  constructor(app, root, sub) { this.app = app; this.root = root; this.openId = sub || null; this.texts = new Map(); }

  async start() {
    const [drills, prefs, welcomed, layout] = await Promise.all([this.app.store.all('drills'), this.app.store.get('meta', 'library-prefs'), this.app.store.get('meta', 'welcomed'), this.app.store.get('meta', 'library-layout')]);
    this.layout = { pct: 55, expanded: false, ...((layout && layout.value) || {}) };
    this.drills = drills;
    this.f = { ...D.DEFAULT_FILTERS, ...((prefs && prefs.value) || {}) };
    this.welcomed = !!welcomed;
    this.build();
    this.app.cleanup = () => { this.player && this.player.destroy(); };
  }

  saveLayout() { this.app.store.put('meta', { key: 'library-layout', value: this.layout }).catch(() => {}); }

  /** Size the preview (a share of the width, 30–80 %) and expand or collapse it. */
  applyLayout() {
    this.root.style.setProperty('--pv', `${this.layout.pct}%`);
    this.root.classList.toggle('pv-expanded', !!this.layout.expanded);
    this.splitter.setAttribute('aria-valuenow', String(Math.round(this.layout.pct)));
    const b = this.preview.querySelector('#expand-preview');
    if (b) { b.textContent = this.layout.expanded ? '⤡ Show cards' : '⤢ Expand'; b.setAttribute('aria-pressed', String(!!this.layout.expanded)); }
    if (this.player) this.player.draw();
  }

  makeSplitter() {
    const sp = el('div', { class: 'pp-splitter', id: 'splitter', role: 'separator', tabindex: 0, 'aria-orientation': 'vertical', 'aria-label': 'Resize the preview', 'aria-valuemin': 30, 'aria-valuemax': 80 },
      el('span', { class: 'pp-grip', 'aria-hidden': 'true' }));
    const setPct = v => { this.layout.pct = Math.max(30, Math.min(80, v)); this.applyLayout(); };
    sp.addEventListener('pointerdown', e => {
      e.preventDefault(); sp.setPointerCapture(e.pointerId); sp.classList.add('dragging');
      const body = sp.parentElement.getBoundingClientRect();
      const move = ev => setPct((body.right - ev.clientX) / body.width * 100);
      const up = () => { sp.classList.remove('dragging'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); sp.removeEventListener('pointercancel', up); this.saveLayout(); };
      sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up); sp.addEventListener('pointercancel', up);
    });
    sp.addEventListener('keydown', e => {
      const step = { ArrowLeft: 5, ArrowRight: -5, Home: 80, End: 30 }[e.key];
      if (step == null) return;
      e.preventDefault(); setPct(e.key === 'Home' || e.key === 'End' ? step : this.layout.pct + step); this.saveLayout();
    });
    return sp;
  }

  savePrefs() { this.app.store.put('meta', { key: 'library-prefs', value: this.f }).catch(() => {}); }

  build() {
    this.search = el('input', { type: 'search', id: 'search', class: 'grow', placeholder: 'Search drills', 'aria-label': 'Search drills', value: this.f.q,
      oninput: e => { this.f.q = e.target.value; this.savePrefs(); this.renderCards(); } });
    this.filterRow = el('div', { class: 'pp-filters', id: 'filters' });
    this.countLine = el('p', { class: 'muted pp-count', id: 'count', 'aria-live': 'polite' });
    this.grid = el('div', { class: 'pp-cards', id: 'cards' });
    this.preview = el('aside', { class: 'pp-preview card', id: 'preview', 'aria-label': 'Drill preview', hidden: true });
    fill(this.root, 
      el('div', { class: 'screen-head' }, el('h1', { class: 't-title' }, 'Library'), el('span', { class: 'grow' }),
        el('button', { type: 'button', class: 'btn primary', id: 'new-drill-btn', onclick: () => newDrillFlow(this.app) }, '+ New drill')),
      this.welcomed ? null : this.welcomeCard(),
      el('div', { class: 'row pp-searchrow' }, this.search,
        el('label', { class: 'pp-inline' }, el('span', { class: 'sr' }, 'Sort'),
          el('select', { id: 'sort', onchange: e => { this.f.sort = e.target.value; this.savePrefs(); this.renderCards(); } }, ...SORTS.map(([v, l]) => el('option', { value: v, selected: this.f.sort === v }, l))))),
      this.filterRow, this.countLine,
      el('div', { class: 'pp-libbody' }, this.grid, this.splitter = this.makeSplitter(), this.preview));
    this.applyLayout();
    this.renderFilters(); this.renderCards();
    if (this.openId) this.openPreview(this.openId, { scroll: false });
  }

  welcomeCard() {
    const card = el('section', { class: 'card welcome stack', id: 'welcome', 'aria-labelledby': 'welcome-title' },
      el('h2', { class: 't-section', id: 'welcome-title' }, 'Welcome to Practice Pilot'),
      el('p', {}, 'Play a sample drill to see how it works, or tap ', el('b', {}, '+ New drill'), ' to build your own.'),
      el('div', { class: 'row' },
        this.app.installPrompt ? el('button', { type: 'button', class: 'btn primary', id: 'welcome-install', onclick: () => document.getElementById('install-btn').click() }, 'Install Practice Pilot') : null,
        el('button', { type: 'button', class: this.app.installPrompt ? 'btn' : 'btn primary', id: 'welcome-ok', onclick: async () => { await this.app.store.put('meta', { key: 'welcomed', value: new Date().toISOString() }); card.remove(); } }, 'Got it')));
    return card;
  }

  renderFilters() {
    const f = this.f;
    const label = (name, list, all) => (list.length ? `${name}: ${list.map(v => (all.find(([x]) => x === v) || [v, v])[1]).join(', ')}` : name);
    const tagChoices = D.tagsInUse(this.drills).map(t => [t, t]);
    f.tags = f.tags.filter(t => tagChoices.some(([x]) => x === t));
    const btn = (id, name, key, choices, hint) => el('button', { type: 'button', class: 'pp-filter', id, 'aria-pressed': String(f[key].length > 0 && !(key === 'show' && f.show.join() === 'drills')), onclick: () => this.pick(name, key, choices, hint) }, label(name, f[key], choices) + ' ▾');
    fill(this.filterRow, 
      btn('f-tags', 'Tags', 'tags', tagChoices, 'Shows drills with all the tags you pick.'),
      btn('f-ages', 'Age', 'ages', D.AGES.map(a => [a, a])),
      btn('f-levels', 'Level', 'levels', D.LEVELS.map(l => [l, l])),
      btn('f-rinks', 'Rink', 'rinks', RINKS),
      btn('f-show', 'Show', 'show', SHOW),
      D.filtersOn(f) ? el('button', { type: 'button', class: 'btn-link', id: 'clear-filters', onclick: () => this.clear() }, 'Clear filters') : null);
  }

  async pick(name, key, choices, hint) {
    let picked = [...this.f[key]];
    const body = el('div', { class: 'stack' }, hint ? el('p', { class: 'muted', style: 'margin:0' }, hint) : null,
      choices.length ? el('div', { class: 'pp-chipwrap' }, ...choices.map(([v, l]) => el('button', { type: 'button', class: 'pp-tagchip', 'aria-pressed': String(picked.includes(v)),
        onclick: e => { picked = picked.includes(v) ? picked.filter(x => x !== v) : [...picked, v]; e.currentTarget.setAttribute('aria-pressed', String(picked.includes(v))); } }, l)))
        : el('p', { style: 'margin:0' }, 'No drills have tags yet.'));
    const v = await dialog({ id: `pick-${key}`, title: name, body, buttons: [{ label: 'Clear', value: 'clear' }, { label: 'Done', value: 'done', kind: 'primary' }] });
    if (!v) return;
    this.f[key] = v === 'clear' ? (key === 'show' ? ['drills'] : []) : (key === 'show' && !picked.length ? ['drills'] : picked);
    this.savePrefs(); this.renderFilters(); this.renderCards();
  }

  clear() { this.f = { ...D.DEFAULT_FILTERS, sort: this.f.sort }; this.search.value = ''; this.savePrefs(); this.renderFilters(); this.renderCards(); }

  renderCards() {
    const list = D.findDrills(this.drills, this.f, this.texts);
    const total = this.drills.filter(d => D.kindOf(d) === 'drills' || D.kindOf(d) === 'samples').length;
    const bin = this.f.show.includes('deleted');
    this.countLine.textContent = D.filtersOn(this.f) || this.f.show.join() !== 'drills' ? `${list.length} of ${total} drill${total === 1 ? '' : 's'}` : `${list.length} drill${list.length === 1 ? '' : 's'}`;
    if (!list.length) {
      const nothing = !this.drills.some(d => !d.deletedAt);
      fill(this.grid, nothing && !D.filtersOn(this.f)
        ? el('section', { class: 'card empty', id: 'library-empty' }, el('h2', { class: 't-section' }, 'No drills yet'),
          el('p', {}, 'Build your first drill, or bring back the sample drills to see how it works.'),
          el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn primary', onclick: () => newDrillFlow(this.app) }, '+ New drill'),
            el('button', { type: 'button', class: 'btn', id: 'restore-samples-empty', onclick: async () => { await restoreSamples(this.app); this.reload(); } }, 'Restore samples')))
        : el('section', { class: 'card empty', id: 'no-match' }, el('p', {}, bin && !D.filtersOn(this.f) ? 'Recently deleted is empty.' : 'No drills match. Clear filters, or try fewer words.'),
          D.filtersOn(this.f) ? el('button', { type: 'button', class: 'btn', onclick: () => this.clear() }, 'Clear filters') : null));
      return;
    }
    fill(this.grid, ...list.map(d => this.card(d)));
  }

  card(d) {
    const pic = el('div', { class: 'pp-thumb' });
    if (d.thumb) pic.innerHTML = d.thumb; else thumbnailSVG(d, frame).then(s => { pic.innerHTML = s; });
    const tagList = (d.tags || []).slice(0, 2);
    return el('button', { type: 'button', class: 'pp-card card', 'data-id': d.id, 'aria-pressed': String(this.openId === d.id), 'aria-label': `${d.title}. ${D.lengthLabel(d)}`, onclick: () => this.openPreview(d.id) },
      pic,
      el('span', { class: 'pp-card-title' }, d.title),
      el('span', { class: 'pp-pills' },
        d.sample ? el('span', { class: 'pill pp-pill-sample' }, 'Sample') : null,
        d.template ? el('span', { class: 'pill pp-pill-template' }, 'Template') : null,
        ...tagList.map(t => el('span', { class: 'pill' }, t)),
        (d.ageGroups || []).length ? el('span', { class: 'pill pp-pill-age' }, d.ageGroups.join(', ')) : null),
      el('span', { class: 'muted pp-card-meta' }, d.deletedAt ? `Deleted · ${D.daysLeft(d)} days left` : d.schemaVersion > SCHEMA_VERSION ? 'Update to edit' : `Edited ${shortDate(d.updatedAt)}`));
  }

  async reload() { this.drills = await this.app.store.all('drills'); this.texts.clear(); this.renderFilters(); this.renderCards(); if (this.openId) this.openPreview(this.openId, { scroll: false }); }

  openPreview(id, { scroll = true } = {}) {
    const d = this.drills.find(x => x.id === id);
    if (!d) { this.closePreview(); return; }
    this.openId = id;
    if (location.hash !== `#library/${id}`) history.replaceState(null, '', `#library/${id}`);
    for (const c of this.grid.querySelectorAll('.pp-card')) c.setAttribute('aria-pressed', String(c.dataset.id === id));
    this.player && this.player.destroy();
    const host = el('div', { class: 'pp-preview-player' });
    const phone = reviewOnly(), newer = d.schemaVersion > SCHEMA_VERSION;
    const act = (label, idx, fn, kind = '') => el('button', { type: 'button', class: `btn ${kind}`, id: idx, onclick: fn }, label);
    const actions = d.deletedAt
      ? [el('p', { class: 'muted', style: 'margin:0' }, `In Recently deleted: removed for good in ${D.daysLeft(d)} days.`),
        el('div', { class: 'row' }, act('Restore', 'restore-drill', () => this.restore(d), 'primary'), act('Delete forever', 'delete-forever', () => this.deleteForever(d), 'danger'))]
      : [el('div', { class: 'row' },
        newer ? el('span', { class: 'muted' }, 'Update to edit') : el('a', { class: 'btn primary', id: 'edit-drill', href: `#edit/${d.id}` }, d.template ? 'Edit template' : 'Edit'),
        phone || d.template ? null : act('Add to plan', 'add-to-plan', () => this.addToPlan(d)),
        act('Duplicate', 'duplicate-drill', () => this.duplicate(d)),
        act('⋮', 'preview-menu', () => this.menu(d)))];
    fill(this.preview, 
      el('div', { class: 'row pp-preview-head' }, el('h2', { class: 't-section grow', id: 'preview-title' }, d.title),
        phone ? null : el('button', { type: 'button', class: 'btn', id: 'expand-preview', onclick: () => { this.layout.expanded = !this.layout.expanded; this.saveLayout(); this.applyLayout(); } }, '⤢ Expand'),
        el('button', { type: 'button', class: 'btn', id: 'close-preview', 'aria-label': 'Close preview', onclick: () => this.closePreview() }, '✕')),
      host, ...actions, drillInfo(d));
    this.preview.hidden = false;
    this.root.classList.add('has-preview');
    this.applyLayout();
    this.player = new Player(host, d);
    if (phone) document.body.classList.add('pp-noscroll');
    if (scroll && !phone) this.preview.scrollIntoView({ block: 'nearest' });
    this.preview.querySelector('#close-preview').focus({ preventScroll: true });
  }

  closePreview() {
    const id = this.openId;
    this.openId = null; this.preview.hidden = true; this.root.classList.remove('has-preview');
    document.body.classList.remove('pp-noscroll');
    this.player && this.player.destroy(); this.player = null;
    history.replaceState(null, '', '#library');
    for (const c of this.grid.querySelectorAll('.pp-card')) c.setAttribute('aria-pressed', 'false');
    const card = id && this.grid.querySelector(`[data-id="${id}"]`); if (card) card.focus();
  }

  /** Add the drill to the end of a plan: one of the latest plans, or a new one. */
  async addToPlan(d) {
    const plans = findPlans(await this.app.store.all('plans')).slice(0, 6);
    const v = await dialog({ id: 'add-to-plan-dialog', title: `Add “${d.title}” to a plan`, body: el('p', { style: 'margin:0' }, plans.length ? 'It goes at the end of the plan.' : 'You have no plans yet.'),
      buttons: [...plans.map(p => ({ label: [p.title, dayLabel(p.date)].filter(Boolean).join(' · '), value: p.id })), { label: '+ New plan', value: 'new', kind: 'primary' }, { label: 'Cancel', value: null }] });
    if (!v) return;
    let p = v === 'new' ? newPlan(newId('p'), { team: this.app.team ? this.app.team.id : '' }) : plans.find(x => x.id === v);
    p = addBlock(p, drillBlock(newId('bk'), d));
    await this.app.store.save('plans', p);
    toast(`Added to “${p.title}”`, { action: ['Open plan', () => { location.hash = `#plan/${p.id}`; }] });
  }

  async duplicate(d) {
    const c = D.duplicateDrill(d, newId('d'));
    await this.app.store.save('drills', { ...c, thumb: d.thumb });
    if (reviewOnly()) { toast(`“${c.title}” added`); this.openId = c.id; return this.reload(); }
    location.hash = `#edit/${c.id}`;
  }

  async menu(d) {
    const v = await dialog({ id: 'drill-actions', title: d.title, body: el('p', { class: 'muted', style: 'margin:0' }, D.lengthLabel(d)),
      buttons: [{ label: 'Save as template', value: 'tmpl' }, { label: 'Delete', value: 'del', kind: 'danger' }, { label: 'Close', value: null }] });
    if (v === 'tmpl') {
      const t = D.templateFrom(d, newId('d'));
      await this.app.store.save('drills', { ...t, thumb: d.thumb });
      toast('Saved as a template. New drill now offers it.');
      this.reload();
    } else if (v === 'del') {
      await this.app.store.save('drills', { ...d, deletedAt: new Date().toISOString() });
      this.closePreview();
      await this.reload();
      toast(`“${d.title}” moved to Recently deleted`, { action: ['Undo', async () => { const r = await this.app.store.get('drills', d.id); await this.app.store.save('drills', { ...r, deletedAt: null }); this.reload(); }] });
    }
  }

  async restore(d) {
    await this.app.store.save('drills', { ...d, deletedAt: null });
    toast(`“${d.title}” restored`);
    this.reload();
  }

  async deleteForever(d) {
    const v = await dialog({ id: 'confirm-forever', title: 'Delete forever?', body: el('p', { style: 'margin:0' }, `“${d.title}” will be removed from this device. This can’t be undone.`),
      buttons: [{ label: 'Cancel', value: null }, { label: 'Delete forever', value: 'yes', kind: 'danger' }] });
    if (v !== 'yes') return;
    await this.app.store.delete('drills', d.id);
    this.closePreview(); this.reload();
    toast('Deleted');
  }
}
