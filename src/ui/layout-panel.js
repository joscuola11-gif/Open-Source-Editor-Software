// Pannello «Layout»: ruota di 90°, ingrandisci, sposta dove vuoi, disposizioni pronte.
// Agisce sul clip selezionato (o sui clip selezionati) oppure su quello sotto la testina; il
// trascinamento diretto nell'anteprima resta disponibile in parallelo (maniglie arancioni).

import { h } from './dom.js';
import { icon } from './icons.js';
import { LAYOUT_PRESETS } from '../core/layout.js';
import { findClip } from '../core/timeline.js';
import { valueAt } from '../core/keyframes.js';

const POSITIONS = [
  [-1, -1, 'Alto a sinistra'], [0, -1, 'Alto al centro'], [1, -1, 'Alto a destra'],
  [-1, 0, 'Centro a sinistra'], [0, 0, 'Centro'], [1, 0, 'Centro a destra'],
  [-1, 1, 'Basso a sinistra'], [0, 1, 'Basso al centro'], [1, 1, 'Basso a destra'],
];

function presetIcon(id) {
  const body = {
    full: '<rect x="3" y="5" width="18" height="14" rx="1.5"/>',
    'split-h': '<rect x="3" y="5" width="8.5" height="14" rx="1.5"/><rect x="12.5" y="5" width="8.5" height="14" rx="1.5"/>',
    'split-v': '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/>',
    pip: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><rect x="12" y="12" width="7" height="6" rx="1" fill="currentColor"/>',
  }[id];
  const span = document.createElement('span');
  span.className = 'ico';
  span.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${body}</svg>`;
  return span;
}

export class LayoutPanel {
  #open = false;
  #raf = 0;

  constructor(app, anchor) {
    this.app = app;
    this.anchor = anchor;
    const a = app.actions;
    const btn = (label, ic, onClick, extra = {}) => h('button', { class: 'btn small', type: 'button', onClick, ...extra }, ic ? icon(ic, 15) : null, label);

    this.target = h('p', { class: 'layout-target', id: 'layout-target' });
    this.rotLabel = h('span', { class: 'layout-readout', id: 'layout-rot' }, '0°');
    this.scaleLabel = h('span', { class: 'layout-readout', id: 'layout-scale' }, '100%');
    this.range = h('input', { type: 'range', min: '5', max: '400', step: '1', value: '100', id: 'layout-range', 'aria-label': 'Ingrandimento' });
    this.range.addEventListener('input', () => a.setClipScale(+this.range.value, { live: true }));
    this.range.addEventListener('change', () => a.endLive());

    const grid = h('div', { class: 'pos-grid', role: 'group', 'aria-label': 'Posizione nel quadro' },
      POSITIONS.map(([ax, ay, label]) => h('button', { class: 'pos-btn', type: 'button', 'data-ax': ax, 'data-ay': ay, title: label, 'aria-label': label, onClick: () => a.placeClip(ax, ay) }, h('span', { class: 'pos-dot' }))));
    const nudge = (dx, dy) => (e) => a.nudgeClip(dx * (e.shiftKey ? 0.1 : 0.01), dy * (e.shiftKey ? 0.1 : 0.01));
    const arrows = h('div', { class: 'nudge', role: 'group', 'aria-label': 'Sposta con le frecce' },
      h('button', { class: 'icon-btn', type: 'button', id: 'layout-up', title: 'Su (Maiusc = più veloce)', 'aria-label': 'Sposta su', onClick: nudge(0, -1) }, icon('arrowUp', 16)),
      h('button', { class: 'icon-btn', type: 'button', id: 'layout-left', title: 'Sinistra', 'aria-label': 'Sposta a sinistra', onClick: nudge(-1, 0) }, icon('arrowLeft', 16)),
      h('button', { class: 'icon-btn', type: 'button', id: 'layout-down', title: 'Giù', 'aria-label': 'Sposta giù', onClick: nudge(0, 1) }, icon('arrowDown', 16)),
      h('button', { class: 'icon-btn', type: 'button', id: 'layout-right', title: 'Destra', 'aria-label': 'Sposta a destra', onClick: nudge(1, 0) }, icon('arrowRight', 16)));

    const section = (title, ...kids) => h('section', { class: 'layout-sec' }, h('h4', {}, title), ...kids);
    const rotate = section('Ruota',
      h('div', { class: 'layout-row' },
        btn('90°', 'rotateCcw', () => a.rotateClip(-90), { id: 'layout-rot-ccw', title: 'Ruota di 90° in senso antiorario', 'aria-label': 'Ruota di 90 gradi a sinistra' }),
        btn('90°', 'rotateCw', () => a.rotateClip(90), { id: 'layout-rot-cw', title: 'Ruota di 90° in senso orario', 'aria-label': 'Ruota di 90 gradi a destra' }),
        btn('Azzera', null, () => a.resetRotation(), { id: 'layout-rot-reset' }),
        this.rotLabel));
    const enlarge = section('Ingrandisci',
      h('div', { class: 'layout-row range-row' },
        h('button', { class: 'icon-btn small', type: 'button', id: 'layout-minus', title: 'Riduci del 10%', 'aria-label': 'Riduci', onClick: () => a.scaleClip(1 / 1.1) }, icon('minus', 16)),
        this.range,
        h('button', { class: 'icon-btn small', type: 'button', id: 'layout-plus', title: 'Ingrandisci del 10%', 'aria-label': 'Ingrandisci', onClick: () => a.scaleClip(1.1) }, icon('plus', 16)),
        this.scaleLabel),
      h('div', { class: 'layout-row' }, btn('Adatta', null, () => a.layoutFit('fit'), { id: 'layout-fit', title: 'Tutto il clip dentro il quadro' }), btn('Riempi', null, () => a.layoutFit('fill'), { id: 'layout-fill', title: 'Il clip riempie tutto il quadro' })));
    const move = section('Sposta',
      h('div', { class: 'layout-move' }, grid, arrows),
      h('p', { class: 'layout-hint' }, 'Oppure trascina il clip nell’anteprima.'));
    const arrange = section('Disposizione',
      h('div', { class: 'preset-grid' }, Object.entries(LAYOUT_PRESETS).map(([id, p]) =>
        h('button', { class: 'preset-btn', type: 'button', 'data-preset': id, id: `layout-preset-${id}`, title: `${p.label}: ${p.hint}`, onClick: () => a.layoutPreset(id) }, presetIcon(id), h('span', {}, p.short)))),
      h('p', { class: 'layout-hint' }, 'Più clip: selezionali con Maiusc; il primo è lo sfondo, a sinistra o sopra.'));
    const extras = h('div', { class: 'layout-row end' },
      btn('Specchio ↔', 'flipH', () => a.layoutFlip('flipX'), { id: 'layout-flip-x' }),
      btn('Specchio ↕', 'flipV', () => a.layoutFlip('flipY'), { id: 'layout-flip-y' }),
      btn('Ripristina', 'rotate', () => a.layoutReset(), { id: 'layout-reset', title: 'Rotazione 0°, adatto al quadro, al centro' }));

    this.el = h('div', { class: 'layout-pop', id: 'layout-panel', role: 'dialog', 'aria-label': 'Layout', hidden: true },
      h('header', {}, h('strong', {}, 'Layout'), this.target, h('button', { class: 'icon-btn small', type: 'button', 'aria-label': 'Chiudi il Layout', title: 'Chiudi (Esc)', onClick: () => this.toggle(false) }, icon('x', 14))),
      h('div', { class: 'layout-cols' }, h('div', { class: 'layout-col' }, rotate, enlarge, extras), h('div', { class: 'layout-col' }, move, arrange)),
    );

    const refresh = () => this.#schedule();
    app.store.on('change', refresh);
    app.selection.on('change', refresh);
    app.player.on('time', refresh);
  }

  get open() {
    return this.#open;
  }

  /** Colonna delle proprietà: se è visibile il pannello vi si «aggancia» e non copre l'anteprima. */
  attachDock(inspectorEl) {
    this.dock = inspectorEl;
  }

  #dockVisible() {
    return !!this.dock && getComputedStyle(this.dock).display !== 'none';
  }

  toggle(force = !this.#open) {
    this.#open = !!force;
    const docked = this.#open && this.#dockVisible();
    if (this.#open) {
      // aggancio alla colonna delle proprietà, altrimenti finestra mobile sopra l'anteprima
      const host = docked ? this.dock : this.anchor.closest('.preview');
      if (this.el.parentNode !== host) host.append(this.el);
    }
    this.el.classList.toggle('docked', docked);
    this.dock?.classList.toggle('layout-open', docked);
    if (!this.#open) this.dock?.classList.remove('layout-open');
    this.el.hidden = !this.#open;
    this.anchor.classList.toggle('on', this.#open);
    this.anchor.setAttribute('aria-pressed', String(this.#open));
    if (this.#open) this.#sync();
  }

  #schedule() {
    if (!this.#open || this.#raf) return;
    this.#raf = requestAnimationFrame(() => {
      this.#raf = 0;
      this.#sync();
    });
  }

  #sync() {
    const { store, player, actions } = this.app;
    const ids = actions.layoutTargets();
    const p = store.project;
    const c = ids.length ? findClip(p, ids[0])?.clip : null;
    if (!c) {
      this.target.textContent = actions.layoutLocked() ? 'La traccia di questo clip è bloccata (lucchetto).' : 'Seleziona un clip nell’anteprima o nella timeline.';
      this.target.classList.add('empty');
      return;
    }
    this.target.classList.remove('empty');
    const name = c.kind === 'text' ? c.text.content.split('\n')[0] : c.kind === 'sticker' ? c.sticker.emoji : c.name || p.media[c.mediaId]?.name || c.kind;
    this.target.textContent = ids.length > 1 ? `${ids.length} clip selezionati` : `Clip: ${name}`;
    const local = Math.min(Math.max(player.time - c.start, 0), c.duration);
    this.rotLabel.textContent = `${Math.round(valueAt(c, 'rotation', local))}°`;
    const pct = Math.round(valueAt(c, 'scale', local) * 100);
    this.scaleLabel.textContent = `${pct}%`;
    if (document.activeElement !== this.range) this.range.value = String(Math.min(400, Math.max(5, pct)));
  }
}
