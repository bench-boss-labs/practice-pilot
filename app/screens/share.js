/* The Share dialog on a plan (1.4.1): the team's helpers (add, remove) and this plan's sharing (share, link, stop). */
import { el, fill, toast, dialog } from '../ui.js?v=1.4.1';
import { cloudState } from '../cloud/team.js?v=1.4.1';
import { sharePlan, unsharePlan, sharedIds, listHelpers, addHelper, removeHelper, helperLink, ensureShared } from '../cloud/sharing.js?v=1.4.1';

const problem = e => (e && e.words) || (e && e.message) || 'Something went wrong.';

export async function openShare(app, plan, after = () => {}) {
  const st0 = await cloudState(app);
  if (!st0.libraryId) { toast('Join a team first: Settings › This device.', { error: true }); return; }
  const status = el('p', { class: 'status-line', id: 'share-status', role: 'status', 'aria-live': 'polite' });
  const helpersBox = el('div', { class: 'stack', id: 'helpers-list' }, el('p', { class: 'muted', style: 'margin:0' }, 'Getting the team’s helpers…'));
  const planBox = el('div', { class: 'stack', id: 'share-plan' });
  const email = el('input', { type: 'email', id: 'helper-email', inputmode: 'email', autocomplete: 'off', placeholder: 'helper@gmail.com', 'aria-label': 'Helper’s Google email' });
  let busy = false;
  const run = async (words, fn) => {
    if (busy) return; busy = true; status.textContent = words;
    try { await fn(); status.textContent = ''; } catch (e) { console.warn('share', e); status.textContent = problem(e); } finally { busy = false; }
  };
  const link = async () => { const st = await cloudState(app); return helperLink(st, { fileId: st.sharedPlansId, folderId: st.sharedFolderId }); };

  async function drawHelpers() {
    const hs = await listHelpers(app);
    if (!hs) { fill(helpersBox, el('p', { class: 'muted', style: 'margin:0' }, 'Pick the team’s shared folder to see its helpers.')); return; }
    fill(helpersBox, hs.length ? el('ul', { class: 'pp-helpers' }, ...hs.map(h => el('li', { class: 'row' },
      el('span', { class: 'grow' }, h.email),
      el('button', { type: 'button', class: 'btn', 'data-remove': h.email, onclick: () => run(`Removing ${h.email}…`, async () => { await removeHelper(app, h.id); toast(`${h.email} is no longer a helper.`); await drawHelpers(); }) }, 'Remove'))))
      : el('p', { class: 'muted', style: 'margin:0' }, 'No helpers yet. Add one by their Google email.'));
  }
  async function drawPlan() {
    const shared = (await sharedIds(app)).has(plan.id);
    if (!shared) {
      fill(planBox, el('p', { style: 'margin:0' }, `“${plan.title}” isn’t shared yet. Sharing publishes it first, with its drills.`),
        el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn primary', id: 'share-plan-btn', onclick: () => run('Sharing…', async () => {
          const l = await sharePlan(app, plan.id, { dialog });
          if (l) { toast(`“${plan.title}” is shared with ${st0.teamName}’s helpers.`); after(); await drawPlan(); }
        }) }, 'Share with helpers')));
      return;
    }
    const url = await link();
    fill(planBox, el('p', { style: 'margin:0' }, el('b', {}, 'Shared with helpers. '), 'Publishing changes updates their copy. Send helpers this link once; it opens every shared plan.'),
      el('input', { type: 'text', id: 'helper-link', readonly: true, value: url, 'aria-label': 'Helper link', onfocus: e => e.target.select() }),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn primary', id: 'copy-link', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch { document.getElementById('helper-link').select(); toast('Select the link and copy it.'); } } }, 'Copy link'),
        navigator.share ? el('button', { type: 'button', class: 'btn', id: 'send-link', onclick: () => navigator.share({ title: `${st0.teamName} practice plans`, text: `Practice plans for ${st0.teamName} in Practice Pilot`, url }).catch(() => {}) }, 'Send') : null,
        el('button', { type: 'button', class: 'btn danger', id: 'stop-sharing', onclick: () => run('Stopping…', async () => { await unsharePlan(app, plan.id); toast(`“${plan.title}” is no longer shared.`); after(); await drawPlan(); }) }, 'Stop sharing')));
  }

  const body = el('div', { class: 'stack' },
    el('section', { class: 'stack' }, el('h3', { class: 't-label' }, `${st0.teamName}’s helpers`), helpersBox,
      el('div', { class: 'row' }, email, el('button', { type: 'button', class: 'btn', id: 'add-helper', onclick: () => run('Adding…', async () => {
        const e = await addHelper(app, email.value);
        if (e) { email.value = ''; toast(`${e} is a helper. Google emailed them; send them the link too.`); await drawHelpers(); }
      }) }, 'Add helper')),
      el('p', { class: 'hint', style: 'margin:0' }, 'Helpers see every plan shared with the team, on their phone. They can’t see drafts or change anything.')),
    el('section', { class: 'stack' }, el('h3', { class: 't-label' }, 'This plan'), planBox),
    status);
  const shown = dialog({ id: 'share-dialog', title: `Share “${plan.title}”`, body, buttons: [{ label: 'Done', value: null, kind: 'primary' }] });
  run('Opening the team’s shared folder…', async () => { const ids = await ensureShared(app); if (!ids) { status.textContent = 'Sharing needs the team’s shared folder: tap Share again to pick it.'; return; } await Promise.all([drawHelpers(), drawPlan()]); });
  await shown;
}
