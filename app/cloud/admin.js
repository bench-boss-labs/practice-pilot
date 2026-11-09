/* Practice Pilot — Admin (1.5.0, design deep-dive Nov 8): the Bench Boss Labs account sets teams up end to end.
   One admin file lists the teams; each team is a folder with its library file and shared-plans file side by side.
   Coaches are Editors on the team folder and pick both files once; helpers are Viewers on the shared-plans file. */
import { APP_VERSION } from '../version.js?v=1.5.4';
import { FOLDER } from './drive.js?v=1.5.4';
import { GUIDES } from '../guides.js?v=1.5.4';
import { cloudState, setState, applyLibrary } from './team.js?v=1.5.4';
import { ADMIN_FILE, ROOT_FOLDER, newAdmin, checkAdmin, putTeam, peopleOf, validEmail, isAdmin, libraryName, sharedName,
  newLibrary, newShared, checkLibrary, checkShared, publish, teamLook, SHARED_FOLDER } from './library.js?v=1.5.4';

const err = (words, status) => Object.assign(new Error(words), { status, words });
const now = () => new Date().toISOString();
const who = st => st.name || st.email || 'Bench Boss Labs';
const reach = async (app, id) => { try { return await app.drive.meta(id); } catch (e) { if (e.status === 404 || e.status === 403) return null; throw e; } };

async function mustBeAdmin(app) {
  const st = await cloudState(app);
  if (!isAdmin(st.email)) throw err('Only the Bench Boss Labs account can use Admin.');
  return st;
}

/** The "Practice Pilot" folder this app made in My Drive (made if it can't see one). */
async function rootFolder(app) {
  const st = await cloudState(app);
  if (st.adminRootId && await reach(app, st.adminRootId)) return st.adminRootId;
  const found = (await app.drive.list('root', { name: ROOT_FOLDER, mime: FOLDER }))[0];
  const id = found ? found.id : (await app.drive.createFolder('root', ROOT_FOLDER)).id;
  await setState(app, { adminRootId: id });
  return id;
}

/** Open (or make) the admin file. The team this device is on is listed automatically. → { doc, fileId } */
export async function loadAdmin(app) {
  const st = await mustBeAdmin(app);
  let fileId = st.adminFileId && await reach(app, st.adminFileId) ? st.adminFileId : null;
  if (!fileId) { const f = (await app.drive.list(null, { name: ADMIN_FILE }))[0]; if (f) fileId = f.id; }
  if (!fileId) fileId = (await app.drive.createJson(await rootFolder(app), ADMIN_FILE, newAdmin(now()))).id;
  await setState(app, { adminFileId: fileId });
  let doc = await app.drive.readJson(fileId);
  const bad = checkAdmin(doc);
  if (bad.length) throw err(bad[0] === 'newer' ? 'Update Practice Pilot: the admin file was saved by a newer version.' : 'The admin file is damaged.');
  if (st.libraryId && !doc.teams.some(t => t.libraryId === st.libraryId)) {
    doc = putTeam(doc, { libraryId: st.libraryId, folderId: st.folderId, name: st.teamName }, now());
    await app.drive.writeJson(fileId, doc);
  }
  return { doc, fileId };
}
async function saveAdmin(app, change) {
  const { doc, fileId } = await loadAdmin(app);
  const next = change(doc);
  await app.drive.writeJson(fileId, next);
  return next;
}

/**
 * What Admin shows for a team: its look, how many drills and plans, and whether sharing needs updating
 * (teams set up before 1.5.0 keep the shared plans in a "shared" folder, which helpers' phones can't open).
 */
export async function teamInfo(app, entry) {
  try {
    const doc = await app.drive.readJson(entry.libraryId);
    if (checkLibrary(doc).length) return { entry, problem: 'The library file is damaged.' };
    const plansId = doc.team.sharedPlansId;
    const plans = plansId ? await reach(app, plansId) : null;
    const needsUpdate = !plansId || !plans || (plans.parents || [])[0] !== entry.folderId;
    return { entry, team: doc.team, drills: doc.drills.length, plans: doc.plans.length, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy, needsUpdate };
  } catch (e) {
    if (e.status === 404 || e.status === 403) return { entry, problem: 'Practice Pilot can’t open this team’s library. Adopt the folder again.' };
    throw e;
  }
}

