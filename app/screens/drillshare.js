/* Share a drill (1.4.2): one dialog makes an MP4 video, opens the drill sheet (Print → Save as PDF), or saves a
   drill file another coach can import. Everything is made on the device; only sending needs a connection. */
import { el, fill, toast, dialog } from '../ui.js?v=1.5.2';
import { frame, prepare } from '../engine/model.js?v=1.5.2';
import { frameSVG, clipToView } from '../engine/render.js?v=1.5.2';
import { viewBoxOf } from '../engine/rink.js?v=1.5.2';
import { APP_VERSION } from '../version.js?v=1.5.2';
import { newId } from '../../vendor/bbl-kit/1.0.1/bbl-store.js';
import * as X from '../drillshare-core.js?v=1.5.2';
import { agesOf } from '../drills.js?v=1.5.2';
import { requestClub } from '../cloud/club.js?v=1.5.2';

const teamOf = app => (app.helper && app.helper.teamName) || (app.team && app.team.name) || '';
/** The team's logo and main colour for pictures and videos (not on a helper's phone). */
const lookOf = app => (!app.helper && app.team ? { logo: app.team.logo || null, mainColour: app.team.mainColour || null } : {});
const MADE = 'Made with Practice Pilot';
let uid = 0;

/** A still of a drill: the setup (k = 0, with every step's lines faint) or the end of step k with its paths. */
export function stillSVG(d, k, cache = prepare(d), size = '') {
  const fr = frame(d, k, k ? 1 : 0, cache);
  const vb = viewBoxOf(d.view);
  const id = `s${++uid}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" ${size} role="img" aria-label="${k ? `Step ${k}` : 'Setup'}">${clipToView(vb, frameSVG(d, fr, { pathsFor: k, idPrefix: id, pos: cache.pos }), id)}</svg>`;
}

/* ---------- sending files ---------- */

