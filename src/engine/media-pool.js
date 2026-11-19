// Pool dei media: mantiene i Blob dei file, le immagini decodificate e gli elementi
// <video>/<audio> (uno per clip, così due clip dello stesso file possono suonare insieme).

import { Emitter } from '../core/util.js';

const MAX_ELEMENTS = 14;

export class MediaPool extends Emitter {
  #blobs = new Map(); // mediaId → {blob, url}
  #images = new Map(); // mediaId → ImageBitmap | HTMLCanvasElement
  #imagePromises = new Map();
  #els = new Map(); // clipId → {el, mediaId, last}
  #info = new Map(); // mediaId → dati derivati {thumb, peaks, peaksRate, hasAudio}
  #tick = 0;

  constructor(audio) {
    super();
    this.audio = audio;
  }

  // ---- file ---------------------------------------------------------------
  add(mediaId, blob) {
    this.#revoke(mediaId);
    this.#blobs.set(mediaId, { blob, url: URL.createObjectURL(blob) });
  }
  has(mediaId) {
    return this.#blobs.has(mediaId);
  }
  blob(mediaId) {
    return this.#blobs.get(mediaId)?.blob ?? null;
  }
  url(mediaId) {
    return this.#blobs.get(mediaId)?.url ?? null;
  }
  #revoke(mediaId) {
    const b = this.#blobs.get(mediaId);
    if (b) URL.revokeObjectURL(b.url);
    this.#blobs.delete(mediaId);
  }

  info(mediaId) {
    return this.#info.get(mediaId) ?? null;
  }
  setInfo(mediaId, patch) {
    this.#info.set(mediaId, { ...(this.#info.get(mediaId) ?? {}), ...patch });
    this.emit('info', mediaId);
  }

  // ---- immagini -------------------------------------------------------------
  /** Decodifica l'immagine una sola volta; riduce quelle enormi per non appesantire il rendering. */
  loadImage(mediaId, maxSide = 3840) {
    if (this.#images.has(mediaId)) return Promise.resolve(this.#images.get(mediaId));
    if (this.#imagePromises.has(mediaId)) return this.#imagePromises.get(mediaId);
    const b = this.#blobs.get(mediaId);
    if (!b) return Promise.resolve(null);
    const p = (async () => {
      try {
        let bmp = await createImageBitmap(b.blob, { imageOrientation: 'from-image' });
        const long = Math.max(bmp.width, bmp.height);
        if (long > maxSide) {
          const k = maxSide / long;
          const small = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' });
          bmp.close?.();
          bmp = small;
        }
        this.#images.set(mediaId, bmp);
        this.emit('image', mediaId);
        return bmp;
      } catch (e) {
        console.warn('[pool] immagine non decodificabile', mediaId, e);
        return null;
      } finally {
        this.#imagePromises.delete(mediaId);
      }
    })();
    this.#imagePromises.set(mediaId, p);
    return p;
  }
  image(mediaId) {
    return this.#images.get(mediaId) ?? null;
  }

  // ---- elementi audio/video ---------------------------------------------------
  /** Elemento per il clip (creato al primo uso). Restituisce null se il file non è disponibile. */
  element(clip) {
    const cur = this.#els.get(clip.id);
    if (cur) {
      cur.last = ++this.#tick;
      return cur.el;
    }
    const url = this.url(clip.mediaId);
    if (!url) return null;
    const el = document.createElement(clip.kind === 'video' ? 'video' : 'audio');
    el.preload = 'auto';
    el.playsInline = true;
    el.disablePictureInPicture = true;
    el.preservesPitch = true;
    el.src = url;
    this.#els.set(clip.id, { el, mediaId: clip.mediaId, last: ++this.#tick });
    this.audio.attach(el, clip.id);
    return el;
  }
  peek(clipId) {
    return this.#els.get(clipId)?.el ?? null;
  }
  release(clipId) {
    const e = this.#els.get(clipId);
    if (!e) return;
    this.audio.detach(clipId);
    e.el.pause();
    e.el.removeAttribute('src');
    e.el.load();
    this.#els.delete(clipId);
  }
  /** Libera gli elementi dei clip che non esistono più e quelli meno usati oltre il limite. */
  prune(project, keep = new Set()) {
    const alive = new Set();
    for (const t of project.tracks) for (const c of t.clips) alive.add(c.id);
    for (const id of [...this.#els.keys()]) if (!alive.has(id) && !keep.has(id)) this.release(id);
    if (this.#els.size > MAX_ELEMENTS) {
      const idle = [...this.#els.entries()].filter(([id]) => !keep.has(id)).sort((a, b) => a[1].last - b[1].last);
      for (const [id] of idle.slice(0, this.#els.size - MAX_ELEMENTS)) this.release(id);
    }
  }
  get elementCount() {
    return this.#els.size;
  }

  removeMedia(mediaId) {
    for (const [id, e] of [...this.#els]) if (e.mediaId === mediaId) this.release(id);
    const img = this.#images.get(mediaId);
    img?.close?.();
    this.#images.delete(mediaId);
    this.#info.delete(mediaId);
    this.#revoke(mediaId);
  }

  clear() {
    for (const id of [...this.#els.keys()]) this.release(id);
    for (const id of [...this.#blobs.keys()]) this.#revoke(id);
    for (const img of this.#images.values()) img?.close?.();
    this.#images.clear();
    this.#info.clear();
  }
}
