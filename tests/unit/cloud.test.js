/* R3: the Drive client, the team library file, setting up and joining a team, against a fake Drive. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDrive } from '../fake-drive.mjs';
import { Drive, DriveError } from '../../app/cloud/drive.js';
import * as L from '../../app/cloud/library.js';
import * as T from '../../app/cloud/team.js';

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
    async pick() { const f = pickQueue.shift(); if (!f) return null; fake.pick(email, f.id); return { id: f.id, name: fake.file(f.id).name }; },
  };
  T.connect(app, google);
  app.drive = new Drive({ getToken: async () => { if (!tok) throw new DriveError(401, 'signed out'); return tok; }, fetchFn: (u, i) => fake.fetch(u, i) });
  app.pickQueue = pickQueue;
  return app;
}
const yes = async () => 'move', no = async () => 'leave';

test('Drive client: folders, JSON files, labels, and the drive.file rule', async () => {
  const fake = new FakeDrive();
  const folder = fake.addFolder('Bulldogs', 'admin@x.com');
  const d = new Drive({ getToken: async () => fake.token('admin@x.com'), fetchFn: (u, i) => fake.fetch(u, i) });
  await assert.rejects(d.meta(folder), e => e.status === 404, 'not picked yet: the app can’t see it');
  fake.pick('admin@x.com', folder);
  assert.equal((await d.meta(folder)).name, 'Bulldogs');
  const f = await d.createJson(folder, 'lib.json', { a: 1 });
  assert.deepEqual(await d.readJson(f.id), { a: 1 });
  const w = await d.writeJson(f.id, { a: 2 });
  assert.ok(Number(w.version) > Number(f.version));
  await d.setProps(f.id, { editingBy: 'Mike' });
  assert.equal((await d.meta(f.id)).appProperties.editingBy, 'Mike');
  await d.setProps(f.id, { editingBy: null });
  assert.equal((await d.meta(f.id)).appProperties.editingBy, undefined);
  const shared = await d.folder(folder, 'shared');
  assert.equal((await d.folder(folder, 'shared')).id, shared.id, 'found, not made twice');
  fake.addFile('dropped in.json', 'admin@x.com', folder);
  assert.deepEqual((await d.list(folder)).map(x => x.name).sort(), ['lib.json', 'shared'], 'a file dropped in by hand is invisible to the app');
  fake.offline = true;
  await assert.rejects(d.about(), e => e instanceof DriveError && e.status === 0 && /No connection/.test(e.words));
});

test('library file: names, publish stamps who and when, gone removes, landed checks, newer is refused', () => {
  assert.equal(L.libraryName('U10BB Bulldogs Blue'), 'Practice Pilot library · U10BB Bulldogs Blue.json');
  assert.equal(L.libraryName('A/B: C'), 'Practice Pilot library · A-B- C.json');
  let doc = L.newLibrary({ team: { id: 't_1', name: 'Bulldogs', iceTimeMinutes: 60, driveFolderId: 'x' }, by: 'Cristian', at: 'T0', appVersion: '1.4.0' });
  assert.deepEqual(L.checkLibrary(doc), []);
  assert.equal(doc.team.driveFolderId, undefined, 'only team fields that travel');
  doc = L.publish(doc, { drills: [drill('d_aaaaaa', { pub: { state: 'draft' } })] }, 'Cristian', 'T1');
  assert.equal(doc.drills[0].publishedBy, 'Cristian'); assert.equal(doc.drills[0].thumb, undefined); assert.equal(doc.drills[0].pub, undefined);
  assert.ok(L.landed(doc, { drills: [{ id: 'd_aaaaaa' }] }, 'T1'));
  assert.ok(!L.landed(doc, { drills: [{ id: 'd_aaaaaa' }] }, 'T2'));
  doc = L.publish(doc, { gone: ['d_aaaaaa'] }, 'Mike', 'T3');
  assert.equal(doc.drills.length, 0); assert.equal(doc.gone[0].by, 'Mike');
  assert.deepEqual(L.checkLibrary({ ...doc, formatVersion: 99 }), ['newer']);
  assert.ok(L.isAdmin('BenchBossLabs@gmail.com') && !L.isAdmin('scalisec@gmail.com'));
  assert.equal(L.fromTeam(doc.team).pub.state, 'published');
});

test('set up a team (benchbosslabs): library and shared-plans file made side by side, own drills move in as published, samples stay', async () => {
  const fake = new FakeDrive();
  const admin = 'benchbosslabs@gmail.com';
  const folder = fake.addFolder('U10BB Bulldogs Blue', admin);
  const a = await device(fake, admin, { pickQueue: [{ id: folder }] });
  await a.store.put('drills', drill('d_mine01'));
  await a.store.put('drills', drill('d_sample', { sample: true }));
  await a.store.put('plans', stamp({ id: 'p_mine01', title: 'Tuesday', blocks: [], deletedAt: null }));
  await T.signIn(a);
  const r = await T.setupTeam(a, { dialog: yes });
  assert.deepEqual(r, { teamName: 'U10BB Bulldogs Blue', moved: 2 });
  const lib = fake.find('Practice Pilot library · U10BB Bulldogs Blue.json');
  const doc = fake.read(lib.id);
  assert.deepEqual(doc.drills.map(d => d.id), ['d_mine01']);
  assert.deepEqual(doc.plans.map(p => p.id), ['p_mine01']);
  assert.equal(doc.team.name, 'U10BB Bulldogs Blue');
  const plans = fake.find('Practice Pilot shared plans · U10BB Bulldogs Blue.json');
  assert.ok(plans && plans.parents[0] === folder, 'the shared-plans file sits beside the library (1.5.0)');
  assert.equal(doc.team.sharedPlansId, plans.id);
  assert.equal(fake.find('shared'), null, 'no shared folder any more');
  assert.equal((await a.store.get('drills', 'd_mine01')).pub.state, 'published');
  assert.equal((await a.store.get('drills', 'd_mine01')).thumb, '<svg/>', 'keeps its picture');
  assert.equal((await a.store.get('drills', 'd_sample')).pub, undefined, 'samples stay on the device');
  assert.equal(a.team.name, 'U10BB Bulldogs Blue');
  assert.equal((await T.cloudState(a)).libraryId, lib.id);
});

test('only benchbosslabs can set up a team', async () => {
  const fake = new FakeDrive();
  const a = await device(fake, 'scalisec@gmail.com');
  await T.signIn(a);
  await assert.rejects(T.setupTeam(a, { dialog: yes }), /Only the Bench Boss Labs account/);
});

test('join a team: pick the library once; the team’s drills arrive; left-behind drills become drafts; moved ones are published', async () => {
  const fake = new FakeDrive();
  const admin = 'benchbosslabs@gmail.com', coach = 'scalisec@gmail.com';
  const folder = fake.addFolder('U10BB Bulldogs Blue', admin, { shared: { [coach]: 'writer' } });
  const a = await device(fake, admin, { pickQueue: [{ id: folder }] });
  await a.store.put('drills', drill('d_admin1'));
  await T.signIn(a); await T.setupTeam(a, { dialog: yes });
  const lib = fake.find('Practice Pilot library · U10BB Bulldogs Blue.json');

  // a second coach with a drill of their own, who leaves it on the device
  const b = await device(fake, coach, { pickQueue: [{ id: lib.id }] });
  await b.store.put('drills', drill('d_coach1'));
  await T.signIn(b);
  const r = await T.joinTeam(b, { dialog: no });
  assert.deepEqual(r, { teamName: 'U10BB Bulldogs Blue', moved: 0 });
  assert.equal((await b.store.get('drills', 'd_admin1')).pub.state, 'published', 'the team’s drill arrived');
  assert.equal((await b.store.get('drills', 'd_coach1')).pub.state, 'draft', 'left here = a draft');
  assert.equal(b.team.name, 'U10BB Bulldogs Blue');

  // a third device that moves its drill in
  const c = await device(fake, coach, { pickQueue: [{ id: lib.id }] });
  await c.store.put('drills', drill('d_coach2'));
  await T.signIn(c);
  assert.equal((await T.joinTeam(c, { dialog: yes })).moved, 1);
  assert.deepEqual(fake.read(lib.id).drills.map(d => d.id).sort(), ['d_admin1', 'd_coach2']);
  assert.equal(fake.read(lib.id).drills.find(d => d.id === 'd_coach2').publishedBy, 'scalisec');
  assert.equal((await c.store.get('drills', 'd_coach2')).pub.state, 'published');
});

test('joining: the wrong file, a newer library, and a folder that isn’t shared are explained', async () => {
  const fake = new FakeDrive();
  const admin = 'benchbosslabs@gmail.com', coach = 'scalisec@gmail.com';
  const folder = fake.addFolder('Team', admin, { shared: { [coach]: 'writer' } });
  const other = fake.addFile('notes.json', admin, folder, '{"x":1}');
  const b = await device(fake, coach, { pickQueue: [{ id: other }] });
  await T.signIn(b);
  await assert.rejects(T.joinTeam(b, { dialog: no }), /isn’t a team library/);
  const newer = fake.addFile('Practice Pilot library · Team.json', admin, folder, JSON.stringify({ format: L.LIBRARY_FORMAT, formatVersion: 9, team: { name: 'Team' }, drills: [], plans: [], gone: [] }));
  b.pickQueue.push({ id: newer });
  await assert.rejects(T.joinTeam(b, { dialog: no }), /newer version/);
  fake.unshare(folder, coach);
  b.pickQueue.push({ id: newer });
  await assert.rejects(T.joinTeam(b, { dialog: no }), e => e.status === 404);
});

test('two coaches saving at the same moment: the check after saving puts back what was overwritten', async () => {
  const fake = new FakeDrive();
  const admin = 'benchbosslabs@gmail.com';
  const folder = fake.addFolder('Team', admin);
  const a = await device(fake, admin, { pickQueue: [{ id: folder }] });
  await T.signIn(a); await T.setupTeam(a, { dialog: no });
  const lib = fake.find('Practice Pilot library · Team.json');
  // Someone else's save sneaks in between this device's read and write, once.
  const real = fake.handle.bind(fake);
  let sneak = true;
  fake.handle = async req => {
    if (sneak && req.method === 'PATCH') {
      // the other coach read before our save and writes just after it: their file has their drill, not ours
      sneak = false; const before = fake.read(lib.id); const r = await real(req);
      before.drills.push({ id: 'd_other1', publishedAt: 'X' }); fake.file(lib.id).content = JSON.stringify(before);
      return r;
    }
    return real(req);
  };
  await T.pushChanges(a, { drills: [drill('d_mine02')] });
  fake.handle = real;
  const ids = fake.read(lib.id).drills.map(d => d.id);
  assert.ok(ids.includes('d_mine02'), 'ours was overwritten, noticed, and saved again');
  assert.ok(ids.includes('d_other1'), 'and theirs is kept');
});

test('leave the team and sign out: everything stays on the device', async () => {
  const fake = new FakeDrive();
  const admin = 'benchbosslabs@gmail.com';
  const folder = fake.addFolder('Team', admin);
  const a = await device(fake, admin, { pickQueue: [{ id: folder }] });
  await a.store.put('drills', drill('d_keep01'));
  await T.signIn(a); await T.setupTeam(a, { dialog: yes });
  await T.leaveTeam(a);
  const d = await a.store.get('drills', 'd_keep01');
  assert.ok(d && !d.pub);
  assert.equal((await T.cloudState(a)).libraryId, undefined);
  await T.signOut(a);
  assert.equal((await T.cloudState(a)).email, undefined);
  assert.equal(T.signedIn(a), false);
});

/* ---------- stage 2: Drafts and Publish, catching up, marks ---------- */
import * as S from '../../app/cloud/sync.js';

