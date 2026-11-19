// Editor della curva di interpolazione di un keyframe: due maniglie trascinabili (Bézier cubica) e curve pronte.

import { BEZIER_PRESETS, bezierString, cubicBezier, parseBezier } from '../core/keyframes.js';
import { h } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const S = 170; // lato del disegno
const PAD = 22;
const Y_MIN = -1;
const Y_MAX = 2;
const px = (x) => PAD + x * (S - 2 * PAD);
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** Curve con nome (vecchi progetti) → equivalente approssimato in Bézier, per partire da qualcosa di sensato. */
export const NAMED_TO_BEZIER = {
  linear: [0, 0, 1, 1],
  'ease-in': [0.32, 0, 0.67, 0],
  'ease-out': [0.33, 1, 0.68, 1],
  'ease-in-out': [0.65, 0, 0.35, 1],
};

export const bezierOf = (e) => parseBezier(e) ?? NAMED_TO_BEZIER[e] ?? null;

/**
 * @param {{value: string, onChange: (e: string) => void}} o  value = nome o 'bezier(...)'
 */
export function curveEditor({ value, onChange }) {
  let b = bezierOf(value) ?? [0.42, 0, 0.58, 1];
  const root = h('div', { class: 'curve-editor', 'data-curve': '' });
  const board = svg('svg', { viewBox: `0 0 ${S} ${S}`, width: S, height: S, class: 'curve-svg', role: 'group', 'aria-label': 'Curva del keyframe: trascina le due maniglie' });
  const label = h('span', { class: 'dim curve-label' });
  // scala verticale: y in [Y_MIN, Y_MAX] → [S - PAD, PAD]
  const Y = (y) => S - PAD - ((y - Y_MIN) / (Y_MAX - Y_MIN)) * (S - 2 * PAD);
  const yInv = (v) => Y_MIN + ((S - PAD - v) / (S - 2 * PAD)) * (Y_MAX - Y_MIN);
  const xInv = (v) => (v - PAD) / (S - 2 * PAD);

  function draw() {
    board.replaceChildren();
    board.append(svg('rect', { x: px(0), y: Y(1), width: px(1) - px(0), height: Y(0) - Y(1), fill: 'var(--panel-2)', stroke: 'var(--border)' }));
    board.append(svg('line', { x1: px(0), y1: Y(0), x2: px(1), y2: Y(1), stroke: 'var(--border)', 'stroke-dasharray': '3 3' }));
    const f = cubicBezier(...b);
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push(`${px(i / 40)},${Y(f(i / 40))}`);
    board.append(svg('polyline', { points: pts.join(' '), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2 }));
    for (const [i, [hx, hy]] of [[b[0], b[1]], [b[2], b[3]]].entries()) {
      const [ax, ay] = i === 0 ? [px(0), Y(0)] : [px(1), Y(1)];
      board.append(svg('line', { x1: ax, y1: ay, x2: px(hx), y2: Y(hy), stroke: 'var(--text-dim)' }));
      const c = svg('circle', { cx: px(hx), cy: Y(hy), r: 6, fill: 'var(--accent)', stroke: 'var(--panel)', 'stroke-width': 2, tabindex: 0, class: 'curve-handle', 'data-handle': i + 1, role: 'slider', 'aria-label': `Maniglia ${i + 1}` });
      c.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const move = (ev) => {
          const r = board.getBoundingClientRect();
          const x = xInv(((ev.clientX - r.left) / r.width) * S);
          const y = yInv(((ev.clientY - r.top) / r.height) * S);
          b = [...b];
          b[i * 2] = Math.min(1, Math.max(0, x));
          b[i * 2 + 1] = Math.min(3, Math.max(-3, y));
          draw();
        };
        const up = () => {
          removeEventListener('pointermove', move);
          removeEventListener('pointerup', up);
          removeEventListener('pointercancel', up);
          commit();
        };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
        addEventListener('pointercancel', up);
      });
      c.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 0.1 : 0.02;
        const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
        if (!k) return;
        e.preventDefault();
        e.stopPropagation();
        b = [...b];
        b[i * 2] = Math.min(1, Math.max(0, b[i * 2] + k[0]));
        b[i * 2 + 1] = Math.min(3, Math.max(-3, b[i * 2 + 1] + k[1]));
        draw();
        commit();
        board.querySelector(`[data-handle="${i + 1}"]`)?.focus();
      });
      board.append(c);
    }
    label.textContent = bezierString(...b);
  }
  function commit() {
    onChange(bezierString(...b));
  }
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Curve pronte' }, BEZIER_PRESETS.map((p) => h('button', { class: 'chip', type: 'button', 'data-curve-preset': p.id, onClick: () => { b = [...p.b]; draw(); onChange(p.e); } }, p.label)));
  root.append(chips, board, label);
  draw();
  return root;
}
