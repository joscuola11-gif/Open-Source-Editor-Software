// Finestra del teleprompter: copione che scorre da solo alla velocità scelta (parole al minuto).
// Si sposta e si ridimensiona; "specchio" per i teleprompter con vetro riflettente.
// Stato (copione, velocità, dimensioni, posizione) ricordato nel browser.

import { clampWpm, parseScript, scrollOffset, scrollPlan, elapsedAt, readingSeconds, WPM_DEFAULT, WPM_MAX, WPM_MIN } from '../core/teleprompter.js';
import { formatDuration } from '../core/util.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { prefs } from './prefs.js';

const SAMPLE = 'Scrivi qui il tuo copione.\n\nUna riga vuota fa una pausa.\n// le righe che iniziano con due barre sono appunti: non si leggono e non contano.';

export class Teleprompter {
  #el = null;
  #playing = false;
  #elapsed = 0;
  #last = 0;
  #raf = 0;
  #plan = { seconds: 0, distance: 0, pxPerSecond: 0 };
  #reading = false;
  #ro = null;
  /** @type {(() => void)|null} */
  onChange = null;

  get isOpen() {
    return !!this.#el;
  }
  get playing() {
    return this.#playing;
  }
  get elapsed() {
    return this.#elapsed;
  }
  get script() {
    return prefs.get('prompter.text', SAMPLE);
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    if (this.#el) return;
    const rect = prefs.get('prompter.rect', null);
    const w = Math.min(rect?.w ?? 520, innerWidth - 20);
    const hgt = Math.min(rect?.h ?? 380, innerHeight - 20);
    const x = Math.max(0, Math.min(rect?.x ?? (innerWidth - w) / 2, innerWidth - 80));
    const y = Math.max(0, Math.min(rect?.y ?? 60, innerHeight - 60));

    const text = h('textarea', { id: 'prompter-text', class: 'prompter-edit', spellcheck: 'true', 'aria-label': 'Copione del teleprompter', value: this.script });
    text.addEventListener('input', () => {
      prefs.set('prompter.text', text.value);
      this.#refreshInfo();
    });
    this.view = h('div', { class: 'prompter-view', hidden: true });
    this.content = h('div', { class: 'prompter-content' });
    this.guide = h('div', { class: 'prompter-guide', 'aria-hidden': 'true' });
    this.view.append(this.content, this.guide);
    this.view.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.#seekPx(this.#offset() + e.deltaY);
    }, { passive: false });

