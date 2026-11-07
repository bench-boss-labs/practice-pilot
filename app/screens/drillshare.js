/* Share a drill (1.4.2): one dialog makes an MP4 video, opens the drill sheet (Print → Save as PDF), or saves a
   drill file another coach can import. Everything is made on the device; only sending needs a connection. */
import { el, fill, toast, dialog, download } from '../ui.js?v=1.4.2';
import { frame, prepare } from '../engine/model.js?v=1.4.2';
import { frameSVG, clipToView } from '../engine/render.js?v=1.4.2';
import { viewBox } from '../engine/rink.js?v=1.4.2';
import { APP_VERSION } from '../version.js?v=1.4.2';
import { newId } from '../../vendor/bbl-kit/1.0.1/bbl-store.js';
import * as X from '../drillshare-core.js?v=1.4.2';

const teamOf = app => (app.helper && app.helper.teamName) || (app.team && app.team.name) || '';
const MADE = 'Made with Practice Pilot';
let uid = 0;

/** A still of a drill: the setup (k = 0, with every step's lines faint) or the end of step k with its paths. */
export function stillSVG(d, k, cache = prepare(d), size = '') {
  const fr = frame(d, k, k ? 1 : 0, cache);
  const vb = viewBox(d.view && d.view.rink, d.view && d.view.flip);
  const id = `s${++uid}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" ${size} role="img" aria-label="${k ? `Step ${k}` : 'Setup'}">${clipToView(vb, frameSVG(d, fr, { pathsFor: k, idPrefix: id, pos: cache.pos }), id)}</svg>`;
}

/* ---------- sending a file ---------- */

async function send(file, title) {
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title }); return 'shared'; }
  } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  const url = URL.createObjectURL(file);
  const a = el('a', { href: url, download: file.name, style: 'display:none' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}

/* ---------- the video ---------- */

/** The best format this browser can record: MP4 first (decided Nov 6), WebM otherwise. */
export function videoType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(t)) return { mime: t, ext: t.startsWith('video/mp4') ? 'mp4' : 'webm' };
  }
  return null;
}

/**
 * Record the drill playing once, 1280 × 720. Takes about as long as the video (Chrome records as it plays).
 * opts: { team, onProgress(0–1), signal, speed } (speed > 1 only in tests). → { file, ext }
 */
export async function makeVideo(d, { team = '', onProgress = () => {}, signal, speed = 1 } = {}) {
  const type = videoType();
  if (!type) throw new Error('This browser can’t make videos. Try Chrome on your phone or tablet.');
  const W = 1280, H = 720, TOP = 96, FOOT = 44;
  const canvas = el('canvas', { width: W, height: H });
  const ctx = canvas.getContext('2d');
  const tl = X.videoTimeline(d), cache = prepare(d);
  const [, , vw, vh] = viewBox(d.view && d.view.rink, d.view && d.view.flip).split(/\s+/).map(Number);
  const scale = Math.min((W - 64) / vw, (H - TOP - FOOT - 16) / vh), rw = vw * scale, rh = vh * scale;
  const rx = (W - rw) / 2, ry = TOP + (H - TOP - FOOT - rh) / 2;
  const font = (w, px) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const fit = (text, max) => { let s = text; while (ctx.measureText(s).width > max && s.length > 4) s = s.slice(0, -2); return s === text ? s : `${s.trim()}…`; };
  let lastKey = '', lastImg = null;
  const rinkImage = async (k, p) => {
    const key = `${k}:${p.toFixed(3)}`;
    if (key === lastKey) return lastImg;
    const fr = frame(d, k, p, cache);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vw ? viewBox(d.view && d.view.rink, d.view && d.view.flip) : ''}" width="${Math.round(rw)}" height="${Math.round(rh)}">${frameSVG(d, fr, { pathsFor: fr.k, idPrefix: 'v', pos: cache.pos })}</svg>`;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    lastKey = key; lastImg = img;
    return img;
  };
  const draw = async t => {
    const s = tl.at(t);
    ctx.fillStyle = '#0B1B31'; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';
    if (s.scene === 'title') {
      ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.font = font(700, 64);
      ctx.fillText(fit(d.title || 'Drill', W - 120), W / 2, H / 2 - 40);
      ctx.font = font(500, 32); ctx.fillStyle = '#c9d4e3';
      if (team) ctx.fillText(fit(team, W - 120), W / 2, H / 2 + 30);
      ctx.font = font(600, 24); ctx.fillStyle = '#F26A1B'; ctx.fillText(MADE, W / 2, H - 64);
      return;
    }
    const img = await rinkImage(s.k, s.p);
    ctx.drawImage(img, rx, ry, rw, rh);
    ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff'; ctx.font = font(700, 36);
    ctx.fillText(fit(X.captionOf(d, s.k), W - 360), 32, TOP / 2);
    ctx.textAlign = 'right'; ctx.font = font(500, 24); ctx.fillStyle = '#c9d4e3';
    ctx.fillText(fit(d.title || '', 300), W - 32, TOP / 2);
    ctx.font = font(500, 20); ctx.fillStyle = '#9fb0c6'; ctx.textAlign = 'center';
    ctx.fillText([team, MADE].filter(Boolean).join(' · '), W / 2, H - FOOT / 2);
  };

  await draw(0);
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise(res => { rec.onstop = res; });
  let lock = null;
  try { lock = await navigator.wakeLock.request('screen'); } catch {}
  let hidden = false;
  const onHide = () => { if (document.visibilityState === 'hidden') hidden = true; };
  document.addEventListener('visibilitychange', onHide);
  rec.start(250);
  const t0 = performance.now();
  try {
    for (;;) {
      if (signal && signal.aborted) throw Object.assign(new Error('Stopped.'), { name: 'AbortError' });
      if (hidden) throw new Error('Keep Practice Pilot on screen while the video is made. Try again?');
      const t = (performance.now() - t0) / 1000 * speed;
      if (t >= tl.total) break;
      await draw(t);
      onProgress(t / tl.total);
      await new Promise(r => requestAnimationFrame(r));
    }
    await draw(tl.total);
    await new Promise(r => setTimeout(r, 300));
  } finally {
    document.removeEventListener('visibilitychange', onHide);
    if (lock) lock.release().catch(() => {});
    if (rec.state !== 'inactive') rec.stop();
    stream.getTracks().forEach(tr => tr.stop());
  }
  await stopped;
  onProgress(1);
  const blob = new Blob(chunks, { type: type.mime.split(';')[0] });
  return { file: new File([blob], X.videoName(d, type.ext), { type: blob.type }), ext: type.ext, seconds: tl.total };
}

