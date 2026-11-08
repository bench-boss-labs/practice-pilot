/* Practice Pilot — start-up, screens, updates, offline status. */
import { APP, APP_NAME, APP_VERSION, SCHEMA_VERSION } from './version.js?v=1.5.1';
import { STORES, MIGRATIONS, newTeam } from './schema.js?v=1.5.1';
import { openStore, newId, requestPersistence, storageStatus } from '../vendor/bbl-kit/1.0.1/bbl-store.js';
import { checkForUpdate, showUpdateBanner, pendingWhatsNew, renderReleases, normalizeReleases } from '../vendor/bbl-kit/1.0.1/bbl-updates.js';
import { registerOffline, applyUpdate, watchOnline, singleTab } from '../vendor/bbl-kit/1.0.1/bbl-offline.js';
import { isStandalone, detectInstalled } from '../vendor/bbl-kit/1.0.1/bbl-install.js';
import { el, toast, dialog, blocker } from './ui.js?v=1.5.1';
import { renderLibrary, restoreSamples, emptyBin, fillSampleSetup } from './screens/library.js?v=1.5.1';
import { renderEditor } from './screens/editor.js?v=1.5.1';
import { renderPlans, emptyPlanBin } from './screens/plans.js?v=1.5.1';
import { renderPlanner } from './screens/planner.js?v=1.5.1';
import { renderPrint } from './screens/print.js?v=1.5.1';
import { renderHelpScreen } from './screens/help.js?v=1.5.1';
import { renderSettings } from './screens/settings.js?v=1.5.1';
import { createGoogle } from './cloud/google.js?v=1.5.1';
import { connect, cloudState, signIn } from './cloud/team.js?v=1.5.1';
import { watchStore, syncNow, statusWords, unpublished } from './cloud/sync.js?v=1.5.1';
import { afterPublish, refreshShared, helperState } from './cloud/sharing.js?v=1.5.1';
import { refreshClub } from './cloud/club.js?v=1.5.1';
import { renderJoin, renderHelper } from './screens/helper.js?v=1.5.1';
import { renderDrillSheet } from './screens/drillshare.js?v=1.5.1';
import { renderAdmin, renderTeamJoin } from './screens/admin.js?v=1.5.1';
import { isAdmin } from './cloud/library.js?v=1.5.1';
import { thumbnailSVG } from './engine/render.js?v=1.5.1';
import { frame } from './engine/model.js?v=1.5.1';

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
    paintTeamPill();
  },
  render() { route(); },
  cleanup: null, pendingUpdate: null,
  checkUpdates: opts => checkUpdates(opts),
};
window.__pp = app; // for the browser tests

/** The team pill in the top bar: the team's logo, name and main colour (1.5.0). */
function paintTeamPill() {
  const pill = document.getElementById('team-pill');
  const t = helperMode() ? { name: app.helper.teamName || '' } : app.team || {};
  pill.replaceChildren(...(t.logo ? [el('img', { src: t.logo, alt: '', class: 'pp-pilllogo' })] : []), document.createTextNode(t.name || ''));
  pill.style.setProperty('--team-main', t.mainColour || 'transparent');
  pill.classList.toggle('pp-teamcoloured', !!t.mainColour);
}
const SCREENS = { admin: renderAdmin, team: renderTeamJoin, library: renderLibrary, edit: renderEditor, plans: renderPlans, plan: renderPlanner, print: renderPrint, help: renderHelpScreen, settings: renderSettings, join: renderJoin, helper: renderHelper, drillsheet: renderDrillSheet, drill: renderDrillLink };
/** A QR code on the plan printout: #drill/<plan>/<drill> opens the drill playing, for a coach or a helper. */
function renderDrillLink() {
  const [, planId, drillId] = location.hash.replace('#', '').split('/');
  location.replace(helperMode() ? `#helper/drill/${planId}/${drillId}` : `#library/${drillId}`);
  return document.createElement('div');
}
/** A helper's phone: shared plans only (no Library, no editing). */
const helperMode = () => !!app.helper && !(app.cloudState && app.cloudState.libraryId);

