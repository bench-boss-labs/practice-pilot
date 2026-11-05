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

/** The rink drawing (SVG markup). Colours are fixed: ice reads the same in light and dark themes. */
export function rinkSVG(idPrefix = 'r') {
  const red = '#c8102e', blue = '#1d4e9e', clip = `${idPrefix}-clip`;
  let s = `<defs><clipPath id="${clip}"><rect x="0" y="0" width="200" height="85" rx="28"/></clipPath></defs>`;
  s += `<rect x="0" y="0" width="200" height="85" rx="28" fill="#f8fbfd"/><g clip-path="url(#${clip})">`;
  s += `<path d="M11,36.5 A6,6 0 0 1 11,48.5 Z" fill="#cfe3f5" stroke="${red}" stroke-width=".25"/><path d="M189,36.5 A6,6 0 0 0 189,48.5 Z" fill="#cfe3f5" stroke="${red}" stroke-width=".25"/>`;
  s += `<line x1="11" y1="0" x2="11" y2="85" stroke="${red}" stroke-width=".3"/><line x1="189" y1="0" x2="189" y2="85" stroke="${red}" stroke-width=".3"/>`;
  s += `<rect x="74.5" y="0" width="1" height="85" fill="${blue}"/><rect x="124.5" y="0" width="1" height="85" fill="${blue}"/><rect x="99.5" y="0" width="1" height="85" fill="${red}"/>`;
  s += `<circle cx="100" cy="42.5" r="15" fill="none" stroke="${blue}" stroke-width=".3"/><circle cx="100" cy="42.5" r=".6" fill="${blue}"/>`;
  for (const [x, y] of [[31, 20.5], [31, 64.5], [169, 20.5], [169, 64.5]]) s += `<circle cx="${x}" cy="${y}" r="15" fill="none" stroke="${red}" stroke-width=".3"/><circle cx="${x}" cy="${y}" r="1" fill="${red}"/>`;
  for (const [x, y] of [[80, 20.5], [80, 64.5], [120, 20.5], [120, 64.5]]) s += `<circle cx="${x}" cy="${y}" r="1" fill="${red}"/>`;
  s += `<rect x="7.7" y="39.5" width="3.3" height="6" fill="#ffffff" stroke="${red}" stroke-width=".45"/><rect x="189" y="39.5" width="3.3" height="6" fill="#ffffff" stroke="${red}" stroke-width=".45"/>`;
  s += `</g><rect x="0" y="0" width="200" height="85" rx="28" fill="none" stroke="#2a3542" stroke-width=".9"/>`;
  return s;
}

/** Keep a point on the ice (inside the boards' bounding box, a little in from the edge). */
export function onIce([x, y]) {
  return [Math.max(1, Math.min(199, x)), Math.max(1, Math.min(84, y))];
}
