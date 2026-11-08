/* Practice Pilot — drills: editing operations, search and filters, copies, templates and the bin.
   Pure functions on plain drill objects (drill format v1); the editor and library call these,
   and tests/unit/drills.test.js checks them. Edits return a new drill and never change their input. */
import { PIECES, isPlayer, handlesPuck, canMove, positionsByStep, moveOf, movesIn, DEFAULT_SECONDS } from './engine/model.js?v=1.5.0';
import { onIce } from './engine/rink.js?v=1.5.0';
import { aroundTheBoards } from './engine/boards.js?v=1.5.0';
import { dist } from './engine/geometry.js?v=1.5.0';

export const TAGS = ['Warm-up', 'Skating', 'Passing', 'Shooting', 'Stickhandling', 'Battle', 'Breakout', 'Small-area games', 'Positional', 'Goalie', 'Fun'];
export const AGES = ['U8/U9', 'U10', 'U11', 'U12', 'U13', 'U14+'];
/** Age groups from before 1.4.3, read as today's groups (stored drills are never rewritten for this). */
const OLD_AGES = { U7: 'U8/U9', U8: 'U8/U9', U9: 'U8/U9', U14: 'U14+', U15: 'U14+', U16: 'U14+', U18: 'U14+' };
/** A drill's age groups in today's list, in order. */
export function agesOf(d) {
  const have = new Set(((d && d.ageGroups) || []).map(a => OLD_AGES[a] || a));
  return AGES.filter(a => have.has(a));
}
export const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
export const MAX_UNDO = 200;
export const CALLOUT_MAX = 40;
export const PIECE_WARNING = 50;
export const BIN_DAYS = 30;
export const STEP_MIN = 1, STEP_MAX = 6;

const clone = o => JSON.parse(JSON.stringify(o));
const r1 = n => Math.round(n * 10) / 10;
const pt = p => onIce([r1(p[0]), r1(p[1])]);

/** The drill fields an edit can change (thumb and record stamps are left out of undo snapshots). */
export function content(d) {
  const { thumb, createdAt, updatedAt, updatedBy, schemaVersion, ...rest } = d;
  return rest;
}

/* ---------- pieces ---------- */

export function addPiece(d, { id, type, team = 'red', at, step = 0 }) {
  const n = clone(d);
  const p = { id, type };
  if (isPlayer(type)) p.team = team;
  if (PIECES[type] && PIECES[type].rotate) p.rotate = 0;
  if (type === 'text') p.text = 'Text';
  if (step > 0) p.fromStep = step;
  n.pieces.push(p);
  n.start[id] = pt(at);
  return n;
}

/** Remove a piece from every step, with its moves, callouts and highlights. A puck it carried stays where it was. */
export function removePiece(d, id) {
  const n = clone(d);
  const gone = n.pieces.find(p => p.id === id);
  if (!gone) return n;
  n.pieces = n.pieces.filter(p => p.id !== id);
  delete n.start[id];
  n.steps.forEach(s => {
    const carried = (s.moves || []).filter(m => m.carriedBy && m.piece === id).map(m => m.carriedBy);
    // its carrier is gone: a puck it carried stays where it was this step
    s.moves = (s.moves || []).filter(m => m.piece !== id && m.carriedBy !== id);
    // a removed puck: its carrier's "with puck" line becomes "skate"
    for (const c of carried) { const cm = moveOf(s, c); if (cm && cm.line === 'skate-puck') cm.line = 'skate'; }
    if (s.callouts) s.callouts = s.callouts.filter(c => c.piece !== id);
    if (s.highlight) s.highlight = s.highlight.filter(h => h !== id);
  });
  return n;
}

export function duplicatePiece(d, id, newId) {
  const src = d.pieces.find(p => p.id === id);
  if (!src) return d;
  const n = clone(d);
  const at = d.start[id] || [100, 42.5];
  n.pieces.push({ ...clone(src), id: newId });
  n.start[newId] = pt([at[0] + 6, at[1] + 4]);
  return n;
}

