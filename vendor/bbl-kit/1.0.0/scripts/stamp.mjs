#!/usr/bin/env node
/* Bench Boss Labs kit — stamp a release.
   Usage: node vendor/bbl-kit/1.0.0/scripts/stamp.mjs [appDir]
   Reads version.json and release-notes.json, then in every file listed in stamp.config.json:
     ?v=1.2.3            file links (so phones never mix old and new files)
     APP_VERSION = '…'   the version the app reports
     CACHE = 'name-…'    the service worker's cache name
   and writes CHANGELOG.md. Fails if release-notes.json has no entry for the version. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { changelogMarkdown, normalizeReleases } = await import(pathToFileURL(join(here, '..', 'bbl-updates.js')).href);

const V = String.raw`\d+\.\d+\.\d+`;
export function stampText(text, version) {
  return text
    .replace(new RegExp(String.raw`([?&]v=)${V}`, 'g'), `$1${version}`)
    .replace(new RegExp(String.raw`(APP_VERSION\s*=\s*['"])${V}(['"])`, 'g'), `$1${version}$2`)
    .replace(new RegExp(String.raw`(CACHE\s*=\s*['"][a-z0-9-]+-)${V}(['"])`, 'g'), `$1${version}$2`);
}

export function stamp(appDir) {
  const read = f => readFileSync(join(appDir, f), 'utf8');
  const cfg = JSON.parse(read('stamp.config.json'));
  const ver = JSON.parse(read('version.json'));
  const notes = JSON.parse(read('release-notes.json'));
  if (!/^\d+\.\d+\.\d+$/.test(ver.version)) throw new Error(`version.json: "${ver.version}" isn't major.minor.patch`);
  if (!normalizeReleases(notes).some(r => r.version === ver.version)) {
    throw new Error(`release-notes.json has no entry for ${ver.version}. Add the release notes first.`);
  }
  const changed = [];
  for (const f of cfg.files) {
    const before = read(f);
    const after = stampText(before, ver.version);
    if (after !== before) { writeFileSync(join(appDir, f), after); changed.push(f); }
  }
  writeFileSync(join(appDir, 'CHANGELOG.md'), changelogMarkdown(cfg.name, notes));
  return { version: ver.version, changed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] || process.cwd();
  try {
    const r = stamp(dir);
    console.log(`Stamped ${r.version}: ${r.changed.length ? r.changed.join(', ') : 'nothing to change'}; CHANGELOG.md written.`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