/** Two coaches in one team: a (benchbosslabs, set up) and b (scalisec, joined). */
async function team() {
  const fake = new FakeDrive();
  const admin = 'benchbosslabs@gmail.com', coach = 'scalisec@gmail.com';
  const folder = fake.addFolder('Bulldogs', admin, { shared: { [coach]: 'writer' } });
  const a = await device(fake, admin, { pickQueue: [{ id: folder }] });
  await a.store.put('drills', drill('d_shared'));
  await T.signIn(a); await T.setupTeam(a, { dialog: yes });
  const lib = fake.find('Practice Pilot library · Bulldogs.json');
  const b = await device(fake, coach, { pickQueue: [{ id: lib.id }] });
  await T.signIn(b); await T.joinTeam(b, { dialog: no });
  for (const x of [a, b]) { x.cloudState = await T.cloudState(x); S.watchStore(x); }
  return { fake, a, b, lib };
}
// the publish confirm (1.4.3) is answered Publish; any other question gets v
const answer = v => async o => (o && o.id === 'publish-confirm' ? 'yes' : v);

test('drafts: a new drill stays on the device until published; then the other coach gets it on sync', async () => {
  const { fake, a, b, lib } = await team();
  await a.store.save('drills', drill('d_new001', { title: 'Weave' }));
  assert.equal(S.pubState(await a.store.get('drills', 'd_new001')), 'draft');
  assert.ok(!fake.read(lib.id).drills.some(d => d.id === 'd_new001'), 'not in the team library');
  assert.equal(await S.syncNow(b), true);
  assert.equal(await b.store.get('drills', 'd_new001'), null, 'the other coach can’t see a draft');
  assert.equal(await S.publishItems(a, 'drills', 'd_new001', { dialog: async o => { assert.equal(o.id, 'publish-confirm'); return null; } }), null, 'asked first; Cancel publishes nothing');
  const r = await S.publishItems(a, 'drills', 'd_new001', { dialog: answer(null) });
  assert.equal(r.published, 1);
  assert.equal(S.pubState(await a.store.get('drills', 'd_new001')), 'published');
  await S.syncNow(b);
  assert.equal((await b.store.get('drills', 'd_new001')).title, 'Weave');
  assert.equal(b.sync.state, 'synced');
});

