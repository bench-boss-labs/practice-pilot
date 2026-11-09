/* 1.5.0 Admin: teams made end to end, coaches added and joining by picking both team files, helpers on the
   shared-plans file, renaming, the team look, updating sharing for a team set up before 1.5.0, archiving. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDrive } from '../fake-drive.mjs';
import { Drive, DriveError } from '../../app/cloud/drive.js';
import * as L from '../../app/cloud/library.js';
import * as T from '../../app/cloud/team.js';
import * as A from '../../app/cloud/admin.js';
import * as SH from '../../app/cloud/sharing.js';

/** An in-memory stand-in for the device store. */
class MemStore {
  constructor() { this.s = { drills: new Map(), plans: new Map(), teams: new Map(), meta: new Map() }; }
  async get(s, k) { return this.s[s].get(k) || null; }
  async all(s) { return [...this.s[s].values()]; }
  async count(s) { return this.s[s].size; }
  async put(s, r) { this.s[s].set(r.key || r.id, JSON.parse(JSON.stringify(r))); return r; }
  async save(s, r) { const now = new Date().toISOString(); return this.put(s, { ...r, schemaVersion: 1, createdAt: r.createdAt || now, updatedAt: now, updatedBy: 'this device' }); }
  async delete(s, k) { this.s[s].delete(k); }
  async replaceAll(s, rs) { this.s[s].clear(); for (const r of rs) await this.put(s, r); }
}
const stamp = r => ({ schemaVersion: 1, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'this device', ...r });
const drill = (id, extra = {}) => stamp({ id, title: `Drill ${id}`, pieces: [], steps: [], sample: false, deletedAt: null, thumb: '<svg/>', ...extra });

/** A device: its store, a fake Google (sign-in + picker) and the Drive client, all talking to one fake Drive. */
async function device(fake, email, { pickQueue = [] } = {}) {
  const store = new MemStore();
  await store.put('teams', stamp({ id: 't_local1', name: 'My team', colours: ['red', 'black'], iceTimeMinutes: 50 }));
  const app = { store, team: null, async refreshTeam() { this.team = (await store.all('teams'))[0]; } };
  await app.refreshTeam();
  let tok = null;
  const google = {
    token: () => tok, async signIn() { tok = fake.token(email); return tok; }, signOut() { tok = null; },
    async pick() { const f = pickQueue.shift(); if (!f) return null; const one = x => { fake.pick(email, x.id); return { id: x.id, name: fake.file(x.id).name }; }; return Array.isArray(f) ? f.map(one) : one(f); },
  };
  T.connect(app, google);
  app.drive = new Drive({ getToken: async () => { if (!tok) throw new DriveError(401, 'signed out'); return tok; }, fetchFn: (u, i) => fake.fetch(u, i) });
  app.pickQueue = pickQueue;
  return app;
}
const no = async () => 'leave';
const ADMIN = 'benchbosslabs@gmail.com', COACH = 'scalisec@gmail.com';
const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

test('team look: team colours pick the nearest player colours; the admin file adds and updates teams', () => {
  assert.equal(L.nearestPieceColour('#0b1b31'), 'black');
  assert.equal(L.nearestPieceColour('#1d4ed8'), 'blue');
  assert.equal(L.nearestPieceColour('#f26a1b'), 'red');
  assert.equal(L.nearestPieceColour('#f4f4f4'), 'white');
  assert.deepEqual(L.teamLook({ mainColour: '#1d4ed8', secondColour: '#ffffff', logo: LOGO }), { logo: LOGO, mainColour: '#1d4ed8', secondColour: '#ffffff', colours: ['blue', 'white'] });
  assert.deepEqual(L.teamLook({ mainColour: '#c8102e', secondColour: '#f26a1b' }).colours, ['red', 'black'], 'two reds: the second becomes another colour');
  let doc = L.newAdmin('T0');
  doc = L.putTeam(doc, { libraryId: 'l1', folderId: 'f1', name: 'A' }, 'T1');
  doc = L.putTeam(doc, { libraryId: 'l1', name: 'A2' }, 'T2');
  assert.deepEqual(doc.teams, [{ addedAt: 'T1', libraryId: 'l1', folderId: 'f1', name: 'A2' }]);
  assert.deepEqual(L.peopleOf([{ type: 'user', role: 'writer', emailAddress: 'B@x.com', id: 'p1' }, { type: 'user', role: 'owner', emailAddress: ADMIN, id: 'p0' }, { type: 'user', role: 'writer', emailAddress: ADMIN, id: 'p2' }], 'writer'), [{ id: 'p1', email: 'b@x.com', name: '' }]);
});