export function setPiece(d, id, fields) {
  const n = clone(d);
  const p = n.pieces.find(x => x.id === id);
  if (!p) return n;
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || v === '') delete p[k]; else p[k] = v;
  }
  if (p.rotate != null) p.rotate = ((Math.round(p.rotate) % 360) + 360) % 360;
  return n;
}

/** Is a puck on this player's stick at the start of step k (within 4.5 ft, not moving on its own)? */
export function puckOnStick(d, k, playerId, pos = positionsByStep(d)) {
  const before = pos[k - 1];
  return d.pieces.find(p => p.type === 'puck' && before[p.id] && dist(before[p.id], before[playerId]) <= 4.5 &&
    !(d.steps[k - 1].moves || []).some(m => m.piece === p.id && m.to)) || null;
}

/**
 * Drag a piece to a point. Setup (k = 0) moves its starting spot; step k creates or changes its move.
 * Dragging a player with a puck on their stick makes it a "with puck" carry, as in the demo.
 */
export function dragPiece(d, k, id, to) {
  const n = clone(d);
  const piece = n.pieces.find(p => p.id === id);
  if (!piece) return n;
  to = pt(to);
  if (k === 0 || !canMove(piece.type) || (piece.fromStep && k <= piece.fromStep && !moveOf(n.steps[k - 1], id))) {
    // fixed pieces and a piece in the step it appears in are placed, not moved
    n.start[id] = to;
    return n;
  }
  const step = n.steps[k - 1];
  step.moves = step.moves || [];
  let m = step.moves.find(x => x.piece === id);
  if (!m) { m = { piece: id, line: piece.type === 'puck' ? 'pass' : 'skate' }; step.moves.push(m); }
  if (m.carriedBy) { delete m.carriedBy; m.line = 'pass'; }
  m.to = to;
  if (handlesPuck(piece.type)) {
    const pk = puckOnStick(d, k, id);
    if (pk && !step.moves.some(x => x.piece === pk.id)) {
      step.moves.push({ piece: pk.id, carriedBy: id });
      if (m.line === 'skate') m.line = 'skate-puck';
    }
  }
  return n;
}

export const MAX_BENDS = 12;
export const TRACE_TOLERANCE = 1.2;   // feet: finger wobble smaller than this is straightened out

/** Douglas–Peucker: the fewest points that stay within `tol` feet of the line. */
export function simplify(points, tol = TRACE_TOLERANCE) {
  if (points.length < 3) return points.slice();
  const [a, b] = [points[0], points[points.length - 1]];
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  let far = 0, at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const off = len < 1e-6 ? dist(p, a) : Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (off > far) { far = off; at = i; }
  }
  if (far <= tol) return [a, b];
  return [...simplify(points.slice(0, at + 1), tol).slice(0, -1), ...simplify(points.slice(at), tol)];
}

/**
 * Drag a player (or coach) along a route in step k: they skate the path your finger traced, at an even
 * speed over the step. trail = the finger's points, starting where the piece is drawn (its spot at the end
 * of the step). If it already moves in this step, the route carries on from where it ended.
 * Setup, pucks and equipment work as a plain drag (place, or a straight line).
 */
export function traceMove(d, k, id, trail) {
  const piece = d.pieces.find(p => p.id === id);
  const last = trail[trail.length - 1];
  const n = dragPiece(d, k, id, last);
  if (!piece || k === 0 || !handlesPuck(piece.type)) return n;
  const m = moveOf(n.steps[k - 1], id);
  if (!m) return n;                                  // placed, not moved (the step it appears in)
  const pos = positionsByStep(d);
  const start = pos[k - 1][id];
  const old = moveOf(d.steps[k - 1], id);
  const before = old && movesIn(d, k, id, pos) ? [...(old.bends || []), pos[k][id]] : [];
  const route = [start, ...before, ...smoothStroke(trail)];
  let tol = TRACE_TOLERANCE, keep = simplify(route, tol);
  while (keep.length - 2 > MAX_BENDS) { tol *= 1.4; keep = simplify(route, tol); }
  m.to = pt(keep[keep.length - 1]);
  m.bends = keep.slice(1, -1).map(pt);
  return n;
}

