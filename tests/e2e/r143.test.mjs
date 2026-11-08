/* 1.4.3 coach requests in the editor: Up the ice, ringette lines, the Dump-in tool, the new age groups. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open } from './helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

/** Screen point of a rink spot, through the (possibly turned) rink group. */
const rinkXY = (page, x, y) => page.evaluate(([x, y]) => {
  const svg = document.querySelector('.pp-edplayer .pp-rink'), g = svg.querySelector('.pp-ice');
  const p = svg.createSVGPoint(); p.x = x; p.y = y;
  const q = p.matrixTransform(g.getScreenCTM());
  return [q.x, q.y];
}, [x, y]);
const tapRink = async (page, x, y) => { const [a, b] = await rinkXY(page, x, y); await page.mouse.click(a, b); };
const drill = (page, id = 'd_samplepivot') => page.evaluate(id => window.__pp.store.get('drills', id), id);
const saved = page => page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved');
const openEditor = async page => { await page.goto(env.server.url + '#edit/d_samplepivot'); await page.waitForSelector('.pp-edplayer .pp-rink'); };

test('Up the ice turns the rink (net at the top); dragging still lands where your finger is', async () => {
  const { ctx, page } = await open(env, { size: 'tablet' });
  await openEditor(page);
  const before = await page.getAttribute('.pp-edplayer .pp-rink', 'viewBox');
  await page.click('#turn');
  await saved(page);
  assert.equal((await drill(page)).view.turn, true);
  const vb = (await page.getAttribute('.pp-edplayer .pp-rink', 'viewBox')).split(' ').map(Number);
  const vb0 = before.split(' ').map(Number);
  assert.deepEqual([vb[2], vb[3]], [vb0[3], vb0[2]], 'the picture is now tall');
  assert.match(await page.getAttribute('.pp-edplayer .pp-ice', 'transform'), /rotate\((-?90)\)/);
  // the net of the end shown is in the top part of the picture
  const box = await page.locator('.pp-edplayer .pp-rink').boundingBox();
  const d0 = await drill(page);
  const netX = d0.view.flip ? 11 : 189;
  const [, ny] = await rinkXY(page, netX, 42.5);
  assert.ok(ny - box.y < box.height * 0.2, 'net near the top');

  // drag a player in Setup: it lands under the finger
  const p = d0.pieces.find(x => ['F', 'D', 'C', 'X'].includes(x.type));
  const [sx, sy] = await rinkXY(page, ...d0.start[p.id]);
  const target = [d0.start[p.id][0] + (d0.view.flip ? 8 : -8), d0.start[p.id][1] + 6];
  const [tx, ty] = await rinkXY(page, ...target);
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(sx + (tx - sx) * i / 8, sy + (ty - sy) * i / 8);
  await page.mouse.up();
  await saved(page);
  const got = (await drill(page)).start[p.id];
  assert.ok(Math.hypot(got[0] - target[0], got[1] - target[1]) < 1.5, `landed at ${got} (wanted ${target})`);

  // labels upright: the letter's text is turned back
  assert.ok(await page.locator('.pp-edplayer .pieces g[transform^="rotate("] > text').count() > 0);

  // Details › Rink shows the same choice; Across turns it back
  await page.click('#tab-details');
  await page.click('[aria-label="Rink picture"] button:has-text("Across")');
  await saved(page);
  assert.equal((await drill(page)).view.turn, false);
  assert.equal(await page.getAttribute('.pp-edplayer .pp-rink', 'viewBox'), before);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('ringette lines and the new age groups in Details', async () => {
  const { ctx, page } = await open(env, { size: 'tablet' });
  await openEditor(page);
  await page.click('#tab-details');
  assert.equal(await page.locator('.pp-edplayer [data-ringette]').count(), 0);
  await page.check('#ringette');
  await saved(page);
  assert.equal(await page.locator('.pp-edplayer [data-ringette]').count(), 2);
  assert.equal((await drill(page)).view.ringette, true);
  const chips = await page.locator('.pp-chipwrap').filter({ hasText: 'U14+' }).locator('button').allTextContents();
  assert.deepEqual(chips, ['U8/U9', 'U10', 'U11', 'U12', 'U13', 'U14+']);
  // the sample was tagged U9 before 1.4.3: it shows as U8/U9, and the next change saves the new name
  const old = (await drill(page)).ageGroups;
  if (old.includes('U9')) {
    assert.equal(await page.getAttribute('.pp-chipwrap button:has-text("U8/U9")', 'aria-pressed'), 'true');
  }
  const had = (await drill(page)).ageGroups.includes('U14+');
  await page.click('.pp-chipwrap button:has-text("U14+")');
  await saved(page);
  const ages = (await drill(page)).ageGroups;
  assert.ok(ages.includes('U14+') !== had && ages.every(a => ['U8/U9', 'U10', 'U11', 'U12', 'U13', 'U14+'].includes(a)), ages.join());
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('Dump in: tap who dumps, pick Around the boards, tap the corner: a step of its own with a caption', async () => {
  const { ctx, page } = await open(env, { size: 'tablet' });
  await openEditor(page);
  const d0 = await drill(page);
  const n0 = d0.steps.length;
  // go to the last step so the dumper is where they finish
  await page.click(`.pp-chips [data-k="${n0}"]`);
  const pos = await page.evaluate(() => { const fr = window.__pp.editor.player.current(); return fr.pieces.map(p => ({ id: p.id, type: p.type, x: p.x, y: p.y })); }).catch(() => null);
  await page.click('[data-tool="dump"]');
  await page.waitForSelector('#action-hint:has-text("Dump in")');
  const who = pos ? pos.find(p => ['F', 'D', 'C', 'X'].includes(p.type)) : null;
  assert.ok(who, 'a skater to dump it');
  await tapRink(page, who.x, who.y);
  await page.waitForSelector('#action-hint:has-text("where the puck should end up")');
  await page.click('#action-hint button:has-text("Around the boards")');
  const corner = who.x < 100 ? [15, 75] : [185, 75];   // the corner of the end on screen
  await tapRink(page, ...corner);
  await page.waitForSelector('.toast:has-text("Dump in")');
  await saved(page);
  const d = await drill(page);
  assert.ok(d.steps.length > n0, 'a step of its own');
  const k = d.steps.length;
  const m = d.steps[k - 1].moves.find(x => x.line === 'dump');
  assert.ok(m && m.dump === 'boards' && m.bends.length > 3, 'around the boards');
  assert.match(d.steps[k - 1].caption, /dumps it in$/);
  assert.ok(await page.locator('.pp-edplayer path[stroke-dasharray=".05 1.3"]').count() > 0, 'drawn as a dotted rim');
  // the puck's panel switches it to Into the corner
  await page.evaluate(id => window.__pp.editor.select(id), m.piece);
  await page.waitForSelector('[aria-label="Dump in"]');
  await page.click('[aria-label="Dump in"] button:has-text("Into the corner")');
  await saved(page);
  const m2 = (await drill(page)).steps[k - 1].moves.find(x => x.piece === m.piece);
  assert.equal(m2.dump, 'corner'); assert.equal(m2.bends, undefined);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});