    const speed = h('input', { type: 'range', id: 'prompter-speed', min: WPM_MIN, max: WPM_MAX, step: 5, value: prefs.get('prompter.wpm', WPM_DEFAULT), 'aria-label': 'Velocità in parole al minuto' });
    const size = h('input', { type: 'range', id: 'prompter-size', min: 20, max: 96, step: 2, value: prefs.get('prompter.size', 40), 'aria-label': 'Dimensione del testo' });
    const mirror = h('input', { type: 'checkbox', id: 'prompter-mirror', checked: !!prefs.get('prompter.mirror', false), 'aria-label': 'Specchio' });
    this.speedOut = h('output', { id: 'prompter-speed-out' });
    this.info = h('span', { class: 'prompter-info', id: 'prompter-info' });
    speed.addEventListener('input', () => this.#setWpm(+speed.value));
    size.addEventListener('input', () => {
      prefs.set('prompter.size', +size.value);
      this.#applyStyle();
    });
    mirror.addEventListener('change', () => {
      prefs.set('prompter.mirror', mirror.checked);
      this.#applyStyle();
    });
    this.speed = speed;
    this.size = size;
    this.mirror = mirror;
    this.playBtn = h('button', { class: 'btn small primary', type: 'button', id: 'prompter-play', onClick: () => this.toggleRun() });
    this.modeBtn = h('button', { class: 'btn small', type: 'button', id: 'prompter-mode', onClick: () => this.setReading(!this.#reading) });
    const head = h('div', { class: 'prompter-head' },
      h('span', { class: 'prompter-title' }, 'Teleprompter'),
      this.modeBtn,
      h('button', { class: 'btn small', type: 'button', id: 'prompter-close', 'aria-label': 'Chiudi il teleprompter', onClick: () => this.close() }, icon('x', 14)));
    const bar = h('div', { class: 'prompter-bar' },
      this.playBtn,
      h('button', { class: 'btn small', type: 'button', id: 'prompter-reset', title: 'Torna all’inizio', onClick: () => this.reset() }, icon('skipBack', 14), 'Inizio'),
      h('label', { class: 'prompter-ctl' }, h('span', {}, 'Velocità'), speed, this.speedOut),
      h('label', { class: 'prompter-ctl' }, h('span', {}, 'Testo'), size),
      h('label', { class: 'prompter-ctl check' }, mirror, h('span', {}, 'Specchio')),
      this.info);
    this.#el = h('div', { class: 'prompter', id: 'prompter', role: 'dialog', 'aria-label': 'Teleprompter', style: { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${hgt}px` } },
      head, h('div', { class: 'prompter-body' }, text, this.view), bar);
    this.#el.addEventListener('keydown', (e) => {
      e.stopPropagation(); // le scorciatoie dell'editor non devono scattare mentre si scrive o si legge
      if (e.key === ' ' && this.#reading && !(e.target instanceof HTMLInputElement && e.target.type !== 'range')) {
        e.preventDefault();
        this.toggleRun();
      } else if (e.key === 'Escape') this.close();
    });
    this.#dragHandle(head);
    document.body.append(this.#el);
    this.#ro = new ResizeObserver(() => {
      this.#remember();
      this.#layout();
    });
    this.#ro.observe(this.#el);
    this.#applyStyle();
    this.setReading(false);
    this.onChange?.();
  }

  close() {
    if (!this.#el) return;
    this.pause();
    this.#remember();
    this.#ro?.disconnect();
    this.#el.remove();
    this.#el = null;
    this.onChange?.();
  }

  setReading(on) {
    if (!this.#el) return;
    this.#reading = !!on;
    this.#el.classList.toggle('reading', this.#reading);
    this.view.hidden = !this.#reading;
    this.#el.querySelector('#prompter-text').hidden = this.#reading;
    this.modeBtn.replaceChildren(this.#reading ? 'Modifica il testo' : 'Mostra in lettura');
    if (this.#reading) {
      const lines = parseScript(this.#el.querySelector('#prompter-text').value).lines;
      this.content.replaceChildren(...lines.map((l) => h('p', { class: l ? '' : 'gap' }, l || ' ')));
      this.#elapsed = 0;
      this.#layout();
    } else {
      this.pause();
    }
    this.#syncButtons();
  }

  /** Avvia o mette in pausa. All'avvio passa subito in modalità lettura. */
  toggleRun() {
    if (this.#playing) this.pause();
    else this.start();
  }

  start() {
    if (!this.#el) this.open();
    if (!this.#reading) this.setReading(true);
    if (this.#plan.seconds > 0 && this.#elapsed >= this.#plan.seconds) this.#elapsed = 0;
    if (this.#playing) return;
    this.#playing = true;
    this.#last = performance.now();
    const tick = (now) => {
      if (!this.#playing) return;
      this.#elapsed += Math.max(0, now - this.#last) / 1000;
      this.#last = now;
      this.#paint();
      if (this.#plan.seconds > 0 && this.#elapsed >= this.#plan.seconds) return this.pause();
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
    this.#syncButtons();
    this.onChange?.();
  }

  pause() {
    cancelAnimationFrame(this.#raf);
    const was = this.#playing;
    this.#playing = false;
    this.#syncButtons();
    if (was) this.onChange?.();
  }

  reset() {
    this.#elapsed = 0;
    this.#paint();
  }

  // ---------------------------------------------------------------------------

  #offset() {
    return scrollOffset(this.#plan, this.#elapsed);
  }

  #seekPx(px) {
    this.#elapsed = elapsedAt(this.#plan, px);
    this.#paint();
  }

  #setWpm(v) {
    const keep = this.#offset();
    prefs.set('prompter.wpm', clampWpm(v));
    this.#layout();
    this.#seekPx(keep); // si riprende dalla stessa riga
  }

  #applyStyle() {
    if (!this.#el) return;
    const px = +this.size.value;
    this.content.style.fontSize = `${px}px`;
    this.view.classList.toggle('mirror', this.mirror.checked);
    this.#layout();
  }

  /** Ricalcola margini e piano di scorrimento (dopo ridimensionamenti, cambio testo, velocità). */
  #layout() {
    if (!this.#el) return;
    const wpm = clampWpm(prefs.get('prompter.wpm', WPM_DEFAULT));
    this.speedOut.textContent = `${wpm} parole/min`;
    const vh = this.view.clientHeight || 1;
    this.content.style.paddingTop = `${Math.round(vh * 0.42)}px`;
    this.content.style.paddingBottom = `${Math.round(vh * 0.58)}px`;
    const keep = this.#plan.pxPerSecond > 0 ? this.#offset() : 0;
    const { words } = parseScript(this.#el.querySelector('#prompter-text').value);
    this.#plan = scrollPlan({ words, wpm, contentHeight: this.content.scrollHeight, viewHeight: vh });
    if (keep) this.#elapsed = elapsedAt(this.#plan, keep);
    this.#refreshInfo();
    this.#paint();
  }

  #refreshInfo() {
    if (!this.#el) return;
    const { words } = parseScript(this.#el.querySelector('#prompter-text').value);
    const wpm = clampWpm(prefs.get('prompter.wpm', WPM_DEFAULT));
    this.info.textContent = `${words} parole · ≈ ${formatDuration(readingSeconds(words, wpm))}`;
    if (!this.#reading) this.#plan.seconds = readingSeconds(words, wpm);
  }

  #paint() {
    if (!this.#el) return;
    this.content.style.transform = `translateY(${-this.#offset().toFixed(2)}px)`;
    this.#el.dataset.offset = String(Math.round(this.#offset()));
  }

  #syncButtons() {
    if (!this.#el) return;
    this.playBtn.replaceChildren(icon(this.#playing ? 'pause' : 'play', 14), this.#playing ? 'Pausa' : 'Avvia');
    this.#el.classList.toggle('running', this.#playing);
  }

  #remember() {
    if (!this.#el) return;
    const r = this.#el.getBoundingClientRect();
    if (r.width > 100 && r.height > 80) prefs.set('prompter.rect', { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  }

  #dragHandle(head) {
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const el = this.#el;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      head.setPointerCapture(e.pointerId);
      const move = (ev) => {
        el.style.left = `${Math.max(0, Math.min(ev.clientX - dx, innerWidth - 80))}px`;
        el.style.top = `${Math.max(0, Math.min(ev.clientY - dy, innerHeight - 40))}px`;
      };
      const up = () => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        head.removeEventListener('pointercancel', up);
        this.#remember();
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
      head.addEventListener('pointercancel', up);
    });
  }
}
