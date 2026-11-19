// Vista timeline: tracce, clip, righello, testina, trascinamento, trim, zoom, marcatori.
//
// Prestazioni: i clip sono riconciliati per id (si aggiornano solo gli attributi cambiati, firmati
// in una stringa), il righello è disegnato su un canvas grande quanto il viewport e durante la
// riproduzione si muove solo la testina.

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { prefs } from './prefs.js';
import { contextMenu } from './overlays.js';
import { clamp, formatDuration } from '../core/util.js';
import { allClips, findClip, moveClips, planMove, projectDuration, snapPoints, snapValue, trimClip, clipEnd } from '../core/timeline.js';
import { isVisualKind } from '../core/project.js';

export const HEADER_W = 150;
const RULER_H = 28;
const ROW_H = { video: 60, audio: 48 };
const MIN_PPS = 3;
const MAX_PPS = 900;
const SNAP_PX = 9;
const NICE_STEPS = [1 / 30, 1 / 15, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];

const KIND_LABEL = { video: 'Video', audio: 'Audio', image: 'Immagine', text: 'Testo', shape: 'Forma', sticker: 'Adesivo', adjustment: 'Regolazione' };

export class TimelineView {
  #pps;
  #snap;
  #rows = []; // {id, top, h}
  #clipEls = new Map();
  #rowEls = new Map();
  #drag = null;
  #raf = 0;
  #auto = null;
  #rulerDirty = true;