test('unpublished changes: the team keeps the published version; Discard goes back to it; a mark warns others', async () => {
  const { fake, a, b, lib } = await team();
  const d = await a.store.get('drills', 'd_shared');
  await a.store.save('drills', { ...d, title: 'Renamed' });
  assert.equal(S.pubState(await a.store.get('drills', 'd_shared')), 'changed');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(fake.read(lib.id).drills.find(x => x.id === 'd_shared').title, 'Drill d_shared', 'the team still sees the published one');
  await S.syncNow(b);
  const m = await S.othersMark(b, 'd_shared');
  assert.ok(m && m.email === 'benchbosslabs@gmail.com', 'b sees that a has unpublished changes');
  assert.equal(await S.othersMark(a, 'd_shared'), null, 'not your own mark');
  await S.syncNow(a);
  assert.equal((await a.store.get('drills', 'd_shared')).title, 'Renamed', 'catching up never overwrites your unpublished changes');
  const back = await S.discardChanges(a, 'drills', 'd_shared');
  assert.equal(back.title, 'Drill d_shared');
  assert.equal(S.pubState(await a.store.get('drills', 'd_shared')), 'published');
  await S.syncNow(b);
  assert.equal(await S.othersMark(b, 'd_shared'), null, 'the mark goes with Discard');
});

