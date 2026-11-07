/* Practice Pilot 1.4.2 — Share a drill: the pure parts (tested in Node). The drill file, the video's timeline,
   and the link a QR code on the plan printout opens. */
import { validateRecord } from './schema.js?v=1.4.2';
import { stepAt, totalSeconds } from './engine/model.js?v=1.4.2';
const stepsOf = d => d.steps || [];

export const DRILL_FORMAT = 'practice-pilot-drill';
export const DRILL_FILE_VERSION = 1;
export const DRILL_EXT = '.practicepilot';
const clone = o => JSON.parse(JSON.stringify(o));
const safeName = s => String(s || 'Drill').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 80) || 'Drill';
export const drillFileName = d => `${safeName(d.title)}${DRILL_EXT}`;
export const videoName = (d, ext) => `${safeName(d.title)}.${ext}`;

/** The drill as a file another coach can import: no picture, no sync state, not a sample. */
export function makeDrillFile(d, { appVersion, at = new Date().toISOString(), team = '' } = {}) {
  const drill = clone(d);
  for (const f of ['thumb', 'pub', 'publishedAt', 'publishedBy', 'publishId']) delete drill[f];
  drill.sample = false; drill.template = false; drill.deletedAt = null;
  return { format: DRILL_FORMAT, formatVersion: DRILL_FILE_VERSION, appVersion, exportedAt: at, fromTeam: team, drill };
}

/** Read a drill file. → a new drill record for this library (a copy with its own id), or throws with words. */
export function readDrillFile(text, { newId, now = new Date().toISOString(), by = 'this device' }) {
  let doc;
  try { doc = JSON.parse(text); } catch { throw new Error('That file isn’t a Practice Pilot drill.'); }
  if (!doc || doc.format !== DRILL_FORMAT || !doc.drill) throw new Error('That file isn’t a Practice Pilot drill.');
  if (!Number.isInteger(doc.formatVersion) || doc.formatVersion > DRILL_FILE_VERSION) throw new Error('Update Practice Pilot to import this drill: it was saved by a newer version.');
  const d = clone(doc.drill);
  const bad = validateRecord('drills', d);
  if (bad.length) throw new Error(`That drill file is damaged (${bad.slice(0, 3).join(', ')}).`);
  for (const f of ['thumb', 'pub']) delete d[f];
  return { ...d, sourceDrillId: d.id, id: newId(), sample: false, template: false, deletedAt: null, createdAt: now, updatedAt: now, updatedBy: by };
}

/* ---------- the video's timeline ---------- */

export const TITLE_SECONDS = 2, HOLD_SECONDS = 2;
/**
 * The video, start to end: a title card, the setup held, the drill playing at normal speed, the last step held.
 * → { total, at(t) } where at(t) = { scene: 'title' } or { scene: 'drill', k, p, t: drill time }.
 */
export function videoTimeline(d) {
  const steps = stepsOf(d);
  const play = totalSeconds(d);
  const total = TITLE_SECONDS + HOLD_SECONDS + play + HOLD_SECONDS;
  return {
    total, play,
    at(t) {
      if (t < TITLE_SECONDS) return { scene: 'title' };
      if (t < TITLE_SECONDS + HOLD_SECONDS || !steps.length) return { scene: 'drill', k: 0, p: 0, t: 0 };
      const dt = Math.min(play, t - TITLE_SECONDS - HOLD_SECONDS);
      if (dt >= play) return { scene: 'drill', k: steps.length, p: 1, t: play };
      const { k, p } = stepAt(d, dt);
      return { scene: 'drill', k, p, t: dt };
    },
  };
}
/** The caption shown with a frame. */
export function captionOf(d, k) {
  if (!k) return 'Setup';
  const s = stepsOf(d)[k - 1];
  return (s && s.caption) || `Step ${k}`;
}

/* ---------- QR codes on the plan printout ---------- */

/** The address a drill card's QR code opens: the drill playing, for the team's coaches and helpers. */
export const qrTarget = (base, planId, drillId) => `${base}#drill/${planId}/${drillId}`;
