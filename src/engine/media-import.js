// Importazione dei file: riconoscimento del tipo, metadati, miniatura e forma d'onda.

import { fixWebmDuration } from '../core/webm.js';

export const ACCEPT = 'video/*,audio/*,image/*,.mkv,.mov,.m4v,.webm,.mp4,.mp3,.wav,.m4a,.ogg,.aac,.flac,.png,.jpg,.jpeg,.webp,.gif,.avif,.bmp';
const EXT_KIND = {
  video: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv', 'avi', '3gp'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'weba'],
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg'],
};
const MAX_WAVE_BYTES = 300 * 1024 * 1024;

export function kindOfFile(file) {
  const t = (file.type || '').toLowerCase();
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('image/')) return 'image';
  const ext = file.name.split('.').pop().toLowerCase();
  for (const [k, list] of Object.entries(EXT_KIND)) if (list.includes(ext)) return k;
  return null;
}

const withTimeout = (p, ms, msg) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

/** Ferma ogni caricamento in corso dell'elemento: va fatto PRIMA di revocare l'URL del blob. */
function releaseElement(el) {
  try {
    el.onloadedmetadata = el.onerror = el.ontimeupdate = el.onseeked = null;
    el.pause();
    el.removeAttribute('src');
    el.load();
  } catch {
    /* già rilasciato */
  }
}

function loadElement(tag, url, bag) {
  const el = document.createElement(tag);
  bag.push(el);
  el.preload = 'metadata';
  el.muted = true;
  el.playsInline = true;
  return withTimeout(
    new Promise((resolve, reject) => {
      el.onloadedmetadata = () => resolve(el);
      el.onerror = () => reject(new Error('Formato non supportato dal browser'));
      el.src = url;
    }),
    20000,
    'Il file non risponde (formato non supportato?)',
  );
}

/** I WebM registrati dal browser dichiarano durata Infinity: la si ricava spostandosi alla fine. */
async function realDuration(el) {
  if (Number.isFinite(el.duration) && el.duration > 0) return el.duration;
  await withTimeout(
    new Promise((res) => {
      el.ontimeupdate = () => {
        if (Number.isFinite(el.duration)) {
          el.ontimeupdate = null;
          res();
        }
      };
      el.currentTime = 1e101;
    }),
    5000,
    'Durata non determinabile',
  ).catch(() => {});
  const d = Number.isFinite(el.duration) ? el.duration : 0;
  el.currentTime = 0;
  return d;
}

async function seekTo(el, t) {
  if (Math.abs(el.currentTime - t) < 0.01 && el.readyState >= 2) return;
  await withTimeout(
    new Promise((res) => {
      el.onseeked = () => res();
      el.currentTime = t;
    }),
    4000,
    'seek scaduto',
  ).catch(() => {});
}

function drawThumb(source, sw, sh, maxW = 192) {
  const k = Math.min(1, maxW / sw);
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(sw * k));
  c.height = Math.max(2, Math.round(sh * k));
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}

/** @returns {{kind, duration, width, height, mime, thumb}} */
export async function probeMedia(file) {
  let kind = kindOfFile(file);
  if (!kind) throw new Error('Tipo di file non riconosciuto');
  const url = URL.createObjectURL(file);
  const bag = [];
  try {
    if (kind === 'image') {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
        throw new Error('Immagine non leggibile');
      });
      const thumb = drawThumb(bmp, bmp.width, bmp.height);
      const out = { kind, duration: 0, width: bmp.width, height: bmp.height, mime: file.type, thumb };
      bmp.close?.();
      return out;
    }
    if (kind === 'video') {
      const el = await loadElement('video', url, bag);
      if (!el.videoWidth) kind = 'audio'; // contenitore con sola traccia audio
      else {
        const duration = await realDuration(el);
        if (!(duration > 0)) throw new Error('Il video non ha una durata valida');
        await seekTo(el, Math.min(duration * 0.1, 1));
        let thumb = '';
        try {
          thumb = drawThumb(el, el.videoWidth, el.videoHeight);
        } catch {
          /* miniatura facoltativa */
        }
        return { kind, duration, width: el.videoWidth, height: el.videoHeight, mime: file.type, thumb };
      }
    }
    const el = await loadElement('audio', url, bag);
    const duration = await realDuration(el);
    if (!(duration > 0)) throw new Error('L’audio non ha una durata valida');
    return { kind: 'audio', duration, width: 0, height: 0, mime: file.type, thumb: '' };
  } finally {
    for (const el of bag) releaseElement(el);
    URL.revokeObjectURL(url);
  }
}

