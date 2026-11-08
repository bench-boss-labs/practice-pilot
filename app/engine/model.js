/* Practice Pilot animation engine — the drill model.
   frameAt(drill, t) answers "what does the rink look like at time t?" for the editor, player,
   thumbnails and (R4) video export. Pure: no DOM. Positions are feet on the 200 × 85 sheet. */
import { spline, poly, at, clamp, ease, dist } from './geometry.js?v=1.4.3';
import { turnPoint, iceBounds } from './rink.js?v=1.4.3';

export const PIECES = {
  F: { label: 'Forward', player: true }, C: { label: 'Centre', player: true }, D: { label: 'Defence', player: true },
  G: { label: 'Goalie', player: true }, X: { label: 'Player', player: true },
  coach: { label: 'Coach', moves: true },
  puck: { label: 'Puck', moves: true },
  pile: { label: 'Puck pile' }, pylon: { label: 'Pylon' }, net: { label: 'Net', rotate: true },
  board: { label: 'Passer board', rotate: true }, deker: { label: 'Deker', rotate: true },
  tire: { label: 'Tire' }, stick: { label: 'Stick', rotate: true }, text: { label: 'Text label' },
};
export const TEAMS = { red: '#c8102e', black: '#1d232b', white: '#ffffff', blue: '#1d4ed8' };
export const isPlayer = type => !!(PIECES[type] && PIECES[type].player);
/** Pieces that pass, receive, shoot and carry the puck: players and coaches. */
export const handlesPuck = type => isPlayer(type) || type === 'coach';
export const canMove = type => !!(PIECES[type] && (PIECES[type].player || PIECES[type].moves));
export const LINES = { player: ['skate', 'skate-puck', 'backward'], coach: ['skate', 'skate-puck'], puck: ['pass', 'shot', 'carried'] };
export const DEFAULT_SECONDS = 2;

/** Timing window of a move inside its step, as fractions 0–1 (see the R1 Animation Engine deep-dive). */
export function moveWindow(m) {
  if (m.when === 'custom' && Number.isFinite(m.start) && Number.isFinite(m.end) && m.end > m.start) return [clamp(m.start, 0, 1), clamp(m.end, 0, 1)];
  if (m.when === 'after') return [0.6, 1];
  if (m.line === 'pass') return [0, 0.4];
  if (m.line === 'shot') return [0, 0.25];
  if (m.line === 'dump') return [0, 0.7];
  return [0, 1];
}

const stepsOf = d => d.steps || [];
const secondsOf = s => (Number.isFinite(s.seconds) && s.seconds > 0 ? s.seconds : DEFAULT_SECONDS);
export const totalSeconds = d => stepsOf(d).reduce((a, s) => a + secondsOf(s), 0);
const pieceById = (d, id) => d.pieces.find(p => p.id === id);
const fromStep = p => (Number.isInteger(p.fromStep) ? p.fromStep : 0);
const untilStep = p => (Number.isInteger(p.untilStep) ? p.untilStep : Infinity);

/** Which moves a step has for a piece (the last one wins if a file lists two). */
export function moveOf(step, id) {
  const ms = (step.moves || []).filter(m => m.piece === id);
  return ms[ms.length - 1] || null;
}

/** Is this move a carried puck (and not also passed or shot)? */
function carrierOfMove(d, m) {
  if (!m || !m.carriedBy || m.line === 'pass' || m.line === 'shot' || m.line === 'dump' || m.to) return null;
  const c = pieceById(d, m.carriedBy);
  return c && handlesPuck(c.type) ? c : null;
}

/**
 * Positions of every piece before step 1 (index 0) and after each step (index k).
 * A carried puck keeps its offset from the carrier.
 */
export function positionsByStep(d) {
  const out = [{}];
  for (const p of d.pieces) out[0][p.id] = (d.start && d.start[p.id]) ? [...d.start[p.id]] : [100, 42.5];
  stepsOf(d).forEach((step, i) => {
    const prev = out[i], next = { ...prev };
    for (const p of d.pieces) {
      const m = moveOf(step, p.id);
      if (m && m.to && !carrierOfMove(d, m)) next[p.id] = [...m.to];
    }
    for (const p of d.pieces) {
      const m = moveOf(step, p.id), c = carrierOfMove(d, m);
      if (c) {
        const off = [prev[p.id][0] - prev[c.id][0], prev[p.id][1] - prev[c.id][1]];
        next[p.id] = [next[c.id][0] + off[0], next[c.id][1] + off[1]];
      }
    }
    out.push(next);
  });
  return out;
}

