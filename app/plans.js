/* Practice Pilot — practice plans (R2 Plan Builder deep-dive). Pure functions on plain plan objects:
   blocks (drill, stations, activity), timing and the ice-time budget, the equipment list, copies and search.
   Edits return a new plan and never change their input. */
import { fold } from './drills.js?v=1.4.2';

export const DEFAULT_DRILL_MINUTES = 8;
export const MAX_STATIONS = 4;
export const AREAS = ['Near end', 'Neutral zone', 'Far end', 'Near side', 'Far side'];
export const ACTIVITIES = ['Warm-up skate', 'Water break', 'Scrimmage', 'Talk at the board', 'Stretch'];
const clone = o => JSON.parse(JSON.stringify(o));
const clampMin = n => Math.max(1, Math.min(120, Math.round(Number(n) || 1)));

/** A new plan with every field. iceMinutes null = the team's ice time. */
export function newPlan(id, { title = 'New plan', author = '', team = '' } = {}) {
  return {
    id, title, author, team, sourcePlanId: null, submittedAt: null,
    date: '', startTime: '', iceMinutes: null, themes: '', notes: '',
    blocks: [], extraEquipment: [], template: false, deletedAt: null, visibility: 'private',
  };
}

/** A drill's usual length in minutes (set in its Details), or the default. */
export const usualMinutes = drill => (drill && Number.isFinite(drill.minutes) && drill.minutes > 0 ? drill.minutes : DEFAULT_DRILL_MINUTES);

/* ---------- blocks ---------- */

export function drillBlock(id, drill) { return { id, kind: 'drill', drillId: drill.id, minutes: usualMinutes(drill), note: '', helpers: [] }; }
export function activityBlock(id, label = 'Water break', minutes = 4) { return { id, kind: 'activity', label, minutes, note: '' }; }
export function stationsBlock(id) { return { id, kind: 'stations', rotate: true, minutesPerStation: DEFAULT_DRILL_MINUTES, minutes: 15, note: '', stations: [] }; }

/** Add a block after index `at` (default: at the end). */
export function addBlock(p, block, at = p.blocks.length - 1) {
  const n = clone(p);
  n.blocks.splice(Math.max(0, Math.min(n.blocks.length, at + 1)), 0, block);
  return n;
}
export function removeBlock(p, id) { const n = clone(p); n.blocks = n.blocks.filter(b => b.id !== id); return n; }
export function moveBlock(p, id, dir) {
  const i = p.blocks.findIndex(b => b.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= p.blocks.length) return p;
  const n = clone(p);
  [n.blocks[i], n.blocks[j]] = [n.blocks[j], n.blocks[i]];
  return n;
}
/** Change a block's fields: minutes, note, label, helpers, rotate, minutesPerStation. */
export function setBlock(p, id, fields) {
  const n = clone(p);
  const b = n.blocks.find(x => x.id === id);
  if (!b) return n;
  for (const [k, v] of Object.entries(fields)) b[k] = clone(v);
  if ('minutes' in fields) b.minutes = clampMin(fields.minutes);
  if ('minutesPerStation' in fields) b.minutesPerStation = clampMin(fields.minutesPerStation);
  if ('label' in fields) b.label = String(fields.label).slice(0, 60);
  return n;
}

/* ---------- stations ---------- */

export function addStation(p, blockId, station) {
  const n = clone(p);
  const b = n.blocks.find(x => x.id === blockId);
  if (!b || b.kind !== 'stations' || b.stations.length >= MAX_STATIONS) return p;
  const used = new Set(b.stations.map(s => s.area));
  b.stations.push({ area: AREAS.find(a => !used.has(a)) || '', helpers: [], note: '', ...station });
  return n;
}
export function setStation(p, blockId, stationId, fields) {
  const n = clone(p);
  const s = (n.blocks.find(x => x.id === blockId) || { stations: [] }).stations.find(x => x.id === stationId);
  if (s) for (const [k, v] of Object.entries(fields)) s[k] = clone(v);
  return n;
}
export function removeStation(p, blockId, stationId) {
  const n = clone(p);
  const b = n.blocks.find(x => x.id === blockId);
  if (b) b.stations = b.stations.filter(s => s.id !== stationId);
  return n;
}

/* ---------- timing and the budget ---------- */

/** A block's length: stations that rotate take minutes per station × stations; everything else its minutes. */
export function blockMinutes(b) {
  if (b.kind === 'stations' && b.rotate !== false) return (b.minutesPerStation || DEFAULT_DRILL_MINUTES) * Math.max(1, (b.stations || []).length);
  return b.minutes || 0;
}
export const totalMinutes = p => p.blocks.reduce((a, b) => a + blockMinutes(b), 0);
export const iceOf = (p, team) => (Number.isFinite(p.iceMinutes) && p.iceMinutes > 0 ? p.iceMinutes : (team && team.iceTimeMinutes) || 50);

/** Start of each block in minutes from the top of the ice time, and whether it runs past the end. */
export function schedule(p, team) {
  const ice = iceOf(p, team);
  let t = 0;
  return p.blocks.map(b => { const start = t, mins = blockMinutes(b); t += mins; return { id: b.id, start, minutes: mins, end: t, over: t > ice }; });
}

