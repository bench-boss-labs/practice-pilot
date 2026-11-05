/* Practice Pilot — start-up, screens, updates, offline status. */
import { APP, APP_NAME, APP_VERSION, SCHEMA_VERSION } from './version.js?v=1.1.1';
import { STORES, MIGRATIONS, newTeam } from './schema.js?v=1.1.1';
import { openStore, newId, requestPersistence, storageStatus } from '../vendor/bbl-kit/1.0.1/bbl-store.js';
import { checkForUpdate, showUpdateBanner, pendingWhatsNew, renderReleases, normalizeReleases } from '../vendor/bbl-kit/1.0.1/bbl-updates.js';
import { registerOffline, applyUpdate, watchOnline, singleTab } from '../vendor/bbl-kit/1.0.1/bbl-offline.js';
import { isStandalone, detectInstalled } from '../vendor/bbl-kit/1.0.1/bbl-install.js';
import { el, toast, dialog, blocker } from './ui.js?v=1.1.1';
import { renderLibrary, restoreSamples, emptyBin, fillSampleSetup } from './screens/library.js?v=1.1.1';
import { renderEditor } from './screens/editor.js?v=1.1.1';
import { renderHelpScreen } from './screens/help.js?v=1.1.1';
import { renderSettings } from './screens/settings.js?v=1.1.1';

const app = {
  store: null, team: null, reg: null, notes: [], busy: false, online: true,
  installPrompt: null, installed: false, privateLikely: false, persisted: null,
  setOnline(v) {
    app.online = v;
    document.getElementById('offline-badge').hidden = v;
  },
  async refreshTeam() {
    const teams = await app.store.all('teams');
    app.team = teams[0];
    document.getElementById('team-pill').textContent = app.team ? app.team.name : '';
  },
  render() { route(); },
  cleanup: null, pendingUpdate: null,
  checkUpdates: opts => checkUpdates(opts),
};
window.__pp = app; // for the browser tests

const SCREENS = { library: renderLibrary, edit: renderEditor, help: renderHelpScreen, settings: renderSettings };

