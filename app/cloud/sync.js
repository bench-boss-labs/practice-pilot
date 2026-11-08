/* Practice Pilot — Drafts and Publish, catching up, and marks (R3 deep-dive, decided Nov 6).
   Nothing made or changed on this device reaches the team until it's published. Catching up happens when the
   app opens or comes back on screen, and with Sync now. */
import { newId } from '../../vendor/bbl-kit/1.0.1/bbl-store.js';
import { checkLibrary, fromTeam } from './library.js?v=1.5.1';
import { cloudState, setState, signedIn, pushChanges, applyLibrary } from './team.js?v=1.5.1';

const CACHE = 'library-cache', GONE = 'pending-gone';
const BIN_DAYS = 30;
export const STALE_DRAFT_DAYS = 14;
const clone = o => JSON.parse(JSON.stringify(o));
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** 'draft', 'changed', 'published', or null when not in a team (or a sample). */
export const pubState = r => (r && r.pub && r.pub.state) || null;
export const unpublished = r => ['draft', 'changed'].includes(pubState(r));

/* ---------- the status in the top bar ---------- */
function setStatus(app, s) { app.sync = s; if (app.renderSyncPill) app.renderSyncPill(); return s; }
export const statusWords = s => ({ synced: `Synced · ${s.at ? new Date(s.at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : ''}`, syncing: 'Syncing…', offline: 'Offline', signin: 'Sign in to sync', error: 'Couldn’t sync' })[s.state] || '';

/* ---------- marks: "Mike has unpublished changes to this drill" ---------- */
// Small labels on the library file: e_<id> = "email|name|since". Google allows ~124 characters each.
export function readMarks(props = {}) {
  const m = new Map();
  for (const [k, v] of Object.entries(props || {})) {
    if (!k.startsWith('e_')) continue;
    const [email, name, since] = String(v).split('|');
    if (since && Date.now() - new Date(since) < STALE_DRAFT_DAYS * 86400000) m.set(k.slice(2), { email, name: name || email, since });
  }
  return m;
}
/** Fetch the marks now (a tiny call). Quietly does nothing offline or signed out. */
export async function refreshMarks(app) {
  const st = await cloudState(app);
  if (!st.libraryId || !signedIn(app) || !online()) return;
  try { const meta = await app.drive.meta(st.libraryId); app.marks = readMarks(meta.appProperties); await app.store.put('meta', { key: 'marks', value: meta.appProperties || {} }); } catch {}
}
/** Someone else's mark on this drill or plan, or null. */
export async function othersMark(app, id) {
  const st = await cloudState(app);
  if (!app.marks) app.marks = readMarks(((await app.store.get('meta', 'marks')) || {}).value || {});
  const m = app.marks.get(id);
  return m && m.email !== st.email ? m : null;
}
async function mark(app, ids, on) {
  const st = await cloudState(app);
  if (!st.libraryId || !signedIn(app) || !online()) return;
  const v = on ? `${st.email}|${String(st.name || '').slice(0, 30).replace(/\|/g, ' ')}|${new Date().toISOString()}` : null;
  try { await app.drive.setProps(st.libraryId, Object.fromEntries(ids.map(id => [`e_${id}`, v]))); } catch { /* marks are a heads-up only */ }
}

/* ---------- the device store: drafts, changes and deletions ---------- */

/**
 * In a team, saving a drill or plan on this device makes it a Draft (new) or Unpublished changes (published
 * before). Deleting one for good tells the team at the next sync. Samples are never part of the team.
 */
export function watchStore(app) {
  const store = app.store, save = store.save.bind(store), del = store.delete.bind(store);
  store.save = async (s, rec, by) => {
    if ((s === 'drills' || s === 'plans') && app.cloudState && app.cloudState.libraryId && !rec.sample) {
      const prev = rec.id ? await store.get(s, rec.id) : null;
      const was = prev ? prev.pub : null;
      rec = { ...rec, pub: !was ? { state: 'draft', at: null } : was.state === 'published' ? { ...was, state: 'changed' } : was };
      if (was && was.state === 'published') mark(app, [rec.id], true);
    }
    return save(s, rec, by);
  };
  store.delete = async (s, key) => {
    if (s === 'drills' || s === 'plans') {
      const r = await store.get(s, key);
      if (r && r.pub && r.pub.at) {
        const g = ((await store.get('meta', GONE)) || { value: [] }).value;
        if (!g.includes(key)) await store.put('meta', { key: GONE, value: [...g, key] });
      }
    }
    return del(s, key);
  };
}

/* ---------- catching up ---------- */

async function cache(app, doc) { if (doc) await app.store.put('meta', { key: CACHE, value: doc }); return ((await app.store.get('meta', CACHE)) || {}).value || null; }

