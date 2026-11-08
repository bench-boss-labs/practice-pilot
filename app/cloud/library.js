/* Practice Pilot — the team library file (R3). One JSON file in the team's Drive folder holds the team,
   every published drill and plan, and drills deleted for good. Pure functions, tested in Node. */

export const LIBRARY_FORMAT = 'practice-pilot-library';
export const LIBRARY_VERSION = 1;
export const SHARED_FOLDER = 'shared';
export const LIBRARY_PREFIX = 'Practice Pilot library';
/** Only this account sees Set up a team (decided Nov 6). */
export const ADMIN_EMAIL = 'benchbosslabs@gmail.com';
export const isAdmin = email => String(email || '').toLowerCase() === ADMIN_EMAIL;

const clone = o => JSON.parse(JSON.stringify(o));
const LOCAL_ONLY = ['thumb', 'pub'];
const TEAM_FIELDS = ['id', 'name', 'colours', 'iceTimeMinutes', 'sharedFolderId', 'sharedPlansId', 'logo', 'mainColour', 'secondColour'];

/** "Practice Pilot library · U10BB Bulldogs Blue.json" */
export const libraryName = team => `${LIBRARY_PREFIX} · ${String(team || 'Team').replace(/[\\/:*?"<>|]/g, '-').trim()}.json`;

/** A drill or plan as it goes into the library: no picture (each device redraws it) and no sync state. */
export function forTeam(rec) {
  const r = clone(rec);
  for (const f of LOCAL_ONLY) delete r[f];
  return r;
}
/** A record from the library, as kept on this device. */
export function fromTeam(rec) {
  return { ...clone(rec), pub: { state: 'published', at: rec.publishId || rec.publishedAt || rec.updatedAt || null } };
}
export const teamPart = team => Object.fromEntries(TEAM_FIELDS.filter(f => team && f in team).map(f => [f, clone(team[f])]));

export function newLibrary({ team, by, at, appVersion }) {
  return { format: LIBRARY_FORMAT, formatVersion: LIBRARY_VERSION, appVersion, updatedAt: at, updatedBy: by, team: teamPart(team), drills: [], plans: [], gone: [] };
}

/** Problems with a library file ([] = fine). 'newer' = saved by a newer Practice Pilot. */
export function checkLibrary(doc) {
  if (!doc || doc.format !== LIBRARY_FORMAT) return ['not a Practice Pilot library'];
  if (!Number.isInteger(doc.formatVersion)) return ['no format version'];
  if (doc.formatVersion > LIBRARY_VERSION) return ['newer'];
  const p = [];
  for (const k of ['drills', 'plans', 'gone']) if (!Array.isArray(doc[k])) p.push(k);
  if (!doc.team || typeof doc.team.name !== 'string') p.push('team');
  return p;
}

/**
 * Publish to the library: each drill or plan replaces the library's copy (or is added), stamped with who and
 * when; `gone` lists ids deleted for good. Pure: returns a new library.
 */
export function publish(doc, { drills = [], plans = [], gone = [], team } = {}, by, at) {
  const n = clone(doc);
  const put = (list, recs) => {
    for (const r of recs) {
      // publishId tells two publishes apart even in the same millisecond (the check at Publish compares it)
      const rec = { ...forTeam(r), publishedAt: at, publishedBy: by, publishId: `${at}~${Math.random().toString(36).slice(2, 10)}` };
      const i = list.findIndex(x => x.id === r.id);
      if (i >= 0) list[i] = rec; else list.push(rec);
      n.gone = n.gone.filter(g => g.id !== r.id);   // put back after a delete
    }
  };
  put(n.drills, drills); put(n.plans, plans);
  for (const id of gone) {
    n.drills = n.drills.filter(x => x.id !== id); n.plans = n.plans.filter(x => x.id !== id);
    if (!n.gone.some(g => g.id === id)) n.gone.push({ id, at, by });
  }
  if (team) n.team = { ...n.team, ...teamPart(team) };
  n.updatedAt = at; n.updatedBy = by;
  return n;
}

/** After a save: did our changes land? (Another coach saving at the same moment can overwrite them.) */
export function landed(doc, { drills = [], plans = [], gone = [] } = {}, at) {
  const has = (list, r) => list.some(x => x.id === r.id && x.publishedAt === at);
  return drills.every(r => has(doc.drills, r)) && plans.every(r => has(doc.plans, r)) && gone.every(id => !doc.drills.some(x => x.id === id) && !doc.plans.some(x => x.id === id));
}

/** Drills and plans of this device that would move into a team library: not samples, not in the bin. */
export function movable(drills, plans) {
  return { drills: drills.filter(d => !d.sample && !d.deletedAt), plans: plans.filter(p => !p.deletedAt) };
}

/* ---------- the shared-plans file (1.4.1): what helpers see ---------- */

export const SHARED_FORMAT = 'practice-pilot-shared';
export const SHARED_VERSION = 1;
export const SHARED_DAYS = 30;          // helpers see plans still to come and from the last 30 days (decided Nov 6)
export const sharedName = team => `Practice Pilot shared plans · ${String(team || 'Team').replace(/[\\/:*?"<>|]/g, '-').trim()}.json`;

