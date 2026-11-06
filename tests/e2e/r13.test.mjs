/* 1.3.0 Edit on a phone: a compact editor when the phone is held sideways, details-only upright. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, SIZES } from './helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

async function rinkXY(page, x, y) {
  return page.evaluate(([x, y]) => {
    const svg = document.querySelector('.pp-edplayer .pp-rink');
    const p = svg.createSVGPoint(); p.x = x; p.y = y;
    const q = p.matrixTransform(svg.getScreenCTM());
    return [q.x, q.y];
  }, [x, y]);
}
const tapRink = async (page, x, y) => { const [a, b] = await rinkXY(page, x, y); await page.mouse.click(a, b); };
const drill = (page, id) => page.evaluate(id => window.__pp.store.get('drills', id), id);
const saved = page => page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved');
const editorId = page => page.evaluate(() => location.hash.split('/')[1]);
const noToasts = page => page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
const openEditor = async (page, id = 'd_samplepivot') => { await page.goto(env.server.url + '#edit/' + id); await page.waitForSelector('.pp-edplayer .pp-rink'); };

/** Visible controls smaller than 44 px (the closed drawer and scrolled-away chips don't count). */
const smallControls = page => page.evaluate(() => [...document.querySelectorAll('main button, main a.btn, main select, main input')]
  .filter(e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width && r.height && cs.visibility !== 'hidden' && e.type !== 'checkbox'; })
  .filter(e => { const r = e.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5; })
  .map(e => `${e.id || e.className || e.tagName} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));

test('held sideways, the whole editor fits: no header, no page scroll, a big rink and 44 px controls', async () => {
  for (const size of ['phoneWide', 'phoneWide2', 'phoneWide3']) {
    const { ctx, page } = await open(env, { size });
    await openEditor(page);
    await page.waitForSelector('.pp-rail');
    const m = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth,
      rink: document.querySelector('.pp-edplayer .pp-rink').getBoundingClientRect().height, header: getComputedStyle(document.querySelector('.topbar')).display,
      strip: document.querySelector('.pp-chips').getBoundingClientRect().bottom }));
    assert.ok(m.sh <= m.ih + 1 && m.sw <= m.iw + 1, `${size}: no page scrolling (${m.sw}×${m.sh})`);
    assert.ok(m.rink >= 200, `${size}: rink is ${m.rink} px tall`);
    assert.ok(m.strip <= m.ih, `${size}: the steps are on screen`);
    assert.equal(m.header, 'none', 'no app header while editing');
    assert.equal(await page.getAttribute('#panel', 'class').then(c => c.includes('open')), false, 'the drawer starts closed');
    await noToasts(page);
    assert.deepEqual(await smallControls(page), [], `${size}: every control is at least 44 px`);
    await page.click('#options-btn');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('panel')).visibility === 'visible');
    assert.deepEqual(await smallControls(page), [], `${size}: drawer controls are at least 44 px`);
    assert.deepEqual(page.errors, []);
    await ctx.close();
  }
});

test('the home-screen tip shows once, and the header comes back when you leave the editor', async () => {
  const { ctx, page } = await open(env, { size: 'phoneWide' });
  await openEditor(page);
  await page.waitForSelector('.toast:has-text("home screen")');
  await page.click('#editor-back');
  await page.waitForSelector('.pp-card');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.topbar')).display), 'none');
  await openEditor(page);
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.toast:has-text("home screen")').count(), 0, 'only once');
  await ctx.close();
});

test('build a drill from scratch sideways: place pieces, pass, shoot, a setup line, undo and redo', async () => {
  const { ctx, page } = await open(env, { size: 'phoneWide' });
  await page.click('#new-drill-btn');
  await page.waitForSelector('.pp-rail');
  await noToasts(page);
  const id = await editorId(page);

  await page.click('#rail-piece');
  assert.ok(await page.isVisible('#tray'), 'the tray opens as a pop-up');
  await page.click('.pp-trayb[data-type="F"]');
  assert.ok(!(await page.isVisible('#tray')), 'picking a piece closes it');
  assert.match(await page.textContent('#rail-piece'), /Forward/);
  await tapRink(page, 60, 42); await tapRink(page, 110, 25);
  await page.click('#rail-piece'); await page.click('.pp-trayb[data-type="pylon"]');
  await tapRink(page, 85, 60);
  await page.click('#rail-move');
  await saved(page);
  let d = await drill(page, id);
  assert.equal(d.pieces.filter(p => p.type === 'F').length, 2);
  assert.equal(d.pieces.filter(p => p.type === 'pylon').length, 1);

  await page.click('#rail-pass');
  assert.match(await page.textContent('#action-hint'), /tap the player or coach who passes/);
  await tapRink(page, 60, 42); await tapRink(page, 110, 25);
  await saved(page);
  d = await drill(page, id);
  assert.ok(d.steps.length >= 1 && d.steps.some(s => s.moves.some(m => m.line === 'pass')), 'a pass');
  assert.equal(await page.isVisible('#panel.open'), false, 'passing leaves the rink clear');

  await page.click('#rail-shoot');
  await tapRink(page, 110, 25); await tapRink(page, 186, 42.5);
  await saved(page);
  d = await drill(page, id);
  assert.ok(d.steps.some(s => s.moves.some(m => m.line === 'shot')), 'a shot');

  await page.click('#rail-draw');
  await page.click('#draw-menu [data-tool="arrow"]');
  assert.match(await page.textContent('#rail-draw'), /Arrow/);
  const [a, b] = await rinkXY(page, 40, 70), [c, e] = await rinkXY(page, 70, 70);
  await page.mouse.move(a, b); await page.mouse.down(); for (let i = 1; i <= 6; i++) await page.mouse.move(a + (c - a) * i / 6, b); await page.mouse.up();
  await page.click('#rail-move');

  await page.click('#options-btn');
  await page.click('#tab-details');
  await page.click('#add-setup');
  await page.locator('.setup-text').last().fill('Pucks on both blue lines');
  assert.ok(await page.evaluate(() => document.getElementById('panel').getBoundingClientRect().width >= innerWidth - 1), 'typing makes the drawer full width');
  await page.click('#close-drawer');
  await saved(page);
  d = await drill(page, id);
  assert.deepEqual(d.setupNotes, ['Pucks on both blue lines']);
  assert.equal(d.markup.length, 1);

  const before = JSON.stringify((await drill(page, id)).setupNotes);
  await page.click('#undo'); await saved(page);
  assert.notEqual(JSON.stringify((await drill(page, id)).setupNotes), before, 'undo');
  await page.click('#redo'); await saved(page);
  assert.equal(JSON.stringify((await drill(page, id)).setupNotes), before, 'redo');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('tapping a piece opens its options; tapping empty ice or ✕ closes them; rink view is in the ⋮ menu', async () => {
  const { ctx, page } = await open(env, { size: 'phoneWide' });
  await openEditor(page);
  await noToasts(page);
  const d = await drill(page, 'd_samplepivot');
  const g = d.pieces.find(p => p.type === 'G');
  const box = await page.locator(`[data-hit="${g.id}"]`).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForSelector('#panel.open #piece-name');
  assert.match(await page.textContent('#piece-name'), /Goalie/);
  const [x, y] = await rinkXY(page, 105, 2);
  await page.mouse.click(x, y);
  assert.equal(await page.locator('#panel.open').count(), 0, 'a tap on empty ice closes it');
  await page.click('#options-btn'); await page.click('#close-drawer');
  assert.equal(await page.locator('#panel.open').count(), 0);

  await page.click('#drill-menu');
  await page.selectOption('#menu-rink-view', 'full');
  assert.ok(await page.isHidden('#menu-flip'), 'no flip on full ice');
  await page.keyboard.press('Escape');
  await saved(page);
  assert.equal((await drill(page, 'd_samplepivot')).view.rink, 'full');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('turning the phone keeps your place: upright shows details to edit, sideways brings the tools back', async () => {
  const { ctx, page } = await open(env, { size: 'phoneWide' });
  await openEditor(page);
  await page.click('.pp-chip[data-k="2"]');
  await page.setViewportSize({ width: SIZES.phone.width, height: SIZES.phone.height });
  await page.waitForSelector('#rotate-note');
  assert.ok(!(await page.isVisible('#tools')) && !(await page.isVisible('#add-step')), 'no rink tools upright');
  assert.equal(await page.locator('.pp-tab').count(), 1, 'only Details upright');
  await page.fill('#title', 'Sideways test');
  await page.locator('#add-point').click();
  await page.locator('.point-text').last().fill('Heads up');
  await saved(page);
  const before = (await drill(page, 'd_samplepivot'));
  await tapRink(page, 150, 40);
  await page.waitForTimeout(300);
  assert.deepEqual((await drill(page, 'd_samplepivot')).pieces, before.pieces, 'tapping the rink upright changes nothing');
  assert.equal(before.title, 'Sideways test');
  assert.equal(before.coachingPoints.at(-1), 'Heads up');

  await page.setViewportSize({ width: SIZES.phoneWide.width, height: SIZES.phoneWide.height });
  await page.waitForSelector('.pp-rail');
  assert.equal(await page.getAttribute('.pp-chip[data-k="2"]', 'aria-selected'), 'true', 'same step');
  assert.equal(await page.textContent('#editor-title'), 'Sideways test');
  assert.ok(!(await page.isVisible('#rotate-note')));
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('upright: New drill opens the editor and asks you to turn the phone', async () => {
  const { ctx, page } = await open(env, { size: 'phone' });
  await page.waitForSelector('#new-drill-btn');
  await page.click('#new-drill-btn');
  await page.waitForSelector('#rotate-note');
  assert.ok(await page.isVisible('#title'));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'nothing scrolls sideways');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('1.3.1: dragging a player traces their route; dragging again keeps going (tablet and phone sideways)', async () => {
  for (const size of ['tablet', 'phoneWide']) {
    const { ctx, page } = await open(env, { size });
    await page.click('#new-drill-btn');
    await page.waitForSelector('#editor-title');
    await noToasts(page);
    const id = await editorId(page);
    if (size === 'tablet') await page.click('.pp-trayb[data-type="F"]');
    else { await page.click('#rail-piece'); await page.click('.pp-trayb[data-type="F"]'); }
    await tapRink(page, 60, 42);
    await page.click(size === 'tablet' ? '#tray-move' : '#rail-move');
    await page.click('#add-step');
    // a loop around a spot, then off up the ice
    const loop = Array.from({ length: 36 }, (_, i) => { const a = Math.PI + (i + 1) / 36 * 2 * Math.PI; return [80 + 20 * Math.cos(a), 42 + 15 * Math.sin(a)]; });
    const pts = [[60, 42], ...loop];
    const xy = []; for (const p of pts) xy.push(await rinkXY(page, ...p));
    await page.mouse.move(...xy[0]); await page.mouse.down();
    for (const p of xy.slice(1)) await page.mouse.move(...p, { steps: 2 });
    await page.mouse.up();
    await saved(page);
    let m = (await drill(page, id)).steps[0].moves[0];
    assert.ok(m.bends.length >= 4, `${size}: the loop keeps its shape (${m.bends.length} bends)`);
    const firstTo = m.to;
    const [a, b] = await rinkXY(page, ...firstTo), [c, e] = await rinkXY(page, firstTo[0] + 50, firstTo[1]);
    await page.mouse.move(a, b); await page.mouse.down(); for (let i = 1; i <= 10; i++) await page.mouse.move(a + (c - a) * i / 10, b + (e - b) * i / 10); await page.mouse.up();
    await saved(page);
    m = (await drill(page, id)).steps[0].moves[0];
    assert.ok(m.to[0] > firstTo[0] + 40, `${size}: the route carries on`);
    assert.ok(m.bends.some(p => Math.hypot(p[0] - firstTo[0], p[1] - firstTo[1]) < 2.5), `${size}: through the old end`);
    await page.click('#undo'); await saved(page);
    assert.deepEqual((await drill(page, id)).steps[0].moves[0].to, firstTo, `${size}: undo takes back the second drag`);
    assert.deepEqual(page.errors, []);
    await ctx.close();
  }
});

test('1.3.2: pass to a coach, the coach passes back, coach to coach, and the coach shoots', async () => {
  const { ctx, page } = await open(env, { size: 'tablet' });
  await page.click('#new-drill-btn');
  await page.waitForSelector('#editor-title');
  await noToasts(page);
  const id = await editorId(page);
  await page.click('.pp-trayb[data-type="F"]'); await tapRink(page, 60, 42);
  await page.click('.pp-trayb[data-type="coach"]'); await tapRink(page, 110, 20); await tapRink(page, 110, 65);
  await page.click('#tray-move');
  const pass = async (from, to) => { await page.click('[data-tool="pass"]'); await tapRink(page, ...from); await tapRink(page, ...to); await saved(page); };
  await pass([60, 42], [110, 20]);                 // player → coach
  await pass([110, 20], [110, 65]);                // coach → coach
  await pass([110, 65], [60, 42]);                 // coach → player
  let d = await drill(page, id);
  assert.equal(d.steps.length, 3, 'a step for each pass');
  assert.ok(d.steps.every(s => s.moves.some(m => m.line === 'pass')));
  await tapRink(page, 110, 65);
  assert.ok(await page.isVisible('#pass-btn') && await page.isVisible('#shoot-btn'), 'a coach has Pass and Shoot in the Piece tab');
  await page.click('[data-tool="shoot"]'); await tapRink(page, 110, 20); await tapRink(page, 186, 42.5);
  await saved(page);
  d = await drill(page, id);
  assert.ok(d.steps.at(-1).moves.some(m => m.line === 'shot'), 'the coach shoots');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});
