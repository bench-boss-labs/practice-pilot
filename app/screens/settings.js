/* Settings › About and Settings › This device. */
import { APP, APP_NAME, APP_VERSION, KIT_VERSION, SCHEMA_VERSION } from '../version.js?v=1.4.1';
import { DATA_STORES, describeCounts, daysSince, newTeam } from '../schema.js?v=1.4.1';
import { restoreSamples } from './library.js?v=1.4.1';
import { newId, makeBackup, backupFileName, validateBackup, restoreBackup, storageStatus, formatBytes } from '../../vendor/bbl-kit/1.0.1/bbl-store.js';
import { formatDate } from '../../vendor/bbl-kit/1.0.1/bbl-updates.js';
import { renderInstallCard } from '../../vendor/bbl-kit/1.0.1/bbl-install.js';
import { el, toast, dialog, download, shortDate } from '../ui.js?v=1.4.1';
import { renderTeamCard } from './teamcard.js?v=1.4.1';
import { pushChanges } from '../cloud/team.js?v=1.4.1';

export function renderSettings(app, sub) {
  const tab = sub === 'device' ? 'device' : 'about';
  const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Settings' },
    el('a', { class: 'btn', role: 'tab', href: '#settings/about', id: 'tab-about', 'aria-selected': String(tab === 'about'), 'aria-pressed': String(tab === 'about') }, 'About'),
    el('a', { class: 'btn', role: 'tab', href: '#settings/device', id: 'tab-device', 'aria-selected': String(tab === 'device'), 'aria-pressed': String(tab === 'device') }, 'This device'));
  return [
    el('div', { class: 'screen-head' }, el('h1', { class: 't-title' }, 'Settings')),
    tabs,
    ...(tab === 'about' ? about(app) : device(app)),
  ];
}

function about(app) {
  const result = el('p', { class: 'status-line muted', id: 'update-result', 'aria-live': 'polite' });
  const btn = el('button', { type: 'button', class: 'btn', id: 'check-updates', onclick: async () => {
    btn.disabled = true; result.textContent = 'Checking…';
    const r = await app.checkUpdates({ fromButton: true });
    btn.disabled = false;
    result.className = 'status-line';
    result.textContent = r.state === 'offline' ? 'Couldn’t check: no internet right now. Try again when you’re connected.'
      : r.state === 'current' ? `You have the latest version (${APP_VERSION}).`
      : `Version ${r.version} is ready. Tap Update now in the banner at the top.`;
  } }, 'Check for updates');
  return [
    el('section', { class: 'card stack', 'aria-labelledby': 'about-title' },
      el('div', { class: 'lockup' },
        el('img', { src: 'vendor/bbl-kit/1.0.1/brand/bbl-symbol.svg', alt: '' }),
        el('div', {}, el('h2', { class: 't-section', id: 'about-title' }, APP_NAME), el('div', { class: 'muted' }, 'by Bench Boss Labs · Better Tools. Bigger Games.'))),
      el('dl', { class: 'kv' },
        el('dt', {}, 'App version'), el('dd', { id: 'about-version' }, APP_VERSION),
        el('dt', {}, 'Bench Boss Labs kit'), el('dd', { id: 'about-kit' }, KIT_VERSION),
        el('dt', {}, 'Data format'), el('dd', {}, String(SCHEMA_VERSION)),
        el('dt', {}, 'Released'), el('dd', {}, formatDate((app.notes[0] && app.notes[0].date) || ''))),
      el('div', { class: 'row' }, btn), result),
  ];
}