/** Send files in one go: the share sheet when the device has one, otherwise each is saved (downloaded). */
async function send(files, title) {
  try {
    if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files, title }); return 'shared'; }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
    if (e && e.name === 'NotAllowedError') return 'tap';         // too long since the tap: ask for another
  }
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const a = el('a', { href: url, download: file.name, style: 'display:none' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
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
export async function makeVideo(d, { team = '', look = {}, onProgress = () => {}, signal, speed = 1 } = {}) {
  const logoImg = look.logo ? await svgImage0(look.logo) : null;
  const type = videoType();
  if (!type) throw new Error('This browser can’t make videos. Try Chrome on your phone or tablet.');
  const W = 1280, H = 720, TOP = 96, FOOT = 44;
  const canvas = el('canvas', { width: W, height: H });
  const ctx = canvas.getContext('2d');
  const tl = X.videoTimeline(d), cache = prepare(d);
  const [, , vw, vh] = viewBoxOf(d.view).split(/\s+/).map(Number);
  const scale = Math.min((W - 64) / vw, (H - TOP - FOOT - 16) / vh), rw = vw * scale, rh = vh * scale;
  const rx = (W - rw) / 2, ry = TOP + (H - TOP - FOOT - rh) / 2;
  const font = (w, px) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const fit = (text, max) => { let s = text; while (ctx.measureText(s).width > max && s.length > 4) s = s.slice(0, -2); return s === text ? s : `${s.trim()}…`; };
  let lastKey = '', lastImg = null;
  const rinkImage = async (k, p) => {
    const key = `${k}:${p.toFixed(3)}`;
    if (key === lastKey) return lastImg;
    const fr = frame(d, k, p, cache);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vw ? viewBoxOf(d.view) : ''}" width="${Math.round(rw)}" height="${Math.round(rh)}">${frameSVG(d, fr, { pathsFor: fr.k, idPrefix: 'v', pos: cache.pos })}</svg>`;
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
      if (look.mainColour) { ctx.fillStyle = look.mainColour; ctx.fillRect(0, 0, W, 12); ctx.fillRect(0, H - 12, W, 12); }
      if (logoImg) { const s0 = 140, k = s0 / Math.max(logoImg.naturalWidth, logoImg.naturalHeight); ctx.fillStyle = '#ffffff'; ctx.fillRect(W / 2 - 80, 70, 160, 160); ctx.drawImage(logoImg, W / 2 - logoImg.naturalWidth * k / 2, 150 - logoImg.naturalHeight * k / 2, logoImg.naturalWidth * k, logoImg.naturalHeight * k); }
      ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.font = font(700, 64);
      ctx.fillText(fit(d.title || 'Drill', W - 120), W / 2, H / 2 - (logoImg ? 0 : 40) + (logoImg ? 40 : 0));
      ctx.font = font(500, 32); ctx.fillStyle = '#c9d4e3';
      if (team) ctx.fillText(fit(team, W - 120), W / 2, H / 2 + (logoImg ? 110 : 30));
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

/** A picture from a data URL, ready to draw. */
const svgImage0 = async src => { const img = new Image(); img.src = src; await img.decode(); return img; };

/* ---------- the drill sheet as a picture (1.4.3: sent with the video in one go) ---------- */

const svgImage = async (svg) => { const img = new Image(); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await img.decode(); return img; };

/** The drill sheet drawn as a PNG: title, purpose, setup, a picture of each step, coaching points. → File */
export async function makeSheetImage(d, { team = '', look = {} } = {}) {
  const W = 1275, M = 60, IW = W - 2 * M;
  const canvas = el('canvas', { width: W, height: 8000 });
  const ctx = canvas.getContext('2d');
  const font = (w, px) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const INK = '#1b2430', MUTED = '#5b6675';
  const wrap = (text, max) => {
    const out = []; let line = '';
    for (const word of String(text).split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width > max && line) { out.push(line); line = word; } else line = t;
    }
    if (line) out.push(line);
    return out;
  };
  const para = (text, x, y, max, px = 24, w = 400, col = INK, lh = 1.35) => {
    ctx.font = font(w, px); ctx.fillStyle = col; ctx.textBaseline = 'top';
    for (const l of wrap(text, max)) { ctx.fillText(l, x, y); y += px * lh; }
    return y;
  };
  const cache = prepare(d);
  const [, , vw, vh] = viewBoxOf(d.view).split(/\s+/).map(Number);
  const pic = async (k, w) => { const h = w * vh / vw; return { img: await svgImage(stillSVG(d, k, cache, `width="${Math.round(w)}" height="${Math.round(h)}"`)), h }; };

  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, canvas.height);
  let y = M;
  if (look.logo) { try { const lg = await svgImage0(look.logo), k = 110 / Math.max(lg.naturalWidth, lg.naturalHeight); ctx.drawImage(lg, W - M - lg.naturalWidth * k, M, lg.naturalWidth * k, lg.naturalHeight * k); } catch {} }
  if (look.mainColour) { ctx.fillStyle = look.mainColour; ctx.fillRect(0, 0, W, 14); }
  y = para(MADE, M, y, IW - (look.logo ? 130 : 0), 20, 700, '#F26A1B');
  y = para(d.title || 'Drill', M, y + 4, IW - (look.logo ? 130 : 0), 44, 800);
  const meta = [d.minutes ? `${d.minutes} min` : '', agesOf(d).join(', '), d.level || '', team].filter(Boolean).join(' · ');
  if (meta) y = para(meta, M, y + 2, IW, 22, 500, MUTED);
  ctx.fillStyle = '#d8dee6'; ctx.fillRect(M, y + 12, IW, 2); y += 30;
  if (d.description) y = para(`Purpose: ${d.description}`, M, y, IW, 24) + 12;

  // setup: picture on the left, notes on the right (a turned picture is tall, so it gets less width)
  const setupW = vh > vw ? IW * 0.42 : IW * 0.6;
  const sp = await pic(0, setupW);
  ctx.drawImage(sp.img, M, y, setupW, sp.h);
  let ty = para('Setup', M + setupW + 30, y, IW - setupW - 30, 26, 800);
  const notes = (d.setupNotes || []).filter(x => x.trim());
  for (const n of notes.length ? notes : ['As shown.']) ty = para(`• ${n}`, M + setupW + 30, ty + 4, IW - setupW - 30, 22) ;
  y = Math.max(y + sp.h, ty) + 30;

  // steps: two across (three when the picture is turned)
  const steps = d.steps || [];
  const cols = vh > vw ? 3 : 2, gap = 24, cw = (IW - gap * (cols - 1)) / cols;
  for (let i = 0; i < steps.length; i += cols) {
    let rowH = 0;
    for (let j = 0; j < cols && i + j < steps.length; j++) {
      const k = i + j + 1, x = M + j * (cw + gap);
      const p = await pic(k, cw);
      ctx.strokeStyle = '#d8dee6'; ctx.lineWidth = 2; ctx.strokeRect(x, y, cw, p.h);
      ctx.drawImage(p.img, x, y, cw, p.h);
      const end = para(`${k}. ${X.captionOf(d, k)}`, x, y + p.h + 8, cw, 21, 600);
      rowH = Math.max(rowH, end - y);
    }
    y += rowH + 24;
  }
  const points = (d.coachingPoints || []).filter(x => x.trim());
  if (points.length) {
    y = para('Coaching points', M, y, IW, 26, 800) + 4;
    points.forEach((p, i) => { y = para(`${i + 1}. ${p}`, M, y, IW, 22) + 4; });
    y += 12;
  }
  if (d.goalieNotes) y = para(`Goalie: ${d.goalieNotes}`, M, y, IW, 22) + 12;
  y = para([team, MADE].filter(Boolean).join(' · '), M, y + 10, IW, 18, 500, MUTED) + M;

  const out = el('canvas', { width: W, height: Math.ceil(y) });
  out.getContext('2d').drawImage(canvas, 0, 0);
  const blob = await new Promise(res => out.toBlob(res, 'image/png'));
  return new File([blob], X.drillFileName(d).replace(/\.[^.]+$/, '') + ' - sheet.png', { type: 'image/png' });
}

/* ---------- the dialog (1.4.3: tick what to send, one Make and send) ---------- */

export async function openShareDrill(app, d) {
  const team = teamOf(app);
  const tl = X.videoTimeline(d);
  const type = videoType();
  const canVideo = !!type && (d.steps || []).length > 0;
  const status = el('p', { class: 'status-line', id: 'sharedrill-status', role: 'status', 'aria-live': 'polite' });
  const bar = el('progress', { id: 'video-progress', max: '1', value: '0', hidden: true });
  const actions = el('div', { class: 'row', id: 'sharedrill-actions' });
  const choice = (id, title, words, checked, disabled = false) => el('label', { class: 'pp-sendpick' },
    el('input', { type: 'checkbox', id, checked: checked && !disabled, disabled, onchange: () => { made = null; draw(); } }),
    el('span', {}, el('b', {}, title), el('span', { class: 'muted' }, words)));
  const pickVideo = choice('pick-video', 'Video to watch', !type ? 'This browser can’t make videos. Try Chrome on your phone or tablet.' : !(d.steps || []).length ? 'Add a step first: the video shows the drill playing.' : `The drill playing once, about ${Math.round(tl.total)} seconds. It takes about that long to make.`, true, !canVideo);
  const pickSheet = choice('pick-sheet', 'Printable sheet', 'A picture of the page: the setup, each step and the coaching points.', true);
  const pickFile = choice('pick-file', 'File for another coach', 'For a coach on another team who has Practice Pilot: they import it into their Library.', false);
  // 1.5.1: ask Bench Boss Labs to add it to the club library (coaches on a team, not samples)
  const clubOk = !app.helper && !!(app.cloudState && app.cloudState.libraryId) && !d.sample && !d.template;
  const pickClub = clubOk ? choice('pick-club', 'Add to the club library', 'Asks Bench Boss Labs to add it, so every team can import it. It’s published first if it has to be.', false) : null;
  const on = l => !!l && l.querySelector('input').checked;
  let ctrl = null, made = null;

  const sendMade = async () => {
    const r = await send(made.files, d.title);
    if (r === 'tap') { status.textContent = 'Ready. Tap Send.'; return; }
    if (r === 'downloaded') toast(`Saved ${made.files.map(f => f.name).join(', ')}.`);
    if (r === 'shared') status.textContent = 'Sent.';
  };
  function draw() {
    if (made) {
      fill(actions, el('button', { type: 'button', class: 'btn primary', id: 'send-files', onclick: sendMade }, made.files.length === 1 ? 'Send' : `Send ${made.files.length} files`),
        el('span', { class: 'muted' }, made.words));
      return;
    }
    const n = [pickVideo, pickSheet, pickFile, pickClub].filter(on).length;
    fill(actions, el('button', { type: 'button', class: 'btn primary', id: 'make-send', disabled: !n, onclick: makeAndSend }, 'Make and send'));
  }
  async function makeAndSend() {
    const t0 = performance.now();
    const files = [], words = [];
    ctrl = new AbortController();
    fill(actions, el('button', { type: 'button', class: 'btn', id: 'cancel-video', onclick: () => ctrl.abort() }, 'Cancel'));
    try {
      if (on(pickVideo)) {
        bar.hidden = false; bar.value = 0;
        status.textContent = 'Making the video. Keep Practice Pilot on screen…';
        const v = await makeVideo(d, { team, look: lookOf(app), signal: ctrl.signal, speed: app.videoSpeed || 1, onProgress: x => { bar.value = x; } });
        files.push(v.file); words.push(`video ${Math.round(v.seconds)} s, ${(v.file.size / 1048576).toFixed(1)} MB${v.ext === 'mp4' ? '' : ' (WebM)'}`);
      }
      if (on(pickSheet)) { status.textContent = 'Making the sheet…'; files.push(await makeSheetImage(d, { team, look: lookOf(app) })); words.push('sheet picture'); }
      if (on(pickFile)) { files.push(new File([JSON.stringify(X.makeDrillFile(d, { appVersion: APP_VERSION, team }))], X.drillFileName(d), { type: 'application/json' })); words.push('drill file'); }
      if (on(pickClub)) {
        status.textContent = 'Asking for the club library…';
        if (await requestClub(app, d.id, { dialog })) { toast(`Asked Bench Boss Labs to add “${d.title}” to the club library.`); pickClub.querySelector('input').checked = false; }
      }
      made = files.length ? { files, words: `Ready: ${words.join(' + ')}.` } : null;
      status.textContent = files.length ? '' : 'Sent to Bench Boss Labs.';
    } catch (e) { status.textContent = e.name === 'AbortError' ? 'Stopped.' : e.message; made = null; }
    finally { bar.hidden = true; ctrl = null; draw(); }
    // straight to the share sheet when it was quick; after a video the device wants a fresh tap (Send)
    if (made && performance.now() - t0 < 3500) await sendMade();
  }
  draw();

  const body = el('div', { class: 'stack' },
    el('h3', { class: 't-label', style: 'margin:0' }, 'What do you want to send?'),
    el('div', { class: 'stack pp-sendpicks' }, pickVideo, pickSheet, pickFile, pickClub),
    actions, bar, status,
    el('p', { style: 'margin:0' }, el('a', { href: `#drillsheet/${d.id}`, id: 'print-sheet-link', onclick: () => { if (ctrl) ctrl.abort(); const done = document.querySelector('#sharedrill-dialog .dfoot .btn'); if (done) done.click(); } }, 'Print the sheet instead')));
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
    const meta = [d.minutes ? `${d.minutes} min` : '', agesOf(d).join(', '), d.level || '', team].filter(Boolean).join(' · ');
    const steps = (d.steps || []).map((s, i) => el('figure', { class: 'pp-ds-step' }, pic(i + 1, 'pp-ds-pic'), el('figcaption', {}, el('b', {}, `${i + 1}. `), X.captionOf(d, i + 1))));
    fill(root,
      el('div', { class: 'pp-printbar row' },
        el('a', { class: 'btn', href: `#library/${d.id}`, id: 'sheet-back' }, '‹ Back'),
        el('span', { class: 'grow muted', id: 'sheet-pages' }, `${steps.length > 6 ? 'Two pages' : 'One page'}. In the print screen, pick Save as PDF to keep or send it.`),
        el('button', { type: 'button', class: 'btn primary', id: 'print-sheet', onclick: () => print() }, 'Print')),
      el('div', { class: 'pp-printpage', id: 'drillsheet' },
        el('section', { class: 'pp-dsheet' },
          el('header', { class: 'pp-sheet-head' },
            el('div', { class: 'row', style: 'gap:10px;align-items:center' }, lookOf(app).logo ? el('img', { class: 'pp-print-logo', src: lookOf(app).logo, alt: '' }) : null,
              el('div', {}, el('p', { class: 'pp-sheet-team' }, MADE), el('h2', {}, d.title))),
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
