// Rilevamento delle scene (tagli netti e dissolvenze) da fotogrammi piccoli campionati dal video. Puro.
// Ogni fotogramma: {t, w, h, data: Uint8ClampedArray RGBA}. Il punteggio fra due fotogrammi unisce la differenza degli istogrammi
// di colore (cambia l'aspetto generale) e quella di una griglia di luminanze (cambia la disposizione delle cose).

const BINS = 4; // 4×4×4 colori
const GRID_W = 16;
const GRID_H = 9;

/** Riassunto di un fotogramma: istogramma di colore normalizzato e griglia di luminanze (0..1). */
export function frameFeatures({ w, h, data }) {
  const hist = new Float32Array(BINS * BINS * BINS);
  const sum = new Float32Array(GRID_W * GRID_H);
  const cnt = new Float32Array(GRID_W * GRID_H);
  const n = w * h;
  for (let y = 0; y < h; y++) {
    const gy = Math.min(GRID_H - 1, Math.floor((y * GRID_H) / h));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      hist[((r * BINS) >> 8) * BINS * BINS + ((g * BINS) >> 8) * BINS + ((b * BINS) >> 8)] += 1;
      const gi = gy * GRID_W + Math.min(GRID_W - 1, Math.floor((x * GRID_W) / w));
      sum[gi] += (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      cnt[gi] += 1;
    }
  }
  for (let i = 0; i < hist.length; i++) hist[i] /= n;
  for (let i = 0; i < sum.length; i++) sum[i] /= cnt[i] || 1;
  return { hist, grid: sum };
}

/** Distanza fra due riassunti, da 0 (uguali) a 1 (completamente diversi). */
export function featureDistance(a, b) {
  let hd = 0;
  for (let i = 0; i < a.hist.length; i++) hd += Math.abs(a.hist[i] - b.hist[i]);
  hd /= 2;
  let gd = 0;
  for (let i = 0; i < a.grid.length; i++) gd += Math.abs(a.grid[i] - b.grid[i]);
  gd /= a.grid.length;
  return 0.5 * hd + 0.5 * Math.min(1, 4 * gd);
}

