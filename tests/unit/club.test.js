/* 1.5.1 Club library: a coach asks from the drill's Share dialog, Bench Boss Labs adds or declines in Admin,
   every coach can read the club file (Viewer on the file) and imports a copy into their team as a draft. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDrive } from '../fake-drive.mjs';
import { Drive, DriveError } from '../../app/cloud/drive.js';
import * as L from '../../app/cloud/library.js';
import * as T from '../../app/cloud/team.js';
import * as A from '../../app/cloud/admin.js';
import * as C from '../../app/cloud/club.js';
import * as S from '../../app/cloud/sync.js';

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
const yes = async o => (o && o.id === 'publish-confirm' ? 'yes' : 'leave');
const ADMIN = 'benchbosslabs@gmail.com', COACH = 'scalisec@gmail.com', COACH2 = 'other@example.com';

/** Two teams made in Admin, one coach on each, joined. */
async function club() {
  const fake = new FakeDrive();
  const a = await device(fake, ADMIN); await T.signIn(a);
  const t1 = await A.createTeam(a, { name: 'Bulldogs' });
  const t2 = await A.createTeam(a, { name: 'Barracudas' });
  await A.addCoach(a, t1, COACH); await A.addCoach(a, t2, COACH2);
  const c1 = await device(fake, COACH, { pickQueue: [[{ id: t1.libraryId }]] }); await T.signIn(c1); await T.joinTeam(c1, { dialog: no });
  const c2 = await device(fake, COACH2, { pickQueue: [[{ id: t2.libraryId }]] }); await T.signIn(c2); await T.joinTeam(c2, { dialog: no });
  for (const x of [a, c1, c2]) { x.cloudState = await T.cloudState(x); S.watchStore(x); }
  return { fake, a, c1, c2, t1, t2 };
}

test('club file helpers: add (replaces), remove, requests, import copy', () => {
  let doc = L.newClub('T0');
  doc = L.clubAdd(doc, { id: 'd1', title: 'A', pub: {}, thumb: '<svg/>', publishId: 'x' }, { team: 'Bulldogs', by: 'C' }, 'T1');
  doc = L.clubAdd(doc, { id: 'd1', title: 'A2' }, { team: 'Bulldogs', by: 'C' }, 'T2');
  assert.equal(doc.drills.length, 1);
  assert.deepEqual([doc.drills[0].title, doc.drills[0].thumb, doc.drills[0].publishId, doc.drills[0].club.team], ['A2', undefined, undefined, 'Bulldogs']);
  assert.equal(L.clubRemove(doc, 'd1', 'T3').drills.length, 0);
  let lib = { requests: [] };
  lib = L.addRequest(lib, { drillId: 'd1', at: 'a' }); lib = L.addRequest(lib, { drillId: 'd1', at: 'b' });
  assert.deepEqual(lib.requests, [{ drillId: 'd1', at: 'b' }]);
  assert.deepEqual(L.dropRequest(lib, 'd1').requests, []);
  const c = L.importCopy(doc.drills[0], 'd_new', 'T9');
  assert.deepEqual([c.id, c.sourceDrillId, c.club, c.createdAt], ['d_new', 'd1', undefined, 'T9']);
});