/** "0:18" from minutes. */
export const mmss = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
/** "6:33 PM" from a start time ("18:15") plus minutes, or '' with no start time. */
export function clock(startTime, plus = 0) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(startTime || '');
  if (!m) return '';
  const t = (Number(m[1]) * 60 + Number(m[2]) + plus) % (24 * 60);
  const h = Math.floor(t / 60), mm = String(t % 60).padStart(2, '0');
  return `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The ice-time bar's words and state. */
export function budget(p, team) {
  const ice = iceOf(p, team), used = totalMinutes(p);
  if (used > ice) return { ice, used, state: 'over', words: `${used} of ${ice} min · ${used - ice} min over` };
  if (used === ice) return { ice, used, state: 'full', words: `${used} of ${ice} min used` };
  return { ice, used, state: 'under', words: `${used} of ${ice} min used · ${ice - used} min left` };
}

/* ---------- equipment ---------- */

export const EQUIPMENT = [['pylon', 'Pylons', 'Pylon'], ['puck', 'Pucks', 'Puck'], ['pile', 'Puck piles', 'Puck pile'], ['net', 'Extra nets', 'Extra net'],
  ['board', 'Passer boards', 'Passer board'], ['deker', 'Dekers', 'Deker'], ['tire', 'Tires', 'Tire'], ['stick', 'Sticks', 'Stick']];

/** Equipment pieces in one drill: { pylon: 3, puck: 1, … }. */
export function drillEquipment(d) {
  const c = {};
  for (const p of (d && d.pieces) || []) if (EQUIPMENT.some(([t]) => t === p.type)) c[p.type] = (c[p.type] || 0) + 1;
  return c;
}
/** Drills in a block, in order. lookup(id) → drill or null. */
export function blockDrills(b, lookup) {
  const ids = b.kind === 'drill' ? [b.drillId] : b.kind === 'stations' ? b.stations.map(s => s.drillId) : [];
  return ids.map(id => lookup(id)).filter(Boolean);
}
/**
 * The plan's equipment: for each kind, the most needed at any one time. Drills one after another reuse
 * the same pieces; stations running together add up. → [{ type, label, count }] + the extra items typed in.
 */
export function equipment(p, lookup) {
  const most = {};
  for (const b of p.blocks) {
    const now = {};
    for (const d of blockDrills(b, lookup)) for (const [t, n] of Object.entries(drillEquipment(d))) now[t] = (now[t] || 0) + n;
    for (const [t, n] of Object.entries(now)) most[t] = Math.max(most[t] || 0, n);
  }
  return EQUIPMENT.filter(([t]) => most[t]).map(([type, many, one]) => ({ type, count: most[type], label: most[type] === 1 ? one : many }));
}
/** Every drill's setup lines, by block: [{ block, title, lines }]. */
export function setupSheet(p, lookup) {
  const out = [], seen = new Set();
  for (const b of p.blocks) for (const d of blockDrills(b, lookup)) {
    const lines = (d.setupNotes || []).filter(s => s.trim());
    if (lines.length && !seen.has(d.id)) { seen.add(d.id); out.push({ blockId: b.id, title: d.title, lines }); }
  }
  return out;
}

/* ---------- helpers, drills in the bin ---------- */

/** Helper names used across plans, A to Z, for suggestions. */
export function helperNames(plans) {
  const s = new Set();
  for (const p of plans) for (const b of p.blocks || []) {
    for (const h of b.helpers || []) if (h.trim()) s.add(h.trim());
    for (const st of b.stations || []) for (const h of st.helpers || []) if (h.trim()) s.add(h.trim());
  }
  return [...s].sort((a, b) => fold(a).localeCompare(fold(b)));
}
/** Status of a drill a block uses: 'ok', 'deleted' (in the bin) or 'gone'. */
export const drillStatus = (id, lookup) => { const d = lookup(id); return !d ? 'gone' : d.deletedAt ? 'deleted' : 'ok'; };
/** A block whose drill is gone for good becomes an activity with the drill's old title. */
export function settleGone(p, lookup, titles = {}) {
  let changed = false;
  const n = clone(p);
  n.blocks = n.blocks.map(b => {
    if (b.kind === 'drill' && !lookup(b.drillId)) { changed = true; return { id: b.id, kind: 'activity', label: titles[b.drillId] || 'Drill (deleted)', minutes: b.minutes, note: b.note }; }
    if (b.kind === 'stations') { const keep = b.stations.filter(s => lookup(s.drillId)); if (keep.length !== b.stations.length) { changed = true; b.stations = keep; } }
    return b;
  });
  return changed ? n : p;
}

/* ---------- copies and templates ---------- */

const copyBase = (p, id) => { const n = clone(p); delete n.createdAt; delete n.updatedAt; delete n.updatedBy; delete n.schemaVersion; n.id = id; n.deletedAt = null; n.template = false; n.submittedAt = null; return n; };
/** "Copy of …" with no date, ready for next week. */
export function duplicatePlan(p, id) { const n = copyBase(p, id); n.title = `Copy of ${p.title}`.slice(0, 100); n.date = ''; n.sourcePlanId = p.id; return n; }
export function planTemplate(p, id) { const n = copyBase(p, id); n.template = true; n.date = ''; n.sourcePlanId = p.id; return n; }
export function planFromTemplate(t, id) { const n = copyBase(t, id); n.title = t.title; n.sourcePlanId = t.id; return n; }

/* ---------- the plans list ---------- */

/** Search titles, themes, notes and drill names; Show: plans, templates or the bin. Newest practice date first. */
export function findPlans(plans, { q = '', show = 'plans' } = {}, lookup = () => null) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  return plans.filter(p => {
    const kind = p.deletedAt ? 'deleted' : p.template ? 'templates' : 'plans';
    if (kind !== show) return false;
    if (!words.length) return true;
    const names = p.blocks.flatMap(b => [b.label, ...blockDrills(b, lookup).map(d => d.title)]);
    const t = fold([p.title, p.themes, p.notes, ...names].filter(Boolean).join(' \n '));
    return words.every(w => t.includes(w));
  }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

/** "Tue, Nov 11" from "2026-11-11" (no time-zone shift). */
export function dayLabel(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
}
