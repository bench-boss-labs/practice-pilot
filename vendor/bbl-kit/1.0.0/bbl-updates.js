/* Bench Boss Labs kit — versions, release notes, update banner, What's new.
   Release notes format: see the Bench Boss Labs Product Standards (release-notes.json). */

const TYPES = { new: ['New', 'do'], improved: ['Improved', 'good'], fixed: ['Fixed', 'work'] };

/** Compare two "major.minor.patch" versions: -1, 0 or 1. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return 0;
}

/** Keep only well-formed releases, newest first. */
export function normalizeReleases(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(r => r && /^\d+\.\d+\.\d+$/.test(r.version) && Array.isArray(r.notes))
    .map(r => ({
      version: r.version, date: r.date || '', title: r.title || '', quiet: !!r.quiet, upgradesData: !!r.upgradesData,
      notes: r.notes.filter(n => n && TYPES[n.type] && typeof n.text === 'string'),
    }))
    .sort((x, y) => compareVersions(y.version, x.version));
}

/** Releases newer than `fromVersion` and no newer than `toVersion`, newest first. */
export function releasesBetween(list, fromVersion, toVersion) {
  return normalizeReleases(list).filter(r =>
    compareVersions(r.version, fromVersion) > 0 && (!toVersion || compareVersions(r.version, toVersion) <= 0));
}

/** True when every release in the range is quiet (an update nobody needs to be told about). */
export function isQuietUpdate(list, fromVersion, toVersion) {
  const range = releasesBetween(list, fromVersion, toVersion);
  return range.length > 0 && range.every(r => r.quiet);
}

/** The releases Help › What's new shows: the last `n` that aren't quiet. */
export function recentReleases(list, n = 3) {
  return normalizeReleases(list).filter(r => !r.quiet).slice(0, n);
}

/** "2026-11-03" → "Nov 3, 2026" (no time zone surprises). */
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** Changelog text for GitHub (used by scripts/stamp.mjs). */
export function changelogMarkdown(appName, list) {
  const out = [`# ${appName} — changelog`, ''];
  for (const r of normalizeReleases(list)) {
    out.push(`## ${r.version} — ${r.date}${r.title ? ` (${r.title})` : ''}${r.quiet ? ' · quiet' : ''}`, '');
    for (const n of r.notes) out.push(`- **${TYPES[n.type][0]}:** ${n.text}`);
    out.push('');
  }
  return out.join('\n');
}

/* ---------- DOM ---------- */

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
export { el };

/** The What's new list for some releases. */
export function renderReleases(list) {
  const wrap = el('div', { class: 'releases' });
  for (const r of list) {
    wrap.append(el('div', { class: 'release' },
      el('div', { class: 'release-head' }, el('b', {}, r.version),
        el('span', { class: 'muted' }, [formatDate(r.date), r.title].filter(Boolean).join(' · '))),
      el('ul', { class: 'notes' }, r.notes.map(n =>
        el('li', {}, el('span', { class: `pill ${TYPES[n.type][1]}` }, TYPES[n.type][0]), el('span', {}, n.text))))));
  }
  return wrap;
}

/** Fetch a JSON file bypassing every cache (network or nothing). */
export async function fetchFresh(url, timeoutMs = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetch(`${url}${sep}fresh=${Date.now()}`, { cache: 'no-store', signal: ctl.signal });
    if (!res.ok || !/json/.test(res.headers.get('content-type') || '')) return null;
    return await res.json();
  } catch { return null; } finally { clearTimeout(t); }
}

/**
 * Checks the published version and decides what to show.
 * Returns {state: 'current'|'quiet'|'available'|'offline', version, releases}.
 */
export async function checkForUpdate({ current, versionUrl = 'version.json', notesUrl = 'release-notes.json' }) {
  const v = await fetchFresh(versionUrl);
  if (!v || !v.version) return { state: 'offline' };
  if (compareVersions(v.version, current) <= 0) return { state: 'current', version: v.version };
  const notes = (await fetchFresh(notesUrl)) || [];
  const releases = releasesBetween(notes, current, v.version);
  return { state: isQuietUpdate(notes, current, v.version) ? 'quiet' : 'available', version: v.version, releases };
}

/** The amber "A new version is ready" banner. Returns the element (already placed in `host`). */
export function showUpdateBanner(host, { releases, upgradesData = false, onUpdate, onLater }) {
  host.querySelector('#bbl-update-banner')?.remove();
  const first = releases[0];
  const summary = first && (first.title || (first.notes[0] && first.notes[0].text)) || '';
  const text = 'A new version is ready' + (summary ? `: ${summary}` : '.') + (upgradesData ? ' This update upgrades your saved data. A backup is made first.' : '');
  const banner = el('div', { id: 'bbl-update-banner', class: 'banner', role: 'status' },
    el('span', { class: 'grow' }, text),
    el('button', { type: 'button', class: 'btn primary', id: 'bbl-update-go', onclick: () => onUpdate && onUpdate() }, 'Update now'),
    el('button', { type: 'button', class: 'btn', id: 'bbl-update-later', onclick: () => { banner.remove(); onLater && onLater(); } }, 'Later'));
  host.prepend(banner);
  return banner;
}

/**
 * After an update: which releases to show in "What's new in X" (once).
 * `storage` is localStorage-like. Returns [] when nothing to show.
 */
export function pendingWhatsNew(storage, key, current, list) {
  let seen = null;
  try { seen = storage.getItem(key); } catch { /* storage blocked */ }
  try { storage.setItem(key, current); } catch { /* ignore */ }
  if (!seen) return []; // first install: the welcome covers it
  if (compareVersions(seen, current) >= 0) return [];
  return releasesBetween(list, seen, current).filter(r => !r.quiet);
}
