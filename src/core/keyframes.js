// Keyframe: interpolazione di proprietà animabili di un clip.
// I tempi `t` dei keyframe sono relativi all'inizio del clip (in secondi di timeline).

import { TOL, lerp } from './util.js';

export const KEYFRAME_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume', 'maskSize', 'maskX', 'maskY', 'maskFeather'];
/** Proprietà della maschera che si possono animare (valori in frazioni: dimensione, posizione e sfumatura). */
export const MASK_PROPS = { maskSize: 'size', maskX: 'x', maskY: 'y', maskFeather: 'feather' };

export const EASING_LABELS = {
  linear: 'Lineare',
  'ease-in': 'Accelera',
  'ease-out': 'Rallenta',
  'ease-in-out': 'Morbido',
  hold: 'Scatto',
};

export const EASINGS = {
  linear: (t) => t,
  'ease-in': (t) => t * t * t,
  'ease-out': (t) => 1 - (1 - t) ** 3,
  'ease-in-out': (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  hold: () => 0,
};

// ---- curve di Bézier personalizzate: 'bezier(x1,y1,x2,y2)' come in CSS (x fra 0 e 1, y anche fuori: superamento/rimbalzo) ----
export function parseBezier(str) {
  const m = /^bezier\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)$/.exec(String(str));
  if (!m) return null;
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  if (![x1, y1, x2, y2].every(Number.isFinite) || x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1 || Math.abs(y1) > 3 || Math.abs(y2) > 3) return null;
  return [x1, y1, x2, y2];
}
export const bezierString = (x1, y1, x2, y2) => `bezier(${[x1, y1, x2, y2].map((v) => +v.toFixed(2)).join(',')})`;

/** Funzione di interpolazione della curva di Bézier cubica (0,0)–(x1,y1)–(x2,y2)–(1,1). */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t;
  const Y = (t) => ((ay * t + by) * t + cy) * t;
  const dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = X(t) - x;
      if (Math.abs(e) < 1e-7) return Y(t);
      const d = dX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const e = X(t) - x;
      if (Math.abs(e) < 1e-7) break;
      if (e > 0) hi = t;
      else lo = t;
      t = (lo + hi) / 2;
    }
    return Y(t);
  };
}

const bezierCache = new Map();
export function easeFn(name) {
  const known = EASINGS[name];
  if (known) return known;
  if (typeof name === 'string' && name.startsWith('bezier(')) {
    let f = bezierCache.get(name);
    if (!f) {
      const b = parseBezier(name);
      f = b ? cubicBezier(...b) : EASINGS.linear;
      if (bezierCache.size > 200) bezierCache.clear();
      bezierCache.set(name, f);
    }
    return f;
  }
  return EASINGS.linear;
}

/** Nome di interpolazione valido, altrimenti «linear» (progetti letti da file). */
export function sanitizeEasing(e) {
  if (typeof e !== 'string') return 'linear';
  if (EASINGS[e]) return e;
  const b = parseBezier(e);
  return b ? bezierString(...b) : 'linear';
}

/** Curve pronte per l'editor. */
export const BEZIER_PRESETS = [
  { id: 'linear', label: 'Lineare', e: 'linear', b: [0, 0, 1, 1] },
  { id: 'smooth', label: 'Morbido', e: 'bezier(0.42,0,0.58,1)', b: [0.42, 0, 0.58, 1] },
  { id: 'ease-in', label: 'Parte piano', e: 'bezier(0.55,0,1,0.45)', b: [0.55, 0, 1, 0.45] },
  { id: 'ease-out', label: 'Finisce piano', e: 'bezier(0,0.55,0.45,1)', b: [0, 0.55, 0.45, 1] },
  { id: 'snap', label: 'Scatto veloce', e: 'bezier(0.9,0,0.1,1)', b: [0.9, 0, 0.1, 1] },
  { id: 'anticipate', label: 'Prende la rincorsa', e: 'bezier(0.68,-0.55,0.27,1.55)', b: [0.68, -0.55, 0.27, 1.55] },
  { id: 'overshoot', label: 'Supera e torna', e: 'bezier(0.34,1.56,0.64,1)', b: [0.34, 1.56, 0.64, 1] },
];

export function baseValue(clip, prop) {
  if (prop === 'volume') return clip.volume;
  if (MASK_PROPS[prop]) return clip.mask?.[MASK_PROPS[prop]] ?? 0;
  return clip.transform[prop];
}

export function setBaseValue(clip, prop, v) {
  if (prop === 'volume') clip.volume = v;
  else if (MASK_PROPS[prop]) clip.mask[MASK_PROPS[prop]] = v;
  else clip.transform[prop] = v;
}

