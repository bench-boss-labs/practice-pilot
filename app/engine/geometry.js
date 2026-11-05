/* Practice Pilot animation engine — geometry. Pure functions, units are feet. */

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Smooth curve through points (Catmull-Rom), as a list of points. Two points = a straight line. */
export function spline(pts, perSegment = 16) {
  if (pts.length < 3) return pts.map(p => [p[0], p[1]]);
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let j = 0; j < perSegment; j++) {
      const t = j / perSegment, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
}

/** A polyline with cumulative lengths, for walking along it. */
export function poly(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return { pts, cum, L: cum[cum.length - 1] };
}

/** Point and direction at distance s along a polyline. */
export function at(pl, s) {
  const { pts, cum, L } = pl;
  if (pts.length < 2 || L === 0) return { x: pts[0][0], y: pts[0][1], ang: null };
  s = clamp(s, 0, L);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1e-9, t = (s - cum[i - 1]) / seg;
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

/** The part of a polyline between distances s0 and s1. */
export function sub(pl, s0, s1) {
  const out = [];
  const a = at(pl, s0); out.push([a.x, a.y]);
  for (let i = 0; i < pl.pts.length; i++) if (pl.cum[i] > s0 && pl.cum[i] < s1) out.push(pl.pts[i]);
  const b = at(pl, s1); out.push([b.x, b.y]);
  return poly(out);
}

/** Points offset sideways from a polyline: fn(s) gives the offset in feet at distance s. */
export function offsetPoints(pl, step, fn) {
  const out = [];
  const push = s => { const q = at(pl, s), n = fn(s), ang = q.ang || 0; out.push([q.x - Math.sin(ang) * n, q.y + Math.cos(ang) * n]); };
  for (let s = 0; s < pl.L; s += step) push(s);
  push(pl.L);
  return out;
}
