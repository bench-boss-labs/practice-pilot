/* Practice Pilot — the club drill library (1.5.1, design deep-dive Nov 8). One file in the Bench Boss Labs
   Practice Pilot folder; every coach is a Viewer on the file (not a folder: the Nov 8 trial) and picks it once.
   Coaches ask for a drill to be added from its Share dialog; the request waits in their team's library file
   until Bench Boss Labs adds or declines it in Admin › Club library. */
import { cloudState, signedIn } from './team.js?v=1.5.1';
import { publishItems, unpublished } from './sync.js?v=1.5.1';
import { CLUB_FILE, CLUB_FOLDER, newClub, checkClub, clubAdd, clubRemove, addRequest, dropRequest, importCopy, checkLibrary, peopleOf } from './library.js?v=1.5.1';
import { loadAdmin, coachesOf } from './admin.js?v=1.5.1';
import { FOLDER } from './drive.js?v=1.5.1';

const CACHE = 'club-cache';
const err = (words, status) => Object.assign(new Error(words), { status, words });
const now = () => new Date().toISOString();
const reach = async (app, id) => { try { return await app.drive.meta(id); } catch (e) { if (e.status === 404 || e.status === 403) return null; throw e; } };

/** Read a library file, change it, write it, and check the change landed (a coach saving at the same moment). */
async function changeLibrary(app, libraryId, change, landed) {
  for (let i = 0; i < 4; i++) {
    const doc = await app.drive.readJson(libraryId);
    if (checkLibrary(doc).length) throw err('The team library file is damaged.');
    await app.drive.writeJson(libraryId, change(doc));
    const back = await app.drive.readJson(libraryId);
    if (landed(back)) return back;
  }
  throw err('Another coach was saving at the same time. Try again in a moment.');
}

/* ---------- a coach asks ---------- */

/** Ask Bench Boss Labs to add a drill to the club library. It is published first if it has to be. → true when sent */
export async function requestClub(app, drillId, { dialog }) {
  const st = await cloudState(app);
  if (!st.libraryId) throw err('Join a team first (Settings › This device).');
  if (!signedIn(app)) throw err('Sign in first (tap “Sign in to sync” at the top).', 401);
  if (unpublished(await app.store.get('drills', drillId))) {
    if (!(await publishItems(app, 'drills', drillId, { dialog }))) return false;
  }
  const req = { drillId, at: now(), by: st.name || st.email || 'a coach', email: st.email || '' };
  await changeLibrary(app, st.libraryId, doc => addRequest(doc, req), doc => (doc.requests || []).some(r => r.drillId === drillId && r.at === req.at));
  return true;
}

/* ---------- a coach browses and imports ---------- */

export async function clubCache(app) { return ((await app.store.get('meta', CACHE)) || {}).value || null; }
const clubId = app => (app.team && app.team.clubFileId) || null;

/** Catch up with the club library. → 'ok' | 'none' (not set up) | 'pick' (pick the file once) | 'offline' | 'signin' */
export async function refreshClub(app) {
  const id = clubId(app);
  if (!id) return 'none';
  if (!signedIn(app)) return 'signin';
  try {
    const doc = await app.drive.readJson(id);
    if (checkClub(doc).length) return 'none';
    await app.store.put('meta', { key: CACHE, value: doc });
    return 'ok';
  } catch (e) {
    if (e.status === 0) return 'offline';
    if (e.status === 401) return 'signin';
    if (e.status === 404 || e.status === 403) return 'pick';
    throw e;
  }
}
/** The one-time step: pick the club library file in Google's picker. */
export async function pickClub(app) {
  const f = await app.google.pick({ kind: 'club', title: `Pick “${CLUB_FILE}” (Shared with me)` });
  if (!f) return null;
  if (f.id !== clubId(app)) throw err(`That isn’t the club library. Pick the file named “${CLUB_FILE}”.`);
  return refreshClub(app);
}
/** Copy a club drill into this coach's Library as a draft. → the new drill */
export async function importClubDrill(app, clubDrill, newId, thumbOf) {
  const at = now();
  const d = importCopy(clubDrill, newId, at);
  if (app.team) d.team = app.team.id;
  const rec = { ...d, thumb: thumbOf ? await thumbOf(d) : undefined };
  if (rec.thumb === undefined) delete rec.thumb;
  await app.store.save('drills', rec);
  return rec;
}

/* ---------- Bench Boss Labs: Admin › Club library ---------- */

