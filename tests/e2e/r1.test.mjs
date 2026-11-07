import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setup, open, makeVersion, SIZES } from './helpers.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

/** Screen position of a rink point (feet). */
async function rinkXY(page, x, y) {
  return page.evaluate(([x, y]) => {
    const svg = document.querySelector('.pp-edplayer .pp-rink, .pp-rink');
    const p = svg.createSVGPoint(); p.x = x; p.y = y;
    const q = p.matrixTransform(svg.getScreenCTM());
    return [q.x, q.y];
  }, [x, y]);
}
const tapRink = async (page, x, y) => { const [a, b] = await rinkXY(page, x, y); await page.mouse.click(a, b); };
async function dragRink(page, from, to, { hold = 0 } = {}) {
  const [a, b] = await rinkXY(page, ...from), [c, d] = await rinkXY(page, ...to);
  await page.mouse.move(a, b); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(a + (c - a) * i / 8, b + (d - b) * i / 8);
  if (hold) await page.waitForTimeout(hold);
  await page.mouse.up();
}
const drill = (page, id) => page.evaluate(id => window.__pp.store.get('drills', id), id);
const saved = page => page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved');
const editorId = page => page.evaluate(() => location.hash.split('/')[1]);
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

test('first run: three samples play in the preview; search, filters, count and sort work and are remembered', async () => {
  const { ctx, page } = await open(env);
  await page.waitForSelector('.pp-card');
  assert.equal(await page.locator('.pp-card').count(), 3);
  assert.equal(await page.locator('.pp-card .pp-pill-sample').count(), 3);
  assert.match(await page.textContent('#welcome'), /Play a sample drill/);
  assert.ok(await page.locator('.pp-card .pp-thumb svg').count() === 3, 'cards have pictures');

  await page.click('.pp-card[data-id="d_samplepivot"]');
  await page.waitForSelector('#preview:not([hidden]) .pp-rink');
  assert.match(await page.textContent('#preview'), /4 steps · 9\.5 s/);
  assert.match(await page.textContent('#preview'), /Pass hard and flat/);
  assert.match(await page.textContent('#setup-notes'), /Setup.*Puck pile at the near boards/);
  await page.click('#preview button[aria-label="Play"]');
  await page.waitForTimeout(700);
  assert.ok(+(await page.inputValue('#preview .pp-scrub')) > 0, 'the preview plays');

  await page.fill('#search', 'pivot');
  assert.deepEqual(await page.locator('.pp-card-title').allTextContents(), ['Pass, Pivot & Go']);
  assert.match(await page.textContent('#count'), /1 of 3 drills/);
  await page.fill('#search', 'nothing like this');
  await page.waitForSelector('#no-match');
  await page.click('#no-match button');
  assert.equal(await page.locator('.pp-card').count(), 3);

  await page.click('#f-tags'); await page.click('#pick-tags .pp-tagchip >> text=Battle'); await page.click('#pick-tags [data-value="done"]');
  await page.click('#f-ages'); await page.click('#pick-ages .pp-tagchip >> text=U11'); await page.click('#pick-ages [data-value="done"]');
  assert.deepEqual(await page.locator('.pp-card-title').allTextContents(), ['Breakout Pass 1 on 1']);
  assert.match(await page.textContent('#f-tags'), /Tags: Battle/);
  await page.click('#clear-filters');
  await page.selectOption('#sort', 'az');
  assert.deepEqual(await page.locator('.pp-card-title').allTextContents(), ['Breakout Pass 1 on 1', 'Figure-8 Edges', 'Pass, Pivot & Go']);
  await page.click('#f-levels'); await page.click('#pick-levels .pp-tagchip >> text=Beginner'); await page.click('#pick-levels [data-value="done"]');
  await page.waitForTimeout(200);
  await page.reload(); await page.waitForSelector('.pp-card');
  assert.match(await page.textContent('#f-levels'), /Level: Beginner/, 'filters are remembered');
  assert.equal(await page.inputValue('#sort'), 'az');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('build a drill on a tablet: place, step, carry, curve, pivot, callout, highlight, markup and details; reopening loses nothing', async () => {
  const { ctx, page } = await open(env);
  await page.click('#new-drill-btn');
  await page.waitForSelector('.pp-editor');
  const id = await editorId(page);
  // Setup: a red forward with a puck on their stick, a pylon and a black defender
  await page.click('.pp-trayb[data-type="F"]');
  await tapRink(page, 60, 60);
  await page.click('.pp-trayb[data-type="puck"]');
  await tapRink(page, 62.5, 60);
  await page.click('.pp-trayb[data-type="pylon"]');
  await tapRink(page, 100, 40); await tapRink(page, 110, 40);            // the tray stays picked
  await page.click('.pp-swatch[aria-label="Black team"]');
  await page.click('.pp-trayb[data-type="D"]');
  await tapRink(page, 140, 30);
  await page.click('#tray-move');
  await saved(page);
  let d = await drill(page, id);
  assert.deepEqual(d.pieces.map(p => p.type), ['F', 'puck', 'pylon', 'pylon', 'D']);
  assert.equal(d.pieces[4].team, 'black');

  // Step 1: drag the forward; the puck is carried
  await page.click('#add-step');
  await dragRink(page, [60, 60], [120, 60]);
  await saved(page);
  d = await drill(page, id);
  const f = d.pieces[0].id, pk = d.pieces[1].id, dId = d.pieces[4].id;
  const m = d.steps[0].moves.find(x => x.piece === f);
  assert.ok(Math.abs(m.to[0] - 120) < 1.5 && Math.abs(m.to[1] - 60) < 1.5, JSON.stringify(m.to));
  assert.equal(m.line, 'skate-puck');
  assert.equal(d.steps[0].moves.find(x => x.piece === pk).carriedBy, f);

  // curve it by dragging the middle dot, finish with a pivot, callout and highlight
  await page.waitForSelector('[data-bend="mid"]');
  const mid = await page.locator('[data-bend="mid"] circle').first().boundingBox();
  await page.mouse.move(mid.x + mid.width / 2, mid.y + mid.height / 2); await page.mouse.down();
  const [bx, by] = await rinkXY(page, 90, 75);
  for (let i = 1; i <= 6; i++) await page.mouse.move(mid.x + mid.width / 2 + (bx - mid.x - mid.width / 2) * i / 6, mid.y + mid.height / 2 + (by - mid.y - mid.height / 2) * i / 6);
  await page.mouse.up();
  await page.click('.pp-segbtn >> text=Pivot');
  await page.click('#add-callout');
  await page.keyboard.type('Head up!');
  await page.click('#highlight');
  await page.click('#tab-step');
  await page.fill('#caption', 'Carry wide and pivot');
  await saved(page);
  d = await drill(page, id);
  const m1 = d.steps[0].moves.find(x => x.piece === f);
  assert.equal(m1.bends.length, 1);
  assert.ok(Math.abs(m1.bends[0][1] - 75) < 2);
  assert.equal(m1.finish, 'pivot');
  assert.deepEqual(d.steps[0].callouts, [{ piece: f, text: 'Head up!' }]);
  assert.deepEqual(d.steps[0].highlight, [f]);
  assert.equal(d.steps[0].caption, 'Carry wide and pivot');

  // Step 2: a pass that waits for the pivot ("After skaters arrive")
  await page.click('#add-step');
  await dragRink(page, [122.5, 60], [140, 34]);
  await page.click('.pp-segbtn >> text=After skaters arrive');
  await saved(page);
  d = await drill(page, id);
  assert.deepEqual(d.steps[1].moves.find(x => x.piece === pk), { piece: pk, line: 'pass', to: d.steps[1].moves.find(x => x.piece === pk).to, when: 'after' });

  // markup: a box on step 2 only, an arrow on all steps
  await page.click('[data-tool="box"]');
  await dragRink(page, [130, 20], [150, 45]);
  await page.click('[data-tool="arrow"]');
  await page.click('.pp-segbtn >> text=All steps');
  await dragRink(page, [40, 20], [70, 20]);
  await page.click('[data-tool="move"]');
  await saved(page);
  d = await drill(page, id);
  assert.deepEqual(d.markup.map(x => [x.kind, x.step]), [['box', 2], ['arrow', null]]);
  await page.click('.pp-chip[data-k="1"]');
  assert.equal(await page.locator('.pp-rink [data-mark]').count(), 1, 'step 1 shows only the all-steps arrow');
  await page.click('.pp-chip[data-k="2"]');
  assert.equal(await page.locator('.pp-rink [data-mark]').count(), 2);

  // details
  await page.click('#tab-details');
  await page.fill('#title', 'Wide carry and pivot');
  await page.fill('#description', 'Carry wide, pivot, take the pass.');
  await page.click('.pp-tagchip >> text=Passing');
  await page.fill('#new-tag', 'Pivots'); await page.click('#add-tag');
  await page.click('.pp-tagchip >> text=U11');
  await page.click('.pp-segbtn >> text=Intermediate');
  await page.click('#add-point'); await page.keyboard.type('Stay low through the pivot');
  await page.click('#add-setup'); await page.keyboard.type('Pucks on both blue lines');
  await page.click('#add-setup'); await page.keyboard.type('Pylons on the dots');
  await page.fill('#new-link', 'not a link'); await page.click('#add-link');
  assert.equal(await page.textContent('#link-error'), 'That doesn’t look like a link.');
  await page.fill('#new-link', 'https://www.youtube.com/watch?v=abc123'); await page.click('#add-link');
  await page.fill('#goalie-notes', 'Track the pass across');
  await saved(page);

  // reopen: everything is still there
  await page.reload();
  await page.waitForSelector('.pp-editor');
  d = await drill(page, id);
  assert.equal(d.title, 'Wide carry and pivot');
  assert.deepEqual(d.tags, ['Passing', 'Pivots']);
  assert.deepEqual(d.ageGroups, ['U11']);
  assert.equal(d.level, 'Intermediate');
  assert.deepEqual(d.coachingPoints, ['Stay low through the pivot']);
  assert.deepEqual(d.setupNotes, ['Pucks on both blue lines', 'Pylons on the dots']);
  assert.deepEqual(d.videoLinks, [{ url: 'https://www.youtube.com/watch?v=abc123', site: 'YouTube' }]);
  assert.equal(d.goalieNotes, 'Track the pass across');
  assert.equal(d.steps.length, 2);
  assert.match(d.thumb, /^<svg/);
  await page.click('#tab-details');
  assert.equal(await page.inputValue('#title'), 'Wide carry and pivot');
  assert.ok(await page.isVisible('a.btn >> text=▶ YouTube'));
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('remove a piece in one tap, Undo brings it back; undo and redo with buttons and keys; Delete key', async () => {
  const { ctx, page } = await open(env);
  await page.click('#new-drill-btn'); await page.waitForSelector('.pp-editor');
  const id = await editorId(page);
  await page.click('.pp-trayb[data-type="pylon"]'); await tapRink(page, 100, 40); await page.click('#tray-move');
  await tapRink(page, 100, 40);
  await page.click('#remove-piece');
  await page.waitForSelector('.toast >> text=Pylon removed');
  assert.equal(await page.locator('.pp-rink [data-piece]').count(), 0);
  await page.click('.toast button >> text=Undo');
  assert.equal(await page.locator('.pp-rink [data-piece]').count(), 1);
  await page.click('#redo');
  assert.equal(await page.locator('.pp-rink [data-piece]').count(), 0);
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('.pp-rink [data-piece]').count(), 1);
  await tapRink(page, 100, 40);
  await page.keyboard.press('Shift+ArrowRight');
  await saved(page);
  assert.deepEqual((await drill(page, id)).start[(await drill(page, id)).pieces[0].id], [101, 40]);
  await page.keyboard.press('Delete');
  await saved(page);
  assert.equal((await drill(page, id)).pieces.length, 0);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('rebuild the sample in the editor: it opens, plays and every step chip works', async () => {
  const { ctx, page } = await open(env);
  await page.goto(env.server.url + '#edit/d_samplepivot');
  await page.waitForSelector('.pp-editor');
  for (const k of [1, 2, 3, 4, 0]) { await page.click(`.pp-chip[data-k="${k}"]`); assert.equal(await page.getAttribute(`.pp-chip[data-k="${k}"]`, 'aria-selected'), 'true'); }
  await page.click('.pp-edplayer button[aria-label="Play"]');
  await page.waitForTimeout(600);
  assert.ok(+(await page.inputValue('.pp-edplayer .pp-scrub')) > 0);
  await page.keyboard.press('Space');
  assert.ok(await page.isVisible('.pp-edplayer button[aria-label="Play"]'), 'Space pauses');
  // steps: remove (with Undo) and reorder
  await page.click('.pp-chip[data-k="2"]'); await page.click('#tab-step');
  await page.click('#remove-step');
  assert.equal(await page.locator('.pp-chip[data-k]').count(), 4);
  await page.click('.toast button >> text=Undo');
  assert.equal(await page.locator('.pp-chip[data-k]').count(), 5);
  await page.click('.pp-chip[data-k="2"]'); await page.click('#step-earlier');
  await saved(page);
  assert.match((await drill(page, 'd_samplepivot')).steps[0].caption, /comes off the pylon/);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('templates, duplicate, delete with Undo, Recently deleted and Restore', async () => {
  const { ctx, page } = await open(env);
  await page.click('.pp-card[data-id="d_samplefigure"]');
  await page.click('#preview-menu'); await page.click('#drill-actions [data-value="tmpl"]');
  await page.waitForSelector('.toast >> text=Saved as a template');
  await page.click('#f-show'); await page.click('#pick-show .pp-tagchip >> text=Templates'); await page.click('#pick-show [data-value="done"]');
  assert.ok(await page.locator('.pp-card .pp-pill-template').count() >= 1);
  await page.click('#f-show'); await page.click('#pick-show [data-value="clear"]');

  await page.click('#new-drill-btn');
  await page.waitForSelector('#new-drill');
  await page.click('#new-drill button >> text=Figure-8 Edges');
  await page.waitForSelector('.pp-editor');
  const fromT = await drill(page, await editorId(page));
  assert.equal(fromT.template, false); assert.equal(fromT.steps.length, 3);
  await page.click('#editor-back'); await page.waitForSelector('.pp-card');

  await page.click('.pp-card[data-id="d_samplebreakout"]');
  await page.click('#duplicate-drill');
  await page.waitForSelector('.pp-editor');
  assert.equal(await page.textContent('#editor-title'), 'Copy of Breakout Pass 1 on 1');
  await page.click('#editor-back'); await page.waitForSelector('.pp-card');

  await page.click('.pp-card[data-id="d_samplebreakout"]');
  await page.click('#preview-menu'); await page.click('#drill-actions [data-value="del"]');
  await page.waitForSelector('.toast >> text=moved to Recently deleted');
  assert.equal(await page.locator('.pp-card[data-id="d_samplebreakout"]').count(), 0);
  await page.click('.toast button >> text=Undo');
  await page.waitForSelector('.pp-card[data-id="d_samplebreakout"]');
  await page.click('.pp-card[data-id="d_samplebreakout"]');
  await page.click('#preview-menu'); await page.click('#drill-actions [data-value="del"]');
  await page.click('#f-show'); await page.click('#pick-show .pp-tagchip >> text=Drills'); await page.click('#pick-show .pp-tagchip >> text=Recently deleted'); await page.click('#pick-show [data-value="done"]');
  await page.click('.pp-card[data-id="d_samplebreakout"]');
  assert.match(await page.textContent('#preview'), /removed for good in 30 days/);
  await page.click('#restore-drill');
  await page.waitForSelector('.toast >> text=restored');
  assert.equal((await drill(page, 'd_samplebreakout')).deletedAt, null);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('drills in the bin for 30 days are removed when the app opens; Restore samples brings samples back', async () => {
  const { ctx, page } = await open(env);
  await page.evaluate(async () => {
    const s = window.__pp.store;
    const d = await s.get('drills', 'd_samplepivot');
    await s.put('drills', { ...d, deletedAt: new Date(Date.now() - 31 * 86400000).toISOString() });
  });
  await page.reload(); await page.waitForSelector('.pp-card');
  assert.equal(await drill(page, 'd_samplepivot'), null);
  await page.goto(env.server.url + '#settings/device');
  await page.click('#restore-samples');
  await page.waitForSelector('.toast >> text=1 sample drill restored');
  assert.ok(await drill(page, 'd_samplepivot'));
  await ctx.close();
});

test('a phone shows one column, a full-screen preview, and details-only editing upright', async () => {
  const { ctx, page } = await open(env, { size: 'phone' });
  await page.waitForSelector('.pp-card');
  const [a, b] = await page.locator('.pp-card').evaluateAll(cs => cs.slice(0, 2).map(c => c.getBoundingClientRect().left));
  assert.equal(a, b, 'cards stack');
  await page.click('.pp-card[data-id="d_samplepivot"]');
  const box = await page.locator('#preview').boundingBox();
  assert.ok(box.width >= SIZES.phone.width - 1 && box.y <= 1, 'preview is full screen');
  assert.ok(await page.isVisible('#edit-drill'), 'phones can edit (1.3.0)');
  assert.ok(await noSideScroll(page));
  await page.click('#close-preview');
  await page.goto(env.server.url + '#edit/d_samplepivot');
  await page.waitForSelector('#rotate-note');
  assert.match(await page.textContent('#rotate-note'), /Turn your phone sideways/);
  assert.ok(!(await page.isVisible('.pp-tray')) && !(await page.isVisible('#tools')), 'no rink tools upright');
  assert.ok(await noSideScroll(page));
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('every control is at least 44 px, nothing scrolls sideways, and colours pass contrast at all sizes', async () => {
  for (const size of ['tablet', 'pc', 'phone']) {
    const { ctx, page } = await open(env, { size });
    for (const hash of ['#library/d_samplepivot', '#edit/d_samplepivot']) {
      await page.goto(env.server.url + hash);
      await page.waitForSelector(hash.startsWith('#edit') ? '.pp-rink' : '#preview .pp-rink');
      if (size !== 'phone' && hash.startsWith('#edit')) {
        await page.click('.pp-chip[data-k="1"]');
        const b = await page.locator('[data-hit="f1"]').boundingBox();
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      }
      assert.ok(await noSideScroll(page), `${size} ${hash} scrolls sideways`);
      const small = await page.evaluate(() => [...document.querySelectorAll('button, a.btn, select, input:not([type=checkbox]):not([type=file])')]
        .filter(e => e.offsetParent && !e.closest('[hidden]'))
        .map(e => [e.id || e.className || e.textContent.trim().slice(0, 20), e.getBoundingClientRect().height, e.getBoundingClientRect().width])
        .filter(([, h, w]) => h < 43.5 || w < 43.5));
      assert.deepEqual(small, [], `${size} ${hash}: small targets`);
      for (const theme of ['dark', 'light']) {
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

test('500 drills: the library opens in under a second and filtering keeps up', async () => {
  const { ctx, page } = await open(env);
  await page.evaluate(async () => {
    const s = window.__pp.store;
    const base = await s.all('drills');
    for (let i = 0; i < 500; i++) { const b = base[i % 3]; await s.put('drills', { ...b, id: `d_load${String(i).replace(/[01]/g, c => 'ab'[c])}x`, title: `${b.title} ${i}`, sample: false }); }
  });
  await page.goto(env.server.url + '#help'); await page.waitForSelector('#help-title');
  const t0 = Date.now();
  await page.click('a[data-screen="library"]');
  await page.waitForSelector('.pp-card >> nth=400');
  const opened = Date.now() - t0;
  assert.ok(opened < 1000, `opened in ${opened} ms`);
  const t1 = Date.now();
  await page.fill('#search', 'pivot 12');
  await page.waitForFunction(() => document.querySelectorAll('.pp-card').length < 30);
  assert.ok(Date.now() - t1 < 500, `filtered in ${Date.now() - t1} ms`);
  await ctx.close();
});

test('an update waits while the editor is open and shows once you leave', async () => {
  const { ctx, page } = await open(env);
  await page.goto(env.server.url + '#edit/d_samplepivot'); await page.waitForSelector('.pp-editor');
  env.server.setRoot(makeVersion('1.4.9'));
  await page.evaluate(() => window.__pp.checkUpdates());
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#banners .banner').count(), 0, 'no banner while editing');
  await page.click('#editor-back');
  await page.waitForSelector('#banners .banner', { timeout: 8000 });
  await ctx.close();
});

test('pass and shoot by tapping: Pass then the teammate, Shoot then a spot', async () => {
  const { ctx, page } = await open(env);
  await page.click('#new-drill-btn'); await page.waitForSelector('.pp-editor');
  const id = await editorId(page);
  await page.click('.pp-trayb[data-type="F"]'); await tapRink(page, 60, 60); await tapRink(page, 120, 30);
  await page.click('.pp-trayb[data-type="puck"]'); await tapRink(page, 62.5, 60);
  await page.click('#tray-move');
  await page.click('#add-step');
  await dragRink(page, [120, 30], [140, 25]);                  // the receiver skates up ice in step 1
  await tapRink(page, 60, 60);                                  // select the passer
  await page.click('#pass-btn');
  assert.match(await page.textContent('#action-hint'), /tap who to pass to/i);
  await tapRink(page, 140, 25);
  await page.waitForSelector('.toast >> text=Pass to the forward in step 1');
  await saved(page);
  let d = await drill(page, id);
  const [f1, f2, pk] = d.pieces.map(p => p.id);
  const pass = d.steps[0].moves.find(m => m.piece === pk);
  assert.equal(pass.line, 'pass'); assert.equal(pass.when, 'after');
  // F2 now has it: Shoot from F2 adds a step when they're carrying, otherwise shoots in this one
  await page.click('#add-step');
  await tapRink(page, 140, 25);
  await page.click('#shoot-btn');
  await tapRink(page, 188, 42);
  await saved(page);
  d = await drill(page, id);
  assert.deepEqual(d.steps[1].moves.find(m => m.piece === pk), { piece: pk, line: 'shot', to: d.steps[1].moves.find(m => m.piece === pk).to });
  assert.ok(Math.abs(d.steps[1].moves.find(m => m.piece === pk).to[0] - 188) < 1.5);
  // Moving in this step lists what moves together
  await page.click('.pp-chip[data-k="1"]'); await page.click('#tab-step');
  assert.equal(await page.locator('#moving-list .pp-moveitem').count(), 2);
  assert.match(await page.textContent('#moving-list'), /Pass · After skaters arrive/);
  assert.deepEqual(page.errors, []);
  void f1; void f2;
  await ctx.close();
});

test('a puck on a stick: tap again to select the puck, or use Select the puck', async () => {
  const { ctx, page } = await open(env);
  await page.goto(env.server.url + '#edit/d_samplepivot'); await page.waitForSelector('.pp-editor');
  await tapRink(page, 128, 70);
  assert.match(await page.textContent('#piece-name'), /Forward/);
  await tapRink(page, 128, 70);
  assert.match(await page.textContent('#piece-name'), /Puck/);
  await tapRink(page, 128, 70);
  assert.match(await page.textContent('#piece-name'), /Forward/);
  await page.click('#select-puck');
  assert.match(await page.textContent('#piece-name'), /Puck/);
  await ctx.close();
});

test('library: drag the handle to resize the preview, cards become a list, expand hides them; all remembered', async () => {
  const { ctx, page } = await open(env);
  await page.click('.pp-card[data-id="d_samplepivot"]');
  await page.waitForSelector('#splitter');
  const w0 = (await page.locator('#preview').boundingBox()).width;
  const sb = await page.locator('#splitter').boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + 100); await page.mouse.down();
  await page.mouse.move(sb.x - 200, sb.y + 100, { steps: 6 }); await page.mouse.up();
  const w1 = (await page.locator('#preview').boundingBox()).width;
  assert.ok(w1 > w0 + 150, `${w0} → ${w1}`);
  const cards = await page.locator('.pp-card').evaluateAll(cs => cs.map(c => c.getBoundingClientRect().left));
  assert.equal(new Set(cards).size, 1, 'cards stack in a list');
  await page.click('#expand-preview');
  assert.equal(await page.isVisible('#cards'), false);
  assert.ok((await page.locator('#preview').boundingBox()).width > 1100);
  await page.waitForTimeout(200);
  await page.reload(); await page.waitForSelector('#preview:not([hidden])');
  assert.equal(await page.isVisible('#cards'), false, 'expanded is remembered');
  await page.click('#expand-preview');
  assert.ok(Math.abs((await page.locator('#preview').boundingBox()).width - w1) < 4, 'size is remembered');
  await page.focus('#splitter'); await page.keyboard.press('End');
  assert.equal(await page.getAttribute('#splitter', 'aria-valuenow'), '30');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('Pass and Shoot tools above the rink: tap the passer, then the teammate; the nearest puck goes to them first', async () => {
  const { ctx, page } = await open(env);
  await page.click('#new-drill-btn'); await page.waitForSelector('.pp-editor');
  const id = await editorId(page);
  await page.click('.pp-trayb[data-type="F"]'); await tapRink(page, 60, 60); await tapRink(page, 120, 30);
  await page.click('.pp-trayb[data-type="puck"]'); await tapRink(page, 90, 75);   // nowhere near anyone
  await page.click('#tray-move');
  await page.click('[data-tool="pass"]');
  assert.match(await page.textContent('#action-hint'), /tap the player or coach who passes/);
  await tapRink(page, 60, 60);
  assert.match(await page.textContent('#action-hint'), /Now tap who to pass to/);
  await tapRink(page, 120, 30);
  await page.waitForSelector('.toast >> text=The puck starts on their stick');
  await saved(page);
  const d = await drill(page, id);
  const [f1, , pk] = d.pieces.map(p => p.id);
  assert.ok(Math.hypot(d.start[pk][0] - d.start[f1][0], d.start[pk][1] - d.start[f1][1]) < 3, 'the puck moved onto the passer’s stick');
  assert.equal(d.steps.length, 1);
  assert.equal(d.steps[0].moves.find(m => m.piece === pk).line, 'pass');
  // the Piece panel always shows Pass and Shoot for a player
  await tapRink(page, 120, 30);
  assert.ok(await page.isVisible('#pass-btn')); assert.ok(await page.isVisible('#shoot-btn'));
  await page.click('[data-tool="shoot"]');
  assert.match(await page.textContent('#action-hint'), /tap the player or coach who shoots/, 'the toolbar always asks for the shooter, even with a player selected');
  await tapRink(page, 120, 30);
  assert.match(await page.textContent('#action-hint'), /Now tap the spot/);
  await tapRink(page, 188, 42);
  await saved(page);
  assert.equal((await drill(page, id)).steps.length, 2);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('two passers in one step with puck piles (Cristian’s video): the second pass leaves the first alone', async () => {
  const { ctx, page } = await open(env);
  await page.click('#new-drill-btn'); await page.waitForSelector('.pp-editor');
  const id = await editorId(page);
  await page.selectOption('#rink-view', 'neutral');
  await page.click('.pp-trayb[data-type="X"]');
  for (const [x, y] of [[125, 80], [125, 6], [75, 6], [75, 80]]) await tapRink(page, x, y);
  await page.click('.pp-trayb[data-type="pile"]');
  for (const [x, y] of [[128, 83], [128, 3], [72, 3], [72, 83]]) await tapRink(page, x, y);
  await page.click('#tray-move');
  await page.click('[data-tool="pass"]'); await tapRink(page, 125, 80); await tapRink(page, 125, 6);
  await page.waitForSelector('.toast >> text=A puck from the pile goes on their stick');
  await saved(page);
  const before = await drill(page, id);
  // second pass in the same step
  await page.click('.pp-chip[data-k="1"]');
  await page.click('[data-tool="pass"]'); await tapRink(page, 75, 6); await tapRink(page, 75, 80);
  await saved(page);
  const after = await drill(page, id);
  const firstPuck = before.steps[0].moves[0].piece;
  assert.deepEqual(after.steps[0].moves.find(m => m.piece === firstPuck), before.steps[0].moves[0], 'first pass unchanged');
  assert.deepEqual(after.start[firstPuck], before.start[firstPuck]);
  assert.equal(after.steps[0].moves.filter(m => m.line === 'pass').length, 2, 'both passes in step 1');
  assert.equal(after.steps.length, 1);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('two shooters in one step: both pucks fly in the animation', async () => {
  const { ctx, page } = await open(env);
  await page.click('#new-drill-btn'); await page.waitForSelector('.pp-editor');
  const id = await editorId(page);
  await page.selectOption('#rink-view', 'half');
  await page.click('.pp-trayb[data-type="X"]');
  for (const [x, y] of [[150, 20], [150, 65]]) await tapRink(page, x, y);
  await page.click('.pp-trayb[data-type="pile"]');
  for (const [x, y] of [[147, 16], [147, 69]]) await tapRink(page, x, y);
  await page.click('#tray-move');
  await page.click('[data-tool="shoot"]'); await tapRink(page, 150, 20); await tapRink(page, 188, 40);
  await page.waitForSelector('.toast >> text=Shot in step 1');
  await page.click('[data-tool="shoot"]'); await tapRink(page, 150, 65); await tapRink(page, 188, 45);
  await saved(page);
  const d = await drill(page, id);
  const shots = d.steps[0].moves.filter(m => m.line === 'shot');
  assert.equal(shots.length, 2, JSON.stringify(d.steps[0].moves));
  assert.notEqual(shots[0].piece, shots[1].piece, 'two different pucks');
  assert.equal(d.steps.length, 1);
  // both pucks end at the net in the animation
  const ends = await page.evaluate(async () => {
    const { frame, prepare } = await import('./app/engine/model.js?v=1.4.2');
    const d = await window.__pp.store.get('drills', location.hash.split('/')[1]);
    return frame(d, 1, 1, prepare(d)).pieces.filter(p => p.type === 'puck').map(p => [Math.round(p.x), Math.round(p.y)]);
  });
  assert.deepEqual(ends.sort(), [[188, 40], [188, 45]]);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});
