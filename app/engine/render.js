/* Practice Pilot animation engine — drawing. Builds SVG markup (strings) from a frame,
   so the same code draws the editor, the player, library cards and printed plans. */
import { poly, at, sub, offsetPoints } from './geometry.js?v=1.1.3';
import { TEAMS, isPlayer, positionsByStep, pathOf, movesIn, moveOf, layoutCallouts } from './model.js?v=1.1.3';
import { rinkSVG, viewBox } from './rink.js?v=1.1.3';

export const ACCENT = '#F26A1B';
export const INK = '#1b2430';
export const MARK_COLOURS = { orange: '#F26A1B', navy: '#0B1B31', blue: '#1d4ed8' };
export const R_PLAYER = 3.4, R_PUCK = 1.15;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f2 = n => (Math.round(n * 100) / 100).toString();
const dOf = pts => 'M' + pts.map(p => `${f2(p[0])},${f2(p[1])}`).join(' L');

export function radius(type) {
  if (isPlayer(type)) return R_PLAYER + 0.4;
  if (type === 'coach') return 3.6;
  if (type === 'puck') return R_PUCK + 0.3;
  if (type === 'board' || type === 'deker' || type === 'stick' || type === 'net') return 3.4;
  if (type === 'text') return 3;
  return 2.2;
}

function arrowHead(x, y, ang, col, size = 2.2) {
  const a1 = ang + 2.6, a2 = ang - 2.6;
  return `<polygon points="${f2(x)},${f2(y)} ${f2(x + size * Math.cos(a1))},${f2(y + size * Math.sin(a1))} ${f2(x + size * Math.cos(a2))},${f2(y + size * Math.sin(a2))}" fill="${col}"/>`;
}

