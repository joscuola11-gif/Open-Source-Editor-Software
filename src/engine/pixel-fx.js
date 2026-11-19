// Elaborazioni sui pixel (RGBA, Uint8ClampedArray). Funzioni pure: nessun accesso al DOM.

/** PRNG deterministico: la stessa sequenza per lo stesso seed (esportazione = anteprima). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (e0, e1, x) => {
  if (x <= e0) return 0;
  if (x >= e1) return 1;
  const t = (x - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
};

const cb = (r, g, b) => 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
const cr = (r, g, b) => 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

/**
 * Chroma key nello spazio colore YCbCr (indipendente dalla luminosità).
 * similarity 0..1: quanto è larga la zona resa trasparente; smoothness 0..1: sfumatura del bordo;
 * spill 0..1: recupero del colore di riflesso sui pixel semitrasparenti.
 */
export function chromaKey(data, [kr, kg, kb], { similarity = 0.4, smoothness = 0.1, spill = 0.6 } = {}) {
  const kCb = cb(kr, kg, kb);
  const kCr = cr(kr, kg, kb);
  const t0 = similarity * 0.5;
  const t1 = t0 + Math.max(0.001, smoothness * 0.35);
  const dom = kg >= kr && kg >= kb ? 1 : kb >= kr && kb >= kg ? 2 : 0; // canale dominante del colore chiave
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const d = Math.hypot(cb(r, g, b) - kCb, cr(r, g, b) - kCr) / 255;
    const a = smooth(t0, t1, d);
    data[i + 3] = Math.round(data[i + 3] * a);
    if (a > 0 && a < 1 && spill > 0) {
      const o1 = data[i + ((dom + 1) % 3)];
      const o2 = data[i + ((dom + 2) % 3)];
      const limit = (o1 + o2) / 2;
      const cur = data[i + dom];
      if (cur > limit) data[i + dom] = Math.round(cur - (cur - limit) * spill * (1 - a));
    }
  }
  return data;
}

/** Sposta i canali rosso e blu in direzioni opposte di `shift` pixel (aberrazione cromatica). */
export function rgbSplit(src, dst, w, h, shift) {
  const s = Math.max(0, Math.round(shift));
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = row + x * 4;
      const xr = Math.max(0, x - s);
      const xb = Math.min(w - 1, x + s);
      dst[i] = src[row + xr * 4];
      dst[i + 1] = src[i + 1];
      dst[i + 2] = src[row + xb * 4 + 2];
      dst[i + 3] = src[i + 3];
    }
  }
  return dst;
}

/** Riempie `data` con rumore in scala di grigi (tessera per la grana pellicola). */
export function fillNoise(data, seed = 1) {
  const rnd = mulberry32(seed);
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.floor(rnd() * 256);
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return data;
}