/** The path a piece follows in step k (1-based), as a polyline. */
export function pathOf(d, k, id, pos = positionsByStep(d)) {
  const m = moveOf(stepsOf(d)[k - 1] || {}, id);
  const a = pos[k - 1][id], b = pos[k][id];
  return poly(spline([a, ...((m && m.bends) || []), b]));
}

/** Does the piece move in step k (k ≥ 1)? */
export function movesIn(d, k, id, pos = positionsByStep(d)) {
  const m = moveOf(stepsOf(d)[k - 1] || {}, id);
  if (!m) return false;
  return dist(pos[k - 1][id], pos[k][id]) > 0.3 || ((m.bends || []).length > 0 && !carrierOfMove(d, m));
}

/** Facing (radians) of each player after each step, for when they're standing still. */
function facingByStep(d, pos) {
  const out = [{}];
  for (const p of d.pieces) out[0][p.id] = pos[0][p.id][0] > 100 ? Math.PI : 0;
  stepsOf(d).forEach((step, i) => {
    const k = i + 1, f = { ...out[i] };
    for (const p of d.pieces) {
      if (!isPlayer(p.type) && p.type !== 'coach') continue;
      if (!movesIn(d, k, p.id, pos)) continue;
      const m = moveOf(step, p.id), pl = pathOf(d, k, p.id, pos), end = at(pl, Math.max(0, pl.L - 0.01));
      let ang = end.ang ?? f[p.id];
      if (m.line === 'backward') ang += Math.PI;
      if (m.finish === 'pivot') ang += Math.PI;
      f[p.id] = ang;
    }
    out.push(f);
  });
  return out;
}

/** Step and progress at time t (seconds from the start of step 1). Setup = { k: 0, p: 1 }. */
export function stepAt(d, t) {
  const steps = stepsOf(d);
  if (!steps.length) return { k: 0, p: 1 };
  let acc = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = secondsOf(steps[i]);
    if (t < acc + s || i === steps.length - 1) return { k: i + 1, p: clamp((t - acc) / s, 0, 1) };
    acc += s;
  }
  return { k: steps.length, p: 1 };
}
/** Time at which step k starts. */
export const stepStartTime = (d, k) => stepsOf(d).slice(0, Math.max(0, k - 1)).reduce((a, s) => a + secondsOf(s), 0);

/**
 * Everything drawn at time t, or at the end of step k when called as frameAtStep.
 * → { k, p, pieces: [{ id, type, team, x, y, ang, opacity, glow, rotate, text }], callouts: [{ id, piece, text, x, y, opacity }] }
 */
export function frame(d, k, p, cache = {}) {
  const pos = cache.pos || positionsByStep(d);
  const face = cache.face || facingByStep(d, pos);
  const step = stepsOf(d)[k - 1];
  const pieces = [];
  const here = {};
  const place = (piece, pp) => {
    if (here[piece.id]) return here[piece.id];
    let x, y, ang = face[Math.max(0, k - 1)] ? face[Math.max(0, k - 1)][piece.id] : 0;
    const m = step && moveOf(step, piece.id), c = carrierOfMove(d, m);
    if (k === 0) { [x, y] = pos[0][piece.id]; ang = face[0][piece.id]; }
    else if (c) {
      const cp = place(c, pp), a = pos[k - 1], b = pos[k];
      const ox = (a[piece.id][0] - a[c.id][0]) * (1 - cp.q) + (b[piece.id][0] - b[c.id][0]) * cp.q;
      const oy = (a[piece.id][1] - a[c.id][1]) * (1 - cp.q) + (b[piece.id][1] - b[c.id][1]) * cp.q;
      x = cp.x + ox; y = cp.y + oy;
      here[piece.id] = { x, y, ang, q: cp.q, flying: false };
      return here[piece.id];
    } else if (m && movesIn(d, k, piece.id, pos)) {
      const [s, e] = moveWindow(m);
      const q = ease(clamp((pp - s) / (e - s), 0, 1));
      const pl = pathOf(d, k, piece.id, pos), pt = at(pl, pl.L * q);
      x = pt.x; y = pt.y;
      if (isPlayer(piece.type) || piece.type === 'coach') {
        if (q > 0 && q < 1 && pt.ang != null) ang = pt.ang + (m.line === 'backward' ? Math.PI : 0);
        else if (q >= 1) ang = face[k][piece.id];
        if (m.finish === 'pivot') {
          // turn around during the last 15% of the move
          const turnFrom = e - 0.15 * (e - s);
          const r = clamp((pp - turnFrom) / (e - turnFrom), 0, 1);
          if (r > 0) ang = face[k][piece.id] - Math.PI * (1 - r);
        }
      }
      here[piece.id] = { x, y, ang, q, flying: (m.line === 'pass' || m.line === 'shot' || m.line === 'dump') && q > 0 && q < 1 };
      return here[piece.id];
    } else {
      [x, y] = pos[k][piece.id];
    }
    here[piece.id] = { x, y, ang, q: 1, flying: false };
    return here[piece.id];
  };

  const highlight = new Set((step && step.highlight) || []);
  for (const piece of d.pieces) {
    const from = fromStep(piece), until = untilStep(piece);
    if (k < from || k > until) continue;
    let opacity = 1;
    if (k === from && k > 0) opacity = clamp(p / 0.15, 0, 1);
    if (k === until && k > 0 && Number.isFinite(until)) opacity = Math.min(opacity, clamp((1 - p) / 0.15, 0, 1));
    const st = place(piece, p);
    let glow = highlight.has(piece.id);
    if (d.autoHighlight !== false && step) {
      if (piece.type === 'puck' && st.flying) glow = true;
      if (handlesPuck(piece.type) && d.pieces.some(o => o.type === 'puck' && carrierOfMove(d, moveOf(step, o.id)) && moveOf(step, o.id).carriedBy === piece.id)) glow = true;
    }
    pieces.push({ id: piece.id, type: piece.type, team: piece.team, rotate: piece.rotate || 0, text: piece.text || '', x: st.x, y: st.y, ang: st.ang ?? 0, opacity, glow });
  }

  const callouts = [];
  stepsOf(d).forEach((s, i) => {
    const sk = i + 1;
    for (const [n, c] of (s.callouts || []).entries()) {
      const visible = c.stay ? (k >= sk) : (k === sk);
      if (!visible || k === 0) continue;
      const target = pieces.find(x => x.id === c.piece);
      if (!target) continue;
      let opacity = 1;
      if (k === sk) opacity = clamp(p / 0.1, 0, 1);
      if (!c.stay && k === sk) opacity = Math.min(opacity, clamp((1 - p) / 0.1, 0, 1));
      callouts.push({ id: `${sk}-${n}`, piece: c.piece, text: String(c.text || '').slice(0, 60), x: target.x, y: target.y, opacity: opacity * target.opacity });
    }
  });
  return { k, p, pieces, callouts };
}

