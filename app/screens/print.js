/* Printout (R2): page 1 is the run sheet; then a card per drill with its picture, purpose, setup,
   coaching points, who runs it and the block's note, about two cards a page. Chrome prints it or saves a PDF. */
import { el, fill } from '../ui.js?v=1.3.0';
import * as P from '../plans.js?v=1.3.0';
import { blockTitle } from './plans.js?v=1.3.0';

export function renderPrint(app, id) {
  const root = el('div', { class: 'pp-print-screen' }, el('p', { class: 'muted' }, 'Getting the plan ready to print…'));
  build(app, id, root).catch(e => fill(root, el('div', { class: 'card notice' }, el('p', {}, `This plan couldn’t be printed. ${e.message}`))));
  return root;
}

const pic = d => { const t = el('div', { class: 'pp-print-pic' }); if (d && d.thumb) t.innerHTML = d.thumb; return t; };
const list = (title, items, ordered = true) => (items.length ? el('div', { class: 'pp-print-sec' }, el('h4', {}, title), el(ordered ? 'ol' : 'ul', {}, ...items.map(x => el('li', {}, x)))) : null);

/** One card per drill (a station block gives one card per station). */
function cards(p, lookup, sched) {
  const out = [];
  p.blocks.forEach((b, i) => {
    const s = sched[i];
    const start = P.clock(p.startTime, s.start) || P.mmss(s.start);
    const time = b.kind === 'stations' && b.rotate !== false ? `${start} · ${b.minutesPerStation} min each` : `${start} · ${s.minutes} min`;
    const one = (d, { label, helpers = [], note = '', area = '' }) => el('article', { class: 'pp-pcard' },
      el('header', {}, el('span', { class: 'pp-pcard-time' }, time), el('h3', {}, d ? d.title : 'Drill (deleted)'), label ? el('span', { class: 'pp-pcard-label' }, label) : null),
      el('div', { class: 'pp-pcard-body' },
        pic(d),
        el('div', { class: 'pp-pcard-text' },
          helpers.length || area ? el('p', { class: 'pp-pcard-who' }, [area && `Where: ${area}`, helpers.length && `Run by: ${helpers.join(', ')}`].filter(Boolean).join(' · ')) : null,
          d && d.description ? el('p', {}, el('b', {}, 'Purpose: '), d.description) : null,
          list('Setup', d ? (d.setupNotes || []).filter(x => x.trim()) : []),
          list('Coaching points', d ? (d.coachingPoints || []).filter(x => x.trim()) : []),
          d && d.goalieNotes ? el('p', {}, el('b', {}, 'Goalie: '), d.goalieNotes) : null,
          note ? el('p', {}, el('b', {}, 'Tonight: '), note) : null)));
    if (b.kind === 'drill') out.push(one(lookup(b.drillId), { helpers: b.helpers || [], note: b.note }));
    else if (b.kind === 'stations') b.stations.forEach((st, k) => out.push(one(lookup(st.drillId), { label: `Station ${k + 1} of ${b.stations.length}${b.rotate !== false ? ' · groups rotate' : ''}`, helpers: st.helpers || [], area: st.area, note: k === 0 ? b.note : '' })));
  });
  return out;
}

async function build(app, id, root) {
  const [p, drills] = await Promise.all([app.store.get('plans', id), app.store.all('drills')]);
  if (!p) { fill(root, el('div', { class: 'card notice' }, el('p', {}, 'That plan isn’t here.'), el('a', { class: 'btn', href: '#plans' }, 'Back to Plans'))); return; }
  const map = new Map(drills.map(d => [d.id, d])), lookup = x => map.get(x) || null;
  const team = app.team, sched = P.schedule(p, team), bud = P.budget(p, team);
  const eq = P.equipment(p, lookup), extra = (p.extraEquipment || []).filter(Boolean);
  const cardList = cards(p, lookup, sched);
  const pages = 1 + Math.ceil(cardList.length / 2);

  const sheet = el('section', { class: 'pp-sheet' },
    el('header', { class: 'pp-sheet-head' },
      el('div', {}, el('p', { class: 'pp-sheet-team' }, team ? team.name : ''), el('h2', {}, p.title)),
      el('p', { class: 'pp-sheet-when' }, [P.dayLabel(p.date), P.clock(p.startTime), `${bud.ice} min of ice`, `${bud.used} min planned`].filter(Boolean).join(' · '))),
    p.themes ? el('p', { class: 'pp-sheet-themes' }, el('b', {}, 'Themes: '), p.themes) : null,
    el('table', { class: 'pp-sheet-table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Time'), el('th', {}, 'Min'), el('th', {}, 'Block'), el('th', {}, 'Who'))),
      el('tbody', {}, ...p.blocks.map((b, i) => {
        const s = sched[i];
        const who = b.kind === 'stations' ? b.stations.map(st => (st.helpers || []).join(', ')).filter(Boolean).join(' / ') : (b.helpers || []).join(', ');
        return el('tr', { class: s.over ? 'over' : '' },
          el('td', {}, P.clock(p.startTime, s.start) || P.mmss(s.start)), el('td', {}, String(s.minutes)),
          el('td', {}, el('b', {}, blockTitle(b, lookup)),
            b.kind === 'stations' ? el('ul', {}, ...b.stations.map(st => { const d = lookup(st.drillId); return el('li', {}, `${st.area ? st.area + ': ' : ''}${d ? d.title : 'Drill (deleted)'}`); })) : null,
            b.note ? el('div', { class: 'pp-sheet-note' }, b.note) : null,
            s.over ? el('div', { class: 'pp-sheet-note' }, 'Over time') : null),
          el('td', {}, who));
      }))),
    eq.length || extra.length ? el('div', { class: 'pp-print-sec' }, el('h4', {}, 'Equipment'), el('p', {}, [...eq.map(e => `${e.count} ${e.label.toLowerCase()}`), ...extra].join(' · '))) : null,
    p.notes ? el('div', { class: 'pp-print-sec' }, el('h4', {}, 'Notes'), el('p', {}, p.notes)) : null);

  fill(root,
    el('div', { class: 'pp-printbar row' },
      el('a', { class: 'btn', href: `#plan/${p.id}`, id: 'print-back' }, '‹ Back to the plan'),
      el('span', { class: 'grow muted', id: 'print-pages' }, `About ${pages} page${pages === 1 ? '' : 's'}: the run sheet, then a card for each drill. In the print screen, pick Save as PDF to keep or send it.`),
      el('button', { type: 'button', class: 'btn primary', id: 'print-now', onclick: () => print() }, 'Print')),
    el('div', { class: 'pp-printpage', id: 'printout' }, sheet, cardList.length ? el('section', { class: 'pp-cardpages' }, ...cardList) : null));
  document.title = `${p.title} · Practice Pilot`;
}
