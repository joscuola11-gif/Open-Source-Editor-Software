// Pannello proprietà (destra): impostazioni del progetto, oppure proprietà del clip selezionato.
// I controlli non vengono ricostruiti durante le modifiche: si aggiornano con sync().

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { prefs } from './prefs.js';
import { actionButton, colorPicker, section, segmented, selectControl, slider, textControl, toggleControl } from './controls.js';
import { clamp, formatBytes, formatDuration } from '../core/util.js';
import { allClips, findClip, projectDuration, setSpeed, setTransition } from '../core/timeline.js';
import { ASPECTS, BLEND_MODES, EFFECTS, FILTERS, FONTS, FPS_OPTIONS, MASKS, SHAPES, MAX_SPEED, MIN_SPEED, SPEED_PRESETS } from '../core/presets.js';
import { ANIMATIONS, ENTER_EXIT_IDS, LOOPS, LOOP_IDS, transitionGroups } from '../core/animations.js';
import { EASING_LABELS, KEYFRAME_PROPS, removeKeyframeAt, setValueAt, valueAt } from '../core/keyframes.js';
import { isVisualKind } from '../core/project.js';
import { LAYOUTS } from '../core/layouts.js';
import { CAMERA_MOVES } from '../core/camera.js';
import { speedCurveEditor } from './speed-curve.js';
import { CURVE_POINTS, HSL_BANDS, WHEELS } from '../core/grade.js';
import { KARAOKE_MODES } from '../core/karaoke.js';
import { SILENCE_DEFAULTS, findSilences, timelineRanges } from '../core/silence.js';
import { VOICE_EFFECTS } from '../core/audio-fx.js';

const TABS = {
  video: [['video', 'Video'], ['audio', 'Audio'], ['speed', 'Velocità'], ['anim', 'Animazione'], ['adjust', 'Regolazione'], ['fx', 'Effetti']],
  image: [['video', 'Immagine'], ['anim', 'Animazione'], ['adjust', 'Regolazione'], ['fx', 'Effetti']],
  text: [['text', 'Testo'], ['video', 'Video'], ['anim', 'Animazione'], ['fx', 'Effetti']],
  sticker: [['item', 'Adesivo'], ['video', 'Video'], ['anim', 'Animazione'], ['fx', 'Effetti']],
  shape: [['item', 'Forma'], ['video', 'Video'], ['anim', 'Animazione'], ['fx', 'Effetti']],
  adjustment: [['adjust', 'Regolazione'], ['fx', 'Effetti'], ['video', 'Maschera']],
  audio: [['audio', 'Audio'], ['speed', 'Velocità']],
};

const PROP_LABEL = { x: 'Posizione X', y: 'Posizione Y', scale: 'Scala', rotation: 'Rotazione', opacity: 'Opacità', volume: 'Volume' };
const PROP_UNIT = { x: 100, y: 100, scale: 100, rotation: 1, opacity: 100, volume: 100 };

/** Icona di una disposizione: i riquadri disegnati in piccolo. */
function layoutIcon(lay) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 28');
  svg.setAttribute('width', '48');
  svg.setAttribute('height', '28');
  svg.setAttribute('aria-hidden', 'true');
  const frame = document.createElementNS(NS, 'rect');
  for (const [k, v] of Object.entries({ x: 0.5, y: 0.5, width: 47, height: 27, rx: 3, fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.35 })) frame.setAttribute(k, v);
  svg.append(frame);
  lay.cells.forEach((c, i) => {
    const r = document.createElementNS(NS, 'rect');
    for (const [k, v] of Object.entries({ x: 1.5 + c.x * 45, y: 1.5 + c.y * 25, width: Math.max(2, c.w * 45 - 1), height: Math.max(2, c.h * 25 - 1), rx: 1.5, fill: 'currentColor', 'fill-opacity': i === 0 ? 0.5 : 0.85 })) r.setAttribute(k, v);
    svg.append(r);
  });
  return svg;
}

export class Inspector {
  #controls = [];
  #hslBand = 'red';
  #fx = { kind: 'noise', amount: 70, semitones: 0, target: -16, every: 1 };
  #sil = { threshold: SILENCE_DEFAULTS.threshold * 100, minSilence: SILENCE_DEFAULTS.minSilence, keep: SILENCE_DEFAULTS.keep, all: true };
  #key = '';
  #tab = {};
  #lastSync = 0;

