// Esportazione di solo audio (WAV, MP3) e di GIF animate: mixaggio «a freddo» e codificatori.

import { Mp3Encoder } from '@breezystack/lamejs';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { mixdown } from '../core/mixdown.js';
import { allClips } from '../core/project.js';
import { decodeAudio } from './media-import.js';

/** Mixa tutto l'audio del progetto (clip audio e video con suono). */
export async function renderProjectAudio(project, pool, onProgress = () => {}) {
  const ids = [...new Set(allClips(project).filter((c) => (c.kind === 'audio' || c.kind === 'video') && !c.muted).map((c) => c.mediaId))];
  const sources = new Map();
  let n = 0;
  for (const id of ids) {
    const blob = pool.blob(id);
    if (blob) {
      try {
        sources.set(id, await decodeAudio(blob, { maxSeconds: 4 * 3600 }));
      } catch {
        /* un video senza audio: si salta */
      }
    }
    onProgress((0.5 * ++n) / ids.length);
    await new Promise((r) => setTimeout(r));
  }
  if (!sources.size) throw new Error('Il progetto non contiene audio da esportare.');
  return mixdown(project, sources, { sampleRate: 44100, onProgress: (v) => onProgress(0.5 + 0.4 * v) });
}

export function encodeMp3(channels, sampleRate, kbps = 192) {
  const enc = new Mp3Encoder(2, sampleRate, kbps);
  const to16 = (f) => {
    const o = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const v = Math.max(-1, Math.min(1, f[i]));
      o[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return o;
  };
  const l = to16(channels[0]);
  const r = to16(channels[Math.min(1, channels.length - 1)]);
  const parts = [];
  const block = 1152 * 8;
  for (let i = 0; i < l.length; i += block) {
    const out = enc.encodeBuffer(l.subarray(i, i + block), r.subarray(i, i + block));
    if (out.length) parts.push(Uint8Array.from(out));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(Uint8Array.from(tail));
  return new Blob(parts, { type: 'audio/mpeg' });
}

/**
 * GIF animata: ogni fotogramma si disegna con `drawFrame(ctx, t)` (già posizionato sul tempo t), nessuna registrazione in tempo reale.
 * @returns {Promise<Blob>}
 */
export async function encodeGif({ width, height, fps, duration, drawFrame, onProgress = () => {}, isCancelled = () => false }) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const gif = GIFEncoder();
  const frames = Math.max(1, Math.round(duration * fps));
  for (let i = 0; i < frames; i++) {
    if (isCancelled()) throw Object.assign(new Error('Esportazione annullata'), { cancelled: true });
    const t = Math.min(duration - 1e-3, i / fps);
    await drawFrame(ctx, t);
    const { data } = ctx.getImageData(0, 0, width, height);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay: Math.round(1000 / fps) });
    onProgress((i + 1) / frames);
    if (i % 4 === 3) await new Promise((r) => setTimeout(r));
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}