/* ---------- the dialog ---------- */

export async function openShareDrill(app, d) {
  const team = teamOf(app);
  const tl = X.videoTimeline(d);
  const type = videoType();
  const status = el('p', { class: 'status-line', id: 'sharedrill-status', role: 'status', 'aria-live': 'polite' });
  const bar = el('progress', { id: 'video-progress', max: '1', value: '0', hidden: true });
  const videoRow = el('div', { class: 'row', id: 'video-row' });
  let ctrl = null, video = null;

  const drawVideo = () => {
    if (video) {
      fill(videoRow,
        el('button', { type: 'button', class: 'btn primary', id: 'send-video', onclick: async () => { const r = await send(video.file, d.title); if (r === 'downloaded') toast(`Saved ${video.file.name}.`); } }, 'Send video'),
        el('button', { type: 'button', class: 'btn', id: 'download-video', onclick: () => { download(video.file.name, video.file, video.file.type); toast(`Saved ${video.file.name}.`); } }, 'Download'),
        el('span', { class: 'muted' }, `${Math.round(video.seconds)} s · ${(video.file.size / 1048576).toFixed(1)} MB · ${video.ext.toUpperCase()}`));
      return;
    }
    fill(videoRow, el('button', { type: 'button', class: 'btn primary', id: 'make-video', disabled: !type || !(d.steps || []).length, onclick: async () => {
      ctrl = new AbortController(); bar.hidden = false; bar.value = 0;
      fill(videoRow, el('button', { type: 'button', class: 'btn', id: 'cancel-video', onclick: () => ctrl.abort() }, 'Cancel'));
      status.textContent = 'Making the video. Keep Practice Pilot on screen…';
      try {
        video = await makeVideo(d, { team, signal: ctrl.signal, speed: app.videoSpeed || 1, onProgress: v => { bar.value = v; } });
        status.textContent = video.ext === 'mp4' ? 'Video ready.' : 'Video ready. This device saves it as WebM; most phones play it.';
      } catch (e) { status.textContent = e.name === 'AbortError' ? 'Stopped.' : e.message; }
      finally { bar.hidden = true; ctrl = null; drawVideo(); }
    } }, 'Make video'));
  };
  drawVideo();

  const body = el('div', { class: 'stack' },
    el('section', { class: 'stack' }, el('h3', { class: 't-label' }, 'Video'),
      el('p', { style: 'margin:0' }, !type ? 'This browser can’t make videos. Try Chrome on your phone or tablet.' : !(d.steps || []).length ? 'Add a step first: the video shows the drill playing.' : `The drill playing once, about ${Math.round(tl.total)} seconds. It takes about that long to make.`),
      videoRow, bar),
    el('section', { class: 'stack' }, el('h3', { class: 't-label' }, 'Drill sheet'),
      el('p', { style: 'margin:0' }, 'A page with the setup, a picture of each step, and the coaching points. Print it, or pick Save as PDF to send it.'),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', id: 'open-sheet', onclick: () => { if (ctrl) ctrl.abort(); const done = document.querySelector('#sharedrill-dialog .dfoot .btn'); if (done) done.click(); location.hash = `#drillsheet/${d.id}`; } }, 'Open the drill sheet'))),
    el('section', { class: 'stack' }, el('h3', { class: 't-label' }, 'Drill file'),
      el('p', { style: 'margin:0' }, 'For a coach on another team who has Practice Pilot: they import it into their Library as a draft.'),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', id: 'send-drill-file', onclick: async () => {
        const f = new File([JSON.stringify(X.makeDrillFile(d, { appVersion: APP_VERSION, team }))], X.drillFileName(d), { type: 'application/json' });
        const r = await send(f, d.title);
        if (r === 'downloaded') toast(`Saved ${f.name}.`);
      } }, 'Send drill file'))),
    status);
  await dialog({ id: 'sharedrill-dialog', title: `Share “${d.title}”`, body, buttons: [{ label: 'Done', value: null, kind: 'primary' }] });
  if (ctrl) ctrl.abort();
}

