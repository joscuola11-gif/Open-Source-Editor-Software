// Registratore di schermo, webcam o schermo + webcam (con la webcam in un cerchio in basso a destra).
// Produce un file WebM pronto da importare nell'editor.

import { fixWebmDuration } from '../core/webm.js';

export const RECORD_MODES = [
  { id: 'screen', label: 'Schermo' },
  { id: 'webcam', label: 'Webcam' },
  { id: 'both', label: 'Schermo + webcam' },
];

export const recorderSupported = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices;
export const screenSupported = () => !!navigator.mediaDevices?.getDisplayMedia;

const pickMime = () => ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));

function videoEl(stream) {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.srcObject = stream;
  return v;
}

export class ScreenRecorder {
  #rec = null;
  #streams = [];
  #chunks = [];
  #t0 = 0;
  #raf = 0;
  #stopLoop = null;
  mode = 'screen';

  get recording() {
    return this.#rec?.state === 'recording';
  }
  get elapsed() {
    return this.recording ? (performance.now() - this.#t0) / 1000 : 0;
  }

  /**
   * @param {{mode: 'screen'|'webcam'|'both', mic: boolean, systemAudio: boolean, fps: number}} o
   * @param {{onEnded?: () => void}} hooks se l'utente interrompe la condivisione dal browser
   */
  async start({ mode = 'screen', mic = true, systemAudio = false, fps = 30 } = {}, { onEnded } = {}) {
    if (!recorderSupported()) throw new Error('Questo browser non sa registrare.');
    this.mode = mode;
    let screen = null;
    let cam = null;
    let micStream = null;
    try {
      if (mode !== 'webcam') {
        if (!screenSupported()) throw new Error('Questo dispositivo non può registrare lo schermo.');
        screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: fps, max: fps }, cursor: 'always' }, audio: systemAudio ? { echoCancellation: false, noiseSuppression: false } : false, selfBrowserSurface: 'exclude', systemAudio: systemAudio ? 'include' : 'exclude' });
        screen.getVideoTracks()[0]?.addEventListener('ended', () => onEnded?.());
      }
      if (mode !== 'screen') cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: fps } } });
      if (mic) micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null);
    } catch (e) {
      [screen, cam, micStream].forEach((s) => s?.getTracks().forEach((t) => t.stop()));
      if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') throw Object.assign(new Error('Permesso negato o registrazione annullata.'), { cancelled: true });
      if (e?.name === 'NotFoundError') throw new Error('Nessuna camera o microfono trovati.');
      throw e;
    }
    this.#streams = [screen, cam, micStream].filter(Boolean);

    let video;
    if (mode === 'both') {
      // si compone su un canvas: schermo a tutta grandezza e webcam in un cerchio
      const sv = videoEl(screen);
      const cv = videoEl(cam);
      await Promise.all([sv.play(), cv.play()]);
      await new Promise((r) => (sv.videoWidth ? r() : sv.addEventListener('loadedmetadata', r, { once: true })));
      const c = document.createElement('canvas');
      c.width = sv.videoWidth || 1280;
      c.height = sv.videoHeight || 720;
      const g = c.getContext('2d');
      let on = true;
      const draw = () => {
        if (!on) return;
        g.drawImage(sv, 0, 0, c.width, c.height);
        const d = Math.round(c.height * 0.28);
        const x = c.width - d - Math.round(c.height * 0.03);
        const y = c.height - d - Math.round(c.height * 0.03);
        g.save();
        g.beginPath();
        g.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
        g.clip();
        const ar = (cv.videoWidth || 16) / (cv.videoHeight || 9);
        const sw = ar > 1 ? d * ar : d;
        const sh = ar > 1 ? d : d / ar;
        g.drawImage(cv, x + (d - sw) / 2, y + (d - sh) / 2, sw, sh);
        g.restore();
        g.lineWidth = Math.max(2, c.height * 0.004);
        g.strokeStyle = '#ffffff';
        g.beginPath();
        g.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
        g.stroke();
        this.#raf = requestAnimationFrame(draw);
      };
      draw();
      this.#stopLoop = () => {
        on = false;
        cancelAnimationFrame(this.#raf);
      };
      video = c.captureStream(fps).getVideoTracks()[0];
    } else video = (screen ?? cam).getVideoTracks()[0];

    const audioTracks = [...(micStream?.getAudioTracks() ?? []), ...(screen?.getAudioTracks() ?? [])];
    let audio = audioTracks;
    if (audioTracks.length > 1) {
      // microfono + audio del sistema: si mescolano
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      for (const t of audioTracks) ctx.createMediaStreamSource(new MediaStream([t])).connect(dest);
      this.#streams.push({ getTracks: () => [], close: () => ctx.close() });
      audio = dest.stream.getAudioTracks();
    }
    const out = new MediaStream([video, ...audio]);
    const mime = pickMime();
    this.#rec = new MediaRecorder(out, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 8_000_000 });
    this.#chunks = [];
    this.#rec.ondataavailable = (e) => e.data?.size && this.#chunks.push(e.data);
    this.#rec.start(1000);
    this.#t0 = performance.now();
  }

  /** @returns {Promise<{blob: Blob, seconds: number}>} */
  async stop() {
    const rec = this.#rec;
    if (!rec) throw new Error('Nessuna registrazione in corso');
    const done = new Promise((r) => (rec.onstop = r));
    if (rec.state !== 'inactive') rec.stop();
    await done;
    const seconds = (performance.now() - this.#t0) / 1000;
    this.#stopLoop?.();
    this.#stopLoop = null;
    for (const s of this.#streams) {
      s.getTracks?.().forEach((t) => t.stop());
      s.close?.();
    }
    this.#streams = [];
    this.#rec = null;
    const type = rec.mimeType || 'video/webm';
    let blob = new Blob(this.#chunks, { type });
    if (type.includes('webm')) blob = new Blob([fixWebmDuration(new Uint8Array(await blob.arrayBuffer()), seconds * 1000)], { type });
    return { blob, seconds };
  }

  cancel() {
    if (this.#rec && this.#rec.state !== 'inactive') {
      this.#rec.onstop = null;
      try {
        this.#rec.stop();
      } catch {
        /* già fermo */
      }
    }
    this.#stopLoop?.();
    for (const s of this.#streams) {
      s.getTracks?.().forEach((t) => t.stop());
      s.close?.();
    }
    this.#streams = [];
    this.#rec = null;
  }
}