/** Undo a piece's move in step k (it stays where it was). */
export function clearMove(d, k, id) {
  const n = clone(d);
  const s = n.steps[k - 1];
  if (!s) return n;
  const carried = s.moves.filter(m => m.carriedBy === id).map(m => m.piece);
  s.moves = s.moves.filter(m => m.piece !== id && !carried.includes(m.piece));
  return n;
}

/** Change fields of a piece's move in step k: line, finish, when, start, end, bends. */
export function setMove(d, k, id, fields) {
  const n = clone(d);
  const s = n.steps[k - 1];
  const m = s && (s.moves || []).find(x => x.piece === id);
  if (!m) return n;
  for (const [key, v] of Object.entries(fields)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) delete m[key]; else m[key] = v;
  }
  if (fields.line === 'carried') {
    // a puck set to Carried rides with the nearest player
    const pos = positionsByStep(d);
    const before = pos[k - 1];
    const players = d.pieces.filter(p => handlesPuck(p.type) && before[p.id]);
    players.sort((a, b) => dist(before[a.id], before[id]) - dist(before[b.id], before[id]));
    delete m.to; delete m.bends; delete m.line;
    if (players[0]) m.carriedBy = players[0].id;
  } else if (fields.line && m.carriedBy) {
    const pos = positionsByStep(d);
    m.to = [...pos[k][id]]; delete m.carriedBy;
  }
  if (fields.when && fields.when !== 'custom') { delete m.start; delete m.end; }
  if (fields.when === 'custom') {
    m.start = Number.isFinite(fields.start) ? fields.start : (m.start ?? 0);
    m.end = Number.isFinite(fields.end) ? fields.end : (m.end ?? 1);
  }
  return n;
}

/** Bend points: add one in the middle of the last segment, move one, or straighten. */
export function addBend(d, k, id) {
  const pos = positionsByStep(d);
  const m = moveOf(d.steps[k - 1], id);
  if (!m || !m.to) return d;
  const pts = [pos[k - 1][id], ...(m.bends || []), pos[k][id]];
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const mid = pt([(a[0] + b[0]) / 2 + (b[1] - a[1]) * 0.2, (a[1] + b[1]) / 2 - (b[0] - a[0]) * 0.2]);
  return setMove(d, k, id, { bends: [...(m.bends || []), mid] });
}
export function moveBend(d, k, id, i, to) {
  const m = moveOf(d.steps[k - 1], id);
  if (!m) return d;
  const bends = [...(m.bends || [])];
  bends[i] = pt(to);
  return setMove(d, k, id, { bends });
}

/* ---------- steps ---------- */

const shiftPieces = (n, fn) => {
  for (const p of n.pieces) {
    if (Number.isInteger(p.fromStep)) { p.fromStep = fn(p.fromStep, 'from'); if (p.fromStep <= 0) delete p.fromStep; }
    if (Number.isInteger(p.untilStep)) p.untilStep = fn(p.untilStep, 'until');
  }
};

/** Add an empty step after step k (k = 0 adds step 1). Returns { drill, k: the new step }. */
export function addStep(d, k) {
  const n = clone(d);
  n.steps.splice(k, 0, { caption: '', seconds: DEFAULT_SECONDS, moves: [] });
  shiftPieces(n, (s, kind) => (kind === 'from' ? (s > k ? s + 1 : s) : (s > k ? s + 1 : s)));
  for (const m of n.markup) if (m.step != null && m.step > k) m.step += 1;
  return { drill: n, k: k + 1 };
}

