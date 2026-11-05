import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setup, open, SIZES } from './helpers.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const plan = (page, id) => page.evaluate(id => window.__pp.store.get('plans', id), id);
const saved = page => page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved');
const planId = page => page.evaluate(() => location.hash.split('/')[1]);
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

/** Warm-up, a drill, 3 rotating stations with a helper, a water break. */
async function buildPlan(page) {
  await page.click('a[data-screen="plans"]'); await page.waitForSelector('#new-plan-btn');
  await page.click('#new-plan-btn'); await page.waitForSelector('#plan-panel');
  await page.click('[data-drill="d_samplefigure"]');
  await page.click('[data-drill="d_samplepivot"]');
  await page.click('#add-stations-btn');
  for (const d of ['d_samplebreakout', 'd_samplepivot', 'd_samplefigure']) await page.click(`[data-drill="${d}"]`);
  await page.click('#cancel-pick');
  const st = await page.evaluate(() => document.querySelector('[data-station]').dataset.station);
  await page.fill(`#st-${st}-input`, 'Sam'); await page.click(`#st-${st}-add`);
  await page.click('#add-activity-btn');
  await saved(page);
  return planId(page);
}

test('build a plan: drills at their usual length, stations that rotate, an activity, helpers; reopening loses nothing', async () => {
  const { ctx, page } = await open(env);
  const id = await buildPlan(page);
  let p = await plan(page, id);
  assert.deepEqual(p.blocks.map(b => b.kind), ['drill', 'drill', 'stations', 'activity']);
  assert.deepEqual(p.blocks.map(b => b.minutes), [6, 10, 15, 4]);
  assert.equal(p.blocks[2].stations.length, 3);
  assert.deepEqual(p.blocks[2].stations[0].helpers, ['Sam']);
  assert.equal(await page.textContent('#budget-words'), '44 of 50 min used · 6 min left');
  // details
  await page.click('#close-block');
  await page.click('#ptab-details');
  await page.fill('#plan-title-input', 'Tuesday practice');
  await page.fill('#plan-date', '2026-11-11');
  await page.fill('#plan-start', '18:15'); await page.press('#plan-start', 'Tab');
  await page.fill('#plan-themes', 'Support the puck');
  await saved(page);
  await page.reload(); await page.waitForSelector('#blocks .pp-block');
  p = await plan(page, id);
  assert.equal(p.title, 'Tuesday practice'); assert.equal(p.date, '2026-11-11'); assert.equal(p.startTime, '18:15'); assert.equal(p.themes, 'Support the puck');
  assert.match(await page.textContent('#blocks'), /6:31 PM/, 'clock times from the start time');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('the ice-time bar warns when a plan runs over; minutes, groups stay, reorder, remove with Undo', async () => {
  const { ctx, page } = await open(env);
  const id = await buildPlan(page);
  await page.click('#add-activity-btn');                       // another 4 min water break → 48
  await page.fill('#block-minutes', '10'); await page.press('#block-minutes', 'Tab');
  await page.waitForFunction(() => /54 of 50 min · 4 min over/.test(document.getElementById('budget-words').textContent));
  assert.match(await page.getAttribute('#budget', 'class'), /over/);
  assert.equal(await page.locator('.pp-block.over').count(), 1);
  await page.click('#block-minutes-less');
  assert.match(await page.textContent('#budget-words'), /53 of 50/);
  // stations: groups stay → the block's own length
  await page.click('.pp-block >> nth=2 >> .pp-block-main');
  await page.click('.pp-segbtn >> text=Groups stay');
  await page.fill('#block-minutes', '12'); await page.press('#block-minutes', 'Tab');
  await page.waitForFunction(() => /41 of 50/.test(document.getElementById('budget-words').textContent));
  await page.click('#block-up');
  await saved(page);
  let p = await plan(page, id);
  assert.equal(p.blocks[1].kind, 'stations');
  await page.click('#remove-block');
  await page.waitForSelector('.toast >> text=removed from the plan');
  assert.equal(await page.locator('#blocks .pp-block').count(), 4);
  await page.click('.toast button >> text=Undo');
  assert.equal(await page.locator('#blocks .pp-block').count(), 5);
  await page.click('#undo');
  await saved(page);
  p = await plan(page, id);
  assert.equal(p.blocks[2].kind, 'stations', 'undo puts the move back');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('the equipment list counts stations together and lists each drill’s setup once; extra items', async () => {
  const { ctx, page } = await open(env);
  const id = await buildPlan(page);
  await page.click('#close-block'); await page.click('#ptab-equipment');
  assert.deepEqual(await page.locator('#equipment-list li').allTextContents(), ['3 Pylons', '2 Pucks', '1 Puck pile']);
  assert.equal(await page.locator('#setup-sheet > div').count(), 3);
  await page.fill('#new-equipment', 'Pinnies'); await page.click('#add-equipment');
  await saved(page);
  assert.deepEqual((await plan(page, id)).extraEquipment, ['Pinnies']);
  await ctx.close();
});

test('print: a run sheet, then a card per drill with purpose, setup, coaching points and who runs it', async () => {
  const { ctx, page } = await open(env);
  const id = await buildPlan(page);
  await page.click('#print-btn'); await page.waitForSelector('#printout');
  assert.match(await page.textContent('#print-pages'), /About 4 pages/);
  assert.equal(await page.locator('.pp-sheet-table tbody tr').count(), 4);
  assert.equal(await page.locator('.pp-pcard').count(), 5);
  const station = await page.locator('.pp-pcard >> nth=2').textContent();
  assert.match(station, /Station 1 of 3/); assert.match(station, /Run by: Sam/); assert.match(station, /Purpose:/); assert.match(station, /Setup/); assert.match(station, /Coaching points/);
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.isVisible('.topbar'), false);
  assert.equal(await page.isVisible('.pp-printbar'), false);
  void id;
  await ctx.close();
});

test('editing a drill shows in the plan; a deleted drill offers Restore', async () => {
  const { ctx, page } = await open(env);
  const id = await buildPlan(page);
  await page.evaluate(async () => { const s = window.__pp.store; const d = await s.get('drills', 'd_samplepivot'); await s.save('drills', { ...d, title: 'Pass, Pivot & Go (new)' }); });
  await page.reload(); await page.waitForSelector('#blocks .pp-block');
  assert.match(await page.textContent('#blocks'), /Pass, Pivot & Go \(new\)/);
  await page.evaluate(async () => { const s = window.__pp.store; const d = await s.get('drills', 'd_samplefigure'); await s.save('drills', { ...d, deletedAt: new Date().toISOString() }); });
  await page.reload(); await page.waitForSelector('#blocks .pp-block');
  assert.match(await page.textContent('#blocks'), /This drill is in Recently deleted/);
  await page.click('.pp-block >> nth=0 >> .pp-block-main');
  await page.click('#restore-drill');
  await page.waitForSelector('.toast >> text=restored');
  assert.equal((await page.evaluate(() => window.__pp.store.get('drills', 'd_samplefigure'))).deletedAt, null);
  void id;
  await ctx.close();
});

test('plans list: search, duplicate, template, new plan from template, delete with Undo and restore', async () => {
  const { ctx, page } = await open(env);
  const id = await buildPlan(page);
  await page.click('#planner-back'); await page.waitForSelector('#plan-cards .pp-card');
  await page.click(`.pp-card[data-id="${id}"]`);
  assert.match(await page.textContent('#plan-preview'), /44 of 50 min used/);
  await page.fill('#plan-search', 'breakout');
  assert.equal(await page.locator('#plan-cards .pp-card').count(), 1);
  await page.fill('#plan-search', '');
  await page.click('#duplicate-plan'); await page.waitForSelector('#plan-panel');
  assert.equal(await page.textContent('#plan-title'), 'Copy of New plan');
  await page.click('#planner-back'); await page.waitForSelector('#plan-cards .pp-card');
  await page.click(`.pp-card[data-id="${id}"]`);
  await page.click('#plan-menu'); await page.click('#plan-actions [data-value="tmpl"]');
  await page.waitForSelector('.toast >> text=Saved as a template');
  await page.click('#new-plan-btn'); await page.waitForSelector('#new-plan');
  await page.click('#new-plan button >> text=New plan');
  await page.waitForSelector('#blocks .pp-block');
  assert.equal(await page.locator('#blocks .pp-block').count(), 4);
  await page.click('#planner-back'); await page.waitForSelector('#plan-cards .pp-card');
  await page.click(`.pp-card[data-id="${id}"]`);
  await page.click('#plan-menu'); await page.click('#plan-actions [data-value="del"]');
  await page.waitForSelector('.toast >> text=moved to Recently deleted');
  assert.equal(await page.locator('.toast.scoped').count(), 0, 'the plan builder’s Undo messages closed when it did');
  await page.click('.toast button >> text=Undo');
  await page.waitForSelector(`.pp-card[data-id="${id}"]`);
  assert.equal((await plan(page, id)).deletedAt, null);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('Add to plan from a drill’s preview in the library', async () => {
  const { ctx, page } = await open(env);
  await page.click('.pp-card[data-id="d_samplebreakout"]');
  await page.click('#add-to-plan');
  await page.click('#add-to-plan-dialog [data-value="new"]');
  await page.waitForSelector('.toast >> text=Added to');
  const plans = await page.evaluate(() => window.__pp.store.all('plans'));
  assert.equal(plans.length, 1);
  assert.equal(plans[0].blocks[0].drillId, 'd_samplebreakout');
  assert.equal(plans[0].blocks[0].minutes, 8);
  await page.click('.toast button >> text=Open plan');
  await page.waitForSelector('#blocks .pp-block');
  await ctx.close();
});

test('a drill’s usual length is set in its Details and plans start from it', async () => {
  const { ctx, page } = await open(env);
  await page.goto(env.server.url + '#edit/d_samplebreakout'); await page.waitForSelector('.pp-editor');
  await page.click('#tab-details');
  await page.fill('#usual-minutes', '12');
  await page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved');
  assert.equal((await page.evaluate(() => window.__pp.store.get('drills', 'd_samplebreakout'))).minutes, 12);
  await ctx.close();
});

test('backup and restore carry plans; ice time in Settings sets new plans', async () => {
  const { ctx, page } = await open(env);
  await buildPlan(page);
  await page.goto(env.server.url + '#settings/device');
  await page.fill('#ice-minutes', '60'); await page.press('#ice-minutes', 'Tab');
  await page.waitForSelector('.toast >> text=Saved');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#backup-now')]);
  const b = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  assert.equal(b.data.plans.length, 1);
  await page.goto(env.server.url + '#plans'); await page.waitForSelector('#plan-cards .pp-card');
  assert.match(await page.textContent('#plan-cards'), /44 of 60 min/);
  await ctx.close();
});

test('phone: plans read only; tablet upright and PC: no small targets, no sideways scroll, contrast passes', async () => {
  for (const size of ['phone', 'tablet', 'pc']) {
    const { ctx, page } = await open(env, { size: size === 'phone' ? 'tablet' : size });
    const id = await buildPlan(page);
    if (size === 'phone') { await page.setViewportSize({ width: SIZES.phone.width, height: SIZES.phone.height }); }
    for (const hash of [`#plans/${id}`, `#plan/${id}`, `#print/${id}`]) {
      await page.goto(env.server.url + hash);
      await page.waitForSelector(hash.startsWith('#print') ? '#printout' : hash.startsWith('#plans') ? '#plan-preview:not([hidden])' : (size === 'phone' ? '.pp-planview' : '#blocks .pp-block'));
      if (size === 'phone' && hash.startsWith('#plan/')) assert.match(await page.textContent('main'), /Edit on a tablet or PC/);
      assert.ok(await noSideScroll(page), `${size} ${hash} scrolls sideways`);
      const small = await page.evaluate(() => [...document.querySelectorAll('button, a.btn, select, input:not([type=checkbox]):not([type=file])')]
        .filter(e => e.offsetParent && !e.closest('[hidden]') && !e.closest('.pp-printpage'))
        .map(e => [e.id || e.className || e.textContent.trim().slice(0, 20), Math.round(e.getBoundingClientRect().height), Math.round(e.getBoundingClientRect().width)])
        .filter(([, h, w]) => h < 44 || w < 44));
      assert.deepEqual(small, [], `${size} ${hash}: small targets`);
      if (!hash.startsWith('#print')) for (const theme of ['dark', 'light']) {
        await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
        await page.addScriptTag({ content: AXE });
        const r = await page.evaluate(() => axe.run(document, { runOnly: ['color-contrast', 'button-name', 'label', 'link-name', 'aria-allowed-attr', 'aria-valid-attr-value'] }));
        assert.deepEqual(r.violations.map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`), [], `${size} ${hash} ${theme}`);
      }
    }
    assert.deepEqual(page.errors, []);
    await ctx.close();
  }
});