const median = (xs) => {
  const s = [...xs].sort((p, q) => p - q);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Punteggi di cambiamento fra fotogrammi vicini: scores[i] = differenza fra il fotogramma i−1 e il fotogramma i (scores[0] = 0). */
export function adjacentScores(frames, feats = frames.map(frameFeatures)) {
  const s = new Float32Array(frames.length);
  for (let i = 1; i < frames.length; i++) s[i] = featureDistance(feats[i - 1], feats[i]);
  return s;
}

/**
 * Trova le scene.
 * @param {Array<{t:number,w:number,h:number,data:Uint8ClampedArray}>} frames campionati a intervalli regolari
 * @param {{sensitivity?: number, minLength?: number, dissolves?: boolean}} o `sensitivity` 0..1 (più alto = più tagli)
 * @returns {Array<{t:number, score:number, kind:'cut'|'dissolve', before:number, after:number}>} `before`/`after`: indici dei fotogrammi
 */
export function detectScenes(frames, { sensitivity = 0.5, minLength = 0.8, dissolves = true } = {}) {
  if (frames.length < 3) return [];
  const feats = frames.map(frameFeatures);
  const scores = adjacentScores(frames, feats);
  const dt = (frames.at(-1).t - frames[0].t) / (frames.length - 1) || 0.25;
  const minAbs = 0.42 - 0.3 * sensitivity; // sensibilità 0.5 → 0.27
  const cuts = [];
  const radius = Math.max(3, Math.round(1.5 / dt));
  for (let i = 1; i < frames.length; i++) {
    const s = scores[i];
    if (s < minAbs) continue;
    // deve essere il massimo locale
    let isMax = true;
    for (let k = Math.max(1, i - 1); k <= Math.min(frames.length - 1, i + 1); k++) if (scores[k] > s) isMax = false;
    if (!isMax) continue;
    // un taglio è un picco isolato: se i fotogrammi accanto cambiano quasi altrettanto è una dissolvenza o una tendina
    if (Math.max(scores[i - 1] ?? 0, scores[i + 1] ?? 0) > 0.6 * s) continue;
    // e spiccare rispetto al «rumore» di movimento delle immagini vicine
    const around = [];
    for (let k = Math.max(1, i - radius); k <= Math.min(frames.length - 1, i + radius); k++) if (Math.abs(k - i) > 1) around.push(scores[k]);
    const base = median(around);
    const mad = median(around.map((v) => Math.abs(v - base)));
    if (s < base + Math.max(0.12, 5 * mad)) continue;
    cuts.push({ t: frames[i].t, score: s, kind: 'cut', before: i - 1, after: i });
  }
  if (dissolves) {
    // dissolvenza: il confronto a distanza (±k) è grande mentre ogni passo adiacente è piccolo
    const k = Math.max(2, Math.round(0.5 / dt));
    const hardAt = new Set(cuts.map((c) => c.after));
    const long = new Float32Array(frames.length);
    for (let i = k; i < frames.length - k; i++) {
      let nearCut = false;
      for (let j = i - k + 1; j <= i + k; j++) if (hardAt.has(j)) nearCut = true;
      if (nearCut) continue;
      long[i] = featureDistance(feats[i - k], feats[i + k]);
    }
    const thr = Math.max(0.3, 0.55 - 0.3 * sensitivity);
    for (let i = k; i < frames.length - k; i++) {
      if (long[i] < thr) continue;
      let isMax = true;
      for (let j = Math.max(k, i - k); j <= Math.min(frames.length - k - 1, i + k); j++) if (long[j] > long[i] || (long[j] === long[i] && j < i)) isMax = false;
      if (!isMax) continue;
      // un vero cambio graduale non ha salti bruschi fra fotogrammi vicini
      let maxStep = 0;
      for (let j = i - k + 1; j <= i + k; j++) maxStep = Math.max(maxStep, scores[j]);
      if (maxStep > long[i] * 0.75) continue;
      // e il prima e il dopo devono restare diversi per un po' (non un lampo)
      const bi = Math.max(0, i - 2 * k);
      const ai = Math.min(frames.length - 1, i + 2 * k);
      if (featureDistance(feats[bi], feats[ai]) < thr * 0.9) continue;
      cuts.push({ t: frames[i].t, score: long[i], kind: 'dissolve', before: i - k, after: i + k });
    }
  }
  cuts.sort((a, b) => a.t - b.t);
  // scene troppo corte: si tiene il taglio più forte
  const out = [];
  for (const c of cuts) {
    const last = out.at(-1);
    if (last && c.t - last.t < minLength) {
      if (c.score > last.score) out[out.length - 1] = c;
    } else out.push(c);
  }
  // la prima scena non può durare meno di minLength
  return out.filter((c) => c.t - frames[0].t >= minLength * 0.5 && frames.at(-1).t - c.t >= minLength * 0.5);
}

/** Fra i fotogrammi di una finestra fitta, l'istante del cambio più forte (per affinare un taglio trovato con campioni radi). */
export function bestBoundary(frames) {
  if (frames.length < 2) return null;
  const s = adjacentScores(frames);
  let best = 1;
  for (let i = 2; i < s.length; i++) if (s[i] > s[best]) best = i;
  return { t: frames[best].t, score: s[best], index: best };
}

/** Quanto «si muove» ogni fotogramma rispetto al precedente (0..1): serve a trovare i momenti più vivaci. */
export function motionSeries(frames) {
  const out = new Float32Array(frames.length);
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (a.w !== b.w || a.h !== b.h) continue;
    let d = 0;
    const n = a.w * a.h;
    for (let p = 0; p < n; p++) {
      const k = p * 4;
      d += Math.abs(a.data[k] - b.data[k]) + Math.abs(a.data[k + 1] - b.data[k + 1]) + Math.abs(a.data[k + 2] - b.data[k + 2]);
    }
    out[i] = d / (n * 3 * 255);
  }
  return out;
}