/** Open (or make) the club library file, in a "Club library" folder inside Practice Pilot. → { doc, fileId } */
export async function loadClub(app) {
  const { doc: admin, fileId: adminId } = await loadAdmin(app);
  let fileId = admin.clubFileId && await reach(app, admin.clubFileId) ? admin.clubFileId : null;
  if (!fileId) {
    const root = ((await app.drive.meta(adminId)).parents || [])[0] || 'root';
    const folder = (await app.drive.list(root, { name: CLUB_FOLDER, mime: FOLDER }))[0] || await app.drive.createFolder(root, CLUB_FOLDER);
    fileId = (await app.drive.createJson(folder.id, CLUB_FILE, newClub(now()))).id;
    await app.drive.writeJson(adminId, { ...admin, clubFileId: fileId, updatedAt: now() });
  }
  const doc = await app.drive.readJson(fileId);
  if (checkClub(doc).length) throw err('The club library file is damaged.');
  return { doc, fileId };
}
async function changeClub(app, change) {
  const { doc, fileId } = await loadClub(app);
  const next = change(doc);
  await app.drive.writeJson(fileId, next);
  if (app.team && app.team.clubFileId === fileId) await app.store.put('meta', { key: CACHE, value: next });
  return next;
}

/** Requests from every team (live teams only), oldest first: { entry, drill, req }. */
export async function listRequests(app) {
  const { doc } = await loadAdmin(app);
  const out = [];
  for (const entry of doc.teams.filter(t => !t.archived)) {
    let lib;
    try { lib = await app.drive.readJson(entry.libraryId); } catch { continue; }
    for (const req of lib.requests || []) {
      const drill = lib.drills.find(d => d.id === req.drillId);
      if (drill) out.push({ entry, drill, req });
    }
  }
  return out.sort((a, b) => a.req.at.localeCompare(b.req.at));
}
/** Add a requested drill to the club library and clear the request. */
export async function approveRequest(app, { entry, drill, req }) {
  await changeClub(app, doc => clubAdd(doc, drill, { team: entry.name, teamLibraryId: entry.libraryId, by: req.by, email: req.email, requestedAt: req.at }, now()));
  await changeLibrary(app, entry.libraryId, doc => dropRequest(doc, req.drillId), doc => !(doc.requests || []).some(r => r.drillId === req.drillId));
}
export async function declineRequest(app, { entry, req }) {
  await changeLibrary(app, entry.libraryId, doc => dropRequest(doc, req.drillId), doc => !(doc.requests || []).some(r => r.drillId === req.drillId));
}
/** Add one of this device's drills straight in (Bench Boss Labs' own). */
export async function addOwnDrill(app, drill) {
  const st = await cloudState(app);
  await changeClub(app, doc => clubAdd(doc, drill, { team: st.teamName || '', by: st.name || st.email || 'Bench Boss Labs', email: st.email || '' }, now()));
}
export async function removeFromClub(app, drillId) { await changeClub(app, doc => clubRemove(doc, drillId, now())); }

/**
 * Give every coach of every live team access: Viewer on the club file (no email), and the file's id in each
 * team's library so their app finds it. Removed coaches keep access (decided Nov 8). → how many coaches added
 */
export async function shareClub(app) {
  const { fileId } = await loadClub(app);
  const { doc: admin } = await loadAdmin(app);
  const have = new Set(peopleOf(await app.drive.permissions(fileId), 'reader').map(p => p.email));
  let added = 0;
  for (const entry of admin.teams.filter(t => !t.archived)) {
    const lib = await app.drive.readJson(entry.libraryId);
    if (lib.team.clubFileId !== fileId) {
      await changeLibrary(app, entry.libraryId, doc => ({ ...doc, team: { ...doc.team, clubFileId: fileId } }), doc => doc.team.clubFileId === fileId);
    }
    for (const c of await coachesOf(app, entry)) {
      if (have.has(c.email)) continue;
      await app.drive.share(fileId, c.email, 'reader', '', { notify: false });
      have.add(c.email); added++;
    }
  }
  const st = await cloudState(app);
  if (st.libraryId && app.team) { app.team = { ...app.team, clubFileId: fileId }; await app.store.replaceAll('teams', [app.team]); }
  return added;
}
/** Give one coach access (when they're added to a team), if the club library exists. */
export async function shareClubWith(app, email) {
  const { doc: admin } = await loadAdmin(app);
  if (!admin.clubFileId || !(await reach(app, admin.clubFileId))) return false;
  await app.drive.share(admin.clubFileId, email, 'reader', '', { notify: false });
  return true;
}
