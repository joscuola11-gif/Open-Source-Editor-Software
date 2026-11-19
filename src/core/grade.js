// Correzione colore avanzata: esposizione, ombre/alte luci, ruote colore, curva, HSL per tinta, LUT 3D (.cube), nitidezza.
// Tutto qui è puro (nessun DOM): lavora su RGBA a 8 bit (Uint8ClampedArray) e si prova con test unitari.

import { clamp, isNum } from './util.js';

export const HSL_BANDS = [
  { id: 'red', label: 'Rossi', hue: 0 },
  { id: 'yellow', label: 'Gialli', hue: 60 },
  { id: 'green', label: 'Verdi', hue: 120 },
  { id: 'cyan', label: 'Azzurri', hue: 180 },
  { id: 'blue', label: 'Blu', hue: 240 },
  { id: 'magenta', label: 'Magenta', hue: 300 },
];
export const WHEELS = [
  { id: 'shadows', label: 'Ombre' },
  { id: 'mids', label: 'Toni medi' },
  { id: 'highs', label: 'Luci' },
];
export const CURVE_POINTS = [0, 25, 50, 75, 100];
export const MAX_LUT_SIZE = 33;

export function defaultGrade() {
  return {
    exposure: 0,
    highlights: 0,
    shadows: 0,
    sharpen: 0,
    wheels: Object.fromEntries(WHEELS.map((w) => [w.id, { hue: 0, amount: 0 }])),
    hsl: Object.fromEntries(HSL_BANDS.map((b) => [b.id, { h: 0, s: 0, l: 0 }])),
    curve: [...CURVE_POINTS],
    lut: { id: null, intensity: 100 },
  };
}

const num = (v, d, lo, hi) => (isNum(v) ? clamp(v, lo, hi) : d);

/** Riporta un grade qualunque (file vecchi, dati rovinati) a un grade valido. */
export function sanitizeGrade(raw) {
  const g = defaultGrade();
  if (!raw || typeof raw !== 'object') return g;
  g.exposure = num(raw.exposure, 0, -100, 100);
  g.highlights = num(raw.highlights, 0, -100, 100);
  g.shadows = num(raw.shadows, 0, -100, 100);
  g.sharpen = num(raw.sharpen, 0, 0, 100);
  for (const w of WHEELS) {
    const r = raw.wheels?.[w.id];
    g.wheels[w.id] = { hue: num(r?.hue, 0, 0, 360), amount: num(r?.amount, 0, 0, 100) };
  }
  for (const b of HSL_BANDS) {
    const r = raw.hsl?.[b.id];
    g.hsl[b.id] = { h: num(r?.h, 0, -100, 100), s: num(r?.s, 0, -100, 100), l: num(r?.l, 0, -100, 100) };
  }
  if (Array.isArray(raw.curve) && raw.curve.length === CURVE_POINTS.length) g.curve = raw.curve.map((v, i) => num(v, CURVE_POINTS[i], 0, 100));
  g.lut = { id: typeof raw.lut?.id === 'string' && raw.lut.id ? raw.lut.id : null, intensity: num(raw.lut?.intensity, 100, 0, 100) };
  return g;
}

export function curveIsIdentity(c) {
  return c.every((v, i) => Math.abs(v - CURVE_POINTS[i]) < 0.01);
}

