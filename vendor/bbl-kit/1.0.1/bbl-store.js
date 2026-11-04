/* Bench Boss Labs kit — on-device storage (IndexedDB) with schema versions, upgrades,
   Backup and Restore. Every record carries schemaVersion, id, createdAt, updatedAt, updatedBy. */

export class StoreError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const idb = () => globalThis.indexedDB;
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = tx => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('aborted')); });

function quotaError(e) {
  return e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
}
function wrap(e) {
  if (quotaError(e)) return new StoreError('full', 'This device is out of space.');
  return e;
}

/** Short random id with a prefix: id('d') → "d_7f3k9q". */
export function newId(prefix) {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  const bytes = (globalThis.crypto && crypto.getRandomValues) ? crypto.getRandomValues(new Uint8Array(6)) : Array.from({ length: 6 }, () => Math.random() * 256);
  for (const b of bytes) s += a[b % a.length];
  return `${prefix}_${s}`;
}

/**
 * Apply record migrations in order. `migrations` = { 2: rec => rec, 3: rec => rec }.
 * Returns a new array; throws if any step throws (the caller restores).
 */
export function migrateRecords(records, migrations, target) {
  return records.map(rec => {
    let r = { ...rec };
    for (let v = (r.schemaVersion || 1) + 1; v <= target; v++) {
      if (migrations && migrations[v]) r = migrations[v]({ ...r });
      r.schemaVersion = v;
    }
    return r;
  });
}

/**
 * openStore({ name, schemaVersion, stores: ['drills', …], migrations, by })
 * The IndexedDB version equals schemaVersion. Object stores are keyed by `id`
 * (the `settings` and `meta` stores by `key`). Record upgrades run after open,
 * with an automatic backup kept in memory and in meta 'preUpgradeBackup'; on failure it is restored.
 */
export async function openStore(o) {
  if (!idb()) throw new StoreError('unavailable', 'This browser can’t save data.');
  const stores = Array.from(new Set([...(o.stores || []), 'meta']));
  let previous = 0;
  const open = idb().open(o.name, o.schemaVersion);
  open.onupgradeneeded = ev => {
    previous = ev.oldVersion;
    const db = open.result;
    for (const s of stores) {
      if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: (s === 'meta' || s === 'settings') ? 'key' : 'id' });
    }
  };
  let db;
  try { db = await req(open); } catch (e) {
    if (e && e.name === 'VersionError') throw new StoreError('newer', 'This data was saved by a newer version of the app. Update the app.');
    throw wrap(e);
  }
  const store = new Store(db, o);
  store.upgradedFrom = previous;
  if (previous > 0 && previous < o.schemaVersion) {
    const dataStores = stores.filter(s => s !== 'meta' && s !== 'settings');
    const snapshot = await store.exportAll(dataStores);
    await store.put('meta', { key: 'preUpgradeBackup', from: previous, to: o.schemaVersion, at: new Date().toISOString(), data: snapshot });
    try {
      for (const s of dataStores) {
        const migrated = migrateRecords(snapshot[s] || [], o.migrations, o.schemaVersion);
        await store.replaceAll(s, migrated);
      }
    } catch (e) {
      for (const s of dataStores) await store.replaceAll(s, snapshot[s] || []);
      store.upgradeFailed = true;
    }
  }
  if (!(await store.get('meta', 'installedAt'))) await store.put('meta', { key: 'installedAt', value: new Date().toISOString() });
  return store;
}

export class Store {
  constructor(db, o) { this.db = db; this.o = o; }
  close() { this.db.close(); }
  async get(s, key) { return req(this.db.transaction(s).objectStore(s).get(key)).then(r => r || null); }
  async all(s) { return req(this.db.transaction(s).objectStore(s).getAll()); }
  async count(s) { return req(this.db.transaction(s).objectStore(s).count()); }
  async put(s, rec) {
    try {
      const tx = this.db.transaction(s, 'readwrite');
      tx.objectStore(s).put(rec);
      await done(tx);
      return rec;
    } catch (e) { throw wrap(e); }
  }
  /** Save a data record, stamping schemaVersion and timestamps. */
  async save(s, rec, by = this.o.by || 'this device') {
    const now = new Date().toISOString();
    const prev = rec.id ? await this.get(s, rec.id) : null;
    const r = { ...rec, schemaVersion: this.o.schemaVersion, createdAt: (prev && prev.createdAt) || rec.createdAt || now, updatedAt: now, updatedBy: by };
    return this.put(s, r);
  }
  async delete(s, key) { const tx = this.db.transaction(s, 'readwrite'); tx.objectStore(s).delete(key); await done(tx); }
  async replaceAll(s, records) {
    try {
      const tx = this.db.transaction(s, 'readwrite');
      const os = tx.objectStore(s);
      os.clear();
      for (const r of records) os.put(r);
      await done(tx);
    } catch (e) { throw wrap(e); }
  }
  async exportAll(stores) {
    const out = {};
    for (const s of stores) out[s] = await this.all(s);
    return out;
  }
}

