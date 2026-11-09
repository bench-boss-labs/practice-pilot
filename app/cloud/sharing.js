/* Practice Pilot — sharing plans with helpers (1.4.1 deep-dive, decided Nov 6; reworked in 1.5.0).
   One shared-plans file beside the team's library file holds each shared plan with copies of its drills.
   Helpers are Viewers on that file (not a folder: the Nov 8 trial), and pick it once on their phone. */
import { peopleOf, validEmail, newShared, checkShared, shareInto, unshareFrom, staleShared, planDrillIds, sharedName } from './library.js?v=1.5.3';
import { cloudState, setState, signedIn, pushChanges } from './team.js?v=1.5.3';
import { GUIDES } from '../guides.js?v=1.5.3';
import { publishItems, unpublished } from './sync.js?v=1.5.3';

const CACHE = 'shared-cache';
export const HELPER = 'helper';
const MESSAGE = team => `You’re a helper for ${team}. Open the link the coach sends you on your phone to see practice plans in Practice Pilot.`;
const by = st => st.name || st.email || 'a coach';
const err = (words, status) => Object.assign(new Error(words), { status, words });

/* ---------- the coach's side ---------- */

async function libTeam(app) { const c = (await app.store.get('meta', 'library-cache')) || {}; return (c.value && c.value.team) || {}; }
export async function sharedCache(app) { return ((await app.store.get('meta', CACHE)) || {}).value || null; }
async function keep(app, doc) { await app.store.put('meta', { key: CACHE, value: doc }); return doc; }
/** Ids of the plans shared with helpers (from this device's last look). */
export async function sharedIds(app) { const d = await sharedCache(app); return new Set(d ? d.plans.map(e => e.plan.id) : []); }

/**
 * Make sure this coach's app can open the team's shared-plans file. Since 1.5.0 it sits beside the library file
 * in the team folder, and helpers are shared on the file itself (the Nov 8 trial: picking a folder does not open
 * the files inside it). A coach who didn't pick it when joining picks it once here. → { fileId, folderId }
 */
export async function ensureShared(app) {
  const st = await cloudState(app);
  if (!st.libraryId) throw err('Join a team first (Settings › This device).');
  if (!signedIn(app)) throw err('Sign in to share (tap “Sign in to sync” at the top).', 401);
  const team = await libTeam(app);
  const reach = async id => { try { await app.drive.meta(id); return true; } catch (e) { if (e.status === 404 || e.status === 403) return false; throw e; } };
  let fileId = team.sharedPlansId || (app.team && app.team.sharedPlansId) || st.sharedPlansId || null;
  if (fileId && !(await reach(fileId))) {
    const f = await app.google.pick({ kind: 'plans', folderId: st.folderId, title: `Pick “${sharedName(st.teamName)}” in ${st.teamName}` });
    if (!f) return null;
    if (f.id !== fileId) throw err(`That isn’t ${st.teamName}’s shared-plans file. Pick “${sharedName(st.teamName)}”.`);
  }
  if (!fileId) {
    // the team has no shared-plans file yet: the account that owns the team folder makes it
    try { fileId = (await app.drive.createJson(st.folderId, sharedName(st.teamName), newShared({ team: { name: st.teamName }, by: by(st), at: new Date().toISOString() }))).id; }
    catch (e) { if (e.status === 404 || e.status === 403) throw err(`Sharing isn’t set up for ${st.teamName} yet. Ask Bench Boss Labs to open the team in Admin.`); throw e; }
    const back = await pushChanges(app, { team: { ...app.team, sharedPlansId: fileId } });
    await app.store.put('meta', { key: 'library-cache', value: back });
  }
  await setState(app, { sharedPlansId: fileId });
  return { fileId, folderId: st.folderId };
}

/** Change the shared-plans file, checking afterwards that the change landed (another coach saving at once). */
async function changeShared(app, fileId, change, landedFn) {
  for (let i = 0; i < 4; i++) {
    const doc = await app.drive.readJson(fileId);
    const bad = checkShared(doc);
    if (bad.length) throw err(bad[0] === 'newer' ? 'Update Practice Pilot to share: the shared plans were saved by a newer version.' : 'The shared-plans file is damaged.');
    const at = new Date(Date.now() + i).toISOString();
    await app.drive.writeJson(fileId, change(doc, at));
    const back = await app.drive.readJson(fileId);
    if (landedFn(back, at)) return keep(app, back);
  }
  throw err('Another coach was sharing at the same time. Try again in a moment.');
}

async function entryFor(app, planId) {
  const plan = await app.store.get('plans', planId);
  const drills = [];
  for (const id of planDrillIds(plan)) { const d = await app.store.get('drills', id); if (d) drills.push(d); }
  return { plan, drills };
}

/** Share a plan with the team's helpers (publishing it first if needed). → the helper link, or null if cancelled. */
export async function sharePlan(app, planId, { dialog }) {
  const ids = await ensureShared(app);
  if (!ids) return null;
  const plan = await app.store.get('plans', planId);
  if (unpublished(plan) || (await Promise.all(planDrillIds(plan).map(id => app.store.get('drills', id)))).some(unpublished)) {
    const r = await publishItems(app, 'plans', planId, { dialog, quietShare: true });
    if (!r) return null;
  }
  const st = await cloudState(app);
  const { plan: p, drills } = await entryFor(app, planId);
  await changeShared(app, ids.fileId, (doc, at) => shareInto(doc, p, drills, by(st), at), (doc, at) => doc.plans.some(e => e.plan.id === planId && e.sharedAt === at));
  return helperLink(st, ids);
}
export async function unsharePlan(app, planId) {
  const ids = await ensureShared(app);
  if (!ids) return;
  const st = await cloudState(app);
  await changeShared(app, ids.fileId, (doc, at) => unshareFrom(doc, planId, by(st), at), doc => !doc.plans.some(e => e.plan.id === planId));
}

