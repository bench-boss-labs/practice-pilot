/* Bench Boss Labs kit — the standard Help screen (Product Standards › Help and the full guide). */
import { el, recentReleases, renderReleases, normalizeReleases } from './bbl-updates.js';

/**
 * renderHelp({ app, version, releases, intro, tasks:[{title, text}], questions:[{q, a}],
 *              roles:[{title, show, items:[{title, text}]}], guideUrl })
 * `text`/`a` may be a string or a DOM node. Returns a <section class="help">.
 */
export function renderHelp(o) {
  const all = normalizeReleases(o.releases || []);
  const recent = recentReleases(all, 3);
  const s = el('section', { class: 'help stack', 'aria-labelledby': 'help-title' });
  s.append(el('div', {},
    el('h1', { class: 't-title', id: 'help-title' }, 'Help'),
    el('p', { class: 'muted' }, `${o.app} by Bench Boss Labs · v${o.version}`)));
  if (o.intro) s.append(el('p', {}, o.intro));

  if (recent.length) {
    const card = el('div', { class: 'card', id: 'help-whats-new' }, el('h2', { class: 't-section' }, "What's new"), renderReleases(recent));
    s.append(card);
  }
  if (o.tasks && o.tasks.length) {
    s.append(el('h2', { class: 't-section' }, 'How to'));
    for (const t of o.tasks) s.append(el('div', {}, el('h3', { class: 't-subsection' }, t.title), el('p', {}, t.text)));
  }
  if (o.questions && o.questions.length) {
    s.append(el('h2', { class: 't-section' }, 'Questions'));
    s.append(el('dl', {}, o.questions.map(q => [el('dt', {}, q.q), el('dd', {}, q.a)])));
  }
  for (const r of (o.roles || []).filter(r => r.show !== false)) {
    s.append(el('h2', { class: 't-section' }, r.title));
    for (const t of r.items) s.append(el('div', {}, el('h3', { class: 't-subsection' }, t.title), el('p', {}, t.text)));
  }
  if (o.guideUrl) {
    s.append(el('p', {}, el('a', { class: 'btn outline', href: o.guideUrl, target: '_blank', rel: 'noopener', id: 'help-guide' }, 'Open the full guide')));
  }
  if (all.length) {
    const hist = el('details', { class: 'card', id: 'help-history' },
      el('summary', { class: 't-subsection', style: 'cursor:pointer;min-height:44px;display:flex;align-items:center' }, 'App history'),
      renderReleases(all));
    s.append(hist);
  }
  return s;
}
