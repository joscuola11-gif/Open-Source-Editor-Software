// Suonerie generate al volo (nessun file audio da scaricare).
export class Ringer {
  #ctx = null;
  #timer = 0;
  #kind = null;

  /** Va chiamato dopo un gesto dell'utente (clic/tocco): i browser bloccano l'audio prima. */
  unlock() {
    try {
      this.#ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (this.#ctx.state === 'suspended') this.#ctx.resume();
    } catch {
      /* niente audio: pazienza */
    }
  }

  get blocked() {
    return !this.#ctx || this.#ctx.state !== 'running';
  }

  #tone(freqs, at, dur, vol = 0.12) {
    const c = this.#ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.02);
    g.gain.setValueAtTime(vol, at + dur - 0.04);
    g.gain.linearRampToValueAtTime(0, at + dur);
    g.connect(c.destination);
    for (const f of freqs) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(g);
      o.start(at);
      o.stop(at + dur + 0.02);
    }
  }

  /** «ring» in entrata (due scampanellii) o «tu-tu» di chi chiama. */
  start(kind) {
    this.stop();
    this.#kind = kind;
    if (!this.#ctx) return;
    const play = () => {
      if (!this.#ctx || this.#ctx.state !== 'running') return;
      const t = this.#ctx.currentTime + 0.05;
      if (kind === 'incoming') {
        this.#tone([880, 1108], t, 0.35);
        this.#tone([880, 1108], t + 0.5, 0.35);
      } else {
        this.#tone([425], t, 1.0, 0.07);
      }
    };
    play();
    this.#timer = setInterval(play, kind === 'incoming' ? 2400 : 3000);
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = 0;
    this.#kind = null;
  }

  /** Breve segnale (chiamata finita, errore). */
  beep(freq = 520, dur = 0.18) {
    if (!this.#ctx || this.#ctx.state !== 'running') return;
    this.#tone([freq], this.#ctx.currentTime + 0.02, dur, 0.1);
  }
}
