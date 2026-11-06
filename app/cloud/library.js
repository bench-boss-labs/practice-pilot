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
const TEAM_FIELDS = ['id', 'name', 'colours', 'iceTimeMinutes'];

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
  return { ...clone(rec), pub: { state: 'published', at: rec.publishedAt || rec.updatedAt || null } };
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
      const rec = { ...forTeam(r), publishedAt: at, publishedBy: by };
      const i = list.findIndex(x => x.id === r.id);
      if (i >= 0) list[i] = rec; else list.push(rec);
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
