/* 1.5.0 Admin: Bench Boss Labs makes a team with a logo and colours, adds a coach, who joins from the emailed
   link by picking both team files; renaming reaches the coach; archiving removes their access. */
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

test('Admin: a new team with logo and colours; a coach is added, joins from the email link, and sees the team’s look', async () => {
  const fake = new FakeDrive();
  const tab = await device(fake, ADMIN);
  assert.ok(await tab.page.isHidden('#nav a[data-screen="admin"]'), 'no Admin until Bench Boss Labs signs in');
  await toSettings(tab.page);
  await tab.page.click('#google-signin'); await settled(tab.page);
  await tab.page.waitForSelector('#nav a[data-screen="admin"]:not([hidden])');
  await tab.page.click('#nav a[data-screen="admin"]');
  await tab.page.waitForSelector('#team-list:has-text("No teams yet")');

  await tab.page.click('#new-team');
  await tab.page.fill('#team-name-input', 'U13B Barracudas');
  await tab.page.setInputFiles('#logo-file', { name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await tab.page.waitForSelector('#look-preview img');
  await tab.page.click('[aria-label="#1d4ed8"] >> nth=0');
  await tab.page.click('#create-team');
  await tab.page.waitForSelector('#admin-team-title:has-text("U13B Barracudas")');
  const lib = fake.find('Practice Pilot library · U13B Barracudas.json'), plans = fake.find('Practice Pilot shared plans · U13B Barracudas.json');
  const team = fake.read(lib.id).team;
  assert.match(team.logo, /^data:image\/png;base64,/);
  assert.equal(team.mainColour, '#1d4ed8');
  assert.deepEqual(team.colours, ['blue', 'white']);
  assert.equal(plans.parents[0], lib.parents[0], 'side by side in the team folder');

  // add a coach
  await quiet(tab.page);
  await tab.page.fill('#coach-email', COACH);
  await tab.page.click('#add-coach');
  await tab.page.waitForSelector(`#coach-list:has-text("${COACH}")`);
  const mail = fake.mail.at(-1);
  assert.equal(mail.to, COACH);
  const link = /(http\S+#team\/\S+)/.exec(mail.message)[1];

  // the coach's phone: the link, sign in, pick both files
  const ph = await device(fake, COACH, { size: 'phone', picks: [[lib.id, plans.id]] });
  await ph.page.goto(link);
  await ph.page.waitForSelector('#team-join:has-text("Join U13B Barracudas")');
  await ph.page.click('#join-signin');
  await ph.page.click('#join-pick');
  await ph.page.waitForSelector('#move-in').then(() => ph.page.click('#move-in button:has-text("Leave them here")')).catch(() => {});
  await ph.page.waitForFunction(() => location.hash === '#library');
  await ph.page.waitForSelector('#team-pill img.pp-pilllogo');
  assert.match(await ph.page.textContent('#team-pill'), /U13B Barracudas/);
  assert.ok(await ph.page.isHidden('#nav a[data-screen="admin"]'), 'coaches don’t see Admin');
  assert.equal(await ph.page.evaluate(() => window.__pp.team.colours[0]), 'blue', 'new players will be blue');

  // rename in Admin; the coach gets it on the next sync
  await tab.page.fill('#team-name-input', 'U13B Burlington Barracudas');
  await tab.page.click('#save-team');
  await tab.page.waitForSelector('#admin-team-title:has-text("U13B Burlington Barracudas")');
  assert.equal(fake.file(lib.parents[0]).name, 'U13B Burlington Barracudas');
  await ph.page.evaluate(() => window.__pp.catchUp());
  await ph.page.waitForFunction(() => /U13B Burlington Barracudas/.test(document.getElementById('team-pill').textContent));

  // the team list
  await tab.page.click('a:has-text("‹ Teams")');
  await tab.page.waitForSelector('.pp-teamcard[data-team="U13B Burlington Barracudas"]');

  // archive: the coach loses access
  await tab.page.click('.pp-teamcard');
  await tab.page.waitForSelector(`#coach-list:has-text("${COACH}")`);
  await tab.page.click('#archive-team');
  await tab.page.click('#archive-confirm button:has-text("Archive")');
  await tab.page.waitForSelector('#archived-teams');
  assert.deepEqual(fake.file(lib.parents[0]).shared, {});
  assert.deepEqual(tab.page.errors, []); assert.deepEqual(ph.page.errors, []);
  await tab.ctx.close(); await ph.ctx.close();
});

test('Admin: the team set up before 1.5.0 is listed; Update sharing fixes it; adopt a hand-made folder', async () => {
  const fake = new FakeDrive();
  const folder = fake.addFolder('U10BB Bulldogs Blue', ADMIN);
  const hand = fake.addFolder('Hand-made test', ADMIN);
  const tab = await device(fake, ADMIN, { picks: [folder, hand] });
  await toSettings(tab.page);
  await tab.page.click('#google-signin'); await settled(tab.page);
  await tab.page.click('#setup-team'); await settled(tab.page);
  // make it look like 1.4.x: the plans file inside a "shared" folder
  const plans = fake.find('Practice Pilot shared plans · U10BB Bulldogs Blue.json');
  const shared = fake.addFolder('shared', ADMIN, { parent: folder, shared: { 'helper@example.com': 'reader' } });
  fake.file(shared).app.add(ADMIN);
  fake.file(plans.id).parents = [shared];
  await tab.page.click('#open-admin');
  await tab.page.waitForSelector('.pp-teamcard[data-team="U10BB Bulldogs Blue"]:has-text("Sharing needs updating")');
  await tab.page.click('.pp-teamcard');
  await tab.page.click('#update-sharing-btn');
  await tab.page.waitForSelector('.toast:has-text("Sharing updated; 1 helper carried over")');
  await tab.page.waitForSelector('#admin-helpers:has-text("helper@example.com")');
  assert.equal(fake.file(plans.id).parents[0], folder);
  assert.equal(await tab.page.locator('#update-sharing').count(), 0);
  await tab.page.click('a:has-text("‹ Teams")');
  await tab.page.click('#adopt-team');
  await tab.page.waitForSelector('#admin-team-title:has-text("Hand-made test")');
  assert.ok(fake.find('Practice Pilot library · Hand-made test.json'));
  assert.deepEqual(tab.page.errors, []);
  await tab.ctx.close();
});
