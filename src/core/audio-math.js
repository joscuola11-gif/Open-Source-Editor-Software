// Guadagno audio di un clip al tempo t (volume, keyframe, dissolvenze, crossfade nelle transizioni).
// Funzione pura: usata dal motore audio e dai test.

import { valueAt } from './keyframes.js';

export function fadeEnvelope(clip, local) {
  let g = 1;
  if (clip.fadeIn > 0 && local < clip.fadeIn) g *= Math.max(0, local) / clip.fadeIn;
  const rem = clip.duration - local;
  if (clip.fadeOut > 0 && rem < clip.fadeOut) g *= Math.max(0, rem) / clip.fadeOut;
  return g;
}

/** Crossfade a potenza costante nelle sovrapposizioni create dalle transizioni. */
export function crossfadeEnvelope(track, clip, t) {
  const cs = track.clips;
  const i = cs.indexOf(clip);
  if (i < 0) return 1;
  let g = 1;
  const prev = cs[i - 1];
  if (prev && clip.transition) {
    const ov = prev.start + prev.duration - clip.start;
    if (ov > 1e-6 && t < clip.start + ov) g *= Math.sqrt(Math.max(0, Math.min(1, (t - clip.start) / ov)));
  }
  const next = cs[i + 1];
  if (next && next.transition) {
    const ov = clip.start + clip.duration - next.start;
    if (ov > 1e-6 && t > next.start) g *= Math.sqrt(Math.max(0, Math.min(1, 1 - (t - next.start) / ov)));
  }
  return g;
}

export function clipGain(track, clip, t) {
  if (track.muted || clip.muted) return 0;
  const local = t - clip.start;
  const vol = Math.max(0, valueAt(clip, 'volume', local));
  return vol * fadeEnvelope(clip, local) * crossfadeEnvelope(track, clip, t);
}