/** New team: makes its folder in Practice Pilot, the shared-plans file and the library file. → the admin entry */
export async function createTeam(app, { name, logo, mainColour, secondColour }) {
  const st = await mustBeAdmin(app);
  name = String(name || '').trim();
  if (!name) throw err('Give the team a name.');
  const { doc: admin } = await loadAdmin(app);
  if (admin.teams.some(t => !t.archived && t.name.toLowerCase() === name.toLowerCase())) throw err(`There’s already a team called ${name}.`);
  const at = now();
  const folder = await app.drive.createFolder(await rootFolder(app), name);
  return makeFiles(app, st, { folderId: folder.id, name, look: { logo, mainColour, secondColour }, at });
}
async function makeFiles(app, st, { folderId, name, look, at }) {
  const plans = await app.drive.createJson(folderId, sharedName(name), newShared({ team: { name }, by: who(st), at }));
  const { doc: admin } = await loadAdmin(app);
  const team = { id: `team_${Math.random().toString(36).slice(2, 10)}`, name, iceTimeMinutes: 50, colours: ['red', 'black'], sharedPlansId: plans.id, ...(admin.clubFileId ? { clubFileId: admin.clubFileId } : {}), ...teamLook(look || {}) };
  const lib = await app.drive.createJson(folderId, libraryName(name), newLibrary({ team, by: who(st), at, appVersion: APP_VERSION }));
  const entry = { libraryId: lib.id, folderId, name };
  await saveAdmin(app, d => putTeam(d, entry, at));
  return entry;
}

/** Adopt a team folder made outside Admin: pick it; its library is used, or one is made in it. → entry or null */
export async function adoptFolder(app) {
  const st = await mustBeAdmin(app);
  const f = await app.google.pick({ kind: 'folder', title: 'Pick the team’s folder in Google Drive' });
  if (!f) return null;
  const meta = await app.drive.meta(f.id);
  if (meta.capabilities && meta.capabilities.canEdit === false) throw err(`You can’t change “${meta.name}” in Google Drive. Pick a folder you own or can edit.`);
  const lib = (await app.drive.list(f.id, { name: libraryName(meta.name) }))[0];
  if (lib) {
    const entry = { libraryId: lib.id, folderId: f.id, name: meta.name };
    await saveAdmin(app, d => putTeam(d, { ...entry, archived: false }, now()));
    return entry;
  }
  return makeFiles(app, st, { folderId: f.id, name: meta.name, look: {}, at: now() });
}

/** Write the team part of a team's library (name, logo, colours). Renaming renames the folder and both files. */
export async function updateTeam(app, entry, fields) {
  const st = await mustBeAdmin(app);
  const doc = await app.drive.readJson(entry.libraryId);
  if (checkLibrary(doc).length) throw err('The team’s library file is damaged.');
  const name = String(fields.name != null ? fields.name : doc.team.name).trim();
  if (!name) throw err('Give the team a name.');
  const at = now();
  const look = teamLook({ logo: fields.logo !== undefined ? fields.logo : doc.team.logo, mainColour: fields.mainColour || doc.team.mainColour, secondColour: fields.secondColour || doc.team.secondColour });
  const team = { ...doc.team, name, ...look };
  if (fields.logo === null) delete team.logo;
  let next = publish(doc, { team }, who(st), at);
  next.team = team;                       // a removed logo stays removed
  await app.drive.writeJson(entry.libraryId, next);
  if (name !== doc.team.name) {
    await app.drive.rename(entry.folderId, name);
    await app.drive.rename(entry.libraryId, libraryName(name));
    if (team.sharedPlansId && await reach(app, team.sharedPlansId)) {
      await app.drive.rename(team.sharedPlansId, sharedName(name));
      const plans = await app.drive.readJson(team.sharedPlansId);
      if (!checkShared(plans).length) await app.drive.writeJson(team.sharedPlansId, { ...plans, team: { ...plans.team, name } });
    }
  }
  await saveAdmin(app, d => putTeam(d, { ...entry, name }, at));
  if (st.libraryId === entry.libraryId) await applyLibrary(app, next);      // this device is on that team
  return { ...entry, name };
}

/* ---------- people ---------- */

