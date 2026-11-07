/* Practice Pilot — sharing plans with helpers (1.4.1 deep-dive, decided Nov 6).
   One shared-plans file in the team's `shared` folder holds each shared plan with copies of its drills.
   Helpers are Viewers on the `shared` folder, and pick it once on their phone. */
import { SHARED_FOLDER, newShared, checkShared, shareInto, unshareFrom, staleShared, planDrillIds, sharedName } from './library.js?v=1.4.2';
import { cloudState, setState, signedIn, pushChanges } from './team.js?v=1.4.2';
import { publishItems, unpublished } from './sync.js?v=1.4.2';

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
 * Make sure this coach's app can reach the team's `shared` folder and its shared-plans file. The first time a
 * coach shares, Google's picker opens on the folder (one tap). → { folderId, fileId }
 */
export async function ensureShared(app) {
  const st = await cloudState(app);
  if (!st.libraryId) throw err('Join a team first (Settings › This device).');
  if (!signedIn(app)) throw err('Sign in to share (tap “Sign in to sync” at the top).', 401);
  const team = await libTeam(app);
  let folderId = team.sharedFolderId || st.sharedFolderId || null;
  const reach = async id => { try { await app.drive.meta(id); return true; } catch (e) { if (e.status === 404 || e.status === 403) return false; throw e; } };
  if (!folderId && st.folderId) {            // the account that set up the team made it: it can list it
    try { const f = (await app.drive.list(st.folderId, { name: SHARED_FOLDER }))[0]; if (f) folderId = f.id; } catch {}
  }
  if (!folderId || !(await reach(folderId))) {
    const f = await app.google.pick({ kind: 'shared', folderId, title: `Pick the “shared” folder in ${st.teamName}` });
    if (!f) return null;
    const meta = await app.drive.meta(f.id);
    if (meta.name !== SHARED_FOLDER || (folderId && f.id !== folderId)) throw err(`That isn’t ${st.teamName}’s shared folder. Pick the folder named “shared” inside ${st.folderName || st.teamName}.`);
    folderId = f.id;
  }
  let fileId = team.sharedPlansId || null;
  if (fileId && !(await reach(fileId))) fileId = null;
  if (!fileId) {
    const name = sharedName(st.teamName);
    const found = (await app.drive.list(folderId, { name }))[0];
    fileId = found ? found.id : (await app.drive.createJson(folderId, name, newShared({ team: { name: st.teamName }, by: by(st), at: new Date().toISOString() }))).id;
  }
  if (team.sharedFolderId !== folderId || team.sharedPlansId !== fileId) {
    const back = await pushChanges(app, { team: { ...app.team, sharedFolderId: folderId, sharedPlansId: fileId } });
    await app.store.put('meta', { key: 'library-cache', value: back });
  }
  await setState(app, { sharedFolderId: folderId, sharedPlansId: fileId });
  return { folderId, fileId };
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
  const fileId = st.sharedPlansId || ((await libTeam(app)).sharedPlansId);
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
  const fileId = st.sharedPlansId || ((await libTeam(app)).sharedPlansId);
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
  const st = await cloudState(app);
  const ps = await app.drive.permissions(ids.folderId);
  return ps.filter(p => p.type === 'user' && p.role === 'reader' && p.emailAddress && p.emailAddress !== st.email).map(p => ({ id: p.id, email: p.emailAddress, name: p.displayName || '' }));
}
export async function addHelper(app, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw err('Type the helper’s Google email address.');
  const ids = await ensureShared(app);
  if (!ids) return null;
  const st = await cloudState(app);
  await app.drive.share(ids.folderId, e, 'reader', MESSAGE(st.teamName));
  return e;
}
export async function removeHelper(app, permissionId) {
  const ids = await ensureShared(app);
  if (ids) await app.drive.unshare(ids.folderId, permissionId);
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
/** The helper's one-time step: pick the team's shared folder in Google's picker. */
export async function helperPick(app) {
  const h = await helperState(app);
  const f = await app.google.pick({ kind: 'shared', folderId: h.folderId, title: `Pick the “shared” folder (Shared with me › ${h.teamName || 'your team'} › shared)` });
  if (!f) return null;
  if (h.folderId && f.id !== h.folderId) throw err(`That isn’t ${h.teamName || 'the team'}’s shared folder. Pick the folder named “shared” inside ${h.teamName || 'the team’s folder'}.`);
  await setHelper(app, { ...h, picked: true });
  return helperLoad(app);
}