export function newShared({ team, by, at }) {
  return { format: SHARED_FORMAT, formatVersion: SHARED_VERSION, team: { name: team && team.name || '' }, updatedAt: at, updatedBy: by, plans: [] };
}
export function checkShared(doc) {
  if (!doc || doc.format !== SHARED_FORMAT) return ['not a shared-plans file'];
  if (doc.formatVersion > SHARED_VERSION) return ['newer'];
  return Array.isArray(doc.plans) ? [] : ['plans'];
}
/** Drill ids a plan uses, in order, once each. */
export function planDrillIds(plan) {
  const ids = [];
  for (const b of plan.blocks || []) for (const id of [b.drillId, ...(b.stations || []).map(s => s.drillId)]) if (id && !ids.includes(id)) ids.push(id);
  return ids;
}
/** Put a plan (and copies of its drills) in the shared file; sharing again replaces it. Pure. */
export function shareInto(doc, plan, drills, by, at) {
  const n = clone(doc);
  const ids = planDrillIds(plan);
  const entry = { plan: forTeam(plan), drills: drills.filter(d => ids.includes(d.id)).map(forTeam), sharedAt: at, sharedBy: by };
  const i = n.plans.findIndex(e => e.plan.id === plan.id);
  if (i >= 0) { entry.firstSharedAt = n.plans[i].firstSharedAt || n.plans[i].sharedAt; n.plans[i] = entry; } else { entry.firstSharedAt = at; n.plans.push(entry); }
  n.updatedAt = at; n.updatedBy = by;
  return n;
}
export function unshareFrom(doc, planId, by, at) {
  const n = clone(doc);
  n.plans = n.plans.filter(e => e.plan.id !== planId);
  n.updatedAt = at; n.updatedBy = by;
  return n;
}
/** Shared plans to refresh after a publish: those published, and those using a published drill. */
export function staleShared(doc, { drills = [], plans = [] } = {}) {
  const dIds = new Set(drills.map(d => d.id)), pIds = new Set(plans.map(p => p.id));
  return doc.plans.filter(e => pIds.has(e.plan.id) || e.drills.some(d => dIds.has(d.id))).map(e => e.plan.id);
}
/** The helper's list: plans still to come (next first), then the last 30 days (newest first). */
export function visibleShared(doc, today = new Date()) {
  const day = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null);
  const iso = x => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const now = iso(today), cut = iso(new Date(today.getTime() - SHARED_DAYS * 86400000));
  const when = e => day(e.plan.date) || String(e.firstSharedAt || e.sharedAt || '').slice(0, 10);
  const live = doc.plans.filter(e => !e.plan.deletedAt && when(e) >= cut);
  const ahead = live.filter(e => when(e) >= now).sort((a, b) => when(a).localeCompare(when(b)));
  const past = live.filter(e => when(e) < now).sort((a, b) => when(b).localeCompare(when(a)));
  return [...ahead, ...past];
}

/* ---------- team look (1.5.0): logo and colours ---------- */

const PIECE_COLOURS = { red: [200, 16, 46], black: [29, 35, 43], white: [255, 255, 255], blue: [29, 78, 216] };
const rgb = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
/** The player-piece colour nearest a team colour: red, black, white or blue. */
export function nearestPieceColour(hex) {
  const c = rgb(hex);
  if (!c) return null;
  let best = null, bd = Infinity;
  for (const [name, p] of Object.entries(PIECE_COLOURS)) { const d = (c[0] - p[0]) ** 2 * 2 + (c[1] - p[1]) ** 2 * 4 + (c[2] - p[2]) ** 2 * 3; if (d < bd) { bd = d; best = name; } }
  return best;
}
/** A team's look: its colours set the default player colours (main first, then second). */
export function teamLook({ mainColour, secondColour, logo } = {}) {
  const a = nearestPieceColour(mainColour), b0 = nearestPieceColour(secondColour);
  const b = b0 && b0 !== a ? b0 : ['red', 'black', 'white', 'blue'].find(x => x !== a);
  return { ...(logo ? { logo } : {}), ...(mainColour ? { mainColour } : {}), ...(secondColour ? { secondColour } : {}), ...(a ? { colours: [a, b] } : {}) };
}

/* ---------- the admin file (1.5.0): the teams Bench Boss Labs set up ---------- */

export const ADMIN_FORMAT = 'practice-pilot-admin';
export const ADMIN_VERSION = 1;
export const ADMIN_FILE = 'Practice Pilot admin.json';
export const ROOT_FOLDER = 'Practice Pilot';
export function newAdmin(at) { return { format: ADMIN_FORMAT, formatVersion: ADMIN_VERSION, updatedAt: at, teams: [] }; }
export function checkAdmin(doc) {
  if (!doc || doc.format !== ADMIN_FORMAT) return ['not an admin file'];
  if (doc.formatVersion > ADMIN_VERSION) return ['newer'];
  return Array.isArray(doc.teams) ? [] : ['teams'];
}
/** Add or update a team in the admin file (by its library file id). Pure. */
export function putTeam(doc, entry, at) {
  const n = clone(doc);
  const i = n.teams.findIndex(t => t.libraryId === entry.libraryId);
  if (i >= 0) n.teams[i] = { ...n.teams[i], ...entry }; else n.teams.push({ addedAt: at, ...entry });
  n.updatedAt = at;
  return n;
}
/** Coaches and helpers from a list of Drive permissions: the owner and Bench Boss Labs are left out. */
export function peopleOf(perms, role) {
  return perms.filter(p => p.type === 'user' && p.role === role && p.emailAddress && !isAdmin(p.emailAddress))
    .map(p => ({ id: p.id, email: p.emailAddress.toLowerCase(), name: p.displayName || '' }))
    .sort((a, b) => a.email.localeCompare(b.email));
}
export const validEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim());
