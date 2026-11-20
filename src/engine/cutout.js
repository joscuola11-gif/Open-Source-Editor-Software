// Rimozione dello sfondo (persona): segmentazione con MediaPipe (Apache 2.0) e archivio delle maschere per fotogramma.
// Le maschere si calcolano a poche immagini al secondo (di base 10) e vivono in memoria: si ricalcolano quando si riapre il progetto.

import { blendMasks, coverage, maskIndex, refineMask } from '../core/cutout.js';
import { sampleVideoFrames } from './video-analysis.js';

const VERSION = '0.1.1675465747';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@${VERSION}/`;
const MAX_SIDE = 256;

/** Dove stanno i file di MediaPipe: programma per computer (protocollo interno), prova (`window.__ciakCutout.base`) o rete di distribuzione. */
export function assetBase() {
  return globalThis.__ciakCutout?.base ?? globalThis.ciakDesktop?.mediapipeBase ?? CDN;
}

let loading = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Non riesco a caricare il motore di ritaglio (serve internet la prima volta, nel programma per computer è incluso).'));
    document.head.append(s);
  });
}

/** Carica MediaPipe una sola volta e restituisce `run(canvas) → Promise<risultato>`. */
function segmenter() {
  loading ??= (async () => {
    const base = assetBase();
    if (!globalThis.SelfieSegmentation) await loadScript(`${base}selfie_segmentation.js`);
    const seg = new globalThis.SelfieSegmentation({ locateFile: (f) => `${base}${f}` });
    seg.setOptions({ modelSelection: 0 });
    let pending = null;
    seg.onResults((r) => pending?.(r));
    await seg.initialize();
    return {
      run: (image) => new Promise((resolve, reject) => {
        pending = resolve;
        seg.send({ image }).catch(reject);
      }),
    };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

function toCanvas({ data, w, h }) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  return c;
}

/** Legge la maschera del risultato (canale rosso) in un array w×h. */
function readMask(result, w, h, scratch) {
  scratch.width = w;
  scratch.height = h;
  const g = scratch.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, w, h);
  g.drawImage(result.segmentationMask, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4];
  return out;
}

/**
 * Calcola le maschere di un clip (o di una foto).
 * @returns {Promise<{from:number, to:number, fps:number, w:number, h:number, frames:Uint8Array[], people:number}>} `people` = quota media di persona (0..1)
 */
export async function computeMasks(blob, clip, { fps = 10, signal, onProgress } = {}) {
  const seg = await segmenter();
  const scratch = document.createElement('canvas');
  let frames;
  let from = 0;
  let to = 0;
  if (clip.kind === 'image') {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(2, Math.round(bmp.width * k));
    const h = Math.max(2, Math.round(bmp.height * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    frames = [{ canvas: c, w, h }];
  } else {
    from = clip.in;
    to = clip.in + clip.duration * clip.speed;
    const raw = await sampleVideoFrames(blob, { from, to, fps, maxSide: MAX_SIDE, signal, onProgress: (v) => onProgress?.(v * 0.3) });
    frames = raw.map((f) => ({ canvas: toCanvas(f), w: f.w, h: f.h }));
  }
  if (!frames.length) throw new Error('Il clip è troppo breve.');
  const masks = [];
  let prev = null;
  for (let i = 0; i < frames.length; i++) {
    if (signal?.aborted) throw new Error('Operazione annullata.');
    const r = await seg.run(frames[i].canvas);
    const m = readMask(r, frames[i].w, frames[i].h, scratch);
    prev = blendMasks(prev, m, 0.6); // meno tremolio fra un fotogramma e l'altro
    masks.push(prev);
    onProgress?.(0.3 + 0.7 * ((i + 1) / frames.length));
  }
  const people = masks.reduce((s, m) => s + coverage(m), 0) / masks.length;
  return { from, to, fps: clip.kind === 'image' ? 1 : fps, w: frames[0].w, h: frames[0].h, frames: masks, people };
}

/** Archivio delle maschere per file; consegna al renderer la maschera rifinita (canvas) di un istante. */
export class CutoutStore {
  #entries = new Map(); // mediaId → maschere
  #canvases = new Map(); // chiave → canvas (LRU)
  version = 0;

  set(mediaId, entry) {
    this.#entries.set(mediaId, entry);
    this.#canvases.clear();
    this.version++;
  }

  clear() {
    this.#entries.clear();
    this.#canvases.clear();
    this.version++;
  }

  /** Le maschere coprono il tratto di file usato dal clip? */
  covers(clip) {
    const e = this.#entries.get(clip.mediaId);
    if (!e) return false;
    if (clip.kind === 'image') return true;
    const need = clip.in + clip.duration * clip.speed;
    return e.from <= clip.in + 1e-3 && e.to >= need - 1 / e.fps - 1e-3;
  }

  people(mediaId) {
    return this.#entries.get(mediaId)?.people ?? null;
  }

  /** Canvas w×h con la maschera rifinita nel canale alfa, per il tempo `t` del file (null se non c'è). */
  canvasFor(clip, srcTime) {
    const e = this.#entries.get(clip.mediaId);
    if (!e) return null;
    const idx = clip.kind === 'image' ? 0 : maskIndex(srcTime, e.from, e.fps, e.frames.length);
    if (idx < 0) return null;
    const { softness, expand } = clip.cutout;
    const key = `${clip.mediaId}|${idx}|${softness}|${expand}`;
    let c = this.#canvases.get(key);
    if (c) {
      this.#canvases.delete(key);
      this.#canvases.set(key, c);
      return c;
    }
    const a = refineMask(e.frames[idx], e.w, e.h, { softness, expand });
    c = document.createElement('canvas');
    c.width = e.w;
    c.height = e.h;
    const img = new ImageData(e.w, e.h);
    for (let i = 0; i < a.length; i++) img.data[i * 4 + 3] = a[i];
    c.getContext('2d').putImageData(img, 0, 0);
    this.#canvases.set(key, c);
    if (this.#canvases.size > 48) this.#canvases.delete(this.#canvases.keys().next().value);
    return c;
  }
}
