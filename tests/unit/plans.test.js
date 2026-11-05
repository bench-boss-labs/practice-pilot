import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../../app/plans.js';
import { firstRunSamples } from '../../app/engine/samples.js';
import { validateRecord } from '../../app/schema.js';

const [pivot, breakout, figure] = firstRunSamples();
const byId = new Map([pivot, breakout, figure].map(d => [d.id, d]));
const lookup = id => byId.get(id) || null;
const team = { iceTimeMinutes: 50 };

/** Warm-up (6) · Pass, Pivot & Go (10) · 3 rotating stations × 8 · water break (4) = 44 min. */
function plan() {
  let p = P.newPlan('p_test22', { title: 'Tuesday' });
  p = P.addBlock(p, P.drillBlock('b1', figure));
  p = P.addBlock(p, P.drillBlock('b2', pivot));
  p = P.addBlock(p, P.stationsBlock('b3'));
  for (const [id, d] of [['s1', breakout], ['s2', pivot], ['s3', figure]]) p = P.addStation(p, 'b3', { id, drillId: d.id });
  p = P.addBlock(p, P.activityBlock('b4', 'Water break', 4));
  return p;
}

test('a new plan has every field and passes validation', () => {
  const p = P.newPlan('p_abcdef');
  for (const f of ['date', 'startTime', 'iceMinutes', 'themes', 'notes', 'blocks', 'extraEquipment', 'template', 'deletedAt', 'author', 'team', 'sourcePlanId']) assert.ok(f in p, f);
  assert.deepEqual(validateRecord('plans', { ...p, schemaVersion: 1, createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z', updatedBy: 'x' }), []);
});

test('drills start at their usual length; 8 minutes when none is set', () => {
  assert.equal(P.drillBlock('x', pivot).minutes, 10);
  assert.equal(P.drillBlock('x', { id: 'd_x', minutes: null }).minutes, 8);
});

test('timing: rotating stations take minutes per station × stations; staying groups take the block length', () => {
  const p = plan();
  assert.deepEqual(P.schedule(p, team).map(s => [s.start, s.minutes]), [[0, 6], [6, 10], [16, 24], [40, 4]]);
  assert.equal(P.totalMinutes(p), 44);
  const stay = P.setBlock(p, 'b3', { rotate: false, minutes: 15 });
  assert.equal(P.totalMinutes(stay), 35);
  assert.equal(P.blockMinutes(P.setBlock(p, 'b3', { minutesPerStation: 5 }).blocks[2]), 15);
});

test('the ice-time bar: minutes left, full, and over (with the blocks past the end marked)', () => {
  const p = plan();
  assert.deepEqual(P.budget(p, team), { ice: 50, used: 44, state: 'under', words: '44 of 50 min used · 6 min left' });
  const full = P.setBlock(p, 'b4', { minutes: 10 });
  assert.equal(P.budget(full, team).words, '50 of 50 min used');
  const over = P.addBlock(p, P.activityBlock('b5', 'Scrimmage', 10));
  assert.equal(P.budget(over, team).words, '54 of 50 min · 4 min over');
  assert.deepEqual(P.schedule(over, team).map(s => s.over), [false, false, false, false, true]);
  assert.equal(P.iceOf({ ...p, iceMinutes: 60 }, team), 60);
  assert.equal(P.iceOf(p, { iceTimeMinutes: 75 }), 75);
});

test('clock times from a start time', () => {
  assert.equal(P.clock('18:15', 0), '6:15 PM');
  assert.equal(P.clock('18:15', 46), '7:01 PM');
  assert.equal(P.clock('11:50', 20), '12:10 PM');
  assert.equal(P.clock('', 10), '');
  assert.equal(P.mmss(16), '0:16'); assert.equal(P.mmss(75), '1:15');
});

test('blocks: add after, move, remove, change minutes (kept between 1 and 120)', () => {
  let p = plan();
  p = P.addBlock(p, P.activityBlock('b0', 'Warm-up skate', 5), -1);
  assert.equal(p.blocks[0].id, 'b0');
  p = P.moveBlock(p, 'b0', 1);
  assert.deepEqual(p.blocks.map(b => b.id).slice(0, 2), ['b1', 'b0']);
  assert.equal(P.moveBlock(p, 'b1', -1), p);
  p = P.removeBlock(p, 'b0');
  assert.equal(p.blocks.length, 4);
  assert.equal(P.setBlock(p, 'b1', { minutes: 0 }).blocks[0].minutes, 1);
  assert.equal(P.setBlock(p, 'b1', { minutes: 500 }).blocks[0].minutes, 120);
});

test('stations: areas are offered in turn, at most four, edit and remove', () => {
  let p = plan();
  assert.deepEqual(p.blocks[2].stations.map(s => s.area), ['Near end', 'Neutral zone', 'Far end']);
  p = P.addStation(p, 'b3', { id: 's4', drillId: pivot.id });
  assert.equal(P.addStation(p, 'b3', { id: 's5', drillId: pivot.id }), p, 'no fifth station');
  p = P.setStation(p, 'b3', 's1', { helpers: ['Sam'], area: 'Defence side' });
  assert.deepEqual(p.blocks[2].stations[0].helpers, ['Sam']);
  p = P.removeStation(p, 'b3', 's2');
  assert.deepEqual(p.blocks[2].stations.map(s => s.id), ['s1', 's3', 's4']);
});

test('equipment: the most needed at once; stations running together add up', () => {
  const p = plan();
  const eq = Object.fromEntries(P.equipment(p, lookup).map(e => [e.type, e.count]));
  // stations: breakout (1 puck) + pivot (1 pylon, 1 puck, 1 pile) + figure (2 pylons) at once
  assert.deepEqual(eq, { pylon: 3, puck: 2, pile: 1 });
  assert.equal(P.equipment(p, lookup).find(e => e.type === 'pile').label, 'Puck pile');
  assert.equal(P.setupSheet(p, lookup).length, 3, 'each drill once');
  assert.equal(P.setupSheet(p, lookup)[0].title, 'Figure-8 Edges');
});

test('helper names are collected from every plan, A to Z', () => {
  let p = P.setStation(plan(), 'b3', 's1', { helpers: ['Sam', 'jo'] });
  p = P.setBlock(p, 'b2', { helpers: ['Coach C', 'Sam'] });
  assert.deepEqual(P.helperNames([p]), ['Coach C', 'jo', 'Sam']);
});

test('a drill gone for good: its block becomes an activity with the old title; stations drop it', () => {
  const p = plan();
  const without = id => (x => (x === id ? null : lookup(x)));
  const s = P.settleGone(p, without(pivot.id), { [pivot.id]: 'Pass, Pivot & Go' });
  assert.deepEqual(s.blocks[1], { id: 'b2', kind: 'activity', label: 'Pass, Pivot & Go', minutes: 10, note: '' });
  assert.equal(s.blocks[2].stations.length, 2);
  assert.equal(P.settleGone(p, lookup), p, 'nothing to settle');
  assert.equal(P.drillStatus(pivot.id, () => ({ deletedAt: 'x' })), 'deleted');
});

test('copies: duplicate has no date; templates and plans from templates record their source', () => {
  const p = { ...plan(), date: '2026-11-11' };
  const c = P.duplicatePlan(p, 'p_copy22');
  assert.equal(c.title, 'Copy of Tuesday'); assert.equal(c.date, ''); assert.equal(c.sourcePlanId, 'p_test22');
  const t = P.planTemplate(p, 'p_tmpl22');
  assert.equal(t.template, true);
  const n = P.planFromTemplate(t, 'p_new222');
  assert.equal(n.template, false); assert.deepEqual(n.blocks, p.blocks);
});

test('the plans list: search across drill names and themes, newest practice first, templates and bin apart', () => {
  const a = { ...plan(), id: 'p_a', title: 'Edges night', date: '2026-11-04', themes: 'Stay low' };
  const b = { ...P.newPlan('p_b', { title: 'Shooting' }), date: '2026-11-11' };
  const t = { ...P.newPlan('p_t', { title: 'Template' }), template: true };
  const g = { ...P.newPlan('p_g', { title: 'Gone' }), deletedAt: '2026-11-05T00:00:00Z' };
  const all = [a, b, t, g];
  assert.deepEqual(P.findPlans(all).map(p => p.id), ['p_b', 'p_a']);
  assert.deepEqual(P.findPlans(all, { q: 'breakout' }, lookup).map(p => p.id), ['p_a']);
  assert.deepEqual(P.findPlans(all, { q: 'stay low' }, lookup).map(p => p.id), ['p_a']);
  assert.deepEqual(P.findPlans(all, { show: 'templates' }).map(p => p.id), ['p_t']);
  assert.deepEqual(P.findPlans(all, { show: 'deleted' }).map(p => p.id), ['p_g']);
  assert.equal(P.dayLabel('2026-11-11'), 'Wed, Nov 11');
  assert.equal(P.dayLabel(''), '');
});