/** Remove step k. Moves in later steps stay; a piece that first appeared in it appears in the next step. */
export function removeStep(d, k) {
  const n = clone(d);
  n.steps.splice(k - 1, 1);
  shiftPieces(n, (s, kind) => (kind === 'from' ? (s > k ? s - 1 : s) : (s >= k ? s - 1 : s)));
  for (const p of n.pieces) if (Number.isInteger(p.fromStep) && p.fromStep > n.steps.length) p.fromStep = Math.max(1, n.steps.length);
  n.markup = n.markup.filter(m => m.step !== k).map(m => (m.step != null && m.step > k ? { ...m, step: m.step - 1 } : m));
  return n;
}

/** Swap step k with the one before (dir = -1) or after (dir = 1). */
export function moveStep(d, k, dir) {
  const j = k + dir;
  if (j < 1 || j > d.steps.length || k < 1 || k > d.steps.length) return d;
  const n = clone(d);
  [n.steps[k - 1], n.steps[j - 1]] = [n.steps[j - 1], n.steps[k - 1]];
  const swap = s => (s === k ? j : s === j ? k : s);
  shiftPieces(n, swap);
  for (const m of n.markup) if (m.step != null) m.step = swap(m.step);
  return n;
}

export function setStep(d, k, fields) {
  const n = clone(d);
  const s = n.steps[k - 1];
  if (!s) return n;
  if ('caption' in fields) s.caption = String(fields.caption).slice(0, 120);
  if ('seconds' in fields) s.seconds = Math.max(STEP_MIN, Math.min(STEP_MAX, Math.round(Number(fields.seconds) * 2) / 2 || DEFAULT_SECONDS));
  return n;
}

/* ---------- callouts and highlight ---------- */

export function addCallout(d, k, piece, text, stay = false) {
  const n = clone(d);
  const s = n.steps[k - 1];
  if (!s) return n;
  s.callouts = s.callouts || [];
  s.callouts.push({ piece, text: String(text).slice(0, CALLOUT_MAX), ...(stay ? { stay: true } : {}) });
  return n;
}
export function setCallout(d, k, i, fields) {
  const n = clone(d);
  const c = n.steps[k - 1] && (n.steps[k - 1].callouts || [])[i];
  if (!c) return n;
  if ('text' in fields) c.text = String(fields.text).slice(0, CALLOUT_MAX);
  if ('stay' in fields) { if (fields.stay) c.stay = true; else delete c.stay; }
  return n;
}
export function removeCallout(d, k, i) {
  const n = clone(d);
  const s = n.steps[k - 1];
  if (s && s.callouts) s.callouts.splice(i, 1);
  return n;
}
/** Callouts on a piece that are visible in step k, with where they live: [{ k, i, text, stay }]. */
export function calloutsFor(d, k, piece) {
  const out = [];
  d.steps.forEach((s, si) => (s.callouts || []).forEach((c, i) => {
    if (c.piece === piece && (si + 1 === k || (c.stay && si + 1 < k))) out.push({ k: si + 1, i, text: c.text, stay: !!c.stay });
  }));
  return out;
}
export function setHighlight(d, k, piece, on) {
  const n = clone(d);
  const s = n.steps[k - 1];
  if (!s) return n;
  const h = new Set(s.highlight || []);
  if (on) h.add(piece); else h.delete(piece);
  if (h.size) s.highlight = [...h]; else delete s.highlight;
  return n;
}

/* ---------- markup ---------- */

/** Thin out a freehand stroke and smooth it a little. */
export function smoothStroke(points, minGap = 0.8) {
  if (points.length < 3) return points.map(pt);
  const kept = [points[0]];
  for (const p of points.slice(1)) if (dist(p, kept[kept.length - 1]) >= minGap) kept.push(p);
  if (kept[kept.length - 1] !== points[points.length - 1]) kept.push(points[points.length - 1]);
  const out = kept.map((p, i) => {
    if (i === 0 || i === kept.length - 1) return p;
    const a = kept[i - 1], b = kept[i + 1];
    return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
  });
  return out.map(pt);
}
export function addMark(d, mark) {
  const n = clone(d);
  n.markup.push({ ...mark, points: (mark.points || []).map(pt) });
  return n;
}
export function removeMark(d, id) {
  const n = clone(d);
  n.markup = n.markup.filter(m => m.id !== id);
  return n;
}
export function clearMarkup(d) { const n = clone(d); n.markup = []; return n; }

