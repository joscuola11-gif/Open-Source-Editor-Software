// Inquadratura automatica (auto reframe): trova dove sta il soggetto, muove una «telecamera virtuale» con calma e produce i keyframe
// di scala e posizione che mostrano solo quella parte del video nel nuovo formato. Puro.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function lum(frame) {
  const n = frame.w * frame.h;
  const g = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) g[i] = 0.299 * frame.data[p] + 0.587 * frame.data[p + 1] + 0.114 * frame.data[p + 2];
  return g;
}

function blur3(src, w, h) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += src[yy * w + xx]; n++; }
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

const percentile = (arr, q) => {
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
};

/** Centroide pesato dei pixel sopra la soglia: {x, y (0..1), mass}. */
function centroid(map, w, h, thr) {
  let sx = 0;
  let sy = 0;
  let m = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = map[y * w + x] - thr;
      if (v > 0) {
        sx += v * (x + 0.5);
        sy += v * (y + 0.5);
        m += v;
      }
    }
  }
  return m > 0 ? { x: sx / m / w, y: sy / m / h, mass: m } : null;
}

/**
 * Dove sta il soggetto in ogni fotogramma (coordinate 0..1 del fotogramma). Usa il movimento (cosa cambia rispetto al fotogramma prima)
 * e, quando tutto è fermo, ciò che spicca per colore. Se non c'è nulla di evidente tiene l'ultima posizione.
 * @returns {Array<{t:number, x:number, y:number, strength:number}>}
 */
export function subjectCenters(frames) {
  const out = [];
  let prevL = null;
  let last = { x: 0.5, y: 0.5 };
  for (const f of frames) {
    const { w, h } = f;
    const L = lum(f);
    // salienza statica: distanza dal colore medio
    let mr = 0;
    let mg = 0;
    let mb = 0;
    const n = w * h;
    for (let i = 0, p = 0; i < n; i++, p += 4) { mr += f.data[p]; mg += f.data[p + 1]; mb += f.data[p + 2]; }
    mr /= n; mg /= n; mb /= n;
    const sal = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) sal[i] = Math.abs(f.data[p] - mr) + Math.abs(f.data[p + 1] - mg) + Math.abs(f.data[p + 2] - mb);
    const salB = blur3(sal, w, h);
    let center = null;
    let strength = 0;
    if (prevL) {
      const mot = new Float32Array(n);
      for (let i = 0; i < n; i++) mot[i] = Math.abs(L[i] - prevL[i]);
      const motB = blur3(mot, w, h);
      const noise = percentile(motB, 0.5);
      const thr = Math.max(8, noise * 4, percentile(motB, 0.92));
      center = centroid(motB, w, h, thr);
      if (center) strength = Math.min(1, center.mass / (n * 12));
    }
    if (!center) {
      // fermo: ciò che spicca per colore (solo se davvero distinto)
      const c = centroid(salB, w, h, Math.max(percentile(salB, 0.97) * 0.8, 40));
      if (c && !prevL) center = c;
    }
    if (center) last = { x: center.x, y: center.y };
    out.push({ t: f.t, x: last.x, y: last.y, strength });
    prevL = L;
  }
  return out;
}

/** Mediana mobile (finestra dispari): toglie i salti isolati. */
function medianFilter(xs, k = 5) {
  const r = Math.floor(k / 2);
  return xs.map((_, i) => {
    const w = xs.slice(Math.max(0, i - r), i + r + 1).sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)];
  });
}

/**
 * Una telecamera virtuale che segue il soggetto senza scatti: resta ferma finché il soggetto sta dentro la «zona morta» al centro
 * dell'inquadratura, poi si muove con velocità e accelerazione limitate.
 * @param {number[]} subject posizione del soggetto (0..1) per fotogramma
 * @param {{fps: number, visible: number, deadZone?: number, maxSpeed?: number, accel?: number}} o
 *   `visible` = quanta parte dell'asse si vede (0..1); `deadZone` = frazione della finestra dove il soggetto può muoversi senza muovere la camera;
 *   `maxSpeed` = larghezze del video al secondo; `accel` = larghezze/s²
 * @returns {number[]} centro della finestra (0..1) per fotogramma, sempre dentro il video
 */
export function planCamera(subject, { fps, visible, deadZone = 0.3, maxSpeed = 0.35, accel = 0.8 }) {
  if (!subject.length) return [];
  const lo = visible / 2;
  const hi = 1 - visible / 2;
  if (visible >= 1 - 1e-9) return subject.map(() => 0.5);
  const s = medianFilter(subject, 5);
  const dt = 1 / fps;
  const half = (visible * deadZone) / 2;
  let c = clamp(s[0], lo, hi);
  let v = 0;
  const out = [c];
  for (let i = 1; i < s.length; i++) {
    const d = s[i] - c;
    let want = 0;
    if (d > half) want = d - half;
    else if (d < -half) want = d + half;
    // velocità voluta: si recupera lo scarto in ~0,6 s, entro il limite
    let vt = clamp(want / 0.6, -maxSpeed, maxSpeed);
    const dv = clamp(vt - v, -accel * dt, accel * dt);
    v += dv;
    c = clamp(c + v * dt, lo, hi);
    if (c === lo || c === hi) v = 0;
    out.push(c);
  }
  return out;
}

/**
 * Keyframe di scala e posizione per mostrare, nel canvas `canvasAspect`, la finestra che segue `centers` di un video con proporzioni `srcAspect`.
 * Il video si ingrandisce quanto basta per riempire il canvas (`zoom` = ingrandimento in più) e si sposta per tenere il soggetto al centro.
 * @param {Array<{t:number, x:number, y:number}>} centers centri della finestra (0..1 nel video); `t` in secondi dall'inizio del clip
 * @returns {{scale:number, keyframes:{scale:Array, x:Array, y:Array}, visible:{x:number,y:number}}}
 */
export function reframeKeyframes(centers, { srcAspect, canvasAspect, zoom = 1, tolerance = 0.004 }) {
  // a scala 1 il video sta dentro il canvas («adatta»): larghezza e altezza rispetto al canvas
  const fitW = srcAspect >= canvasAspect ? 1 : srcAspect / canvasAspect;
  const fitH = srcAspect >= canvasAspect ? canvasAspect / srcAspect : 1;
  const cover = Math.max(1 / fitW, 1 / fitH);
  const scale = cover * Math.max(1, zoom);
  const dw = fitW * scale; // larghezza mostrata, in canvas
  const dh = fitH * scale;
  const vis = { x: Math.min(1, 1 / dw), y: Math.min(1, 1 / dh) };
  const pts = centers.map((c) => ({ t: c.t, x: -(clamp(c.x, vis.x / 2, 1 - vis.x / 2) - 0.5) * dw, y: -(clamp(c.y, vis.y / 2, 1 - vis.y / 2) - 0.5) * dh }));
  const kept = simplify(pts, tolerance);
  const mk = (key) => kept.map((p) => ({ t: p.t, v: p[key], e: 'linear' }));
  return {
    scale,
    keyframes: { scale: [{ t: 0, v: scale, e: 'linear' }], x: mk('x'), y: mk('y') },
    visible: vis,
  };
}

function simplify(points, tol) {
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
      const d = Math.max(Math.abs(points[i].x - (points[a].x + (points[b].x - points[a].x) * u)), Math.abs(points[i].y - (points[a].y + (points[b].y - points[a].y) * u)));
      if (d > wd) { wd = d; worst = i; }
    }
    if (wd > tol && worst > 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