/** frame at time t in seconds. */
export function frameAt(d, t, cache) {
  const { k, p } = stepAt(d, t);
  return frame(d, k, p, cache);
}

/** A cache for repeated frames of the same drill (playback): pass it to frame/frameAt. */
export function prepare(d) {
  const pos = positionsByStep(d);
  return { pos, face: facingByStep(d, pos) };
}

/** Lay callouts out so they don't cover each other or other pieces. Each bubble tries above its piece,
    then below, right and left, and keeps the first spot that is clear (or the least crowded one).
    obstacles: [{ id, x, y }] pieces to keep clear of. Widths are estimated from the text. */
export function layoutCallouts(callouts, obstacles = [], deg = 0) {
  // laid out in picture space, so a turned view ("Up the ice") still gets upright, on-screen callouts
  const b = iceBounds(deg);
  const obs = obstacles.map(o => { const [x, y] = turnPoint([o.x, o.y], deg); return { id: o.id, x, y }; });
  const placed = [];
  const R = 4.2;
  for (const c0 of callouts) {
    const [cx, cy] = turnPoint([c0.x, c0.y], deg), c = { ...c0, x: cx, y: cy };
    const w = Math.min(70, 4 + c.text.length * 1.45), h = 5.2;
    const spots = [
      ['above', c.x - w / 2, c.y - 6 - h], ['below', c.x - w / 2, c.y + 6],
      ['right', c.x + 6, c.y - h / 2], ['left', c.x - 6 - w, c.y - h / 2],
    ];
    if (c.y < b.y0 + 14) spots.unshift(spots.splice(1, 1)[0]);
    let best = null;
    for (const [side, x0, y0] of spots) {
      const bx = clamp(x0, b.x0 + 1, b.x1 - 1 - w), by = clamp(y0, b.y0 + 1, b.y1 - 1 - h);
      let cost = placed.filter(o => bx < o.bx + o.w + 1 && bx + w + 1 > o.bx && by < o.by + o.h + 0.6 && by + h + 0.6 > o.by).length * 10;
      cost += obs.filter(o => o.id !== c.piece && o.x + R > bx && o.x - R < bx + w && o.y + R > by && o.y - R < by + h).length;
      if (!best || cost < best.cost) best = { side, bx, by, cost };
      if (cost === 0) break;
    }
    placed.push({ ...c, bx: best.bx, by: best.by, w, h, side: best.side, below: best.side === 'below' });
  }
  return placed;
}

/** A new, empty drill in the v1 format. */
export function emptyDrill() {
  return { view: { rink: 'full', flip: false }, pieces: [], start: {}, steps: [], markup: [], autoHighlight: true };
}