export const hasKeyframes = (clip, prop) => (clip.keyframes?.[prop]?.length ?? 0) > 0;

/** Valore della proprietà al tempo locale `localT` (secondi dall'inizio del clip). */
export function valueAt(clip, prop, localT) {
  const kfs = clip.keyframes?.[prop];
  if (!kfs || kfs.length === 0) return baseValue(clip, prop);
  const n = kfs.length;
  if (localT <= kfs[0].t) return kfs[0].v;
  if (localT >= kfs[n - 1].t) return kfs[n - 1].v;
  // ricerca binaria: ultimo i con kfs[i].t <= localT
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kfs[mid].t <= localT) lo = mid;
    else hi = mid;
  }
  const a = kfs[lo];
  const b = kfs[hi];
  if (a.e === 'hold') return a.v;
  const u = (localT - a.t) / (b.t - a.t);
  return lerp(a.v, b.v, easeFn(a.e)(u));
}

/** Indice del keyframe entro `tol` secondi da `localT`, oppure -1. */
export function keyframeIndexAt(clip, prop, localT, tol = TOL * 5) {
  const kfs = clip.keyframes?.[prop];
  if (!kfs) return -1;
  for (let i = 0; i < kfs.length; i++) if (Math.abs(kfs[i].t - localT) <= tol) return i;
  return -1;
}

/** Inserisce o aggiorna un keyframe (mantiene l'array ordinato). */
export function upsertKeyframe(clip, prop, localT, value, ease = 'linear', tol = TOL * 5) {
  clip.keyframes ??= {};
  const kfs = (clip.keyframes[prop] ??= []);
  const i = keyframeIndexAt(clip, prop, localT, tol);
  if (i >= 0) {
    kfs[i].v = value;
    return i;
  }
  const kf = { t: localT, v: value, e: ease };
  let pos = kfs.findIndex((k) => k.t > localT);
  if (pos < 0) pos = kfs.length;
  kfs.splice(pos, 0, kf);
  return pos;
}

export function removeKeyframeAt(clip, prop, localT, tol = TOL * 5) {
  const i = keyframeIndexAt(clip, prop, localT, tol);
  if (i < 0) return false;
  clip.keyframes[prop].splice(i, 1);
  if (clip.keyframes[prop].length === 0) delete clip.keyframes[prop];
  return true;
}

/** Aggiunge il keyframe nel punto se manca, altrimenti lo rimuove. Restituisce true se ora esiste. */
export function toggleKeyframe(clip, prop, localT) {
  if (removeKeyframeAt(clip, prop, localT)) return false;
  upsertKeyframe(clip, prop, localT, valueAt(clip, prop, localT));
  return true;
}

/**
 * Imposta un valore "intelligente": se la proprietà ha keyframe scrive/aggiorna il keyframe al
 * tempo locale (auto-key), altrimenti modifica il valore base.
 */
export function setValueAt(clip, prop, localT, value) {
  if (hasKeyframes(clip, prop)) upsertKeyframe(clip, prop, localT, value);
  else setBaseValue(clip, prop, value);
}

export function clearKeyframes(clip, prop) {
  if (!clip.keyframes) return;
  if (prop) delete clip.keyframes[prop];
  else clip.keyframes = {};
}

/** Scala i tempi di tutti i keyframe (cambio velocità). */
export function scaleKeyframeTimes(clip, factor) {
  for (const kfs of Object.values(clip.keyframes ?? {})) for (const k of kfs) k.t *= factor;
}

/** Sposta i tempi di tutti i keyframe di `delta` secondi. */
export function shiftKeyframeTimes(clip, delta) {
  for (const kfs of Object.values(clip.keyframes ?? {})) for (const k of kfs) k.t += delta;
}

/**
 * Divide i keyframe di `clip` al tempo locale `s`. Restituisce {left, right}: oggetti keyframes
 * con un keyframe di raccordo ai bordi, così il valore resta continuo attraverso il taglio.
 */
export function splitKeyframes(clip, s) {
  const left = {};
  const right = {};
  for (const [prop, kfs] of Object.entries(clip.keyframes ?? {})) {
    if (!kfs.length) continue;
    const v = valueAt(clip, prop, s);
    let ease = 'linear';
    const L = [];
    const R = [];
    for (const k of kfs) {
      if (k.t < s - TOL) {
        L.push({ ...k });
        ease = k.e;
      } else if (k.t > s + TOL) R.push({ ...k, t: k.t - s });
      else ease = k.e;
    }
    L.push({ t: s, v, e: 'linear' });
    R.unshift({ t: 0, v, e: ease });
    left[prop] = L;
    right[prop] = R;
  }
  return { left, right };
}
