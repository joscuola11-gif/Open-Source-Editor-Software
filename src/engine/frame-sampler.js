// Prende alcuni fotogrammi piccoli di un clip (dal file originale, senza correzioni) per misurarne luminosità e colore.

const MAX_SIDE = 96;

function drawScaled(source, sw, sh, crop) {
  const sx = sw * (crop?.l ?? 0);
  const sy = sh * (crop?.t ?? 0);
  const cw = Math.max(1, sw * (1 - (crop?.l ?? 0) - (crop?.r ?? 0)));
  const ch = Math.max(1, sh * (1 - (crop?.t ?? 0) - (crop?.b ?? 0)));
  const k = Math.min(1, MAX_SIDE / Math.max(cw, ch));
  const w = Math.max(2, Math.round(cw * k));
  const h = Math.max(2, Math.round(ch * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, sx, sy, cw, ch, 0, 0, w, h);
  const { data } = g.getImageData(0, 0, w, h);
  return { data, w, h };
}

const once = (el, ev, ms = 4000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Il video non risponde')), ms);
    el.addEventListener(ev, () => { clearTimeout(t); resolve(); }, { once: true });
    el.addEventListener('error', () => { clearTimeout(t); reject(new Error('Video non leggibile')); }, { once: true });
  });

/**
 * @param {Blob} blob file originale
 * @param {{kind: string, in: number, duration: number, speed: number, crop?: object}} clip
 * @param {number} count quanti fotogrammi
 * @returns {Promise<Array<{data: Uint8ClampedArray, w: number, h: number}>>}
 */
export async function sampleClipFrames(blob, clip, count = 5) {
  if (clip.kind === 'image') {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    try {
      return [drawScaled(bmp, bmp.width, bmp.height, clip.crop)];
    } finally {
      bmp.close?.();
    }
  }
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  try {
    if (v.readyState < 1) await once(v, 'loadedmetadata', 8000);
    const span = clip.duration * clip.speed;
    const frames = [];
    for (let i = 0; i < count; i++) {
      const t = Math.min(Math.max(0, (v.duration || span + clip.in) - 0.05), clip.in + ((i + 0.5) / count) * span);
      const seeked = once(v, 'seeked');
      v.currentTime = t;
      await seeked;
      frames.push(drawScaled(v, v.videoWidth, v.videoHeight, clip.crop));
    }
    return frames;
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}