export function gradeIsIdentity(g) {
  if (!g) return true;
  if (g.exposure || g.highlights || g.shadows || g.sharpen) return false;
  if (!curveIsIdentity(g.curve)) return false;
  if (g.lut?.id && g.lut.intensity > 0) return false;
  for (const w of WHEELS) if (g.wheels[w.id].amount > 0) return false;
  for (const b of HSL_BANDS) {
    const r = g.hsl[b.id];
    if (r.h || r.s || r.l) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Curva: interpolazione cubica monotona (non «supera» mai i punti: niente inversioni di luminosità)
// ---------------------------------------------------------------------------

/** Tabella di 256 valori 0..1 della curva che passa per i punti (a 0, 25, 50, 75, 100 % dell'ingresso). */
export function curveTable(points) {
  const xs = CURVE_POINTS.map((p) => p / 100);
  const ys = points.map((v) => clamp(v, 0, 100) / 100);
  const n = xs.length;
  const d = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  // Fritsch–Carlson: limita le pendenze per conservare la monotonia
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  const out = new Float32Array(256);
  for (let k = 0; k < 256; k++) {
    const x = k / 255;
    let i = Math.min(n - 2, Math.floor(x / 0.25));
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    out[k] = clamp((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1], 0, 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// LUT 3D (.cube)
// ---------------------------------------------------------------------------

/**
 * Legge un file .cube (Adobe/Resolve). Le LUT 3D con lato maggiore di 33 sono ridotte a 33.
 * @returns {{name: string, size: number, data: Uint8ClampedArray}} data = lato³ × 3 byte, rosso che varia più in fretta
 */
export function parseCube(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Il file è vuoto.');
  let size = 0;
  let name = '';
  let dmin = [0, 0, 0];
  let dmax = [1, 1, 1];
  const vals = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [key, ...rest] = line.split(/\s+/);
    if (key === 'TITLE') name = line.slice(5).trim().replace(/^"|"$/g, '');
    else if (key === 'LUT_1D_SIZE') throw new Error('Le LUT a una dimensione (1D) non sono supportate: serve una LUT 3D.');
    else if (key === 'LUT_3D_SIZE') size = Number(rest[0]);
    else if (key === 'DOMAIN_MIN') dmin = rest.slice(0, 3).map(Number);
    else if (key === 'DOMAIN_MAX') dmax = rest.slice(0, 3).map(Number);
    else if (/^[-+.\d]/.test(key)) {
      const v = [key, ...rest].slice(0, 3).map(Number);
      if (v.length < 3 || v.some((x) => !Number.isFinite(x))) throw new Error('Una riga della LUT non è valida.');
      vals.push(v);
    }
  }
  if (!Number.isInteger(size) || size < 2) throw new Error('Manca la dimensione della LUT (LUT_3D_SIZE).');
  if (size > 256) throw new Error('La LUT è troppo grande.');
  if (vals.length !== size ** 3) throw new Error(`La LUT dovrebbe avere ${size ** 3} righe ma ne ha ${vals.length}.`);
  if (dmin.length < 3 || dmax.length < 3 || dmin.some((x) => !Number.isFinite(x)) || dmax.some((x, i) => !Number.isFinite(x) || x <= dmin[i])) throw new Error('Il dominio della LUT non è valido.');
  const out = Math.min(size, MAX_LUT_SIZE);
  const data = new Uint8ClampedArray(out ** 3 * 3);
  const src = (k) => Math.round((k * (size - 1)) / (out - 1));
  let o = 0;
  for (let b = 0; b < out; b++) {
    for (let g = 0; g < out; g++) {
      for (let r = 0; r < out; r++) {
        const v = vals[src(r) + src(g) * size + src(b) * size * size];
        for (let c = 0; c < 3; c++) data[o++] = Math.round(clamp((v[c] - dmin[c]) / (dmax[c] - dmin[c]), 0, 1) * 255);
      }
    }
  }
  return { name: name || 'LUT', size: out, data };
}

export function encodeLut(lut) {
  let s = '';
  for (let i = 0; i < lut.data.length; i += 8192) s += String.fromCharCode(...lut.data.subarray(i, i + 8192));
  return { name: lut.name, size: lut.size, data: btoa(s) };
}

export function decodeLut(entry) {
  if (!entry || !Number.isInteger(entry.size) || entry.size < 2 || entry.size > MAX_LUT_SIZE || typeof entry.data !== 'string') return null;
  try {
    const bin = atob(entry.data);
    if (bin.length !== entry.size ** 3 * 3) return null;
    const data = new Uint8ClampedArray(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    return { name: String(entry.name ?? 'LUT'), size: entry.size, data };
  } catch {
    return null;
  }
}

/** Ripulisce `project.luts` letto da un file. */
export function sanitizeLuts(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, e] of Object.entries(raw)) if (decodeLut(e)) out[id] = { name: String(e.name ?? 'LUT').slice(0, 80), size: e.size, data: e.data };
  return out;
}

// ---------------------------------------------------------------------------
// Applicazione ai pixel
// ---------------------------------------------------------------------------

const hueRgb = (h) => {
  const x = ((h % 360) + 360) % 360 / 60;
  const f = x - Math.floor(x);
  const q = 1 - f;
  switch (Math.floor(x) % 6) {
    case 0: return [1, f, 0];
    case 1: return [q, 1, 0];
    case 2: return [0, 1, f];
    case 3: return [0, q, 1];
    case 4: return [f, 0, 1];
    default: return [1, 0, q];
  }
};

function rgb2hsl(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d < 1e-6) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (mx === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

function hsl2rgb(h, s, l) {
  if (s < 1e-6) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const hh = (((h % 360) + 360) % 360) / 360;
  return [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)];
}

/** Campiona la LUT con interpolazione trilineare. r, g, b in 0..1. Scrive in `out`. */
function lutSample(lut, r, g, b, out) {
  const n = lut.size - 1;
  const fr = clamp(r, 0, 1) * n;
  const fg = clamp(g, 0, 1) * n;
  const fb = clamp(b, 0, 1) * n;
  const r0 = Math.min(n - 1, Math.floor(fr));
  const g0 = Math.min(n - 1, Math.floor(fg));
  const b0 = Math.min(n - 1, Math.floor(fb));
  const tr = fr - r0;
  const tg = fg - g0;
  const tb = fb - b0;
  const s = lut.size;
  const d = lut.data;
  for (let c = 0; c < 3; c++) {
    const at = (ri, gi, bi) => d[((bi * s + gi) * s + ri) * 3 + c];
    const c00 = at(r0, g0, b0) * (1 - tr) + at(r0 + 1, g0, b0) * tr;
    const c10 = at(r0, g0 + 1, b0) * (1 - tr) + at(r0 + 1, g0 + 1, b0) * tr;
    const c01 = at(r0, g0, b0 + 1) * (1 - tr) + at(r0 + 1, g0, b0 + 1) * tr;
    const c11 = at(r0, g0 + 1, b0 + 1) * (1 - tr) + at(r0 + 1, g0 + 1, b0 + 1) * tr;
    out[c] = (((c00 * (1 - tg) + c10 * tg) * (1 - tb) + (c01 * (1 - tg) + c11 * tg) * tb)) / 255;
  }
}

/** Distanza circolare fra due tinte (gradi, 0..180). */
const hueDist = (a, b) => {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
};

/**
 * Applica la correzione ai pixel (RGBA, modifica `data` e lo restituisce). L'alfa non cambia.
 * @param lut LUT già decodificata (decodeLut) se `g.lut.id` è impostato
 */
export function applyGrade(data, w, h, g, lut = null) {
  if (gradeIsIdentity(g)) return data;
  const useTone = g.exposure !== 0 || !curveIsIdentity(g.curve);
  let tone = null;
  if (useTone) {
    const curve = curveTable(g.curve);
    const gain = 2 ** (g.exposure / 50);
    tone = new Float32Array(256);
    for (let i = 0; i < 256; i++) tone[i] = curve[Math.min(255, Math.round(clamp((i / 255) * gain, 0, 1) * 255))];
  }
  const sh = g.shadows / 100;
  const hi = g.highlights / 100;
  const useSH = sh !== 0 || hi !== 0;
  const wheels = WHEELS.map((wh) => {
    const v = g.wheels[wh.id];
    if (v.amount <= 0) return null;
    const c = hueRgb(v.hue);
    const mean = (c[0] + c[1] + c[2]) / 3;
    return { dir: [c[0] - mean, c[1] - mean, c[2] - mean], k: (v.amount / 100) * 0.5 };
  });
  const useWheels = wheels.some(Boolean);
  const hslOn = HSL_BANDS.some((b) => g.hsl[b.id].h || g.hsl[b.id].s || g.hsl[b.id].l);
  const useLut = !!(g.lut?.id && g.lut.intensity > 0 && lut);
  const mix = useLut ? g.lut.intensity / 100 : 0;
  const tmp = [0, 0, 0];

  for (let i = 0; i < data.length; i += 4) {
    let r;
    let gg;
    let b;
    if (tone) {
      r = tone[data[i]];
      gg = tone[data[i + 1]];
      b = tone[data[i + 2]];
    } else {
      r = data[i] / 255;
      gg = data[i + 1] / 255;
      b = data[i + 2] / 255;
    }
    if (useSH || useWheels) {
      const lum = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      const wS = (1 - lum) * (1 - lum);
      const wH = lum * lum;
      let off = 0;
      if (useSH) off = 0.35 * (sh * wS + hi * wH);
      let dr = off;
      let dg = off;
      let db = off;
      if (useWheels) {
        const ws = [wS, 4 * lum * (1 - lum), wH];
        for (let k = 0; k < 3; k++) {
          const wl = wheels[k];
          if (!wl) continue;
          const f = wl.k * ws[k];
          dr += wl.dir[0] * f;
          dg += wl.dir[1] * f;
          db += wl.dir[2] * f;
        }
      }
      r = clamp(r + dr, 0, 1);
      gg = clamp(gg + dg, 0, 1);
      b = clamp(b + db, 0, 1);
    }
    if (hslOn) {
      const [hh, ss, ll] = rgb2hsl(r, gg, b);
      if (ss > 0.02) {
        let dh = 0;
        let ms = 1;
        let dl = 0;
        for (const band of HSL_BANDS) {
          const wt = Math.max(0, 1 - hueDist(hh, band.hue) / 60);
          if (wt <= 0) continue;
          const v = g.hsl[band.id];
          dh += wt * v.h * 0.3;
          ms += (wt * v.s) / 100;
          dl += (wt * v.l) / 500;
        }
        [r, gg, b] = hsl2rgb(hh + dh, clamp(ss * Math.max(0, ms), 0, 1), clamp(ll + dl, 0, 1));
      }
    }
    if (useLut) {
      lutSample(lut, r, gg, b, tmp);
      r += (tmp[0] - r) * mix;
      gg += (tmp[1] - gg) * mix;
      b += (tmp[2] - b) * mix;
    }
    data[i] = Math.round(r * 255);
    data[i + 1] = Math.round(gg * 255);
    data[i + 2] = Math.round(b * 255);
  }

  if (g.sharpen > 0 && w >= 3 && h >= 3) sharpen(data, w, h, g.sharpen / 100);
  return data;
}

/** Maschera di nitidezza 3×3: «c + k · laplaciano». I bordi dell'immagine non cambiano. */
export function sharpen(data, w, h, amount) {
  const k = amount * 0.6;
  const src = new Uint8ClampedArray(data);
  const row = w * 4;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * row + x * 4;
      for (let c = 0; c < 3; c++) {
        const v = src[i + c];
        data[i + c] = v + k * (4 * v - src[i + c - 4] - src[i + c + 4] - src[i + c - row] - src[i + c + row]);
      }
    }
  }
  return data;
}
