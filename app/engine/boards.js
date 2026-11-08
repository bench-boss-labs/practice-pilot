/* Practice Pilot animation engine — the boards, for pucks dumped "around the boards".
   The puck rims along a line 3 ft in from the boards: a rounded rectangle 194 × 79 ft, corner radius 25. */

const X0 = 3, X1 = 197, Y0 = 3, Y1 = 82, R = 25;
const TOP = X1 - X0 - 2 * R, SIDE = Y1 - Y0 - 2 * R, ARC = Math.PI * R / 2;
// clockwise from the top-left end of the top boards: top, top-right corner, right end, bottom-right, bottom, bottom-left, left end, top-left
const SEGS = [TOP, ARC, SIDE, ARC, TOP, ARC, SIDE, ARC];
export const PERIMETER = SEGS.reduce((a, b) => a + b, 0);

/** The rim point at distance s (feet, clockwise from the top-left end of the top boards). */
export function rimPoint(s) {
  s = ((s % PERIMETER) + PERIMETER) % PERIMETER;
  let i = 0;
  while (s > SEGS[i] && i < 7) { s -= SEGS[i]; i++; }
  const a = s / R;
  switch (i) {
    case 0: return [X0 + R + s, Y0];
    case 1: return [X1 - R + R * Math.sin(a), Y0 + R - R * Math.cos(a)];
    case 2: return [X1, Y0 + R + s];
    case 3: return [X1 - R + R * Math.cos(a), Y1 - R + R * Math.sin(a)];
    case 4: return [X1 - R - s, Y1];
    case 5: return [X0 + R - R * Math.sin(a), Y1 - R + R * Math.cos(a)];
    case 6: return [X0, Y1 - R - s];
    default: return [X0 + R - R * Math.cos(a), Y0 + R - R * Math.sin(a)];
  }
}

/** Where along the rim a point is nearest: distance s. */
export function rimNearest([x, y]) {
  let best = 0, bd = Infinity;
  for (let s = 0; s < PERIMETER; s += 0.5) {
    const [px, py] = rimPoint(s), dd = (px - x) ** 2 + (py - y) ** 2;
    if (dd < bd) { bd = dd; best = s; }
  }
  return best;
}

const r1 = n => Math.round(n * 10) / 10;

/**
 * A dump around the boards from `from` toward `to`. The puck is sent into the end that `to` is in,
 * meets the boards where that end's corner starts on the dumper's side, then rims round the end
 * (behind the net when it has to) to the boards nearest `to`.
 * → { to: [x, y] on the rim, bends: [[x, y], …] } — bends are the rim points between, for a move's path.
 */
export function aroundTheBoards(from, to) {
  const right = to[0] >= 100;
  const top = from[1] < 42.5;
  // where the corner starts, on the dumper's side; a dumper already deeper meets the boards beside them
  const cornerX = right ? X1 - R : X0 + R;
  const meetX = right ? Math.max(cornerX, Math.min(X1 - R, from[0])) : Math.min(cornerX, Math.max(X0 + R, from[0]));
  const s0 = rimNearest([meetX, top ? Y0 : Y1]);
  const s1 = rimNearest(to);
  // rim toward the end boards: clockwise on top going right / bottom going left, otherwise anticlockwise
  const cw = (top && right) || (!top && !right);
  let len = cw ? s1 - s0 : s0 - s1;
  len = ((len % PERIMETER) + PERIMETER) % PERIMETER;
  const dir = cw ? 1 : -1;
  const bends = [];
  const steps = Math.max(1, Math.round(len / 4));
  for (let i = 0; i < steps; i++) bends.push(rimPoint(s0 + dir * len * i / steps).map(r1));
  return { to: rimPoint(s1).map(r1), bends };
}