/** Picchi della forma d'onda (0..255, `rate` per secondo) oppure null se non c'è audio decodificabile. */
export async function computePeaks(blob, rate = 50) {
  if (blob.size > MAX_WAVE_BYTES) return null;
  const OAC = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  if (!OAC) return null;
  let audio;
  try {
    audio = await new OAC(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
  } catch {
    return null;
  }
  const n = Math.max(1, Math.ceil(audio.duration * rate));
  const peaks = new Uint8Array(n);
  const step = audio.sampleRate / rate;
  const chans = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  for (let i = 0; i < n; i++) {
    const from = Math.floor(i * step);
    const to = Math.min(audio.length, Math.floor((i + 1) * step));
    let m = 0;
    for (const ch of chans) for (let s = from; s < to; s++) m = Math.max(m, Math.abs(ch[s]));
    peaks[i] = Math.min(255, Math.round(m * 255));
    if (i % 4000 === 3999) await new Promise((r) => setTimeout(r));
  }
  return { peaks, rate };
}

/**
 * Decodifica l'audio di un file in canali Float32 (per gli effetti e l'analisi del ritmo).
 * @returns {{channels: Float32Array[], sampleRate: number}} oppure lancia un errore comprensibile
 */
export async function decodeAudio(blob, { maxSeconds = 1800 } = {}) {
  const OAC = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  if (!OAC) throw new Error('Questo browser non sa decodificare l\'audio.');
  let audio;
  try {
    audio = await new OAC(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error('Non riesco a leggere l\'audio di questo file (nessun audio o formato non supportato).');
  }
  if (audio.duration > maxSeconds) throw new Error(`L\'audio dura ${Math.round(audio.duration / 60)} minuti: per questa funzione il limite è ${Math.round(maxSeconds / 60)}.`);
  return { channels: Array.from({ length: audio.numberOfChannels }, (_, i) => Float32Array.from(audio.getChannelData(i))), sampleRate: audio.sampleRate };
}

/** Miniatura di un fotogramma di un elemento video già posizionato (fotogramma fisso). */
export async function captureFrameBlob(source, width, height, type = 'image/png') {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  c.getContext('2d').drawImage(source, 0, 0, width, height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Cattura non riuscita'))), type));
}

/** Registratore vocale (voice-over). */
export class VoiceRecorder {
  #rec = null;
  #stream = null;
  #chunks = [];
  #t0 = 0;
  get recording() {
    return this.#rec?.state === 'recording';
  }
  static supported() {
    return !!(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
  }
  async start() {
    this.#stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    this.#rec = new MediaRecorder(this.#stream, mime ? { mimeType: mime } : undefined);
    this.#chunks = [];
    this.#rec.ondataavailable = (e) => e.data?.size && this.#chunks.push(e.data);
    this.#rec.start(500);
    this.#t0 = performance.now();
  }
  /** @returns {Promise<{blob: Blob, seconds: number}>} */
  async stop() {
    const rec = this.#rec;
    if (!rec) throw new Error('Nessuna registrazione in corso');
    const done = new Promise((res) => (rec.onstop = res));
    rec.stop();
    await done;
    this.#stream?.getTracks().forEach((t) => t.stop());
    const seconds = (performance.now() - this.#t0) / 1000;
    const type = rec.mimeType || 'audio/webm';
    let blob = new Blob(this.#chunks, { type });
    if (type.includes('webm')) blob = new Blob([fixWebmDuration(new Uint8Array(await blob.arrayBuffer()), seconds * 1000)], { type });
    this.#rec = null;
    this.#stream = null;
    return { blob, seconds };
  }
  cancel() {
    try {
      this.#rec?.state !== 'inactive' && this.#rec?.stop();
    } catch {
      /* già fermo */
    }
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#rec = null;
    this.#stream = null;
  }
}
