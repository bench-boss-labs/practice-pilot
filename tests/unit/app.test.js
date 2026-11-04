import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import 'fake-indexeddb/auto';
import { validateRecord, newDrill, newTeam, describeCounts, daysSince, STORES, DATA_STORES } from '../../app/schema.js';
import { APP_VERSION, KIT_VERSION, SCHEMA_VERSION } from '../../app/version.js';
import { openStore, newId, makeBackup, validateBackup } from '../../vendor/bbl-kit/1.0.1/bbl-store.js';
import { normalizeReleases } from '../../vendor/bbl-kit/1.0.1/bbl-updates.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = f => readFileSync(join(ROOT, f), 'utf8');

test('schema version 1 and the stores R1–R3 will fill', () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.deepEqual(STORES, ['drills', 'plans', 'teams', 'media', 'settings', 'meta']);
});

test('a saved drill and team pass validation; broken ones are caught', async () => {
  const s = await openStore({ name: 'u1', schemaVersion: SCHEMA_VERSION, stores: STORES, by: 'this device' });
  const d = await s.save('drills', newDrill(newId('d'), { title: 'Pass, pivot & go', author: 'Cristian', team: 't_abcdef' }));
  assert.deepEqual(validateRecord('drills', d), []);
  for (const f of ['author', 'team', 'sourceDrillId', 'submittedAt']) assert.ok(f in d, `drills carry ${f} from v1`);
  const t = await s.save('teams', newTeam(newId('t')));
  assert.deepEqual(validateRecord('teams', t), []);
  assert.deepEqual(validateRecord('drills', { ...d, id: 'x', updatedAt: 'yesterday' }), ['id', 'updatedAt']);
  assert.deepEqual(validateRecord('drills', { ...d, schemaVersion: 2 }), ['schemaVersion']);
  assert.ok(validateRecord('teams', { ...t, name: ' ' }).includes('name'));
  s.close();
});

test('backup from the app validates; other files and newer backups are refused', async () => {
  const s = await openStore({ name: 'u2', schemaVersion: SCHEMA_VERSION, stores: STORES });
  await s.save('teams', newTeam(newId('t')));
  const b = JSON.parse(JSON.stringify(await makeBackup(s, { app: 'practice-pilot', appVersion: APP_VERSION, stores: DATA_STORES })));
  assert.equal(b.format, 'bbl-backup');
  assert.deepEqual(Object.keys(b.data), DATA_STORES);
  const o = { app: 'practice-pilot', schemaVersion: SCHEMA_VERSION, appName: 'Practice Pilot' };
  assert.equal(validateBackup(b, o).ok, true);
  assert.equal(validateBackup({ ...b, schemaVersion: 2 }, o).message, 'This backup is from a newer Practice Pilot. Update the app first.');
  assert.equal(validateBackup({ ...b, app: 'watch-party' }, o).message, 'This file isn’t a Practice Pilot backup.');
  s.close();
});

test('counts read like a person would say them', () => {
  assert.equal(describeCounts({ drills: 3, plans: 1, teams: 1, media: 0 }), '3 drills, 1 plan, 1 team');
  assert.equal(describeCounts({ drills: 1, plans: 0, teams: 2, media: 2 }), '1 drill, 0 plans, 2 teams, 2 recordings and pictures');
});

test('daysSince', () => {
  assert.equal(daysSince(null), null);
  assert.equal(daysSince('2026-11-01T12:00:00Z', new Date('2026-11-16T13:00:00Z')), 15);
});

test('one version everywhere: version.json, app, service worker, file links, kit', () => {
  assert.equal(JSON.parse(read('version.json')).version, APP_VERSION);
  assert.match(read('sw.js'), new RegExp(`CACHE = 'practice-pilot-${APP_VERSION.replace(/\./g, '\\.')}'`));
  const links = [...read('index.html').matchAll(/\?v=([\d.]+)/g)].map(m => m[1]);
  assert.ok(links.length >= 5 && links.every(v => v === APP_VERSION), 'every ?v= link in index.html matches');
  assert.equal(JSON.parse(read('bbl-kit.json')).version, KIT_VERSION);
  assert.ok(existsSync(join(ROOT, `vendor/bbl-kit/${KIT_VERSION}/bbl-sw.js`)));
  assert.ok(normalizeReleases(JSON.parse(read('release-notes.json'))).some(r => r.version === APP_VERSION), 'release notes exist for this version');
});

test('every file with a ?v= link is stamped on release', () => {
  const cfg = JSON.parse(read('stamp.config.json'));
  const walk = d => readdirSync(join(ROOT, d)).flatMap(f => {
    const p = join(d, f);
    if (['node_modules', 'vendor', 'tests', '.git'].includes(f)) return [];
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p];
  });
  const withLinks = walk('').filter(f => /\.(html|js)$/.test(f) && /\?v=\d/.test(read(f)));
  for (const f of withLinks) assert.ok(cfg.files.includes(f), `${f} is in stamp.config.json`);
});

test('every file the service worker saves for offline exists', () => {
  let opts = null;
  const sandbox = { importScripts: () => {}, BBLsw: { start: o => { opts = o; } } };
  vm.runInNewContext(read('sw.js'), sandbox);
  assert.ok(opts && opts.files.length > 15);
  assert.equal(opts.marker, 'practice-pilot');
  for (const f of opts.files) {
    const p = f.split('?')[0];
    const file = p === './' ? 'index.html' : p.endsWith('/') ? p + 'index.html' : p;
    assert.ok(existsSync(join(ROOT, file)), `${file} exists`);
  }
});
