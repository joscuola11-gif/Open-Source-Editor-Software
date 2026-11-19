// Correzione colore automatica («Auto Adjust») e uniformità fra clip («Color Match»), senza intelligenza artificiale:
// si misurano luminosità, contrasto e dominante di colore su alcuni fotogrammi e si calcolano le regolazioni
// con gli strumenti che già esistono (curva, ruote colore, ombre/luci, saturazione). Pure.

import { CURVE_POINTS, applyGrade, curveTable, defaultGrade } from './grade.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * Misure su uno o più fotogrammi ({data: RGBA, w, h}).
 * @returns {{n:number, hist:Float64Array, q:(p:number)=>number, mean:number, std:number, mid:number[], chroma:number, clipLow:number, clipHigh:number}}
 */
export function analyze(frames) {
  const hist = new Float64Array(256);
  let n = 0;
  let sum = 0;
  let sum2 = 0;
  let mr = 0;
  let mg = 0;
  let mb = 0;
  let mn = 0;
  let chroma = 0;
  let lowN = 0;
  let highN = 0;
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const l = luma(r, g, b);
      hist[Math.min(255, Math.round(l * 255))]++;
      n++;
      sum += l;
      sum2 += l * l;
      chroma += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      if (l <= 0.012) lowN++;
      if (l >= 0.988) highN++;
      if (l >= 0.15 && l <= 0.85) {
        mr += r / 255;
        mg += g / 255;
        mb += b / 255;
        mn++;
      }
    }
  }
  const total = Math.max(1, n);
  const mean = sum / total;
  const q = (p) => {
    const target = clamp(p, 0, 1) * n;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i / 255;
    }
    return 1;
  };
  return {
    n,
    hist,
    q,
    mean,
    std: Math.sqrt(Math.max(0, sum2 / total - mean * mean)),
    mid: mn ? [mr / mn, mg / mn, mb / mn] : [mean, mean, mean],
    chroma: chroma / total,
    clipLow: lowN / total,
    clipHigh: highN / total,
  };
}

/** Quanto «vale» un valore di luminanza nella distribuzione (frazione di pixel più scuri). */
const cdfAt = (stats, x) => {
  const k = Math.round(clamp(x, 0, 1) * 255);
  let acc = 0;
  for (let i = 0; i <= k; i++) acc += stats.hist[i];
  return stats.n ? acc / stats.n : x;
};

/** Valori (0..100) della curva a 0, 25, 50, 75, 100 % per «livelli + gamma», mescolati con l'identità. */
export function levelsCurve(lo, hi, gamma, amount = 1) {
  const span = Math.max(0.05, hi - lo);
  return CURVE_POINTS.map((p) => {
    const x = p / 100;
    const y = 0.02 + 0.96 * clamp((x - lo) / span, 0, 1) ** gamma;
    return +lerp(p, y * 100, amount).toFixed(2);
  });
}

/**
 * I cinque punti della curva (0..100) che meglio approssimano `target` (256 valori 0..1: uscita desiderata per ogni ingresso),
 * dando più peso ai livelli dove ci sono davvero i pixel (`weights`, 256 valori). Discesa per coordinate, curva sempre crescente.
 */
export function fitCurve(target, weights, amount = 1) {
  const W = Float64Array.from(weights, (w) => w + 0.0005);
  const y = CURVE_POINTS.map((p) => clamp(target[Math.round((p / 100) * 255)], 0, 1) * 100);
  const err = (pts) => {
    const t = curveTable(pts);
    let e = 0;
    for (let i = 0; i < 256; i++) e += W[i] * (t[i] - target[i]) ** 2;
    return e;
  };
  let best = err(y);
  let step = 12;
  for (let it = 0; it < 80 && step > 0.05; it++) {
    let improved = false;
    for (let j = 0; j < y.length; j++) {
      for (const d of [step, -step]) {
        const cand = [...y];
        cand[j] = clamp(cand[j] + d, 0, 100);
        if (j > 0 && cand[j] < cand[j - 1]) cand[j] = cand[j - 1];
        if (j < y.length - 1 && cand[j] > cand[j + 1]) cand[j] = cand[j + 1];
        const e = err(cand);
        if (e < best - 1e-12) {
          best = e;
          y[j] = cand[j];
          improved = true;
        }
      }
    }
    if (!improved) step *= 0.6;
  }
  return y.map((v, i) => +lerp(CURVE_POINTS[i], v, amount).toFixed(2));
}

/** Peso di ogni livello di luminanza = quanti pixel ci sono (normalizzato a somma 1). */
const weightsOf = (stats) => Float64Array.from(stats.hist, (c) => (stats.n ? c / stats.n : 1 / 256));

