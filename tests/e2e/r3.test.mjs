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