/** The link in a coach's invitation: opens Practice Pilot on the team's join page. */
export function coachLink(entry) {
  const base = typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : 'https://bench-boss-labs.github.io/practice-pilot/';
  return `${base}#team/${entry.libraryId}/${entry.folderId}/${encodeURIComponent(entry.name || '')}`;
}
export async function coachesOf(app, entry) { return peopleOf(await app.drive.permissions(entry.folderId), 'writer'); }
export async function addCoach(app, entry, email) {
  await mustBeAdmin(app);
  const e = String(email || '').trim().toLowerCase();
  if (!validEmail(e)) throw err('Type the coach’s Google email address.');
  await app.drive.share(entry.folderId, e, 'writer', `You’re a coach on ${entry.name} in Practice Pilot. On your phone or tablet, open ${coachLink(entry)} and sign in with this Google account. Quick start guide: ${GUIDES.coachQuickStart}`);
  // the club library (1.5.1): Viewer on its file, no second email
  const { doc: admin } = await loadAdmin(app);
  if (admin.clubFileId && await reach(app, admin.clubFileId)) {
    const have = peopleOf(await app.drive.permissions(admin.clubFileId), 'reader').some(p => p.email === e);
    if (!have) await app.drive.share(admin.clubFileId, e, 'reader', '', { notify: false });
  }
  return e;
}
export async function removeCoach(app, entry, permissionId) { await mustBeAdmin(app); await app.drive.unshare(entry.folderId, permissionId); }

export async function helpersOf(app, entry) {
  const info = await teamInfo(app, entry);
  if (!info.team || !info.team.sharedPlansId || info.needsUpdate) return [];
  return peopleOf(await app.drive.permissions(info.team.sharedPlansId), 'reader');
}
export async function removeHelperOf(app, entry, permissionId) {
  const info = await teamInfo(app, entry);
  await app.drive.unshare(info.team.sharedPlansId, permissionId);
}

/**
 * Update sharing for a team set up before 1.5.0: the shared-plans file moves next to the library file (or a new
 * one is made there), and helpers who were Viewers on the "shared" folder become Viewers on the file (no email).
 * → number of helpers carried over
 */
export async function updateSharing(app, entry) {
  const st = await mustBeAdmin(app);
  const doc = await app.drive.readJson(entry.libraryId);
  let plansId = doc.team.sharedPlansId || null;
  const plans = plansId ? await reach(app, plansId) : null;
  let oldFolder = plans && (plans.parents || [])[0] !== entry.folderId ? plans.parents[0] : null;
  if (!oldFolder) { const f = (await app.drive.list(entry.folderId, { name: SHARED_FOLDER, mime: FOLDER }))[0]; if (f) oldFolder = f.id; }
  if (plans && oldFolder && plans.parents[0] === oldFolder) await app.drive.move(plansId, entry.folderId, oldFolder);
  else if (!plans) {
    plansId = (await app.drive.createJson(entry.folderId, sharedName(doc.team.name), newShared({ team: { name: doc.team.name }, by: who(st), at: now() }))).id;
    const next = publish(doc, { team: { ...doc.team, sharedPlansId: plansId } }, who(st), now());
    await app.drive.writeJson(entry.libraryId, next);
    if (st.libraryId === entry.libraryId) await applyLibrary(app, next);
  }
  let moved = 0;
  if (oldFolder) {
    const have = new Set(peopleOf(await app.drive.permissions(plansId), 'reader').map(p => p.email));
    for (const h of peopleOf(await app.drive.permissions(oldFolder), 'reader')) {
      if (!have.has(h.email)) { await app.drive.share(plansId, h.email, 'reader', '', { notify: false }); moved++; }
    }
  }
  if (st.libraryId === entry.libraryId) await setState(app, { sharedPlansId: plansId, sharedFolderId: undefined });
  return moved;
}

/** Archive: hidden from the list and everyone's access removed; nothing in Drive is deleted. */
export async function archiveTeam(app, entry) {
  await mustBeAdmin(app);
  for (const c of await coachesOf(app, entry)) await app.drive.unshare(entry.folderId, c.id);
  for (const h of await helpersOf(app, entry)) await removeHelperOf(app, entry, h.id);
  await saveAdmin(app, d => putTeam(d, { ...entry, archived: true, archivedAt: now() }, now()));
}
export async function restoreTeam(app, entry) {
  await mustBeAdmin(app);
  await saveAdmin(app, d => putTeam(d, { ...entry, archived: false }, now()));
}