/** Ruota «toni medi» che sposta il colore medio verso il grigio (o verso un bersaglio): offset RGB (somma zero) → {hue, amount}. */
export function wheelFor(offset, gain = 1) {
  const [dr, dg, db] = offset;
  const mag = Math.hypot(dr, dg, db);
  if (mag < 1e-4) return { hue: 0, amount: 0 };
  const hue = ((Math.atan2(Math.sqrt(3) * (dg - db), 2 * dr - dg - db) * 180) / Math.PI + 360) % 360;
  // direzione della ruota a quella tinta, come in grade.js (colore pieno meno la sua media)
  const x = hue / 60;
  const f = x - Math.floor(x);
  const q = 1 - f;
  const c = [[1, f, 0], [q, 1, 0], [0, 1, f], [0, q, 1], [f, 0, 1], [1, 0, q]][Math.floor(x) % 6];
  const m = (c[0] + c[1] + c[2]) / 3;
  const dirMag = Math.hypot(c[0] - m, c[1] - m, c[2] - m);
  return { hue: +hue.toFixed(1), amount: clamp((mag / (dirMag * 0.5 * gain)) * 100, 0, 100) };
}

/** La stessa spinta di colore sulle tre ruote (ombre, medi, luci): agisce su tutta la luminosità, circa 1,5 volte più forte della sola ruota dei medi. */
export const WB_GAIN = 1.5;
const gradeWith = (curve, wheel, extra = {}) => {
  const g = defaultGrade();
  g.curve = curve;
  const w = { hue: wheel.hue, amount: +wheel.amount.toFixed(1) };
  g.wheels.shadows = { ...w };
  g.wheels.mids = { ...w };
  g.wheels.highs = { ...w };
  return Object.assign(g, extra);
};

const copyFrames = (frames) => frames.map((f) => ({ ...f, data: new Uint8ClampedArray(f.data) }));
/** Come CSS `saturate()`: s = 1 invariato, 0 grigio, 2 doppio. */
function saturate(data, s) {
  if (s === 1) return;
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.213 * data[i] + 0.715 * data[i + 1] + 0.072 * data[i + 2];
    data[i] = clamp(l + (data[i] - l) * s, 0, 255);
    data[i + 1] = clamp(l + (data[i + 1] - l) * s, 0, 255);
    data[i + 2] = clamp(l + (data[i + 2] - l) * s, 0, 255);
  }
}
/** Fotogrammi dopo la correzione (curva, ruote…) e dopo la saturazione, nello stesso ordine in cui lo fa il programma. */
const applied = (frames, grade, sat = 0) => {
  const out = copyFrames(frames);
  for (const f of out) {
    applyGrade(f.data, f.w, f.h, grade);
    saturate(f.data, 1 + sat / 100);
  }
  return out;
};

/** Spostamento dei colori medi verso il grigio: offset da sommare a (r,g,b). */
const grayOffset = (mid, strength) => {
  const m = (mid[0] + mid[1] + mid[2]) / 3;
  return [(m - mid[0]) * strength, (m - mid[1]) * strength, (m - mid[2]) * strength];
};

/**
 * Correzione automatica: livelli, gamma, dominante di colore, ombre/luci tagliate e saturazione.
 * @param {Array<{data: Uint8ClampedArray, w: number, h: number}>} frames
 * @param {{amount?: number}} o amount 0..1 = quanta correzione applicare (1 = piena)
 * @returns {{grade: object, adjust: {saturation: number}, before: object, after: object}}
 */
