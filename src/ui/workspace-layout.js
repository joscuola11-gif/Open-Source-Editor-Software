// Layout della finestra: disposizioni pronte, anteprima libera (finestrella da trascinare e ridimensionare),
// pannelli mostrabili/nascondibili e divisori da trascinare. Le scelte si ricordano fra una sessione e l'altra.
//
// Tutto passa da attributi `data-*` su .app e .workspace: lo stile sta in styles.css (solo ≥ 901 px:
// sugli schermi stretti resta la disposizione a colonne fissa, già pensata per quel formato).

import { h } from './dom.js';
import { icon } from './icons.js';
import { prefs } from './prefs.js';
import { contextMenu } from './overlays.js';
import { clamp } from '../core/util.js';

const KEY = 'workspace';
const MIN_PANEL = 240;
const MAX_PANEL = 560;
const FLOAT_MIN = { w: 340, h: 260 };
const WIDE = '(min-width: 901px)';

export const PRESETS = {
  classic: { label: 'Classica', hint: 'Libreria · anteprima · proprietà', state: { arrange: 'classic', lib: true, insp: true, timeline: true, tlBig: false } },
  'prev-left': { label: 'Anteprima a sinistra', hint: 'L’anteprima passa a sinistra', state: { arrange: 'prev-left', lib: true, insp: true, timeline: true, tlBig: false } },
  'prev-right': { label: 'Anteprima a destra', hint: 'L’anteprima passa a destra', state: { arrange: 'prev-right', lib: true, insp: true, timeline: true, tlBig: false } },
  big: { label: 'Anteprima grande', hint: 'Nasconde libreria e proprietà', state: { arrange: 'classic', lib: false, insp: false, timeline: true, tlBig: false } },
  cinema: { label: 'Solo anteprima', hint: 'Nasconde anche la timeline', state: { arrange: 'classic', lib: false, insp: false, timeline: false, tlBig: false } },
  timeline: { label: 'Timeline grande', hint: 'Più spazio per i clip', state: { arrange: 'classic', lib: true, insp: true, timeline: true, tlBig: true } },
};

const DEFAULT = () => ({
  arrange: 'classic',
  lib: true,
  insp: true,
  timeline: true,
  tlBig: false,
  libW: null,
  inspW: null,
  float: { on: false, x: null, y: null, w: 560, h: 420 },
});

function load() {
  const base = DEFAULT();
  const raw = prefs.get(KEY, null);
  if (!raw || typeof raw !== 'object') return base;
  const num = (v) => (Number.isFinite(v) ? v : null);
  if (['classic', 'prev-left', 'prev-right'].includes(raw.arrange)) base.arrange = raw.arrange;
  for (const k of ['lib', 'insp', 'timeline', 'tlBig']) if (typeof raw[k] === 'boolean') base[k] = raw[k];
  base.libW = num(raw.libW) === null ? null : clamp(raw.libW, MIN_PANEL, MAX_PANEL);
  base.inspW = num(raw.inspW) === null ? null : clamp(raw.inspW, MIN_PANEL, MAX_PANEL);
  const f = raw.float ?? {};
  base.float = { on: f.on === true && num(f.x) !== null && num(f.y) !== null, x: num(f.x), y: num(f.y), w: clamp(num(f.w) ?? 560, FLOAT_MIN.w, 4000), h: clamp(num(f.h) ?? 420, FLOAT_MIN.h, 4000) };
  return base;
}

