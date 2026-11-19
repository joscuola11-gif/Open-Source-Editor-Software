// Grafo WebAudio: ogni clip audio/video ha un proprio GainNode (volume, dissolvenze, keyframe).
//   elemento media → gain clip → bus → limiter → [altoparlanti | destinazione di registrazione]
// Il limiter evita la saturazione digitale quando più clip sono sommati o il volume supera il 100%.

export class AudioEngine {
  ctx = null;
  #nodes = new Map(); // clipId → {src, gain, el}
  #bus = null;
  #speaker = null;
  #dest = null;
  #monitor = true;

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.#bus = this.ctx.createGain();
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    this.#speaker = this.ctx.createGain();
    this.#dest = this.ctx.createMediaStreamDestination();
    this.#bus.connect(limiter);
    limiter.connect(this.#speaker);
    limiter.connect(this.#dest);
    this.#speaker.connect(this.ctx.destination);
    return this.ctx;
  }

  /** Va chiamato da un gesto dell'utente (click su Play) per superare il blocco autoplay. */
  async resume() {
    const ctx = this.ensure();
    if (ctx && ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        /* ignorato: partirà al prossimo gesto */
      }
    }
    return ctx?.state === 'running';
  }

  get running() {
    return this.ctx?.state === 'running';
  }

  /** Flusso audio mixato, per la registrazione dell'esportazione. */
  get stream() {
    this.ensure();
    return this.#dest?.stream ?? null;
  }

  /** Ascolto sugli altoparlanti on/off (durante l'esportazione resta spento). */
  setMonitor(on) {
    this.#monitor = on;
    if (this.#speaker) this.#speaker.gain.value = on ? 1 : 0;
  }
  get monitor() {
    return this.#monitor;
  }

  attach(el, clipId) {
    const ctx = this.ensure();
    if (!ctx || this.#nodes.has(clipId)) return;
    try {
      const src = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain);
      gain.connect(this.#bus);
      this.#nodes.set(clipId, { src, gain, el });
    } catch (e) {
      console.warn('[audio] impossibile collegare l’elemento al grafo', e);
    }
  }

  detach(clipId) {
    const n = this.#nodes.get(clipId);
    if (!n) return;
    try {
      n.src.disconnect();
      n.gain.disconnect();
    } catch {
      /* già scollegato */
    }
    this.#nodes.delete(clipId);
  }

  has(clipId) {
    return this.#nodes.has(clipId);
  }

  /** Imposta il guadagno con una breve rampa (evita i "click" dei salti di volume). */
  setGain(clipId, value) {
    const n = this.#nodes.get(clipId);
    if (!n) return;
    const v = Number.isFinite(value) ? Math.max(0, Math.min(4, value)) : 0;
    const g = n.gain.gain;
    if (Math.abs(g.value - v) < 1e-4) return;
    g.setTargetAtTime(v, this.ctx.currentTime, 0.012);
  }

  /** Per le clip senza grafo (fallback) il volume passa dall'elemento. */
  muteAll() {
    for (const id of this.#nodes.keys()) this.setGain(id, 0);
  }
}