test('only Bench Boss Labs can use Admin', async () => {
  const fake = new FakeDrive();
  const c = await device(fake, COACH); await T.signIn(c);
  await assert.rejects(A.loadAdmin(c), /Only the Bench Boss Labs account/);
});

test('new team: folder in Practice Pilot, library and shared-plans files side by side, look saved; a coach is added and joins by picking both files', async () => {
  const fake = new FakeDrive();
  const a = await device(fake, ADMIN); await T.signIn(a);
  const e = await A.createTeam(a, { name: 'U13B Barracudas', logo: LOGO, mainColour: '#1d4ed8', secondColour: '#ffffff' });
  const folder = fake.file(e.folderId);
  assert.equal(folder.name, 'U13B Barracudas');
  assert.equal(fake.file(folder.parents[0]).name, 'Practice Pilot', 'inside the Practice Pilot folder');
  const lib = fake.read(e.libraryId), plans = fake.find('Practice Pilot shared plans · U13B Barracudas.json');
  assert.equal(plans.parents[0], e.folderId);
  assert.equal(lib.team.sharedPlansId, plans.id);
  assert.deepEqual([lib.team.logo, lib.team.mainColour, lib.team.colours], [LOGO, '#1d4ed8', ['blue', 'white']]);
  const { doc } = await A.loadAdmin(a);
  assert.deepEqual(doc.teams.map(t => t.name), ['U13B Barracudas']);
  await assert.rejects(A.createTeam(a, { name: 'u13b barracudas' }), /already a team/);
  // add a coach: Editor on the folder, emailed the join link
  await A.addCoach(a, e, ' Scalisec@Gmail.com ');
  assert.equal(folder.shared[COACH], 'writer');
  assert.match(fake.mail.at(-1).message, new RegExp(`#team/${e.libraryId}/${e.folderId}/U13B%20Barracudas`));
  assert.match(fake.mail.at(-1).message, /Quick start guide: https:\/\/docs\.google\.com\/document\/d\/1NW37Sl3s/, 'the coach quick start is in the invitation');
  assert.deepEqual((await A.coachesOf(a, e)).map(c => c.email), [COACH]);
  // the coach joins: picks both files in one go; picking another team's library is refused
  const c = await device(fake, COACH, { pickQueue: [[{ id: e.libraryId }, { id: plans.id }]] });
  await T.signIn(c);
  const r = await T.joinTeam(c, { dialog: no, folderId: e.folderId, libraryId: e.libraryId });
  assert.equal(r.teamName, 'U13B Barracudas');
  assert.equal(c.team.logo, LOGO, 'the logo arrives with the library');
  assert.deepEqual(c.team.colours, ['blue', 'white']);
  assert.ok(await c.drive.readJson(plans.id), 'the plans file opens too: no second pick when sharing');
  assert.ok(await SH.ensureShared(c));
  // remove the coach
  await A.removeCoach(a, e, (await A.coachesOf(a, e))[0].id);
  assert.equal(folder.shared[COACH], undefined);
});

