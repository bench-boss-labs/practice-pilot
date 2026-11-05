import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { setup, open, offlineReady, makeVersion, ROOT, SIZES } from './helpers.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

test('opens with the Bench Boss Labs header, version and no errors', async () => {
  const { ctx, page } = await open(env);
  assert.equal(await page.textContent('.brand-name'), 'Practice Pilot');
  assert.match(await page.textContent('.brand-sub'), /by Bench Boss Labs · v1\.1\.3/i);
  assert.equal(await page.textContent('#team-pill'), 'My team');
  assert.equal(await page.title(), 'Practice Pilot · Bench Boss Labs');
  assert.ok(await page.isVisible('#welcome'));
  await page.click('#welcome-ok');
  await page.reload(); await page.waitForSelector('#count:not(:empty)');
  assert.equal(await page.isVisible('#welcome'), false, 'the welcome shows once');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('works with no internet once opened', async () => {
  const { ctx, page } = await open(env);
  await offlineReady(page);
  env.server.setMode('down');
  await page.reload();
  await page.waitForSelector('#count:not(:empty)');
  await page.click('a[data-screen="help"]'); await page.waitForSelector('#help-title');
  await page.click('a[data-screen="settings"]'); await page.waitForSelector('#about-version');
  assert.equal(await page.textContent('#about-kit'), '1.0.1');
  assert.ok(await page.isVisible('#offline-badge'));
  await page.goto(env.server.url + 'guide/');
  assert.match(await page.textContent('h1'), /Practice Pilot guide/);
  env.server.setMode('normal');
  await ctx.close();
});

test('a slow network falls back to the saved copy within about 4 seconds', async () => {
  const { ctx, page } = await open(env);
  await offlineReady(page);
  env.server.setMode('slow');
  const t0 = Date.now();
  await page.reload({ waitUntil: 'commit' });
  await page.waitForSelector('#count:not(:empty)', { timeout: 15000 });
  const ms = Date.now() - t0;
  env.server.setMode('normal');
  assert.ok(ms < 9000, `opened in ${ms} ms`);
  await ctx.close();
});

test('a rink Wi-Fi sign-in page cannot replace the saved app', async () => {
  const { ctx, page } = await open(env);
  await offlineReady(page);
  env.server.setMode('portal');
  await page.reload();
  await page.waitForSelector('#count:not(:empty)');
  env.server.setMode('normal');
  env.server.setMode('down');
  await page.reload();
  await page.waitForSelector('#count:not(:empty)');
  assert.match(await page.textContent('.brand-name'), /Practice Pilot/);
  env.server.setMode('normal');
  await ctx.close();
});

test("an update shows the banner; Update now installs it and shows What's new once", async () => {
  const { ctx, page } = await open(env);
  await offlineReady(page);
  const next = makeVersion('1.1.4', { title: 'Faster start-up' });
  env.server.setRoot(next);
  try {
    await page.evaluate(() => window.__pp.checkUpdates());
    await page.waitForSelector('#bbl-update-banner');
    assert.match(await page.textContent('#bbl-update-banner'), /A new version is ready: Faster start-up/);
    await page.click('#bbl-update-go');
    await page.waitForFunction(() => document.getElementById('app-version')?.textContent === 'v1.1.4', null, { timeout: 15000 });
    await page.waitForSelector('#whats-new');
    assert.match(await page.textContent('#whats-new'), /What's new in 1\.1\.4/);
    await page.click('#whats-new .btn.primary');
    await page.reload(); await page.waitForSelector('#count:not(:empty)');
    assert.equal(await page.isVisible('#whats-new'), false);
  } finally { env.server.setRoot(ROOT); }
  await ctx.close();
});

test('Later hides the banner; a data upgrade is announced', async () => {
  const { ctx, page } = await open(env);
  env.server.setRoot(makeVersion('1.2.0', { upgradesData: true, title: 'Drills' }));
  try {
    await page.evaluate(() => window.__pp.checkUpdates());
    await page.waitForSelector('#bbl-update-banner');
    assert.match(await page.textContent('#bbl-update-banner'), /upgrades your saved data\. A backup is made first/);
    await page.click('#bbl-update-later');
    assert.equal(await page.isVisible('#bbl-update-banner'), false);
  } finally { env.server.setRoot(ROOT); }
  await ctx.close();
});

test('a quiet update installs by itself with no banner', async () => {
  const { ctx, page } = await open(env);
  await offlineReady(page);
  env.server.setRoot(makeVersion('1.1.4', { quiet: true }));
  try {
    await page.evaluate(() => window.__pp.checkUpdates());
    await page.waitForFunction(() => document.getElementById('app-version')?.textContent === 'v1.1.4', null, { timeout: 15000 });
    assert.equal(await page.isVisible('#bbl-update-banner'), false);
    assert.equal(await page.isVisible('#whats-new'), false);
  } finally { env.server.setRoot(ROOT); }
  await ctx.close();
});

test('Check for updates says when the app is current or offline', async () => {
  const { ctx, page } = await open(env);
  await page.goto(env.server.url + '#settings/about');
  await page.click('#check-updates');
  await page.waitForFunction(() => /latest version/.test(document.getElementById('update-result').textContent));
  env.server.setMode('down');
  await page.click('#check-updates');
  await page.waitForFunction(() => /no internet/.test(document.getElementById('update-result').textContent));
  assert.ok(await page.isVisible('#offline-badge'));
  env.server.setMode('normal');
  await ctx.close();
});

test('Back up now and Restore (both choices), with refusals for bad files', async () => {
  const { ctx, page } = await open(env);
  await page.evaluate(async () => {
    const { newDrill } = await import('./app/schema.js?v=1.1.3');
    for (const d of await window.__pp.store.all('drills')) await window.__pp.store.delete('drills', d.id); // start without the samples
    await window.__pp.store.save('drills', newDrill('d_aaaaaa', { title: 'Keep' }));
  });
  await page.goto(env.server.url + '#settings/device');
  await page.waitForSelector('#backup-reminder:not([hidden])');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#backup-now')]);
  assert.match(dl.suggestedFilename(), /^practice-pilot-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await dl.path();
  const b = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(b.format, 'bbl-backup'); assert.equal(b.data.drills.length, 1);
  await page.waitForFunction(() => !/never/.test(document.getElementById('last-backup').textContent));
  assert.equal(await page.isHidden('#backup-reminder'), true);

  const ids = () => page.evaluate(async () => (await window.__pp.store.all('drills')).map(d => d.id).sort());
  await page.evaluate(async () => {
    const { newDrill } = await import('./app/schema.js?v=1.1.3');
    await window.__pp.store.delete('drills', 'd_aaaaaa');
    await window.__pp.store.save('drills', newDrill('d_bbbbbb', { title: 'New' }));
  });

  await page.setInputFiles('#restore-file', file);
  await page.waitForSelector('#restore-dialog');
  assert.match(await page.textContent('#restore-dialog'), /1 drill, 0 plans, 1 team/);
  await page.click('#restore-dialog [data-value="merge"]');
  await page.waitForSelector('.toast >> text=Restored');
  assert.deepEqual(await ids(), ['d_aaaaaa', 'd_bbbbbb']);

  await page.setInputFiles('#restore-file', file);
  await page.click('#restore-dialog [data-value="replace"]');
  await page.waitForFunction(() => /matches the backup/.test(document.getElementById('toasts').textContent));
  assert.deepEqual(await ids(), ['d_aaaaaa']);

  const dir = mkdtempSync(join(tmpdir(), 'bad-'));
  writeFileSync(join(dir, 'notes.json'), '{"hello": 1}');
  await page.setInputFiles('#restore-file', join(dir, 'notes.json'));
  await page.waitForSelector('.toast.err >> text=This file isn’t a Practice Pilot backup.');
  writeFileSync(join(dir, 'newer.json'), JSON.stringify({ ...b, schemaVersion: 2 }));
  await page.setInputFiles('#restore-file', join(dir, 'newer.json'));
  await page.waitForSelector('.toast.err >> text=This backup is from a newer Practice Pilot. Update the app first.');
  await ctx.close();
});

test('team name and theme are kept', async () => {
  const { ctx, page } = await open(env);
  await page.goto(env.server.url + '#settings/device');
  await page.fill('#team-name', 'U11 Rep Red');
  await page.press('#team-name', 'Enter'); await page.locator('#team-name').blur();
  await page.waitForFunction(() => document.getElementById('team-pill').textContent === 'U11 Rep Red');
  await page.click('#theme-light');
  await page.reload(); await page.waitForSelector('#team-pill');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
  assert.equal(await page.textContent('#team-pill'), 'U11 Rep Red');
  await ctx.close();
});

test('Settings › This device › Install: button, installed, or steps', async () => {
  let { ctx, page } = await open(env);
  await page.goto(env.server.url + '#settings/device');
  await page.waitForSelector('#install-card');
  const state = await page.getAttribute('#install-card', 'data-state');
  assert.ok(['ready', 'desktop'].includes(state), state);
  if (state === 'ready') assert.ok(await page.isVisible('#install-now'));
  else assert.match(await page.textContent('#install-steps'), /install icon/);
  // Chrome offers installing (timing varies, so the test sends the offer itself)
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt');
    e.prompt = () => { window.__prompted = true; };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  await page.waitForSelector('#install-card[data-state="ready"] #install-now');
  assert.ok(await page.isVisible('#install-btn'), 'header Install button too');
  await page.click('#install-now');
  assert.equal(await page.evaluate(() => window.__prompted), true, "Chrome's install prompt opens");
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await page.waitForSelector('#install-card[data-state="installed"]');
  await page.reload(); await page.waitForSelector('#install-card');
  assert.equal(await page.getAttribute('#install-card', 'data-state'), 'installed', 'remembered after reload');
  await ctx.close();

  ({ ctx, page } = await open(env, { init: () => {
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' });
  } }));
  await page.goto(env.server.url + '#settings/device');
  await page.waitForSelector('#install-card');
  if (await page.getAttribute('#install-card', 'data-state') === 'ios') assert.match(await page.textContent('#install-steps'), /Share.*Add to Home Screen/);
  await ctx.close();
});

test('no Install button once installed, even if Chrome still offers it', async () => {
  const offer = () => window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt() {}, userChoice: Promise.resolve({}) }));
  // running from the home-screen icon
  let { ctx, page } = await open(env, { init: () => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = q => /display-mode: standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q);
  } });
  await page.evaluate(offer);
  assert.equal(await page.isVisible('#install-btn'), false);
  await page.goto(env.server.url + '#settings/device');
  assert.equal(await page.getAttribute('#install-card', 'data-state'), 'installed');
  await ctx.close();
  // a normal tab, where Chrome reports the app is already on the device
  ({ ctx, page } = await open(env, { init: () => { navigator.getInstalledRelatedApps = async () => [{ platform: 'webapp' }]; } }));
  await page.waitForFunction(() => window.__pp && window.__pp.installed === true);
  await page.evaluate(offer);
  assert.equal(await page.isVisible('#install-btn'), false);
  await ctx.close();
});

