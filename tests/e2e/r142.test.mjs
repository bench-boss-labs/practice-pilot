/* 1.4.2 Share a drill: the video, the drill sheet, the drill file (send and import), QR codes on the printout. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setup, open } from './helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });
const toLibrary = async (page, id = 'd_samplepivot') => { await page.goto(env.server.url + '#library/' + id); await page.waitForSelector('#share-drill'); };

test('Share › Video makes a video of the drill playing; Send and Download are offered', async () => {
  const { ctx, page } = await open(env, { size: 'tablet' });
  await page.evaluate(() => { window.__pp.videoSpeed = 6; });    // tests only: record faster than real time
  await toLibrary(page);
  await page.click('#share-drill');
  await page.waitForSelector('#sharedrill-dialog');
  assert.match(await page.textContent('#sharedrill-dialog'), /about \d+ seconds/);
  await page.click('#make-video');
  await page.waitForSelector('#cancel-video');
  await page.waitForSelector('#send-video', { timeout: 30000 });
  const info = await page.textContent('#video-row');
  assert.match(info, /\d+ s · \d+\.\d MB · (MP4|WEBM)/);
  assert.doesNotMatch(info, /0\.0 MB/, 'the video has frames in it');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#download-video')]);
  assert.match(dl.suggestedFilename(), /^Pass, Pivot & Go\.(mp4|webm)$/);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('Share › Drill sheet: one page with the setup, a picture of each step and its caption', async () => {
  const { ctx, page } = await open(env, { size: 'tablet' });
  await toLibrary(page);
  const d = await page.evaluate(() => window.__pp.store.get('drills', 'd_samplepivot'));
  await page.click('#share-drill');
  await page.click('#open-sheet');
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
  await a.page.click('#share-drill');
  const [dl] = await Promise.all([a.page.waitForEvent('download'), a.page.click('#send-drill-file')]);
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
  await page.waitForSelector('#sharedrill-dialog #make-video');
  await ctx.close();
});
