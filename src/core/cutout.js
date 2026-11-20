// Rimozione dello sfondo: rifinitura delle maschere (persona = 255, sfondo = 0) prodotte dal riconoscitore. Puro.
// Il riconoscitore dà una maschera morbida e un po' tremolante; qui si rendono i bordi netti ma non scalettati, si allarga o stringe
// il contorno, si sfumano i bordi e si calmano i salti da un fotogramma all'altro.

export const CUTOUT_DEFAULTS = { enabled: false, softness: 25, expand: 0 };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d, lo, hi) => (Number.isFinite(v) ? clamp(v, lo, hi) : d);

export function sanitizeCutout(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: c.enabled === true,
    softness: num(c.softness, CUTOUT_DEFAULTS.softness, 0, 100),
    expand: num(c.expand, CUTOUT_DEFAULTS.expand, -100, 100),
  };
}

const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Minimo (erosione) o massimo (dilatazione) in una finestra quadrata di raggio `r`, in due passate (orizzontale + verticale). */
function morph(src, w, h, r, grow) {
  if (r <= 0) return src;
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  const pick = grow ? Math.max : Math.min;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = grow ? 0 : 255;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) v = pick(v, src[y * w + k]);
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = grow ? 0 : 255;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) v = pick(v, tmp[k * w + x]);
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Sfocatura a scatola (due passate) con raggio `r`. */
function boxBlur(src, w, h, r) {
  if (r <= 0) return src;
  let cur = Float32Array.from(src);
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float32Array(cur.length);
    for (let y = 0; y < h; y++) {
      let acc = 0;
      let n = 0;
      for (let x = 0; x <= Math.min(w - 1, r); x++) { acc += cur[y * w + x]; n++; }
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / n;
        const add = x + r + 1;
        const sub = x - r;
        if (add < w) { acc += cur[y * w + add]; n++; }
        if (sub >= 0) { acc -= cur[y * w + sub]; n--; }
      }
    }
    const out = new Float32Array(cur.length);
    for (let x = 0; x < w; x++) {
      let acc = 0;
      let n = 0;
      for (let y = 0; y <= Math.min(h - 1, r); y++) { acc += tmp[y * w + x]; n++; }
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / n;
        const add = y + r + 1;
        const sub = y - r;
        if (add < h) { acc += tmp[add * w + x]; n++; }
        if (sub >= 0) { acc -= tmp[sub * w + x]; n--; }
      }
    }
    cur = out;
  }
  return Uint8Array.from(cur, (v) => Math.round(v));
}

/**
 * Rifinisce una maschera.
 * @param {Uint8Array|Uint8ClampedArray} mask w×h, 0..255
 * @param {{softness?: number, expand?: number}} o `softness` 0..100 (bordi più morbidi), `expand` −100..100 (negativo = stringe, positivo = allarga)
 * @returns {Uint8Array}
 */
export function refineMask(mask, w, h, { softness = CUTOUT_DEFAULTS.softness, expand = 0 } = {}) {
  // 1. più netta: il riconoscitore dà probabilità; fra 0,3 e 0,7 la curva le spinge verso 0 o 1
  let a = new Uint8Array(mask.length);
  for (let i = 0; i < a.length; i++) a[i] = Math.round(255 * smoothstep(0.3, 0.7, mask[i] / 255));
  // 2. allarga o stringe (fino a ~4% del lato lungo)
  const reach = Math.round((Math.abs(expand) / 100) * 0.04 * Math.max(w, h));
  if (reach > 0) a = morph(a, w, h, reach, expand > 0);
  // 3. bordi morbidi (fino a ~2,5% del lato lungo)
  const soft = Math.round((softness / 100) * 0.025 * Math.max(w, h));
  return boxBlur(a, w, h, soft);
}

/** Calma i salti fra fotogrammi: la maschera nuova pesa `k` (0..1), la precedente il resto. */
export function blendMasks(prev, cur, k = 0.6) {
  if (!prev || prev.length !== cur.length) return Uint8Array.from(cur);
  const out = new Uint8Array(cur.length);
  for (let i = 0; i < cur.length; i++) out[i] = Math.round(prev[i] * (1 - k) + cur[i] * k);
  return out;
}

/** Indice della maschera da usare al tempo `t` (secondi del file) per maschere calcolate ogni 1/`fps` secondi da `from`. */
export function maskIndex(t, from, fps, count) {
  if (!(count > 0)) return -1;
  return clamp(Math.round((t - from) * fps), 0, count - 1);
}

/** Quanta parte dell'immagine è «persona» (0..1): serve a dire all'utente che non ha trovato nessuno. */
export function coverage(mask) {
  let s = 0;
  for (let i = 0; i < mask.length; i++) s += mask[i];
  return s / (255 * mask.length);
}