test('a coach asks (a draft is published first), Admin sees it with its team, adds it; every coach can read and import it; who sent it is kept, not shown', async () => {
  const { fake, a, c1, c2, t1 } = await club();
  // the club library is made and every coach given access
  assert.equal(await C.shareClub(a), 2);
  const file = fake.find(L.CLUB_FILE);
  assert.equal(fake.file(file.parents[0]).name, 'Club library');
  assert.deepEqual(Object.entries(fake.file(file.id).shared).sort(), [[COACH2, 'reader'], [COACH, 'reader']].sort());
  assert.equal(fake.mail.filter(m => /club/i.test(m.message || '')).length, 0, 'no extra email');
  // coaches catch up: their team now knows the club file; they must pick it once
  await S.syncNow(c1, { force: true }); await S.syncNow(c2, { force: true });
  assert.equal(c1.team.clubFileId, file.id);
  assert.equal(await C.refreshClub(c1), 'pick');
  c1.pickQueue.push({ id: file.id });
  assert.equal(await C.pickClub(c1), 'ok');
  // the coach asks for a draft drill: it is published first (confirm), then the request waits in the team library
  await c1.store.save('drills', { id: 'd_good1', title: 'Good drill', pieces: [], steps: [], sample: false, deletedAt: null, schemaVersion: 1 });
  assert.equal(await C.requestClub(c1, 'd_good1', { dialog: yes }), true);
  assert.equal(S.pubState(await c1.store.get('drills', 'd_good1')), 'published');
  assert.deepEqual(fake.read(t1.libraryId).requests.map(r => r.drillId), ['d_good1']);
  // Admin: the request, with its team; add it
  const reqs = await C.listRequests(a);
  assert.deepEqual(reqs.map(r => [r.entry.name, r.drill.title, r.req.email]), [['Bulldogs', 'Good drill', COACH]]);
  await C.approveRequest(a, reqs[0]);
  assert.deepEqual(fake.read(t1.libraryId).requests, [], 'the request is cleared');
  const clubDoc = fake.read(file.id);
  assert.deepEqual(clubDoc.drills.map(d => d.title), ['Good drill']);
  assert.deepEqual([clubDoc.drills[0].club.team, clubDoc.drills[0].club.email], ['Bulldogs', COACH], 'who sent it is kept');
  // the other team's coach: picks the club file once, imports a draft copy
  c2.pickQueue.push({ id: file.id });
  assert.equal(await C.pickClub(c2), 'ok');
  const cached = await C.clubCache(c2);
  const copy = await C.importClubDrill(c2, cached.drills[0], 'd_copy01', async () => '<svg/>');
  const mine = await c2.store.get('drills', 'd_copy01');
  assert.deepEqual([mine.title, mine.sourceDrillId, mine.thumb, S.pubState(mine)], ['Good drill', 'd_good1', '<svg/>', 'draft']);
  assert.equal(mine.club, undefined);
  assert.equal(copy.team, c2.team.id);
  // a coach can't change the club file
  await assert.rejects(c2.drive.writeJson(file.id, {}), e => e.status === 403);
});

test('decline clears the request; remove takes a drill out (imported copies stay); a coach added later gets access; removed coaches keep it', async () => {
  const { fake, a, c1, t1 } = await club();
  await C.shareClub(a);
  const file = fake.find(L.CLUB_FILE);
  await c1.store.save('drills', { id: 'd_meh001', title: 'Meh', pieces: [], steps: [], sample: false, deletedAt: null, schemaVersion: 1 });
  await C.requestClub(c1, 'd_meh001', { dialog: yes });
  const [r] = await C.listRequests(a);
  await C.declineRequest(a, r);
  assert.deepEqual(await C.listRequests(a), []);
  assert.equal(fake.read(file.id).drills.length, 0);
  // Bench Boss Labs adds one of its own and removes it
  await C.addOwnDrill(a, { id: 'd_bbl001', title: 'BBL drill', pieces: [], steps: [] });
  assert.equal(fake.read(file.id).drills.length, 1);
  await C.removeFromClub(a, 'd_bbl001');
  assert.equal(fake.read(file.id).drills.length, 0);
  // a coach added after the club exists: access straight away
  await A.addCoach(a, t1, 'late@example.com');
  assert.equal(fake.file(file.id).shared['late@example.com'], 'reader');
  const t3 = await A.createTeam(a, { name: 'Newer' });
  assert.equal(fake.read(t3.libraryId).team.clubFileId, file.id, 'a new team knows the club library');
  // removing a coach from a team keeps their club access (decided Nov 8)
  await A.removeCoach(a, t1, (await A.coachesOf(a, t1)).find(c => c.email === COACH).id);
  assert.equal(fake.file(file.id).shared[COACH], 'reader');
});