/* ---------- details ---------- */

const SITES = [[/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'YouTube'], [/(^|\.)instagram\.com$/, 'Instagram'], [/(^|\.)facebook\.com$|(^|\.)fb\.watch$/, 'Facebook'], [/(^|\.)tiktok\.com$/, 'TikTok'], [/(^|\.)vimeo\.com$/, 'Vimeo']];

/** Check a pasted video link. → { url, site } or null when it isn't a web address. */
export function videoLink(text) {
  let s = String(text || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s) && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const site = (SITES.find(([re]) => re.test(host)) || [null, host])[1];
  return { url: u.href, site };
}

export function setDetails(d, fields) {
  const n = clone(d);
  for (const [k, v] of Object.entries(fields)) n[k] = clone(v);
  if ('title' in fields) n.title = String(fields.title).slice(0, 100);
  return n;
}

/* ---------- copies, templates, the bin ---------- */

const copyBase = (d, id) => {
  const n = clone(content(d));
  n.id = id; n.deletedAt = null; n.sample = false; n.template = false; n.submittedAt = null;
  return n;
};
/** "Copy of …", recording which drill it came from. */
export function duplicateDrill(d, id) {
  const n = copyBase(d, id);
  n.title = `Copy of ${d.title}`.slice(0, 100); n.sourceDrillId = d.id;
  return n;
}
/** A template copy: rink, pieces, steps and details as a starting point. */
export function templateFrom(d, id) {
  const n = copyBase(d, id);
  n.template = true; n.sourceDrillId = d.id;
  return n;
}
/** A new drill from a template. */
export function drillFromTemplate(t, id) {
  const n = copyBase(t, id);
  n.title = t.title; n.sourceDrillId = t.id;
  return n;
}
/** Drills in the bin long enough to remove for good. */
export function expired(drills, now = new Date()) {
  return drills.filter(d => d.deletedAt && (now - new Date(d.deletedAt)) > BIN_DAYS * 86400000).map(d => d.id);
}
export const daysLeft = (d, now = new Date()) => Math.max(0, BIN_DAYS - Math.floor((now - new Date(d.deletedAt)) / 86400000));

/* ---------- search, filters, sort ---------- */

export const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Everything search looks in, folded: title, description, tags, captions, callouts, coaching points, setup. */
export function searchText(d) {
  const parts = [d.title, d.description, ...(d.tags || []), ...(d.coachingPoints || []), ...(d.setupNotes || []), d.goalieNotes];
  for (const s of d.steps || []) { parts.push(s.caption); for (const c of s.callouts || []) parts.push(c.text); }
  return fold(parts.filter(Boolean).join(' \n '));
}

export const DEFAULT_FILTERS = { q: '', tags: [], ages: [], levels: [], rinks: [], show: ['drills'], sort: 'edited' };

/** Which list a drill belongs to for the Show filter. */
export const kindOf = d => (d.deletedAt ? 'deleted' : d.template ? 'templates' : d.sample ? 'samples' : 'drills');

