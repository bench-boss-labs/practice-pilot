/* Plans (R2 Plan Builder deep-dive): the list of practice plans, a preview, and the read-only plan view
   (used by the preview and on phones). */
import { el, fill, toast, dialog } from '../ui.js?v=1.4.0';
import { newId } from '../../vendor/bbl-kit/1.0.1/bbl-store.js';
import * as P from '../plans.js?v=1.4.0';
import { reviewOnly } from './editor.js?v=1.4.0';
import { pubBadge, publishButtons } from './publishui.js?v=1.4.0';

export const KIND_NAMES = { drill: 'Drill', stations: 'Stations', activity: 'Activity' };

/** A drill's saved picture (or an empty frame). */
export function thumb(d, cls = 'pp-thumb') {
  const t = el('div', { class: cls, 'aria-hidden': 'true' });
  if (d && d.thumb) t.innerHTML = d.thumb;
  return t;
}

/** The block's name: its drill's title, "Stations", or the activity. */
export function blockTitle(b, lookup) {
  if (b.kind === 'drill') { const d = lookup(b.drillId); return d ? d.title : 'Drill (deleted)'; }
  if (b.kind === 'stations') return `Stations · ${b.rotate !== false ? `groups rotate every ${b.minutesPerStation} min` : 'groups stay'}`;
  return b.label || 'Activity';
}

/** The plan as a read-only run sheet: times, blocks, helpers, equipment and setup. */
export function planView(p, { lookup, team, onDrill }) {
  const sched = P.schedule(p, team);
  const bud = P.budget(p, team);
  const eq = P.equipment(p, lookup), extra = (p.extraEquipment || []).filter(Boolean);
  const drillLink = d => (onDrill && d ? el('button', { type: 'button', class: 'btn-link pp-drill-link', onclick: () => onDrill(d) }, d.title) : el('span', {}, d ? d.title : 'Drill (deleted)'));
  return el('div', { class: 'stack pp-planview' },
    el('p', { class: 'muted', style: 'margin:0' }, [P.dayLabel(p.date), P.clock(p.startTime), bud.words].filter(Boolean).join(' · ')),
    p.themes ? el('p', { class: 'pp-themes' }, el('b', {}, 'Themes: '), p.themes) : null,
    p.blocks.length ? el('ol', { class: 'pp-runlist' }, ...p.blocks.map((b, i) => {
      const s = sched[i];
      const helpers = b.kind === 'drill' ? b.helpers || [] : [];
      return el('li', { class: `pp-run${s.over ? ' over' : ''}` },
        el('span', { class: 'pp-run-time' }, P.clock(p.startTime, s.start) || P.mmss(s.start)),
        el('div', { class: 'pp-run-body' },
          b.kind === 'drill' ? drillLink(lookup(b.drillId)) : el('b', {}, blockTitle(b, lookup)),
          b.kind === 'stations' ? el('ul', { class: 'pp-run-stations' }, ...b.stations.map(st => el('li', {}, `${st.area ? st.area + ': ' : ''}`, drillLink(lookup(st.drillId)), (st.helpers || []).length ? ` · ${st.helpers.join(', ')}` : ''))) : null,
          helpers.length ? el('span', { class: 'muted' }, `Helpers: ${helpers.join(', ')}`) : null,
          b.note ? el('span', { class: 'muted' }, b.note) : null,
          s.over ? el('span', { class: 'pp-overtag' }, 'Over time') : null),
        el('span', { class: 'pp-run-min' }, `${s.minutes} min`));
    })) : el('p', { class: 'muted' }, 'No blocks yet.'),
    eq.length || extra.length ? el('section', {}, el('h3', { class: 't-label' }, 'Equipment'),
      el('p', { style: 'margin:0' }, [...eq.map(e => `${e.count} ${e.label.toLowerCase()}`), ...extra].join(' · '))) : null,
    p.notes ? el('section', {}, el('h3', { class: 't-label' }, 'Notes'), el('p', { style: 'margin:0' }, p.notes)) : null);
}

/** Create a plan (blank, or from a template) and open it. */
export async function newPlanFlow(app) {
  const templates = (await app.store.all('plans')).filter(p => p.template && !p.deletedAt);
  let from = 'blank';
  if (templates.length) {
    from = await dialog({ id: 'new-plan', title: 'New plan', body: el('p', { style: 'margin:0' }, 'Start blank, or from one of your templates.'),
      buttons: [{ label: 'Blank', value: 'blank', kind: 'primary' }, ...templates.map(t => ({ label: t.title, value: t.id })), { label: 'Cancel', value: null }] });
    if (!from) return null;
  }
  const t = templates.find(x => x.id === from);
  const p = t ? P.planFromTemplate(t, newId('p')) : P.newPlan(newId('p'), { team: app.team ? app.team.id : '' });
  await app.store.save('plans', p);
  location.hash = `#plan/${p.id}`;
  return p;
}