async function sendGone(app) {
  const g = ((await app.store.get('meta', GONE)) || { value: [] }).value;
  if (!g.length) return;
  const back = await pushChanges(app, { gone: g });
  await app.store.put('meta', { key: GONE, value: [] });
  await cache(app, back);
}

/** Catch up with the team library. → true when synced. While a drill or plan is open, it waits unless forced. */
export async function syncNow(app, { force = false } = {}) {
  const st = await cloudState(app);
  if (!st.libraryId) return setStatus(app, { state: 'none' }) && false;
  if (!signedIn(app)) { setStatus(app, { state: 'signin' }); return false; }
  const keepMarks = async meta => { app.marks = readMarks(meta.appProperties); await app.store.put('meta', { key: 'marks', value: meta.appProperties || {} }); };
  if (app.busy && !force) {   // a drill or plan is open: only the marks, so its heads-up is current
    try { await keepMarks(await app.drive.meta(st.libraryId)); } catch {}
    return false;
  }
  setStatus(app, { state: 'syncing' });
  try {
    await sendGone(app);
    const meta = await app.drive.meta(st.libraryId);
    await keepMarks(meta);
    const now = await cloudState(app);
    if (force || meta.version !== now.version || !(await cache(app))) {
      const doc = await app.drive.readJson(st.libraryId);
      const bad = checkLibrary(doc);
      if (bad.length) throw Object.assign(new Error(bad[0] === 'newer' ? 'Update Practice Pilot to keep syncing: the team library was saved by a newer version. Nothing was overwritten.' : 'The team library file is damaged.'), { status: 409 });
      await cache(app, doc);
      await applyLibrary(app, doc);
      await setState(app, { version: meta.version });
    }
    const at = new Date().toISOString();
    await setState(app, { syncedAt: at });
    setStatus(app, { state: 'synced', at });
    return true;
  } catch (e) {
    console.warn('sync', e);
    setStatus(app, e.status === 0 ? { state: 'offline' } : e.status === 401 ? { state: 'signin' } : { state: 'error', words: e.words || e.message });
    return false;
  }
}

/* ---------- publish and discard ---------- */