/* ---------- importing a drill file ---------- */

export function importDrill(app, after) {
  const input = el('input', { type: 'file', accept: `${X.DRILL_EXT},application/json,.json`, style: 'display:none' });
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    input.remove();
    if (!f) return;
    try {
      const rec = X.readDrillFile(await f.text(), { newId: () => newId('d') });
      if (app.thumbOf) rec.thumb = await app.thumbOf(rec);
      await app.store.save('drills', rec);
      toast(`Imported “${rec.title}”${app.cloudState && app.cloudState.libraryId ? ' as a draft' : ''}.`);
      if (after) after(rec);
    } catch (e) { toast(e.message, { error: true }); }
  });
  document.body.append(input);
  input.click();
}

/* ---------- the drill sheet ---------- */

export function renderDrillSheet(app, id) {
  const root = el('div', { class: 'pp-print-screen' }, el('p', { class: 'muted' }, 'Getting the drill sheet ready…'));
  (async () => {
    const d = await app.store.get('drills', id);
    if (!d) { fill(root, el('div', { class: 'card notice' }, el('p', {}, 'That drill isn’t here.'), el('a', { class: 'btn', href: '#library' }, 'Back to the Library'))); return; }
    const cache = prepare(d);
    const pic = (k, cls) => { const t = el('div', { class: cls }); t.innerHTML = stillSVG(d, k, cache); return t; };
    const list = (title, items) => (items.length ? el('section', { class: 'pp-print-sec' }, el('h4', {}, title), el('ol', {}, ...items.map(x => el('li', {}, x)))) : null);
    const team = teamOf(app);
    const meta = [d.minutes ? `${d.minutes} min` : '', (d.ageGroups || []).join(', '), d.level || '', team].filter(Boolean).join(' · ');
    const steps = (d.steps || []).map((s, i) => el('figure', { class: 'pp-ds-step' }, pic(i + 1, 'pp-ds-pic'), el('figcaption', {}, el('b', {}, `${i + 1}. `), X.captionOf(d, i + 1))));
    fill(root,
      el('div', { class: 'pp-printbar row' },
        el('a', { class: 'btn', href: `#library/${d.id}`, id: 'sheet-back' }, '‹ Back'),
        el('span', { class: 'grow muted', id: 'sheet-pages' }, `${steps.length > 6 ? 'Two pages' : 'One page'}. In the print screen, pick Save as PDF to keep or send it.`),
        el('button', { type: 'button', class: 'btn primary', id: 'print-sheet', onclick: () => print() }, 'Print')),
      el('div', { class: 'pp-printpage', id: 'drillsheet' },
        el('section', { class: 'pp-dsheet' },
          el('header', { class: 'pp-sheet-head' },
            el('div', {}, el('p', { class: 'pp-sheet-team' }, MADE), el('h2', {}, d.title)),
            meta ? el('p', { class: 'pp-sheet-when' }, meta) : null),
          d.description ? el('p', {}, el('b', {}, 'Purpose: '), d.description) : null,
          el('div', { class: 'pp-ds-setup' }, pic(0, 'pp-ds-setuppic'),
            el('div', { class: 'pp-ds-setuptext' }, el('h4', {}, 'Setup'),
              (d.setupNotes || []).filter(x => x.trim()).length ? el('ul', {}, ...(d.setupNotes || []).filter(x => x.trim()).map(x => el('li', {}, x))) : el('p', { class: 'muted' }, 'As shown.'))),
          steps.length ? el('div', { class: 'pp-ds-steps', id: 'sheet-steps' }, ...steps) : null,
          list('Coaching points', (d.coachingPoints || []).filter(x => x.trim())),
          d.goalieNotes ? el('p', {}, el('b', {}, 'Goalie: '), d.goalieNotes) : null)));
    document.title = `${d.title} · drill sheet · Practice Pilot`;
  })();
  return root;
}