function device(app) {
  const theme = document.documentElement.dataset.theme || 'dark';
  const setTheme = t => {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('pp-theme', t); } catch {}
    app.store.put('settings', { key: 'theme', value: t }).catch(() => {});
    app.render();
  };
  const teamInput = el('input', { type: 'text', id: 'team-name', value: app.team ? app.team.name : '', maxlength: '40', autocomplete: 'off', disabled: !!(app.cloudState && app.cloudState.libraryId) });
  teamInput.addEventListener('change', async () => {
    const name = teamInput.value.trim();
    if (!name) { teamInput.value = app.team.name; toast('A team needs a name.', { error: true }); return; }
    await safeSave(() => app.store.save('teams', { ...app.team, name }));
    await app.refreshTeam();
    toast('Saved');
  });

  const iceInput = el('input', { type: 'number', id: 'ice-minutes', min: '10', max: '180', inputmode: 'numeric', value: String((app.team && app.team.iceTimeMinutes) || 50) });
  iceInput.addEventListener('change', async () => {
    const v = Math.round(Number(iceInput.value));
    if (!(v >= 10 && v <= 180)) { iceInput.value = String(app.team.iceTimeMinutes || 50); toast('Ice time is between 10 and 180 minutes.', { error: true }); return; }
    await safeSave(() => app.store.save('teams', { ...app.team, iceTimeMinutes: v }));
    if (app.cloudState && app.cloudState.libraryId) {   // a team setting: every coach's new plans use it
      try { await pushChanges(app, { team: { ...app.team, iceTimeMinutes: v } }); toast(`Ice time saved for ${app.cloudState.teamName}.`); }
      catch (e) { toast(`Saved on this device; the team didn’t get it: ${e.words || e.message}`, { error: true }); }
    }
    await app.refreshTeam();
    toast('Saved');
  });

  const storageLine = el('p', { class: 'status-line', id: 'storage-used' }, 'Checking…');
  const keptLine = el('p', { class: 'status-line', id: 'storage-kept' });
  storageStatus().then(s => {
    storageLine.textContent = `Using ${formatBytes(s.usage)} on this device.`;
    if (app.persisted === true || s.persisted) { keptLine.className = 'status-line good'; keptLine.textContent = 'Kept permanently: Android won’t clear it when space runs low.'; }
    else { keptLine.className = 'status-line bad'; keptLine.textContent = 'Android may clear this app’s data if space runs low. Back up regularly.'; }
  });

  const lastLine = el('p', { class: 'status-line', id: 'last-backup' });
  const remind = el('p', { class: 'status-line bad', id: 'backup-reminder', hidden: true }, 'It’s been more than 14 days since your last backup. Back up now to keep your drills safe.');
  const fillBackupInfo = async () => {
    const last = await app.store.get('meta', 'lastBackup');
    lastLine.textContent = `Last backup: ${last ? shortDate(last.value) : 'never'}.`;
    let items = 0; for (const s of ['drills', 'plans']) items += await app.store.count(s);
    const d = daysSince(last && last.value);
    remind.hidden = !(items > 0 && (d === null || d > 14));
  };
  fillBackupInfo();

  const backupBtn = el('button', { type: 'button', class: 'btn primary', id: 'backup-now', onclick: async () => {
    const b = await makeBackup(app.store, { app: APP, appVersion: APP_VERSION, stores: DATA_STORES });
    const name = backupFileName(APP);
    download(name, JSON.stringify(b, null, 1));
    await app.store.put('meta', { key: 'lastBackup', value: b.createdAt });
    fillBackupInfo();
    toast(`Backup saved: ${name}`);
  } }, 'Back up now');

  const file = el('input', { type: 'file', accept: '.json,application/json', class: 'sr', id: 'restore-file', tabindex: '-1', 'aria-hidden': 'true' });
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = '';
    if (f) await restore(app, f, fillBackupInfo);
  });
  const restoreBtn = el('button', { type: 'button', class: 'btn', id: 'restore', onclick: () => file.click() }, 'Restore');

  const themeBtn = (t, label) => el('button', { type: 'button', class: 'btn', id: `theme-${t}`, 'aria-pressed': String(theme === t), onclick: () => setTheme(t) }, label);

  const install = renderInstallCard({ appName: APP_NAME, prompt: app.installPrompt, installed: app.installed, onInstall: () => document.getElementById('install-btn').click() });
  return [
    install,
    renderTeamCard(app),
    el('section', { class: 'card stack', 'aria-labelledby': 'team-title' },
      el('h2', { class: 't-section', id: 'team-title' }, 'Team'),
      el('label', { class: 'field', for: 'team-name' }, 'Team name', teamInput, el('span', { class: 'hint' }, app.cloudState && app.cloudState.libraryId ? 'Your team’s name comes from its folder in Google Drive.' : 'Shown at the top of the app.')),
      el('label', { class: 'field', for: 'ice-minutes' }, 'Ice time (minutes)', iceInput, el('span', { class: 'hint' }, 'How long a practice usually is. New plans start with this.'))),
    el('section', { class: 'card stack', 'aria-labelledby': 'theme-title' },
      el('h2', { class: 't-section', id: 'theme-title' }, 'Theme'),
      el('div', { class: 'row', role: 'group', 'aria-label': 'Theme' }, themeBtn('dark', 'Dark'), themeBtn('light', 'Light'))),
    el('section', { class: 'card stack', 'aria-labelledby': 'storage-title' },
      el('h2', { class: 't-section', id: 'storage-title' }, 'Storage and backups'),
      storageLine, keptLine, lastLine, remind,
      el('div', { class: 'row' }, backupBtn, restoreBtn, file),
      el('p', { class: 'hint' }, 'Backups go to your Downloads folder. Keep a copy somewhere safe, like Google Drive.')),
    el('section', { class: 'card stack', 'aria-labelledby': 'samples-title' },
      el('h2', { class: 't-section', id: 'samples-title' }, 'Sample drills'),
      el('p', { class: 'hint' }, 'Puts back any of the three sample drills you deleted. Your own drills aren’t touched.'),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', id: 'restore-samples', onclick: async () => {
        const n = await safeSave(() => restoreSamples(app));
        toast(n ? `${n} sample drill${n === 1 ? '' : 's'} restored` : 'All the sample drills are already in your library.');
      } }, 'Restore samples'))),
  ];
}

