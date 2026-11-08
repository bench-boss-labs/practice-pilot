/* Share a drill (1.4.2, reworked in 1.4.3): tick video / sheet picture / drill file and send them together;
   the drill sheet to print; importing a drill file; QR codes on the printout. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setup, open } from './helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });
const toLibrary = async (page, id = 'd_samplepivot') => { await page.goto(env.server.url + '#library/' + id); await page.waitForSelector('#share-drill'); };

// tests run without a share sheet: files are saved (downloads) instead
const noShareSheet = page => page.evaluate(() => { Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true }); });
const pick = async (page, { video = false, sheet = false, file = false }) => {
  for (const [id, on] of [['#pick-video', video], ['#pick-sheet', sheet], ['#pick-file', file]]) if ((await page.isChecked(id)) !== on) await page.click(id);
};
const downloads = page => { const got = []; page.on('download', d => got.push(d)); return got; };

test('Share: tick what to send; Video makes a video of the drill playing, then Send', async () => {
  const { ctx, page } = await open(env, { size: 'tablet' });
  await page.evaluate(() => { window.__pp.videoSpeed = 6; });    // tests only: record faster than real time
  await toLibrary(page); await noShareSheet(page);
  await page.click('#share-drill');
  await page.waitForSelector('#sharedrill-dialog');
  assert.match(await page.textContent('#sharedrill-dialog'), /What do you want to send\?/);
  assert.match(await page.textContent('#sharedrill-dialog'), /about \d+ seconds/);
  assert.equal(await page.isChecked('#pick-video'), true); assert.equal(await page.isChecked('#pick-sheet'), true); assert.equal(await page.isChecked('#pick-file'), false);
  await pick(page, { video: true });
  const got = downloads(page);
  await page.click('#make-send');
  await page.waitForSelector('#send-files', { timeout: 30000 });
  const info = await page.textContent('#sharedrill-actions');
  assert.match(info, /Ready: video \d+ s, \d+\.\d MB/);
  assert.doesNotMatch(info, /0\.0 MB/, 'the video has frames in it');
  if (!got.length) await page.click('#send-files');
  await page.waitForFunction(() => true); await new Promise(r => setTimeout(r, 300));
  assert.match(got[0].suggestedFilename(), /^Pass, Pivot & Go\.(mp4|webm)$/);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('Share: the video and the sheet picture go together in one send', async () => {
  const { ctx, page } = await open(env, { size: 'tablet' });
  await page.evaluate(() => { window.__pp.videoSpeed = 6; });
  await toLibrary(page); await noShareSheet(page);
  await page.click('#share-drill');
  const got = downloads(page);
  await page.click('#make-send');                                   // video + sheet are ticked to start with
  await page.waitForSelector('#send-files', { timeout: 30000 });
  if (!got.length) { assert.equal(await page.textContent('#send-files'), 'Send 2 files'); await page.click('#send-files'); }
  await page.waitForFunction(() => true); await new Promise(r => setTimeout(r, 500));
  const names = got.map(d => d.suggestedFilename()).sort();
  assert.equal(names.length, 2);
  assert.match(names[0], /^Pass, Pivot & Go - sheet\.png$/);
  assert.match(names[1], /^Pass, Pivot & Go\.(mp4|webm)$/);
  const png = await readFile(await got.find(d => d.suggestedFilename().endsWith('.png')).path());
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.ok(png.length > 20000, 'a real picture of the page');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('Share › Drill sheet: one page with the setup, a picture of each step and its caption', async () => {
  const { ctx, page } = await open(env, { size: 'tablet' });
  await toLibrary(page);
  const d = await page.evaluate(() => window.__pp.store.get('drills', 'd_samplepivot'));
  await page.click('#share-drill');
  await page.click('#print-sheet-link');
  await page.waitForSelector('#drillsheet .pp-ds-setuppic svg');
  assert.equal(await page.locator('#sharedrill-dialog').count(), 0, 'the dialog closes');
  assert.equal(await page.locator('#sheet-steps figure').count(), d.steps.length);
  assert.equal(await page.locator('#sheet-steps figure svg').count(), d.steps.length);
  const text = await page.textContent('#drillsheet');
  assert.match(text, /Made with Practice Pilot/);
  for (const p of d.coachingPoints) assert.ok(text.includes(p));
  for (const s of d.setupNotes.filter(Boolean)) assert.ok(text.includes(s));
  assert.ok(await page.isVisible('#print-sheet'));
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.isVisible('.pp-printbar'), false, 'the bar isn’t printed');
  await page.emulateMedia({ media: 'screen' });
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('Share › Drill file: sent from one device, imported on another as a copy', async () => {
  const a = await open(env, { size: 'tablet' });
  await toLibrary(a.page);
  await noShareSheet(a.page);
  await a.page.click('#share-drill');
  await pick(a.page, { file: true });
  const [dl] = await Promise.all([a.page.waitForEvent('download'), a.page.click('#make-send')]);
  assert.equal(dl.suggestedFilename(), 'Pass, Pivot & Go.practicepilot');
  const path = await dl.path();
  const doc = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(doc.format, 'practice-pilot-drill'); assert.equal(doc.drill.thumb, undefined);

  const b = await open(env, { size: 'phone' });
  await b.page.goto(env.server.url + '#library'); await b.page.waitForSelector('#import-drill');
  const before = (await b.page.evaluate(() => window.__pp.store.all('drills'))).length;
  const [chooser] = await Promise.all([b.page.waitForEvent('filechooser'), b.page.click('#import-drill')]);
  await chooser.setFiles(path);
  await b.page.waitForSelector('.toast:has-text("Imported “Pass, Pivot & Go”")');
  const all = await b.page.evaluate(() => window.__pp.store.all('drills'));
  assert.equal(all.length, before + 1);
  const copy = all.find(x => x.sourceDrillId === 'd_samplepivot');
  assert.ok(copy && copy.id !== 'd_samplepivot' && !copy.sample && copy.thumb, 'a copy of its own, with a picture');
  // a wrong file is refused
  await b.page.waitForSelector('#preview:not([hidden])');      // the new drill opens (full screen on a phone)
  await b.page.goto(env.server.url + '#library'); await b.page.waitForSelector('#import-drill');
  const [c2] = await Promise.all([b.page.waitForEvent('filechooser'), b.page.click('#import-drill')]);
  await c2.setFiles({ name: 'notes.practicepilot', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await b.page.waitForSelector('.toast:has-text("isn’t a Practice Pilot drill")');
  assert.equal((await b.page.evaluate(() => window.__pp.store.all('drills'))).length, before + 1);
  await a.ctx.close(); await b.ctx.close();
});

test('the plan printout has a QR code on each drill card; its link opens the drill playing', async () => {
  const { ctx, page } = await open(env, { size: 'tablet' });
  await page.evaluate(async () => {
    await window.__pp.store.save('plans', { id: 'p_qrtest', title: 'QR plan', author: '', team: '', sourcePlanId: null, submittedAt: null, date: '', startTime: '', iceMinutes: null, themes: '', notes: '', blocks: [{ id: 'b_1', kind: 'drill', drillId: 'd_samplepivot', minutes: 8, note: '', helpers: [] }, { id: 'b_2', kind: 'activity', label: 'Water break', minutes: 3, note: '' }], extraEquipment: [], template: false, deletedAt: null, visibility: 'private' });
  });
  await page.goto(env.server.url + '#print/p_qrtest'); await page.waitForSelector('#printout');
  assert.equal(await page.locator('.pp-pcard .pp-qr svg').count(), 1, 'one per drill card');
  await page.goto(env.server.url + '#drill/p_qrtest/d_samplepivot');
  await page.waitForFunction(() => location.hash === '#library/d_samplepivot');
  await page.waitForSelector('#share-drill');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('the editor’s ⋮ menu has Share', async () => {
  const { ctx, page } = await open(env, { size: 'tablet' });
  await page.goto(env.server.url + '#edit/d_samplepivot'); await page.waitForSelector('#editor-title');
  await page.click('#drill-menu');
  await page.click('#drill-actions button:has-text("Share…")');
  await page.waitForSelector('#sharedrill-dialog #make-send');
  await ctx.close();
});