export function autoAdjust(frames, { amount = 1 } = {}) {
  const k = clamp(amount, 0, 1);
  const before = analyze(frames);
  if (before.n < 16) return { grade: defaultGrade(), adjust: { saturation: 0 }, before, after: before };
  const lo0 = clamp(before.q(0.01), 0, 0.75);
  const hi0 = clamp(before.q(0.995), lo0 + 0.12, 1);
  // sotto-esposto: prima si schiarisce (esposizione), poi i livelli lavorano su un'immagine che occupa più punti della curva
  const exposure = hi0 < 0.7 ? Math.round(clamp(50 * Math.log2(clamp(0.85 / hi0, 1, 4)), 0, 100) * k) : 0;
  const gain = 2 ** (exposure / 50);
  const lo = Math.min(0.9, lo0 * gain);
  const hi = clamp(hi0 * gain, lo + 0.12, 1);
  const span = Math.max(0.12, hi - lo);
  const mNorm = clamp((Math.min(1, before.q(0.5) * gain) - lo) / span, 0.04, 0.96);
  const gamma = clamp(Math.log(0.47) / Math.log(mNorm), 0.55, 1.7);
  const target = Float64Array.from({ length: 256 }, (_, i) => 0.02 + 0.96 * clamp((i / 255 - lo) / span, 0, 1) ** gamma);
  const wts = Float64Array.from({ length: 256 }, (_, c) => {
    const orig = Math.round(c / gain);
    return orig <= 255 && before.n ? before.hist[orig] / before.n : 0;
  });
  const curve = fitCurve(target, wts, k);
  let wheel = { hue: 0, amount: 0 };
  let grade = gradeWith(curve, wheel, { exposure });
  // dominante di colore: si corregge guardando il risultato, in due passaggi
  for (let pass = 0; pass < 3; pass++) {
    const mid = analyze(applied(frames, grade)).mid;
    const gray = (mid[0] + mid[1] + mid[2]) / 3;
    const cast = Math.hypot(mid[0] - gray, mid[1] - gray, mid[2] - gray);
    if (cast < 0.012) break;
    // sommo la nuova correzione a quella già presente (in forma di offset)
    const prev = wheel.amount > 0 ? hueDir(wheel.hue).map((v) => v * (wheel.amount / 100) * 0.5 * WB_GAIN) : [0, 0, 0];
    const add = grayOffset(mid, 0.9 * k);
    wheel = wheelFor([prev[0] + add[0], prev[1] + add[1], prev[2] + add[2]], WB_GAIN);
    grade = gradeWith(curve, wheel, { exposure });
  }
  // ombre e luci tagliate
  const afterTone = analyze(applied(frames, grade));
  if (afterTone.clipLow > 0.06) grade.shadows = Math.round(clamp(afterTone.clipLow * 250, 0, 40) * k);
  else if (afterTone.q(0.01) > 0.08) grade.shadows = -Math.round(clamp((afterTone.q(0.01) - 0.03) * 400, 0, 60) * k); // neri non abbastanza neri
  if (afterTone.clipHigh > 0.06) grade.highlights = -Math.round(clamp(afterTone.clipHigh * 250, 0, 40) * k);
  const after = analyze(applied(frames, grade));
  const sat = after.chroma < 0.02 ? 0 : after.chroma < 0.1 ? clamp((0.14 / after.chroma - 1) * 100, 0, 40) : after.chroma > 0.42 ? clamp((0.36 / after.chroma - 1) * 100, -30, 0) : 0;
  return { grade, adjust: { saturation: Math.round(sat * k) }, before, after };
}

const hueDir = (hue) => {
  const x = (((hue % 360) + 360) % 360) / 60;
  const f = x - Math.floor(x);
  const q = 1 - f;
  const c = [[1, f, 0], [q, 1, 0], [0, 1, f], [0, q, 1], [f, 0, 1], [1, 0, q]][Math.floor(x) % 6];
  const m = (c[0] + c[1] + c[2]) / 3;
  return [c[0] - m, c[1] - m, c[2] - m];
};

/**
 * Uniforma i colori di un clip a quelli di un riferimento: stessa distribuzione di luminosità (5 punti della curva),
 * stessa dominante di colore e stessa vivacità.
 * @param {object[]} srcFrames fotogrammi del clip da correggere
 * @param {object} refStats analyze() dei fotogrammi del clip di riferimento
 */
export function matchColors(srcFrames, refStats, { amount = 1 } = {}) {
  const k = clamp(amount, 0, 1);
  const src = analyze(srcFrames);
  if (src.n < 16 || refStats.n < 16) return { grade: defaultGrade(), adjust: { saturation: 0 }, before: src, after: src };
  // uscita desiderata per ogni livello: il livello che ha la stessa «posizione» nella distribuzione del riferimento
  const target = Float64Array.from({ length: 256 }, (_, i) => refStats.q(cdfAt(src, i / 255)));
  const curve = fitCurve(target, weightsOf(src), k);
  // vivacità: si decide dopo la curva e prima della dominante, e la dominante viene corretta tenendone conto
  let grade = gradeWith(curve, { hue: 0, amount: 0 });
  const afterCurve = analyze(applied(srcFrames, grade));
  const sat = Math.round(clamp((refStats.chroma / Math.max(0.02, afterCurve.chroma) - 1) * 100, -40, 60) * k);
  let wheel = { hue: 0, amount: 0 };
  for (let pass = 0; pass < 4; pass++) {
    const mid = analyze(applied(srcFrames, grade, sat)).mid;
    const diff = [refStats.mid[0] - mid[0], refStats.mid[1] - mid[1], refStats.mid[2] - mid[2]];
    const mean = (diff[0] + diff[1] + diff[2]) / 3;
    const off = diff.map((v) => (v - mean) * 0.9 * k); // solo la parte «di colore», la luminosità l'ha già fatta la curva
    if (Math.hypot(...off) < 0.006) break;
    const prev = wheel.amount > 0 ? hueDir(wheel.hue).map((v) => v * (wheel.amount / 100) * 0.5 * WB_GAIN) : [0, 0, 0];
    wheel = wheelFor([prev[0] + off[0], prev[1] + off[1], prev[2] + off[2]], WB_GAIN);
    grade = gradeWith(curve, wheel);
  }
  const after = analyze(applied(srcFrames, grade, sat));
  return { grade, adjust: { saturation: sat }, before: src, after };
}