/** Spostamenti orizzontali di fasce: [{y, h, dx}] deterministici per `seed`. */
export function glitchSlices(h, amount, seed) {
  const rnd = mulberry32(seed);
  const n = 2 + Math.floor((amount / 100) * 8);
  const out = [];
  // il glitch è intermittente: ~55% dei fotogrammi sono "sporchi"
  if (rnd() > 0.55) return out;
  for (let i = 0; i < n; i++) {
    const sh = Math.max(2, Math.floor(rnd() * h * 0.12));
    out.push({ y: Math.floor(rnd() * (h - sh)), h: sh, dx: Math.round((rnd() - 0.5) * 0.2 * (0.3 + amount / 100)) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fallback software dei filtri colore (browser senza CanvasRenderingContext2D.filter)
// Stesse formule dei filtri CSS (Filter Effects Module): il risultato coincide con ctx.filter.
// ---------------------------------------------------------------------------

export const IDENTITY_PARAMS = { brightness: 1, contrast: 1, saturate: 1, sepia: 0, grayscale: 0, hue: 0, invert: 0, blur: 0 };

const mul3 = (a, b) => {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
};

/** Costruisce {m: 3x3, o: offset} che applica i filtri nell'ordine sepia, grayscale, invert, hue, saturate, contrast, brightness. */
export function filterMatrix(f) {
  let m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let o = [0, 0, 0];
  const apply = (mat, off = [0, 0, 0]) => {
    // nuovo = mat * (m * x + o) + off
    const nm = mul3(mat, m);
    const no = [0, 1, 2].map((i) => mat[i * 3] * o[0] + mat[i * 3 + 1] * o[1] + mat[i * 3 + 2] * o[2] + off[i]);
    m = nm;
    o = no;
  };
  if (f.sepia > 0) {
    const s = 1 - Math.min(1, f.sepia);
    apply([0.393 + 0.607 * s, 0.769 - 0.769 * s, 0.189 - 0.189 * s, 0.349 - 0.349 * s, 0.686 + 0.314 * s, 0.168 - 0.168 * s, 0.272 - 0.272 * s, 0.534 - 0.534 * s, 0.131 + 0.869 * s]);
  }
  if (f.grayscale > 0) {
    const g = 1 - Math.min(1, f.grayscale);
    apply([0.2126 + 0.7874 * g, 0.7152 - 0.7152 * g, 0.0722 - 0.0722 * g, 0.2126 - 0.2126 * g, 0.7152 + 0.2848 * g, 0.0722 - 0.0722 * g, 0.2126 - 0.2126 * g, 0.7152 - 0.7152 * g, 0.0722 + 0.9278 * g]);
  }
  if (f.invert > 0) {
    const i = Math.min(1, f.invert);
    apply([1 - 2 * i, 0, 0, 0, 1 - 2 * i, 0, 0, 0, 1 - 2 * i], [i, i, i]);
  }
  if (f.hue) {
    const a = (f.hue * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    apply([
      0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
      0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
      0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
    ]);
  }
  if (f.saturate !== 1) {
    const s = f.saturate;
    apply([0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]);
  }
  if (f.contrast !== 1) apply([f.contrast, 0, 0, 0, f.contrast, 0, 0, 0, f.contrast], Array(3).fill(0.5 * (1 - f.contrast)));
  if (f.brightness !== 1) apply([f.brightness, 0, 0, 0, f.brightness, 0, 0, 0, f.brightness]);
  return { m, o };
}

export function applyFilterParams(data, f) {
  const { m, o } = filterMatrix(f);
  const o0 = o[0] * 255;
  const o1 = o[1] * 255;
  const o2 = o[2] * 255;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    data[i] = m[0] * r + m[1] * g + m[2] * b + o0;
    data[i + 1] = m[3] * r + m[4] * g + m[5] * b + o1;
    data[i + 2] = m[6] * r + m[7] * g + m[8] * b + o2;
  }
  return data;
}

/** Stringa per ctx.filter / CSS (solo i filtri non neutri). */
export function filterCss(f, blurPx = f.blur ?? 0) {
  const parts = [];
  if (f.sepia > 0) parts.push(`sepia(${Math.min(1, f.sepia).toFixed(3)})`);
  if (f.grayscale > 0) parts.push(`grayscale(${Math.min(1, f.grayscale).toFixed(3)})`);
  if (f.invert > 0) parts.push(`invert(${Math.min(1, f.invert).toFixed(3)})`);
  if (f.hue) parts.push(`hue-rotate(${f.hue.toFixed(2)}deg)`);
  if (f.saturate !== 1) parts.push(`saturate(${Math.max(0, f.saturate).toFixed(3)})`);
  if (f.contrast !== 1) parts.push(`contrast(${Math.max(0, f.contrast).toFixed(3)})`);
  if (f.brightness !== 1) parts.push(`brightness(${Math.max(0, f.brightness).toFixed(3)})`);
  if (blurPx > 0.05) parts.push(`blur(${blurPx.toFixed(2)}px)`);
  return parts.join(' ');
}

export const isIdentityParams = (f) =>
  f.brightness === 1 && f.contrast === 1 && f.saturate === 1 && !f.sepia && !f.grayscale && !f.hue && !f.invert;

// ---------------------------------------------------------------------------
// Effetti artistici e di distorsione (funzioni pure su RGBA). Quelli con `src`→`dst` non modificano l'ingresso.
// ---------------------------------------------------------------------------

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const lumaOf = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

/** Campiona `src` in (x, y) con interpolazione bilineare (bordi ripetuti) e scrive RGBA in `out[0..3]`. */
export function sampleBilinear(src, w, h, x, y, out) {
  const fx = Math.min(w - 1, Math.max(0, x));
  const fy = Math.min(h - 1, Math.max(0, y));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  for (let c = 0; c < 4; c++) {
    const a = src[(y0 * w + x0) * 4 + c] * (1 - tx) + src[(y0 * w + x1) * 4 + c] * tx;
    const b = src[(y1 * w + x0) * 4 + c] * (1 - tx) + src[(y1 * w + x1) * 4 + c] * tx;
    out[c] = a * (1 - ty) + b * ty;
  }
  return out;
}

/** Riduce i colori a `levels` valori per canale (2..16): effetto «poster». */
export function posterize(data, levels = 4) {
  const L = Math.max(2, Math.min(16, Math.round(levels)));
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] = Math.round((Math.round((data[i + c] / 255) * (L - 1)) / (L - 1)) * 255);
  }
  return data;
}

/** Due colori: i neri diventano `dark`, i bianchi `light`. `mix` 0..1 = quanto dell'originale lasciare. */
export function duotone(data, dark, light, mix = 1) {
  for (let i = 0; i < data.length; i += 4) {
    const l = lumaOf(data, i) / 255;
    for (let c = 0; c < 3; c++) {
      const v = dark[c] + (light[c] - dark[c]) * l;
      data[i + c] = clamp255(data[i + c] * (1 - mix) + v * mix);
    }
  }
  return data;
}

/** Intensità dei bordi (Sobel sulla luminanza), 0..~1442, in un array w×h. */
export function edgeMap(src, w, h) {
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = lumaOf(src, i * 4);
  const at = (x, y) => L[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const e = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      e[y * w + x] = Math.hypot(gx, gy);
    }
  }
  return e;
}

/** Cartone animato: colori a macchie piatte e contorni scuri. amount 0..100. */
export function cartoon(src, dst, w, h, amount = 50) {
  const k = Math.max(0, Math.min(100, amount)) / 100;
  const levels = Math.round(7 - k * 4); // 7 … 3 livelli per canale
  const edges = edgeMap(src, w, h);
  const thr = 150 - k * 70;
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const l = lumaOf(src, i);
    const boost = 1.25;
    for (let c = 0; c < 3; c++) {
      const v = clamp255(l + (src[i + c] - l) * boost);
      dst[i + c] = Math.round((Math.round((v / 255) * (levels - 1)) / (levels - 1)) * 255);
    }
    const line = Math.max(0, Math.min(1, (edges[p] - thr) / 80));
    if (line > 0) for (let c = 0; c < 3; c++) dst[i + c] = Math.round(dst[i + c] * (1 - line * 0.92));
    dst[i + 3] = src[i + 3];
  }
  return dst;
}

