// Rimozione delle pause: trova i tratti silenziosi dall'inviluppo dell'audio (picchi 0..255) e li toglie dal progetto.

import { cutRange, minDur, clipEnd } from './timeline.js';
import { findClip } from './project.js';
import { EditError, clamp } from './util.js';

export const SILENCE_DEFAULTS = { threshold: 0.06, minSilence: 0.6, keep: 0.12 };

/**
 * @param peaks Uint8Array|number[] valori 0..255 (uno ogni 1/rate secondi)
 * @returns {{start: number, end: number}[]} tratti di sorgente (secondi), già accorciati di `keep` per lato
 */
export function findSilences(peaks, rate, { from = 0, to = Infinity, threshold = SILENCE_DEFAULTS.threshold, minSilence = SILENCE_DEFAULTS.minSilence, keep = SILENCE_DEFAULTS.keep } = {}) {
  if (!peaks?.length || !(rate > 0)) return [];
  const thr = clamp(threshold, 0.001, 0.9) * 255;
  const min = Math.max(0.1, minSilence);
  const k = Math.max(0, keep);
  const a = Math.max(0, Math.floor(from * rate));
  const b = Math.min(peaks.length, Math.ceil(Math.min(to, peaks.length / rate) * rate));
  const out = [];
  let runStart = -1;
  const close = (endIdx) => {
    if (runStart < 0) return;
    const s = runStart / rate;
    const e = endIdx / rate;
    runStart = -1;
    if (e - s < min) return;
    const ss = s + k;
    const ee = e - k;
    if (ee - ss >= 0.05) out.push({ start: ss, end: ee });
  };
  for (let i = a; i < b; i++) {
    if (peaks[i] < thr) {
      if (runStart < 0) runStart = i;
    } else close(i);
  }
  close(b);
  return out;
}

/** Tratti in tempo di timeline per un clip, già limitati al clip e senza quelli più brevi di un fotogramma. */
export function timelineRanges(p, clip, silences) {
  const md = minDur(p);
  const out = [];
  for (const s of silences) {
    const a = Math.max(clip.start, clip.start + (s.start - clip.in) / clip.speed);
    const b = Math.min(clipEnd(clip), clip.start + (s.end - clip.in) / clip.speed);
    if (b - a >= md * 1.5) out.push({ start: a, end: b });
  }
  return out;
}

/**
 * Toglie le pause dal clip (e, se `trackIds` è nullo, da tutte le tracce per restare sincronizzati).
 * Procede dal fondo verso l'inizio così i tempi dei tratti già calcolati restano validi.
 * @returns {{cuts: number, removed: number}}
 */
export function removeSilences(p, clipId, silences, { trackIds = null } = {}) {
  const f = findClip(p, clipId);
  if (!f) throw new EditError('Clip non trovato');
  const ranges = timelineRanges(p, f.clip, silences);
  if (!ranges.length) throw new EditError('Non ho trovato pause da togliere');
  let removed = 0;
  for (const r of ranges.sort((x, y) => y.start - x.start)) {
    cutRange(p, r.start, r.end, { trackIds });
    removed += r.end - r.start;
  }
  return { cuts: ranges.length, removed };
}