function route() {
  const [screen, sub] = (location.hash.replace('#', '') || (helperMode() ? 'helper' : 'library')).split('/');
  let name = SCREENS[screen] && (!['edit', 'plan', 'print', 'drillsheet', 'drill'].includes(screen) || sub) ? screen : 'library';
  if (helperMode() && ['library', 'edit', 'plans', 'plan', 'print', 'drillsheet'].includes(name)) name = 'helper';
  for (const a of document.querySelectorAll('#nav a')) a.hidden = helperMode() ? ['library', 'plans'].includes(a.dataset.screen) : a.dataset.screen === 'helper';
  paintTeamPill();
  const admin = !helperMode() && app.cloudState && isAdmin(app.cloudState.email);
  for (const a of document.querySelectorAll('#nav a[data-screen="admin"]')) a.hidden = !admin;
  if (app.cleanup) { try { app.cleanup(); } catch (e) { console.error(e); } app.cleanup = null; }
  for (const t of document.querySelectorAll('#toasts .toast.scoped')) t.remove();
  const navName = ['edit', 'drillsheet', 'drill', 'team'].includes(name) ? 'library' : ['plan', 'print'].includes(name) ? 'plans' : name === 'join' ? 'helper' : name;
  for (const a of document.querySelectorAll('#nav a')) {
    if (a.dataset.screen === navName) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const main = document.getElementById('main');
  main.classList.toggle('wide', ['edit', 'library', 'plans', 'plan'].includes(name));
  document.body.classList.toggle('pp-printing', name === 'print' || name === 'drillsheet');
  document.body.classList.remove('pp-noscroll');
  main.replaceChildren(...[].concat(SCREENS[name](app, sub)));
  if (app.privateLikely) main.prepend(privateNotice());
  document.title = `${name === 'helper' || name === 'join' ? 'Shared plans · ' : name === 'library' ? '' : name === 'edit' ? 'Edit drill · ' : name === 'plan' ? 'Edit plan · ' : name === 'print' ? 'Print · ' : name[0].toUpperCase() + name.slice(1) + ' · '}${APP_NAME} · Bench Boss Labs`;
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

/* ---------- the team: catching up and the status in the top bar (R3) ---------- */
/** Catch up with the team library when the app opens or comes back on screen (not while a drill or plan is open). */
async function catchUp() {
  if (!app.cloudState || !app.cloudState.libraryId) {
    renderSyncPill();
    if (helperMode() && /^#?helper$/.test(location.hash || '#helper') && document.visibilityState === 'visible' && app.helperSeen) route();   // a helper's phone catches up when it comes back
    app.helperSeen = true;
    return;
  }
  const changed = await syncNow(app);
  if (changed) await refreshShared(app);
  refreshClub(app).catch(() => {});                // the club library (1.5.1), quietly
  if (changed && !app.busy && /^#?(library|plans|$)/.test(location.hash.replace('#', '') || 'library')) route();
}
function renderSyncPill() {
  const b = document.getElementById('sync-pill');
  const inTeam = !!(app.cloudState && app.cloudState.libraryId);
  b.hidden = !inTeam;
  if (!inTeam) return;
  const s = app.sync || { state: 'none' };
  b.textContent = statusWords(s) || 'Sync';
  b.dataset.state = s.state;
  b.setAttribute('aria-label', `${statusWords(s) || 'Sync'}. Tap for details or Sync now.`);
}
async function syncDialog() {
  const s = app.sync || { state: 'none' };
  if (s.state === 'signin') {
    try { await signIn(app); await catchUp(); } catch (e) { toast(e.message, { error: true }); }
    return;
  }
  const mine = [...await app.store.all('drills'), ...await app.store.all('plans')].filter(r => unpublished(r) && !r.deletedAt);
  const st = app.cloudState;
  const body = el('div', { class: 'stack' },
    el('p', { style: 'margin:0' }, s.state === 'offline' ? 'No connection right now. Drills and plans open and play, and you can work on drafts. Publishing waits until you’re back online.'
      : s.state === 'error' ? s.words || 'Google Drive refused.' : `Last synced ${st.syncedAt ? new Date(st.syncedAt).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'not yet'}.`),
    el('p', { class: 'muted', style: 'margin:0' }, mine.length ? `${mine.length} draft${mine.length === 1 ? ' or change' : 's or changes'} on this device ${mine.length === 1 ? 'isn’t' : 'aren’t'} published yet.` : 'Everything you’ve made is published.'),
    app.busy ? el('p', { class: 'muted', style: 'margin:0' }, 'Sync now catches up when you leave this drill or plan.') : null);
  const v = await dialog({ id: 'sync-dialog', title: st.teamName, body, buttons: [{ label: 'Close', value: null }, { label: 'Sync now', value: 'sync', kind: 'primary' }] });
  if (v === 'sync') {
    if (app.busy) { toast('Sync waits until you leave this drill or plan.'); return; }
    const ok = await syncNow(app, { force: true });
    if (ok) { toast('Up to date.'); route(); } else toast(app.sync.state === 'offline' ? 'No connection right now.' : app.sync.words || statusWords(app.sync), { error: true });
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
  connect(app, createGoogle());
  app.cloudState = await cloudState(app);
  app.thumbOf = d => thumbnailSVG(d, frame);
  watchStore(app);
  app.renderSyncPill = renderSyncPill; app.renderTeamPill = () => { renderSyncPill(); paintTeamPill(); const admin = !helperMode() && app.cloudState && isAdmin(app.cloudState.email); for (const x of document.querySelectorAll('#nav a[data-screen="admin"]')) x.hidden = !admin; }; app.catchUp = catchUp;
  app.afterPublish = changes => afterPublish(app, changes);
  app.helper = await helperState(app);
  document.getElementById('sync-pill').addEventListener('click', syncDialog);
  try { await restoreSamples(app, { onlyFirstRun: true }); await fillSampleSetup(app); await emptyBin(app); await emptyPlanBin(app); } catch (e) { console.error(e); }
  app.installed = app.installed || !!(await app.store.get('meta', 'installed')) || await detectInstalled();
  if (app.installed) { app.installPrompt = null; document.getElementById('install-btn').hidden = true; }

  const st = await storageStatus();
  app.privateLikely = st.privateLikely;
  app.persisted = await requestPersistence();

  await loadNotes();
  addEventListener('hashchange', route);
  route();
  whatsNewAfterUpdate();
  catchUp();

  app.reg = await registerOffline('sw.js');
  watchOnline(v => app.setOnline(v));
  checkUpdates();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { checkUpdates(); catchUp(); } });
  setInterval(checkUpdates, 30 * 60 * 1000);
}

start();