test('publish check: someone else published the same drill since you started → Keep mine, Take theirs, Keep both', async () => {
  for (const choice of ['mine', 'theirs', 'both']) {
    const { fake, a, b, lib } = await team();
    await a.store.save('drills', { ...(await a.store.get('drills', 'd_shared')), title: 'A’s version' });
    await b.store.save('drills', { ...(await b.store.get('drills', 'd_shared')), title: 'B’s version' });
    await S.publishItems(b, 'drills', 'd_shared', { dialog: answer(null) });
    let asked = null;
    await S.publishItems(a, 'drills', 'd_shared', { dialog: async o => { if (o.id === 'publish-confirm') return 'yes'; asked = o.id; return choice; } });
    assert.equal(asked, 'publish-conflict');
    const titles = fake.read(lib.id).drills.map(d => d.title).sort();
    const local = (await a.store.get('drills', 'd_shared')).title;
    if (choice === 'mine') { assert.ok(titles.includes('A’s version') && !titles.includes('B’s version')); assert.equal(local, 'A’s version'); }
    if (choice === 'theirs') { assert.ok(titles.includes('B’s version') && !titles.includes('A’s version')); assert.equal(local, 'B’s version'); }
    if (choice === 'both') { assert.ok(titles.includes('B’s version') && titles.includes('A’s version (my copy)')); assert.equal(local, 'B’s version'); }
  }
});

