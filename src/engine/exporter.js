// Esportazione: riproduce il progetto a piena risoluzione e registra canvas + audio con MediaRecorder.
// È la stessa pipeline dell'anteprima, quindi ciò che vedi è ciò che ottieni.
//
// Note oneste: la registrazione avviene in tempo reale (un video da 1 minuto richiede ~1 minuto) e la
// scheda deve restare visibile. Il risultato riporta quanti fotogrammi sono stati effettivamente
// prodotti, così un eventuale rallentamento del computer non passa inosservato.

import { fixWebmDuration } from '../core/webm.js';

export const FORMATS = {
  auto: { label: 'Automatico (consigliato)', candidates: ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'] },
  mp4: { label: 'MP4 (H.264/AAC) · dove supportato', candidates: ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'] },
  webm: { label: 'WebM (VP9/Opus)', candidates: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'] },
};

export const QUALITY = {
  low: { label: 'Bassa (file piccolo)', bpp: 0.05 },
  medium: { label: 'Media', bpp: 0.09 },
  high: { label: 'Alta', bpp: 0.15 },
  ultra: { label: 'Massima', bpp: 0.25 },
};

export function pickMime(format = 'auto') {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const c of (FORMATS[format] ?? FORMATS.auto).candidates) if (MediaRecorder.isTypeSupported(c)) return c;
  return null;
}

export function availableFormats() {
  return Object.keys(FORMATS).filter((k) => pickMime(k) !== null);
}

/** Dimensioni di esportazione dal lato corto richiesto, sempre pari (richiesto dagli encoder). */
export function exportSize(settings, shortSide) {
  const { width, height } = settings;
  const k = shortSide / Math.min(width, height);
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return { width: even(width * k), height: even(height * k) };
}

export function estimateBitrate(width, height, fps, quality = 'medium') {
  const bpp = (QUALITY[quality] ?? QUALITY.medium).bpp;
  return Math.max(1_000_000, Math.round(width * height * fps * bpp));
}

export class Exporter {
  #cancelled = false;
  #recorder = null;
  #running = false;

  constructor({ store, player, audio }) {
    this.store = store;
    this.player = player;
    this.audio = audio;
  }
  get running() {
    return this.#running;
  }

  cancel() {
    this.#cancelled = true;
    if (this.#recorder && this.#recorder.state !== 'inactive') {
      try {
        this.#recorder.stop();
      } catch {
        /* già fermo */
      }
    }
    this.player.pause();
  }

  /**
   * @returns {Promise<{blob: Blob, mime: string, ext: string, frames: number, expectedFrames: number, hiddenDuringExport: boolean, seconds: number}>}
   */
  async run({ shortSide = 1080, format = 'auto', quality = 'medium', onProgress = () => {} } = {}) {
    if (this.#running) throw new Error('Esportazione già in corso');
    const mime = pickMime(format);
    if (!mime) throw new Error('Questo browser non supporta la registrazione video (MediaRecorder).');
    const project = this.store.project;
    const duration = this.player.duration;
    if (duration <= 0) throw new Error('La timeline è vuota: aggiungi almeno un clip.');
    const { fps } = project.settings;
    const { width, height } = exportSize(project.settings, shortSide);

    this.#running = true;
    this.#cancelled = false;
    let hidden = document.hidden;
    const onVis = () => {
      if (document.hidden) hidden = true;
    };
    document.addEventListener('visibilitychange', onVis);
    let wake = null;
    try {
      wake = await navigator.wakeLock?.request('screen');
    } catch {
      /* facoltativo */
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    let recorder = null;
    const offTime = [];
    try {
      this.player.pause();
      await this.audio.resume();
      this.audio.setMonitor(false);
      this.player.setExportTarget(canvas);
      this.player.seek(0);

      const manual = typeof CanvasCaptureMediaStreamTrack !== 'undefined' && 'requestFrame' in CanvasCaptureMediaStreamTrack.prototype;
      const stream = canvas.captureStream(manual ? 0 : fps);
      const vTrack = stream.getVideoTracks()[0];
      const aTrack = this.audio.stream?.getAudioTracks()[0];
      if (aTrack) stream.addTrack(aTrack);

      const chunks = [];
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: estimateBitrate(width, height, fps, quality),
        audioBitsPerSecond: 192_000,
      });
      this.#recorder = recorder;
      const stopped = new Promise((resolve, reject) => {
        recorder.onstop = resolve;
        recorder.onerror = (e) => reject(e.error ?? new Error('Errore del registratore'));
      });
      recorder.ondataavailable = (e) => e.data?.size && chunks.push(e.data);

      let frames = 0;
      let lastFrame = -1;
      offTime.push(
        this.player.on('frame', ({ frame }) => {
          if (frame === lastFrame) return;
          lastFrame = frame;
          frames++;
          if (manual) vTrack.requestFrame();
        }),
        this.player.on('time', (t) => onProgress(Math.min(1, t / duration))),
      );

      const ended = new Promise((resolve) => offTime.push(this.player.on('ended', resolve)));
      const startedAt = performance.now();
      recorder.start(1000);
      await this.player.play();
      await ended;
      // coda: lascia che l'ultimo audio/video venga consegnato al registratore
      await new Promise((r) => setTimeout(r, 350));
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      if (this.#cancelled) throw Object.assign(new Error('Esportazione annullata'), { cancelled: true });

      const actualMime = recorder.mimeType || mime;
      let blob = new Blob(chunks, { type: actualMime });
      if (actualMime.includes('webm')) {
        const fixed = fixWebmDuration(new Uint8Array(await blob.arrayBuffer()), duration * 1000);
        blob = new Blob([fixed], { type: actualMime });
      }
      onProgress(1);
      return {
        blob,
        mime: actualMime,
        ext: actualMime.includes('mp4') ? 'mp4' : 'webm',
        frames,
        expectedFrames: Math.floor(duration * fps),
        hiddenDuringExport: hidden,
        seconds: (performance.now() - startedAt) / 1000,
        width,
        height,
      };
    } finally {
      offTime.forEach((off) => off());
      this.player.pause();
      this.player.setExportTarget(null);
      this.audio.setMonitor(true);
      this.player.resizeCanvas();
      this.player.invalidate();
      document.removeEventListener('visibilitychange', onVis);
      try {
        await wake?.release();
      } catch {
        /* ignorato */
      }
      this.#recorder = null;
      this.#running = false;
    }
  }
}

/** Scarica un Blob con il nome indicato. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
