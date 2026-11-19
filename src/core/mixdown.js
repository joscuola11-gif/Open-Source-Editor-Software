// Mixaggio dell'audio del progetto «a freddo» (senza riprodurlo): serve all'esportazione di solo audio.
// Applica a ogni clip lo stesso guadagno dell'anteprima (volume, keyframe, dissolvenze, crossfade, silenziamenti).

import { clipGain } from './audio-math.js';
import { timeStretch } from './audio-fx.js';
import { projectDuration } from './project.js';

const SOFT = 0.8;
/** Limitatore morbido: sotto 0,8 non tocca nulla, sopra comprime senza mai superare 1. */
export const softLimit = (v) => {
  const a = Math.abs(v);
  return a <= SOFT ? v : Math.sign(v) * (SOFT + (1 - SOFT) * Math.tanh((a - SOFT) / (1 - SOFT)));
};

/**
 * @param project progetto
 * @param sources Map mediaId → {channels: Float32Array[], sampleRate} (tutti alla stessa frequenza)
 * @returns {{channels: Float32Array[], sampleRate: number}} audio stereo, durata = durata del progetto
 */
export function mixdown(project, sources, { sampleRate = 44100, onProgress } = {}) {
  const total = Math.max(1, Math.ceil(projectDuration(project) * sampleRate));
  const out = [new Float32Array(total), new Float32Array(total)];
  const work = project.tracks.flatMap((track) => track.clips.map((clip) => ({ track, clip }))).filter(({ clip }) => (clip.kind === 'audio' || clip.kind === 'video') && !clip.muted && sources.has(clip.mediaId));
  let done = 0;
  for (const { track, clip } of work) {
    if (!track.muted) {
      const src = sources.get(clip.mediaId);
      if (src.sampleRate !== sampleRate) throw new Error('Le sorgenti devono avere la stessa frequenza di campionamento.');
      const a = Math.max(0, Math.floor(clip.in * sampleRate));
      const b = Math.min(src.channels[0].length, Math.ceil((clip.in + clip.duration * clip.speed) * sampleRate));
      const chans = [0, 1].map((i) => {
        const ch = src.channels[Math.min(i, src.channels.length - 1)].subarray(a, b);
        return clip.speed === 1 || ch.length < 4096 ? ch : timeStretch(ch, 1 / clip.speed);
      });
      const len = Math.min(Math.round(clip.duration * sampleRate), chans[0].length);
      const base = Math.round(clip.start * sampleRate);
      const STEP = 128; // il guadagno si calcola ogni 128 campioni e si interpola
      let g0 = clipGain(track, clip, clip.start);
      for (let s = 0; s < len; s += STEP) {
        const g1 = clipGain(track, clip, clip.start + Math.min(len, s + STEP) / sampleRate);
        const end = Math.min(len, s + STEP);
        for (let i = s; i < end; i++) {
          const g = g0 + ((g1 - g0) * (i - s)) / STEP;
          const o = base + i;
          if (o >= total) break;
          out[0][o] += chans[0][i] * g;
          out[1][o] += chans[1][i] * g;
        }
        g0 = g1;
      }
    }
    onProgress?.(++done / work.length);
  }
  for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] = softLimit(ch[i]);
  return { channels: out, sampleRate };
}