export class WorkspaceLayout {
  constructor(app, button) {
    this.app = app;
    this.button = button;
    this.s = load();
    this.mq = matchMedia(WIDE);

    // barra del titolo della finestrella (visibile solo quando l'anteprima è libera)
    this.bar = h('div', { class: 'float-bar', role: 'toolbar', 'aria-label': 'Finestra dell’anteprima: trascina per spostarla', tabindex: '0', title: 'Trascina per spostare · doppio clic per riagganciare' },
      icon('grip', 14),
      h('span', { class: 'float-title' }, 'Anteprima'),
      h('button', { class: 'icon-btn small', type: 'button', id: 'btn-dock', title: 'Riaggancia l’anteprima', 'aria-label': 'Riaggancia l’anteprima', onClick: () => this.setFloat(false) }, icon('dock', 14)));
    app.preview.el.prepend(this.bar);
    this.#initBarDrag();
    // maniglie per ridimensionare la finestrella: angoli e bordi
    for (const dir of ['se', 'sw', 'e', 'w', 's']) app.preview.el.append(this.#makeHandle(dir));

    // divisori fra i pannelli
    this.libGrip = this.#makeGrip('lib', app.library.el);
    this.inspGrip = this.#makeGrip('insp', app.inspector.el);

    addEventListener('resize', () => {
      this.#clampFloat();
      this.#apply(false);
    });
    this.mq.addEventListener?.('change', () => this.#apply(false));
    this.#clampFloat(); // una posizione salvata con uno schermo più grande non deve lasciare la finestrella fuori vista
    this.#apply(false);
  }

  get floating() {
    return this.s.float.on && this.mq.matches;
  }

  // ---------------------------------------------------------------------------
  // Stato → DOM
  // ---------------------------------------------------------------------------

  #save() {
    prefs.set(KEY, this.s);
  }

  #apply(save = true) {
    const { shell, workspace, preview } = this.app;
    workspace.dataset.arrange = this.s.arrange;
    workspace.dataset.lib = this.s.lib ? 'on' : 'off';
    workspace.dataset.insp = this.s.insp ? 'on' : 'off';
    workspace.dataset.float = this.floating ? 'on' : 'off';
    shell.dataset.tl = this.s.timeline ? 'on' : 'off';
    shell.dataset.tlcap = this.s.tlBig ? 'big' : 'normal';
    if (this.s.libW) workspace.style.setProperty('--lib-w', `${this.s.libW}px`);
    else workspace.style.removeProperty('--lib-w');
    if (this.s.inspW) workspace.style.setProperty('--insp-w', `${this.s.inspW}px`);
    else workspace.style.removeProperty('--insp-w');

    preview.el.classList.toggle('floating', this.floating);
    if (this.floating) {
      const f = this.s.float;
      Object.assign(preview.el.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
    } else Object.assign(preview.el.style, { left: '', top: '', width: '', height: '' });
    if (save) this.#save();
    this.button.classList.toggle('on', this.floating || !this.#isDefault());
  }

  #isDefault() {
    const d = DEFAULT();
    return this.s.arrange === d.arrange && this.s.lib && this.s.insp && this.s.timeline && !this.s.tlBig && !this.s.float.on;
  }

  /** Disposizione pronta che corrisponde allo stato attuale (o null). */
  currentPreset() {
    if (this.s.float.on) return null;
    return Object.entries(PRESETS).find(([, p]) => Object.entries(p.state).every(([k, v]) => this.s[k] === v))?.[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Azioni
  // ---------------------------------------------------------------------------

  preset(id) {
    const p = PRESETS[id];
    if (!p) return;
    Object.assign(this.s, p.state);
    this.s.float.on = false;
    if (p.state.tlBig) this.app.setTimelineHeight(Math.round(innerHeight * 0.52));
    this.#apply();
  }

  toggle(key) {
    this.s[key] = !this.s[key];
    if (key === 'timeline' && this.s.timeline === false) this.s.tlBig = false;
    this.#apply();
  }

  setFloat(on) {
    if (on === this.s.float.on) return;
    if (on) {
      const r = this.app.preview.el.getBoundingClientRect();
      const f = this.s.float;
      // prima volta: parte dalla posizione e quasi dalla dimensione dell'anteprima agganciata
      if (f.x === null || f.y === null) {
        f.w = clamp(Math.round(r.width * 0.78), FLOAT_MIN.w, innerWidth - 40);
        f.h = clamp(Math.round(r.height * 0.9), FLOAT_MIN.h, innerHeight - 80);
        f.x = Math.round(r.left + (r.width - f.w) / 2);
        f.y = Math.round(r.top + 8);
      }
    }
    this.s.float.on = on;
    this.#clampFloat();
    this.#apply();
  }

  reset() {
    this.s = DEFAULT();
    this.app.setTimelineHeight(330);
    this.#apply();
  }

  /** La finestrella deve restare sempre raggiungibile: almeno parte della barra dentro la finestra. */
  #clampFloat() {
    const f = this.s.float;
    if (f.x === null || f.y === null) return;
    f.w = clamp(f.w, FLOAT_MIN.w, Math.max(FLOAT_MIN.w, innerWidth - 8));
    f.h = clamp(f.h, FLOAT_MIN.h, Math.max(FLOAT_MIN.h, innerHeight - 8));
    f.x = clamp(f.x, 120 - f.w, innerWidth - 120);
    f.y = clamp(f.y, 0, innerHeight - 40);
  }

  // ---------------------------------------------------------------------------
  // Trascinamento della finestrella
  // ---------------------------------------------------------------------------

  #initBarDrag() {
    const bar = this.bar;
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const f = this.s.float;
      const sx = e.clientX;
      const sy = e.clientY;
      const x0 = f.x;
      const y0 = f.y;
      bar.setPointerCapture(e.pointerId);
      bar.classList.add('dragging');
      const move = (ev) => {
        f.x = x0 + (ev.clientX - sx);
        f.y = y0 + (ev.clientY - sy);
        this.#clampFloat();
        Object.assign(this.app.preview.el.style, { left: `${f.x}px`, top: `${f.y}px` });
      };
      const up = () => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
        bar.classList.remove('dragging');
        this.#save();
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    });
    bar.addEventListener('dblclick', (e) => {
      if (!e.target.closest('button')) this.setFloat(false);
    });
    bar.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 100 : 20;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      this.s.float.x += d[0];
      this.s.float.y += d[1];
      this.#clampFloat();
      this.#apply();
    });
  }

  #makeHandle(dir) {
    const handle = h('div', { class: `float-handle h-${dir}`, 'data-dir': dir, 'aria-hidden': 'true' });
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const f = this.s.float;
      const { x: x0, y: y0, w: w0, h: h0 } = f;
      const sx = e.clientX;
      const sy = e.clientY;
      handle.setPointerCapture(e.pointerId);
      const el = this.app.preview.el;
      el.classList.add('resizing');
      const move = (ev) => {
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        if (dir.includes('e')) f.w = clamp(w0 + dx, FLOAT_MIN.w, Math.max(FLOAT_MIN.w, innerWidth - x0));
        if (dir.includes('w')) {
          f.w = clamp(w0 - dx, FLOAT_MIN.w, Math.max(FLOAT_MIN.w, x0 + w0));
          f.x = x0 + w0 - f.w;
        }
        if (dir.includes('s')) f.h = clamp(h0 + dy, FLOAT_MIN.h, Math.max(FLOAT_MIN.h, innerHeight - y0));
        Object.assign(el.style, { left: `${f.x}px`, width: `${f.w}px`, height: `${f.h}px` });
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        el.classList.remove('resizing');
        this.#clampFloat();
        this.#apply();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    return handle;
  }

  // ---------------------------------------------------------------------------
  // Divisori dei pannelli laterali
  // ---------------------------------------------------------------------------

  #makeGrip(panel, host) {
    const grip = h('div', { class: 'col-grip', role: 'separator', 'aria-orientation': 'vertical', tabindex: '0', 'data-panel': panel, title: 'Trascina per ridimensionare il pannello', 'aria-label': panel === 'lib' ? 'Ridimensiona la libreria' : 'Ridimensiona le proprietà' });
    host.append(grip);
    /** +1 se il divisore sta sul bordo destro del pannello (trascinando a destra si allarga), -1 se sul sinistro. */
    const side = () => {
      const a = this.s.arrange;
      if (a === 'classic') return panel === 'lib' ? 1 : -1;
      if (a === 'prev-left') return -1;
      return 1;
    };
    grip.dataset.side = '';
    const width = () => Math.round(host.getBoundingClientRect().width);
    const set = (w) => {
      this.s[panel === 'lib' ? 'libW' : 'inspW'] = clamp(Math.round(w), MIN_PANEL, MAX_PANEL);
      this.#apply();
    };
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const sx = e.clientX;
      const w0 = width();
      const sg = side();
      grip.setPointerCapture(e.pointerId);
      grip.classList.add('dragging');
      const move = (ev) => set(w0 + sg * (ev.clientX - sx));
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        grip.classList.remove('dragging');
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
    grip.addEventListener('dblclick', () => {
      this.s[panel === 'lib' ? 'libW' : 'inspW'] = null; // larghezza predefinita
      this.#apply();
    });
    grip.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: -20, ArrowRight: 20 }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      set(width() + side() * d);
    });
    return grip;
  }

  // ---------------------------------------------------------------------------
  // Menu
  // ---------------------------------------------------------------------------

  openMenu() {
    const wide = this.mq.matches;
    const cur = this.currentPreset();
    const r = this.button.getBoundingClientRect();
    const mark = (on) => (on ? 'check' : undefined);
    const items = [
      { heading: 'Disposizione' },
      ...Object.entries(PRESETS).map(([id, p]) => ({ label: p.label, icon: mark(cur === id), disabled: !wide, onClick: () => this.preset(id) })),
      'sep',
      { heading: 'Anteprima' },
      { label: 'Anteprima libera (finestra mobile)', icon: mark(this.s.float.on && wide), disabled: !wide, onClick: () => this.setFloat(!this.s.float.on) },
      'sep',
      { heading: 'Pannelli' },
      { label: 'Libreria', icon: mark(this.s.lib), disabled: !wide, onClick: () => this.toggle('lib') },
      { label: 'Proprietà', icon: mark(this.s.insp), disabled: !wide, onClick: () => this.toggle('insp') },
      { label: 'Timeline', icon: mark(this.s.timeline), disabled: !wide, onClick: () => this.toggle('timeline') },
      'sep',
      { label: 'Ripristina il layout', icon: 'rotate', onClick: () => this.reset() },
    ];
    if (!wide) items.splice(1, 0, { heading: 'Disponibile su finestre più larghe di 900 px' });
    return contextMenu(r.right - 250, r.bottom + 6, items);
  }
}