/* ---------- Backup and Restore ---------- */

/** Build the backup object (the caller turns it into a file). */
export async function makeBackup(store, { app, appVersion, stores }) {
  return {
    format: 'bbl-backup', app, appVersion, schemaVersion: store.o.schemaVersion,
    createdAt: new Date().toISOString(), data: await store.exportAll(stores),
  };
}

/** Suggested file name: practice-pilot-backup-2026-11-04.json */
export function backupFileName(appSlug, date = new Date()) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return `${appSlug}-backup-${d}.json`;
}

/**
 * Check a parsed backup before restoring.
 * Returns { ok: true, counts } or { ok: false, code: 'not-backup'|'other-app'|'newer', message }.
 */
export function validateBackup(b, { app, schemaVersion, appName = app }) {
  if (!b || typeof b !== 'object' || b.format !== 'bbl-backup' || !b.data || typeof b.data !== 'object') {
    return { ok: false, code: 'not-backup', message: `This file isn’t a ${appName} backup.` };
  }
  if (b.app !== app) return { ok: false, code: 'other-app', message: `This file isn’t a ${appName} backup.` };
  if (!Number.isInteger(b.schemaVersion) || b.schemaVersion > schemaVersion) {
    return { ok: false, code: 'newer', message: `This backup is from a newer ${appName}. Update the app first.` };
  }
  const counts = {};
  for (const [s, list] of Object.entries(b.data)) {
    if (!Array.isArray(list)) return { ok: false, code: 'not-backup', message: `This file isn’t a ${appName} backup.` };
    counts[s] = list.length;
  }
  return { ok: true, counts };
}

/**
 * Restore a validated backup. mode 'replace' = everything in the backup replaces what's here;
 * 'merge' = only records whose id isn't here yet are added. Older backups are upgraded first.
 * Returns { added, replaced } counts per store.
 */
export async function restoreBackup(store, b, mode) {
  const result = {};
  for (const [s, list] of Object.entries(b.data)) {
    if (!store.db.objectStoreNames.contains(s) || s === 'meta') continue;
    const upgraded = migrateRecords(list, store.o.migrations, store.o.schemaVersion);
    if (mode === 'replace') {
      await store.replaceAll(s, upgraded);
      result[s] = { replaced: upgraded.length, added: 0 };
    } else {
      const have = new Set((await store.all(s)).map(r => r.id || r.key));
      const fresh = upgraded.filter(r => !have.has(r.id || r.key));
      for (const r of fresh) await store.put(s, r);
      result[s] = { replaced: 0, added: fresh.length };
    }
  }
  return result;
}

/* ---------- Keeping data safe ---------- */

/** Ask the browser to keep storage permanently. Returns true / false / null (unsupported). */
export async function requestPersistence() {
  const st = globalThis.navigator && navigator.storage;
  if (!st || !st.persist) return null;
  try { return (await st.persisted()) || (await st.persist()); } catch { return false; }
}

/** { usage, quota, persisted, privateLikely } — privateLikely when the quota is very small (incognito). */
export async function storageStatus() {
  const st = globalThis.navigator && navigator.storage;
  if (!st || !st.estimate) return { usage: null, quota: null, persisted: null, privateLikely: false };
  const e = await st.estimate();
  const persisted = st.persisted ? await st.persisted() : null;
  return { usage: e.usage || 0, quota: e.quota || 0, persisted, privateLikely: !!e.quota && e.quota < 150 * 1024 * 1024 };
}

/** 1536 → "1.5 KB" */
export function formatBytes(n) {
  if (n == null) return 'unknown';
  if (n < 1024) return `${n} bytes`;
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
}
