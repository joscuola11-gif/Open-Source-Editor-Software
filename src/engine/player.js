// Player: orologio di riproduzione, sincronizzazione audio/video e disegno dei fotogrammi.
//
// Anti-glitch:
//  - in pausa il fotogramma si disegna solo DOPO che gli elementi <video> hanno completato il seek;
//  - in riproduzione, se un video non ha ancora il fotogramma giusto si mantiene quello precedente
//    (niente lampeggi neri), con un timeout oltre il quale si procede comunque;
//  - la deriva fra orologio e media è corretta con una lieve variazione della velocità (nudge) e
//    solo oltre soglia con un seek;
//  - i clip che stanno per iniziare vengono pre-posizionati (preroll) per evitare lo scatto iniziale.

import { Emitter, clamp } from '../core/util.js';
import { clipGain } from '../core/audio-math.js';
import { isActiveAt, projectDuration, clipEnd } from '../core/timeline.js';
import { isTimedKind } from '../core/project.js';

const PREROLL = 1.0; // secondi
const HARD_SEEK = 0.3; // deriva oltre la quale si fa un seek
const NUDGE = 0.04; // deriva oltre la quale si corregge la velocità
const STALL_TIMEOUT = 350; // ms di attesa massima di un fotogramma in riproduzione
const SEEK_TIMEOUT = 700; // ms di attesa massima di un seek in pausa

export class Player extends Emitter {
  #t = 0;
  #playing = false;
  #raf = 0;
  #wallStart = 0;
  #tStart = 0;
  #token = 0;
  #dirty = false;
  #dirtyRaf = 0;
  #active = new Set(); // id dei clip media attualmente in riproduzione
  #stallSince = 0;
  #lastDrawn = -1;
  #exportTarget = null;
  #frames = [];
  #pending = Promise.resolve();
  #maxLong = 1280;
  loop = false;
  /** Ultimo errore di rendering mostrabile all'utente. */
  stats = { fps: 0, ms: 0, dropped: 0 };

  canvas = null;
  ctx = null;