/** After Publish: update the helpers' copies of shared plans that changed or use a changed drill; drop deleted ones. */
export async function afterPublish(app, changes) {
  const st = await cloudState(app);
  const fileId = st.sharedPlansId || ((await libTeam(app)).sharedPlansId) || (app.team && app.team.sharedPlansId);
  if (!fileId) return;
  const cache = (await sharedCache(app)) || (await refreshShared(app));
  if (!cache) return;
  const gone = new Set([...(changes.gone || []), ...(changes.plans || []).filter(p => p.deletedAt).map(p => p.id)]);
  const doc = cache || { plans: [] };
  const stale = staleShared(doc, changes).filter(id => !gone.has(id));
  const dropping = doc.plans.filter(e => gone.has(e.plan.id)).map(e => e.plan.id);
  if (!stale.length && !dropping.length) return;
  const entries = await Promise.all(stale.map(id => entryFor(app, id)));
  await changeShared(app, fileId, (d, at) => {
    let n = d;
    for (const id of dropping) n = unshareFrom(n, id, by(st), at);
    for (const e of entries) if (e.plan && n.plans.some(x => x.plan.id === e.plan.id)) n = shareInto(n, e.plan, e.drills, by(st), at);
    return { ...n, updatedAt: at };
  }, (d, at) => d.updatedAt === at);
}

/** Refresh this device's copy of what's shared (for the "Shared with helpers" labels). */
export async function refreshShared(app) {
  const st = await cloudState(app);
  const fileId = st.sharedPlansId || ((await libTeam(app)).sharedPlansId) || (app.team && app.team.sharedPlansId);
  if (!fileId || !signedIn(app)) return null;
  try { const doc = await app.drive.readJson(fileId); return checkShared(doc).length ? null : keep(app, doc); } catch { return null; }
}

export function helperLink(st, ids) {
  const base = typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : 'https://bench-boss-labs.github.io/practice-pilot/';
  return `${base}#join/${ids.fileId}/${ids.folderId}/${encodeURIComponent(st.teamName || '')}`;
}

/* ---------- the team's helpers ---------- */

export async function listHelpers(app) {
  const ids = await ensureShared(app);
  if (!ids) return null;
  return peopleOf(await app.drive.permissions(ids.fileId), 'reader');
}
export async function addHelper(app, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!validEmail(e)) throw err('Type the helper’s Google email address.');
  const ids = await ensureShared(app);
  if (!ids) return null;
  const st = await cloudState(app);
  await app.drive.share(ids.fileId, e, 'reader', `${MESSAGE(st.teamName)} ${helperLink(st, ids)} Quick start guide: ${GUIDES.helperQuickStart}`);
  return e;
}
export async function removeHelper(app, permissionId) {
  const ids = await ensureShared(app);
  if (ids) await app.drive.unshare(ids.fileId, permissionId);
}

/* ---------- the helper's side ---------- */

export async function helperState(app) { return ((await app.store.get('meta', HELPER)) || {}).value || null; }
export async function setHelper(app, v) { if (v) await app.store.put('meta', { key: HELPER, value: v }); else { await app.store.delete('meta', HELPER); await app.store.delete('meta', 'helper-cache'); } app.helper = v; return v; }
export async function helperCache(app) { return ((await app.store.get('meta', 'helper-cache')) || {}).value || null; }

/**
 * A helper's phone catches up: read the shared plans; with no signal, keep the last copy.
 * → { doc, state: 'ok' | 'offline' | 'pick' | 'gone' | 'signin' }
 */
export async function helperLoad(app) {
  const h = await helperState(app);
  if (!h) return { doc: null, state: 'none' };
  const cached = await helperCache(app);
  if (!signedIn(app)) return { doc: cached, state: 'signin' };
  try {
    const doc = await app.drive.readJson(h.fileId);
    if (checkShared(doc).length) return { doc: cached, state: 'gone' };
    await app.store.put('meta', { key: 'helper-cache', value: doc });
    await setHelper(app, { ...h, savedAt: new Date().toISOString(), teamName: doc.team.name || h.teamName });
    return { doc, state: 'ok' };
  } catch (e) {
    if (e.status === 0) return { doc: cached, state: 'offline' };
    if (e.status === 401) return { doc: cached, state: 'signin' };
    if (e.status === 404 || e.status === 403) {
      if (!h.picked) return { doc: null, state: 'pick' };
      await app.store.delete('meta', 'helper-cache');     // removed as a helper: the saved plans go too
      return { doc: null, state: 'gone' };
    }
    throw e;
  }
}
/** The helper's one-time step: pick the team's shared-plans file in Google's picker. */
export async function helperPick(app) {
  const h = await helperState(app);
  const f = await app.google.pick({ kind: 'plans', folderId: h.folderId, title: `Pick “${sharedName(h.teamName)}” (Shared with me)` });
  if (!f) return null;
  if (f.id !== h.fileId) throw err(`That isn’t ${h.teamName || 'the team'}’s plans. Pick the file named “${sharedName(h.teamName)}”.`);
  await setHelper(app, { ...h, picked: true });
  return helperLoad(app);
}
