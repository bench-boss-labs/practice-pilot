/* 1.5.1 Club library: a coach asks from the drill's Share dialog; Bench Boss Labs adds it in Admin › Club library;
   a coach on another team picks the club file once, finds it under Show › Club library and imports a draft copy. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, SIZES } from './helpers.mjs';
import { FakeDrive } from '../fake-drive.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });
const ADMIN = 'benchbosslabs@gmail.com', COACH = 'scalisec@gmail.com';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
// a 2 × 2 blue PNG for the logo
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNkYPjPwMDAxMDAwMDAAAAWBgEBn6w2KQAAAABJRU5ErkJggg==', 'base64');

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
    const one = x => { fake.pick(email, x); return { id: x, name: fake.file(x).name, kind }; };
    return Array.isArray(id) ? id.map(one) : one(id);
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
const toSettings = async page => { await page.goto(env.server.url + '#settings/device'); await page.waitForSelector('#cloud-card h2'); };
const settled = page => page.waitForFunction(() => !document.querySelector('#cloud-card button[disabled]'));
const quiet = page => page.waitForFunction(() => { const s = document.getElementById('admin-status'); return s && !s.textContent; });

test('Club library: ask from Share, add in Admin, import on another team', async () => {
  const fake = new FakeDrive();
  const OTHER = 'other@example.com';
  const f1 = fake.addFolder('Bulldogs', ADMIN, { shared: { [COACH]: 'writer' } });
  const f2 = fake.addFolder('Barracudas', ADMIN, { shared: { [OTHER]: 'writer' } });
  // Bench Boss Labs sets up both teams (Settings › Set up a team, then Admin › Adopt a folder)
  const tab = await device(fake, ADMIN, { picks: [f1, f2] });
  await toSettings(tab.page);
  await tab.page.click('#google-signin'); await settled(tab.page);
  await tab.page.click('#setup-team'); await settled(tab.page);
  await tab.page.goto(env.server.url + '#admin');
  await tab.page.waitForSelector('#adopt-team');
  await tab.page.click('#adopt-team');
  await tab.page.waitForSelector('#admin-team-title:has-text("Barracudas")');
  // the club library: made when first opened; every coach given access
  await tab.page.click('#admin-tab-club').catch(() => tab.page.goto(env.server.url + '#admin/club'));
  await tab.page.goto(env.server.url + '#admin/club');
  await tab.page.waitForSelector('#club-requests:has-text("No requests")');
  await tab.page.click('#share-club');
  await tab.page.waitForSelector('.toast:has-text("2 coaches can now see the club library")');
  const club = fake.find('Practice Pilot club library.json');

  // the Bulldogs coach asks for a new drill (a draft: published first)
  const lib1 = fake.find('Practice Pilot library · Bulldogs.json');
  const pc = await device(fake, COACH, { size: 'tablet', picks: [lib1.id] });
  await toSettings(pc.page);
  await pc.page.click('#google-signin'); await settled(pc.page);
  await pc.page.click('#join-team'); await settled(pc.page);
  await pc.page.goto(env.server.url + '#library');
  await pc.page.click('#new-drill-btn'); await pc.page.waitForSelector('#editor-title');
  await pc.page.click('#tab-details'); await pc.page.fill('#title', 'Barracuda breakout');
  await pc.page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved');
  const id = await pc.page.evaluate(() => location.hash.split('/')[1]);
  await pc.page.goto(env.server.url + '#library/' + id); await pc.page.waitForSelector('#share-drill');
  await pc.page.click('#share-drill');
  for (const x of ['#pick-video', '#pick-sheet']) if (await pc.page.isChecked(x)) await pc.page.click(x);
  await pc.page.click('#pick-club');
  await pc.page.click('#make-send');
  await pc.page.waitForSelector('#publish-confirm'); await pc.page.click('#publish-confirm button:has-text("Publish")');
  await pc.page.waitForSelector('#sharedrill-status:has-text("Sent to Bench Boss Labs")');
  assert.deepEqual(fake.read(lib1.id).requests.map(r => r.drillId), [id]);

  // Admin: the request, with its team; Add
  await tab.page.goto(env.server.url + '#admin/club'); await tab.page.reload();
  await tab.page.waitForSelector('#club-requests:has-text("Barracuda breakout")');
  assert.match(await tab.page.textContent('#club-requests'), /Bulldogs/);
  await tab.page.click('[data-add="Barracuda breakout"]');
  await tab.page.waitForSelector('#club-drills:has-text("Barracuda breakout")');
  assert.deepEqual(fake.read(club.id).drills.map(d => d.title), ['Barracuda breakout']);

  // the Barracudas coach: Show › Club library, pick the club file once, import
  const lib2 = fake.find('Practice Pilot library · Barracudas.json');
  const ph = await device(fake, OTHER, { size: 'tablet', picks: [lib2.id, club.id] });
  await toSettings(ph.page);
  await ph.page.click('#google-signin'); await settled(ph.page);
  await ph.page.click('#join-team'); await settled(ph.page);
  await ph.page.goto(env.server.url + '#library'); await ph.page.waitForSelector('#f-show');
  await ph.page.click('#f-show'); await ph.page.click('#pick-show .pp-tagchip:has-text("Drills")'); await ph.page.click('#pick-show .pp-tagchip:has-text("Club library")'); await ph.page.click('#pick-show button:has-text("Done")');
  await ph.page.waitForSelector('#pick-club');
  await ph.page.click('#pick-club');
  await ph.page.waitForSelector('.pp-card:has-text("Barracuda breakout") .pp-pill-club');
  assert.doesNotMatch(await ph.page.textContent('#cards'), /Bulldogs/, 'which team sent it isn’t shown');
  await ph.page.click('.pp-card:has-text("Barracuda breakout")');
  await ph.page.click('#import-club');
  await ph.page.waitForSelector('.toast:has-text("is in your Library as a draft")');
  const mine = (await ph.page.evaluate(() => window.__pp.store.all('drills'))).find(d => d.title === 'Barracuda breakout');
  assert.ok(mine && mine.sourceDrillId === id && mine.pub.state === 'draft');
  await ph.page.waitForSelector('#edit-drill');
  assert.deepEqual(tab.page.errors, []); assert.deepEqual(pc.page.errors, []); assert.deepEqual(ph.page.errors, []);
  await tab.ctx.close(); await pc.ctx.close(); await ph.ctx.close();
});
