// Campiona fotogrammi piccoli di un video (per analisi: scene, movimento, inseguimento). Lavora sul file originale, senza effetti.

const once = (el, ev, ms = 8000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Il video non risponde')), ms);
    el.addEventListener(ev, () => { clearTimeout(t); resolve(); }, { once: true });
    el.addEventListener('error', () => { clearTimeout(t); reject(new Error('Video non leggibile')); }, { once: true });
  });

/**
 * @param {Blob} blob file video
 * @param {{from?: number, to?: number, fps?: number, maxSide?: number, signal?: {aborted: boolean}, onProgress?: (v: number) => void, gray?: boolean}} o
 * @returns {Promise<Array<{t: number, w: number, h: number, data: Uint8ClampedArray}>>} `t` in secondi del file
 */
export async function sampleVideoFrames(blob, { from = 0, to = Infinity, fps = 4, maxSide = 64, signal, onProgress } = {}) {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  try {
    if (v.readyState < 1) await once(v, 'loadedmetadata', 15000);
    const dur = Number.isFinite(v.duration) ? v.duration : to;
    const end = Math.min(to, dur);
    const k = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.max(2, Math.round(v.videoWidth * k));
    const h = Math.max(2, Math.round(v.videoHeight * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    const frames = [];
    const step = 1 / fps;
    const total = Math.max(0, end - from);
    for (let i = 0; from + i * step < end - 1e-6; i++) {
      const t = from + i * step;
      if (signal?.aborted) throw new Error('Operazione annullata.');
      const seeked = once(v, 'seeked');
      v.currentTime = Math.min(t, Math.max(0, dur - 0.02));
      await seeked;
      g.drawImage(v, 0, 0, w, h);
      frames.push({ t, w, h, data: new Uint8ClampedArray(g.getImageData(0, 0, w, h).data) });
      onProgress?.(total ? (t - from) / total : 1);
    }
    return frames;
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}