test('rename and new look: the folder and both files are renamed; a coach’s device gets the new name on sync', async () => {
  const fake = new FakeDrive();
  const a = await device(fake, ADMIN); await T.signIn(a);
  const e = await A.createTeam(a, { name: 'Bulldogs' });
  await A.addCoach(a, e, COACH);
  const c = await device(fake, COACH, { pickQueue: [[{ id: e.libraryId }]] });
  await T.signIn(c); await T.joinTeam(c, { dialog: no });
  await A.updateTeam(a, e, { name: 'U10BB Bulldogs Blue', mainColour: '#0b1b31', logo: LOGO });
  assert.equal(fake.file(e.folderId).name, 'U10BB Bulldogs Blue');
  assert.equal(fake.file(e.libraryId).name, 'Practice Pilot library · U10BB Bulldogs Blue.json');
  assert.ok(fake.find('Practice Pilot shared plans · U10BB Bulldogs Blue.json'));
  assert.equal(fake.read(fake.find('Practice Pilot shared plans · U10BB Bulldogs Blue.json').id).team.name, 'U10BB Bulldogs Blue');
  assert.equal((await A.loadAdmin(a)).doc.teams[0].name, 'U10BB Bulldogs Blue');
  await T.applyLibrary(c, await c.drive.readJson(e.libraryId));
  assert.equal(c.team.name, 'U10BB Bulldogs Blue');
  assert.equal((await T.cloudState(c)).teamName, 'U10BB Bulldogs Blue');
  await A.updateTeam(a, { ...e, name: 'U10BB Bulldogs Blue' }, { logo: null });
  assert.equal(fake.read(e.libraryId).team.logo, undefined, 'No logo removes it');
});

test('adopt a hand-made folder (the Nov 8 trial): its library is made in it and it is listed', async () => {
  const fake = new FakeDrive();
  const hand = fake.addFolder('Hand-made team', ADMIN);
  const a = await device(fake, ADMIN, { pickQueue: [{ id: hand }] }); await T.signIn(a);
  const e = await A.adoptFolder(a);
  assert.equal(e.folderId, hand);
  assert.ok(fake.find('Practice Pilot library · Hand-made team.json'));
  assert.equal(fake.find('Practice Pilot shared plans · Hand-made team.json').parents[0], hand);
  const info = await A.teamInfo(a, e);
  assert.equal(info.needsUpdate, false);
});

test('a team set up before 1.5.0: listed automatically; Update sharing moves the plans file next to the library and keeps its helpers', async () => {
  const fake = new FakeDrive();
  const folder = fake.addFolder('Bulldogs', ADMIN);
  const a = await device(fake, ADMIN, { pickQueue: [{ id: folder }] }); await T.signIn(a);
  await T.setupTeam(a, { dialog: no });
  const st = await T.cloudState(a);
  // make it look like 1.4.x: the plans file in a "shared" folder, a helper on that folder
  const plans = fake.find('Practice Pilot shared plans · Bulldogs.json');
  const shared = fake.addFolder('shared', ADMIN, { parent: folder, shared: { 'helper@example.com': 'reader' } });
  fake.file(shared).app.add(ADMIN);
  fake.file(plans.id).parents = [shared];
  const { doc } = await A.loadAdmin(a);
  const e = doc.teams[0];
  assert.deepEqual([e.libraryId, e.name], [st.libraryId, 'Bulldogs'], 'the team this device is on is listed');
  assert.equal((await A.teamInfo(a, e)).needsUpdate, true);
  assert.equal(await A.updateSharing(a, e), 1);
  assert.equal(fake.file(plans.id).parents[0], folder);
  assert.equal(fake.file(plans.id).shared['helper@example.com'], 'reader');
  assert.equal(fake.mail, undefined, 'no email for helpers carried over');
  assert.equal((await A.teamInfo(a, e)).needsUpdate, false);
  assert.deepEqual((await A.helpersOf(a, e)).map(h => h.email), ['helper@example.com']);
});

test('archive removes everyone’s access and hides the team; restore brings it back', async () => {
  const fake = new FakeDrive();
  const a = await device(fake, ADMIN); await T.signIn(a);
  const e = await A.createTeam(a, { name: 'Old team' });
  await A.addCoach(a, e, COACH);
  const plansId = fake.read(e.libraryId).team.sharedPlansId;
  fake.share(plansId, 'helper@example.com', 'reader');
  await A.archiveTeam(a, e);
  assert.deepEqual(fake.file(e.folderId).shared, {});
  assert.deepEqual(fake.file(plansId).shared, {});
  assert.equal((await A.loadAdmin(a)).doc.teams[0].archived, true);
  assert.ok(fake.file(e.libraryId) && !fake.file(e.libraryId).trashed, 'nothing deleted');
  await A.restoreTeam(a, e);
  assert.equal((await A.loadAdmin(a)).doc.teams[0].archived, false);
});
