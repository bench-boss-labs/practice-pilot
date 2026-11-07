/* R3 stage 1: signing in, setting up a team (benchbosslabs only), joining by picking the library once,
   leaving and changing team. Google sign-in, the file picker and Drive are a fake that follows the drive.file rule. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, SIZES } from './helpers.mjs';
import { FakeDrive } from '../fake-drive.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });
const ADMIN = 'benchbosslabs@gmail.com', COACH = 'scalisec@gmail.com';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };

/** A device signed in (when asked) as `email`. picks: what the file picker returns next (Drive ids). */
async function device(fake, email, { size = 'tablet', picks = [] } = {}) {
  env.server.setMode('normal');
  const s = SIZES[size];
  const ctx = await env.browser.newContext({ viewport: { width: s.width, height: s.height }, hasTouch: !!s.hasTouch, isMobile: !!s.isMobile });
  await ctx.route(/googleapis\.com/, async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    try {
      const out = await fake.handle({ url: r.url(), method: r.method(), headers: await r.allHeaders(), body: r.postData() || '' });
      return route.fulfill({ status: out.status, headers: { ...CORS, 'content-type': 'application/json' }, body: out.body });
    } catch { return route.abort('internetdisconnected'); }
  });
  await ctx.exposeBinding('__ppPick', async (_src, kind) => {
    const id = picks.shift();
    if (!id) return null;
    fake.pick(email, id);
    return { id, name: fake.file(id).name, kind };
  });
  await ctx.addInitScript(([email, token]) => {
    window.__ppGoogle = {
      t: sessionStorage.getItem('fake-pass'),
      token() { return this.t; },
      async signIn() { this.t = token; sessionStorage.setItem('fake-pass', token); return token; },
      signOut() { this.t = null; sessionStorage.removeItem('fake-pass'); },
      pick: ({ kind }) => window.__ppPick(kind),
    };
  }, [email, fake.token(email)]);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  await page.goto(env.server.url);
  await page.waitForSelector('#count:not(:empty)');
  page.picks = picks;
  return { ctx, page };
}
const drills = page => page.evaluate(() => window.__pp.store.all('drills'));
const toSettings = async page => { await page.goto(env.server.url + '#settings/device'); await page.waitForSelector('#cloud-card h2'); };
const settled = page => page.waitForFunction(() => !document.querySelector('#cloud-card button[disabled]'));
async function makeDrill(page, title) {
  await page.goto(env.server.url + '#library');
  await page.click('#new-drill-btn'); await page.waitForSelector('#editor-title');
  await page.click('#tab-details'); await page.fill('#title', title);
  await page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved');
}