/** Filter and sort drills. Samples count as drills unless Show says otherwise; the bin shows only when picked. */
export function findDrills(drills, f = DEFAULT_FILTERS, texts = new Map()) {
  const words = fold(f.q).split(/\s+/).filter(Boolean);
  const show = new Set(f.show && f.show.length ? f.show : ['drills']);
  const out = drills.filter(d => {
    const kind = kindOf(d);
    const myDraft = show.has('drafts') && d.pub && d.pub.state !== 'published' && !d.deletedAt;
    if (!myDraft && (kind === 'samples' ? !(show.has('samples') || show.has('drills')) : !show.has(kind))) return false;
    if (f.tags.length && !f.tags.every(t => (d.tags || []).includes(t))) return false;
    if (f.ages.length && !f.ages.some(a => agesOf(d).includes(a))) return false;
    if (f.levels.length && !f.levels.includes(d.level)) return false;
    if (f.rinks.length && !f.rinks.includes((d.view && d.view.rink) || 'full')) return false;
    if (words.length) {
      let t = texts.get(d.id);
      if (t == null) { t = searchText(d); texts.set(d.id, t); }
      if (!words.every(w => t.includes(w))) return false;
    }
    return true;
  });
  const by = {
    edited: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
    az: (a, b) => fold(a.title).localeCompare(fold(b.title)) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
    steps: (a, b) => (b.steps || []).length - (a.steps || []).length || fold(a.title).localeCompare(fold(b.title)),
  }[f.sort] || ((a, b) => 0);
  return out.sort(by);
}
export const filtersOn = f => !!(f.q.trim() || f.tags.length || f.ages.length || f.levels.length || f.rinks.length);

/** Tags in use by at least one drill (for the Tags filter), in the starting-list order then A to Z. */
export function tagsInUse(drills) {
  const used = new Set(drills.filter(d => !d.deletedAt).flatMap(d => d.tags || []));
  return [...TAGS.filter(t => used.has(t)), ...[...used].filter(t => !TAGS.includes(t)).sort()];
}

/** "5 steps · 10 s" */
export function lengthLabel(d) {
  const n = (d.steps || []).length;
  const secs = (d.steps || []).reduce((a, s) => a + (s.seconds > 0 ? s.seconds : DEFAULT_SECONDS), 0);
  return `${n} step${n === 1 ? '' : 's'} · ${Math.round(secs * 10) / 10} s`;
}

/* ---------- pass and shoot (tap a teammate or a spot) ---------- */

/** The puck a player has in step k: one they carry in it, or one on their stick when it starts. */
export function puckWith(d, k, playerId, pos = positionsByStep(d)) {
  const step = d.steps[k - 1];
  if (!step) return null;
  const carried = (step.moves || []).find(m => m.carriedBy === playerId && !m.to);
  if (carried) return d.pieces.find(p => p.id === carried.piece) || null;
  const before = pos[k - 1];
  return d.pieces.find(p => p.type === 'puck' && before[p.id] && before[playerId] && dist(before[p.id], before[playerId]) <= 4.5) || null;
}

/** The passer stops carrying: their "with puck" line becomes "skate". */
function dropCarry(n, k, passerId) {
  const pm = moveOf(n.steps[k - 1], passerId);
  if (pm && pm.line === 'skate-puck') pm.line = 'skate';
}

/**
 * Pass the puck in step k to a teammate's stick where they end up in that step (a lead pass).
 * If the receiver skates in this step, the pass waits until they arrive ("after skaters arrive").
 */
export function passTo(d, k, passerId, puckId, receiverId) {
  const pos = positionsByStep(d);
  const from = pos[k - 1][puckId], end = pos[k][receiverId];
  if (!from || !end) return d;
  const len = dist(from, end) || 1;
  const target = [end[0] - (end[0] - from[0]) / len * 2.5, end[1] - (end[1] - from[1]) / len * 2.5];
  const n = clone(d);
  const step = n.steps[k - 1];
  step.moves = (step.moves || []).filter(m => m.piece !== puckId);
  const m = { piece: puckId, line: 'pass', to: pt(target) };
  if (movesIn(d, k, receiverId, pos)) m.when = 'after';
  step.moves.push(m);
  dropCarry(n, k, passerId);
  return n;
}

/** Shoot the puck in step k at a spot. */
export function shootAt(d, k, passerId, puckId, at) {
  const n = clone(d);
  const step = n.steps[k - 1];
  step.moves = (step.moves || []).filter(m => m.piece !== puckId);
  step.moves.push({ piece: puckId, line: 'shot', to: pt(at) });
  dropCarry(n, k, passerId);
  return n;
}

