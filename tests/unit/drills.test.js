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