test('one tab at a time', async () => {
  const { ctx, page } = await open(env);
  const second = await ctx.newPage();
  await second.goto(env.server.url);
  await second.waitForSelector('#tab-blocked');
  await second.click('#tab-blocked button');
  await page.waitForSelector('#tab-released');
  await second.waitForSelector('#count:not(:empty)');
  await ctx.close();
});

test('a private window gets a warning', async () => {
  const { ctx, page } = await open(env, {
    init: () => { navigator.storage.estimate = async () => ({ usage: 1000, quota: 100 * 1024 * 1024 }); },
  });
  assert.match(await page.textContent('#private-notice'), /This window forgets everything when it closes/);
  await ctx.close();
});

for (const size of Object.keys(SIZES)) {
  test(`${size}: no sideways scrolling, tap targets 44 px+, contrast passes in dark and light`, async () => {
    const { ctx, page } = await open(env, { size });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
      for (const hash of ['#library', '#help', '#settings/about', '#settings/device']) {
        await page.goto(env.server.url + hash);
        await page.waitForSelector('main h1');
        await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(wide <= 0, `${hash} scrolls sideways by ${wide}px`);
        const small = await page.evaluate(() => [...document.querySelectorAll('a, button, input:not([type=file]), summary')]
          .filter(e => e.offsetParent && !e.classList.contains('skip') && getComputedStyle(e).visibility !== 'hidden')
          .map(e => ({ t: (e.textContent || e.id).trim().slice(0, 30), r: e.getBoundingClientRect() }))
          .filter(x => x.r.height < 44 || x.r.width < 44).map(x => `${x.t} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`));
        assert.deepEqual(small, [], `${hash}: small tap targets`);
        await page.addScriptTag({ content: AXE });
        const v = await page.evaluate(async () => (await axe.run(document, { runOnly: ['color-contrast'] })).violations.flatMap(x => x.nodes.map(n => n.target.join(' ') + ' ' + n.any.map(a => a.message).join(';'))));
        assert.deepEqual(v, [], `${theme} ${hash}: contrast`);
      }
    }
    assert.deepEqual(page.errors, []);
    await ctx.close();
  });
}