test('publish check: deleted by someone else → put it back with your changes, or let it go', async () => {
  const { fake, a, b, lib } = await team();
  await a.store.save('drills', { ...(await a.store.get('drills', 'd_shared')), title: 'Kept' });
  await b.store.delete('drills', 'd_shared');
  await S.syncNow(b);                                   // sends the deletion
  assert.ok(fake.read(lib.id).gone.some(g => g.id === 'd_shared'));
  await S.publishItems(a, 'drills', 'd_shared', { dialog: answer('back') });
  assert.equal(fake.read(lib.id).drills.find(d => d.id === 'd_shared').title, 'Kept');
  await S.syncNow(b);
  assert.equal((await b.store.get('drills', 'd_shared')).title, 'Kept', 'it’s back for everyone');
});

test('publishing a plan offers to publish the drafts it uses, so nobody sees a missing drill', async () => {
  const { fake, a, lib } = await team();
  await a.store.save('drills', drill('d_draft1', { title: 'New one' }));
  await a.store.save('plans', stamp({ id: 'p_plan01', title: 'Tue', blocks: [{ id: 'b1', kind: 'drill', drillId: 'd_draft1', minutes: 8 }, { id: 'b2', kind: 'drill', drillId: 'd_shared', minutes: 8 }], deletedAt: null }));
  assert.equal(await S.publishItems(a, 'plans', 'p_plan01', { dialog: answer(null) }), null, 'Cancel publishes nothing');
  assert.ok(!fake.read(lib.id).plans.length);
  const r = await S.publishItems(a, 'plans', 'p_plan01', { dialog: answer('all') });
  assert.equal(r.published, 2);
  assert.ok(fake.read(lib.id).drills.some(d => d.id === 'd_draft1') && fake.read(lib.id).plans.some(p => p.id === 'p_plan01'));
});

test('catching up: offline and a run-out pass show in the status, and nothing changes', async () => {
  const { fake, b } = await team();
  fake.offline = true;
  assert.equal(await S.syncNow(b), false); assert.equal(b.sync.state, 'offline');
  fake.offline = false; fake.expired.add('scalisec@gmail.com');
  assert.equal(await S.syncNow(b), false); assert.equal(b.sync.state, 'signin');
  fake.expired.clear();
  b.busy = true;
  assert.equal(await S.syncNow(b), false, 'waits while a drill or plan is open');
  assert.equal(await S.syncNow(b, { force: true }), true);
  assert.equal(S.statusWords({ state: 'signin' }), 'Sign in to sync');
});

test('samples never become drafts; drafts are offered for reminders after two weeks', async () => {
  const { a } = await team();
  await a.store.save('drills', drill('d_sampl1', { sample: true }));
  assert.equal(S.pubState(await a.store.get('drills', 'd_sampl1')), null);
  await a.store.save('drills', drill('d_old001'));
  const r = await a.store.get('drills', 'd_old001');
  await a.store.put('drills', { ...r, updatedAt: '2026-10-01T00:00:00.000Z' });
  assert.deepEqual((await S.staleDrafts(a)).map(x => x.id), ['d_old001']);
});

