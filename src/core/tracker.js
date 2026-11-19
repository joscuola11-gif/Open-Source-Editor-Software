// Inseguimento (motion tracking) di un punto: confronto di un riquadro (template) con zone vicine, fotogramma dopo fotogramma.
// Misura di somiglianza: correlazione normalizzata (ZNCC), che regge ai cambi di luce. Precisione sotto il pixel con una parabola.
// Puro: lavora su fotogrammi in grigio.

/** Da un fotogramma RGBA a luminanze (0..255). */
export function toGray({ w, h, data }) {
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  return { w, h, g };
}

/** Riquadro (2r+1)² centrato su (cx, cy) interi; fuori dai bordi → null. */
function patch(img, cx, cy, r) {
  if (cx - r < 0 || cy - r < 0 || cx + r >= img.w || cy + r >= img.h) return null;
  const n = 2 * r + 1;
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y * n + x] = img.g[(cy - r + y) * img.w + (cx - r + x)];
  return out;
}

function zscore(p) {
  let m = 0;
  for (let i = 0; i < p.length; i++) m += p[i];
  m /= p.length;
  let e = 0;
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) {
    out[i] = p[i] - m;
    e += out[i] * out[i];
  }
  return { z: out, norm: Math.sqrt(e) };
}

/** Somiglianza (−1..1) fra un template già normalizzato e il riquadro in (cx, cy). */
function zncc(img, cx, cy, r, tz, tnorm) {
  if (cx - r < 0 || cy - r < 0 || cx + r >= img.w || cy + r >= img.h) return -1;
  const n = 2 * r + 1;
  let m = 0;
  for (let y = 0; y < n; y++) {
    const row = (cy - r + y) * img.w + (cx - r);
    for (let x = 0; x < n; x++) m += img.g[row + x];
  }
  m /= n * n;
  let dot = 0;
  let e = 0;
  for (let y = 0; y < n; y++) {
    const row = (cy - r + y) * img.w + (cx - r);
    for (let x = 0; x < n; x++) {
      const v = img.g[row + x] - m;
      dot += v * tz[y * n + x];
      e += v * v;
    }
  }
  const den = tnorm * Math.sqrt(e);
  return den < 1e-6 ? 0 : dot / den;
}

/** Vertice di una parabola per tre punti equidistanti (scostamento −0.5..0.5). */
const vertex = (a, b, c) => {
  const d = a - 2 * b + c;
  return Math.abs(d) < 1e-9 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d));
};

/**
 * Insegue un punto lungo i fotogrammi.
 * @param {Array<{w:number,h:number,g:Float32Array}>} grays fotogrammi in grigio (stessa misura), nell'ordine in cui si insegue
 * @param {{x:number,y:number}} start posizione (in pixel) nel primo fotogramma
 * @param {{radius?: number, search?: number, minScore?: number, adapt?: number}} o
 *   `radius` = mezzo lato del riquadro; `search` = quanti pixel può muoversi fra due fotogrammi; `minScore` = somiglianza minima (`reacquire`: dopo
 *   averlo perso); `adapt` = quanto il
 *   riquadro si aggiorna con l'aspetto recente (0 = resta quello iniziale)
 * @returns {Array<{x:number,y:number,score:number,lost:boolean}>}
 */
export function trackPoint(grays, start, { radius = 7, search = 14, minScore = 0.6, reacquire = 0.8, adapt = 0.3 } = {}) {
  if (!grays.length) return [];
  const t0 = patch(grays[0], Math.round(start.x), Math.round(start.y), radius);
  if (!t0) throw new Error('Il punto scelto è troppo vicino al bordo del video.');
  const out = [{ x: start.x, y: start.y, score: 1, lost: false }];
  let recent = Float32Array.from(t0);
  let px = start.x;
  let py = start.y;
  let missed = 0;
  for (let f = 1; f < grays.length; f++) {
    const img = grays[f];
    const tpl = new Float32Array(t0.length);
    for (let i = 0; i < tpl.length; i++) tpl[i] = (1 - adapt) * t0[i] + adapt * recent[i];
    const { z, norm } = zscore(tpl);
    const range = Math.round(search * (1 + Math.min(3, missed) * 0.7));
    const cx0 = Math.round(px);
    const cy0 = Math.round(py);
    let best = -2;
    let bx = cx0;
    let by = cy0;
    const surf = new Map();
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        const s = zncc(img, cx0 + dx, cy0 + dy, radius, z, norm);
        surf.set(`${dx},${dy}`, s);
        // a parità di somiglianza si preferisce il più vicino alla posizione precedente
        if (s > best + 1e-6 || (Math.abs(s - best) <= 1e-6 && Math.hypot(dx, dy) < Math.hypot(bx - cx0, by - cy0))) {
          best = s;
          bx = cx0 + dx;
          by = cy0 + dy;
        }
      }
    }
    // dopo averlo perso lo si «ritrova» solo con una somiglianza molto alta (altrimenti si inseguono falsi riscontri)
    if (best < (missed > 0 ? Math.max(minScore, reacquire) : minScore)) {
      missed++;
      out.push({ x: px, y: py, score: best, lost: true });
      continue;
    }
    missed = 0;
    const sx = vertex(surf.get(`${bx - 1 - cx0},${by - cy0}`) ?? best, best, surf.get(`${bx + 1 - cx0},${by - cy0}`) ?? best);
    const sy = vertex(surf.get(`${bx - cx0},${by - 1 - cy0}`) ?? best, best, surf.get(`${bx - cx0},${by + 1 - cy0}`) ?? best);
    px = bx + sx;
    py = by + sy;
    out.push({ x: px, y: py, score: best, lost: false });
    if (best > 0.75) {
      const p = patch(img, bx, by, radius);
      if (p) recent = p;
    }
  }
  return out;
}

/** Semplifica un percorso [{t, x, y}] (Douglas-Peucker): tiene solo i punti che servono a restare entro `tol`. */
export function simplifyPath(points, tol = 0.002) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1;
    let wd = 0;
    for (let i = a + 1; i < b; i++) {
      const u = (points[i].t - points[a].t) / Math.max(1e-9, points[b].t - points[a].t);
      const ex = points[a].x + (points[b].x - points[a].x) * u;
      const ey = points[a].y + (points[b].y - points[a].y) * u;
      const d = Math.max(Math.abs(points[i].x - ex), Math.abs(points[i].y - ey));
      if (d > wd) {
        wd = d;
        worst = i;
      }
    }
    if (wd > tol && worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