async function safeSave(fn) {
  try { return await fn(); } catch (e) {
    if (e.code === 'full') toast('Your tablet is out of space. Free some up, then try again.', { error: true, action: ['Try again', () => safeSave(fn)] });
    else toast(`Couldn’t save: ${e.message}`, { error: true });
    throw e;
  }
}

async function restore(app, f, after) {
  let data;
  try { data = JSON.parse(await f.text()); } catch { data = null; }
  const v = validateBackup(data, { app: APP, schemaVersion: SCHEMA_VERSION, appName: APP_NAME });
  if (!v.ok) { toast(v.message, { error: true }); return; }
  const choice = await dialog({
    id: 'restore-dialog', title: 'Restore this backup?',
    body: el('div', { class: 'stack' },
      el('p', { style: 'margin:0' }, `Made ${shortDate(data.createdAt)} on ${APP_NAME} ${data.appVersion}: ${describeCounts(v.counts)}.`),
      el('p', { style: 'margin:0', class: 'muted' }, 'Add what’s missing keeps everything here and adds the rest. Replace everything makes this device match the backup.')),
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Add what’s missing', value: 'merge', kind: 'primary' },
      { label: 'Replace everything', value: 'replace', kind: 'danger' },
    ],
  });
  if (!choice) return;
  try {
    const r = await restoreBackup(app.store, data, choice);
    if (!(await app.store.count('teams'))) await app.store.save('teams', newTeam(newId('t')));
    await app.refreshTeam();
    const n = Object.values(r).reduce((a, x) => a + x.added + x.replaced, 0);
    toast(choice === 'merge' ? `Restored: ${n} item${n === 1 ? '' : 's'} added.` : `Restored: this device now matches the backup (${n} item${n === 1 ? '' : 's'}).`);
    after();
  } catch (e) {
    toast(e.code === 'full' ? 'Your tablet is out of space. Free some up, then try again.' : `Couldn’t restore: ${e.message}`, { error: true });
  }
}