function route() {
  const [screen, sub] = (location.hash.replace('#', '') || 'library').split('/');
  const name = SCREENS[screen] && (screen !== 'edit' || sub) ? screen : 'library';
  if (app.cleanup) { try { app.cleanup(); } catch (e) { console.error(e); } app.cleanup = null; }
  const navName = name === 'edit' ? 'library' : name;
  for (const a of document.querySelectorAll('#nav a')) {
    if (a.dataset.screen === navName) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const main = document.getElementById('main');
  main.classList.toggle('wide', name === 'edit' || name === 'library');
  document.body.classList.remove('pp-noscroll');
  main.replaceChildren(...[].concat(SCREENS[name](app, sub)));
  if (app.privateLikely) main.prepend(privateNotice());
  document.title = `${name === 'library' ? '' : name === 'edit' ? 'Edit drill · ' : name[0].toUpperCase() + name.slice(1) + ' · '}${APP_NAME} · Bench Boss Labs`;
}

function privateNotice() {
  return el('div', { class: 'card notice', id: 'private-notice', role: 'status' },
    el('p', {}, el('b', {}, 'This window forgets everything when it closes. '), `Open ${APP_NAME} in a normal window to keep your drills.`));
}

async function loadNotes() {
  try { const r = await fetch(`release-notes.json?v=${APP_VERSION}`); app.notes = normalizeReleases(await r.json()); } catch { app.notes = []; }
}

/* ---------- updates ---------- */
let quietTried = false;
export async function checkUpdates({ fromButton = false } = {}) {
  const r = await checkForUpdate({ current: APP_VERSION });
  if (r.state === 'offline') { app.setOnline(false); return r; }
  app.setOnline(true);
  if (r.state === 'quiet' && !app.busy && !quietTried) {
    quietTried = true;
    try { sessionStorage.setItem('pp-quiet', r.version); } catch {}
    await applyUpdate(app.reg);
  } else if (r.state === 'available' || (r.state === 'quiet' && fromButton)) {
    if (app.busy) { app.pendingUpdate = r; return r; }
    showUpdateBanner(document.getElementById('banners'), {
      releases: r.releases, upgradesData: r.releases.some(x => x.upgradesData),
      onUpdate: () => applyUpdate(app.reg),
    });
  }
  return r;
}

function whatsNewAfterUpdate() {
  let shown = [];
  try { shown = pendingWhatsNew(localStorage, 'pp-seen-version', APP_VERSION, app.notes); } catch {}
  if (shown.length) {
    dialog({ id: 'whats-new', title: `What's new in ${APP_VERSION}`, body: renderReleases(shown), buttons: [{ label: 'Got it', value: 'ok', kind: 'primary' }] });
  }
}

/* ---------- start ---------- */
async function start() {
  document.getElementById('app-version').textContent = `v${APP_VERSION}`;
  app.installed = isStandalone();
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    if (app.installed || isStandalone()) return; // already installed: Chrome sometimes still offers
    app.installPrompt = e;
    const b = document.getElementById('install-btn'); b.hidden = false;
    if (app.store && /^#(settings\/device|library|$)/.test(location.hash || '#')) route();
  });
  document.getElementById('install-btn').addEventListener('click', async () => {
    if (!app.installPrompt) return;
    app.installPrompt.prompt();
    await app.installPrompt.userChoice.catch(() => {});
    app.installPrompt = null; document.getElementById('install-btn').hidden = true; route();
  });
  addEventListener('appinstalled', () => {
    document.getElementById('install-btn').hidden = true;
    app.installed = true; app.installPrompt = null;
    app.store && app.store.put('meta', { key: 'installed', value: new Date().toISOString() }).catch(() => {});
    toast('Practice Pilot is on your home screen.');
    if (app.store) route();
  });

  await singleTab(APP, {
    onBlocked: takeOver => blocker({
      id: 'tab-blocked', title: `${APP_NAME} is open in another tab`,
      text: 'Use one tab at a time, so your changes never overwrite each other.',
      button: 'Use this tab instead', onClick: takeOver,
    }),
    onReleased: () => blocker({
      id: 'tab-released', title: `${APP_NAME} is now open in another tab`,
      text: 'Changes are being made there. Come back to this tab any time.',
      button: 'Use this tab instead', onClick: () => location.reload(),
    }),
  });

  try {
    app.store = await openStore({ name: APP, schemaVersion: SCHEMA_VERSION, stores: STORES, migrations: MIGRATIONS, by: 'this device' });
  } catch (e) {
    document.getElementById('main').replaceChildren(el('div', { class: 'card notice' }, el('p', {},
      e.code === 'newer' ? 'Your drills were saved by a newer version of Practice Pilot. Reload to get it.' : `Practice Pilot couldn’t open its saved data on this device. ${e.message}`)));
    return;
  }
  if (app.store.upgradeFailed) toast('The update couldn’t upgrade your drills. Nothing was lost.', { error: true, ms: 15000 });
  if (!(await app.store.count('teams'))) await app.store.save('teams', newTeam(newId('t')));
  await app.refreshTeam();
  try { await restoreSamples(app, { onlyFirstRun: true }); await fillSampleSetup(app); await emptyBin(app); } catch (e) { console.error(e); }
  app.installed = app.installed || !!(await app.store.get('meta', 'installed')) || await detectInstalled();
  if (app.installed) { app.installPrompt = null; document.getElementById('install-btn').hidden = true; }

  const st = await storageStatus();
  app.privateLikely = st.privateLikely;
  app.persisted = await requestPersistence();

  await loadNotes();
  addEventListener('hashchange', route);
  route();
  whatsNewAfterUpdate();

  app.reg = await registerOffline('sw.js');
  watchOnline(v => app.setOnline(v));
  checkUpdates();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdates(); });
  setInterval(checkUpdates, 30 * 60 * 1000);
}

start();
