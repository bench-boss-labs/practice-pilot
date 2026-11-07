/* 1.4.2 Share a drill: the drill file, the video's timeline, the QR target. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../../app/drillshare-core.js';
import { sampleDrill } from '../../app/engine/samples.js';
import qrcode from '../../vendor/qrcode-generator/1.4.4/qrcode.js';

const rec = () => ({ ...sampleDrill(), id: 'd_samplez', schemaVersion: 1, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'x', author: '', team: '', sourceDrillId: null, submittedAt: null, thumb: '<svg/>', pub: { state: 'published', at: 'X' }, sample: true });

test('drill file: made without picture or sync state; imports as a new copy that remembers its source', () => {
  const f = X.makeDrillFile(rec(), { appVersion: '1.4.2', at: '2026-11-07T00:00:00.000Z', team: 'Bulldogs' });
  assert.equal(f.format, X.DRILL_FORMAT);
  assert.equal(f.drill.thumb, undefined); assert.equal(f.drill.pub, undefined); assert.equal(f.drill.sample, false);
  assert.equal(X.drillFileName({ title: 'Pass / Pivot: Go' }), 'Pass - Pivot- Go.practicepilot');
  const d = X.readDrillFile(JSON.stringify(f), { newId: () => 'd_newonez', now: '2026-11-08T00:00:00.000Z' });
  assert.equal(d.id, 'd_newonez'); assert.equal(d.sourceDrillId, 'd_samplez');
  assert.equal(d.createdAt, '2026-11-08T00:00:00.000Z'); assert.equal(d.title, rec().title);
  assert.deepEqual(d.steps, rec().steps, 'the drill itself arrives whole');
});

test('drill file: wrong files, newer files and damaged files are refused with words', () => {
  const opt = { newId: () => 'd_newonez' };
  assert.throws(() => X.readDrillFile('not json', opt), /isn’t a Practice Pilot drill/);
  assert.throws(() => X.readDrillFile('{"format":"practice-pilot-library"}', opt), /isn’t a Practice Pilot drill/);
  assert.throws(() => X.readDrillFile(JSON.stringify({ ...X.makeDrillFile(rec(), {}), formatVersion: 9 }), opt), /newer version/);
  const bad = X.makeDrillFile(rec(), {}); delete bad.drill.title; bad.drill.id = 'nope';
  assert.throws(() => X.readDrillFile(JSON.stringify(bad), opt), /damaged/);
});

test('video timeline: title card, setup held, the drill at normal speed, the last step held', () => {
  const d = rec();
  const tl = X.videoTimeline(d);
  const steps = d.steps.length;
  assert.equal(tl.total, X.TITLE_SECONDS + X.HOLD_SECONDS + tl.play + X.HOLD_SECONDS);
  assert.deepEqual(tl.at(0.5), { scene: 'title' });
  assert.deepEqual(tl.at(X.TITLE_SECONDS + 0.5), { scene: 'drill', k: 0, p: 0, t: 0 });
  assert.equal(tl.at(X.TITLE_SECONDS + X.HOLD_SECONDS + 0.01).k, 1);
  assert.deepEqual(tl.at(tl.total - 0.5), { scene: 'drill', k: steps, p: 1, t: tl.play });
  assert.equal(X.videoTimeline({ ...d, steps: [] }).at(5).k, 0, 'no steps: the setup');
  assert.equal(X.captionOf(d, 0), 'Setup');
  assert.equal(X.captionOf({ steps: [{}] }, 1), 'Step 1');
});

test('QR code: the target opens the drill; the saved library draws a code for it', () => {
  const url = X.qrTarget('https://bench-boss-labs.github.io/practice-pilot/', 'p_abc234', 'd_xyz234');
  assert.equal(url, 'https://bench-boss-labs.github.io/practice-pilot/#drill/p_abc234/d_xyz234');
  const q = qrcode(0, 'M'); q.addData(url); q.make();
  assert.ok(q.getModuleCount() >= 21);
  assert.match(q.createSvgTag({ cellSize: 2, margin: 2, scalable: true }), /^<svg/);
});
