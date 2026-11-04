/* Practice Pilot data format, version 1. Pure functions: tested in Node (tests/unit). */
import { SCHEMA_VERSION } from './version.js?v=1.0.0';

/** Every data store the app keeps on the device. R0 creates them all; later releases fill them. */
export const DATA_STORES = ['drills', 'plans', 'teams', 'media'];
export const STORES = [...DATA_STORES, 'settings', 'meta'];

/** Upgrade steps for later schema versions go here: { 2: record => record }. */
export const MIGRATIONS = {};

const ID = { drills: /^d_[a-z2-9]{6,}$/, plans: /^p_[a-z2-9]{6,}$/, teams: /^t_[a-z2-9]{6,}$/, media: /^m_[a-z2-9]{6,}$/ };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Check a stored record. Returns a list of problems (empty = valid).
 * Drills also carry the community-library fields from v1: author, team, sourceDrillId, submittedAt.
 */
export function validateRecord(store, r) {
  const p = [];
  if (!r || typeof r !== 'object') return ['not a record'];
  if (!ID[store]) return [`unknown store ${store}`];
  if (!ID[store].test(r.id || '')) p.push('id');
  if (!Number.isInteger(r.schemaVersion) || r.schemaVersion < 1 || r.schemaVersion > SCHEMA_VERSION) p.push('schemaVersion');
  for (const f of ['createdAt', 'updatedAt']) if (!ISO.test(r[f] || '')) p.push(f);
  if (typeof r.updatedBy !== 'string' || !r.updatedBy) p.push('updatedBy');
  if (store === 'teams' && (typeof r.name !== 'string' || !r.name.trim())) p.push('name');
  if (store === 'drills') {
    if (typeof r.title !== 'string') p.push('title');
    for (const f of ['author', 'team']) if (typeof r[f] !== 'string') p.push(f);
    for (const f of ['sourceDrillId', 'submittedAt']) if (!(f in r)) p.push(f);
  }
  return p;
}

/** A new local team, as created on first run. */
export function newTeam(id, name = 'My team') {
  return { id, name, colours: ['red', 'black'], iceTimeMinutes: 50, driveFolderId: null };
}

/** A new drill with every field v1 defines (R1 fills in the rest of the editor's fields). */
export function newDrill(id, { title = 'New drill', author = '', team = '' } = {}) {
  return { id, title, author, team, sourceDrillId: null, submittedAt: null, tags: [], ageGroups: [], level: '', visibility: 'private', rinkView: 'full', pieces: [], steps: [], coachingPoints: [], videoLinks: [] };
}

/** "3 drills, 1 plan, 1 team" from backup counts. */
export function describeCounts(counts) {
  const names = { drills: ['drill', 'drills'], plans: ['plan', 'plans'], teams: ['team', 'teams'], media: ['recording or picture', 'recordings and pictures'] };
  const parts = [];
  for (const s of DATA_STORES) {
    const n = counts[s] || 0;
    if (n || s !== 'media') parts.push(`${n} ${names[s][n === 1 ? 0 : 1]}`);
  }
  return parts.join(', ');
}

/** Days since an ISO date (null when never). */
export function daysSince(iso, now = new Date()) {
  if (!iso) return null;
  return Math.floor((now - new Date(iso)) / 86400000);
}
