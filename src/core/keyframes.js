// Keyframe: interpolazione di proprietà animabili di un clip.
// I tempi `t` dei keyframe sono relativi all'inizio del clip (in secondi di timeline).

import { TOL, lerp } from './util.js';

export const KEYFRAME_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'];

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

export function easeFn(name) {
  return EASINGS[name] ?? EASINGS.linear;
}

export function baseValue(clip, prop) {
  return prop === 'volume' ? clip.volume : clip.transform[prop];
}

export function setBaseValue(clip, prop, v) {
  if (prop === 'volume') clip.volume = v;
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
