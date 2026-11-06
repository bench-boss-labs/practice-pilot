import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../../app/drills.js';
import { newDrill, validateRecord } from '../../app/schema.js';
import { positionsByStep, frame, prepare, moveOf } from '../../app/engine/model.js';
import { firstRunSamples, sampleDrill } from '../../app/engine/samples.js';

const blank = () => newDrill('d_test22');
const build = () => {
  let d = blank();
  d = D.addPiece(d, { id: 'f1', type: 'F', team: 'red', at: [110, 70] });
  d = D.addPiece(d, { id: 'pk', type: 'puck', at: [112.5, 70] });
  d = D.addPiece(d, { id: 'c1', type: 'pylon', at: [140, 42.5] });
  d = D.addStep(d, 0).drill;
  return d;
};

test('new drills have every v1 field and pass validation', () => {
  const d = blank();
  for (const f of ['setupNotes', 'view', 'start', 'markup', 'autoHighlight', 'goalieNotes', 'description', 'template', 'sample', 'deletedAt']) assert.ok(f in d, f);
  assert.deepEqual(validateRecord('drills', { ...d, schemaVersion: 1, createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z', updatedBy: 'x' }), []);
});

test('edits never change their input', () => {
  const d = build(), before = JSON.stringify(d);
  D.dragPiece(d, 1, 'f1', [150, 60]); D.removePiece(d, 'f1'); D.removeStep(d, 1); D.setDetails(d, { title: 'X' });
  assert.equal(JSON.stringify(d), before);
});

test('placing pieces: players get a team, boards a rotation, text a label; a piece placed in a step appears there', () => {
  let d = D.addPiece(blank(), { id: 'b', type: 'board', at: [50, 50] });
  assert.equal(d.pieces[0].rotate, 0);
  d = D.addPiece(d, { id: 't', type: 'text', at: [-20, 300] });
  assert.equal(d.pieces[1].text, 'Text');
  assert.deepEqual(d.start.t, [1, 84]);                       // kept on the ice
  d = D.addPiece(d, { id: 'x', type: 'X', team: 'blue', at: [60, 60], step: 2 });
  assert.equal(d.pieces[2].fromStep, 2);
  assert.equal(d.pieces[2].team, 'blue');
});

test('dragging: Setup moves the start; a step creates a move; a player with the puck on their stick carries it', () => {
  let d = build();
  d = D.dragPiece(d, 0, 'c1', [150, 40]);
  assert.deepEqual(d.start.c1, [150, 40]);
  d = D.dragPiece(d, 1, 'f1', [150, 60]);
  const m = moveOf(d.steps[0], 'f1');
  assert.deepEqual(m.to, [150, 60]);
  assert.equal(m.line, 'skate-puck');
  assert.equal(moveOf(d.steps[0], 'pk').carriedBy, 'f1');
  assert.deepEqual(positionsByStep(d)[1].pk, [152.5, 60]);
  // a pylon never moves: dragging it in a step moves its spot
  d = D.dragPiece(d, 1, 'c1', [160, 40]);
  assert.equal(moveOf(d.steps[0], 'c1'), null);
  assert.deepEqual(d.start.c1, [160, 40]);
});

test('dragging a carried puck turns it into a pass; Carried picks the nearest player', () => {
  let d = D.dragPiece(build(), 1, 'f1', [150, 60]);
  d = D.dragPiece(d, 1, 'pk', [170, 30]);
  const m = moveOf(d.steps[0], 'pk');
  assert.equal(m.line, 'pass'); assert.equal(m.carriedBy, undefined);
  d = D.setMove(d, 1, 'pk', { line: 'carried' });
  assert.equal(moveOf(d.steps[0], 'pk').carriedBy, 'f1');
  assert.equal(moveOf(d.steps[0], 'pk').to, undefined);
});

test('move options: finish, timing windows, bends and straighten', () => {
  let d = D.dragPiece(build(), 1, 'f1', [150, 60]);
  d = D.setMove(d, 1, 'f1', { finish: 'pivot' });
  d = D.setMove(d, 1, 'f1', { when: 'custom', start: 0.2, end: 0.7 });
  let m = moveOf(d.steps[0], 'f1');
  assert.equal(m.finish, 'pivot'); assert.equal(m.start, 0.2); assert.equal(m.end, 0.7);
  d = D.setMove(d, 1, 'f1', { when: 'after' });
  m = moveOf(d.steps[0], 'f1');
  assert.equal(m.start, undefined);
  d = D.addBend(d, 1, 'f1'); d = D.addBend(d, 1, 'f1');
  assert.equal(moveOf(d.steps[0], 'f1').bends.length, 2);
  d = D.moveBend(d, 1, 'f1', 0, [120, 80]);
  assert.deepEqual(moveOf(d.steps[0], 'f1').bends[0], [120, 80]);
  d = D.setMove(d, 1, 'f1', { bends: [] });
  assert.equal(moveOf(d.steps[0], 'f1').bends, undefined);
  d = D.clearMove(d, 1, 'f1');
  assert.equal(d.steps[0].moves.length, 0);   // the carry went with it
});

test('removing a piece removes it from every step; removing a carried puck turns "with puck" into "skate"', () => {
  let d = D.dragPiece(build(), 1, 'f1', [150, 60]);
  d = D.addCallout(d, 1, 'f1', 'Go'); d = D.setHighlight(d, 1, 'f1', true);
  const noPuck = D.removePiece(d, 'pk');
  assert.equal(moveOf(noPuck.steps[0], 'f1').line, 'skate');
  assert.equal(noPuck.start.pk, undefined);
  const noF = D.removePiece(d, 'f1');
  assert.equal(noF.steps[0].moves.length, 0);
  assert.equal(noF.steps[0].callouts.length, 0);
  assert.deepEqual(noF.steps[0].highlight, []);
  assert.deepEqual(positionsByStep(noF)[1].pk, [112.5, 70]);   // the puck stays where it was
});

test('steps: add after, remove (a piece first seen there appears in the next), reorder, captions and length', () => {
  let d = build();
  d = D.addStep(d, 1).drill; d = D.addStep(d, 2).drill;          // 3 steps
  d = D.addPiece(d, { id: 'x', type: 'X', at: [50, 50], step: 2 });
  d.pieces.find(p => p.id === 'x').untilStep = 3;
  d = D.addMark(d, { id: 'm1', step: 2, kind: 'box', points: [[1, 1], [5, 5]] });
  d = D.addMark(d, { id: 'm2', step: 3, kind: 'box', points: [[1, 1], [5, 5]] });
  const r = D.removeStep(d, 2);
  assert.equal(r.steps.length, 2);
  assert.equal(r.pieces.find(p => p.id === 'x').fromStep, 2);
  assert.equal(r.pieces.find(p => p.id === 'x').untilStep, 2);
  assert.deepEqual(r.markup.map(m => [m.id, m.step]), [['m2', 2]]);
  d = D.setStep(d, 1, { caption: 'First' }); d = D.setStep(d, 2, { caption: 'Second', seconds: 9 });
  assert.equal(d.steps[1].seconds, 6);
  const sw = D.moveStep(d, 2, -1);
  assert.deepEqual(sw.steps.map(s => s.caption), ['Second', 'First', '']);
  assert.equal(sw.pieces.find(p => p.id === 'x').fromStep, 1);
  assert.equal(sw.markup.find(m => m.id === 'm1').step, 1);
  assert.equal(D.moveStep(d, 1, -1), d);                          // can't go before step 1
  const added = D.addStep(d, 1);
  assert.equal(added.k, 2);
  assert.equal(added.drill.pieces.find(p => p.id === 'x').fromStep, 3);
});

test('callouts: limited to 40 characters, this step or until the end, edit and remove; highlight toggles', () => {
  let d = D.addStep(build(), 1).drill;
  d = D.addCallout(d, 1, 'f1', 'x'.repeat(60), true);
  assert.equal(d.steps[0].callouts[0].text.length, D.CALLOUT_MAX);
  assert.equal(D.calloutsFor(d, 2, 'f1').length, 1);
  d = D.setCallout(d, 1, 0, { stay: false, text: 'Head up' });
  assert.equal(D.calloutsFor(d, 2, 'f1').length, 0);
  assert.equal(D.calloutsFor(d, 1, 'f1')[0].text, 'Head up');
  d = D.removeCallout(d, 1, 0);
  assert.equal(d.steps[0].callouts.length, 0);
  d = D.setHighlight(d, 2, 'f1', true);
  assert.deepEqual(d.steps[1].highlight, ['f1']);
  assert.equal(frame(d, 2, 0.5, prepare(d)).pieces.find(p => p.id === 'f1').glow, true);
  assert.equal(frame(d, 1, 0.5, prepare(d)).pieces.find(p => p.id === 'f1').glow, false);
});

test('markup: strokes are thinned and kept on the ice; erase one or clear all', () => {
  const pts = Array.from({ length: 50 }, (_, i) => [10 + i * 0.1, 10]);
  const s = D.smoothStroke(pts);
  assert.ok(s.length < 10 && s.length >= 2);
  let d = D.addMark(blank(), { id: 'a', step: null, kind: 'pen', points: s, colour: 'orange' });
  d = D.addMark(d, { id: 'b', step: 1, kind: 'text', points: [[300, 300]], text: 'Here' });
  assert.deepEqual(d.markup[1].points[0], [199, 84]);
  assert.deepEqual(D.removeMark(d, 'a').markup.map(m => m.id), ['b']);
  assert.equal(D.clearMarkup(d).markup.length, 0);
});

test('video links: sites are named; anything that is not a web address is refused', () => {
  assert.equal(D.videoLink('https://www.youtube.com/watch?v=abc').site, 'YouTube');
  assert.equal(D.videoLink('youtu.be/abc').site, 'YouTube');
  assert.equal(D.videoLink('https://www.instagram.com/reel/x').site, 'Instagram');
  assert.equal(D.videoLink('https://m.facebook.com/watch/1').site, 'Facebook');
  assert.equal(D.videoLink('https://www.tiktok.com/@a/video/1').site, 'TikTok');
  assert.equal(D.videoLink('https://hockeycanada.ca/drill').site, 'hockeycanada.ca');
  for (const bad of ['', 'not a link', 'javascript:alert(1)', 'ftp://x.com/a', 'http://localhost']) assert.equal(D.videoLink(bad), null, bad);
});

test('copies: duplicate, template and drill-from-template record where they came from', () => {
  const s = firstRunSamples()[0];
  const c = D.duplicateDrill(s, 'd_copy22');
  assert.equal(c.title, 'Copy of Pass, Pivot & Go');
  assert.equal(c.sourceDrillId, 'd_samplepivot');
  assert.equal(c.sample, false);
  const t = D.templateFrom(s, 'd_tmpl22');
  assert.equal(t.template, true); assert.equal(t.title, s.title);
  const n = D.drillFromTemplate(t, 'd_new222');
  assert.equal(n.template, false); assert.equal(n.sourceDrillId, 'd_tmpl22');
  assert.deepEqual(n.steps, s.steps);
});

test('the bin keeps drills 30 days', () => {
  const now = new Date('2026-12-10T12:00:00Z');
  const drills = [{ id: 'a', deletedAt: '2026-11-01T00:00:00Z' }, { id: 'b', deletedAt: '2026-11-20T00:00:00Z' }, { id: 'c', deletedAt: null }];
  assert.deepEqual(D.expired(drills, now), ['a']);
  assert.equal(D.daysLeft(drills[1], now), 10);
});

test('search: every word must match, ignoring capitals and accents, across titles, captions, callouts and points', () => {
  const all = firstRunSamples().map((d, i) => ({ ...d, updatedAt: `2026-11-0${i + 1}T00:00:00Z` }));
  const f = q => D.findDrills(all, { ...D.DEFAULT_FILTERS, q }).map(d => d.title);
  assert.deepEqual(f('pivot pass'), ['Pass, Pivot & Go']);
  assert.deepEqual(f('PIVOT'), ['Pass, Pivot & Go']);
  assert.deepEqual(f('find your winger'), ['Breakout Pass 1 on 1']);    // a callout
  assert.deepEqual(f('outside edge'), ['Figure-8 Edges']);             // a coaching point
  assert.deepEqual(f('pylons centre red line'), ['Figure-8 Edges']);   // a setup line
  assert.deepEqual(f('pivot breakout'), []);
  all[0].title = 'Passe éclair';
  assert.deepEqual(f('eclair'), ['Passe éclair']);
});

test('filters: tags need all picked, ages/levels/rinks any picked; Show picks drills, samples, templates or the bin', () => {
  const s = firstRunSamples();
  const mine = { ...newDrill('d_mine22', { title: 'Mine' }), tags: ['Battle'], ageGroups: ['U11'], level: 'Advanced', updatedAt: '2026-11-09T00:00:00Z' };
  const tmpl = { ...newDrill('d_tmpl22', { title: 'Tmpl' }), template: true };
  const gone = { ...newDrill('d_gone22', { title: 'Gone' }), deletedAt: '2026-11-04T00:00:00Z' };
  const all = [...s, mine, tmpl, gone];
  const f = o => D.findDrills(all, { ...D.DEFAULT_FILTERS, ...o }).map(d => d.title);
  assert.deepEqual(f({ tags: ['Passing', 'Battle'] }), ['Breakout Pass 1 on 1']);
  assert.deepEqual(f({ tags: ['Battle'], ages: ['U11'], sort: 'az' }), ['Breakout Pass 1 on 1', 'Mine']);
  assert.deepEqual(f({ levels: ['Advanced'] }), ['Mine']);
  assert.deepEqual(f({ rinks: ['neutral'] }), ['Figure-8 Edges']);
  assert.equal(f({}).length, 4);                                        // drills include samples
  assert.deepEqual(f({ show: ['samples'], sort: 'az' }), ['Breakout Pass 1 on 1', 'Figure-8 Edges', 'Pass, Pivot & Go']);
  assert.deepEqual(f({ show: ['templates'] }), ['Tmpl']);
  assert.deepEqual(f({ show: ['deleted'] }), ['Gone']);
  assert.equal(f({ sort: 'edited' })[0], 'Mine');
  assert.equal(f({ sort: 'steps' })[0], 'Breakout Pass 1 on 1');
  assert.ok(D.filtersOn({ ...D.DEFAULT_FILTERS, ages: ['U7'] }));
  assert.ok(!D.filtersOn(D.DEFAULT_FILTERS));
  assert.deepEqual(D.tagsInUse([mine, gone, { tags: ['Zebra', 'Passing'] }]), ['Passing', 'Battle', 'Zebra']);
});

test('500 drills filter in well under 100 ms', () => {
  const base = firstRunSamples();
  const many = Array.from({ length: 500 }, (_, i) => ({ ...base[i % 3], id: `d_many${i}`, updatedAt: new Date(2026, 0, 1 + i).toISOString() }));
  const texts = new Map();
  D.findDrills(many, { ...D.DEFAULT_FILTERS, q: 'pass' }, texts);
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) D.findDrills(many, { ...D.DEFAULT_FILTERS, q: 'pivot pass', tags: ['Passing'], ages: ['U11'] }, texts);
  assert.ok((performance.now() - t0) / 10 < 100);
});

test('the samples are valid drills that play from start to end', () => {
  for (const d of firstRunSamples()) {
    const rec = { ...d, schemaVersion: 1, createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z', updatedBy: 'x' };
    assert.deepEqual(validateRecord('drills', rec), [], d.title);
    const c = prepare(d);
    for (let k = 1; k <= d.steps.length; k++) for (const p of [0, 0.5, 1]) {
      for (const pc of frame(d, k, p, c).pieces) assert.ok(Number.isFinite(pc.x) && Number.isFinite(pc.y), `${d.title} ${k} ${pc.id}`);
    }
    assert.match(D.lengthLabel(d), /^\d+ steps · [\d.]+ s$/);
  }
  assert.equal(D.lengthLabel(sampleDrill()), '4 steps · 8 s');
});

test('pass to a teammate: the puck goes to their stick where they end up; it waits if they are skating', () => {
  let d = build();
  d = D.addPiece(d, { id: 'f2', type: 'F', team: 'red', at: [140, 20] });
  d = D.dragPiece(d, 1, 'f2', [150, 30]);                     // the receiver skates in step 1
  assert.equal(D.puckWith(d, 1, 'f1').id, 'pk');               // on f1's stick at the start of step 1
  assert.equal(D.puckWith(d, 1, 'f2'), null);
  const p = D.passTo(d, 1, 'f1', 'pk', 'f2');
  const m = moveOf(p.steps[0], 'pk');
  assert.equal(m.line, 'pass'); assert.equal(m.when, 'after');
  assert.ok(Math.abs(Math.hypot(m.to[0] - 150, m.to[1] - 30) - 2.5) < 0.2, 'lands 2.5 ft in front of the receiver');
  // a receiver standing still: the pass goes straight away
  const still = D.passTo(D.clearMove(d, 1, 'f2'), 1, 'f1', 'pk', 'f2');
  assert.equal(moveOf(still.steps[0], 'pk').when, undefined);
  // the receiver has it on their stick for the next step, so dragging them carries it
  let n = D.addStep(p, 1).drill;
  assert.equal(D.puckWith(n, 2, 'f2').id, 'pk');
  n = D.dragPiece(n, 2, 'f2', [170, 40]);
  assert.equal(moveOf(n.steps[1], 'pk').carriedBy, 'f2');
});

test('passing or shooting replaces a carry, and the passer stops carrying', () => {
  let d = D.dragPiece(build(), 1, 'f1', [150, 60]);            // carrying in step 1
  assert.equal(D.puckWith(d, 1, 'f1').id, 'pk');
  const s = D.shootAt(d, 1, 'f1', 'pk', [188, 42]);
  assert.deepEqual(moveOf(s.steps[0], 'pk'), { piece: 'pk', line: 'shot', to: [188, 42] });
  assert.equal(moveOf(s.steps[0], 'f1').line, 'skate');
});

test('what moves in a step, together', () => {
  let d = build();
  d = D.addPiece(d, { id: 'f2', type: 'F', team: 'red', at: [140, 20] });
  d = D.dragPiece(d, 1, 'f1', [150, 60]);
  d = D.dragPiece(d, 1, 'f2', [150, 30]);
  assert.deepEqual(D.movingIn(d, 1).map(x => x.piece.id), ['f1', 'pk', 'f2']);
  assert.deepEqual(D.movingIn(d, 2), []);
});

test('giving a player the puck: a free puck moves to their stick for step 1; otherwise a new one appears, never a used one', () => {
  let d = build();                                             // f1 at 110,70 with pk on the stick
  d = D.addPiece(d, { id: 'f2', type: 'F', team: 'red', at: [150, 20] });
  let g = D.giveTo(d, 1, 'f2', [160, 20], 'new1');
  assert.equal(g.how, 'new', 'f1’s puck is not taken');
  assert.deepEqual(g.drill.start.pk, [112.5, 70]);
  assert.equal(D.puckWith(g.drill, 1, 'f2').id, 'new1');
  d = D.addPiece(d, { id: 'pk2', type: 'puck', at: [60, 40] });  // a free puck nobody uses
  g = D.giveTo(d, 1, 'f2', [160, 20], 'new1');
  assert.equal(g.how, 'setup'); assert.equal(g.puck, 'pk2');
  assert.deepEqual(g.drill.start.pk2, [152.5, 20]);
  d = D.addStep(d, 1).drill;
  g = D.giveTo(d, 2, 'f2', null, 'new1');
  assert.equal(g.how, 'new', 'in a later step, a new puck appears instead of changing an earlier step');
  assert.equal(g.drill.pieces.find(p => p.id === 'new1').fromStep, 2);
  assert.deepEqual(g.drill.steps[0], d.steps[0]);
  d = D.addPiece(d, { id: 'pile1', type: 'pile', at: [154, 24] });
  assert.equal(D.giveTo(d, 2, 'f2', null, 'new1').how, 'pile');
});

test('two players passing (Cristian’s video): the second pass never changes the first one', () => {
  // four skaters on the blue lines, each beside a puck pile, no loose pucks
  let d = blank();
  for (const [id, at] of [['a', [125, 82]], ['b', [125, 4]], ['c', [75, 4]], ['e', [75, 82]]]) {
    d = D.addPiece(d, { id, type: 'X', team: 'red', at });
    d = D.addPiece(d, { id: `pile-${id}`, type: 'pile', at: [at[0] + 3, at[1] + (at[1] > 40 ? 2 : -2)] });
  }
  d = D.addStep(d, 0).drill;
  const passIn = (dr, k, from, to, newId) => {
    const g = D.giveTo(dr, k, from, positionsByStep(dr)[k][to], newId);
    return D.passTo(g.drill, k, from, g.puck, to);
  };
  // pass 1: a → b in step 1
  d = passIn(d, 1, 'a', 'b', 'p1');
  const first = JSON.stringify(d.steps[0].moves);
  // pass 2 in the same step: c → e
  const same = passIn(d, 1, 'c', 'e', 'p2');
  assert.deepEqual(same.steps[0].moves.filter(m => m.piece === 'p1'), JSON.parse(first), 'the first pass is untouched');
  assert.equal(same.steps[0].moves.find(m => m.piece === 'p2').line, 'pass');
  assert.deepEqual(same.start.p1, d.start.p1, 'the first puck stays with the first passer');
  // or pass 2 in step 2: c → e
  const next = passIn(D.addStep(d, 1).drill, 2, 'c', 'e', 'p2');
  assert.equal(JSON.stringify(next.steps[0].moves), first, 'step 1 is untouched');
  assert.equal(next.pieces.find(p => p.id === 'p2').fromStep, 2);
  assert.equal(D.puckWith(next, 2, 'c').id, 'p2');
});

/* 1.3.1: every drag of a player traces their route. */
const trailOf = (from, f, n = 40) => [from, ...Array.from({ length: n }, (_, i) => f((i + 1) / n))];

test('tracing: a nearly straight drag stays a clean straight line', () => {
  const d = build();
  const t = trailOf([110, 70], u => [110 + 40 * u, 70 + Math.sin(u * 40) * 0.4]);
  const m = moveOf(D.traceMove(d, 1, 'f1', t).steps[0], 'f1');
  assert.deepEqual(m.bends, []);
  assert.equal(m.to[0], 150); assert.ok(Math.abs(m.to[1] - 70) < 0.5);
});

test('tracing: a loop keeps its shape with bend points the path passes through', () => {
  const d = build();
  const t = trailOf([110, 70], u => [130 + 20 * Math.cos(Math.PI + u * 2 * Math.PI), 60 + 10 * Math.sin(Math.PI + u * 2 * Math.PI)]);
  t[0] = [110, 70];
  const n = D.traceMove(d, 1, 'f1', t), m = moveOf(n.steps[0], 'f1');
  assert.ok(m.bends.length >= 4 && m.bends.length <= D.MAX_BENDS, `${m.bends.length} bends`);
  assert.ok(m.bends.some(b => b[0] > 145), 'goes round the far side of the loop');
  assert.ok(prepare(n), 'the traced drill still plays');
});

test('tracing: a long zig-zag is kept to at most 12 bend points', () => {
  const d = build();
  const t = trailOf([110, 70], u => [60 + 120 * u, 42 + (Math.floor(u * 30) % 2 ? 20 : -20)], 300);
  t[0] = [110, 70];
  const m = moveOf(D.traceMove(d, 1, 'f1', t).steps[0], 'f1');
  assert.ok(m.bends.length <= D.MAX_BENDS);
});

test('tracing: dragging again carries on from where the route ended', () => {
  let d = build();
  d = D.traceMove(d, 1, 'f1', trailOf([110, 70], u => [110 + 30 * u, 70 - 30 * u]));
  const first = moveOf(d.steps[0], 'f1');
  assert.deepEqual(first.to, [140, 40]);
  d = D.traceMove(d, 1, 'f1', trailOf([140, 40], u => [140 + 30 * u, 40 + 30 * u]));
  const m = moveOf(d.steps[0], 'f1');
  assert.deepEqual(m.to, [170, 70]);
  assert.ok(m.bends.some(b => Math.hypot(b[0] - 140, b[1] - 40) < 1), 'the old end is now a bend on the way');
});

test('tracing: Setup places, pucks and pylons stay straight, and the puck on the stick comes along', () => {
  const d = build(), wiggle = from => trailOf(from, u => [from[0] + 30 * u, from[1] + 10 * Math.sin(u * Math.PI)]);
  const s = D.traceMove(d, 0, 'f1', wiggle([110, 70]));
  assert.deepEqual(s.start.f1, [140, 70]); assert.equal(s.steps[0].moves.length, 0);
  const pk = moveOf(D.traceMove(d, 1, 'pk', wiggle([112.5, 70])).steps[0], 'pk');
  assert.ok(!pk.bends || !pk.bends.length, 'a dragged puck is a straight pass');
  const n = D.traceMove(d, 1, 'f1', wiggle([110, 70]));
  const m = moveOf(n.steps[0], 'f1');
  assert.equal(m.line, 'skate-puck');
  assert.ok(m.bends.length >= 1);
  assert.equal(moveOf(n.steps[0], 'pk').carriedBy, 'f1');
  assert.equal(JSON.stringify(d), JSON.stringify(build()), 'the input is unchanged');
});

/* 1.3.2: coaches pass, receive, shoot and carry the puck. */
test('coaches handle the puck: player to coach, coach to player, coach to coach, shoot and carry', () => {
  let d = D.addPiece(build(), { id: 'co1', type: 'coach', at: [150, 10] });
  d = D.addPiece(d, { id: 'co2', type: 'coach', at: [170, 75] });
  // player → coach: lands on the coach's stick, and the coach has it next step
  const toCoach = D.passTo(d, 1, 'f1', 'pk', 'co1');
  assert.equal(moveOf(toCoach.steps[0], 'pk').line, 'pass');
  let n = D.addStep(toCoach, 1).drill;
  assert.equal(D.puckWith(n, 2, 'co1').id, 'pk');
  // coach carries it: the wavy line, and the puck rides along
  const carry = D.dragPiece(n, 2, 'co1', [160, 30]);
  assert.equal(moveOf(carry.steps[1], 'co1').line, 'skate-puck');
  assert.equal(moveOf(carry.steps[1], 'pk').carriedBy, 'co1');
  const f = frame(carry, 2, 0.5, prepare(carry));
  const pc = f.pieces.find(x => x.id === 'pk'), cc = f.pieces.find(x => x.id === 'co1');
  assert.ok(Math.hypot(pc.x - cc.x, pc.y - cc.y) < 4.5, 'the puck stays on the coach’s stick');
  // coach → coach, then coach → player, then the coach shoots
  const cc2 = D.passTo(n, 2, 'co1', 'pk', 'co2');
  assert.equal(moveOf(cc2.steps[1], 'pk').line, 'pass');
  const back = D.passTo(n, 2, 'co1', 'pk', 'f1');
  assert.equal(moveOf(back.steps[1], 'pk').line, 'pass');
  const shot = D.shootAt(n, 2, 'co1', 'pk', [188, 42]);
  assert.equal(moveOf(shot.steps[1], 'pk').line, 'shot');
  // a puck set to Carried rides with the nearest coach too
  const near = D.setMove(D.dragPiece(n, 2, 'pk', [155, 15]), 2, 'pk', { line: 'carried' });
  assert.equal(moveOf(near.steps[1], 'pk').carriedBy, 'co1');
  // giving a coach a puck works like a player
  const g = D.giveTo(d, 1, 'co2', [150, 60], 'new1');
  assert.equal(D.puckWith(g.drill, 1, 'co2').id, g.puck);
});
