import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spline, poly, at, sub, dist } from '../../app/engine/geometry.js';
import { viewBox, onIce } from '../../app/engine/rink.js';
import {
  moveWindow, totalSeconds, positionsByStep, pathOf, movesIn, stepAt, stepStartTime,
  frame, frameAt, prepare, layoutCallouts, emptyDrill,
} from '../../app/engine/model.js';
import { frameSVG, notation, thumbnailSVG } from '../../app/engine/render.js';
import { sampleDrill } from '../../app/engine/samples.js';

const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
const pc = (fr, id) => fr.pieces.find(p => p.id === id);

test('geometry: spline passes through its points; poly length and walking', () => {
  const s = spline([[0, 0], [10, 10], [20, 0]]);
  assert.deepEqual(s[0], [0, 0]);
  assert.deepEqual(s[s.length - 1], [20, 0]);
  assert.ok(s.some(p => dist(p, [10, 10]) < 1e-9));
  const pl = poly([[0, 0], [10, 0], [10, 10]]);
  assert.equal(pl.L, 20);
  const m = at(pl, 15);
  near(m.x, 10); near(m.y, 5); near(m.ang, Math.PI / 2);
  near(sub(pl, 5, 15).L, 10);
  assert.equal(spline([[1, 2], [3, 4]]).length, 2);
});

test('rink: view boxes and flip; onIce keeps points on the sheet', () => {
  assert.equal(viewBox('full'), '-3 -3 206 91');
  assert.equal(viewBox('half'), '97 -3 106 91');
  assert.equal(viewBox('half', true), '-3 -3 106 91');
  assert.equal(viewBox('zone'), '122 -3 81 91');
  assert.equal(viewBox('neutral', true), '70 -3 60 91');
  assert.deepEqual(onIce([-10, 100]), [1, 84]);
});

test('timing windows: default, after, pass, shot, custom (and bad custom falls back)', () => {
  assert.deepEqual(moveWindow({ line: 'skate' }), [0, 1]);
  assert.deepEqual(moveWindow({ line: 'skate', when: 'after' }), [0.6, 1]);
  assert.deepEqual(moveWindow({ line: 'pass' }), [0, 0.4]);
  assert.deepEqual(moveWindow({ line: 'shot' }), [0, 0.25]);
  assert.deepEqual(moveWindow({ when: 'custom', start: 0.2, end: 0.5 }), [0.2, 0.5]);
  assert.deepEqual(moveWindow({ when: 'custom', start: 0.5, end: 0.2, line: 'skate' }), [0, 1]);
});

test('steps and time: totals, default seconds, stepAt and step start times', () => {
  const d = sampleDrill();
  assert.equal(totalSeconds(d), 8);
  assert.deepEqual(stepAt(d, 0), { k: 1, p: 0 });
  assert.equal(stepAt(d, 3).k, 2);
  assert.deepEqual(stepAt(d, 99), { k: 4, p: 1 });
  assert.equal(stepStartTime(d, 3), 4.5);
  assert.equal(totalSeconds({ steps: [{}, { seconds: -1 }] }), 4);
  assert.deepEqual(stepAt(emptyDrill(), 5), { k: 0, p: 1 });
});

test('positions: moves land on their targets; a carried puck keeps its offset from the carrier', () => {
  const d = sampleDrill(), pos = positionsByStep(d);
  assert.equal(pos.length, 5);
  assert.deepEqual(pos[1].f1, [150, 68]);
  assert.deepEqual(pos[1].pk, [152.5, 68]);   // 2.5 ft in front, as at the start
  assert.deepEqual(pos[2].pk, [145, 35.5]);   // passed
  assert.deepEqual(pos[3].pk, [160, 41.5]);   // carried by F2 with its offset
  assert.deepEqual(pos[4].pk, [188, 41]);     // shot
  assert.deepEqual(pos[4].g, [186, 42.5]);    // never moved
  assert.ok(movesIn(d, 1, 'f1', pos));
  assert.ok(!movesIn(d, 1, 'g', pos));
  assert.ok(pathOf(d, 1, 'f1', pos).L > dist([110, 70], [150, 68]));  // the bend makes it longer
});

test('frames: pieces follow paths; the carried puck stays with its carrier mid-move', () => {
  const d = sampleDrill(), c = prepare(d);
  const f0 = frame(d, 0, 1, c);
  near(pc(f0, 'f1').x, 110); near(pc(f0, 'f1').y, 70);
  const mid = frame(d, 1, 0.5, c);
  const f1 = pc(mid, 'f1'), pk = pc(mid, 'pk');
  assert.ok(f1.x > 115 && f1.x < 148);
  near(pk.x - f1.x, 2.5, 0.01); near(pk.y - f1.y, 0, 0.01);
  const end = frame(d, 1, 1, c);
  near(pc(end, 'f1').x, 150); near(pc(end, 'f1').y, 68);
  assert.deepEqual(frameAt(d, 1.25, c), mid);
});

test('frames: a pass finishes in the first 40%; an "after" move waits until 60%', () => {
  const d = sampleDrill(), c = prepare(d);
  const f = frame(d, 2, 0.4, c);
  near(pc(f, 'pk').x, 145); near(pc(f, 'pk').y, 35.5);
  const early = frame(d, 2, 0.5, c);
  near(pc(early, 'f1').x, 150); near(pc(early, 'f1').y, 68);   // not started yet
  const late = frame(d, 2, 0.8, c);
  assert.ok(pc(late, 'f1').x > 150);
});

