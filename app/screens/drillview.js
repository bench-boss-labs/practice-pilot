/* A drill's details for reading: used by the library preview and the phone view of the editor. */
import { el } from '../ui.js?v=1.5.1';
import { lengthLabel, videoLink, agesOf } from '../drills.js?v=1.5.1';

export function pills(d) {
  return el('div', { class: 'pp-pills' },
    d.sample ? el('span', { class: 'pill pp-pill-sample' }, 'Sample') : null,
    d.template ? el('span', { class: 'pill pp-pill-template' }, 'Template') : null,
    ...(d.tags || []).map(t => el('span', { class: 'pill' }, t)),
    agesOf(d).length ? el('span', { class: 'pill pp-pill-age' }, agesOf(d).join(', ')) : null,
    d.level ? el('span', { class: 'pill pp-pill-level' }, d.level) : null);
}

/** Description, tags, coaching points, goalie notes and video links. */
export function drillInfo(d) {
  const points = (d.coachingPoints || []).filter(p => p.trim());
  const setup = (d.setupNotes || []).filter(p => p.trim());
  const links = (d.videoLinks || []).map(l => (typeof l === 'string' ? videoLink(l) : l)).filter(Boolean);
  return el('div', { class: 'stack pp-info' },
    el('p', { class: 'muted pp-length' }, lengthLabel(d)),
    d.description ? el('p', { class: 'pp-desc' }, d.description) : null,
    pills(d),
    setup.length ? el('section', { id: 'setup-notes' }, el('h3', { class: 't-label' }, 'Setup'), el('ol', { class: 'pp-points' }, ...setup.map(p => el('li', {}, p)))) : null,
    points.length ? el('section', {}, el('h3', { class: 't-label' }, 'Coaching points'), el('ol', { class: 'pp-points' }, ...points.map(p => el('li', {}, p)))) : null,
    d.goalieNotes ? el('section', {}, el('h3', { class: 't-label' }, 'Goalie notes'), el('p', {}, d.goalieNotes)) : null,
    links.length ? el('section', {}, el('h3', { class: 't-label' }, 'Videos'),
      el('div', { class: 'row' }, ...links.map(l => el('a', { class: 'btn outline', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, `▶ ${l.site}`)))) : null);
}
