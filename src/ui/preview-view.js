// Anteprima: canvas di riproduzione, barra di trasporto e maniglie di trasformazione sul video.

import { h } from './dom.js';
import { icon } from './icons.js';
import { prefs } from './prefs.js';
import { clamp, formatTimecode } from '../core/util.js';
import { findClip, isActiveAt } from '../core/timeline.js';
import { valueAt, setValueAt } from '../core/keyframes.js';
import { isVisualKind } from '../core/project.js';
import { dragCrop, edgeForFlip } from '../core/crop.js';

const QUALITIES = [
  { id: '640', label: 'Bassa (640)', px: 640 },
  { id: '960', label: 'Media (960)', px: 960 },
  { id: '1280', label: 'Alta (1280)', px: 1280 },
  { id: '1920', label: 'Piena (1920)', px: 1920 },
];

const rotate = (x, y, deg) => {
  const r = (deg * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
};

export class PreviewView {
  #hud = false;
  #handlesDirty = false;
  /** Modalità «Ritaglia»: sul clip selezionato compaiono le maniglie dei bordi. */
  cropMode = false;
  /** Rapporto fisso per gli angoli (null = libero). */
  cropRatio = null;

  constructor(app) {
    this.app = app;
    const { player } = app;
    this.canvas = h('canvas', { class: 'preview-canvas', width: 1280, height: 720, 'aria-label': 'Anteprima del video', role: 'img' });
    player.attachCanvas(this.canvas);
    this.guides = h('div', { class: 'guides', hidden: true });
    this.centerV = h('div', { class: 'center-guide v', hidden: true });
    this.centerH = h('div', { class: 'center-guide h', hidden: true });
    this.selBox = h('div', { class: 'sel-box', hidden: true },
      ...['nw', 'ne', 'sw', 'se'].map((c) => h('div', { class: `sel-handle ${c}`, 'data-handle': 'scale', title: 'Ridimensiona' })),
      h('div', { class: 'rot-stem' }),
      h('div', { class: 'sel-handle rot', 'data-handle': 'rotate', title: 'Ruota (Maiusc = passi di 15°)' }),
      ...['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br'].map((c) => h('div', { class: `crop-handle ${c}`, 'data-crop': c, title: 'Trascina per ritagliare' })),
    );
    this.hud = h('div', { class: 'hud', hidden: true });
    this.box = h('div', { class: 'stage-box' }, this.canvas, this.guides, this.centerV, this.centerH, this.selBox, this.hud);
    this.stage = h('div', { class: 'stage' }, this.box);

    this.timeNow = h('span', { class: 'tc now', 'aria-label': 'Tempo corrente' }, '00:00:00');
    this.timeTotal = h('span', { class: 'tc total', 'aria-label': 'Durata totale' }, '00:00:00');
    this.playBtn = h('button', { class: 'play-btn', type: 'button', id: 'btn-play', 'aria-label': 'Riproduci', title: 'Riproduci/Pausa (Spazio)', onClick: () => app.actions.togglePlay() }, icon('play', 20));
    const ib = (ic, label, onClick, id) => h('button', { class: 'icon-btn', type: 'button', title: label, 'aria-label': label, id, onClick }, icon(ic, 18));
    this.loopBtn = ib('repeat', 'Ripeti in loop (L)', () => app.actions.toggleLoop(), 'btn-loop');
    this.guidesBtn = ib('grid', 'Guide di composizione', () => this.toggleGuides(), 'btn-guides');
    this.quality = h('select', { class: 'mini-select', 'aria-label': 'Qualità anteprima', title: 'Qualità dell’anteprima (non influisce sull’esportazione)' }, QUALITIES.map((q) => h('option', { value: q.id }, q.label)));
    this.quality.value = prefs.get('previewQuality', '1280');
    this.quality.addEventListener('change', () => {
      prefs.set('previewQuality', this.quality.value);
      this.applyQuality();
    });
    this.transport = h('div', { class: 'transport', role: 'toolbar', 'aria-label': 'Controlli di riproduzione' },
      this.timeNow,
      h('div', { class: 'transport-center' },
        ib('skipBack', 'Vai all’inizio (Home)', () => app.actions.seekStart(), 'btn-start'),
        ib('stepBack', 'Fotogramma precedente (←)', () => app.actions.stepFrame(-1), 'btn-prev'),
        this.playBtn,
        ib('stepFwd', 'Fotogramma successivo (→)', () => app.actions.stepFrame(1), 'btn-next'),
        ib('skipFwd', 'Vai alla fine (Fine)', () => app.actions.seekEnd(), 'btn-end'),
      ),
      h('div', { class: 'transport-right' },
        this.timeTotal,
        this.loopBtn,
        this.guidesBtn,
        this.quality,
        ib('maximize', 'Schermo intero (F)', () => this.fullscreen(), 'btn-fullscreen'),
      ),
    );
    this.el = h('section', { class: 'preview', 'aria-label': 'Anteprima' }, this.stage, this.transport);

    new ResizeObserver(() => this.#fit()).observe(this.stage);
    this.applyQuality();
    player.on('time', (t) => this.#onTime(t));
    player.on('frame', () => this.#queueHandles());
    player.on('state', (playing) => this.#onState(playing));
    app.store.on('change', () => {
      this.#syncSize();
      this.#queueHandles();
      this.#onTime(player.time);
    });
    app.selection.on('change', () => this.#queueHandles());
    this.selBox.addEventListener('pointerdown', (e) => this.#onHandleDown(e));
    this.box.addEventListener('pointerdown', (e) => this.#onBoxDown(e));
    this.box.addEventListener('dblclick', (e) => this.#onDblClick(e));
    setInterval(() => this.#updateHud(), 500);
    this.#syncSize();
  }

  applyQuality() {
    const q = QUALITIES.find((x) => x.id === this.quality.value) ?? QUALITIES[2];
    this.app.player.resizeCanvas(q.px);
  }

  toggleGuides(v = this.guides.hidden) {
    this.guides.hidden = !v;
    this.guidesBtn.classList.toggle('on', v);
  }
  toggleHud() {
    this.#hud = !this.#hud;
    this.hud.hidden = !this.#hud;
  }
  fullscreen() {
    const el = this.stage;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.().catch(() => this.app.toast('Schermo intero non disponibile', { type: 'warn' }));
  }

  #syncSize() {
    const { width, height } = this.app.store.project.settings;
    if (this.canvas._pw !== width || this.canvas._ph !== height) {
      this.canvas._pw = width;
      this.canvas._ph = height;
      this.applyQuality();
      this.#fit();
    }
  }

  /** Dimensiona il riquadro dell'anteprima mantenendo il rapporto del progetto. */
  #fit() {
    const { width, height } = this.app.store.project.settings;
    const sw = this.stage.clientWidth - 16;
    const sh = this.stage.clientHeight - 16;
    if (sw <= 0 || sh <= 0) return;
    const k = Math.min(sw / width, sh / height);
    this.box.style.width = `${Math.max(40, Math.floor(width * k))}px`;
    this.box.style.height = `${Math.max(40, Math.floor(height * k))}px`;
    this.#queueHandles();
  }

  #onTime(t) {
    const { player, store } = this.app;
    const fps = store.project.settings.fps;
    this.timeNow.textContent = formatTimecode(t, fps);
    this.timeTotal.textContent = formatTimecode(player.duration, fps);
  }

  #onState(playing) {
    this.playBtn.replaceChildren(icon(playing ? 'pause' : 'play', 20));
    this.playBtn.setAttribute('aria-label', playing ? 'Pausa' : 'Riproduci');
    this.playBtn.classList.toggle('playing', playing);
  }

  setLoop(on) {
    this.loopBtn.classList.toggle('on', on);
    this.loopBtn.setAttribute('aria-pressed', String(on));
  }

  #updateHud() {
    if (!this.#hud) return;
    const { player, pool } = this.app;
    this.hud.textContent = `${player.stats.fps} fps · ${player.stats.ms.toFixed(1)} ms/frame · saltati ${player.stats.dropped} · elementi media ${pool.elementCount} · ${this.canvas.width}×${this.canvas.height}`;
  }

  // ---------------------------------------------------------------------------
  // Maniglie
  // ---------------------------------------------------------------------------

  #queueHandles() {
    if (this.#handlesDirty) return;
    this.#handlesDirty = true;
    requestAnimationFrame(() => {
      this.#handlesDirty = false;
      this.#updateHandles();
    });
  }

  #selectedClip() {
    const { store, selection, player } = this.app;
    if (selection.size !== 1) return null;
    const f = findClip(store.project, selection.primary);
    if (!f || !isVisualKind(f.clip.kind) || f.track.hidden) return null;
    if (!isActiveAt(f.clip, player.time) && player.time !== f.clip.start + f.clip.duration) return null;
    return f.clip;
  }

  #geometry(clip) {
    const { renderer, store, player } = this.app;
    return renderer.geometry(store.project, clip, player.time, this.canvas.width, this.canvas.height);
  }

  /** px canvas → px CSS dell'anteprima. */
  get #k() {
    return this.box.clientWidth / this.canvas.width;
  }

  #updateHandles() {
    const clip = this.#selectedClip();
    if (!clip || this.app.player.playing) {
      this.selBox.hidden = true;
      return;
    }
    const g = this.#geometry(clip);
    if (!g) {
      this.selBox.hidden = true;
      return;
    }
    const k = this.#k;
    this.selBox.hidden = false;
    this.selBox.classList.toggle('cropping', this.cropMode && (clip.kind === 'video' || clip.kind === 'image'));
    this.selBox.style.width = `${g.w * k}px`;
    this.selBox.style.height = `${g.h * k}px`;
    this.selBox.style.transform = `translate(${g.cx * k}px, ${g.cy * k}px) translate(-50%, -50%) rotate(${g.rotation}deg)`;
  }

  #hit(clientX, clientY) {
    const { store, player } = this.app;
    const p = store.project;
    const r = this.canvas.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * this.canvas.width;
    const py = ((clientY - r.top) / r.height) * this.canvas.height;
    for (const track of p.tracks) {
      if (track.type !== 'video' || track.hidden || track.locked) continue;
      for (let i = track.clips.length - 1; i >= 0; i--) {
        const c = track.clips[i];
        if (!isActiveAt(c, player.time) || c.kind === 'adjustment') continue;
        const g = this.#geometry(c);
        if (!g) continue;
        const [lx, ly] = rotate(px - g.cx, py - g.cy, -g.rotation);
        if (Math.abs(lx) <= g.w / 2 && Math.abs(ly) <= g.h / 2) return c;
      }
    }
    return null;
  }

  /**
   * Il prossimo clic sull'anteprima non seleziona nulla: dà il punto cliccato (in pixel del canvas del progetto) a `cb`.
   * Esc o un clic fuori annullano.
   */
  pickPoint(cb) {
    this.cancelPick();
    this.pickCb = cb;
    this.box.classList.add('picking');
    this.pickKey = (ev) => { if (ev.key === 'Escape') this.cancelPick(); };
    // in fase di cattura: il riquadro di selezione del clip (che sta sopra l'anteprima) non deve rubare il clic
    this.pickDown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const done = this.pickCb;
      this.cancelPick();
      const r = this.canvas.getBoundingClientRect();
      const { width, height } = this.app.store.project.settings;
      done?.({ px: ((e.clientX - r.left) / r.width) * width, py: ((e.clientY - r.top) / r.height) * height });
    };
    window.addEventListener('keydown', this.pickKey, true);
    this.box.addEventListener('pointerdown', this.pickDown, true);
  }

  cancelPick() {
    this.pickCb = null;
    this.box.classList.remove('picking');
    if (this.pickKey) window.removeEventListener('keydown', this.pickKey, true);
    if (this.pickDown) this.box.removeEventListener('pointerdown', this.pickDown, true);
    this.pickKey = null;
    this.pickDown = null;
  }

  #onBoxDown(e) {
    if (e.button !== 0 || e.target.closest('.sel-handle')) return;
    const hit = this.#hit(e.clientX, e.clientY);
    const { selection } = this.app;
    if (!hit) {
      selection.clear();
      return;
    }
    if (!selection.has(hit.id) || selection.size !== 1) selection.set([hit.id]);
    this.#startTransform(e, hit, 'move');
  }

  #onHandleDown(e) {
    if (e.button !== 0) return;
    const hnd = e.target.closest('.sel-handle');
    const crop = e.target.closest('.crop-handle');
    const clip = this.#selectedClip();
    if (!clip) return;
    e.preventDefault();
    e.stopPropagation();
    if (crop && this.cropMode) return this.#startCrop(e, clip, crop.dataset.crop);
    this.#startTransform(e, clip, hnd ? hnd.dataset.handle : 'move');
  }

  setCropMode(on, ratio = this.cropRatio) {
    this.cropMode = !!on;
    this.cropRatio = ratio;
    this.#queueHandles();
    this.app.events.emit('crop-mode');
  }

  /** Trascinamento di un bordo o angolo del ritaglio. */
  #startCrop(e, clip, handle) {
    const { store } = this.app;
    const id = clip.id;
    const media = store.project.media[clip.mediaId];
    const g0 = this.#geometry(clip);
    if (!g0 || !media) return;
    const crop0 = { ...clip.crop };
    const fullW = g0.w / Math.max(0.05, 1 - crop0.l - crop0.r);
    const fullH = g0.h / Math.max(0.05, 1 - crop0.t - crop0.b);
    const { flipX, flipY } = clip.transform;
    const edge = edgeForFlip(handle, flipX, flipY);
    const k = this.#k;
    const startX = e.clientX;
    const startY = e.clientY;
    let began = false;
    const apply = (ev) => {
      const dxPx = (ev.clientX - startX) / k;
      const dyPx = (ev.clientY - startY) / k;
      if (!began) {
        if (Math.hypot(dxPx, dyPx) < 2) return;
        began = true;
        store.beginGesture('Ritaglia');
      }
      let [lx, ly] = rotate(dxPx, dyPx, -g0.rotation);
      if (flipX) lx = -lx;
      if (flipY) ly = -ly;
      const next = dragCrop(crop0, edge, lx / fullW, ly / fullH, { ratio: this.cropRatio, mw: media.width || 16, mh: media.height || 9 });
      store.previewGesture((p) => {
        const c = findClip(p, id)?.clip;
        if (c) c.crop = next;
      });
    };
    const up = () => {
      removeEventListener('pointermove', apply);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      if (began) store.commitGesture();
    };
    addEventListener('pointermove', apply);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }

  #onDblClick(e) {
    const hit = this.#hit(e.clientX, e.clientY);
    if (hit?.kind === 'text') this.app.actions.focusInspectorText();
  }

  #startTransform(e, clip, mode) {
    e.preventDefault();
    const { store, player } = this.app;
    const id = clip.id;
    const local = clamp(player.time - clip.start, 0, clip.duration);
    const g0 = this.#geometry(clip);
    const k = this.#k;
    const r = this.box.getBoundingClientRect();
    const cxCss = r.left + g0.cx * k;
    const cyCss = r.top + g0.cy * k;
    const v0 = { x: valueAt(clip, 'x', local), y: valueAt(clip, 'y', local), scale: valueAt(clip, 'scale', local), rotation: valueAt(clip, 'rotation', local) };
    const startX = e.clientX;
    const startY = e.clientY;
    const dist0 = Math.max(4, Math.hypot(startX - cxCss, startY - cyCss));
    const ang0 = Math.atan2(startY - cyCss, startX - cxCss);
    let began = false;
    const apply = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!began) {
        if (Math.hypot(dx, dy) < 3) return;
        began = true;
        store.beginGesture(mode === 'move' ? 'Sposta' : mode === 'scale' ? 'Ridimensiona' : 'Ruota');
      }
      let vals = {};
      let showV = false;
      let showH = false;
      if (mode === 'move') {
        let nx = v0.x + dx / r.width;
        let ny = v0.y + dy / r.height;
        if (Math.abs(nx) < 0.012) {
          nx = 0;
          showV = true;
        }
        if (Math.abs(ny) < 0.012) {
          ny = 0;
          showH = true;
        }
        vals = { x: nx, y: ny };
      } else if (mode === 'scale') {
        let s = v0.scale * (Math.hypot(ev.clientX - cxCss, ev.clientY - cyCss) / dist0);
        if (Math.abs(s - 1) < 0.02) s = 1;
        vals = { scale: clamp(s, 0.02, 20) };
      } else {
        let a = v0.rotation + ((Math.atan2(ev.clientY - cyCss, ev.clientX - cxCss) - ang0) * 180) / Math.PI;
        a = ((a + 180) % 360 + 360) % 360 - 180;
        if (ev.shiftKey) a = Math.round(a / 15) * 15;
        else {
          const near = Math.round(a / 90) * 90;
          if (Math.abs(a - near) < 3) a = near;
        }
        vals = { rotation: a };
      }
      this.centerV.hidden = !showV;
      this.centerH.hidden = !showH;
      store.previewGesture((p) => {
        const c = findClip(p, id)?.clip;
        if (!c) return;
        for (const [prop, v] of Object.entries(vals)) setValueAt(c, prop, local, v);
      });
    };
    const up = () => {
      removeEventListener('pointermove', apply);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      this.centerV.hidden = true;
      this.centerH.hidden = true;
      if (began) store.commitGesture();
    };
    addEventListener('pointermove', apply);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }
}
