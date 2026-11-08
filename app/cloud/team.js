/* Practice Pilot — signing in, setting up and joining a team (R3 Sign-in, Team Library and Sync deep-dive).
   The team is a Drive folder holding one library file and a `shared` folder for helpers. */
import { APP_VERSION } from '../version.js?v=1.4.3';
import { Drive, DriveError } from './drive.js?v=1.4.3';
import { LIBRARY_PREFIX, SHARED_FOLDER, libraryName, newLibrary, checkLibrary, publish, landed, fromTeam, movable, isAdmin, teamPart } from './library.js?v=1.4.3';

const META = 'cloud';
/** This device's link to Google and the team: { email, name, folderId, folderName, libraryId, teamName, version, syncedAt }. */
export async function cloudState(app) { return ((await app.store.get('meta', META)) || {}).value || {}; }
export async function setState(app, fields) {
  const v = { ...(await cloudState(app)), ...fields };
  for (const [k, x] of Object.entries(v)) if (x === undefined) delete v[k];
  await app.store.put('meta', { key: META, value: v });
  app.cloudState = v;
  return v;
}

/** The Drive client for this app, using Google's current pass. */
export function connect(app, google) {
  app.google = google;
  app.drive = new Drive({ getToken: async () => { const t = google.token(); if (!t) throw new DriveError(401, 'signed out'); return t; } });
}

/* ---------- sign in and out ---------- */

export async function signIn(app) {
  await app.google.signIn({ quiet: false, hint: (await cloudState(app)).email || '' });
  const who = await app.drive.about();
  return setState(app, { email: who.email, name: who.name });
}
/** Sign out: the team's drills stay on this device to view; sync stops. */
export async function signOut(app) {
  app.google.signOut();
  return setState(app, { email: undefined, name: undefined });
}
export const signedIn = app => !!(app.google && app.google.token());

/* ---------- set up, join, leave ---------- */

/** Ask whether this device's own drills and plans move into the team library. → true (move) or false. */
async function askMove(app, dialog, teamName) {
  const { drills, plans } = movable(await app.store.all('drills'), await app.store.all('plans'));
  if (!drills.length && !plans.length) return { drills: [], plans: [] };
  const what = [drills.length && `${drills.length} drill${drills.length === 1 ? '' : 's'}`, plans.length && `${plans.length} plan${plans.length === 1 ? '' : 's'}`].filter(Boolean).join(' and ');
  const v = await dialog({ id: 'move-in', title: `Move this device’s drills into ${teamName}?`,
    body: `This device has ${what} of its own. Moved, every coach on the team sees them. Left here, they stay drafts on this device only; you can publish them later. Samples always stay on the device.`,
    buttons: [{ label: 'Leave them here', value: 'leave' }, { label: 'Move them into the team library', value: 'move', kind: 'primary' }] });
  return v === 'move' ? { drills, plans } : { drills: [], plans: [] };
}

/** Write changes to the library, checking afterwards that they landed (a coach saving at the same moment). */
export async function pushChanges(app, changes) {
  const st = await cloudState(app);
  const by = st.name || st.email || 'a coach';
  for (let i = 0; i < 4; i++) {
    const doc = await app.drive.readJson(st.libraryId);
    const bad = checkLibrary(doc);
    if (bad.length) throw new Error(bad[0] === 'newer' ? 'Update Practice Pilot to keep syncing: the team library was saved by a newer version.' : 'The team library file is damaged.');
    const at = new Date(Date.now() + i).toISOString();
    const meta = await app.drive.writeJson(st.libraryId, publish(doc, changes, by, at));
    const back = await app.drive.readJson(st.libraryId);
    if (landed(back, changes, at)) { await setState(app, { version: meta.version }); return back; }
  }
  throw new Error('Another coach was saving at the same time. Try again in a moment.');
}

/** Put the team library on this device: the team, then every drill and plan (this device's unpublished work is kept). */
export async function applyLibrary(app, doc) {
  const leaving = new Set(((await app.store.get('meta', 'pending-gone')) || { value: [] }).value);   // deleted here, not yet sent
  for (const kind of ['drills', 'plans']) {
    for (const rec of doc[kind]) {
      if (leaving.has(rec.id)) continue;
      const mine = await app.store.get(kind, rec.id);
      if (mine && mine.pub && mine.pub.state !== 'published') continue;   // a draft or unpublished change of yours wins here
      const local = fromTeam(rec);
      if (kind === 'drills') local.thumb = mine && mine.thumb && mine.updatedAt === rec.updatedAt ? mine.thumb : app.thumbOf ? await app.thumbOf(local) : undefined;
      if (local.thumb === undefined) delete local.thumb;
      await app.store.put(kind, local);
    }
    for (const g of doc.gone || []) {
      const mine = await app.store.get(kind, g.id);
      if (mine && (!mine.pub || mine.pub.state === 'published')) await app.store.delete(kind, g.id);
    }
  }
  const team = { ...(app.team || {}), ...teamPart(doc.team) };
  await app.store.replaceAll('teams', [{ ...team, schemaVersion: app.team.schemaVersion, createdAt: app.team.createdAt || doc.updatedAt, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy }]);
  await app.refreshTeam();
}