/** One movement in hockey notation. line: skate | skate-puck | backward | pass | shot. finish: stop | pivot. */
export function notation(pl, line, col, w, finish) {
  if (pl.L < 0.5) return '';
  const tip = at(pl, pl.L), ang = tip.ang || 0;
  const body = sub(pl, 0, Math.max(0, pl.L - 1.6));
  const st = `fill="none" stroke="${col}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
  let s;
  if (line === 'skate-puck') {
    const wl = Math.max(0, body.L - 1.4);
    s = `<path d="${dOf(offsetPoints(body, 0.4, d => (d < wl ? Math.sin(d / 3.2 * 2 * Math.PI) * 0.9 : 0)))}" ${st}/>`;
  } else if (line === 'pass') {
    s = `<path d="${dOf(body.pts)}" ${st} stroke-dasharray="1.6 1.2" stroke-linecap="butt"/>`;
  } else if (line === 'shot') {
    s = `<path d="${dOf(offsetPoints(body, 0.5, () => 0.55))}" ${st}/><path d="${dOf(offsetPoints(body, 0.5, () => -0.55))}" ${st}/>`;
  } else {
    s = `<path d="${dOf(body.pts)}" ${st}/>`;
    if (line === 'backward') {
      for (let t = 2.5; t < body.L - 1.5; t += 3) {
        const q = at(body, t), nx = -Math.sin(q.ang || 0), ny = Math.cos(q.ang || 0);
        s += `<line x1="${f2(q.x + nx)}" y1="${f2(q.y + ny)}" x2="${f2(q.x - nx)}" y2="${f2(q.y - ny)}" stroke="${col}" stroke-width="${w}"/>`;
      }
    }
  }
  s += arrowHead(tip.x, tip.y, ang, col);
  if (finish === 'stop') {
    const nx = -Math.sin(ang), ny = Math.cos(ang), bx = tip.x + Math.cos(ang) * 0.6, by = tip.y + Math.sin(ang) * 0.6;
    s += `<line x1="${f2(bx + nx * 2)}" y1="${f2(by + ny * 2)}" x2="${f2(bx - nx * 2)}" y2="${f2(by - ny * 2)}" stroke="${col}" stroke-width="${w * 1.6}" stroke-linecap="round"/>`;
  } else if (finish === 'pivot') {
    const cx = tip.x + Math.cos(ang) * 1.6, cy = tip.y + Math.sin(ang) * 1.6;
    s += `<circle cx="${f2(cx)}" cy="${f2(cy)}" r="1.2" fill="none" stroke="${col}" stroke-width="${w}"/>`;
  }
  return s;
}

/** All movement lines: step `current` bold in the accent, others faint (Setup shows them all at medium). */
export function pathsSVG(d, current, { pos = positionsByStep(d), only = null } = {}) {
  let out = '';
  (d.steps || []).forEach((step, i) => {
    const k = i + 1;
    if (only != null && k !== only) return;
    const active = k === current, col = active ? ACCENT : INK, w = active ? 0.5 : 0.38;
    const op = active ? 1 : current === 0 ? 0.55 : 0.22;
    let g = '';
    for (const p of d.pieces) {
      const m = moveOf(step, p.id);
      if (!m || m.line === 'carried' || (m.carriedBy && !m.to)) continue;
      if (!movesIn(d, k, p.id, pos)) continue;
      const pl = pathOf(d, k, p.id, pos), r = radius(p.type);
      if (pl.L < 2 * r + 0.5) continue;
      const line = m.line || (p.type === 'puck' ? 'pass' : 'skate');
      g += notation(sub(pl, r, pl.L - r), line, col, w, isPlayer(p.type) || p.type === 'coach' ? m.finish : null);
    }
    if (g) out += `<g opacity="${op}" data-step="${k}">${g}</g>`;
  });
  return out;
}

/** One piece at its place in a frame. */
export function pieceSVG(pc, { selected = false } = {}) {
  const ring = selected ? `<circle r="${f2(radius(pc.type) + 1.2)}" fill="none" stroke="${ACCENT}" stroke-width=".6" stroke-dasharray="1.2 .8"/>` : '';
  const glow = pc.glow ? `<circle r="${f2(radius(pc.type) + 2.6)}" fill="url(#pp-glow)"/>` : '';
  const tr = `transform="translate(${f2(pc.x)},${f2(pc.y)})"`;
  const op = pc.opacity < 1 ? ` opacity="${f2(pc.opacity)}"` : '';
  const head = `<g ${tr}${op} data-piece="${esc(pc.id)}">${glow}${ring}`;
  const font = 'font-family="Montserrat,Inter,Arial,sans-serif" font-weight="800"';
  if (isPlayer(pc.type)) {
    const fill = TEAMS[pc.team] || TEAMS.red;
    const text = pc.team === 'white' ? '#1b2430' : '#ffffff';
    const deg = f2((pc.ang || 0) * 180 / Math.PI);
    return `${head}<g transform="rotate(${deg})"><polygon points="${R_PLAYER + 1.9},0 ${R_PLAYER - 0.2},-1.6 ${R_PLAYER - 0.2},1.6" fill="#1b2430"/></g><circle r="${R_PLAYER}" fill="${fill}" stroke="#1b2430" stroke-width=".35"/><text y="1.25" text-anchor="middle" ${font} font-size="3.5" fill="${text}">${esc(pc.type)}</text></g>`;
  }
  switch (pc.type) {
    case 'coach': return `${head}<rect x="-3.2" y="-3.2" width="6.4" height="6.4" rx="1" fill="#f2b705" stroke="#1b2430" stroke-width=".35"/><text y="1.1" text-anchor="middle" ${font} font-size="3" fill="#1b2430">CO</text></g>`;
    case 'puck': return `${head}<circle r="${R_PUCK}" fill="#0b0d10"/></g>`;
    case 'pile': return `${head}${[[-1.3, -0.8], [1.2, -1], [0, 0.9], [-1.6, 1.3], [1.5, 1.2]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".95" fill="#0b0d10"/>`).join('')}</g>`;
    case 'pylon': return `${head}<polygon points="0,-2.3 2,1.6 -2,1.6" fill="#f26a1b" stroke="#7a3208" stroke-width=".25"/></g>`;
    case 'tire': return `${head}<circle r="1.9" fill="none" stroke="#1b2430" stroke-width="1.1"/></g>`;
    case 'board': return `${head}<g transform="rotate(${pc.rotate || 0})"><rect x="-4" y="-0.8" width="8" height="1.6" rx=".4" fill="#7b8794" stroke="#1b2430" stroke-width=".25"/></g></g>`;
    case 'deker': return `${head}<g transform="rotate(${pc.rotate || 0})"><rect x="-4" y="-0.5" width="8" height="1" rx=".3" fill="#1d4ed8"/><rect x="-4.2" y="-1.3" width="0.9" height="2.6" fill="#1b2430"/><rect x="3.3" y="-1.3" width="0.9" height="2.6" fill="#1b2430"/></g></g>`;
    case 'stick': return `${head}<g transform="rotate(${pc.rotate || 0})"><rect x="-4.5" y="-0.3" width="8" height="0.6" fill="#8a5a2b"/><rect x="3.2" y="-0.3" width="1.8" height="1.1" fill="#1b2430"/></g></g>`;
    case 'net': return `${head}<g transform="rotate(${pc.rotate || 0})"><path d="M-3,-1.6 H3 V1.6 H-3" fill="#ffffff" stroke="#c8102e" stroke-width=".45"/></g></g>`;
    case 'text': return `${head}<text y="1" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="700" font-size="3" fill="#1b2430">${esc(pc.text || 'Text')}</text></g>`;
    default: return '';
  }
}

/** Speech-bubble callouts for a frame, kept clear of the frame's pieces. */
export function calloutsSVG(callouts, pieces = []) {
  const stroke = 'fill="#ffffff" stroke="#1b2430" stroke-width=".25"';
  return layoutCallouts(callouts, pieces).map(c => {
    const op = c.opacity < 1 ? ` opacity="${f2(c.opacity)}"` : '';
    let tail;
    if (c.side === 'above' || c.side === 'below') {
      const tx = Math.max(c.bx + 1.5, Math.min(c.bx + c.w - 1.5, c.x));
      const ey = c.side === 'below' ? c.by : c.by + c.h, ty = c.side === 'below' ? c.by - 1.4 : c.by + c.h + 1.4;
      tail = `<polygon points="${f2(tx - 1.1)},${f2(ey)} ${f2(tx + 1.1)},${f2(ey)} ${f2(tx)},${f2(ty)}" ${stroke}/>`;
    } else {
      const ty = Math.max(c.by + 1.2, Math.min(c.by + c.h - 1.2, c.y));
      const ex = c.side === 'right' ? c.bx : c.bx + c.w, tx = c.side === 'right' ? c.bx - 1.4 : c.bx + c.w + 1.4;
      tail = `<polygon points="${f2(ex)},${f2(ty - 1.1)} ${f2(ex)},${f2(ty + 1.1)} ${f2(tx)},${f2(ty)}" ${stroke}/>`;
    }
    return `<g class="callout"${op} data-callout="${esc(c.id)}">${tail}<rect x="${f2(c.bx)}" y="${f2(c.by)}" width="${f2(c.w)}" height="${f2(c.h)}" rx="1.4" fill="#ffffff" stroke="#1b2430" stroke-width=".3"/><text x="${f2(c.bx + c.w / 2)}" y="${f2(c.by + c.h / 2 + 1)}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="600" font-size="2.6" fill="#1b2430">${esc(c.text)}</text></g>`;
  }).join('');
}

/** Markup for step k (marks on that step plus marks on all steps). */
export function markupSVG(d, k) {
  return (d.markup || []).filter(m => m.step == null || m.step === k).map((m, i) => {
    const col = MARK_COLOURS[m.colour] || MARK_COLOURS.orange;
    const id = m.id || `m${i}`;
    const st = `fill="none" stroke="${col}" stroke-width=".55" stroke-linecap="round" stroke-linejoin="round" data-mark="${esc(id)}"`;
    const pts = m.points || [];
    if (m.kind === 'pen' && pts.length > 1) return `<path d="${dOf(pts)}" ${st}/>`;
    if (m.kind === 'arrow' && pts.length > 1) {
      const a = pts[0], b = pts[pts.length - 1], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      return `<g data-mark="${esc(id)}"><path d="${dOf([a, [b[0] - Math.cos(ang) * 1.4, b[1] - Math.sin(ang) * 1.4]])}" ${st.replace(/ data-mark="[^"]*"/, '')}/>${arrowHead(b[0], b[1], ang, col)}</g>`;
    }
    if (m.kind === 'box' && pts.length > 1) {
      const [a, b] = [pts[0], pts[pts.length - 1]];
      return `<rect x="${f2(Math.min(a[0], b[0]))}" y="${f2(Math.min(a[1], b[1]))}" width="${f2(Math.abs(b[0] - a[0]))}" height="${f2(Math.abs(b[1] - a[1]))}" rx="1" ${st} stroke-dasharray="1.4 1"/>`;
    }
    if (m.kind === 'text' && pts.length) return `<text x="${f2(pts[0][0])}" y="${f2(pts[0][1])}" font-family="Inter,Arial,sans-serif" font-weight="700" font-size="3.2" fill="${col}" data-mark="${esc(id)}">${esc(m.text || '')}</text>`;
    return '';
  }).join('');
}

export const GLOW_DEFS = '<defs><radialGradient id="pp-glow"><stop offset="0.55" stop-color="#ffd23f" stop-opacity=".75"/><stop offset="1" stop-color="#ffd23f" stop-opacity="0"/></radialGradient></defs>';

/** Inner SVG for a frame: rink, markup, paths, pieces, callouts. */
export function frameSVG(d, fr, { pathsFor = fr.k, selected = null, idPrefix = 'r', pos } = {}) {
  const pieces = [...fr.pieces].sort((a, b) => (a.type === 'puck') - (b.type === 'puck'));
  return GLOW_DEFS + rinkSVG(idPrefix) +
    `<g class="markup">${markupSVG(d, fr.k)}</g>` +
    `<g class="paths">${pathsSVG(d, pathsFor, { pos })}</g>` +
    `<g class="pieces">${pieces.map(pc => pieceSVG(pc, { selected: pc.id === selected })).join('')}</g>` +
    `<g class="callouts">${calloutsSVG(fr.callouts, fr.pieces)}</g>`;
}

/** A complete still picture of a drill (library cards, printing): Setup with every step's lines. */
export async function thumbnailSVG(d, frameFn) {
  const fr = frameFn(d, 0, 1);
  const vb = viewBox(d.view && d.view.rink, d.view && d.view.flip);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${esc(d.title || 'Drill')}">${frameSVG(d, fr, { pathsFor: 0, idPrefix: 't' + Math.random().toString(36).slice(2, 7) })}</svg>`;
}