const when = iso => (iso ? new Date(iso).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const thumbFor = async (app, kind, r) => (kind === 'drills' && app.thumbOf ? app.thumbOf(r) : undefined);

/** Drafts (or changed drills) a plan uses. */
async function draftDrillsOf(app, plan) {
  const ids = new Set();
  for (const b of plan.blocks || []) { if (b.drillId) ids.add(b.drillId); for (const s of b.stations || []) if (s.drillId) ids.add(s.drillId); }
  const out = [];
  for (const id of ids) { const d = await app.store.get('drills', id); if (d && unpublished(d)) out.push(d); }
  return out;
}

/**
 * Publish a drill or plan (and a plan's unpublished drills, if you say so). Before saving over the team's copy,
 * checks whether someone else published it since you started. → { published, took } or null when cancelled.
 */
export async function publishItems(app, kind, id, { dialog, quietShare = false }) {
  const st = await cloudState(app);
  if (!st.libraryId) throw new Error('Join a team first (Settings › This device).');
  if (!online()) throw new Error('Publishing needs a connection. Your changes are safe on this device.');
  if (!signedIn(app)) throw Object.assign(new Error('Sign in to publish (tap “Sign in to sync” at the top).'), { status: 401 });
  const rec = await app.store.get(kind, id);
  if (!rec) return null;
  const items = [[kind, rec]];
  // always asked first (1.4.3): publishing shows it to every coach on the team
  const drafts = kind === 'plans' ? await draftDrillsOf(app, rec) : [];
  const team = st.teamName || 'the team';
  const v = drafts.length
    ? await dialog({ id: 'publish-drills', title: 'Publish its drills too?', body: `This plan uses ${drafts.length === 1 ? 'a drill that isn’t' : `${drafts.length} drills that aren’t`} published: ${drafts.map(d => `“${d.title}”`).join(', ')}. Other coaches and helpers need ${drafts.length === 1 ? 'it' : 'them'} to see the plan. Everything is published to ${team}.`,
      buttons: [{ label: 'Cancel', value: null }, { label: `Publish ${drafts.length === 1 ? 'both' : 'all'}`, value: 'all', kind: 'primary' }] })
    : await dialog({ id: 'publish-confirm', title: `Publish to ${team}?`, body: `Every coach on ${team} will see ${pubState(rec) === 'draft' ? '' : 'your changes to '}“${rec.title || 'this ' + (kind === 'drills' ? 'drill' : 'plan')}”${quietShare ? ', and it needs to be published before helpers can see it' : ''}.`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Publish', value: 'yes', kind: 'primary' }] });
  if (!v) return null;
  for (const d of drafts) items.unshift(['drills', d]);
  const fresh = await app.drive.readJson(st.libraryId);
  const bad = checkLibrary(fresh);
  if (bad.length) throw new Error(bad[0] === 'newer' ? 'Update Practice Pilot to publish: the team library was saved by a newer version.' : 'The team library file is damaged.');
  const changes = { drills: [], plans: [], gone: [] }, took = [];
  for (const [k, r] of items) {
    const theirs = fresh[k].find(x => x.id === r.id);
    const wasGone = fresh.gone.find(g => g.id === r.id);
    const what = k === 'drills' ? 'drill' : 'plan';
    if (pubState(r) === 'changed' && theirs && r.pub.at && (theirs.publishId || theirs.publishedAt) !== r.pub.at) {
      const v = await dialog({ id: 'publish-conflict', title: `${theirs.publishedBy || 'Another coach'} changed this ${what}`,
        body: `${theirs.publishedBy || 'Another coach'} published changes to “${theirs.title}” (${when(theirs.publishedAt)}) since you started yours. Which do you want to keep?`,
        buttons: [{ label: 'Take theirs', value: 'theirs' }, { label: 'Keep both', value: 'both' }, { label: 'Keep mine', value: 'mine', kind: 'primary' }] });
      if (!v) return null;
      if (v === 'mine') changes[k].push(r);
      else {
        const local = fromTeam(theirs); const t = await thumbFor(app, k, local); if (t) local.thumb = t;
        await app.store.put(k, local); took.push(r.id);
        if (v === 'both') changes[k].push({ ...clone(r), id: newId(k === 'drills' ? 'd' : 'p'), title: `${r.title} (my copy)`.slice(0, 100) });
      }
    } else if (pubState(r) === 'changed' && !theirs && (wasGone || r.pub.at)) {
      const v = await dialog({ id: 'publish-deleted', title: `This ${what} was deleted from the team`, body: `${(wasGone && wasGone.by) || 'Another coach'} deleted “${r.title}” from the team library. Put it back with your changes?`,
        buttons: [{ label: 'Let it go', value: 'go' }, { label: 'Put it back with my changes', value: 'back', kind: 'primary' }] });
      if (!v) return null;
      if (v === 'back') changes[k].push(r);
      else { const n = { ...r }; delete n.pub; await app.store.put(k, n); await app.store.delete(k, r.id); took.push(r.id); }   // no pub: nothing to tell the team
    } else changes[k].push(r);
  }
  // drills and plans in the team's Recently deleted for more than 30 days go for good
  for (const k of ['drills', 'plans']) for (const x of fresh[k]) if (x.deletedAt && Date.now() - new Date(x.deletedAt) > BIN_DAYS * 86400000) changes.gone.push(x.id);
  let published = 0;
  if (changes.drills.length || changes.plans.length || changes.gone.length) {
    const back = await pushChanges(app, changes);
    await cache(app, back);
    for (const k of ['drills', 'plans']) for (const r of changes[k]) {
      const t = back[k].find(x => x.id === r.id);
      const mine = await app.store.get(k, r.id);
      await app.store.put(k, { ...(mine || r), ...fromTeam(t), thumb: (mine || r).thumb || (await thumbFor(app, k, t)) });
      published++;
    }
    await applyLibrary(app, back);
    await mark(app, [...changes.drills, ...changes.plans].map(r => r.id), false);
    if (app.afterPublish) { try { await app.afterPublish(changes); } catch (e) { console.warn('shared copy', e); app.sharedLag = true; } }
    await setState(app, { syncedAt: new Date().toISOString() });
    setStatus(app, { state: 'synced', at: new Date().toISOString() });
  }
  return { published, took };
}

/** Go back to the team's version of a drill or plan (your unpublished changes are dropped). */
export async function discardChanges(app, kind, id) {
  let doc = await cache(app);
  let theirs = doc && doc[kind].find(x => x.id === id);
  if (!theirs) {
    const st = await cloudState(app);
    doc = await app.drive.readJson(st.libraryId); await cache(app, doc);
    theirs = doc[kind].find(x => x.id === id);
  }
  if (!theirs) throw new Error('The team’s version isn’t in the library any more.');
  const local = fromTeam(theirs); const t = await thumbFor(app, kind, local); if (t) local.thumb = t;
  await app.store.put(kind, local);
  await mark(app, [id], false);
  return local;
}

/** Drafts not published for more than two weeks (they live on this device only). */
export async function staleDrafts(app) {
  const out = [];
  for (const k of ['drills', 'plans']) for (const r of await app.store.all(k)) if (unpublished(r) && !r.deletedAt && Date.now() - new Date(r.updatedAt) > STALE_DRAFT_DAYS * 86400000) out.push(r);
  return out;
}
