// Grafici in SVG, senza librerie. Ognuno ha un testo di spiegazione per chi usa lo screen reader.

const NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/** Ciambella: fette [{valore, colore}] con al centro un testo. */
export function donut(slices, { size = 160, thickness = 22, centerTop = '', centerBottom = '', label = '' } = {}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = slices.reduce((s, x) => s + x.valore, 0);
  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': label, class: 'donut' });
  root.append(svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--track)', 'stroke-width': thickness }));
  if (total > 0) {
    let offset = 0;
    for (const s of slices) {
      if (s.valore <= 0) continue;
      const len = (s.valore / total) * c;
      root.append(svg('circle', {
        cx: size / 2, cy: size / 2, r, fill: 'none', stroke: s.colore, 'stroke-width': thickness,
        'stroke-dasharray': `${Math.max(0, len - (slices.length > 1 ? 1.5 : 0))} ${c}`, 'stroke-dashoffset': -offset, transform: `rotate(-90 ${size / 2} ${size / 2})`,
      }));
      offset += len;
    }
  }
  if (centerTop) root.append(svg('text', { x: size / 2, y: size / 2 - 2, 'text-anchor': 'middle', class: 'donut-top' }, centerTop));
  if (centerBottom) root.append(svg('text', { x: size / 2, y: size / 2 + 16, 'text-anchor': 'middle', class: 'donut-bottom' }, centerBottom));
  return root;
}

/**
 * Colonne affiancate (entrate e uscite per periodo). `onSelect(i)` quando si tocca una colonna.
 * @param {{etichetta: string, a: number, b: number}[]} data a = entrate, b = uscite
 */
export function barPairs(data, { height = 150, selected = -1, onSelect, label = '' } = {}) {
  const w = Math.max(280, data.length * 44);
  const pad = { t: 8, b: 22 };
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const inner = height - pad.t - pad.b;
  const slot = w / data.length;
  const bw = Math.min(14, slot / 3);
  const root = svg('svg', { viewBox: `0 0 ${w} ${height}`, width: '100%', height, role: 'img', 'aria-label': label, class: 'bars', preserveAspectRatio: 'xMidYMid meet' });
  root.append(svg('line', { x1: 0, x2: w, y1: height - pad.b, y2: height - pad.b, stroke: 'var(--line)', 'stroke-width': 1 }));
  data.forEach((d, i) => {
    const cx = slot * i + slot / 2;
    const g = svg('g', { class: `bar-group ${i === selected ? 'sel' : ''}`, tabindex: onSelect ? 0 : undefined, role: onSelect ? 'button' : undefined, 'aria-label': d.aria ?? d.etichetta });
    g.append(svg('rect', { x: slot * i + 2, y: 0, width: slot - 4, height, rx: 6, class: 'bar-hit', fill: i === selected ? 'var(--hover)' : 'transparent' }));
    const ha = (d.a / max) * inner;
    const hb = (d.b / max) * inner;
    g.append(svg('rect', { x: cx - bw - 1, y: height - pad.b - ha, width: bw, height: Math.max(ha, d.a > 0 ? 2 : 0), rx: 3, fill: 'var(--income)' }));
    g.append(svg('rect', { x: cx + 1, y: height - pad.b - hb, width: bw, height: Math.max(hb, d.b > 0 ? 2 : 0), rx: 3, fill: 'var(--expense)' }));
    g.append(svg('text', { x: cx, y: height - 6, 'text-anchor': 'middle', class: 'axis' }, d.etichetta));
    if (onSelect) {
      g.addEventListener('click', () => onSelect(i));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i); } });
    }
    root.append(g);
  });
  return root;
}

/** Linea semplice (andamento del patrimonio). valori: numeri; etichette: stesse posizioni. */
export function lineChart(values, labels, { height = 120, label = '' } = {}) {
  const w = 300;
  const pad = { l: 6, r: 6, t: 10, b: 20 };
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max === min) { max += 100; min -= 100; }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;
  const x = (i) => pad.l + (values.length === 1 ? (w - pad.l - pad.r) / 2 : (i * (w - pad.l - pad.r)) / (values.length - 1));
  const y = (v) => pad.t + (1 - (v - min) / (max - min || 1)) * (height - pad.t - pad.b);
  const root = svg('svg', { viewBox: `0 0 ${w} ${height}`, role: 'img', 'aria-label': label, class: 'line' });
  if (min < 0) root.append(svg('line', { x1: 0, x2: w, y1: y(0), y2: y(0), stroke: 'var(--line)', 'stroke-dasharray': '3 3' }));
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  root.append(svg('polygon', { points: `${pad.l},${height - pad.b} ${pts.join(' ')} ${x(values.length - 1).toFixed(1)},${height - pad.b}`, fill: 'var(--brand-soft)' }));
  root.append(svg('polyline', { points: pts.join(' '), fill: 'none', stroke: 'var(--brand)', 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
  values.forEach((v, i) => root.append(svg('circle', { cx: x(i), cy: y(v), r: i === values.length - 1 ? 4 : 2.5, fill: 'var(--brand)' })));
  labels.forEach((l, i) => {
    if (values.length > 8 && i % 2 === 1 && i !== values.length - 1) return;
    root.append(svg('text', { x: x(i), y: height - 5, 'text-anchor': i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle', class: 'axis' }, l));
  });
  return root;
}