test('facing: skating faces the direction of travel; backward faces the other way; pivot turns at the end', () => {
  const d = sampleDrill(), c = prepare(d);
  const f1 = pc(frame(d, 1, 0.99, c), 'f1');
  assert.ok(Math.cos(f1.ang) > 0.8);                 // heading towards the far end
  const back = pc(frame(d, 4, 0.5, c), 'd1');
  assert.ok(Math.cos(back.ang) < -0.8);              // skating right but facing left
  const pivoted = pc(frame(d, 4, 1, c), 'd1');
  assert.ok(Math.cos(pivoted.ang) > 0.8);            // turned to face up ice
});

test('appear and leave: a piece fades in on its first step and is absent before it', () => {
  const d = sampleDrill(), c = prepare(d);
  assert.equal(pc(frame(d, 2, 1, c), 'd1'), undefined);
  near(pc(frame(d, 3, 0.05, c), 'd1').opacity, 1 / 3, 0.01);
  assert.equal(pc(frame(d, 3, 0.5, c), 'd1').opacity, 1);
  d.pieces[0].untilStep = 2;
  const leaving = pc(frame(d, 2, 0.95, prepare(d)), 'f1');
  assert.ok(leaving.opacity < 0.5);
  assert.equal(pc(frame(d, 3, 0.5, prepare(d)), 'f1'), undefined);
});

test('glow: carrier and puck in flight light up automatically; step highlight; auto can be turned off', () => {
  const d = sampleDrill(), c = prepare(d);
  assert.equal(pc(frame(d, 1, 0.5, c), 'f1').glow, true);
  assert.equal(pc(frame(d, 2, 0.2, c), 'pk').glow, true);
  assert.equal(pc(frame(d, 2, 0.6, c), 'pk').glow, false);   // landed
  assert.equal(pc(frame(d, 3, 0.5, c), 'f1').glow, true);    // step highlight
  d.autoHighlight = false;
  assert.equal(pc(frame(d, 1, 0.5, prepare(d)), 'f1').glow, false);
});

test('callouts: show on their step, fade, and "stay" keeps them for later steps; layout avoids overlaps', () => {
  const d = sampleDrill(), c = prepare(d);
  assert.equal(frame(d, 0, 1, c).callouts.length, 0);
  const one = frame(d, 1, 0.5, c).callouts;
  assert.equal(one.length, 1); assert.equal(one[0].text, 'Head up!');
  assert.equal(frame(d, 2, 0.5, c).callouts.map(x => x.text).join(), 'Give and go');
  assert.equal(frame(d, 4, 0.5, c).callouts.map(x => x.text).join(), 'Give and go');
  const laid = layoutCallouts([{ id: 'a', text: 'One', x: 100, y: 40, opacity: 1 }, { id: 'b', text: 'Two', x: 101, y: 40, opacity: 1 }]);
  const [a, b] = laid;
  assert.ok(b.by + b.h <= a.by || b.by >= a.by + a.h, 'bubbles do not overlap');
  assert.equal(layoutCallouts([{ id: 'c', text: 'Top', x: 50, y: 5, opacity: 1 }])[0].below, true);
});

test('edge cases: empty drill, piece without a start, move to the same place, unknown team', () => {
  const e = emptyDrill();
  assert.deepEqual(frame(e, 0, 1).pieces, []);
  const d = { ...emptyDrill(), pieces: [{ id: 'a', type: 'F', team: 'green' }], steps: [{ moves: [{ piece: 'a', to: [100, 42.5] }] }] };
  const f = frame(d, 1, 0.5);
  near(pc(f, 'a').x, 100);
  assert.ok(!movesIn(d, 1, 'a'));
  assert.match(frameSVG(d, f), /<svg|<circle/);
});

test('render: notation styles, thumbnail markup and escaping', async () => {
  const pl = poly([[0, 0], [20, 0]]);
  assert.match(notation(pl, 'pass', '#000', 0.4), /stroke-dasharray/);
  assert.equal((notation(pl, 'shot', '#000', 0.4).match(/<path/g) || []).length, 2);
  assert.match(notation(pl, 'skate', '#000', 0.4, 'stop'), /<line/);
  assert.match(notation(pl, 'skate', '#000', 0.4, 'pivot'), /<circle/);
  const d = sampleDrill();
  d.title = 'A <b>&</b> "test"';
  const svg = await thumbnailSVG(d, frame);
  assert.match(svg, /^<svg/);
  assert.match(svg, /viewBox="97 -3 106 91"/);
  assert.ok(!svg.includes('<b>'));
});

test('callouts move off other pieces when the spot above is taken', () => {
  const [c] = layoutCallouts([{ id: 'a', piece: 'p1', text: 'Give and go', x: 100, y: 40, opacity: 1 }],
    [{ id: 'p1', x: 100, y: 40 }, { id: 'p2', x: 100, y: 31 }]);
  assert.notEqual(c.side, 'above');
  const [d] = layoutCallouts([{ id: 'a', piece: 'p1', text: 'Hi', x: 100, y: 40, opacity: 1 }], [{ id: 'p1', x: 100, y: 40 }]);
  assert.equal(d.side, 'above');
});
