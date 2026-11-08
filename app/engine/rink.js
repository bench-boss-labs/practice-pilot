/* Practice Pilot animation engine — the rink. NHL sheet, 200 × 85 ft; positions in feet from the top-left. */

export const RINK = { w: 200, h: 85, corner: 28, goal: 11, blue: 75, circleR: 15 };

/** viewBox for each view, in feet with a 3 ft margin. flip = show the other end (half ice and zone). */
export function viewBox(rink = 'full', flip = false) {
  switch (rink) {
    case 'half': return flip ? '-3 -3 106 91' : '97 -3 106 91';
    case 'zone': return flip ? '-3 -3 81 91' : '122 -3 81 91';
    case 'neutral': return '70 -3 60 91';
    default: return '-3 -3 206 91';
  }
}
export const VIEWS = [['full', 'Full ice'], ['half', 'Half ice'], ['zone', 'Zone'], ['neutral', 'Neutral zone']];

/**
 * Turned view ("Up the ice"): the picture is turned a quarter so the net of the end shown is at the top.
 * The drill itself never changes: pieces keep their rink spots, only the picture turns.
 * → degrees the rink is turned: 0 (across), -90 (the right-hand end at the top) or 90 (the left-hand end at the top).
 */
export function turnOf(view = {}) {
  if (!view || !view.turn) return 0;
  return view.flip && (view.rink === 'half' || view.rink === 'zone') ? 90 : -90;
}
/** A rink point as it shows in the (turned) picture, and back. */
export function turnPoint([x, y], deg) { return deg === -90 ? [y, -x] : deg === 90 ? [-y, x] : [x, y]; }
export function unturnPoint([x, y], deg) { return deg === -90 ? [-y, x] : deg === 90 ? [y, -x] : [x, y]; }
/** viewBox for a drill's view, turned when the view is turned. */
export function viewBoxOf(view = {}) {
  const vb = viewBox(view && view.rink, view && view.flip), deg = turnOf(view);
  if (!deg) return vb;
  const [x, y, w, h] = vb.split(/\s+/).map(Number);
  return deg === -90 ? `${y} ${-(x + w)} ${h} ${w}` : `${-(y + h)} ${x} ${h} ${w}`;
}
/** The ice in picture space, for keeping callouts on screen: { x0, y0, x1, y1 }. */
export function iceBounds(deg = 0) {
  if (deg === -90) return { x0: 0, y0: -200, x1: 85, y1: 0 };
  if (deg === 90) return { x0: -85, y0: 0, x1: 0, y1: 200 };
  return { x0: 0, y0: 0, x1: 200, y1: 85 };
}

/** Ringette free-play lines: one in each end, just past the end-zone circles on the blue-line side. */
export const RINGETTE_X = [46, 154];

/**
 * A net seen from above, mouth at (0,0) facing +x. Drawn a bit larger than a real 6 × 3.7 ft net
 * so it reads on a phone. Mesh is drawn as lines (no pattern ids, so many pictures can share a page).
 */
export const NET = { w: 8.1, d: 5 };
export function netSVG() {
  const { w, d } = NET, hw = w / 2;
  const frame = `M0,${-hw} L${-d * 0.5},${-hw} Q${-d},${-hw} ${-d},${-hw + d * 0.5} L${-d},${hw - d * 0.5} Q${-d},${hw} ${-d * 0.5},${hw} L0,${hw}`;
  let mesh = '';
  for (let x = -d + 1; x < 0; x += 1.1) mesh += `M${x.toFixed(2)},${-hw + 0.3} V${hw - 0.3} `;
  for (let y = -hw + 1; y < hw; y += 1.1) mesh += `M${-d + 0.3},${y.toFixed(2)} H-0.2 `;
  return `<path d="${frame} Z" fill="#ffffff"/>` +
    `<path d="${mesh}" stroke="#b9c4cf" stroke-width=".14" fill="none"/>` +
    `<path d="${frame}" fill="none" stroke="#c8102e" stroke-width=".5" stroke-linejoin="round"/>` +
    `<line x1="0" y1="${-hw}" x2="0" y2="${hw}" stroke="#c8102e" stroke-width=".7"/>` +
    `<circle cx="0" cy="${-hw}" r=".55" fill="#c8102e"/><circle cx="0" cy="${hw}" r=".55" fill="#c8102e"/>`;
}

/** The rink drawing (SVG markup). Colours are fixed: ice reads the same in light and dark themes. */
export function rinkSVG(idPrefix = 'r', { ringette = false } = {}) {
  const red = '#c8102e', blue = '#1d4e9e', clip = `${idPrefix}-clip`;
  let s = `<defs><clipPath id="${clip}"><rect x="0" y="0" width="200" height="85" rx="28"/></clipPath></defs>`;
  s += `<rect x="0" y="0" width="200" height="85" rx="28" fill="#f8fbfd"/><g clip-path="url(#${clip})">`;
  s += `<path d="M11,36.5 A6,6 0 0 1 11,48.5 Z" fill="#cfe3f5" stroke="${red}" stroke-width=".25"/><path d="M189,36.5 A6,6 0 0 0 189,48.5 Z" fill="#cfe3f5" stroke="${red}" stroke-width=".25"/>`;
  s += `<line x1="11" y1="0" x2="11" y2="85" stroke="${red}" stroke-width=".3"/><line x1="189" y1="0" x2="189" y2="85" stroke="${red}" stroke-width=".3"/>`;
  s += `<rect x="74.5" y="0" width="1" height="85" fill="${blue}"/><rect x="124.5" y="0" width="1" height="85" fill="${blue}"/><rect x="99.5" y="0" width="1" height="85" fill="${red}"/>`;
  s += `<circle cx="100" cy="42.5" r="15" fill="none" stroke="${blue}" stroke-width=".3"/><circle cx="100" cy="42.5" r=".6" fill="${blue}"/>`;
  for (const [x, y] of [[31, 20.5], [31, 64.5], [169, 20.5], [169, 64.5]]) s += `<circle cx="${x}" cy="${y}" r="15" fill="none" stroke="${red}" stroke-width=".3"/><circle cx="${x}" cy="${y}" r="1" fill="${red}"/>`;
  for (const [x, y] of [[80, 20.5], [80, 64.5], [120, 20.5], [120, 64.5]]) s += `<circle cx="${x}" cy="${y}" r="1" fill="${red}"/>`;
  if (ringette) for (const x of RINGETTE_X) s += `<rect x="${x - 0.5}" y="0" width="1" height="85" fill="#f2c200" data-ringette="${x}"/>`;
  // nets: mouth on the goal line, facing centre ice
  s += `<g transform="translate(11,42.5)">${netSVG()}</g><g transform="translate(189,42.5) scale(-1,1)">${netSVG()}</g>`;
  s += `</g><rect x="0" y="0" width="200" height="85" rx="28" fill="none" stroke="#2a3542" stroke-width=".9"/>`;
  return s;
}

/** Keep a point on the ice (inside the boards' bounding box, a little in from the edge). */
export function onIce([x, y]) {
  return [Math.max(1, Math.min(199, x)), Math.max(1, Math.min(84, y))];
}
