/* 1.4.3 coach requests: the turned view, ringette lines, nets, dump in, age groups. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewBox, viewBoxOf, turnOf, turnPoint, unturnPoint, rinkSVG, RINGETTE_X } from '../../app/engine/rink.js';
import { aroundTheBoards, rimPoint, rimNearest, PERIMETER } from '../../app/engine/boards.js';
import { frame, prepare, layoutCallouts, positionsByStep, moveWindow } from '../../app/engine/model.js';
import { frameSVG, thumbnailSVG } from '../../app/engine/render.js';
import { firstRunSamples } from '../../app/engine/samples.js';
import * as D from '../../app/drills.js';

const near = (a, b, tol = 0.6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

test('Up the ice: the view turns a quarter so the net of the end shown is at the top; Across is unchanged', () => {
  assert.equal(viewBoxOf({ rink: 'half' }), viewBox('half'));
  assert.equal(turnOf({ rink: 'half', turn: true }), -90, 'the right-hand end at the top');
  assert.equal(turnOf({ rink: 'half', flip: true, turn: true }), 90, 'Flip still applies: the left-hand end at the top');
  assert.equal(turnOf({ rink: 'full', flip: true, turn: true }), -90, 'flip only means something for half ice and zone');
  for (const view of [{ rink: 'half', turn: true }, { rink: 'zone', flip: true, turn: true }, { rink: 'full', turn: true }]) {
    const [x, y, w, h] = viewBoxOf(view).split(' ').map(Number);
    const [, , w0, h0] = viewBox(view.rink, view.flip).split(' ').map(Number);
    assert.equal(w, h0); assert.equal(h, w0);
    // the net of the end shown is near the top of the turned picture
    const net = turnPoint([view.flip ? 11 : 189, 42.5], turnOf(view));
    assert.ok(net[1] - y < 20, `net at the top (${net[1] - y} ft down)`);
    assert.ok(net[0] > x && net[0] < x + w, 'net across the middle');
  }
  for (const deg of [-90, 0, 90]) assert.deepEqual(unturnPoint(turnPoint([150, 20], deg), deg), [150, 20]);
});

test('Up the ice: labels stay upright and callouts are laid out in the turned picture', () => {
  const d = { ...firstRunSamples()[0], view: { rink: 'half', turn: true } };
  const svg = frameSVG(d, frame(d, 1, 1, prepare(d)), { pathsFor: 1 });
  assert.match(svg, /<g class="pp-ice" transform="rotate\(-90\)">/);
  assert.match(svg, /<g transform="rotate\(90\)"><text/, 'player letters turned back upright');
  const placed = layoutCallouts([{ id: 'c', piece: 'p', text: 'Hard pass', x: 150, y: 20 }], [], -90);
  const [x, y] = turnPoint([150, 20], -90);
  assert.ok(placed[0].bx >= 0 && placed[0].bx + placed[0].w <= 85, 'inside the turned ice');
  assert.ok(Math.abs(placed[0].bx + placed[0].w / 2 - x) < 40 && Math.abs(placed[0].by - y) < 20, 'beside its piece');
});

test('ringette lines: drawn only when the drill asks, yellow, at both ends', async () => {
  assert.doesNotMatch(rinkSVG('r'), /data-ringette/);
  const s = rinkSVG('r', { ringette: true });
  assert.deepEqual(RINGETTE_X, [46, 154]);
  for (const x of RINGETTE_X) assert.match(s, new RegExp(`fill="#f2c200" data-ringette="${x}"`));
  const d = { ...firstRunSamples()[0], view: { rink: 'full', ringette: true } };
  assert.match(await thumbnailSVG(d, frame), /data-ringette="46"/);
});

test('nets: drawn from above with mesh and posts, bigger than before', () => {
  const s = rinkSVG('r');
  assert.equal((s.match(/stroke="#b9c4cf"/g) || []).length, 2, 'two nets with mesh');
  assert.equal((s.match(/r="\.55" fill="#c8102e"/g) || []).length, 4, 'two posts each');
  assert.match(s, /translate\(189,42.5\) scale\(-1,1\)/, 'the right-hand net faces centre ice');
});

test('around the boards: the rim, and a dump that goes round behind the net to the far corner', () => {
  near(PERIMETER, 2 * 144 + 2 * 29 + 2 * Math.PI * 25, 0.01);
  assert.deepEqual(rimPoint(0), [28, 3]);
  near(rimNearest([100, 0]), 72);
  const r = aroundTheBoards([110, 20], [190, 75]);
  assert.ok(r.bends.length > 10);
  assert.ok(r.bends.some(([x, y]) => x > 195 && Math.abs(y - 42.5) < 5), 'passes behind the net');
  assert.ok(r.to[0] > 160 && r.to[1] > 60, 'ends in the far corner');
  for (const [x, y] of r.bends) assert.ok(x >= 2.9 && x <= 197.1 && y >= 2.9 && y <= 82.1, 'on the rim');
  const l = aroundTheBoards([90, 70], [15, 70]);
  assert.ok(l.bends[0][1] > 80, 'meets the boards on the dumper’s side');
  assert.ok(!l.bends.some(([x]) => x > 100), 'stays in that end');
});

test('dump in: its own line, corner or boards, switchable; the caption is set; timed like a pass', () => {
  let d = { ...firstRunSamples()[0] };
  d = JSON.parse(JSON.stringify(d));
  d.pieces.push({ id: 'co9', type: 'coach' }, { id: 'pz', type: 'puck' }); d.start.co9 = [110, 20]; d.start.pz = [112, 22];
  ({ drill: d } = D.addStep(d, d.steps.length));
  const k = d.steps.length;
  let n = D.dumpAt(d, k, 'co9', 'pz', [185, 10], 'corner', 'Coach dumps it in');
  let m = n.steps[k - 1].moves.find(x => x.piece === 'pz');
  assert.deepEqual([m.line, m.dump, m.to, m.bends], ['dump', 'corner', [185, 10], undefined]);
  assert.equal(n.steps[k - 1].caption, 'Coach dumps it in');
  assert.deepEqual(positionsByStep(n)[k].pz, [185, 10]);
  assert.match(frameSVG(n, frame(n, k, 1, prepare(n)), { pathsFor: k }), /stroke-dasharray="3.2 1.4"/);
  n = D.setDump(n, k, 'pz', 'boards');
  m = n.steps[k - 1].moves.find(x => x.piece === 'pz');
  assert.equal(m.dump, 'boards'); assert.ok(m.bends.length > 3); assert.deepEqual(m.aim, [185, 10]);
  assert.match(frameSVG(n, frame(n, k, 1, prepare(n)), { pathsFor: k }), /stroke-dasharray="\.05 1.3"/);
  n = D.setDump(n, k, 'pz', 'corner');
  assert.deepEqual(n.steps[k - 1].moves.find(x => x.piece === 'pz').to, [185, 10], 'back to the tapped spot');
  assert.deepEqual(moveWindow({ line: 'dump' }), [0, 0.7]);
  const mid = frame(n, k, 0.35, prepare(n)).pieces.find(p => p.id === 'pz');
  assert.ok(mid.x > 112 && mid.x < 185, 'on its way at the middle of the step');
});

test('age groups: the new list; old groups read as the matching new ones', () => {
  assert.deepEqual(D.AGES, ['U8/U9', 'U10', 'U11', 'U12', 'U13', 'U14+']);
  assert.deepEqual(D.agesOf({ ageGroups: ['U7', 'U9', 'U11', 'U13', 'U15', 'U18'] }), ['U8/U9', 'U11', 'U13', 'U14+']);
  assert.deepEqual(D.agesOf({}), []);
  const drills = [{ id: 'a', title: 'Old', ageGroups: ['U9'] }, { id: 'b', title: 'New', ageGroups: ['U12'] }];
  const found = D.findDrills(drills, { ...D.DEFAULT_FILTERS, ages: ['U8/U9'] });
  assert.deepEqual(found.map(d => d.id), ['a']);
});