/** Disegno a matita: tratti scuri su carta bianca. amount 0..100 = forza del tratto. */
export function sketch(src, dst, w, h, amount = 60) {
  const edges = edgeMap(src, w, h);
  const gain = 0.5 + (amount / 100) * 2.5;
  for (let p = 0; p < w * h; p++) {
    const v = clamp255(255 - edges[p] * gain * 0.6);
    const i = p * 4;
    dst[i] = dst[i + 1] = dst[i + 2] = v;
    dst[i + 3] = src[i + 3];
  }
  return dst;
}

/** Onda orizzontale: ogni riga è spostata di `amp` pixel con andamento sinusoidale (`freq` onde sull'altezza). */
export function wave(src, dst, w, h, amp, freq = 3, phase = 0) {
  const o = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    const dx = amp * Math.sin((y / Math.max(1, h)) * freq * Math.PI * 2 + phase);
    for (let x = 0; x < w; x++) {
      sampleBilinear(src, w, h, x + dx, y, o);
      const i = (y * w + x) * 4;
      dst[i] = o[0];
      dst[i + 1] = o[1];
      dst[i + 2] = o[2];
      dst[i + 3] = o[3];
    }
  }
  return dst;
}

/** Vortice al centro: nel raggio `radius` (frazione del lato corto) i punti ruotano di `strength` radianti al massimo. */
export function swirl(src, dst, w, h, strength, radius = 0.5) {
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const R = Math.max(1, radius * Math.min(w, h));
  const o = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      let sx = x;
      let sy = y;
      if (r < R) {
        const a = strength * (1 - r / R) ** 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        sx = cx + dx * c - dy * s;
        sy = cy + dx * s + dy * c;
      }
      sampleBilinear(src, w, h, sx, sy, o);
      const i = (y * w + x) * 4;
      dst[i] = o[0];
      dst[i + 1] = o[1];
      dst[i + 2] = o[2];
      dst[i + 3] = o[3];
    }
  }
  return dst;
}

