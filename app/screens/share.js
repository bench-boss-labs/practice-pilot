/* The Share dialog on a plan (1.4.1, simpler in 1.4.3): share the plan, send helpers the link, stop sharing.
   The team's helpers are managed in Settings › This device › Helpers. */
import { el, fill, toast, dialog } from '../ui.js?v=1.5.2';
import { cloudState } from '../cloud/team.js?v=1.5.2';
import { sharePlan, unsharePlan, sharedIds, helperLink, ensureShared } from '../cloud/sharing.js?v=1.5.2';
import { helperCount } from './helperscard.js?v=1.5.2';

const problem = e => (e && e.words) || (e && e.message) || 'Something went wrong.';

export async function openShare(app, plan, after = () => {}) {
  const st0 = await cloudState(app);
  if (!st0.libraryId) { toast('Join a team first: Settings › This device.', { error: true }); return; }
  const status = el('p', { class: 'status-line', id: 'share-status', role: 'status', 'aria-live': 'polite' });
  const planBox = el('div', { class: 'stack', id: 'share-plan' });
  const helpers = el('p', { class: 'muted', id: 'share-helpers', style: 'margin:0' });
  let busy = false;
  const run = async (words, fn) => {
    if (busy) return; busy = true; status.textContent = words;
    try { await fn(); status.textContent = ''; } catch (e) { console.warn('share', e); status.textContent = problem(e); } finally { busy = false; }
  };
  const link = async () => { const st = await cloudState(app); return helperLink(st, { fileId: st.sharedPlansId, folderId: st.folderId }); };
  const close = () => { const b = document.querySelector('#share-dialog .dfoot .btn'); if (b) b.click(); };

  async function drawHelpers() {
    const n = await helperCount(app);
    fill(helpers, n == null ? '' : n === 0 ? 'No helpers yet · ' : `${n} helper${n === 1 ? '' : 's'} · `,
      el('a', { href: '#settings/helpers', id: 'manage-helpers', onclick: close }, n === 0 ? 'Add helpers' : 'Manage helpers'));
  }
  async function drawPlan() {
    const shared = (await sharedIds(app)).has(plan.id);
    if (!shared) {
      fill(planBox, el('p', { style: 'margin:0' }, `“${plan.title}” isn’t shared yet. Helpers see shared plans on their phone. Sharing publishes it first, with its drills.`),
        el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn primary', id: 'share-plan-btn', onclick: () => run('Sharing…', async () => {
          const l = await sharePlan(app, plan.id, { dialog });
          if (l) { toast(`“${plan.title}” is shared with ${st0.teamName}’s helpers.`); after(); await drawPlan(); }
        }) }, 'Share with helpers')));
      return;
    }
    const url = await link();
    const sendLink = async () => {
      if (navigator.share) { try { await navigator.share({ title: `${st0.teamName} practice plans`, text: `Practice plans for ${st0.teamName} in Practice Pilot`, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
      try { await navigator.clipboard.writeText(url); toast('Link copied. Paste it in a text or email to your helpers.'); }
      catch { const i = document.getElementById('helper-link'); i.hidden = false; i.select(); toast('Select the link and copy it.'); }
    };
    fill(planBox, el('p', { style: 'margin:0' }, el('b', {}, 'Shared with helpers. '), 'Publishing changes updates their copy. Send helpers the link once; it opens every shared plan.'),
      el('input', { type: 'text', id: 'helper-link', readonly: true, value: url, hidden: true, 'aria-label': 'Helper link', onfocus: e => e.target.select() }),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn primary', id: 'send-link', onclick: sendLink }, 'Send link'),
        el('button', { type: 'button', class: 'btn danger', id: 'stop-sharing', onclick: () => run('Stopping…', async () => { await unsharePlan(app, plan.id); toast(`“${plan.title}” is no longer shared.`); after(); await drawPlan(); }) }, 'Stop sharing')));
  }

  const body = el('div', { class: 'stack' }, planBox, helpers, status);
  const shown = dialog({ id: 'share-dialog', title: `Share “${plan.title}”`, body, buttons: [{ label: 'Done', value: null, kind: 'primary' }] });
  run('Opening the team’s shared plans…', async () => {
    const ids = await ensureShared(app);
    if (!ids) { status.textContent = 'Sharing needs the team’s shared-plans file: tap Share again to pick it.'; return; }
    await Promise.all([drawPlan(), drawHelpers()]);
  });
  await shown;
}