/** Mark this device's records (moved in) as published, matching the library. */
async function markPublished(app, doc, changes) {
  for (const kind of ['drills', 'plans']) for (const r of changes[kind] || []) {
    const rec = doc[kind].find(x => x.id === r.id);
    if (rec) await app.store.put(kind, { ...r, ...fromTeam(rec), thumb: r.thumb });
  }
}
/** Records left on the device when joining stay as drafts. */
async function markDrafts(app) {
  for (const kind of ['drills', 'plans']) for (const r of await app.store.all(kind)) {
    if (!r.pub && !r.sample) await app.store.put(kind, { ...r, pub: { state: 'draft', at: null } });
  }
}

/**
 * Set up a team (benchbosslabs only): pick the team's Drive folder; the app makes the library file and the
 * `shared` folder. If the library is already there, this joins it instead.
 */
export async function setupTeam(app, { dialog }) {
  const st = await cloudState(app);
  if (!isAdmin(st.email)) throw new Error('Only the Bench Boss Labs account sets up teams.');
  const folder = await app.google.pick({ kind: 'folder', title: 'Pick the team’s folder (for example U10BB Bulldogs Blue)' });
  if (!folder) return null;
  const meta = await app.drive.meta(folder.id);
  if (meta.capabilities && meta.capabilities.canEdit === false) throw new Error(`You can’t change “${meta.name}” in Google Drive. Pick a folder you own or can edit.`);
  const name = libraryName(meta.name);
  const existing = (await app.drive.list(folder.id, { name }))[0];
  if (existing) return joinFile(app, existing.id, { dialog });
  const changes = await askMove(app, dialog, meta.name);
  const at = new Date().toISOString(), by = st.name || st.email;
  let doc = newLibrary({ team: { ...app.team, name: meta.name }, by, at, appVersion: APP_VERSION });
  doc = publish(doc, changes, by, at);
  const file = await app.drive.createJson(folder.id, name, doc);
  await app.drive.folder(folder.id, SHARED_FOLDER);
  await markPublished(app, doc, changes);
  await markDrafts(app);
  await setState(app, { folderId: folder.id, folderName: meta.name, libraryId: file.id, teamName: meta.name, version: file.version, syncedAt: at });
  await applyLibrary(app, doc);
  return { teamName: meta.name, moved: changes.drills.length + changes.plans.length };
}

/** Join a team: pick its library file in Google's file picker. */
export async function joinTeam(app, { dialog, before }) {
  const f = await app.google.pick({ kind: 'library', title: `Pick your team’s “${LIBRARY_PREFIX}” file` });
  if (!f) return null;
  if (!f.name.startsWith(LIBRARY_PREFIX)) throw new Error(`That isn’t a team library. Pick the file whose name starts with “${LIBRARY_PREFIX}”.`);
  if (before) await before();
  return joinFile(app, f.id, { dialog });
}

async function joinFile(app, id, { dialog }) {
  const [meta, doc] = await Promise.all([app.drive.meta(id), app.drive.readJson(id)]);
  const bad = checkLibrary(doc);
  if (bad.length) throw new Error(bad[0] === 'newer' ? 'Update Practice Pilot first: this team library was saved by a newer version.' : 'That file isn’t a Practice Pilot team library.');
  const teamName = doc.team.name;
  await setState(app, { folderId: (meta.parents || [])[0] || null, folderName: teamName, libraryId: id, teamName, version: meta.version });
  const changes = await askMove(app, dialog, teamName);
  let lib = doc;
  if (changes.drills.length || changes.plans.length) { lib = await pushChanges(app, changes); await markPublished(app, lib, changes); }
  await markDrafts(app);
  await applyLibrary(app, lib);
  await setState(app, { syncedAt: new Date().toISOString() });
  return { teamName, moved: changes.drills.length + changes.plans.length };
}

/** Leave the team on this device: everything stays here as this device's own drills and plans. */
export async function leaveTeam(app) {
  for (const kind of ['drills', 'plans']) for (const r of await app.store.all(kind)) if (r.pub) { const n = { ...r }; delete n.pub; await app.store.put(kind, n); }
  await setState(app, { folderId: undefined, folderName: undefined, libraryId: undefined, teamName: undefined, version: undefined, syncedAt: undefined });
}