/**
 * Dump the puck in, in step k: "corner" sends it straight to the spot; "boards" rims it around the
 * boards (behind the net if it has to). The tapped spot is kept as `aim` so the style can be switched.
 * caption: the step's caption when it has none yet.
 */
export function dumpAt(d, k, dumperId, puckId, aim, style = 'corner', caption = '') {
  const n = clone(d);
  const step = n.steps[k - 1];
  step.moves = (step.moves || []).filter(m => m.piece !== puckId);
  step.moves.push(dumpMove(d, k, puckId, pt(aim), style));
  if (caption && !step.caption) step.caption = caption;
  dropCarry(n, k, dumperId);
  return n;
}
function dumpMove(d, k, puckId, aim, style) {
  if (style !== 'boards') return { piece: puckId, line: 'dump', dump: 'corner', aim, to: aim };
  const from = positionsByStep(d)[k - 1][puckId] || aim;
  const r = aroundTheBoards(from, aim);
  return { piece: puckId, line: 'dump', dump: 'boards', aim, to: pt(r.to), bends: r.bends };
}
/** Switch a dump between "corner" and "boards". */
export function setDump(d, k, puckId, style) {
  const n = clone(d);
  const step = n.steps[k - 1];
  const i = step ? (step.moves || []).findIndex(m => m.piece === puckId && m.line === 'dump') : -1;
  if (i < 0) return d;
  const old = step.moves[i];
  step.moves[i] = { ...dumpMove(d, k, puckId, old.aim || old.to, style), ...(old.when ? { when: old.when, start: old.start, end: old.end } : {}) };
  for (const key of ['start', 'end']) if (step.moves[i][key] == null) delete step.moves[i][key];
  return n;
}

/** What moves in step k, in drill order: [{ piece, move }]. */
export function movingIn(d, k, pos = positionsByStep(d)) {
  const step = d.steps[k - 1];
  if (!step) return [];
  return d.pieces.filter(p => { const m = moveOf(step, p.id); return m && (m.carriedBy || movesIn(d, k, p.id, pos)); })
    .map(p => ({ piece: p, move: moveOf(step, p.id) }));
}

/**
 * Put a puck on a player's stick at the start of step k (k ≥ 1) so they can pass or shoot.
 * Never takes a puck the drill already uses: only a free puck (one that never moves and isn't on
 * another player's stick) can be moved, and only into Setup for step 1. Otherwise a new puck appears
 * on their stick in this step, "from the pile" when a puck pile is beside them. Earlier steps never change.
 * toward: which side of the player it sits. → { drill, puck: id, how: 'setup' | 'pile' | 'new' }
 */
export function giveTo(d, k, playerId, toward, newPuckId) {
  const pos = positionsByStep(d);
  const before = pos[k - 1], at = before[playerId];
  const dx = toward ? toward[0] - at[0] : 1, dy = toward ? toward[1] - at[1] : 0, len = Math.hypot(dx, dy) || 1;
  const spot = pt([at[0] + dx / len * 2.5, at[1] + dy / len * 2.5]);
  const moves = id => d.steps.some(s => (s.moves || []).some(m => m.piece === id));
  const onSomeonesStick = id => d.pieces.some(p => handlesPuck(p.type) && p.id !== playerId && before[p.id] && dist(before[p.id], before[id]) <= 4.5);
  if (k === 1) {
    const free = d.pieces.filter(p => p.type === 'puck' && !Number.isInteger(p.fromStep) && before[p.id] && !moves(p.id) && !onSomeonesStick(p.id))
      .sort((a, b) => dist(before[a.id], at) - dist(before[b.id], at))[0];
    if (free) { const n = clone(d); n.start[free.id] = spot; return { drill: n, puck: free.id, how: 'setup' }; }
  }
  const pile = d.pieces.some(p => p.type === 'pile' && before[p.id] && dist(before[p.id], at) <= 10);
  return { drill: addPiece(d, { id: newPuckId, type: 'puck', at: spot, step: k > 1 ? k : 0 }), puck: newPuckId, how: pile ? 'pile' : 'new' };
}