/** Lente: `strength` > 0 ingrandisce il centro (rigonfia), < 0 lo rimpicciolisce (pizzica). */
export function bulge(src, dst, w, h, strength, radius = 0.6) {
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const R = Math.max(1, radius * Math.min(w, h));
  const o = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      let f = 1;
      if (r < R) f = 1 - strength * (1 - (r / R) ** 2);
      sampleBilinear(src, w, h, cx + dx * f, cy + dy * f, o);
      const i = (y * w + x) * 4;
      dst[i] = o[0];
      dst[i + 1] = o[1];
      dst[i + 2] = o[2];
      dst[i + 3] = o[3];
    }
  }
  return dst;
}

/** Sfocatura a zoom: ogni punto è la media dei punti lungo la linea verso il centro. strength 0..1. */
export function zoomBlur(src, dst, w, h, strength) {
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const N = 8;
  const o = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < N; k++) {
        const f = 1 - (strength * 0.25 * k) / (N - 1);
        sampleBilinear(src, w, h, cx + (x - cx) * f, cy + (y - cy) * f, o);
        r += o[0];
        g += o[1];
        b += o[2];
        a += o[3];
      }
      const i = (y * w + x) * 4;
      dst[i] = r / N;
      dst[i + 1] = g / N;
      dst[i + 2] = b / N;
      dst[i + 3] = a / N;
    }
  }
  return dst;
}

/** Retino tipografico: puntini del colore medio della cella, più grandi dove l'immagine è più chiara, su fondo scuro. */
export function halftone(src, dst, w, h, cell = 6) {
  const C = Math.max(2, Math.round(cell));
  dst.fill(0);
  for (let i = 3; i < dst.length; i += 4) dst[i] = 255;
  for (let cy = 0; cy < h; cy += C) {
    for (let cx = 0; cx < w; cx += C) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = cy; y < Math.min(h, cy + C); y++) {
        for (let x = cx; x < Math.min(w, cx + C); x++) {
          const i = (y * w + x) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          n++;
        }
      }
      r /= n;
      g /= n;
      b /= n;
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const rad = Math.sqrt(l) * C * 0.72;
      const mx = cx + (C - 1) / 2;
      const my = cy + (C - 1) / 2;
      for (let y = cy; y < Math.min(h, cy + C); y++) {
        for (let x = cx; x < Math.min(w, cx + C); x++) {
          const d = Math.hypot(x - mx, y - my);
          if (d <= rad) {
            const i = (y * w + x) * 4;
            dst[i] = r;
            dst[i + 1] = g;
            dst[i + 2] = b;
          }
        }
      }
    }
  }
  return dst;
}

/** Linee dello schermo a tubo catodico: le righe dispari si scuriscono (strength 0..1) e un lieve riflesso colora le colonne. */
export function scanlines(data, w, h, strength = 0.5, step = 2) {
  const s = Math.max(1, Math.round(step));
  for (let y = 0; y < h; y++) {
    const dark = Math.floor(y / s) % 2 === 1 ? 1 - strength * 0.55 : 1;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const col = x % 3;
      for (let c = 0; c < 3; c++) {
        const mask = c === col ? 1 : 1 - strength * 0.12;
        data[i + c] = clamp255(data[i + c] * dark * mask);
      }
    }
  }
  return data;
}
