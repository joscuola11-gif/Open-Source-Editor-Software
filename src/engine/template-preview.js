// Anteprima dei modelli: compone il modello con immagini d'esempio numerate (o con i file scelti, come fermo immagine)
// e lo disegna con lo stesso compositore dell'editor, quindi si vedono davvero animazioni, transizioni e testi.

import { applyTemplate } from '../core/templates.js';
import { uid } from '../core/util.js';
import { MediaPool } from './media-pool.js';
import { Renderer } from './renderer.js';

const NO_AUDIO = { attach() {}, detach() {} };
const HUES = [18, 205, 140, 300, 48, 350, 180, 265];

export class TemplatePreview {
  constructor() {
    this.pool = new MediaPool(NO_AUDIO);
    this.renderer = new Renderer(this.pool);
    /** @type {Map<string, object>} */
    this.demos = new Map();
    this.project = null;
  }

  async #addBlob(blob, name, w, h) {
    const id = uid('pv');
    this.pool.add(id, blob);
    await this.pool.loadImage(id);
    return { id, name, kind: 'image', mime: blob.type || 'image/png', size: blob.size, duration: 0, width: w, height: h };
  }

  /** Immagine d'esempio numerata, a colori diversi per ogni segnaposto. */
  async demo(n) {
    const key = `d${n}`;
    if (this.demos.has(key)) return this.demos.get(key);
    const w = 960;
    const h = 540;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const hue = HUES[(n - 1) % HUES.length];
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, `hsl(${hue} 70% 55%)`);
    grad.addColorStop(1, `hsl(${(hue + 50) % 360} 70% 28%)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.14)';
    for (let i = 0; i < w; i += 80) g.fillRect(i, 0, 28, h);
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.font = '700 260px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), w / 2, h / 2 + 10);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    const rec = await this.#addBlob(blob, `Esempio ${n}`, w, h);
    this.demos.set(key, rec);
    return rec;
  }

  /** Fermo immagine per un file scelto dall'utente: la foto stessa, o la miniatura di un video. */
  async still(pick) {
    if (pick.file && pick.meta.kind === 'image') return this.#addBlob(pick.file, pick.file.name, pick.meta.width, pick.meta.height);
    if (pick.meta.thumb) {
      const blob = await (await fetch(pick.meta.thumb)).blob();
      return this.#addBlob(blob, pick.file?.name ?? 'Video', pick.meta.width || 1280, pick.meta.height || 720);
    }
    return null;
  }

  /**
   * Progetto d'anteprima. `picks`: {idSegnaposto: {file, meta} | 'skip'}; `texts`: {idTesto: stringa}.
   * I segnaposto video/foto senza scelta mostrano l'immagine d'esempio; l'audio non si usa.
   */
  async build(template, { picks = {}, texts = {}, name } = {}) {
    const media = {};
    let n = 0;
    for (const s of template.slots) {
      if (s.kind === 'audio') continue;
      n++;
      const pick = picks[s.id];
      if (pick === 'skip') continue;
      const rec = pick ? await this.still(pick) : await this.demo(n);
      if (rec) media[s.id] = rec;
    }
    for (const rec of Object.values(media)) await this.pool.loadImage(rec.id);
    this.project = applyTemplate(template, { media, texts, name });
    return this.project;
  }

  /** Disegna il fotogramma al tempo `t` (secondi) su `canvas` (la sua dimensione si adatta al formato del modello). */
  render(canvas, t, width = canvas.width) {
    const p = this.project;
    if (!p) return;
    const w = Math.max(16, Math.round(width));
    const h = Math.max(16, Math.round((w * p.settings.height) / p.settings.width));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.renderer.render(canvas.getContext('2d'), p, Math.max(0, Math.min(t, Math.max(0, this.duration - 0.001))));
  }

  get duration() {
    return this.project ? this.project.tracks.reduce((m, tr) => tr.clips.reduce((mm, c) => Math.max(mm, c.start + c.duration), m), 0) : 0;
  }
}