  constructor({ store, pool, audio, renderer }) {
    super();
    this.store = store;
    this.pool = pool;
    this.audio = audio;
    this.renderer = renderer;
    store.on('change', () => this.#onProject());
    pool.on('image', () => this.invalidate());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.#playing && !this.#exportTarget) this.pause();
    });
  }

  get time() {
    return this.#t;
  }
  get playing() {
    return this.#playing;
  }
  get duration() {
    return projectDuration(this.store.project);
  }
  get fps() {
    return this.store.project.settings.fps;
  }

  attachCanvas(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.resizeCanvas();
  }

  /** Adatta la risoluzione di lavoro del canvas di anteprima (in pixel) mantenendo l'aspetto. */
  resizeCanvas(maxLongSide = this.#maxLong) {
    if (!this.canvas) return;
    this.#maxLong = maxLongSide;
    const { width, height } = this.store.project.settings;
    const k = Math.min(1, maxLongSide / Math.max(width, height));
    const w = Math.max(2, Math.round(width * k));
    const h = Math.max(2, Math.round(height * k));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.invalidate();
    }
  }

  // ---------------------------------------------------------------------------
  // Trasporto
  // ---------------------------------------------------------------------------

  async play() {
    if (this.#playing) return;
    const dur = this.duration;
    if (dur <= 0) return;
    await this.audio.resume();
    if (this.#t >= dur - 1 / this.fps) this.#t = 0;
    this.#token++; // annulla eventuali render in pausa pendenti
    this.#playing = true;
    this.#stallSince = 0;
    this.#frames.length = 0;
    this.emit('state', true);
    // Prima posiziona i media (in pausa) e attende che abbiano il fotogramma giusto (max 1,2 s):
    // l'orologio parte solo dopo, così video e audio partono insieme senza seek correttivi.
    this.#syncMedia(this.#t, false);
    await this.#waitReady(this.#t, 1200);
    if (!this.#playing) return;
    this.#beginClock(this.#t);
    this.#raf = requestAnimationFrame(this.#tick);
  }

  pause() {
    if (!this.#playing) {
      this.invalidate();
      return;
    }
    this.#playing = false;
    cancelAnimationFrame(this.#raf);
    this.#pauseAll();
    this.emit('state', false);
    this.#pending = this.#renderPaused();
  }

  toggle() {
    return this.#playing ? this.pause() : this.play();
  }

  /** Posiziona la testina. In riproduzione il clock riparte da `t`. */
  seek(t) {
    const dur = this.duration;
    this.#t = clamp(t, 0, Math.max(0, dur));
    this.emit('time', this.#t);
    if (this.#playing) {
      this.#beginClock(this.#t);
      this.#syncMedia(this.#t, true);
    } else this.#pending = this.#renderPaused();
  }

  /** Attende che il fotogramma in pausa sia stato disegnato (dopo seek/modifiche). */
  async settle() {
    let last;
    do {
      last = this.#pending;
      await last;
    } while (last !== this.#pending);
  }

  stepFrames(n) {
    this.pause();
    this.seek(Math.round(this.#t * this.fps + n) / this.fps);
  }

  /** Richiede un nuovo disegno (a pausa): raggruppa più richieste nello stesso frame. */
  invalidate() {
    if (this.#playing || this.#dirty) return;
    this.#dirty = true;
    this.#dirtyRaf = requestAnimationFrame(() => {
      this.#dirty = false;
      this.#pending = this.#renderPaused();
    });
  }

  /** Imposta/annulla un canvas di esportazione a piena risoluzione. */
  setExportTarget(canvas) {
    this.#exportTarget = canvas ? { canvas, ctx: canvas.getContext('2d', { alpha: false }), n: 0 } : null;
  }

  // ---------------------------------------------------------------------------
  // Orologio
  // ---------------------------------------------------------------------------

  #beginClock(t) {
    this.#wallStart = performance.now();
    this.#tStart = t;
  }

  #tick = (now) => {
    if (!this.#playing) return;
    let t = this.#tStart + (now - this.#wallStart) / 1000;
    const dur = this.duration;
    if (t >= dur) {
      if (this.loop && !this.#exportTarget && dur > 0) {
        t = 0;
        this.#beginClock(0);
        this.#syncMedia(0, true);
      } else return this.#finish();
    }
    this.#t = t;
    this.#syncMedia(t, true);
    const bad = this.renderer.notReady(this.store.project, t);
    if (bad.length && this.#lastDrawn >= 0) {
      // mantiene il fotogramma precedente; dopo STALL_TIMEOUT disegna comunque
      this.#stallSince ||= now;
      if (now - this.#stallSince < STALL_TIMEOUT) {
        this.stats.dropped++;
        this.emit('time', t);
        this.#raf = requestAnimationFrame(this.#tick);
        return;
      }
    } else this.#stallSince = 0;
    const t0 = performance.now();
    this.#draw(t);
    this.#trackStats(t0, now);
    this.emit('time', t);
    this.#raf = requestAnimationFrame(this.#tick);
  };

  #finish() {
    const dur = this.duration;
    this.#t = dur;
    this.#playing = false;
    cancelAnimationFrame(this.#raf);
    this.#pauseAll();
    this.#draw(dur);
    this.emit('time', dur);
    this.emit('state', false);
    this.emit('ended');
  }

  #trackStats(t0, now) {
    const ms = performance.now() - t0;
    this.stats.ms = this.stats.ms * 0.9 + ms * 0.1;
    this.#frames.push(now);
    while (this.#frames.length && now - this.#frames[0] > 1000) this.#frames.shift();
    this.stats.fps = this.#frames.length;
  }

  // ---------------------------------------------------------------------------
  // Sincronizzazione dei media
  // ---------------------------------------------------------------------------

  #pauseAll() {
    for (const id of this.#active) {
      this.pool.peek(id)?.pause();
      this.audio.setGain(id, 0);
    }
    this.#active.clear();
  }

  /** Allinea elementi audio/video al tempo `t`. */
  #syncMedia(t, playing) {
    const p = this.store.project;
    const nowActive = new Set();
    const keep = new Set();
    for (const track of p.tracks) {
      for (const clip of track.clips) {
        if (!isTimedKind(clip.kind)) continue;
        const active = isActiveAt(clip, t);
        const upcoming = !active && clip.start > t && clip.start - t < PREROLL;
        if (!active && !upcoming) continue;
        const el = this.pool.element(clip);
        if (!el) continue;
        keep.add(clip.id);
        const media = p.media[clip.mediaId];
        const maxT = media?.duration > 0 ? Math.max(0, media.duration - 0.02) : Infinity;
        if (upcoming) {
          // preroll: posiziona sull'in-point senza riprodurre
          if (playing && el.paused && Math.abs(el.currentTime - clip.in) > 0.05) el.currentTime = clip.in;
          continue;
        }
        nowActive.add(clip.id);
        const target = Math.min(maxT, clip.in + (t - clip.start) * clip.speed);
        if (playing) {
          if (el.playbackRate !== clip.speed && Math.abs(el.playbackRate - clip.speed) > 0.2) el.playbackRate = clip.speed;
          if (el.paused) {
            el.playbackRate = clip.speed;
            el.currentTime = target;
            el.play().catch(() => {});
          } else {
            const drift = el.currentTime - target;
            const ad = Math.abs(drift);
            if (ad > HARD_SEEK * Math.max(1, clip.speed)) {
              el.currentTime = target;
              el.playbackRate = clip.speed;
            } else if (ad > NUDGE) el.playbackRate = clip.speed * (1 - clamp(drift * 0.5, -0.1, 0.1));
            else if (el.playbackRate !== clip.speed) el.playbackRate = clip.speed;
          }
          this.audio.setGain(clip.id, clipGain(track, clip, t));
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - target) > 0.5 / p.settings.fps) el.currentTime = target;
          this.audio.setGain(clip.id, 0);
        }
      }
    }
    for (const id of this.#active) {
      if (!nowActive.has(id)) {
        const el = this.pool.peek(id);
        if (el && !el.paused) el.pause();
        this.audio.setGain(id, 0);
      }
    }
    this.#active = nowActive;
    this.pool.prune(p, keep);
  }

  /** Attende che i video attivi abbiano il fotogramma corretto. */
  async #waitReady(t, timeoutMs) {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      const bad = this.renderer.notReady(this.store.project, t);
      if (!bad.length || performance.now() > deadline) return;
      await Promise.race([
        ...bad.map(
          (el) =>
            new Promise((res) => {
              const done = () => {
                el.removeEventListener('seeked', done);
                el.removeEventListener('loadeddata', done);
                el.removeEventListener('canplay', done);
                res();
              };
              el.addEventListener('seeked', done, { once: true });
              el.addEventListener('loadeddata', done, { once: true });
              el.addEventListener('canplay', done, { once: true });
            }),
        ),
        new Promise((res) => setTimeout(res, Math.max(16, deadline - performance.now()))),
      ]);
    }
  }

  // ---------------------------------------------------------------------------
  // Disegno
  // ---------------------------------------------------------------------------

  async #renderPaused() {
    const token = ++this.#token;
    const t = this.#t;
    this.#syncMedia(t, false);
    await this.#waitReady(t, SEEK_TIMEOUT);
    if (token !== this.#token || this.#playing) return;
    // un frame di rendering in più: dopo 'seeked' il fotogramma è disponibile al compositor
    await new Promise((r) => requestAnimationFrame(r));
    if (token !== this.#token || this.#playing) return;
    this.#draw(t);
  }

  #draw(t) {
    const p = this.store.project;
    const dur = projectDuration(p);
    // all'ultimo istante nessun clip è "attivo": mostra l'ultimo fotogramma reale
    const rt = dur > 0 ? Math.min(t, Math.max(0, dur - 1e-3)) : t;
    const ex = this.#exportTarget;
    if (ex) {
      this.renderer.render(ex.ctx, p, rt);
      if (this.ctx && ex.n++ % 3 === 0) this.ctx.drawImage(ex.canvas, 0, 0, this.canvas.width, this.canvas.height);
    } else if (this.ctx) this.renderer.render(this.ctx, p, rt);
    this.#lastDrawn = t;
    this.emit('frame', { t, frame: Math.floor(t * p.settings.fps + 1e-6) });
  }

  #onProject() {
    const dur = this.duration;
    if (this.#t > dur) this.#t = dur;
    if (this.#playing) {
      if (dur <= 0) this.pause();
      return;
    }
    this.invalidate();
  }

  /** Clip che terminano oltre `t` (usato dalle interfacce per sapere se c'è altro da riprodurre). */
  hasContentAfter(t) {
    return this.store.project.tracks.some((tr) => tr.clips.some((c) => clipEnd(c) > t + 1e-6));
  }
}
