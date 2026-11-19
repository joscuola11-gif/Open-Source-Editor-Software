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