  constructor(app) {
    this.app = app;
    this.#pps = clamp(prefs.get('pps', 80), MIN_PPS, MAX_PPS);
    this.#snap = prefs.get('snap', true);
    this.#build();
    const { store, selection, player } = app;
    const schedule = () => this.#schedule();
    store.on('change', schedule);
    selection.on('change', schedule);
    player.on('time', (t) => this.#updatePlayhead(t, player.playing));
    app.pool.on('info', schedule);
    new ResizeObserver(() => {
      this.#rulerDirty = true;
      this.#schedule();
    }).observe(this.scroll);
    this.#schedule();
  }

  get pps() {
    return this.#pps;
  }
  get snapEnabled() {
    return this.#snap;
  }

  // ---------------------------------------------------------------------------
  // Costruzione
  // ---------------------------------------------------------------------------

  #build() {
    const a = this.app;
    const btn = (ic, label, onClick, extra = {}) => h('button', { class: 'icon-btn', type: 'button', title: label, 'aria-label': label, onClick, ...extra }, icon(ic, 18));
    this.snapBtn = btn('magnet', 'Calamita (N)', () => this.toggleSnap(), { 'aria-pressed': String(this.#snap) });
    this.zoomRange = h('input', { type: 'range', min: '0', max: '100', step: '1', class: 'zoom-range', 'aria-label': 'Zoom timeline' });
    this.zoomRange.addEventListener('input', () => this.setZoom(this.#fromSlider(Number(this.zoomRange.value)), a.player.time));
    this.toolbar = h('div', { class: 'tl-toolbar', role: 'toolbar', 'aria-label': 'Strumenti timeline' },
      btn('undo', 'Annulla (Ctrl+Z)', () => a.actions.undo(), { id: 'btn-undo' }),
      btn('redo', 'Ripeti (Ctrl+Maiusc+Z)', () => a.actions.redo(), { id: 'btn-redo' }),
      h('span', { class: 'tb-sep' }),
      btn('scissors', 'Dividi alla testina (S)', () => a.actions.split(), { id: 'btn-split' }),
      btn('trimLeft', 'Elimina a sinistra della testina (Q)', () => a.actions.trimSide('left'), { id: 'btn-trim-left' }),
      btn('trimRight', 'Elimina a destra della testina (W)', () => a.actions.trimSide('right'), { id: 'btn-trim-right' }),
      btn('trash', 'Elimina (Canc)', () => a.actions.deleteSelected(), { id: 'btn-delete' }),
      btn('ripple', 'Elimina e chiudi lo spazio (Maiusc+Canc)', () => a.actions.rippleDeleteSelected(), { id: 'btn-ripple' }),
      btn('copy', 'Duplica (Ctrl+D)', () => a.actions.duplicate(), { id: 'btn-duplicate' }),
      h('span', { class: 'tb-sep' }),
      this.snapBtn,
      btn('flag', 'Aggiungi marcatore (M)', () => a.actions.addMarker(), { id: 'btn-marker' }),
      btn('plus', 'Aggiungi traccia', (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        contextMenu(r.left, r.bottom + 4, [
          { label: 'Nuova traccia video', icon: 'video', onClick: () => a.actions.addTrack('video') },
          { label: 'Nuova traccia audio', icon: 'music', onClick: () => a.actions.addTrack('audio') },
        ]);
      }, { id: 'btn-add-track' }),
      h('span', { class: 'tb-spacer' }),
      this.durLabel = h('span', { class: 'tl-dur', 'aria-label': 'Durata totale' }, '0:00'),
      btn('zoomOut', 'Riduci zoom (-)', () => this.zoomBy(0.8)),
      this.zoomRange,
      btn('zoomIn', 'Ingrandisci zoom (+)', () => this.zoomBy(1.25)),
      btn('fit', 'Adatta alla finestra (\\)', () => this.fit(), { id: 'btn-fit' }),
    );

    this.rulerCanvas = h('canvas', { class: 'tl-ruler', height: RULER_H });
    this.playheadHead = h('div', { class: 'playhead-head', title: 'Testina' });
    this.markersEl = h('div', { class: 'tl-markers' });
    this.rulerRow = h('div', { class: 'tl-ruler-row', style: { height: `${RULER_H}px` } },
      h('div', { class: 'tl-corner', style: { width: `${HEADER_W}px` } }, 'Tracce'),
      this.rulerCanvas,
      this.markersEl,
      this.playheadHead,
    );
    this.rowsEl = h('div', { class: 'tl-rows' });
    this.playheadLine = h('div', { class: 'playhead-line' });
    this.snapLine = h('div', { class: 'snap-line', hidden: true });
    this.dropLine = h('div', { class: 'drop-ghost', hidden: true });
    this.emptyHint = h('div', { class: 'tl-empty', hidden: true }, h('p', {}, 'Trascina qui i tuoi file oppure usa «+» nella libreria per iniziare.'));
    this.content = h('div', { class: 'tl-content' }, this.rulerRow, this.rowsEl, this.playheadLine, this.snapLine, this.dropLine, this.emptyHint);
    this.scroll = h('div', { class: 'tl-scroll', tabindex: '0', role: 'application', 'aria-label': 'Timeline di montaggio' }, this.content);
    this.el = h('section', { class: 'timeline', 'aria-label': 'Timeline' }, this.toolbar, this.scroll);

    this.scroll.addEventListener('pointerdown', (e) => this.#onPointerDown(e));
    this.scroll.addEventListener('contextmenu', (e) => this.#onContextMenu(e));
    this.scroll.addEventListener('dblclick', (e) => this.#onDblClick(e));
    this.scroll.addEventListener('scroll', () => {
      this.#rulerDirty = true;
      this.#schedule();
    }, { passive: true });
    this.scroll.addEventListener('wheel', (e) => this.#onWheel(e), { passive: false });
    this.scroll.addEventListener('dragover', (e) => this.#onDragOver(e));
    this.scroll.addEventListener('dragleave', () => (this.dropLine.hidden = true));
    this.scroll.addEventListener('drop', (e) => this.#onDrop(e));
  }

  // ---------------------------------------------------------------------------
  // Zoom / coordinate
  // ---------------------------------------------------------------------------

  #fromSlider(v) {
    return MIN_PPS * (MAX_PPS / MIN_PPS) ** (v / 100);
  }
  #toSlider(pps) {
    return (Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)) * 100;
  }
  get viewW() {
    return Math.max(100, this.scroll.clientWidth - HEADER_W);
  }

  setZoom(pps, anchorTime = this.app.player.time, anchorX = null) {
    const next = clamp(pps, MIN_PPS, MAX_PPS);
    if (Math.abs(next - this.#pps) < 1e-6) return;
    const x = anchorX ?? HEADER_W + anchorTime * this.#pps - this.scroll.scrollLeft;
    this.#pps = next;
    prefs.set('pps', next);
    this.#applyWidth();
    this.scroll.scrollLeft = Math.max(0, HEADER_W + anchorTime * next - x);
    this.#rulerDirty = true;
    this.#schedule();
  }
  zoomBy(f) {
    this.setZoom(this.#pps * f);
  }
  fit() {
    const dur = Math.max(1, projectDuration(this.app.store.project));
    this.setZoom((this.viewW - 60) / dur, 0, HEADER_W);
    this.scroll.scrollLeft = 0;
  }
  toggleSnap(v = !this.#snap) {
    this.#snap = v;
    prefs.set('snap', v);
    this.snapBtn.setAttribute('aria-pressed', String(v));
    this.snapBtn.classList.toggle('on', v);
  }

  #timeAt(clientX) {
    const r = this.scroll.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + this.scroll.scrollLeft - HEADER_W) / this.#pps);
  }

  #laneWidth() {
    const dur = projectDuration(this.app.store.project);
    return Math.max(this.viewW, dur * this.#pps + this.viewW * 0.6);
  }
  #applyWidth() {
    const w = this.#laneWidth();
    this.content.style.width = `${HEADER_W + w}px`;
    for (const r of this.#rowEls.values()) r.lane.style.width = `${w}px`;
    return w;
  }

  #onWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = this.scroll.getBoundingClientRect();
      const x = e.clientX - r.left;
      const t = this.#timeAt(e.clientX);
      this.setZoom(this.#pps * Math.exp(-e.deltaY * 0.0025), t, x);
    } else if (e.shiftKey && !e.deltaX) {
      e.preventDefault();
      this.scroll.scrollLeft += e.deltaY;
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering (riconciliazione)
  // ---------------------------------------------------------------------------

  #schedule() {
    if (this.#raf) return;
    this.#raf = requestAnimationFrame(() => {
      this.#raf = 0;
      this.render();
    });
  }

  render() {
    const { store, selection, player } = this.app;
    const p = store.project;
    const sel = new Set(selection.ids);
    const laneW = this.#applyWidth();

    // righe
    let top = 0;
    this.#rows = [];
    const seen = new Set();
    for (const track of p.tracks) {
      const rowH = ROW_H[track.type] ?? 52;
      let row = this.#rowEls.get(track.id);
      if (!row) {
        row = this.#makeRow(track);
        this.#rowEls.set(track.id, row);
      }
      seen.add(track.id);
      row.el.style.height = `${rowH}px`;
      row.el.style.top = `${top}px`;
      row.lane.style.width = `${laneW}px`;
      this.#syncHeader(row, track);
      row.el.classList.toggle('locked', track.locked);
      row.el.classList.toggle('hidden-track', track.hidden);
      row.el.classList.toggle('muted-track', track.muted);
      this.#rows.push({ id: track.id, type: track.type, top, h: rowH });
      this.#syncClips(row, track, sel, p);
      top += rowH;
    }
    for (const [id, row] of this.#rowEls) if (!seen.has(id)) {
      row.el.remove();
      this.#rowEls.delete(id);
    }
    this.rowsEl.style.height = `${top}px`;
    this.content.style.minHeight = `${top + RULER_H + 24}px`;
    // ordine DOM = ordine tracce; si tocca il DOM solo se l'ordine è cambiato
    const wanted = p.tracks.map((t) => this.#rowEls.get(t.id).el);
    if (wanted.some((el, i) => this.rowsEl.children[i] !== el) || this.rowsEl.children.length !== wanted.length) this.rowsEl.replaceChildren(...wanted);
    // elementi dei clip che non esistono più in nessuna traccia
    const aliveClips = new Set(allClips(p).map((c) => c.id));
    for (const [id, ce] of this.#clipEls) if (!aliveClips.has(id)) {
      ce.el.remove();
      this.#clipEls.delete(id);
    }

    this.emptyHint.hidden = allClips(p).length > 0;
    this.durLabel.textContent = formatDuration(projectDuration(p));
    this.zoomRange.value = String(Math.round(this.#toSlider(this.#pps)));
    this.snapBtn.classList.toggle('on', this.#snap);
    this.#renderMarkers(p);
    this.#updatePlayhead(player.time, false);
    this.#drawRuler();
    document.getElementById('btn-undo')?.toggleAttribute('disabled', !store.canUndo);
    document.getElementById('btn-redo')?.toggleAttribute('disabled', !store.canRedo);
  }

  #makeRow(track) {
    const lane = h('div', { class: 'tl-lane', 'data-track': track.id });
    const head = h('div', { class: 'tl-head' });
    const el = h('div', { class: `tl-row type-${track.type}`, 'data-track': track.id }, head, lane);
    return { el, lane, head, ctl: null };
  }

  #syncHeader(row, track) {
    const sig = [track.name, track.muted, track.hidden, track.locked, track.type].join('|');
    if (row.sig === sig) return;
    row.sig = sig;
    const a = this.app.actions;
    const tb = (ic, label, on, onClick) =>
      h('button', { class: `trk-btn${on ? ' on' : ''}`, type: 'button', title: label, 'aria-label': `${label}: ${track.name}`, 'aria-pressed': String(!!on), onClick }, icon(ic, 14));
    clear(row.head).append(
      h('div', { class: 'trk-name', title: `${track.name} (doppio clic per rinominare)`, ondblclick: () => a.renameTrack(track.id) }, icon(track.type === 'audio' ? 'music' : 'video', 14), h('span', {}, track.name)),
      h('div', { class: 'trk-btns' },
        track.type === 'video' ? tb(track.hidden ? 'eyeOff' : 'eye', track.hidden ? 'Mostra traccia' : 'Nascondi traccia', track.hidden, () => a.toggleTrackFlag(track.id, 'hidden')) : null,
        tb(track.muted ? 'volumeOff' : 'volume', track.muted ? 'Riattiva audio traccia' : 'Silenzia traccia', track.muted, () => a.toggleTrackFlag(track.id, 'muted')),
        tb(track.locked ? 'lock' : 'unlock', track.locked ? 'Sblocca traccia' : 'Blocca traccia', track.locked, () => a.toggleTrackFlag(track.id, 'locked')),
      ),
    );
  }

  #clipLabel(clip, media) {
    switch (clip.kind) {
      case 'text':
        return clip.text.content.split('\n')[0] || 'Testo';
      case 'sticker':
        return clip.sticker.emoji;
      case 'shape':
        return clip.shape.full ? 'Sfondo colorato' : 'Forma';
      case 'adjustment':
        return 'Livello di regolazione';
      default:
        return clip.name || media?.name || KIND_LABEL[clip.kind];
    }
  }

  #syncClips(row, track, sel, p) {
    const alive = new Set();
    const pps = this.#pps;
    for (const clip of track.clips) {
      alive.add(clip.id);
      let ce = this.#clipEls.get(clip.id);
      if (!ce) {
        ce = this.#makeClip(clip);
        this.#clipEls.set(clip.id, ce);
      }
      if (ce.el.parentNode !== row.lane) row.lane.append(ce.el);
      const selected = sel.has(clip.id);
      const media = p.media[clip.mediaId];
      const info = media ? this.app.pool.info(clip.mediaId) : null;
      const missing = !!media && !this.app.pool.has(clip.mediaId);
      const kfSig = selected ? JSON.stringify(Object.values(clip.keyframes).map((k) => k.map((q) => q.t))) : '';
      const sig = [clip.start, clip.duration, clip.in, clip.speed, clip.fadeIn, clip.fadeOut, clip.transition?.duration ?? 0, clip.muted || track.muted, selected, pps, kfSig, track.hidden, missing, clip.kind === 'text' ? clip.text.content : clip.kind === 'sticker' ? clip.sticker.emoji : '', clip.volume, !!info?.thumb, !!info?.peaks, track.type].join('|');
      if (ce.sig !== sig) {
        ce.sig = sig;
        const w = Math.max(2, clip.duration * pps);
        const st = ce.el.style;
        st.left = `${clip.start * pps}px`;
        st.width = `${w}px`;
        ce.el.classList.toggle('selected', selected);
        ce.el.classList.toggle('is-muted', clip.muted || track.muted);
        ce.el.classList.toggle('missing', missing);
        ce.el.classList.toggle('narrow', w < 46);
        ce.el.setAttribute('aria-selected', String(selected));
        ce.el.setAttribute('aria-label', `${this.#clipLabel(clip, media)}, ${KIND_LABEL[clip.kind]}, da ${formatDuration(clip.start, 1)} durata ${formatDuration(clip.duration, 1)}`);
        ce.name.textContent = this.#clipLabel(clip, media);
        ce.badge.textContent = clip.speed !== 1 ? `${+clip.speed.toFixed(2)}×` : '';
        ce.badge.hidden = clip.speed === 1;
        ce.media.style.backgroundImage = info?.thumb && (clip.kind === 'video' || clip.kind === 'image') ? `url(${info.thumb})` : '';
        ce.fi.style.width = `${clip.fadeIn * pps}px`;
        ce.fo.style.width = `${clip.fadeOut * pps}px`;
        ce.fi.hidden = !(clip.fadeIn > 0);
        ce.fo.hidden = !(clip.fadeOut > 0);
        ce.trans.hidden = !clip.transition;
        if (clip.transition) {
          ce.trans.style.width = `${Math.min(w, clip.transition.duration * pps)}px`;
          ce.trans.title = `Transizione: ${clip.transition.type}`;
        }
        this.#drawKeyframes(ce, clip, selected);
        this.#drawWave(ce, clip, info, w);
      }
    }
    for (const id of [...this.#clipEls.keys()]) {
      const ce = this.#clipEls.get(id);
      if (ce.el.parentNode === row.lane && !alive.has(id)) {
        ce.el.remove();
        this.#clipEls.delete(id);
      }
    }
  }

  #makeClip(clip) {
    const media = h('div', { class: 'clip-media' });
    const wave = h('canvas', { class: 'clip-wave' });
    const name = h('span', { class: 'clip-name' });
    const badge = h('span', { class: 'badge', hidden: true });
    const fi = h('div', { class: 'clip-fade fi', hidden: true });
    const fo = h('div', { class: 'clip-fade fo', hidden: true });
    const trans = h('div', { class: 'clip-trans', hidden: true });
    const kfs = h('div', { class: 'clip-kfs' });
    const el = h('div', { class: `clip kind-${clip.kind}`, 'data-id': clip.id, role: 'option', tabindex: '-1' },
      media, wave, fi, fo, trans, kfs,
      h('div', { class: 'clip-label' }, isVisualKind(clip.kind) ? icon(clip.kind === 'text' ? 'type' : clip.kind === 'image' ? 'image' : clip.kind === 'video' ? 'video' : 'sparkles', 12) : icon('music', 12), name, badge),
      h('div', { class: 'handle l', 'data-side': 'start', title: 'Ritaglia inizio' }),
      h('div', { class: 'handle r', 'data-side': 'end', title: 'Ritaglia fine' }),
    );
    return { el, media, wave, name, badge, fi, fo, trans, kfs, sig: '' };
  }

  #drawKeyframes(ce, clip, selected) {
    clear(ce.kfs);
    if (!selected) return;
    const times = new Set();
    for (const kfs of Object.values(clip.keyframes)) for (const k of kfs) if (k.t >= 0 && k.t <= clip.duration) times.add(Math.round(k.t * 1000) / 1000);
    for (const t of times) ce.kfs.append(h('span', { class: 'kf-dot', style: { left: `${t * this.#pps}px` } }));
  }

  #drawWave(ce, clip, info, widthPx) {
    const c = ce.wave;
    const peaks = info?.peaks;
    const show = peaks && (clip.kind === 'audio' || clip.kind === 'video');
    c.hidden = !show;
    if (!show) return;
    const w = Math.min(4096, Math.max(2, Math.round(widthPx)));
    const hgt = clip.kind === 'audio' ? 38 : 16;
    if (c.width !== w) c.width = w;
    if (c.height !== hgt) c.height = hgt;
    c.style.width = `${widthPx}px`;
    c.style.height = `${hgt}px`;
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, hgt);
    g.fillStyle = clip.kind === 'audio' ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.65)';
    const span = clip.duration * clip.speed;
    const rate = info.peaksRate ?? 50;
    for (let x = 0; x < w; x++) {
      const t0 = clip.in + (x / w) * span;
      const t1 = clip.in + ((x + 1) / w) * span;
      const i0 = Math.floor(t0 * rate);
      const i1 = Math.max(i0 + 1, Math.ceil(t1 * rate));
      let m = 0;
      for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      const bar = Math.max(1, (m / 255) ** 0.7 * hgt);
      g.fillRect(x, (hgt - bar) / 2, 1, bar);
    }
  }

  #renderMarkers(p) {
    clear(this.markersEl);
    for (const m of p.markers) {
      this.markersEl.append(h('button', { class: 'marker', type: 'button', style: { left: `${HEADER_W + m.time * this.#pps - 5}px` }, title: m.label || `Marcatore ${formatDuration(m.time, 1)}`, 'data-id': m.id, 'aria-label': `Marcatore a ${formatDuration(m.time, 1)}` }, icon('flag', 11)));
    }
  }

  #updatePlayhead(t, following) {
    const x = HEADER_W + t * this.#pps;
    this.playheadLine.style.transform = `translateX(${x}px)`;
    this.playheadHead.style.transform = `translateX(${x - 7}px)`;
    if (following && !this.#drag) {
      const left = this.scroll.scrollLeft;
      const right = left + this.scroll.clientWidth;
      if (x > right - 40 || x < left + HEADER_W) this.scroll.scrollLeft = Math.max(0, x - HEADER_W - this.viewW * 0.15);
    }
  }

  ensureVisible(t) {
    const x = HEADER_W + t * this.#pps;
    const left = this.scroll.scrollLeft + HEADER_W;
    const right = this.scroll.scrollLeft + this.scroll.clientWidth;
    if (x < left || x > right) this.scroll.scrollLeft = Math.max(0, x - HEADER_W - this.viewW * 0.3);
  }

  // ---- righello ---------------------------------------------------------------

  #drawRuler() {
    const c = this.rulerCanvas;
    const vw = this.viewW;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(vw);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(RULER_H * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(RULER_H * dpr);
    }
    c.style.width = `${w}px`;
    c.style.height = `${RULER_H}px`;
    c.style.left = `${HEADER_W}px`;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, RULER_H);
    const css = getComputedStyle(this.el);
    const fg = css.getPropertyValue('--text-dim').trim() || '#999';
    const line = css.getPropertyValue('--border-strong').trim() || '#555';
    const pps = this.#pps;
    const t0 = this.scroll.scrollLeft / pps;
    const t1 = t0 + w / pps;
    let step = NICE_STEPS.find((s) => s * pps >= 72) ?? 3600;
    const minor = step >= 10 ? step / 5 : step >= 1 ? step / 5 : step / 2;
    g.font = '10px system-ui, sans-serif';
    g.textBaseline = 'top';
    g.strokeStyle = line;
    g.fillStyle = fg;
    g.beginPath();
    // si itera sull'indice del tick (niente accumulo di errori in virgola mobile)
    for (let i = Math.floor(t0 / minor); i * minor <= t1 + minor; i++) {
      const t = Math.round(i * minor * 1e6) / 1e6;
      const x = Math.round(t * pps - this.scroll.scrollLeft) + 0.5;
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      g.moveTo(x, RULER_H);
      g.lineTo(x, major ? RULER_H - 11 : RULER_H - 5);
      if (major && x > 2) {
        const fps = this.app.store.project.settings.fps;
        const label = step < 1 ? `${Math.floor(t)}s ${Math.round((t % 1) * fps)}f` : formatDuration(t);
        g.fillText(label, x + 3, 4);
      }
    }
    g.stroke();
    this.#rulerDirty = false;
  }

