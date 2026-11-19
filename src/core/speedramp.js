// Curve di velocità (speed ramp): la velocità cambia durante il clip.
// La curva è un elenco di punti {t, s}: t = posizione nella parte di video usata (0..1), s = velocità (0,1×…8×).
// L'editor la realizza dividendo il clip in tanti pezzetti a velocità costante (vedi timeline.js · applySpeedRamp).

import { MAX_SPEED, MIN_SPEED } from './presets.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const RAMP_PRESETS = [
  { id: 'montage', label: 'Montaggio', points: [{ t: 0, s: 1 }, { t: 0.2, s: 3 }, { t: 0.45, s: 0.4 }, { t: 0.7, s: 3 }, { t: 1, s: 1 }] },
  { id: 'hero', label: 'Eroe', points: [{ t: 0, s: 1 }, { t: 0.3, s: 1 }, { t: 0.45, s: 0.3 }, { t: 0.65, s: 0.3 }, { t: 0.8, s: 2.5 }, { t: 1, s: 1 }] },
  { id: 'bullet', label: 'Proiettile', points: [{ t: 0, s: 2 }, { t: 0.35, s: 2 }, { t: 0.5, s: 0.15 }, { t: 0.65, s: 2 }, { t: 1, s: 2 }] },
  { id: 'jump', label: 'Scatto', points: [{ t: 0, s: 1 }, { t: 0.4, s: 1 }, { t: 0.5, s: 4 }, { t: 0.6, s: 1 }, { t: 1, s: 1 }] },
  { id: 'flash-in', label: 'Parte piano, poi accelera', points: [{ t: 0, s: 0.25 }, { t: 1, s: 3 }] },
  { id: 'flash-out', label: 'Parte veloce, poi rallenta', points: [{ t: 0, s: 3 }, { t: 1, s: 0.25 }] },
  { id: 'pulse', label: 'Pulsazioni', points: [{ t: 0, s: 1 }, { t: 0.125, s: 0.35 }, { t: 0.25, s: 2.5 }, { t: 0.375, s: 0.35 }, { t: 0.5, s: 2.5 }, { t: 0.625, s: 0.35 }, { t: 0.75, s: 2.5 }, { t: 0.875, s: 0.35 }, { t: 1, s: 1 }] },
];

/** Punti ordinati, dentro i limiti, con un punto a t=0 e uno a t=1. Lancia se non c'è nulla di usabile. */
export function normalizeCurve(points) {
  const pts = (Array.isArray(points) ? points : [])
    .filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.s))
    .map((p) => ({ t: clamp(p.t, 0, 1), s: clamp(p.s, MIN_SPEED, MAX_SPEED) }))
    .sort((a, b) => a.t - b.t);
  if (!pts.length) throw new Error('Curva vuota');
  if (pts[0].t > 0) pts.unshift({ t: 0, s: pts[0].s });
  if (pts.at(-1).t < 1) pts.push({ t: 1, s: pts.at(-1).s });
  return pts;
}

/** Velocità alla posizione u (0..1): interpolazione lineare fra i punti. */
export function speedAt(points, u) {
  const pts = normalizeCurve(points);
  const x = clamp(u, 0, 1);
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i].t) {
      const a = pts[i - 1];
      const b = pts[i];
      return b.t === a.t ? b.s : a.s + ((b.s - a.s) * (x - a.t)) / (b.t - a.t);
    }
  }
  return pts.at(-1).s;
}

/**
 * Divide la parte usata (`span` secondi di sorgente) in pezzi a velocità costante.
 * Ogni pezzo dura quanto serve per consumare la sua parte di sorgente alla velocità media (armonica) della curva,
 * così la durata totale è quella dell'integrale 1/velocità.
 * @param {number} fps serve a non creare pezzi più brevi di un fotogramma
 * @returns {Array<{u0:number,u1:number,src:number,speed:number,dur:number}>}
 */
export function rampSegments(points, span, { fps = 30, maxSegments = 48 } = {}) {
  const pts = normalizeCurve(points);
  const minDur = 1 / fps;
  const n = Math.floor(Math.min(maxSegments, span / 0.2, span / (MAX_SPEED * minDur * 1.05)));
  if (!(span > 0) || n < 2) throw new Error('Il clip è troppo corto per una curva di velocità');
  const out = [];
  const src = span / n;
  for (let i = 0; i < n; i++) {
    const u0 = i / n;
    const u1 = (i + 1) / n;
    let inv = 0;
    for (let k = 0; k < 8; k++) inv += 1 / speedAt(pts, u0 + ((k + 0.5) / 8) * (u1 - u0));
    const speed = clamp(1 / (inv / 8), MIN_SPEED, MAX_SPEED);
    out.push({ u0, u1, src, speed, dur: src / speed });
  }
  return out;
}

/** Durata totale dopo la curva. */
export const rampDuration = (segments) => segments.reduce((s, g) => s + g.dur, 0);

/** Tempo di uscita (dall'inizio del clip) corrispondente alla posizione di sorgente u (0..1). */
export function warpTime(segments, u) {
  const x = clamp(u, 0, 1);
  let acc = 0;
  for (const g of segments) {
    if (x <= g.u1 + 1e-12) return acc + ((x - g.u0) / (g.u1 - g.u0)) * g.dur;
    acc += g.dur;
  }
  return acc;
}