/** Remove plans that have been in Recently deleted for more than 30 days. */
export async function emptyPlanBin(app) {
  const now = Date.now();
  for (const p of await app.store.all('plans')) if (p.deletedAt && now - new Date(p.deletedAt) > 30 * 86400000) await app.store.delete('plans', p.id);
}

export function renderPlans(app, sub) {
  const root = el('div', { class: 'pp-plans' }, el('p', { class: 'muted' }, 'Opening your plans…'));
  new PlansScreen(app, root, sub).start().catch(e => fill(root, el('div', { class: 'card notice' }, el('p', {}, `Your plans couldn’t open. ${e.message}`))));
  return root;
}

class PlansScreen {
  constructor(app, root, sub) { this.app = app; this.root = root; this.openId = sub || null; this.q = ''; this.show = 'plans'; }

  async start() {
    const [plans, drills] = await Promise.all([this.app.store.all('plans'), this.app.store.all('drills')]);
    this.plans = plans; this.drills = new Map(drills.map(d => [d.id, d]));
    this.lookup = id => this.drills.get(id) || null;
    this.build();
  }

  build() {
    this.list = el('div', { class: 'pp-plancards', id: 'plan-cards' });
    this.preview = el('aside', { class: 'pp-preview card', id: 'plan-preview', 'aria-label': 'Plan preview', hidden: true });
    fill(this.root,
      el('div', { class: 'screen-head' }, el('h1', { class: 't-title' }, 'Plans'), el('span', { class: 'grow' }),
        el('button', { type: 'button', class: 'btn primary', id: 'new-plan-btn', onclick: () => newPlanFlow(this.app) }, '+ New plan')),
      el('div', { class: 'row pp-searchrow' },
        el('input', { type: 'search', id: 'plan-search', class: 'grow', placeholder: 'Search plans', 'aria-label': 'Search plans', oninput: e => { this.q = e.target.value; this.renderList(); } }),
        el('label', { class: 'pp-inline' }, el('span', { class: 'sr' }, 'Show'),
          el('select', { id: 'plan-show', onchange: e => { this.show = e.target.value; this.renderList(); } },
            el('option', { value: 'plans' }, 'Plans'), el('option', { value: 'templates' }, 'Templates'), el('option', { value: 'deleted' }, 'Recently deleted')))),
      el('div', { class: 'pp-libbody pp-planbody' }, this.list, this.preview));
    this.renderList();
    if (this.openId) this.open(this.openId);
  }

  renderList() {
    const list = P.findPlans(this.plans, { q: this.q, show: this.show }, this.lookup);
    if (!list.length) {
      fill(this.list, el('section', { class: 'card empty', id: 'plans-empty' },
        el('h2', { class: 't-section' }, this.q ? 'No plans match' : this.show === 'deleted' ? 'Recently deleted is empty' : this.show === 'templates' ? 'No templates yet' : 'No plans yet'),
        this.show === 'plans' && !this.q ? el('p', {}, 'Build a practice from your drills, with stations, helpers, the time it takes and the equipment to bring.') : null,
        this.show === 'plans' && !this.q ? el('button', { type: 'button', class: 'btn primary', onclick: () => newPlanFlow(this.app) }, '+ New plan') : null));
      return;
    }
    fill(this.list, ...list.map(p => {
      const bud = P.budget(p, this.app.team);
      const pics = p.blocks.flatMap(b => P.blockDrills(b, this.lookup)).slice(0, 3);
      return el('button', { type: 'button', class: 'pp-card pp-plancard card', 'data-id': p.id, 'aria-pressed': String(this.openId === p.id), onclick: () => this.open(p.id) },
        el('span', { class: 'pp-plancard-pics' }, ...pics.map(d => thumb(d))),
        el('span', { class: 'pp-card-title' }, p.title),
        pubBadge(this.app, p) ? el('span', { class: 'pp-pills' }, pubBadge(this.app, p)) : null,
        el('span', { class: 'muted pp-card-meta' }, [P.dayLabel(p.date) || 'No date', `${bud.used} of ${bud.ice} min`, `${p.blocks.length} block${p.blocks.length === 1 ? '' : 's'}`].join(' · ')),
        bud.state === 'over' ? el('span', { class: 'pp-overtag' }, `${bud.used - bud.ice} min over`) : null);
    }));
  }

