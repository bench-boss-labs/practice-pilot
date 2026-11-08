/* Publish, Discard changes and the Draft badges, shared by the Library, Plans, the editor and the planner (R3). */
import { el, toast, dialog } from '../ui.js?v=1.4.3';
import { pubState, publishItems, discardChanges, othersMark, refreshMarks } from '../cloud/sync.js?v=1.4.3';

export const inTeam = app => !!(app.cloudState && app.cloudState.libraryId);
const state = (app, r) => (inTeam(app) ? pubState(r) : null);
const what = kind => (kind === 'drills' ? 'drill' : 'plan');

export function pubBadge(app, r) {
  const s = state(app, r);
  return s === 'draft' ? el('span', { class: 'pill pp-pill-draft' }, 'Draft') : s === 'changed' ? el('span', { class: 'pill pp-pill-changed' }, 'Unpublished changes') : null;
}
/** Words beside "Saved" in the editor and planner. */
export function pubWords(app, r) {
  const s = state(app, r);
  return s === 'draft' ? 'Draft · only on this device' : s === 'changed' ? 'Unpublished changes' : s === 'published' ? `Published to ${app.cloudState.teamName}` : '';
}
export const canPublish = (app, r) => ['draft', 'changed'].includes(state(app, r));
export const canDiscard = (app, r) => state(app, r) === 'changed';

export async function publishFlow(app, kind, id, { before } = {}) {
  try {
    if (before) await before();
    const r = await publishItems(app, kind, id, { dialog });
    if (!r) return null;
    toast(r.published ? `Published to ${app.cloudState.teamName}.` : r.took.length ? 'You now have the team’s version.' : 'Nothing to publish.');
    return r;
  } catch (e) { console.warn('publish', e); toast(e.words || e.message, { error: true }); return null; }
}

export async function discardFlow(app, kind, r) {
  const v = await dialog({ id: 'discard-confirm', title: 'Discard your changes?', body: `“${r.title}” goes back to the version the team sees. Your unpublished changes are lost.`,
    buttons: [{ label: 'Keep my changes', value: null }, { label: 'Discard changes', value: 'yes', kind: 'danger' }] });
  if (!v) return false;
  try { await discardChanges(app, kind, r.id); toast('Back to the team’s version.'); return true; }
  catch (e) { toast(e.words || e.message, { error: true }); return false; }
}

/** Publish (and Discard) buttons for a Library or Plans preview. after() redraws. */
export function publishButtons(app, kind, r, after) {
  const one = what(kind);
  const out = [];
  if (canPublish(app, r)) out.push(el('button', { type: 'button', class: 'btn primary', id: `publish-${one}`, onclick: async () => { if (await publishFlow(app, kind, r.id)) after(); } }, pubState(r) === 'draft' ? 'Publish to team' : 'Publish changes'));
  if (canDiscard(app, r)) out.push(el('button', { type: 'button', class: 'btn', id: `discard-${one}`, onclick: async () => { if (await discardFlow(app, kind, r)) after(); } }, 'Discard changes'));
  return out;
}

/** A heads-up when another coach has unpublished changes to what you're opening. */
export async function warnMark(app, kind, id) {
  await refreshMarks(app);
  const m = await othersMark(app, id);
  if (m) toast(`${m.name} has unpublished changes to this ${what(kind)} (since ${new Date(m.since).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}). You can still change it: Publish checks before saving over anything.`, { ms: 9000, scoped: true });
}
