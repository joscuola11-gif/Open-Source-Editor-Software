// Utility di base senza dipendenze dal DOM: usabili sia nel browser sia in Node (test).

/** Tolleranza temporale (0,1 ms) per i confronti fra istanti di tempo. */
export const TOL = 1e-4;
export const EPS = 1e-9;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const round6 = (v) => Math.round(v * 1e6) / 1e6;

/** Arrotonda un tempo al fotogramma più vicino. */
export const quantize = (t, fps) => Math.round(t * fps) / fps;

export class EditError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EditError';
  }
}

let counter = 0;
let idSource = null;
/** Per i test: sostituisce il generatore di id con uno deterministico. */
export function setIdSource(fn) {
  idSource = fn;
}
export function uid(prefix = 'c') {
  if (idSource) return `${prefix}${idSource()}`;
  counter = (counter + 1) % 1e9;
  return `${prefix}${Date.now().toString(36).slice(-4)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const deepClone = (v) => structuredClone(v);

/** Unisce `src` dentro una copia di `base` (ricorsivo sugli oggetti semplici, gli array vengono sostituiti). */
export function mergeDeep(base, src) {
  if (src === undefined || src === null) return base;
  if (!isPlain(base) || !isPlain(src)) return src;
  const out = { ...base };
  for (const k of Object.keys(src)) {
    out[k] = k in base ? mergeDeep(base[k], src[k]) : src[k];
  }
  return out;
}
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** "MM:SS:FF" (con ore se servono). */
export function formatTimecode(t, fps = 30) {
  if (!isNum(t) || t < 0) t = 0;
  const totalFrames = Math.round(t * fps);
  const f = totalFrames % Math.round(fps);
  const totalSec = Math.floor(totalFrames / Math.round(fps));
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return (h > 0 ? `${pad(h)}:` : '') + `${pad(m)}:${pad(s)}:${pad(f)}`;
}

/** "m:ss" oppure "m:ss.d". Arrotonda prima, poi scompone: niente "0:60" per errori di virgola mobile. */
export function formatDuration(t, decimals = 0) {
  if (!isNum(t) || t < 0) t = 0;
  if (decimals > 0) {
    const f = 10 ** decimals;
    const total = Math.round(t * f) / f;
    const m = Math.floor(total / 60);
    const s = Math.max(0, total - m * 60);
    return `${m}:${s.toFixed(decimals).padStart(3 + decimals, '0')}`;
  }
  const total = Math.floor(t + 1e-6);
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

export function formatBytes(n) {
  if (!isNum(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function debounce(fn, ms) {
  let h = null;
  const wrapped = (...a) => {
    clearTimeout(h);
    h = setTimeout(() => {
      h = null;
      fn(...a);
    }, ms);
  };
  wrapped.flush = (...a) => {
    if (h !== null) {
      clearTimeout(h);
      h = null;
      fn(...a);
    }
  };
  wrapped.cancel = () => {
    clearTimeout(h);
    h = null;
  };
  return wrapped;
}

/** Piccolo emettitore di eventi. */
export class Emitter {
  #l = new Map();
  on(ev, fn) {
    if (!this.#l.has(ev)) this.#l.set(ev, new Set());
    this.#l.get(ev).add(fn);
    return () => this.#l.get(ev)?.delete(fn);
  }
  emit(ev, ...args) {
    const set = this.#l.get(ev);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(...args);
      } catch (e) {
        console.error(`[emit:${ev}]`, e);
      }
    }
  }
}

/** Colore "#rrggbb" -> [r,g,b]; valori non validi danno nero. */
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