  // ---------------------------------------------------------------------------
  // Interazione con il puntatore
  // ---------------------------------------------------------------------------

  #rowAtY(clientY) {
    const r = this.rowsEl.getBoundingClientRect();
    const y = clientY - r.top;
    for (let i = 0; i < this.#rows.length; i++) if (y >= this.#rows[i].top && y < this.#rows[i].top + this.#rows[i].h) return i;
    return y < 0 ? 0 : this.#rows.length - 1;
  }

  #onPointerDown(e) {
    if (e.button !== 0) return;
    const a = this.app;
    const target = e.target;
    if (target.closest('.tl-head') || target.closest('.tl-corner')) return;
    const markerEl = target.closest('.marker');
    if (markerEl) {
      const m = a.store.project.markers.find((x) => x.id === markerEl.dataset.id);
      if (m) a.player.seek(m.time);
      return;
    }
    const handle = target.closest('.handle');
    const clipEl = target.closest('.clip');
    if (clipEl) {
      const id = clipEl.dataset.id;
      const f = findClip(a.store.project, id);
      if (!f) return;
      if (f.track.locked) {
        a.toast('La traccia è bloccata', { type: 'warn' });
        a.selection.set([id]);
        return;
      }
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      const wasSelected = a.selection.has(id);
      if (additive) a.selection.toggle(id);
      else if (!wasSelected) a.selection.set([id]);
      if (!a.selection.has(id)) return;
      e.preventDefault();
      this.scroll.focus({ preventScroll: true });
      this.#startDrag(e, handle ? 'trim' : 'move', id, handle?.dataset.side, !additive && wasSelected);
      return;
    }
    // righello o corsia vuota: scrub
    if (target.closest('.tl-ruler-row') || target.closest('.tl-lane') || target.closest('.playhead-head')) {
      if (!target.closest('.tl-ruler-row') && !e.shiftKey) a.selection.clear();
      this.scroll.focus({ preventScroll: true });
      this.#startScrub(e);
    }
  }

  #startScrub(e) {
    const a = this.app;
    a.player.pause();
    const move = (ev) => {
      const t = this.#timeAt(ev.clientX);
      a.player.seek(this.#snapTime(t, null, true));
      this.#autoScrollFrom(ev);
    };
    this.#drag = { type: 'scrub' };
    move(e);
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      this.#drag = null;
      this.#auto = null;
      this.snapLine.hidden = true;
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }

  #snapTime(t, exclude, force = false) {
    if (!this.#snap && !force) return t;
    const pts = snapPoints(this.app.store.project, { exclude, playhead: null });
    const r = snapValue(pts, t, SNAP_PX / this.#pps);
    return r.time;
  }

  #startDrag(e, type, id, side, collapseOnClick) {
    const a = this.app;
    const base = a.store.project;
    const ids = type === 'trim' ? [id] : [...a.selection.ids];
    const f = findClip(base, id);
    const startX = e.clientX;
    const startY = e.clientY;
    const baseRowIdx = base.tracks.findIndex((t) => t.id === f.track.id);
    const clip0 = { start: f.clip.start, end: clipEnd(f.clip) };
    const pts = this.#snap ? snapPoints(base, { exclude: new Set(ids), playhead: a.player.time }) : null;
    const state = { type, id, ids, side, base, moved: false, label: type === 'trim' ? 'Ritaglia clip' : ids.length > 1 ? 'Sposta clip' : 'Sposta clip' };
    this.#drag = state;
    let last = e;

    const apply = (ev) => {
      last = ev;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!state.moved) {
        if (Math.hypot(dx, dy) < 4) return;
        state.moved = true;
        a.store.beginGesture(state.label);
        this.scroll.classList.add('dragging');
      }
      let dt = dx / this.#pps;
      let snapped = null;
      if (type === 'move') {
        if (pts) {
          const s = snapValue(pts, clip0.start + dt, SNAP_PX / this.#pps);
          const en = snapValue(pts, clip0.end + dt, SNAP_PX / this.#pps);
          const ds = s.snapped ? Math.abs(s.time - (clip0.start + dt)) : Infinity;
          const de = en.snapped ? Math.abs(en.time - (clip0.end + dt)) : Infinity;
          if (ds <= de && s.snapped) {
            dt = s.time - clip0.start;
            snapped = s.time;
          } else if (en.snapped) {
            dt = en.time - clip0.end;
            snapped = en.time;
          }
        }
        const offset = this.#rowAtY(ev.clientY) - baseRowIdx;
        const plan = planMove(base, ids, dt, offset);
        if (plan) {
          const r = a.store.previewGesture((p) => moveClips(p, ids, plan.delta, plan.offset));
          if (!r.ok) snapped = null;
          else if (snapped !== null && Math.abs(plan.delta - dt) > 1e-6) snapped = null;
        }
      } else {
        const orig = side === 'start' ? clip0.start : clip0.end;
        let edge = orig + dt;
        if (pts) {
          const s = snapValue(pts, edge, SNAP_PX / this.#pps);
          if (s.snapped) {
            edge = s.time;
            snapped = s.time;
          }
        }
        a.store.previewGesture((p) => trimClip(p, id, side, edge));
      }
      this.snapLine.hidden = snapped === null;
      if (snapped !== null) this.snapLine.style.transform = `translateX(${HEADER_W + snapped * this.#pps}px)`;
      this.#autoScrollFrom(ev);
    };
    const move = (ev) => apply(ev);
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', cancel);
      removeEventListener('keydown', key, true);
      this.scroll.classList.remove('dragging');
      this.snapLine.hidden = true;
      this.#auto = null;
      if (state.moved) a.store.commitGesture();
      else if (collapseOnClick) a.selection.set([id]);
      this.#drag = null;
      a.selection.sanitize(a.store.project);
    };
    const cancel = () => {
      a.store.cancelGesture();
      up();
    };
    const key = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        cancel();
      }
    };
    state.reapply = () => apply(last);
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', cancel);
    addEventListener('keydown', key, true);
  }

  /** Scorrimento automatico quando si trascina vicino ai bordi della timeline. */
  #autoScrollFrom(ev) {
    const r = this.scroll.getBoundingClientRect();
    const edge = 48;
    let dir = 0;
    if (ev.clientX > r.right - edge) dir = 1;
    else if (ev.clientX < r.left + HEADER_W + edge) dir = -1;
    if (!dir) {
      this.#auto = null;
      return;
    }
    const speed = Math.min(1, (dir > 0 ? ev.clientX - (r.right - edge) : r.left + HEADER_W + edge - ev.clientX) / edge) * 18;
    if (this.#auto) {
      this.#auto.dir = dir;
      this.#auto.speed = speed;
      return;
    }
    this.#auto = { dir, speed };
    const step = () => {
      if (!this.#auto) return;
      this.scroll.scrollLeft += this.#auto.dir * this.#auto.speed;
      this.#drag?.reapply?.();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  #onDblClick(e) {
    const clipEl = e.target.closest('.clip');
    if (clipEl) {
      const f = findClip(this.app.store.project, clipEl.dataset.id);
      if (f) this.app.player.seek(f.clip.start);
    }
  }

  #onContextMenu(e) {
    const a = this.app;
    const clipEl = e.target.closest('.clip');
    const headEl = e.target.closest('.tl-head');
    const markerEl = e.target.closest('.marker');
    if (markerEl) {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, [
        { label: 'Vai al marcatore', icon: 'flag', onClick: () => a.actions.goToMarker(markerEl.dataset.id) },
        { label: 'Rinomina…', onClick: () => a.actions.renameMarker(markerEl.dataset.id) },
        { label: 'Elimina marcatore', icon: 'trash', danger: true, onClick: () => a.actions.removeMarker(markerEl.dataset.id) },
      ]);
      return;
    }
    if (headEl) {
      e.preventDefault();
      const trackId = headEl.parentElement.dataset.track;
      contextMenu(e.clientX, e.clientY, [
        { label: 'Rinomina traccia…', onClick: () => a.actions.renameTrack(trackId) },
        { label: 'Sposta su', onClick: () => a.actions.moveTrack(trackId, -1) },
        { label: 'Sposta giù', onClick: () => a.actions.moveTrack(trackId, 1) },
        'sep',
        { label: 'Elimina traccia', icon: 'trash', danger: true, onClick: () => a.actions.removeTrack(trackId) },
      ]);
      return;
    }
    if (clipEl) {
      e.preventDefault();
      const id = clipEl.dataset.id;
      if (!a.selection.has(id)) a.selection.set([id]);
      const f = findClip(a.store.project, id);
      const isVideo = f?.clip.kind === 'video';
      contextMenu(e.clientX, e.clientY, [
        { label: 'Dividi alla testina', icon: 'scissors', shortcut: 'S', onClick: () => a.actions.split() },
        { label: 'Elimina a sinistra della testina', icon: 'trimLeft', shortcut: 'Q', onClick: () => a.actions.trimSide('left') },
        { label: 'Elimina a destra della testina', icon: 'trimRight', shortcut: 'W', onClick: () => a.actions.trimSide('right') },
        { label: 'Duplica', icon: 'copy', shortcut: 'Ctrl+D', onClick: () => a.actions.duplicate() },
        { label: 'Copia', shortcut: 'Ctrl+C', onClick: () => a.actions.copy() },
        { label: 'Taglia', shortcut: 'Ctrl+X', onClick: () => a.actions.cut() },
        'sep',
        { label: 'Estrai audio', icon: 'music', disabled: !isVideo, onClick: () => a.actions.detachAudio() },
        { label: 'Fotogramma fisso', icon: 'camera', disabled: !isVideo, onClick: () => a.actions.freezeFrame() },
        'sep',
        { label: 'Elimina', icon: 'trash', shortcut: 'Canc', danger: true, onClick: () => a.actions.deleteSelected() },
        { label: 'Elimina e chiudi lo spazio', icon: 'ripple', shortcut: 'Maiusc+Canc', danger: true, onClick: () => a.actions.rippleDeleteSelected() },
      ]);
    } else if (e.target.closest('.tl-lane')) {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, [
        { label: 'Incolla qui', icon: 'paste', shortcut: 'Ctrl+V', onClick: () => a.actions.paste(this.#timeAt(e.clientX)) },
        { label: 'Aggiungi marcatore', icon: 'flag', onClick: () => a.actions.addMarker(this.#timeAt(e.clientX)) },
      ]);
    }
  }

  // ---------------------------------------------------------------------------
  // Drag & drop dalla libreria / dal sistema
  // ---------------------------------------------------------------------------

  #dropInfo(e) {
    const lane = e.target.closest?.('.tl-lane');
    const t = this.#timeAt(e.clientX);
    return { lane, trackId: lane?.dataset.track ?? null, time: t };
  }

  #onDragOver(e) {
    const types = [...(e.dataTransfer?.types ?? [])];
    if (!types.includes('application/x-ciak-media') && !types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const info = this.#dropInfo(e);
    const row = info.lane && this.#rows.find((r) => r.id === info.trackId);
    if (row) {
      this.dropLine.hidden = false;
      this.dropLine.style.top = `${RULER_H + row.top}px`;
      this.dropLine.style.height = `${row.h}px`;
      this.dropLine.style.left = `${HEADER_W + info.time * this.#pps}px`;
    } else this.dropLine.hidden = true;
  }

  #onDrop(e) {
    const a = this.app;
    this.dropLine.hidden = true;
    const info = this.#dropInfo(e);
    const mediaId = e.dataTransfer?.getData('application/x-ciak-media');
    if (mediaId) {
      e.preventDefault();
      a.actions.addMediaClip(mediaId, { start: info.time, trackId: info.trackId });
      return;
    }
    if (e.dataTransfer?.files?.length) {
      e.preventDefault();
      a.actions.importFiles([...e.dataTransfer.files], { addToTimeline: true, start: info.time });
    }
  }
}