test('signed out: the card explains, and nothing else changes', async () => {
  const fake = new FakeDrive();
  const { ctx, page } = await device(fake, COACH);
  await toSettings(page);
  assert.ok(await page.isVisible('#google-signin'));
  assert.match(await page.textContent('#cloud-card'), /its own files/);
  assert.equal(await page.isDisabled('#team-name'), false);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('only benchbosslabs sees Set up a team', async () => {
  const fake = new FakeDrive();
  const { ctx, page } = await device(fake, COACH);
  await toSettings(page);
  await page.click('#google-signin'); await settled(page);
  assert.equal(await page.textContent('#cloud-email'), COACH);
  assert.ok(await page.isVisible('#join-team'));
  assert.equal(await page.locator('#setup-team').count(), 0);
  await ctx.close();
});

test('set up a team on the tablet, then join it from the PC and from a second coach', async () => {
  const fake = new FakeDrive();
  const folder = fake.addFolder('U10BB Bulldogs Blue', ADMIN, { shared: { [COACH]: 'writer' } });

  // the tablet (benchbosslabs): a drill of its own moves in; samples stay
  const tab = await device(fake, ADMIN, { picks: [folder] });
  await makeDrill(tab.page, 'Tablet drill');
  await toSettings(tab.page);
  await tab.page.click('#google-signin'); await settled(tab.page);
  await tab.page.click('#setup-team');
  await tab.page.waitForSelector('#move-in');
  await tab.page.click('#move-in button:has-text("Move them into the team library")');
  await settled(tab.page);
  assert.equal(await tab.page.textContent('#cloud-team'), 'U10BB Bulldogs Blue');
  assert.equal(await tab.page.textContent('#team-pill'), 'U10BB Bulldogs Blue');
  assert.ok(await tab.page.isDisabled('#team-name'));
  const lib = fake.find('Practice Pilot library · U10BB Bulldogs Blue.json');
  assert.deepEqual(fake.read(lib.id).drills.map(d => d.title), ['Tablet drill']);
  assert.ok(fake.find('shared'));
  const mine = (await drills(tab.page)).find(d => d.title === 'Tablet drill');
  assert.equal(mine.pub.state, 'published');
  assert.ok((await drills(tab.page)).filter(d => d.sample).every(d => !d.pub), 'samples stay on the device');

  // the second coach's PC: joins by picking the library; their own drill stays a draft
  const pc = await device(fake, COACH, { size: 'pc', picks: [lib.id] });
  await makeDrill(pc.page, 'PC drill');
  await toSettings(pc.page);
  await pc.page.click('#google-signin'); await settled(pc.page);
  await pc.page.click('#join-team');
  await pc.page.waitForSelector('#move-in');
  await pc.page.click('#move-in button:has-text("Leave them here")');
  await settled(pc.page);
  assert.equal(await pc.page.textContent('#cloud-team'), 'U10BB Bulldogs Blue');
  const got = await drills(pc.page);
  const fromTeam = got.find(d => d.title === 'Tablet drill');
  assert.equal(fromTeam.pub.state, 'published');
  assert.ok(fromTeam.thumb && fromTeam.thumb.startsWith('<svg'), 'the picture is redrawn on this device');
  assert.equal(got.find(d => d.title === 'PC drill').pub.state, 'draft');
  await pc.page.goto(env.server.url + '#library');
  await pc.page.waitForSelector('.pp-card');
  assert.match(await pc.page.textContent('main'), /Tablet drill/);
  assert.deepEqual(tab.page.errors, []); assert.deepEqual(pc.page.errors, []);
  await tab.ctx.close(); await pc.ctx.close();
});

test('a coach the folder isn’t shared with gets a clear message, and nothing changes', async () => {
  const fake = new FakeDrive();
  const folder = fake.addFolder('Team', ADMIN);
  const tab = await device(fake, ADMIN, { picks: [folder] });
  await toSettings(tab.page);
  await tab.page.click('#google-signin'); await settled(tab.page);
  await tab.page.click('#setup-team'); await settled(tab.page);
  const lib = fake.find('Practice Pilot library · Team.json');
  const pc = await device(fake, COACH, { picks: [lib.id] });
  await toSettings(pc.page);
  await pc.page.click('#google-signin'); await settled(pc.page);
  await pc.page.click('#join-team'); await settled(pc.page);
  assert.match(await pc.page.textContent('#cloud-status'), /isn’t in Google Drive any more|no longer shared/);
  assert.ok(await pc.page.isVisible('#join-team'), 'still not in a team');
  await tab.ctx.close(); await pc.ctx.close();
});

test('leave the team: drills stay on the device; sign out keeps the team to view; offline explains', async () => {
  const fake = new FakeDrive();
  const folder = fake.addFolder('Team', ADMIN);
  const { ctx, page } = await device(fake, ADMIN, { picks: [folder] });
  await makeDrill(page, 'Keep me');
  await toSettings(page);
  await page.click('#google-signin'); await settled(page);
  await page.click('#setup-team');
  await page.click('#move-in button:has-text("Move them into the team library")'); await settled(page);
  await page.click('#google-signout'); await settled(page);
  assert.equal(await page.textContent('#cloud-email'), 'Signed out');
  assert.ok(await page.isVisible('#google-signin'), 'Sign in to sync');
  await page.click('#google-signin'); await settled(page);
  await page.click('#leave-team');
  await page.click('#leave-confirm button:has-text("Leave team")'); await settled(page);
  assert.ok(await page.isVisible('#join-team'));
  const d = (await drills(page)).find(x => x.title === 'Keep me');
  assert.ok(d && !d.pub, 'kept as this device’s own drill');
  fake.offline = true;
  await page.click('#join-team'); await settled(page);   // the picker gives nothing; no change
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

/* ---------- stage 2: Drafts and Publish, Sync now, the check at Publish ---------- */

/** A team: the tablet (benchbosslabs) set it up, the PC (scalisec) joined. */
async function twoDevices() {
  const fake = new FakeDrive();
  const folder = fake.addFolder('Bulldogs', ADMIN, { shared: { [COACH]: 'writer' } });
  const tab = await device(fake, ADMIN, { picks: [folder] });
  await toSettings(tab.page);
  await tab.page.click('#google-signin'); await settled(tab.page);
  await tab.page.click('#setup-team'); await settled(tab.page);
  const lib = fake.find('Practice Pilot library · Bulldogs.json');
  const pc = await device(fake, COACH, { size: 'pc', picks: [lib.id] });
  await toSettings(pc.page);
  await pc.page.click('#google-signin'); await settled(pc.page);
  await pc.page.click('#join-team'); await settled(pc.page);
  return { fake, lib, tab, pc };
}
const syncNowOn = async page => {
  await page.click('#sync-pill');
  await page.click('#sync-dialog button:has-text("Sync now")');
  await page.waitForFunction(() => /Synced/.test(document.getElementById('sync-pill').textContent));
};
const libDrills = (fake, lib) => fake.read(lib.id).drills.map(d => d.title).sort();

test('a new drill is a Draft until you publish it; the other coach gets it with Sync now', async () => {
  const { fake, lib, tab, pc } = await twoDevices();
  assert.match(await tab.page.textContent('#sync-pill'), /Synced/);
  await makeDrill(tab.page, 'Weave');
  assert.equal(await tab.page.textContent('#pub-status'), 'Draft · only on this device');
  assert.ok(await tab.page.isVisible('#publish-btn'));
  assert.deepEqual(libDrills(fake, lib), [], 'not in the team yet');
  await tab.page.goto(env.server.url + '#library');
  await tab.page.waitForSelector('.pp-card:has-text("Weave") .pp-pill-draft');

  // My drafts filter
  await tab.page.click('#f-show'); await tab.page.click('#pick-show .pp-tagchip:has-text("Drills")'); await tab.page.click('#pick-show .pp-tagchip:has-text("My drafts")'); await tab.page.click('#pick-show button:has-text("Done")');
  assert.equal(await tab.page.locator('.pp-card').count(), 1);

  await tab.page.click('.pp-card:has-text("Weave")');
  await tab.page.click('#publish-drill');
  await tab.page.waitForSelector('.toast:has-text("Published to Bulldogs")');
  assert.deepEqual(libDrills(fake, lib), ['Weave']);
  assert.equal(await tab.page.locator('.pp-card:has-text("Weave") .pp-pill-draft').count(), 0);

  await pc.page.goto(env.server.url + '#library'); await pc.page.waitForSelector('.pp-card');
  assert.equal(await pc.page.locator('.pp-card:has-text("Weave")').count(), 0);
  await syncNowOn(pc.page);
  await pc.page.waitForSelector('.pp-card:has-text("Weave")');
  assert.deepEqual(tab.page.errors, []); assert.deepEqual(pc.page.errors, []);
  await tab.ctx.close(); await pc.ctx.close();
});

test('changing a published drill waits for Publish changes; Discard goes back; the other coach is told', async () => {
  const { fake, lib, tab, pc } = await twoDevices();
  await makeDrill(tab.page, 'Breakout');
  await tab.page.click('#publish-btn'); await tab.page.waitForSelector('.toast:has-text("Published")');
  const id = await tab.page.evaluate(() => location.hash.split('/')[1]);
  await syncNowOn(pc.page);

  // the PC changes it: the team still sees the published one
  await pc.page.goto(env.server.url + '#edit/' + id); await pc.page.waitForSelector('#editor-title');
  await pc.page.click('#tab-details'); await pc.page.fill('#title', 'Breakout (PC)');
  await pc.page.waitForFunction(() => document.getElementById('pub-status').textContent === 'Unpublished changes');
  assert.deepEqual(libDrills(fake, lib), ['Breakout']);

  // the tablet hears about it when it opens the drill
  await tab.page.goto(env.server.url + '#library'); await tab.page.waitForSelector('.pp-card');
  await syncNowOn(tab.page);
  await tab.page.goto(env.server.url + '#edit/' + id); await tab.page.waitForSelector('#editor-title');
  await tab.page.waitForSelector('.toast:has-text("has unpublished changes to this drill")');

  // the PC discards
  await pc.page.click('#drill-menu'); await pc.page.click('#drill-actions button:has-text("Discard changes")');
  await pc.page.click('#discard-confirm button:has-text("Discard changes")');
  await pc.page.waitForFunction(() => document.getElementById('editor-title') && document.getElementById('editor-title').textContent === 'Breakout');
  assert.match(await pc.page.textContent('#pub-status'), /Published to Bulldogs/);
  await tab.ctx.close(); await pc.ctx.close();
});

test('both coaches change the same drill: the second to publish is asked, and Keep both keeps both', async () => {
  const { fake, lib, tab, pc } = await twoDevices();
  await makeDrill(tab.page, 'Shared');
  await tab.page.click('#publish-btn'); await tab.page.waitForSelector('.toast:has-text("Published")');
  const id = await tab.page.evaluate(() => location.hash.split('/')[1]);
  await syncNowOn(pc.page);
  await pc.page.goto(env.server.url + '#edit/' + id); await pc.page.waitForSelector('#editor-title');
  await pc.page.click('#tab-details'); await pc.page.fill('#title', 'Shared (PC)');
  await pc.page.waitForFunction(() => document.getElementById('pub-status').textContent === 'Unpublished changes');
  await tab.page.click('#tab-details'); await tab.page.fill('#title', 'Shared (tablet)');
  await tab.page.waitForFunction(() => document.getElementById('pub-status').textContent === 'Unpublished changes');
  await tab.page.click('#publish-btn'); await tab.page.waitForSelector('.toast:has-text("Published")');
  await pc.page.click('#publish-btn');
  await pc.page.waitForSelector('#publish-conflict');
  assert.match(await pc.page.textContent('#publish-conflict'), /benchbosslabs published changes to “Shared \(tablet\)”/);
  await pc.page.click('#publish-conflict button:has-text("Keep both")');
  await pc.page.waitForFunction(() => document.getElementById('editor-title') && document.getElementById('editor-title').textContent === 'Shared (tablet)');
  assert.deepEqual(libDrills(fake, lib), ['Shared (PC) (my copy)', 'Shared (tablet)']);
  await tab.ctx.close(); await pc.ctx.close();
});

test('publishing a plan offers to publish its draft drills too', async () => {
  const { fake, lib, tab } = await twoDevices();
  await makeDrill(tab.page, 'In the plan');
  const drillId = await tab.page.evaluate(() => location.hash.split('/')[1]);
  const planId = await tab.page.evaluate(async id => {
    const p = { id: 'p_plantest', title: 'Tuesday', author: '', team: '', sourcePlanId: null, submittedAt: null, date: '', startTime: '', iceMinutes: null, themes: '', notes: '', blocks: [{ id: 'b_1', kind: 'drill', drillId: id, minutes: 8, note: '', helpers: [] }], extraEquipment: [], template: false, deletedAt: null, visibility: 'private' };
    await window.__pp.store.save('plans', p); return p.id;
  }, drillId);
  await tab.page.goto(env.server.url + '#plan/' + planId); await tab.page.waitForSelector('#publish-btn');
  assert.equal(await tab.page.textContent('#pub-status'), 'Draft · only on this device');
  await tab.page.click('#publish-btn');
  await tab.page.waitForSelector('#publish-drills');
  await tab.page.click('#publish-drills button:has-text("Publish both")');
  await tab.page.waitForSelector('.toast:has-text("Published")');
  assert.deepEqual(libDrills(fake, lib), ['In the plan']);
  assert.deepEqual(fake.read(lib.id).plans.map(p => p.title), ['Tuesday']);
  await tab.ctx.close();
});

test('the status in the top bar: offline, Sign in to sync, and publishing offline keeps your work', async () => {
  const { fake, tab } = await twoDevices();
  await makeDrill(tab.page, 'Offline draft');
  fake.offline = true;
  await tab.page.click('#publish-btn');
  await tab.page.waitForSelector('.toast.error, .toast[data-kind="error"], .toast:has-text("connection")');
  assert.equal(await tab.page.textContent('#pub-status'), 'Draft · only on this device');
  await tab.page.goto(env.server.url + '#library'); await tab.page.waitForSelector('.pp-card');
  await tab.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await tab.page.waitForFunction(() => document.getElementById('sync-pill').textContent === 'Offline');
  fake.offline = false; fake.expired.add(ADMIN);
  await tab.page.click('#sync-pill'); await tab.page.click('#sync-dialog button:has-text("Sync now")');
  await tab.page.waitForFunction(() => document.getElementById('sync-pill').textContent === 'Sign in to sync');
  fake.expired.clear();
  await tab.page.evaluate(() => window.__pp.google.signOut());
  await tab.page.click('#sync-pill');     // Sign in to sync: signs in, then catches up
  await tab.page.waitForFunction(() => /Synced/.test(document.getElementById('sync-pill').textContent));
  assert.deepEqual(tab.page.errors, []);
  await tab.ctx.close();
});

/* ---------- 1.4.1: sharing plans with helpers ---------- */

test('share a plan: add a helper, share; on their phone they pick the shared folder once, see the run sheet, play a drill, keep it offline', async () => {
  const { fake, tab } = await twoDevices();
  const HELPER = 'helper@example.com';
  await makeDrill(tab.page, 'Helper drill');
  const drillId = await tab.page.evaluate(() => location.hash.split('/')[1]);
  await tab.page.evaluate(async id => {
    await window.__pp.store.save('plans', { id: 'p_helper1', title: 'Thursday practice', author: '', team: '', sourcePlanId: null, submittedAt: null, date: '2099-01-08', startTime: '18:15', iceMinutes: null, themes: '', notes: '', blocks: [{ id: 'b_1', kind: 'drill', drillId: id, minutes: 10, note: 'Go hard', helpers: ['Sam'] }], extraEquipment: [], template: false, deletedAt: null, visibility: 'private' });
  }, drillId);

  // the coach: Plans › the plan › Share
  await tab.page.goto(env.server.url + '#plans/p_helper1'); await tab.page.waitForSelector('#share-plan');
  await tab.page.click('#share-plan');
  await tab.page.waitForSelector('#share-dialog #helpers-list:has-text("No helpers yet")');
  await tab.page.fill('#helper-email', HELPER);
  await tab.page.click('#add-helper');
  await tab.page.waitForSelector(`#helpers-list:has-text("${HELPER}")`);
  assert.equal(fake.mail.at(-1).to, HELPER, 'Google emails the helper');
  await tab.page.click('#share-plan-btn');
  await tab.page.waitForSelector('#publish-drills');                 // its drill is a draft: publish both
  await tab.page.click('#publish-drills button:has-text("Publish both")');
  await tab.page.waitForSelector('#helper-link');
  const link = await tab.page.inputValue('#helper-link');
  assert.match(link, /#join\//);
  await tab.page.click('#share-dialog button:has-text("Done")');
  await tab.page.waitForSelector('.pp-pill-shared');

  // the helper's phone
  const ph = await device(fake, HELPER, { size: 'phone', picks: [fake.find('shared').id] });
  await ph.page.goto(link);
  await ph.page.waitForSelector('#helper-invite');
  assert.match(await ph.page.textContent('#helper-invite'), /invited to see Bulldogs/);
  assert.ok(await ph.page.isHidden('#nav a[data-screen="library"]'), 'no Library on a helper’s phone');
  await ph.page.click('#helper-signin');
  await ph.page.waitForSelector('#helper-pick');
  await ph.page.click('#helper-pick-btn');
  await ph.page.waitForSelector('#helper-plans a:has-text("Thursday practice")');
  await ph.page.click('#helper-plans a:has-text("Thursday practice")');
  await ph.page.waitForSelector('.pp-runlist');
  assert.match(await ph.page.textContent('main'), /Go hard/);
  assert.match(await ph.page.textContent('main'), /6:15 PM/);
  await ph.page.click('.pp-drill-link:has-text("Helper drill")');
  await ph.page.waitForSelector('#helper-player svg');
  // no signal at the rink
  fake.offline = true;
  await ph.page.goto(env.server.url + '#helper'); await ph.page.reload();
  await ph.page.waitForSelector('#helper-saved:has-text("Offline")');
  assert.ok(await ph.page.isVisible('#helper-plans a:has-text("Thursday practice")'));
  fake.offline = false;

  // the coach changes the drill and publishes: the helper's copy updates (decided Nov 6)
  await tab.page.goto(env.server.url + '#edit/' + drillId); await tab.page.waitForSelector('#editor-title');
  await tab.page.click('#tab-details'); await tab.page.fill('#title', 'Helper drill v2');
  await tab.page.waitForFunction(() => document.getElementById('pub-status').textContent === 'Unpublished changes');
  await tab.page.click('#publish-btn'); await tab.page.waitForSelector('.toast:has-text("Published")');
  await ph.page.reload(); await ph.page.waitForSelector('#helper-saved:has-text("Up to date")');
  await ph.page.click('#helper-plans a:has-text("Thursday practice")');
  await ph.page.waitForSelector('.pp-drill-link:has-text("Helper drill v2")');

  // stop sharing, and the helper can never open the library
  const libId = fake.find('Practice Pilot library · Bulldogs.json').id;
  assert.equal(await ph.page.evaluate(id => window.__pp.drive.readJson(id).then(() => 'opened', e => e.status), libId), 404);
  await tab.page.goto(env.server.url + '#plans/p_helper1'); await tab.page.waitForSelector('#share-plan');
  await tab.page.click('#share-plan'); await tab.page.waitForSelector('#stop-sharing');
  await tab.page.click('#stop-sharing'); await tab.page.waitForSelector('#share-plan-btn');
  await tab.page.click('#share-dialog button:has-text("Done")');
  await ph.page.goto(env.server.url + '#helper'); await ph.page.reload();
  await ph.page.waitForSelector('#helper-screen:has-text("No plans shared yet")');
  assert.deepEqual(tab.page.errors, []); assert.deepEqual(ph.page.errors, []);
  await tab.ctx.close(); await ph.ctx.close();
});

test('a helper who is removed loses the plans; someone who isn’t a helper is told to ask the coach', async () => {
  const { fake, tab } = await twoDevices();
  await tab.page.evaluate(async () => { await window.__pp.store.save('plans', { id: 'p_rm', title: 'Sat', author: '', team: '', sourcePlanId: null, submittedAt: null, date: '2099-01-10', startTime: '', iceMinutes: null, themes: '', notes: '', blocks: [], extraEquipment: [], template: false, deletedAt: null, visibility: 'private' }); });
  await tab.page.goto(env.server.url + '#plans/p_rm'); await tab.page.waitForSelector('#share-plan');
  await tab.page.click('#share-plan'); await tab.page.waitForSelector('#share-plan-btn');
  await tab.page.fill('#helper-email', 'gone@example.com'); await tab.page.click('#add-helper');
  await tab.page.waitForSelector('#helpers-list:has-text("gone@example.com")');
  await tab.page.click('#share-plan-btn'); await tab.page.waitForSelector('#helper-link');
  const link = await tab.page.inputValue('#helper-link');
  const ph = await device(fake, 'gone@example.com', { size: 'phone', picks: [fake.find('shared').id] });
  await ph.page.goto(link); await ph.page.click('#helper-signin'); await ph.page.click('#helper-pick-btn');
  await ph.page.waitForSelector('#helper-plans');
  await tab.page.click('[data-remove="gone@example.com"]');
  await tab.page.waitForSelector('#helpers-list:has-text("No helpers yet")');
  await ph.page.reload();
  await ph.page.waitForSelector('#helper-gone');
  assert.equal(await ph.page.evaluate(() => window.__pp.store.get('meta', 'helper-cache')), null, 'the saved plans left the phone');

  const other = await device(fake, 'stranger@example.com', { size: 'phone', picks: [fake.find('shared').id] });
  await other.page.goto(link); await other.page.click('#helper-signin');
  await other.page.waitForSelector('#helper-pick');
  await other.page.click('#helper-pick-btn');
  await other.page.waitForSelector('#helper-gone');
  assert.match(await other.page.textContent('#helper-gone'), /Ask the coach to add you as a helper/);
  assert.ok(!(await other.page.isVisible('#helper-plans')));
  await tab.ctx.close(); await ph.ctx.close(); await other.ctx.close();
});
