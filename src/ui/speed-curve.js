// Editor grafico della curva di velocità: punti trascinabili (tempo → velocità, scala logaritmica).

import { MAX_SPEED, MIN_SPEED } from '../core/presets.js';
import { RAMP_PRESETS, normalizeCurve, rampDuration, rampSegments } from '../core/speedramp.js';
import { formatDuration } from '../core/util.js';
import { h } from './dom.js';
import { icon } from './icons.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 300;
const H = 150;
const L = 30;
const R = 8;
const T = 8;
const B = 18;
const PW = W - L - R;
const PH = H - T - B;
const LN0 = Math.log(MIN_SPEED);
const LN1 = Math.log(MAX_SPEED);
const xOf = (t) => L + t * PW;
const yOf = (s) => T + (1 - (Math.log(s) - LN0) / (LN1 - LN0)) * PH;
const tOf = (x) => Math.min(1, Math.max(0, (x - L) / PW));
const sOf = (y) => Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.exp(LN0 + (1 - (y - T) / PH) * (LN1 - LN0))));
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/**
 * @param {{span: number, duration: number, fps: number, onApply: (points: object[], keepAudio: boolean) => void}} o
 *  span = secondi di sorgente usati dal clip; duration = durata attuale sulla timeline.
 */
export function speedCurveEditor({ span, duration, fps, onApply }) {
  let pts = structuredClone(RAMP_PRESETS[0].points);
  let sel = -1;
  const root = h('div', { class: 'speed-curve', id: 'speed-curve' });
  const board = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', class: 'speed-svg', role: 'group', 'aria-label': 'Curva di velocità: trascina i punti, doppio clic per aggiungere o togliere' });
  const info = h('p', { class: 'hint', id: 'speed-curve-info' });
  const keep = h('input', { type: 'checkbox', id: 'ramp-audio', 'aria-label': 'Tieni l’audio dei pezzi' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Curve pronte' }, RAMP_PRESETS.map((p) => h('button', { class: 'chip', type: 'button', 'data-ramp': p.id, onClick: () => { pts = structuredClone(p.points); sel = -1; draw(); } }, p.label)));

  function refreshInfo() {
    try {
      const total = rampDuration(rampSegments(normalizeCurve(pts), span, { fps }));
      info.textContent = `Ora il clip dura ${formatDuration(duration, 1)} · con la curva ≈ ${formatDuration(total, 1)}. Il video viene diviso in pezzi a velocità costante (l’audio dei pezzi resta muto, a meno che tu lo tenga).`;
    } catch (e) {
      info.textContent = e.message;
    }
  }

  function draw() {
    board.replaceChildren();
    board.append(svg('rect', { x: L, y: T, width: PW, height: PH, fill: 'var(--panel-2)', stroke: 'var(--border)' }));
    for (const s of [0.25, 0.5, 1, 2, 4, 8]) {
      board.append(svg('line', { x1: L, x2: L + PW, y1: yOf(s), y2: yOf(s), stroke: s === 1 ? 'var(--text-dim)' : 'var(--border)', 'stroke-dasharray': s === 1 ? '' : '3 3' }));
      const lab = svg('text', { x: L - 4, y: yOf(s) + 3, 'text-anchor': 'end', 'font-size': 9, fill: 'var(--text-dim)' });
      lab.textContent = `${s}×`;
      board.append(lab);
    }
    for (const t of [0, 0.5, 1]) {
      const lab = svg('text', { x: xOf(t), y: H - 4, 'text-anchor': t === 0 ? 'start' : t === 1 ? 'end' : 'middle', 'font-size': 9, fill: 'var(--text-dim)' });
      lab.textContent = t === 0 ? 'inizio' : t === 1 ? 'fine' : 'metà';
      board.append(lab);
    }
    const line = svg('polyline', { points: pts.map((p) => `${xOf(p.t)},${yOf(p.s)}`).join(' '), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2 });
    board.append(line);
    pts.forEach((p, i) => {
      const c = svg('circle', { cx: xOf(p.t), cy: yOf(p.s), r: i === sel ? 6 : 5, fill: i === sel ? 'var(--accent)' : 'var(--panel)', stroke: 'var(--accent)', 'stroke-width': 2, tabindex: 0, 'data-pt': i, role: 'slider', 'aria-label': `Punto ${i + 1}: ${p.s.toFixed(2)}× a ${Math.round(p.t * 100)}%`, class: 'speed-pt' });
      c.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        sel = i;
        // i punti si ridisegnano a ogni movimento: gli ascoltatori stanno sulla finestra, non sul punto
        const move = (ev) => {
          const r = board.getBoundingClientRect();
          const x = ((ev.clientX - r.left) / r.width) * W;
          const y = ((ev.clientY - r.top) / r.height) * H;
          const last = pts.length - 1;
          pts[i].s = sOf(y);
          if (i > 0 && i < last) pts[i].t = Math.min(pts[i + 1].t - 0.01, Math.max(pts[i - 1].t + 0.01, tOf(x)));
          draw();
        };
        const up = () => {
          removeEventListener('pointermove', move);
          removeEventListener('pointerup', up);
          removeEventListener('pointercancel', up);
        };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
        addEventListener('pointercancel', up);
        draw();
      });
      c.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (i > 0 && i < pts.length - 1) {
          pts.splice(i, 1);
          sel = -1;
          draw();
        }
      });
      c.addEventListener('keydown', (e) => {
        const last = pts.length - 1;
        let used = true;
        if (e.key === 'ArrowUp') pts[i].s = Math.min(MAX_SPEED, pts[i].s * 1.1);
        else if (e.key === 'ArrowDown') pts[i].s = Math.max(MIN_SPEED, pts[i].s / 1.1);
        else if (e.key === 'ArrowLeft' && i > 0 && i < last) pts[i].t = Math.max(pts[i - 1].t + 0.01, pts[i].t - 0.02);
        else if (e.key === 'ArrowRight' && i > 0 && i < last) pts[i].t = Math.min(pts[i + 1].t - 0.01, pts[i].t + 0.02);
        else if ((e.key === 'Delete' || e.key === 'Backspace') && i > 0 && i < last) pts.splice(i, 1);
        else used = false;
        if (used) {
          e.preventDefault();
          e.stopPropagation();
          sel = Math.min(i, pts.length - 1);
          draw();
          board.querySelector(`[data-pt="${sel}"]`)?.focus();
        }
      });
      board.append(c);
    });
    refreshInfo();
  }
  board.addEventListener('dblclick', (e) => {
    const r = board.getBoundingClientRect();
    const t = tOf(((e.clientX - r.left) / r.width) * W);
    const s = sOf(((e.clientY - r.top) / r.height) * H);
    if (t <= 0.01 || t >= 0.99) return;
    const k = pts.findIndex((p) => p.t > t);
    pts.splice(k < 0 ? pts.length - 1 : k, 0, { t, s });
    draw();
  });

  root.append(chips, h('div', { class: 'speed-board' }, board), info,
    h('label', { class: 'check' }, keep, h('span', {}, 'Tieni l’audio dei pezzi (cambia tono con la velocità)')),
    h('div', { class: 'btn-row wrap' }, h('button', { class: 'btn small primary', type: 'button', id: 'btn-ramp-apply', onClick: () => onApply(normalizeCurve(pts), keep.checked) }, icon('gauge', 14), 'Applica la curva')));
  root.getPoints = () => structuredClone(pts);
  draw();
  return root;
}