/* ---------- 1.4.1: sharing plans with helpers ---------- */
import * as SH from '../../app/cloud/sharing.js';

/** A team with a shared plan ready: a = benchbosslabs (set up), b = scalisec (coach), helper = a third account. */
async function sharingTeam() {
  const t = await team();
  const { a, b, fake } = t;
  for (const x of [a, b]) x.afterPublish = ch => SH.afterPublish(x, ch);
  await a.store.save('drills', drill('d_shdrl1', { title: 'Pivot' }));
  await a.store.save('plans', stamp({ id: 'p_share1', title: 'Tuesday', date: '2099-01-06', blocks: [{ id: 'b1', kind: 'drill', drillId: 'd_shdrl1', minutes: 8 }, { id: 'b2', kind: 'drill', drillId: 'd_shared', minutes: 8 }], deletedAt: null }));
  const plansFile = fake.find('Practice Pilot shared plans · Bulldogs.json');
  return { ...t, plansFile };
}
async function helperDevice(fake, email, link) {
  const h = await device(fake, email);
  await T.signIn(h);
  const [, fileId, folderId, teamName] = /#join\/([^/]+)\/([^/]+)\/(.*)$/.exec(link);
  await SH.setHelper(h, { fileId, folderId, teamName: decodeURIComponent(teamName), email });
  return h;
}

test('library file names, the shared file, and the helper’s 30-day list', () => {
  assert.equal(L.sharedName('U10BB Bulldogs Blue'), 'Practice Pilot shared plans · U10BB Bulldogs Blue.json');
  let doc = L.newShared({ team: { name: 'T' }, by: 'C', at: 'T0' });
  const plan = (id, date, deletedAt = null) => ({ id, title: id, date, blocks: [{ id: 'b', kind: 'drill', drillId: 'd1' }], deletedAt });
  doc = L.shareInto(doc, plan('p_old', '2026-09-01'), [{ id: 'd1' }, { id: 'd2' }], 'C', '2026-09-01T00:00:00Z');
  doc = L.shareInto(doc, plan('p_recent', '2026-11-01'), [{ id: 'd1' }], 'C', 'T');
  doc = L.shareInto(doc, plan('p_next', '2026-11-10'), [{ id: 'd1' }], 'C', 'T');
  doc = L.shareInto(doc, plan('p_later', '2026-11-20'), [{ id: 'd1' }], 'C', 'T');
  assert.deepEqual(doc.plans[0].drills.map(d => d.id), ['d1'], 'only the drills the plan uses');
  assert.deepEqual(L.visibleShared(doc, new Date('2026-11-06T12:00:00')).map(e => e.plan.id), ['p_next', 'p_later', 'p_recent']);
  assert.deepEqual(L.staleShared(doc, { drills: [{ id: 'd1' }] }).length, 4);
  assert.deepEqual(L.staleShared(doc, { plans: [{ id: 'p_next' }] }), ['p_next']);
  assert.equal(L.unshareFrom(doc, 'p_next', 'C', 'T2').plans.length, 3);
});

