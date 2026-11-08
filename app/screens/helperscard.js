/* Settings › This device › Helpers (1.4.3): the team's helpers, moved here from the plan's Share dialog.
   Helpers see every plan shared with the team, on their phone; they can't see drafts or change anything. */
import { el, fill, toast } from '../ui.js?v=1.4.3';
import { signedIn } from '../cloud/team.js?v=1.4.3';
import { listHelpers, addHelper, removeHelper } from '../cloud/sharing.js?v=1.4.3';

const problem = e => (e && e.words) || (e && e.message) || 'Something went wrong.';

export function renderHelpersCard(app) {
  const st = app.cloudState || {};
  if (!st.libraryId || app.helper) return null;
  const status = el('p', { class: 'status-line', id: 'helpers-status', role: 'status', 'aria-live': 'polite' });
  const list = el('div', { class: 'stack', id: 'helpers-list' });
  const email = el('input', { type: 'email', id: 'helper-email', inputmode: 'email', autocomplete: 'off', placeholder: 'helper@gmail.com', 'aria-label': 'Helper’s Google email' });
  const addRow = el('div', { class: 'row', hidden: true }, email, el('button', { type: 'button', class: 'btn', id: 'add-helper', onclick: () => run('Adding…', async () => {
    const e = await addHelper(app, email.value);
    if (e) { email.value = ''; toast(`${e} is a helper. Google emailed them; send them the link from a shared plan too.`); await draw(); }
  }) }, 'Add helper'));
  let busy = false;
  async function run(words, fn) {
    if (busy) return; busy = true; status.textContent = words;
    try { await fn(); status.textContent = ''; } catch (e) { console.warn('helpers', e); status.textContent = problem(e); } finally { busy = false; }
  }
  async function draw() {
    const hs = await listHelpers(app);
    if (!hs) { fill(list, el('p', { class: 'muted', style: 'margin:0' }, 'Pick the team’s shared folder to see its helpers.'), showBtn()); addRow.hidden = true; return; }
    addRow.hidden = false;
    fill(list, hs.length ? el('ul', { class: 'pp-helpers' }, ...hs.map(h => el('li', { class: 'row' },
      el('span', { class: 'grow' }, h.email),
      el('button', { type: 'button', class: 'btn', 'data-remove': h.email, onclick: () => run(`Removing ${h.email}…`, async () => { await removeHelper(app, h.id); toast(`${h.email} is no longer a helper.`); await draw(); }) }, 'Remove'))))
      : el('p', { class: 'muted', style: 'margin:0' }, 'No helpers yet. Add one by their Google email.'));
  }
  const showBtn = () => el('button', { type: 'button', class: 'btn', id: 'show-helpers', onclick: () => run('Opening the team’s shared folder…', draw) }, 'Show helpers');

  if (!signedIn(app)) fill(list, el('p', { class: 'muted', style: 'margin:0' }, 'Sign in to see and add helpers.'));
  else if (st.sharedFolderId) run('Getting the team’s helpers…', draw);
  else fill(list, showBtn());

  return el('section', { class: 'card stack', id: 'helpers-card', 'aria-labelledby': 'helpers-title' },
    el('h2', { class: 't-section', id: 'helpers-title' }, `${st.teamName || 'Team'} helpers`),
    el('p', { class: 'hint', style: 'margin:0' }, 'Helpers see every plan shared with the team, on their phone. They can’t see drafts or change anything. Share a plan from its Share button.'),
    list, addRow, status);
}

/** "3 helpers" for the plan's Share dialog (null when it can't tell yet). */
export async function helperCount(app) {
  try { const hs = await listHelpers(app); return hs ? hs.length : null; } catch { return null; }
}
