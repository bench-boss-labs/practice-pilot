import { createRequire } from 'node:module';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer } from './server.mjs';

const require = createRequire(import.meta.url);
export const { chromium, devices } = require('playwright');
export const ROOT = new URL('../../', import.meta.url).pathname;
export const SIZES = { tablet: { width: 1280, height: 800, hasTouch: true }, pc: { width: 1440, height: 900 }, phone: { width: 412, height: 915, hasTouch: true, isMobile: true } };

/** Fonts come from Google and the test machine has no internet: those errors are expected. */
const IGNORE = /fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|Failed to load resource/;

export async function setup() {
  const server = await startServer(ROOT);
  const browser = await chromium.launch();
  return { server, browser, async close() { await browser.close(); server.close(); } };
}

export async function open(env, { size = 'tablet', init } = {}) {
  env.server.setMode('normal'); env.server.setRoot(ROOT);
  const s = SIZES[size];
  const ctx = await env.browser.newContext({ viewport: { width: s.width, height: s.height }, hasTouch: !!s.hasTouch, isMobile: !!s.isMobile, acceptDownloads: true });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) page.errors.push(m.text()); });
  await page.goto(env.server.url);
  await page.waitForSelector('#library-empty');
  return { ctx, page };
}

/** Wait until the service worker controls the page and has saved the app. */
export async function offlineReady(page) {
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    const ok = await page.evaluate(async () => {
      if (!navigator.serviceWorker.controller) return false;
      for (const n of await caches.keys()) { if (!n.endsWith('-fonts') && (await (await caches.open(n)).keys()).length >= 24) return true; }
      return false;
    });
    if (ok) return;
    await page.waitForTimeout(250);
  }
  throw new Error('the app was not saved for offline use within 20 s');
}

/** A copy of the app stamped as another version (simulates publishing an update). */
export function makeVersion(version, { quiet = false, upgradesData = false, title = 'Test update' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `pp-${version}-`));
  cpSync(ROOT, dir, { recursive: true, filter: s => !/node_modules|\.git$|\/tests(\/|$)/.test(s) });
  writeFileSync(join(dir, 'version.json'), JSON.stringify({ version }));
  const notes = JSON.parse(readFileSync(join(dir, 'release-notes.json'), 'utf8'));
  notes.unshift({ version, date: '2026-11-05', title, quiet, upgradesData, notes: [{ type: 'fixed', text: `Fixes in ${version}.` }] });
  writeFileSync(join(dir, 'release-notes.json'), JSON.stringify(notes, null, 1));
  execFileSync('node', [join(dir, 'vendor/bbl-kit/1.0.0/scripts/stamp.mjs'), dir]);
  return dir;
}
