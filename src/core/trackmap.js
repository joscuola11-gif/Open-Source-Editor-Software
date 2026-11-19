// Passaggi di coordinate per l'inseguimento: dal punto toccato nell'anteprima al punto del video, e da quello alla posizione di un testo
// o adesivo che lo deve seguire. Puro.

import { simplifyPath } from './tracker.js';

const rot = (x, y, deg) => {
  const r = (deg * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
};
const NO_CROP = { l: 0, t: 0, r: 0, b: 0 };

/**
 * Da un punto del canvas (pixel) al punto del fotogramma originale (0..1 su tutta l'immagine, ritaglio compreso).
 * `geom` = {cx, cy, w, h, rotation} del contenuto mostrato (come lo dà `Renderer.geometry`).
 */
export function canvasToSource(geom, px, py, { crop = NO_CROP, flipX = false, flipY = false } = {}) {
  const [lx, ly] = rot(px - geom.cx, py - geom.cy, -geom.rotation);
  let nx = lx / geom.w;
  let ny = ly / geom.h;
  if (flipX) nx = -nx;
  if (flipY) ny = -ny;
  return { u: crop.l + (nx + 0.5) * (1 - crop.l - crop.r), v: crop.t + (ny + 0.5) * (1 - crop.t - crop.b) };
}

/** L'inverso di `canvasToSource`. */
export function sourceToCanvas(geom, u, v, { crop = NO_CROP, flipX = false, flipY = false } = {}) {
  let nx = (u - crop.l) / (1 - crop.l - crop.r) - 0.5;
  let ny = (v - crop.t) / (1 - crop.t - crop.b) - 0.5;
  if (flipX) nx = -nx;
  if (flipY) ny = -ny;
  const [dx, dy] = rot(nx * geom.w, ny * geom.h, geom.rotation);
  return { x: geom.cx + dx, y: geom.cy + dy };
}

/**
 * Keyframe di posizione (x, y in frazioni del canvas, come le usa il clip) perché un elemento segua un punto che si muove.
 * @param {Array<{t:number, x:number, y:number}>} points posizione del punto nel canvas (pixel) a ogni istante `t` (secondi dall'inizio del clip che segue)
 * @param {{W:number, H:number, anchor?: number, base: {x:number, y:number}, tolerance?: number}} o
 *   `anchor` = indice del punto in cui l'elemento ha posizione `base` (la distanza iniziale dal punto si mantiene)
 */
export function followKeyframes(points, { W, H, anchor = 0, base, tolerance = 0.002 }) {
  if (!points.length) return { x: [], y: [] };
  const a = points[Math.min(points.length - 1, Math.max(0, anchor))];
  const offX = base.x - (a.x - W / 2) / W;
  const offY = base.y - (a.y - H / 2) / H;
  const path = points.map((p) => ({ t: p.t, x: (p.x - W / 2) / W + offX, y: (p.y - H / 2) / H + offY }));
  const kept = simplifyPath(path, tolerance);
  return { x: kept.map((p) => ({ t: p.t, v: p.x, e: 'linear' })), y: kept.map((p) => ({ t: p.t, v: p.y, e: 'linear' })) };
}