  constructor(app) {
    this.app = app;
    const { store, selection, player } = app;
    this.head = h('header', { class: 'insp-head' });
    this.tabsEl = h('div', { class: 'insp-tabs', role: 'tablist' });
    this.body = h('div', { class: 'insp-body' });
    this.el = h('aside', { class: 'inspector', 'aria-label': 'Proprietà' }, this.head, this.tabsEl, this.body);
    const ctx = {
      store,
      clipId: () => this.clipId,
      local: () => {
        const f = this.clipId ? findClip(store.project, this.clipId) : null;
        return f ? clamp(player.time - f.clip.start, 0, f.clip.duration) : 0;
      },
    };
    this.ctx = ctx;
    this.clipId = null;
    store.on('change', () => this.#onChange());
    selection.on('change', () => this.#onChange());
    player.on('time', () => {
      const now = performance.now();
      if (player.playing && now - this.#lastSync < 250) return;
      this.#lastSync = now;
      this.#sync();
    });
    this.#onChange();
  }

  /** Ricostruisce il pannello (es. dopo il caricamento di un font). */
  refresh() {
    this.#key = '';
    this.#onChange();
  }

  focusText() {
    const ta = this.body.querySelector('textarea');
    if (ta) {
      ta.focus();
      ta.select();
    }
  }

  // ---------------------------------------------------------------------------

  #onChange() {
    const { store, selection } = this.app;
    const p = store.project;
    const ids = selection.ids.filter((id) => findClip(p, id));
    let key;
    let clip = null;
    if (ids.length === 1) {
      clip = findClip(p, ids[0]).clip;
      this.clipId = clip.id;
      const tabs = TABS[clip.kind];
      const tab = tabs.some(([id]) => id === this.#tab[clip.kind]) ? this.#tab[clip.kind] : tabs[0][0];
      const parts = [clip.effects.map((e) => e.id).join(',')];
      if (tab === 'anim') parts.push(Object.entries(clip.keyframes).map(([k, v]) => `${k}${v.length}:${v.map((q) => q.e).join('')}`).join(','), clip.transition?.type ?? '');
      if (tab === 'text') parts.push(this.app.fontsVersion);
      if (tab === 'audio') parts.push(this.app.pool.info(clip.mediaId)?.peaks ? 'a' : '-');
      key = `c:${clip.id}:${tab}:${parts.join(';')}`;
    } else if (ids.length > 1) {
      this.clipId = null;
      key = `m:${ids.join(',')}`;
    } else {
      this.clipId = null;
      key = 'p';
    }
    if (key !== this.#key) {
      this.#key = key;
      this.#rebuild(ids, clip);
    }
    this.#sync();
  }

  #sync() {
    const { store } = this.app;
    if (this.clipId) {
      const f = findClip(store.project, this.clipId);
      if (!f) return;
      const local = this.ctx.local();
      for (const c of this.#controls) c.sync(f.clip, local);
    } else for (const c of this.#controls) c.sync(null, 0);
  }

  #add(ctl) {
    this.#controls.push(ctl);
    return ctl.el;
  }

  #rebuild(ids, clip) {
    this.#controls = [];
    clear(this.head);
    clear(this.tabsEl);
    clear(this.body);
    if (ids.length === 0) return this.#projectPanel();
    if (ids.length > 1) return this.#multiPanel(ids);
    const tabs = TABS[clip.kind];
    const cur = tabs.some(([id]) => id === this.#tab[clip.kind]) ? this.#tab[clip.kind] : tabs[0][0];
    const names = { video: 'Video', audio: 'Audio', image: 'Immagine', text: 'Testo', shape: 'Forma', sticker: 'Adesivo', adjustment: 'Livello di regolazione' };
    this.head.append(h('h2', {}, names[clip.kind]), h('span', { class: 'insp-sub', title: clip.name }, clip.name || ''));
    for (const [id, label] of tabs) {
      this.tabsEl.append(h('button', {
        class: `tab${id === cur ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(id === cur), 'data-tab': id,
        onClick: () => {
          this.#tab[clip.kind] = id;
          this.#key = '';
          this.#onChange();
        },
      }, label));
    }
    const builder = { video: () => this.#videoTab(clip), audio: () => this.#audioTab(clip), speed: () => this.#speedTab(clip), anim: () => this.#animTab(clip), adjust: () => this.#adjustTab(clip), fx: () => this.#fxTab(clip), text: () => this.#textTab(clip), item: () => this.#itemTab(clip) }[cur];
    this.body.append(...builder());
  }

  S(opts) {
    return this.#add(slider(this.ctx, opts));
  }

  // ---------------------------------------------------------------------------
  // Progetto (nessuna selezione)
  // ---------------------------------------------------------------------------

  #projectPanel() {
    const { store, actions, pool } = this.app;
    const p = store.project;
    this.head.append(h('h2', {}, 'Progetto'), h('span', { class: 'insp-sub' }, 'Nessun clip selezionato'));
    const name = h('input', { type: 'text', class: 'text-input', id: 'project-name', 'aria-label': 'Nome progetto', maxlength: 120 });
    name.addEventListener('input', () => store.commit('Rinomina progetto', (d) => { d.name = name.value.slice(0, 120) || 'Progetto senza nome'; }, { coalesce: 'proj-name' }));
    const aspects = h('div', { class: 'aspect-grid', role: 'group', 'aria-label': 'Formato' }, ASPECTS.map((a) => {
      const w = 28;
      const hh = Math.round((w * a.height) / a.width);
      return h('button', { class: 'aspect-btn', type: 'button', 'data-aspect': a.id, title: a.label, onClick: () => actions.setAspect(a) },
        h('span', { class: 'aspect-shape', style: { width: `${a.width >= a.height ? w : Math.round((w * a.width) / a.height)}px`, height: `${a.width >= a.height ? hh : w}px` } }), h('span', {}, a.id));
    }));
    const fps = h('select', { 'aria-label': 'Fotogrammi al secondo', id: 'project-fps' }, FPS_OPTIONS.map((f) => h('option', { value: f }, `${f} fps`)));
    fps.addEventListener('change', () => actions.setFps(+fps.value));
    const bg = h('input', { type: 'color', 'aria-label': 'Colore di sfondo' });
    bg.addEventListener('input', () => {
      if (!store.inGesture) store.beginGesture('Sfondo progetto');
      store.previewGesture((d) => { d.settings.background = bg.value; });
    });
    bg.addEventListener('change', () => store.commitGesture());
    const stats = h('dl', { class: 'stats' });
    this.body.append(
      section('Generale', [
        h('div', { class: 'ctl text' }, h('label', { class: 'ctl-label' }, 'Nome'), name),
        h('div', { class: 'ctl select' }, h('label', { class: 'ctl-label' }, 'Frequenza'), fps),
        h('div', { class: 'ctl color' }, h('label', { class: 'ctl-label' }, 'Sfondo'), bg),
      ]),
      section('Formato del video', [aspects, h('p', { class: 'hint' }, 'Cambiando formato i clip restano adattati al nuovo canvas.')]),
      section('Informazioni', [stats]),
      section('File', [
        h('div', { class: 'btn-row wrap' },
          actionButton({ label: 'Nuovo', icon: 'file', onClick: () => actions.newProject() }),
          actionButton({ label: 'Apri…', icon: 'folder', onClick: () => actions.openPackage() }),
          actionButton({ label: 'Salva .ciak', icon: 'download', onClick: () => actions.savePackage() })),
        h('div', { class: 'btn-row wrap' }, h('button', { class: 'btn small primary', type: 'button', id: 'btn-projects', title: 'Salva, riapri, duplica ed elimina i tuoi progetti', onClick: () => actions.openProjects() }, icon('folder', 14), 'I miei progetti'), h('button', { class: 'btn small', type: 'button', id: 'btn-save-template', title: 'Conserva questo montaggio come modello da riusare con altri video', onClick: () => actions.saveCurrentAsTemplate() }, icon('layout', 14), 'Salva come modello')),
        h('p', { class: 'hint' }, 'Il progetto si salva da solo nel browser. Il file .ciak contiene progetto e media, per spostarlo su un altro computer.'),
      ]),
    );
    this.#controls.push({
      el: null,
      sync: () => {
        const d = store.project;
        if (document.activeElement !== name) name.value = d.name;
        fps.value = String(d.settings.fps);
        bg.value = d.settings.background;
        for (const b of aspects.children) b.classList.toggle('on', ASPECTS.find((a) => a.id === b.dataset.aspect)?.width === d.settings.width && ASPECTS.find((a) => a.id === b.dataset.aspect)?.height === d.settings.height);
        const size = Object.values(d.media).reduce((s, m) => s + (m.size || 0), 0);
        clear(stats).append(
          ...[['Risoluzione', `${d.settings.width}×${d.settings.height}`], ['Durata', formatDuration(projectDuration(d))], ['Clip', String(allClips(d).length)], ['Tracce', String(d.tracks.length)], ['Media', `${Object.keys(d.media).length} · ${formatBytes(size)}`]].flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]),
        );
      },
    });
    void pool;
  }

  // ---------------------------------------------------------------------------
  // Selezione multipla
  // ---------------------------------------------------------------------------

  #multiPanel(ids) {
    const { store, actions } = this.app;
    this.head.append(h('h2', {}, `${ids.length} clip selezionati`), h('span', { class: 'insp-sub' }, 'Le modifiche si applicano a tutti'));
    const multi = (label, min, max, get, set, unit = '%', pick = () => true) => {
      const range = h('input', { type: 'range', min, max, step: 1, 'aria-label': label });
      const apply = () => {
        if (!store.inGesture) store.beginGesture(label);
        store.previewGesture((p) => {
          for (const id of ids) {
            const c = findClip(p, id)?.clip;
            if (c && pick(c)) set(c, +range.value);
          }
        });
      };
      range.addEventListener('input', apply);
      range.addEventListener('change', () => store.commitGesture());
      return { el: h('div', { class: 'ctl slider' }, h('label', { class: 'ctl-label' }, label), range, h('span', { class: 'num-wrap' }, h('span', { class: 'unit' }, unit))), sync() {
        const f = findClip(store.project, ids[0]);
        if (f && document.activeElement !== range) range.value = String(get(f.clip));
      } };
    };
    this.body.append(
      section('Proprietà comuni', [
        this.#add(multi('Opacità', 0, 100, (c) => c.transform.opacity * 100, (c, v) => { c.transform.opacity = v / 100; }, '%', (c) => isVisualKind(c.kind))),
        this.#add(multi('Volume', 0, 200, (c) => c.volume * 100, (c, v) => { c.volume = v / 100; }, '%', (c) => c.kind === 'video' || c.kind === 'audio')),
      ]),
      this.#layoutSection(true),
      section('Azioni', [
        h('div', { class: 'btn-row wrap' },
          actionButton({ label: 'Duplica', icon: 'copy', onClick: () => actions.duplicate() }),
          actionButton({ label: 'Copia', onClick: () => actions.copy() }),
          actionButton({ label: 'Elimina', icon: 'trash', danger: true, onClick: () => actions.deleteSelected() })),
      ]),
    );
  }

  // ---------------------------------------------------------------------------
  // Video / trasformazione
  // ---------------------------------------------------------------------------

  /** Disposizioni (schermo diviso / PiP) per i clip selezionati. */
  #layoutSection(open) {
    const { actions } = this.app;
    const fillSel = h('select', { id: 'sel-layout-fill', 'aria-label': 'Come riempire i riquadri' }, h('option', { value: 'cover' }, 'Riempi (ritaglia i bordi)'), h('option', { value: 'contain' }, 'Adatta (mostra tutto)'));
    return section('Disposizione (schermo diviso / PiP)', [
      h('p', { class: 'hint' }, 'Seleziona più clip (Ctrl o Maiusc + clic): il primo va nel primo riquadro, e così via. I clip in fila vengono messi insieme, ognuno su una traccia.'),
      h('div', { class: 'ctl select' }, h('label', { class: 'ctl-label' }, 'Riquadri'), fillSel),
      h('div', { class: 'layout-grid', role: 'group', 'aria-label': 'Disposizioni' }, LAYOUTS.map((lay) => h('button', { class: 'layout-btn', type: 'button', 'data-layout': lay.id, title: `${lay.label} (servono ${lay.min} clip)`, 'aria-label': lay.label, onClick: () => actions.applyLayout(lay.id, { fill: fillSel.value }) }, layoutIcon(lay)))),
    ], { open });
  }

  #videoTab(clip) {
    const { actions } = this.app;
    const out = [];
    if (clip.kind !== 'adjustment') {
      out.push(section('Trasformazione', [
        this.S({ label: 'Scala', min: 5, max: 400, step: 1, unit: '%', get: (c, t) => this.#val(c, 'scale', t) * 100, set: (c, v, t) => this.#set(c, 'scale', t, v / 100), kf: 'scale', def: 100 }),
        this.S({ label: 'Posizione X', min: -100, max: 100, step: 0.5, unit: '%', decimals: 1, get: (c, t) => this.#val(c, 'x', t) * 100, set: (c, v, t) => this.#set(c, 'x', t, v / 100), kf: 'x', def: 0 }),
        this.S({ label: 'Posizione Y', min: -100, max: 100, step: 0.5, unit: '%', decimals: 1, get: (c, t) => this.#val(c, 'y', t) * 100, set: (c, v, t) => this.#set(c, 'y', t, v / 100), kf: 'y', def: 0 }),
        this.S({ label: 'Rotazione', min: -180, max: 180, step: 1, unit: '°', get: (c, t) => this.#val(c, 'rotation', t), set: (c, v, t) => this.#set(c, 'rotation', t, v), kf: 'rotation', def: 0 }),
        this.S({ label: 'Opacità', min: 0, max: 100, step: 1, unit: '%', get: (c, t) => this.#val(c, 'opacity', t) * 100, set: (c, v, t) => this.#set(c, 'opacity', t, v / 100), kf: 'opacity', def: 100 }),
        h('div', { class: 'btn-row wrap' },
          actionButton({ label: 'Adatta', title: 'Adatta al canvas', onClick: () => actions.fitClip('fit') }),
          actionButton({ label: 'Riempi', title: 'Riempi il canvas', onClick: () => actions.fitClip('fill') }),
          actionButton({ label: 'Azzera', icon: 'rotate', onClick: () => actions.fitClip('reset') }),
          actionButton({ label: 'Ribalta ↔', icon: 'flipH', onClick: () => actions.flipClip('flipX') }),
          actionButton({ label: 'Ribalta ↕', icon: 'flipV', onClick: () => actions.flipClip('flipY') })),
      ]));
    }
    if (clip.kind === 'video' || clip.kind === 'image') out.push(this.#layoutSection(false));
    out.push(section('Fusione', [
      this.#add(selectControl(this.ctx, { label: 'Metodo', options: BLEND_MODES, get: (c) => c.blend, set: (c, v) => { c.blend = v; }, history: 'Metodo di fusione' })),
    ], { open: clip.kind === 'adjustment' ? false : true }));
    if (clip.kind === 'video' || clip.kind === 'image') {
      out.push(section('Ritaglio', ['l', 't', 'r', 'b'].map((side, i) =>
        this.S({ label: ['Sinistra', 'Alto', 'Destra', 'Basso'][i], min: 0, max: 90, step: 1, unit: '%', get: (c) => c.crop[side] * 100, set: (c, v) => { c.crop[side] = Math.min(0.95 - (side === 'l' ? c.crop.r : side === 'r' ? c.crop.l : side === 't' ? c.crop.b : c.crop.t), v / 100); }, def: 0, history: 'Ritaglio' })), { open: false }));
    }
    if (clip.kind === 'video' || clip.kind === 'image') {
      out.push(section('Sfondo dietro il clip', [
        this.#add(selectControl(this.ctx, { label: 'Tipo', options: [{ id: 'none', label: 'Nessuno' }, { id: 'blur', label: 'Sfocato (la stessa immagine)' }, { id: 'color', label: 'Colore' }], get: (c) => c.backdrop.mode, set: (c, v) => { c.backdrop.mode = v; }, history: 'Sfondo del clip' })),
        this.S({ label: 'Sfocatura', min: 0, max: 100, step: 1, unit: '%', get: (c) => c.backdrop.amount, set: (c, v) => { c.backdrop.amount = v; }, def: 60, history: 'Sfondo del clip' }),
        this.#add(colorPicker(this.ctx, { label: 'Colore', get: (c) => c.backdrop.color, set: (c, v) => { c.backdrop.color = v; }, history: 'Sfondo del clip' })),
        h('div', { class: 'btn-row wrap' }, actionButton({ label: 'Sfondo sfocato per tutti i clip', title: 'Riempie con una copia sfocata i lati vuoti di tutti i video e le foto', onClick: () => actions.setBackdropAll('blur') })),
        h('p', { class: 'hint' }, 'Quando un video orizzontale va in un formato verticale (o il contrario) i lati non restano neri: si vede la stessa immagine ingrandita e sfocata.'),
      ], { open: clip.backdrop.mode !== 'none' }));
    }
    if (clip.kind === 'video' && globalThis.ciakDesktop?.videoTool) {
      const tools = [
        ['reverse', 'Al contrario', 'Riproduce la parte usata del video all’indietro (con l’audio).'],
        ['stabilize', 'Stabilizza (meno tremolio)', 'Corregge le riprese a mano tremolanti; ingrandisce leggermente il quadro per nascondere i bordi.'],
        ['denoise', 'Riduci il disturbo', 'Toglie la grana di video girati con poca luce.'],
        ['enhance', 'Più nitido e pulito', 'Meno disturbo e più dettaglio e contrasto.'],
        ['deflicker', 'Togli lo sfarfallio', 'Per luci artificiali o time-lapse che lampeggiano.'],
        ['upscale', 'Ingrandisci 2×', 'Raddoppia la risoluzione con interpolazione di qualità (non crea dettagli che non esistono).'],
        ['smooth', 'Più fluido (60 fps)', 'Aggiunge fotogrammi intermedi: movimenti più morbidi. Lento.'],
        ['slowmo', 'Super rallentatore', 'Crea fotogrammi intermedi e porta la velocità a 0,25×: rallentatore senza scatti. Lento: usa clip brevi.'],
      ];
      const sel = h('select', { id: 'sel-video-tool', 'aria-label': 'Strumento video' }, tools.map(([id, l]) => h('option', { value: id }, l)));
      const hint = h('p', { class: 'hint', id: 'video-tool-hint' }, tools[0][2]);
      sel.addEventListener('change', () => { hint.textContent = tools.find((t) => t[0] === sel.value)?.[2] ?? ''; });
      out.push(section('Strumenti video (algoritmi classici)', [
        h('div', { class: 'ctl select' }, h('label', { class: 'ctl-label' }, 'Strumento'), sel),
        hint,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', id: 'btn-video-tool', onClick: () => this.app.actions.applyVideoTool({ clipId: this.clipId, tool: sel.value }) }, icon('wand', 14), 'Applica')),
        h('p', { class: 'hint' }, 'Sono elaborazioni classiche, non intelligenza artificiale. Il risultato è un nuovo file che sostituisce quello del clip (si annulla con un passo). Funzionano meglio su clip brevi.'),
      ], { open: false }));
    }
    out.push(section('Maschera', [
      this.#add(selectControl(this.ctx, { label: 'Forma', options: MASKS, get: (c) => c.mask.shape, set: (c, v) => { c.mask.shape = v; }, history: 'Maschera' })),
      this.S({ label: 'Dimensione', min: 5, max: 150, step: 1, unit: '%', get: (c) => c.mask.size * 100, set: (c, v) => { c.mask.size = v / 100; }, def: 60, history: 'Maschera' }),
      this.S({ label: 'Arrotondamento', min: 0, max: 100, step: 1, unit: '%', get: (c) => c.mask.roundness * 100, set: (c, v) => { c.mask.roundness = v / 100; }, def: 25, history: 'Maschera' }),
      this.#add(toggleControl(this.ctx, { label: 'Inverti maschera', get: (c) => c.mask.invert, set: (c, v) => { c.mask.invert = v; } })),
    ], { open: clip.mask.shape !== 'none' }));
    return out;
  }

  #val(c, prop, t) {
    return valueAt(c, prop, t);
  }
  #set(c, prop, t, v) {
    setValueAt(c, prop, t, v);
  }

  // ---------------------------------------------------------------------------
  // Audio / velocità
  // ---------------------------------------------------------------------------

  #audioTab(clip) {
    const { actions, pool } = this.app;
    const info = pool.info(clip.mediaId);
    const out = [
      section('Volume', [
        this.S({ label: 'Volume', min: 0, max: 200, step: 1, unit: '%', get: (c, t) => valueAt(c, 'volume', t) * 100, set: (c, v, t) => this.#set(c, 'volume', t, v / 100), kf: 'volume', def: 100 }),
        this.S({ label: 'Dissolvenza in', min: 0, max: 10, step: 0.1, unit: 's', decimals: 1, get: (c) => c.fadeIn, set: (c, v) => { c.fadeIn = Math.min(v, Math.max(0, c.duration - c.fadeOut)); }, def: 0, history: 'Dissolvenza audio' }),
        this.S({ label: 'Dissolvenza out', min: 0, max: 10, step: 0.1, unit: 's', decimals: 1, get: (c) => c.fadeOut, set: (c, v) => { c.fadeOut = Math.min(v, Math.max(0, c.duration - c.fadeIn)); }, def: 0, history: 'Dissolvenza audio' }),
        this.#add(toggleControl(this.ctx, { label: 'Silenzia questo clip', get: (c) => c.muted, set: (c, v) => { c.muted = v; } })),
      ]),
    ];
    out.push(this.#silenceSection(), this.#audioFxSection(), this.#loudnessBeatsSection());
    if (clip.kind === 'video') {
      out.push(section('Estrazione', [
        h('div', { class: 'btn-row' }, actionButton({ label: 'Estrai audio', icon: 'music', onClick: () => actions.detachAudio() })),
        h('p', { class: 'hint' }, info && !info.peaks ? 'Questo file non sembra contenere audio decodificabile.' : 'Crea un clip audio separato e silenzia quello originale del video.'),
      ]));
    }
    return out;
  }

  /** Pulizia e voci: riduzione del rumore, altezza del suono, effetti voce, togli/isola la voce. */
  #audioFxSection() {
    const f = this.#fx;
    const kinds = [
      { id: 'noise', label: 'Riduci il rumore di fondo', hint: 'Toglie fruscii e rumori costanti (ventola, ronzio, vento leggero).' },
      { id: 'pitch', label: 'Cambia l’altezza del suono', hint: 'Alza o abbassa il tono senza cambiare la velocità.' },
      ...Object.entries(VOICE_EFFECTS).map(([id, v]) => ({ id: `voice:${id}`, label: `Voce: ${v.label}`, hint: v.hint })),
      { id: 'removeVoice', label: 'Togli la voce da un brano', hint: 'Per brani stereo: elimina ciò che sta al centro (di solito la voce). Funziona bene solo se la voce è registrata al centro.' },
      { id: 'isolateVoice', label: 'Isola la voce (approssimato)', hint: 'Tiene ciò che sta al centro e nelle frequenze della voce: è un’approssimazione, non una separazione perfetta.' },
    ];
    const sel = h('select', { id: 'sel-audio-fx', 'aria-label': 'Effetto audio' }, kinds.map((k) => h('option', { value: k.id }, k.label)));
    const hint = h('p', { class: 'hint', id: 'audio-fx-hint' }, kinds[0].hint);
    const amount = h('div', { class: 'ctl slider', id: 'fx-amount-row' });
    const semis = h('div', { class: 'ctl slider', id: 'fx-semis-row' });
    const mk = (label, key, min, max, step, unit) => {
      const range = h('input', { type: 'range', min, max, step, 'aria-label': label });
      const num = h('input', { type: 'number', class: 'num', min, max, step, 'aria-label': `${label} (valore)` });
      const set = (v) => {
        const n = clamp(Number(v), min, max);
        if (!Number.isFinite(n)) return;
        f[key] = n;
        range.value = String(n);
        if (document.activeElement !== num) num.value = String(n);
      };
      range.value = String(f[key]);
      num.value = String(f[key]);
      range.addEventListener('input', () => set(range.value));
      num.addEventListener('change', () => set(num.value));
      return [h('label', { class: 'ctl-label' }, label), range, h('span', { class: 'num-wrap' }, num, h('span', { class: 'unit' }, unit))];
    };
    amount.append(...mk('Intensità', 'amount', 10, 100, 5, '%'));
    semis.append(...mk('Semitoni', 'semitones', -12, 12, 1, ''));
    const refresh = () => {
      const k = kinds.find((x) => x.id === sel.value);
      hint.textContent = k?.hint ?? '';
      amount.hidden = sel.value !== 'noise';
      semis.hidden = sel.value !== 'pitch';
    };
    sel.addEventListener('change', refresh);
    refresh();
    return section('Pulizia e voci', [
      h('div', { class: 'ctl select' }, h('label', { class: 'ctl-label' }, 'Effetto'), sel),
      amount,
      semis,
      hint,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', id: 'btn-audio-fx', onClick: () => {
        const v = sel.value;
        const base = { clipId: this.clipId, amount: f.amount, semitones: f.semitones };
        this.app.actions.applyAudioFx(v.startsWith('voice:') ? { ...base, kind: 'voice', id: v.slice(6) } : { ...base, kind: v });
      } }, icon('music', 14), 'Applica')),
      h('p', { class: 'hint' }, 'Il risultato è un nuovo file audio che sostituisce quello del clip (per i video: un clip audio separato, mentre l’audio originale si silenzia). Si annulla con un solo passo.'),
    ], { open: false });
  }

  /** Livello del volume e ritmo (battiti). */
  #loudnessBeatsSection() {
    const f = this.#fx;
    const target = h('select', { id: 'sel-target', 'aria-label': 'Livello desiderato' }, [[-16, 'Voce (−16 dB)'], [-14, 'Musica (−14 dB)'], [-20, 'Sottofondo (−20 dB)']].map(([v, l]) => h('option', { value: v }, l)));
    target.addEventListener('change', () => { f.target = Number(target.value); });
    const every = h('select', { id: 'sel-every', 'aria-label': 'Un taglio ogni' }, [[1, 'Ogni battito'], [2, 'Ogni 2 battiti'], [4, 'Ogni 4 battiti (una battuta)'], [8, 'Ogni 8 battiti']].map(([v, l]) => h('option', { value: v }, l)));
    every.addEventListener('change', () => { f.every = Number(every.value); });
    return section('Livello e ritmo', [
      h('div', { class: 'ctl select' }, h('label', { class: 'ctl-label' }, 'Livello'), target),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', id: 'btn-normalize', onClick: () => this.app.actions.normalizeClip({ clipId: this.clipId, targetDb: f.target }) }, 'Normalizza il volume')),
      h('p', { class: 'hint' }, 'Porta il volume medio al livello scelto senza far distorcere i picchi.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', id: 'btn-find-beats', onClick: () => this.app.actions.findBeats({ clipId: this.clipId }) }, 'Trova i battiti')),
      h('div', { class: 'ctl select' }, h('label', { class: 'ctl-label' }, 'Taglia'), every),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', id: 'btn-cut-beats', onClick: () => this.app.actions.cutOnBeats({ every: f.every }) }, icon('scissors', 14), 'Taglia a tempo di musica')),
      h('p', { class: 'hint' }, 'Prima segna i battiti di una musica (marcatori «Battito»), poi seleziona i clip video da dividere (o nessuno: si dividono tutti) e premi «Taglia a tempo». La calamita si aggancia ai battiti.'),
    ], { open: false });
  }

  /** Rimozione delle pause: soglia, durata minima e margine; mostra subito quante pause trova. */
  #silenceSection() {
    const info = h('p', { class: 'hint', id: 'silence-info' });
    const update = (clip) => {
      const c = clip ?? findClip(this.app.store.project, this.clipId)?.clip;
      const pk = c && this.app.pool.info(c.mediaId);
      if (!c) return;
      if (!pk?.peaks) {
        info.textContent = 'Analisi dell’audio non disponibile (file senza audio o ancora in analisi).';
        return;
      }
      const sil = findSilences(pk.peaks, pk.peaksRate, { from: c.in, to: c.in + c.duration * c.speed, threshold: this.#sil.threshold / 100, minSilence: this.#sil.minSilence, keep: this.#sil.keep });
      const rs = timelineRanges(this.app.store.project, c, sil);
      const total = rs.reduce((s, r) => s + (r.end - r.start), 0);
      info.textContent = rs.length ? `Trovate ${rs.length} pause per ${total.toFixed(1)} s in totale.` : 'Nessuna pausa trovata con queste impostazioni.';
      info.dataset.count = String(rs.length);
    };
    const local = (label, key, min, max, step, unit, decimals = 0) => {
      const range = h('input', { type: 'range', min, max, step, 'aria-label': label });
      const num = h('input', { type: 'number', class: 'num', min, max, step, 'aria-label': `${label} (valore)` });
      const set = (v) => {
        const n = clamp(Number(v), min, max);
        if (!Number.isFinite(n)) return;
        this.#sil[key] = n;
        range.value = String(n);
        if (document.activeElement !== num) num.value = String(Number(n.toFixed(decimals)));
        update();
      };
      range.value = String(this.#sil[key]);
      num.value = String(Number(this.#sil[key].toFixed(decimals)));
      range.addEventListener('input', () => set(range.value));
      num.addEventListener('change', () => set(num.value));
      return h('div', { class: 'ctl slider' }, h('label', { class: 'ctl-label' }, label), range, h('span', { class: 'num-wrap' }, num, h('span', { class: 'unit' }, unit)));
    };
    const all = h('input', { type: 'checkbox', id: 'silence-all', checked: this.#sil.all, 'aria-label': 'Taglia anche le altre tracce' });
    all.addEventListener('change', () => { this.#sil.all = all.checked; });
    this.#controls.push({ el: info, sync: (c) => update(c) });
    return section('Pause (silenzi)', [
      local('Silenzio sotto', 'threshold', 1, 30, 1, '%'),
      local('Pausa minima', 'minSilence', 0.2, 3, 0.1, 's', 1),
      local('Margine da lasciare', 'keep', 0, 0.5, 0.01, 's', 2),
      h('label', { class: 'ctl toggle' }, all, h('span', { class: 'switch' }), h('span', { class: 'ctl-label' }, 'Taglia anche le altre tracce (restano sincronizzate)')),
      info,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', id: 'btn-remove-silence', onClick: () => this.app.actions.removeSilences({ clipId: this.clipId, ...this.#sil }) }, icon('scissors', 14), 'Rimuovi le pause')),
    ], { open: false });
  }

  #speedTab(clip) {
    const { store } = this.app;
    const speed = this.S({
      label: 'Velocità', min: MIN_SPEED, max: MAX_SPEED, step: 0.05, unit: '×', decimals: 2, def: 1,
      get: (c) => c.speed, setProject: (p, id, v) => setSpeed(p, id, v), history: 'Velocità',
    });
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Velocità predefinite' }, SPEED_PRESETS.map((v) =>
      h('button', { class: 'chip', type: 'button', 'data-speed': v, onClick: () => { const r = store.commit('Velocità', (p) => setSpeed(p, this.clipId, v)); if (!r.ok) this.app.toast(r.error, { type: 'warn' }); } }, `${v}×`)));
    const info = h('p', { class: 'hint' });
    this.#controls.push({ el: info, sync: (c) => {
      if (!c) return;
      const src = c.duration * c.speed;
      info.textContent = `Durata sulla timeline: ${formatDuration(c.duration, 2)} · sorgente utilizzata: ${formatDuration(src, 2)}. Il resto della traccia si sposta di conseguenza.`;
      for (const b of chips.children) b.classList.toggle('on', Math.abs(+b.dataset.speed - c.speed) < 1e-3);
    } });
    const out = [section('Velocità costante', [speed, chips, info])];
    if (clip.kind === 'video') {
      out.push(section('Curva di velocità (accelerazioni e rallentamenti)', [
        speedCurveEditor({ span: clip.duration * clip.speed, duration: clip.duration, fps: store.project.settings.fps, onApply: (points, keepAudio) => this.app.actions.applySpeedRamp(points, { keepAudio }) }),
      ], { open: false }));
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Animazioni, transizione, keyframe
  // ---------------------------------------------------------------------------

  #animTab(clip) {
    const out = [];
    const animGroup = (side, title) => {
      const opts = [{ id: 'none', label: 'Nessuna' }, ...ENTER_EXIT_IDS.filter((id) => !ANIMATIONS[id].textOnly || clip.kind === 'text').map((id) => ({ id, label: ANIMATIONS[id].label }))];
      return section(title, [
        this.#add(selectControl(this.ctx, { label: 'Tipo', options: opts, get: (c) => c.anim[side]?.type ?? 'none', set: (c, v) => { c.anim[side] = v === 'none' ? null : { type: v, duration: Math.min(c.anim[side]?.duration ?? 0.6, c.duration) }; }, history: `Animazione ${side === 'in' ? 'di ingresso' : 'di uscita'}` })),
        this.S({ label: 'Durata', min: 0.1, max: 5, step: 0.1, unit: 's', decimals: 1, get: (c) => c.anim[side]?.duration ?? 0, set: (c, v) => { if (c.anim[side]) c.anim[side].duration = Math.min(v, c.duration); }, history: 'Durata animazione' }),
      ]);
    };
    out.push(animGroup('in', 'Ingresso'), animGroup('out', 'Uscita'));
    if (clip.kind === 'video' || clip.kind === 'image') {
      const sel = h('select', { id: 'sel-camera', 'aria-label': 'Movimento di camera' }, CAMERA_MOVES.map((mv) => h('option', { value: mv.id }, mv.label)));
      const amount = h('input', { type: 'range', id: 'rng-camera', min: 0, max: 100, step: 1, value: prefs.get('cameraAmount', 50), 'aria-label': 'Intensità del movimento' });
      const out2 = h('output', { class: 'num-wrap' }, `${amount.value}%`);
      amount.addEventListener('input', () => { out2.textContent = `${amount.value}%`; prefs.set('cameraAmount', +amount.value); });
      out.push(section('Movimento di camera', [
        h('div', { class: 'ctl select' }, h('label', { class: 'ctl-label' }, 'Movimento'), sel),
        h('div', { class: 'ctl slider' }, h('label', { class: 'ctl-label' }, 'Intensità'), amount, out2),
        h('div', { class: 'btn-row wrap' },
          h('button', { class: 'btn small primary', type: 'button', id: 'btn-camera-apply', onClick: () => this.app.actions.applyCameraMove(sel.value, +amount.value) }, icon('video', 14), 'Applica'),
          h('button', { class: 'btn small', type: 'button', id: 'btn-camera-clear', onClick: () => this.app.actions.clearCameraMove() }, 'Togli')),
        h('p', { class: 'hint' }, 'Crea da solo i keyframe di scala e posizione per tutta la durata del clip: puoi poi ritoccarli a mano nella lista «Keyframe» qui sotto.'),
      ], { open: ['scale', 'x', 'y', 'rotation'].some((k) => clip.keyframes?.[k]?.length) }));
    }
    out.push(section('Ciclica (per tutto il clip)', [
      this.#add(selectControl(this.ctx, { label: 'Tipo', options: [{ id: 'none', label: 'Nessuna' }, ...LOOP_IDS.map((id) => ({ id, label: LOOPS[id].label }))], get: (c) => c.anim.loop?.type ?? 'none', set: (c, v) => { c.anim.loop = v === 'none' ? null : { type: v, speed: c.anim.loop?.speed ?? 1, amount: c.anim.loop?.amount ?? 60 }; }, history: 'Animazione ciclica' })),
      this.S({ label: 'Velocità', min: 0.1, max: 8, step: 0.1, unit: '/s', decimals: 1, get: (c) => c.anim.loop?.speed ?? 1, set: (c, v) => { if (c.anim.loop) c.anim.loop.speed = v; }, def: 1, history: 'Animazione ciclica' }),
      this.S({ label: 'Intensità', min: 0, max: 100, step: 1, unit: '%', get: (c) => c.anim.loop?.amount ?? 60, set: (c, v) => { if (c.anim.loop) c.anim.loop.amount = v; }, def: 60, history: 'Animazione ciclica' }),
      h('p', { class: 'hint' }, 'Si ripete per tutta la durata del clip, insieme alle animazioni di ingresso e di uscita.'),
    ], { open: !!clip.anim.loop }));
    if (isVisualKind(clip.kind)) {
      const sel = h('select', { 'aria-label': 'Tipo di transizione', id: 'sel-transition' },
        h('option', { value: 'none' }, 'Nessuna'),
        transitionGroups().map((g) => h('optgroup', { label: g.label }, g.ids.map((id) => h('option', { value: id }, ANIMATIONS[id].label)))));
      sel.addEventListener('change', () => this.app.actions.applyTransition(sel.value, clip.transition?.duration ?? prefs.get('transDur', 0.8)));
      this.#controls.push({ el: sel, sync: (c) => { if (c && document.activeElement !== sel) sel.value = c.transition?.type ?? 'none'; } });
      out.push(section('Transizione all’inizio del clip', [
        h('div', { class: 'ctl select' }, h('label', { class: 'ctl-label' }, 'Tipo'), sel),
        this.S({
          label: 'Durata', min: 0.1, max: 3, step: 0.1, unit: 's', decimals: 1, def: 0.8, history: 'Durata transizione',
          get: (c) => c.transition?.duration ?? 0,
          setProject: (p, id, v) => {
            const c = findClip(p, id)?.clip;
            if (c?.transition) setTransition(p, id, { type: c.transition.type, duration: v });
          },
        }),
        h('p', { class: 'hint' }, 'Se il clip segue un altro clip si crea una vera sovrapposizione (dissolvenza incrociata): i clip successivi della traccia si accorciano di conseguenza.'),
      ]));
    }
    out.push(section('Keyframe', [this.#keyframeList(clip)], { open: true }));
    return out;
  }

  #keyframeList(clip) {
    const { store, player } = this.app;
    const wrap = h('div', { class: 'kf-list' });
    const props = KEYFRAME_PROPS.filter((p) => clip.keyframes[p]?.length);
    const add = h('div', { class: 'btn-row wrap' }, KEYFRAME_PROPS.filter((p) => p !== 'volume' || !isVisualKind(clip.kind) || clip.kind === 'video').map((p) =>
      h('button', { class: 'btn small', type: 'button', 'data-kf': p, title: `Aggiungi un keyframe «${PROP_LABEL[p]}» alla posizione della testina`, onClick: () => this.app.actions.toggleKeyframe(p) }, icon('diamond', 12), PROP_LABEL[p])));
    wrap.append(add);
    if (!props.length) wrap.append(h('p', { class: 'hint' }, 'Nessun keyframe. Aggiungine uno, sposta la testina e cambia il valore: il programma interpola il movimento.'));
    for (const prop of props) {
      wrap.append(h('h4', { class: 'kf-h' }, PROP_LABEL[prop], h('button', { class: 'icon-btn small', type: 'button', title: 'Rimuovi tutti i keyframe di questa proprietà', 'aria-label': `Rimuovi i keyframe ${PROP_LABEL[prop]}`, onClick: () => this.app.actions.clearKeyframes(prop) }, icon('trash', 13))));
      clip.keyframes[prop].forEach((k, i) => {
        const sel = h('select', { class: 'mini-select', 'aria-label': 'Interpolazione' }, Object.entries(EASING_LABELS).map(([id, label]) => h('option', { value: id }, label)));
        sel.value = k.e;
        sel.addEventListener('change', () => store.commit('Interpolazione', (p) => { const c = findClip(p, clip.id)?.clip; if (c?.keyframes[prop]?.[i]) c.keyframes[prop][i].e = sel.value; }));
        wrap.append(h('div', { class: 'kf-row' },
          h('button', { class: 'kf-time', type: 'button', title: 'Vai a questo keyframe', onClick: () => player.seek(clip.start + k.t) }, `${formatDuration(k.t, 2)}`),
          h('span', { class: 'kf-val' }, `${+(k.v * PROP_UNIT[prop]).toFixed(1)}${prop === 'rotation' ? '°' : '%'}`),
          sel,
          h('button', { class: 'icon-btn small', type: 'button', 'aria-label': 'Elimina keyframe', onClick: () => store.commit('Elimina keyframe', (p) => { const c = findClip(p, clip.id)?.clip; if (c) removeKeyframeAt(c, prop, k.t, 1e-6); }) }, icon('x', 13))));
      });
    }
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // Regolazione colore + chroma key
  // ---------------------------------------------------------------------------

  #adjustTab(clip) {
    const adj = (label, key, min, max, def = 0, unit = '') => this.S({ label, min, max, step: 1, unit, get: (c) => c.adjust[key], set: (c, v) => { c.adjust[key] = v; }, def, history: `Regolazione ${label}` });
    const out = [
      section('Filtro', [
        this.#add(selectControl(this.ctx, { label: 'Preset', options: FILTERS.map((f) => ({ id: f.id, label: f.label })), get: (c) => c.filter.id, set: (c, v) => { c.filter.id = v; }, history: 'Filtro' })),
        this.S({ label: 'Intensità', min: 0, max: 100, step: 1, unit: '%', get: (c) => c.filter.intensity * 100, set: (c, v) => { c.filter.intensity = v / 100; }, def: 100, history: 'Intensità filtro' }),
      ]),
      section('Colore', [
        adj('Luminosità', 'brightness', -100, 100),
        adj('Contrasto', 'contrast', -100, 100),
        adj('Saturazione', 'saturation', -100, 100),
        adj('Tonalità', 'hue', -180, 180, 0, '°'),
        adj('Temperatura', 'temperature', -100, 100),
        adj('Tinta', 'tint', -100, 100),
      ]),
      section('Dettaglio', [
        adj('Sfocatura', 'blur', 0, 100),
        adj('Vignettatura', 'vignette', 0, 100),
        adj('Grana', 'grain', 0, 100),
        h('div', { class: 'btn-row' }, actionButton({ label: 'Azzera regolazioni', icon: 'rotate', onClick: () => this.app.actions.resetAdjust() })),
      ]),
    ];
    out.push(...this.#gradeSections());
    if (clip.kind === 'video' || clip.kind === 'image') {
      out.push(section('Schermo verde (chroma key)', [
        this.#add(toggleControl(this.ctx, { label: 'Attiva', get: (c) => c.chroma.enabled, set: (c, v) => { c.chroma.enabled = v; }, history: 'Chroma key' })),
        this.#add(colorPicker(this.ctx, { label: 'Colore da rimuovere', get: (c) => c.chroma.color, set: (c, v) => { c.chroma.color = v; }, history: 'Chroma key' })),
        this.S({ label: 'Tolleranza', min: 0, max: 100, step: 1, unit: '%', get: (c) => c.chroma.similarity * 100, set: (c, v) => { c.chroma.similarity = v / 100; }, def: 40, history: 'Chroma key' }),
        this.S({ label: 'Sfumatura', min: 0, max: 100, step: 1, unit: '%', get: (c) => c.chroma.smoothness * 100, set: (c, v) => { c.chroma.smoothness = v / 100; }, def: 10, history: 'Chroma key' }),
      ], { open: clip.chroma.enabled }));
    }
    return out;
  }

  /** Correzione colore avanzata: tono, curva, ruote colore, HSL per tinta e LUT. */
  #gradeSections() {
    const G = (label, key, min, max, def = 0) => this.S({ label, min, max, step: 1, unit: '', get: (c) => c.grade[key], set: (c, v) => { c.grade[key] = v; }, def, history: `Colore ${label}` });
    const curveLabels = ['Neri', 'Ombre', 'Toni medi', 'Luci', 'Bianchi'];
    const wheelRows = WHEELS.flatMap((w) => [
      this.S({ label: `${w.label}: tinta`, min: 0, max: 360, step: 1, unit: '°', get: (c) => c.grade.wheels[w.id].hue, set: (c, v) => { c.grade.wheels[w.id].hue = v; }, def: 0, history: `Ruota ${w.label}` }),
      this.S({ label: `${w.label}: intensità`, min: 0, max: 100, step: 1, unit: '%', get: (c) => c.grade.wheels[w.id].amount, set: (c, v) => { c.grade.wheels[w.id].amount = v; }, def: 0, history: `Ruota ${w.label}` }),
    ]);
    const bandSel = h('select', { id: 'sel-hsl-band', 'aria-label': 'Colore da regolare' }, HSL_BANDS.map((b) => h('option', { value: b.id }, b.label)));
    bandSel.value = this.#hslBand;
    bandSel.addEventListener('change', () => {
      this.#hslBand = bandSel.value;
      this.#sync();
    });
    const hsl = (label, key) => this.S({ label, min: -100, max: 100, step: 1, unit: '', get: (c) => c.grade.hsl[this.#hslBand][key], set: (c, v) => { c.grade.hsl[this.#hslBand][key] = v; }, def: 0, history: `HSL ${label}` });
    const lutSel = h('select', { id: 'sel-lut', 'aria-label': 'LUT' });
    const fillLuts = () => {
      const luts = this.app.store.project.luts ?? {};
      const sig = Object.entries(luts).map(([id, l]) => `${id}:${l.name}`).join('|');
      if (lutSel.dataset.sig === sig) return;
      lutSel.dataset.sig = sig;
      lutSel.replaceChildren(h('option', { value: '' }, 'Nessuna'), ...Object.entries(luts).map(([id, l]) => h('option', { value: id }, l.name)));
    };
    lutSel.addEventListener('change', () => this.app.store.commit('LUT', (p) => {
      const c = findClip(p, this.clipId)?.clip;
      if (c) c.grade.lut.id = lutSel.value || null;
    }));
    this.#controls.push({ el: lutSel, sync: (c) => {
      fillLuts();
      if (c && document.activeElement !== lutSel) lutSel.value = c.grade.lut.id && lutSel.querySelector(`option[value="${c.grade.lut.id}"]`) ? c.grade.lut.id : '';
    } });
    const lutFile = h('input', { type: 'file', accept: '.cube,text/plain', hidden: true, id: 'lut-file', 'aria-label': 'Importa una LUT (.cube)' });
    lutFile.addEventListener('change', async () => {
      const f = lutFile.files?.[0];
      lutFile.value = '';
      if (f) await this.app.actions.importLut(f);
    });
    return [
      section('Tono', [
        G('Esposizione', 'exposure', -100, 100),
        G('Alte luci', 'highlights', -100, 100),
        G('Ombre', 'shadows', -100, 100),
        G('Nitidezza', 'sharpen', 0, 100),
      ], { open: false }),
      section('Curva', CURVE_POINTS.map((pt, i) => this.S({ label: curveLabels[i], min: 0, max: 100, step: 1, unit: '%', get: (c) => c.grade.curve[i], set: (c, v) => { c.grade.curve[i] = v; }, def: pt, history: 'Curva' })), { open: false }),
      section('Ruote colore', wheelRows, { open: false }),
      section('HSL per colore', [
        h('div', { class: 'ctl select' }, h('label', { class: 'ctl-label' }, 'Colore'), bandSel),
        hsl('Tinta', 'h'),
        hsl('Saturazione', 's'),
        hsl('Luminosità', 'l'),
      ], { open: false }),
      section('LUT (.cube)', [
        h('div', { class: 'ctl select' }, h('label', { class: 'ctl-label' }, 'LUT'), lutSel),
        this.S({ label: 'Intensità LUT', min: 0, max: 100, step: 1, unit: '%', get: (c) => c.grade.lut.intensity, set: (c, v) => { c.grade.lut.intensity = v; }, def: 100, history: 'Intensità LUT' }),
        h('div', { class: 'btn-row wrap' }, lutFile, actionButton({ label: 'Importa LUT…', icon: 'upload', onClick: () => lutFile.click() })),
        h('p', { class: 'hint' }, 'Una LUT è un «look» pronto dei colorist (file .cube 3D). Quelle più grandi di 33 punti vengono ridotte.'),
      ], { open: false }),
    ];
  }

  // ---------------------------------------------------------------------------
  // Effetti
  // ---------------------------------------------------------------------------

  #fxTab(clip) {
    const { actions } = this.app;
    const list = h('div', { class: 'fx-list' });
    if (!clip.effects.length) list.append(h('p', { class: 'hint' }, 'Nessun effetto applicato.'));
    for (const fx of clip.effects) {
      const meta = EFFECTS.find((e) => e.id === fx.type);
      list.append(h('div', { class: 'fx-row' },
        this.S({ label: meta?.label ?? fx.type, min: 0, max: 100, step: 1, unit: '%', get: (c) => c.effects.find((e) => e.id === fx.id)?.amount ?? 0, set: (c, v) => { const e = c.effects.find((q) => q.id === fx.id); if (e) e.amount = v; }, def: meta?.amount ?? 50, history: `Effetto ${meta?.label ?? ''}` }),
        h('button', { class: 'icon-btn small', type: 'button', title: 'Rimuovi effetto', 'aria-label': `Rimuovi ${meta?.label ?? fx.type}`, onClick: () => actions.removeEffect(fx.id) }, icon('trash', 14))));
    }
    const sel = h('select', { 'aria-label': 'Aggiungi effetto' }, h('option', { value: '' }, 'Aggiungi effetto…'), EFFECTS.map((e) => h('option', { value: e.id }, e.label)));
    sel.addEventListener('change', () => {
      if (sel.value) actions.addEffect(sel.value);
      sel.value = '';
    });
    return [section('Effetti del clip', [list, h('div', { class: 'ctl select' }, sel)])];
  }

  // ---------------------------------------------------------------------------
  // Testo
  // ---------------------------------------------------------------------------

  #textTab() {
    const T = (label, key, min, max, step, unit, scale = 1, def) => this.S({ label, min, max, step, unit, decimals: step < 1 ? 1 : 0, get: (c) => c.text[key] * scale, set: (c, v) => { c.text[key] = v / scale; }, def, history: `Testo ${label}` });
    const fontOpts = [...FONTS, ...this.app.customFonts.map((f) => ({ id: `"${f}", sans-serif`, label: `${f} (caricato)` }))];
    const style = segmented(this.ctx, {
      label: 'Stile',
      options: [{ id: 'bold', label: 'B', title: 'Grassetto' }, { id: 'italic', label: 'I', title: 'Corsivo' }, { id: 'underline', label: 'U', title: 'Sottolineato' }, { id: 'uppercase', label: 'AA', title: 'Maiuscolo' }],
      get: (c) => [c.text.weight >= 700 ? 'bold' : null, c.text.italic ? 'italic' : null, c.text.underline ? 'underline' : null, c.text.uppercase ? 'uppercase' : null].filter(Boolean),
      set: (c, id) => { if (id === 'bold') c.text.weight = c.text.weight >= 700 ? 400 : 800; else c.text[id] = !c.text[id]; },
      history: 'Stile testo',
    });
    return [
      section('Contenuto', [
        this.#add(textControl(this.ctx, { label: 'Testo', multiline: true, get: (c) => c.text.content, set: (c, v) => { c.text.content = v || ' '; }, history: 'Testo', placeholder: 'Scrivi qui…' })),
        this.#add(selectControl(this.ctx, { label: 'Font', options: fontOpts, get: (c) => c.text.font, set: (c, v) => { c.text.font = v; }, history: 'Font' })),
        T('Dimensione', 'size', 1, 40, 0.5, '%', 1, 8),
        this.#add(style),
        this.#add(segmented(this.ctx, { label: 'Allineamento', options: [{ id: 'left', label: 'Sinistra' }, { id: 'center', label: 'Centro' }, { id: 'right', label: 'Destra' }], get: (c) => c.text.align, set: (c, v) => { c.text.align = v; }, history: 'Allineamento' })),
        this.#add(colorPicker(this.ctx, { label: 'Colore', get: (c) => c.text.color, set: (c, v) => { c.text.color = v; }, history: 'Colore testo' })),
        T('Interlinea', 'lineHeight', 0.8, 2.5, 0.05, '×', 1, 1.2),
        T('Spaziatura lettere', 'letterSpacing', -0.1, 0.6, 0.01, 'em', 1, 0),
        T('Larghezza riquadro', 'boxWidth', 20, 100, 1, '%', 100, 0.85),
      ]),
      section('Contorno', [
        this.S({ label: 'Spessore', min: 0, max: 40, step: 1, unit: '%', get: (c) => c.text.stroke.width * 100, set: (c, v) => { c.text.stroke.width = v / 100; }, def: 0, history: 'Contorno' }),
        this.#add(colorPicker(this.ctx, { label: 'Colore contorno', get: (c) => c.text.stroke.color, set: (c, v) => { c.text.stroke.color = v; }, history: 'Contorno' })),
      ], { open: false }),
      section('Ombra', [
        this.S({ label: 'Sfocatura', min: 0, max: 60, step: 1, get: (c) => c.text.shadow.blur, set: (c, v) => { c.text.shadow.blur = v; }, def: 0, history: 'Ombra' }),
        this.S({ label: 'Spostamento X', min: -40, max: 40, step: 1, get: (c) => c.text.shadow.x, set: (c, v) => { c.text.shadow.x = v; }, def: 0, history: 'Ombra' }),
        this.S({ label: 'Spostamento Y', min: -40, max: 40, step: 1, get: (c) => c.text.shadow.y, set: (c, v) => { c.text.shadow.y = v; }, def: 0, history: 'Ombra' }),
        this.S({ label: 'Opacità', min: 0, max: 100, step: 1, unit: '%', get: (c) => c.text.shadow.opacity * 100, set: (c, v) => { c.text.shadow.opacity = v / 100; }, def: 50, history: 'Ombra' }),
        this.#add(colorPicker(this.ctx, { label: 'Colore ombra', get: (c) => c.text.shadow.color, set: (c, v) => { c.text.shadow.color = v; }, history: 'Ombra' })),
      ], { open: false }),
      section('Sfondo del testo', [
        this.#add(toggleControl(this.ctx, { label: 'Mostra sfondo', get: (c) => c.text.bg.enabled, set: (c, v) => { c.text.bg.enabled = v; }, history: 'Sfondo testo' })),
        this.#add(colorPicker(this.ctx, { label: 'Colore', get: (c) => c.text.bg.color, set: (c, v) => { c.text.bg.color = v; }, history: 'Sfondo testo' })),
        this.S({ label: 'Opacità', min: 0, max: 100, step: 1, unit: '%', get: (c) => c.text.bg.opacity * 100, set: (c, v) => { c.text.bg.opacity = v / 100; }, def: 60, history: 'Sfondo testo' }),
        this.S({ label: 'Margine interno', min: 0, max: 100, step: 1, unit: '%', get: (c) => c.text.bg.padding * 100, set: (c, v) => { c.text.bg.padding = v / 100; }, def: 30, history: 'Sfondo testo' }),
        this.S({ label: 'Arrotondamento', min: 0, max: 100, step: 1, unit: '%', get: (c) => c.text.bg.radius * 100, set: (c, v) => { c.text.bg.radius = v / 100; }, def: 20, history: 'Sfondo testo' }),
      ], { open: false }),
      section('Karaoke', [
        this.#add(toggleControl(this.ctx, { label: 'Colora le parole mentre si dicono', get: (c) => c.text.karaoke.enabled, set: (c, v) => { c.text.karaoke.enabled = v; }, history: 'Karaoke' })),
        this.#add(selectControl(this.ctx, { label: 'Modo', options: KARAOKE_MODES, get: (c) => c.text.karaoke.mode, set: (c, v) => { c.text.karaoke.mode = v; }, history: 'Karaoke' })),
        this.#add(colorPicker(this.ctx, { label: 'Colore di evidenza', get: (c) => c.text.karaoke.color, set: (c, v) => { c.text.karaoke.color = v; }, history: 'Karaoke' })),
        h('p', { class: 'hint' }, 'Le parole si colorano una dopo l’altra su tutta la durata del clip. Con sottotitoli importati da LRC esteso o ASS con \\k si usano i tempi esatti del file.'),
      ], { open: false }),
    ];
  }

  // ---------------------------------------------------------------------------
  // Forma / adesivo
  // ---------------------------------------------------------------------------

  #itemTab(clip) {
    if (clip.kind === 'sticker') {
      return [section('Adesivo', [
        this.#add(textControl(this.ctx, { label: 'Emoji', get: (c) => c.sticker.emoji, set: (c, v) => { c.sticker.emoji = [...v].slice(0, 4).join('') || '😀'; }, history: 'Adesivo' })),
        this.S({ label: 'Dimensione', min: 5, max: 90, step: 1, unit: '%', get: (c) => c.sticker.size * 100, set: (c, v) => { c.sticker.size = v / 100; }, def: 25, history: 'Dimensione adesivo' }),
      ])];
    }
    return [section('Forma', [
      this.#add(selectControl(this.ctx, { label: 'Tipo', options: SHAPES, get: (c) => c.shape.type, set: (c, v) => { c.shape.type = v; }, history: 'Forma' })),
      this.#add(colorPicker(this.ctx, { label: 'Riempimento', get: (c) => c.shape.fill, set: (c, v) => { c.shape.fill = v; }, history: 'Colore forma' })),
      this.S({ label: 'Larghezza', min: 2, max: 200, step: 1, unit: '%', get: (c) => c.shape.w * 100, set: (c, v) => { c.shape.w = v / 100; }, def: 35, history: 'Dimensione forma' }),
      this.S({ label: 'Altezza', min: 2, max: 200, step: 1, unit: '%', get: (c) => c.shape.h * 100, set: (c, v) => { c.shape.h = v / 100; }, def: 35, history: 'Dimensione forma' }),
      this.#add(toggleControl(this.ctx, { label: 'Riempi tutto il canvas', get: (c) => c.shape.full, set: (c, v) => { c.shape.full = v; }, history: 'Forma' })),
      this.S({ label: 'Spessore bordo', min: 0, max: 10, step: 0.5, unit: '%', decimals: 1, get: (c) => c.shape.strokeWidth * 100, set: (c, v) => { c.shape.strokeWidth = v / 100; }, def: 0, history: 'Bordo forma' }),
      this.#add(colorPicker(this.ctx, { label: 'Colore bordo', get: (c) => c.shape.stroke, set: (c, v) => { c.shape.stroke = v; }, history: 'Bordo forma' })),
    ])];
  }
}