  open(id) {
    const p = this.plans.find(x => x.id === id);
    if (!p) { this.close(); return; }
    this.openId = id;
    if (location.hash !== `#plans/${id}`) history.replaceState(null, '', `#plans/${id}`);
    for (const c of this.list.querySelectorAll('.pp-card')) c.setAttribute('aria-pressed', String(c.dataset.id === id));
    const phone = reviewOnly();
    const btn = (label, idx, fn, kind = '') => el('button', { type: 'button', class: `btn ${kind}`, id: idx, onclick: fn }, label);
    const actions = p.deletedAt
      ? el('div', { class: 'row' }, btn('Restore', 'restore-plan', () => this.restore(p), 'primary'), btn('Delete forever', 'delete-plan-forever', () => this.forever(p), 'danger'))
      : el('div', { class: 'row' },
        phone ? el('span', { class: 'muted' }, 'Edit on a tablet or PC') : el('a', { class: 'btn primary', id: 'edit-plan', href: `#plan/${p.id}` }, p.template ? 'Edit template' : 'Edit'),
        el('a', { class: 'btn', id: 'print-plan', href: `#print/${p.id}` }, 'Print'),
        btn('Duplicate', 'duplicate-plan', () => this.duplicate(p)),
        btn('⋮', 'plan-menu', () => this.menu(p)), ...publishButtons(this.app, 'plans', p, () => this.reload()));
    fill(this.preview,
      el('div', { class: 'row pp-preview-head' }, el('h2', { class: 't-section grow', id: 'plan-preview-title' }, p.title),
        el('button', { type: 'button', class: 'btn', id: 'close-plan-preview', 'aria-label': 'Close preview', onclick: () => this.close() }, '✕')),
      actions,
      planView(p, { lookup: this.lookup, team: this.app.team, onDrill: d => { location.hash = `#library/${d.id}`; } }));
    this.preview.hidden = false;
    this.root.classList.add('has-preview');
    if (phone) document.body.classList.add('pp-noscroll');
  }

  close() {
    this.openId = null; this.preview.hidden = true; this.root.classList.remove('has-preview');
    document.body.classList.remove('pp-noscroll');
    history.replaceState(null, '', '#plans');
    for (const c of this.list.querySelectorAll('.pp-card')) c.setAttribute('aria-pressed', 'false');
  }

  async reload() { this.plans = await this.app.store.all('plans'); this.renderList(); if (this.openId) this.open(this.openId); }

  async duplicate(p) {
    const c = P.duplicatePlan(p, newId('p'));
    await this.app.store.save('plans', c);
    if (reviewOnly()) { toast(`“${c.title}” added`); this.openId = c.id; return this.reload(); }
    location.hash = `#plan/${c.id}`;
  }

  async menu(p) {
    const v = await dialog({ id: 'plan-actions', title: p.title, body: el('p', { class: 'muted', style: 'margin:0' }, P.budget(p, this.app.team).words),
      buttons: [{ label: 'Save as template', value: 'tmpl' }, { label: 'Delete', value: 'del', kind: 'danger' }, { label: 'Close', value: null }] });
    if (v === 'tmpl') { await this.app.store.save('plans', P.planTemplate(p, newId('p'))); toast('Saved as a template. New plan now offers it.'); this.reload(); }
    else if (v === 'del') {
      await this.app.store.save('plans', { ...p, deletedAt: new Date().toISOString() });
      this.close(); await this.reload();
      toast(`“${p.title}” moved to Recently deleted`, { action: ['Undo', async () => { const r = await this.app.store.get('plans', p.id); await this.app.store.save('plans', { ...r, deletedAt: null }); this.reload(); }] });
    }
  }

  async restore(p) { await this.app.store.save('plans', { ...p, deletedAt: null }); toast(`“${p.title}” restored`); this.reload(); }

  async forever(p) {
    const v = await dialog({ id: 'confirm-plan-forever', title: 'Delete forever?', body: el('p', { style: 'margin:0' }, `“${p.title}” will be removed from this device. This can’t be undone.`),
      buttons: [{ label: 'Cancel', value: null }, { label: 'Delete forever', value: 'yes', kind: 'danger' }] });
    if (v !== 'yes') return;
    await this.app.store.delete('plans', p.id); this.close(); this.reload(); toast('Deleted');
  }
}