test('share a plan: it’s published first, helpers get it, and a changed drill updates their copy', async () => {
  const { fake, a } = await sharingTeam();
  const link = await SH.sharePlan(a, 'p_share1', { dialog: answer('all') });
  assert.match(link, /#join\/[^/]+\/[^/]+\/Bulldogs$/);
  assert.equal(S.pubState(await a.store.get('plans', 'p_share1')), 'published', 'shared = published');
  const file = fake.find('Practice Pilot shared plans · Bulldogs.json');
  assert.deepEqual(fake.read(file.id).plans[0].drills.map(d => d.title).sort(), ['Drill d_shared', 'Pivot']);
  assert.equal(fake.read(fake.find('Practice Pilot library · Bulldogs.json').id).team.sharedPlansId, file.id, 'every coach can find it');
  // a change to one of its drills, published, reaches the shared copy right away (decided Nov 6)
  await a.store.save('drills', { ...(await a.store.get('drills', 'd_shdrl1')), title: 'Pivot and go' });
  await S.publishItems(a, 'drills', 'd_shdrl1', { dialog: answer(null) });
  assert.ok(fake.read(file.id).plans[0].drills.some(d => d.title === 'Pivot and go'));
  // stop sharing
  await SH.unsharePlan(a, 'p_share1');
  assert.equal(fake.read(file.id).plans.length, 0);
});

test('helpers: add by email (Google emails them), list, remove; any coach can, after picking the plans file once', async () => {
  const { fake, a, b, plansFile } = await sharingTeam();
  await SH.sharePlan(a, 'p_share1', { dialog: answer('all') });
  assert.equal(await SH.addHelper(a, ' Helper@Example.com '), 'helper@example.com');
  assert.equal(fake.mail.at(-1).to, 'helper@example.com');
  assert.match(fake.mail.at(-1).message, /helper for Bulldogs/);
  assert.equal(fake.file(plansFile.id).shared['helper@example.com'], 'reader', 'a Viewer on the file itself, not a folder');
  assert.match(fake.mail.at(-1).message, /#join\//, 'the email carries the link');
  assert.match(fake.mail.at(-1).message, /Quick start guide: https:\/\/docs\.google\.com\/document\/d\/1EGIkRT0o/, 'and the helper quick start');
  // the second coach: their app can't open the file until they pick it (picking the folder isn't enough: Nov 8 trial)
  await S.syncNow(b, { force: true });
  b.pickQueue.push({ id: fake.find('Bulldogs').id });
  await assert.rejects(SH.listHelpers(b), /isn’t Bulldogs’s shared-plans file/);
  b.pickQueue.push({ id: plansFile.id });
  const list = await SH.listHelpers(b);
  assert.deepEqual(list.map(h => h.email), ['helper@example.com']);
  await SH.addHelper(b, 'second@example.com');
  await SH.removeHelper(b, (await SH.listHelpers(b)).find(h => h.email === 'helper@example.com').id);
  assert.deepEqual((await SH.listHelpers(a)).map(h => h.email), ['second@example.com']);
  await assert.rejects(SH.addHelper(a, 'not an email'), /Google email/);
});

test('a helper’s phone: pick the plans file once, see the plans, keep them with no signal, lose them when removed', async () => {
  const { fake, a, plansFile } = await sharingTeam();
  const link = await SH.sharePlan(a, 'p_share1', { dialog: answer('all') });
  await SH.addHelper(a, 'helper@example.com');
  const h = await helperDevice(fake, 'helper@example.com', link);
  assert.equal((await SH.helperLoad(h)).state, 'pick', 'the link alone isn’t enough (Nov 6 trial)');
  h.pickQueue.push({ id: fake.find('Bulldogs').id });
  await assert.rejects(SH.helperPick(h), /isn’t Bulldogs’s plans/);
  h.pickQueue.push({ id: plansFile.id });
  const r = await SH.helperPick(h);
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.doc.plans.map(e => e.plan.title), ['Tuesday']);
  await assert.rejects(h.drive.readJson(fake.find('Practice Pilot library · Bulldogs.json').id), e => e.status === 404, 'a helper can’t open the library');
  fake.offline = true;
  const off = await SH.helperLoad(h);
  assert.equal(off.state, 'offline'); assert.equal(off.doc.plans.length, 1, 'kept for no signal');
  fake.offline = false;
  fake.unshare(plansFile.id, 'helper@example.com');
  const gone = await SH.helperLoad(h);
  assert.equal(gone.state, 'gone');
  assert.equal(await SH.helperCache(h), null, 'the saved plans leave the phone');
});
