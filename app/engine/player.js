/* Practice Pilot animation engine — the player. Plays a drill in an element: rink, caption,
   play/pause, previous/next step, step chips, scrubber, speed and loop. */
import { frame, prepare, stepAt, stepStartTime, totalSeconds } from './model.js?v=1.5.1';
import { frameSVG } from './render.js?v=1.5.1';
import { viewBoxOf } from './rink.js?v=1.5.1';

const SPEEDS = [0.5, 1, 2];
let uid = 0;

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'on') for (const [e, f] of Object.entries(v)) n.addEventListener(e, f);
    else if (k === 'class') n.className = v;
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c);
  return n;
}

export class Player {
  /** host: element to fill. opts: { controls = true, loop = false, speed = 1, onStep(k) } */
  constructor(host, drill, opts = {}) {
    this.host = host; this.opts = opts; this.id = 'pl' + (++uid);
    this.speed = opts.speed || 1; this.loop = !!opts.loop; this.selected = opts.selected || null;
    this.t = 0; this.playing = false; this.raf = 0; this.last = 0;
    this.build();
    this.load(drill);
  }

  build() {
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'pp-rink');
    this.svg.setAttribute('role', 'img');
    this.caption = h('p', { class: 'pp-caption', 'aria-live': 'polite' });
    const btn = (label, icon, fn) => h('button', { class: 'btn btn-quiet pp-ctl', type: 'button', 'aria-label': label, title: label, on: { click: fn } }, icon);
    this.bPrev = btn('Previous step', '‹', () => this.goStep(this.step() - 1));
    this.bPlay = btn('Play', '▶', () => this.toggle());
    this.bNext = btn('Next step', '›', () => this.goStep(this.step() + 1));
    this.scrub = h('input', { type: 'range', class: 'pp-scrub', min: 0, max: 1000, value: 0, 'aria-label': 'Position in drill',
      on: { input: e => { this.pause(); this.seek(e.target.value / 1000 * this.total); } } });
    this.bSpeed = btn('Speed', '1×', () => { this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length]; this.bSpeed.textContent = this.speed + '×'; });
    this.bSpeed.textContent = this.speed + '×';
    this.bLoop = btn('Loop', '⟲', () => { this.loop = !this.loop; this.bLoop.setAttribute('aria-pressed', this.loop); });
    this.bLoop.setAttribute('aria-pressed', this.loop);
    this.chips = h('div', { class: 'pp-chips', role: 'tablist', 'aria-label': 'Steps' });
    const bar = h('div', { class: 'pp-controls' }, this.bPrev, this.bPlay, this.bNext, this.scrub, this.bSpeed, this.bLoop);
    this.host.classList.add('pp-player');
    this.host.replaceChildren(this.svg, this.caption, ...(this.opts.controls === false ? [] : [bar, this.chips]));
    this.onKey = e => {
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest && e.target.closest('input,textarea,select,button,[contenteditable]')) return;
      if (e.key === ' ') { e.preventDefault(); this.toggle(); }
      else if (e.key === 'ArrowLeft') this.goStep(this.step() - 1);
      else if (e.key === 'ArrowRight') this.goStep(this.step() + 1);
    };
    this.host.tabIndex = 0;
    this.host.addEventListener('keydown', this.onKey);
  }

  /** Load (or reload after an edit) a drill. Keeps the current step when it still exists. */
  load(drill, { keep = true } = {}) {
    const k = keep && this.d ? this.step() : 0;
    this.d = drill; this.cache = prepare(drill); this.total = totalSeconds(drill);
    this.svg.setAttribute('viewBox', viewBoxOf(drill.view));
    this.svg.setAttribute('aria-label', drill.title || 'Drill');
    const n = (drill.steps || []).length;
    this.chips.replaceChildren(...['Setup', ...drill.steps.map((_, i) => String(i + 1))].map((label, i) =>
      h('button', { class: 'pp-chip', type: 'button', role: 'tab', 'data-k': i, 'aria-label': i ? `Step ${i}` : 'Setup', on: { click: () => this.goStep(i) } }, label)),
      ...(this.opts.chipsExtra ? [this.opts.chipsExtra] : []));
    this.goStep(Math.min(k, n));
  }

  /** Current step: 0 = Setup (before anything moves). */
  step() { return this.k0 ? 0 : stepAt(this.d, this.t).k; }

  goStep(k) {
    const n = (this.d.steps || []).length;
    k = Math.max(0, Math.min(n, k));
    this.pause();
    this.k0 = k === 0;
    this.t = k === 0 ? 0 : stepStartTime(this.d, k) + (this.d.steps[k - 1].seconds || 2) * 0.999;
    this.draw();
  }

  seek(t) { this.k0 = false; this.t = Math.max(0, Math.min(this.total, t)); this.draw(); }

  toggle() { this.playing ? this.pause() : this.play(); }

  play() {
    if (!this.total) return;
    if (this.t >= this.total - 0.01 || this.k0) { this.t = 0; }
    this.k0 = false; this.playing = true; this.last = performance.now();
    this.bPlay.textContent = '❚❚'; this.bPlay.setAttribute('aria-label', 'Pause');
    const tick = now => {
      if (!this.playing) return;
      this.t += (now - this.last) / 1000 * this.speed; this.last = now;
      if (this.t >= this.total) {
        if (this.loop) this.t = 0; else { this.t = this.total; this.draw(); this.pause(); return; }
      }
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause() {
    this.playing = false; cancelAnimationFrame(this.raf);
    this.bPlay.textContent = '▶'; this.bPlay.setAttribute('aria-label', 'Play');
  }

  /** The frame on screen now (the editor uses this to know where pieces are). */
  current() {
    if (this.k0) return frame(this.d, 0, 1, this.cache);
    const { k, p } = stepAt(this.d, this.t);
    return frame(this.d, k, p, this.cache);
  }

  draw() {
    const fr = this.current();
    if (this.opts.editing && !this.playing && fr.k > 0) {
      // editing shows the end of a step: keep its callouts readable and leaving pieces visible
      for (const c of fr.callouts) c.opacity = 1;
      for (const pc of fr.pieces) pc.opacity = Math.max(pc.opacity, 0.4);
    }
    this.svg.innerHTML = frameSVG(this.d, fr, { pathsFor: fr.k, selected: this.selected || null, idPrefix: this.id, pos: this.cache.pos,
      overlay: this.opts.overlay ? this.opts.overlay(fr, this) : '' });
    const step = fr.k ? this.d.steps[fr.k - 1] : null;
    const cap = step ? (step.caption || `Step ${fr.k}`) : 'Setup';
    if (this.caption.textContent !== cap) this.caption.textContent = cap;
    this.scrub.value = this.total ? Math.round(this.t / this.total * 1000) : 0;
    for (const c of this.chips.children) if (c.dataset.k != null) c.setAttribute('aria-selected', String(+c.dataset.k === fr.k));
    this.bPrev.disabled = fr.k === 0; this.bNext.disabled = fr.k >= (this.d.steps || []).length;
    if (fr.k !== this.lastK) { this.lastK = fr.k; this.opts.onStep && this.opts.onStep(fr.k); }
  }

  /** Select a piece (dashed ring) and redraw. */
  select(id) { this.selected = id || null; this.draw(); }

  /** Rink coordinates (feet) of a pointer event. */
  toRink(e) {
    const p = this.svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(this.iceCTM().inverse());
    return [q.x, q.y];
  }

  /** Screen matrix of the rink (turned when the view is turned). */
  iceCTM() { const g = this.svg.querySelector('.pp-ice'); return (g && g.getScreenCTM()) || this.svg.getScreenCTM(); }
  /** Screen pixels per foot. */
  pxPerFoot() { const m = this.iceCTM(); return m ? Math.hypot(m.a, m.b) : 4; }

  destroy() { this.pause(); this.host.removeEventListener('keydown', this.onKey); this.host.replaceChildren(); }
}
