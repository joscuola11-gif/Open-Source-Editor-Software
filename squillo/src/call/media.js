// Microfono, camera e schermo. Tiene un «segnaposto» al posto della camera quando è spenta:
// così il video della chiamata ha sempre una traccia e si può accendere/spegnere la camera
// in qualsiasi momento senza rinegoziare la connessione (e la spia della camera si spegne davvero).

import { Emitter } from '../lib/util.js';

export const hasDisplayCapture = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
export const isMobile = () => typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform)));

export const CAMERA_PRESETS = {
  auto: { width: 1280, height: 720, frameRate: 30 },
  saver: { width: 640, height: 360, frameRate: 24 },
};

export function micConstraints({ deviceId, echo = true, noise = true } = {}) {
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    echoCancellation: echo,
    noiseSuppression: noise,
    autoGainControl: true,
    channelCount: 1,
  };
}

export function cameraConstraints({ deviceId, quality = 'auto', facing } = {}) {
  const p = CAMERA_PRESETS[quality] ?? CAMERA_PRESETS.auto;
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    facingMode: !deviceId && facing ? { ideal: facing } : undefined,
    width: { ideal: p.width },
    height: { ideal: p.height },
    frameRate: { ideal: p.frameRate, max: p.frameRate },
  };
}

function clean(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

export class LocalMedia extends Emitter {
  /** @type {MediaStream} flusso che si invia: microfono + (camera o segnaposto) */
  stream = new MediaStream();
  /** @type {MediaStream} anteprima mostrata a noi stessi */
  preview = new MediaStream();
  micTrack = null;
  camTrack = null;
  micOn = true;
  camOn = false;
  facing = 'user';
  #placeholder = null;
  #prefs;

  constructor(prefs = {}) {
    super();
    this.#prefs = prefs;
  }

  setPrefs(p) {
    this.#prefs = { ...this.#prefs, ...p };
  }

  /** Apre il microfono (obbligatorio) e, se richiesto, la camera. Lancia un errore comprensibile se negati. */
  async open({ camera = true } = {}) {
    try {
      const a = await navigator.mediaDevices.getUserMedia({ audio: clean(micConstraints(this.#prefs)) });
      this.micTrack = a.getAudioTracks()[0];
    } catch (e) {
      throw explain(e, 'microfono');
    }
    this.stream.addTrack(this.micTrack);
    if (camera) {
      try {
        await this.#openCamera();
        this.camOn = true;
      } catch (e) {
        // la chiamata può partire anche solo con la voce
        this.camOn = false;
        this.cameraError = explain(e, 'camera');
      }
    }
    if (!this.camTrack) this.#useTrack(this.#makePlaceholder());
    this.micOn = true;
    return this;
  }

  async #openCamera() {
    const s = await navigator.mediaDevices.getUserMedia({ video: clean(cameraConstraints({ ...this.#prefs, facing: this.facing })) });
    const t = s.getVideoTracks()[0];
    t.contentHint = 'motion';
    this.camTrack = t;
    this.#useTrack(t);
    t.addEventListener('ended', () => {
      if (this.camTrack === t && this.camOn) this.setCamera(false).catch(() => {});
    });
  }

  /** Mette `track` come video inviato e mostrato in anteprima. */
  #useTrack(track) {
    for (const t of this.stream.getVideoTracks()) this.stream.removeTrack(t);
    for (const t of this.preview.getTracks()) this.preview.removeTrack(t);
    this.stream.addTrack(track);
    this.preview.addTrack(track);
    this.emit('video-track', track);
  }

  #makePlaceholder() {
    if (!this.#placeholder) {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 360;
      const g = c.getContext('2d');
      let n = 0;
      const draw = () => {
        g.fillStyle = '#10141d';
        g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#1c2230';
        g.beginPath();
        g.arc(320, 170, 70, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#6b7690';
        g.font = '600 30px system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText('Camera spenta', 320, 290);
        g.fillStyle = n++ % 2 ? '#10141d' : '#10141e'; // piccolo cambio: tiene vivo il flusso di fotogrammi
        g.fillRect(0, 0, 2, 2);
      };
      draw();
      const stream = c.captureStream(2);
      this.#placeholder = { canvas: c, track: stream.getVideoTracks()[0], timer: setInterval(draw, 500) };
    }
    return this.#placeholder.track;
  }

  /** Il segnaposto non deve essere fermato quando si cambia traccia: si riusa. */
  get sendTrack() {
    return this.stream.getVideoTracks()[0] ?? null;
  }

  setMic(on) {
    this.micOn = !!on;
    if (this.micTrack) this.micTrack.enabled = this.micOn;
    this.emit('change');
  }

  /**
   * Accende/spegne la camera. `senders` sono i mittenti video già attivi: la traccia viene sostituita
   * senza rinegoziare. Spegnere ferma davvero la camera (si spegne la spia).
   */
  async setCamera(on, senders = []) {
    if (on === this.camOn && (on ? this.camTrack : true)) return;
    if (on) {
      await this.#openCamera();
      this.camOn = true;
    } else {
      const old = this.camTrack;
      this.camTrack = null;
      this.camOn = false;
      this.#useTrack(this.#makePlaceholder());
      old?.stop();
    }
    await Promise.all(senders.map((s) => s.replaceTrack(this.sendTrack).catch(() => {})));
    this.emit('change');
  }

  /** Telefono: alterna camera frontale/posteriore. */
  async flipCamera(senders = []) {
    if (!this.camOn) return;
    const prev = this.facing;
    this.facing = prev === 'user' ? 'environment' : 'user';
    const old = this.camTrack;
    try {
      this.camTrack = null;
      await this.#openCamera();
    } catch (e) {
      this.facing = prev;
      this.camTrack = old;
      throw explain(e, 'camera');
    }
    old?.stop();
    await Promise.all(senders.map((s) => s.replaceTrack(this.sendTrack).catch(() => {})));
    this.emit('change');
  }

  /** Cambia periferica audio/video durante la chiamata. */
  async switchDevice(kind, deviceId, senders = []) {
    this.#prefs = { ...this.#prefs, [kind === 'audio' ? 'audioId' : 'videoId']: deviceId };
    if (kind === 'audio') {
      const a = await navigator.mediaDevices.getUserMedia({ audio: clean(micConstraints(this.#prefs)) });
      const t = a.getAudioTracks()[0];
      t.enabled = this.micOn;
      this.stream.removeTrack(this.micTrack);
      this.micTrack.stop();
      this.micTrack = t;
      this.stream.addTrack(t);
      await Promise.all(senders.map((s) => s.replaceTrack(t).catch(() => {})));
    } else if (this.camOn) {
      const old = this.camTrack;
      this.camTrack = null;
      await this.#openCamera();
      old?.stop();
      await Promise.all(senders.map((s) => s.replaceTrack(this.sendTrack).catch(() => {})));
    }
    this.emit('change');
  }

  stop() {
    for (const t of [...this.stream.getTracks(), ...this.preview.getTracks()]) {
      if (t !== this.#placeholder?.track) t.stop();
    }
    this.camTrack?.stop();
    this.micTrack?.stop();
    if (this.#placeholder) {
      clearInterval(this.#placeholder.timer);
      this.#placeholder.track.stop();
      this.#placeholder = null;
    }
    this.stream = new MediaStream();
    this.preview = new MediaStream();
    this.micTrack = this.camTrack = null;
    this.camOn = false;
  }
}

/** Frasi per l'utente al posto dei nomi tecnici degli errori. */
export function explain(e, what) {
  const name = e?.name ?? '';
  const err = new Error(
    name === 'NotAllowedError' || name === 'SecurityError'
      ? `Permesso negato per il ${what}. Consenti l'accesso dalle impostazioni del browser o del sistema e riprova.`
      : name === 'NotFoundError' || name === 'OverconstrainedError'
        ? `Nessun ${what} trovato. Collegalo e riprova.`
        : name === 'NotReadableError' || name === 'AbortError'
          ? `Il ${what} è in uso da un altro programma. Chiudilo e riprova.`
          : `Non riesco a usare il ${what} (${name || 'errore sconosciuto'}).`,
  );
  err.code = name;
  return err;
}

/** Schermo (e, se possibile, audio del sistema). Mostra il selettore del browser o, nel programma desktop, il nostro. */
export async function getScreen({ mode = 'detail', audio = false, fps } = {}) {
  if (!hasDisplayCapture()) {
    throw new Error('Questo dispositivo non può condividere lo schermo. Funziona da computer con Chrome, Edge, Firefox, Safari o dal programma Squillo.');
  }
  const frameRate = fps ?? (mode === 'motion' ? 60 : 30);
  const opts = {
    video: { frameRate: { ideal: frameRate, max: frameRate }, width: { ideal: 3840 }, height: { ideal: 2160 }, cursor: 'always' },
    audio: audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
    // opzioni di Chrome/Edge: ignorate dagli altri browser
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    systemAudio: audio ? 'include' : 'exclude',
    suppressLocalAudioPlayback: true,
  };
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(opts);
  } catch (e) {
    if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') {
      const err = new Error('Condivisione annullata.');
      err.code = 'cancelled';
      throw err;
    }
    throw explain(e, 'schermo');
  }
  const v = stream.getVideoTracks()[0];
  if (v) v.contentHint = mode === 'motion' ? 'motion' : 'detail';
  const a = stream.getAudioTracks()[0];
  if (a) a.contentHint = 'music';
  return stream;
}

export async function listDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const pick = (kind) => all.filter((d) => d.kind === kind).map((d, i) => ({ id: d.deviceId, label: d.label || `${{ audioinput: 'Microfono', videoinput: 'Camera', audiooutput: 'Altoparlante' }[kind]} ${i + 1}` }));
    return { mics: pick('audioinput'), cams: pick('videoinput'), speakers: pick('audiooutput') };
  } catch {
    return { mics: [], cams: [], speakers: [] };
  }
}
