// Forme di "rivelazione" delle transizioni (tendine, iride, cuore, orologio, veneziane, mosaico…).
// Pure: restituiscono primitive geometriche nel sistema del riquadro del clip (origine al centro, w×h),
// così si possono verificare numericamente e disegnare con qualunque canvas.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const REVEAL_SHAPES = ['rect', 'circle', 'diamond', 'star', 'heart', 'rounded', 'clock', 'blinds', 'cells'];

// cuore parametrico (curva classica), centrato otticamente sull'origine
const heartUnit = [];
for (let i = 0; i < 96; i++) {
  const t = (i / 96) * TAU;
  heartUnit.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) - 2.5]);
}
const starUnit = [];
for (let i = 0; i < 10; i++) {
  const r = i % 2 === 0 ? 1 : 0.42;
  const a = -Math.PI / 2 + (i * Math.PI) / 5;
  starUnit.push([Math.cos(a) * r, Math.sin(a) * r]);
}

function inPoly(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const fitCache = new Map();
/** Scala minima con cui la forma (poligono unitario) copre tutto il riquadro w×h: ricerca per bisezione. */
function fitScale(key, unit, w, h) {
  const ck = `${key}:${Math.round(w)}x${Math.round(h)}`;
  const hit = fitCache.get(ck);
  if (hit) return hit;
  const probes = [];
  for (let i = 0; i <= 12; i++) {
    const f = i / 12;
    probes.push([-w / 2 + w * f, -h / 2], [-w / 2 + w * f, h / 2], [-w / 2, -h / 2 + h * f], [w / 2, -h / 2 + h * f]);
  }
  const covers = (s) => probes.every(([x, y]) => inPoly(unit, x / s, y / s));
  let lo = 0;
  let hi = Math.hypot(w, h);
  while (!covers(hi)) hi *= 2; // la forma è unitaria (≈ 1): ci si arriva presto
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (covers(mid)) hi = mid;
    else lo = mid;
  }
  const s = hi * 1.005;
  if (fitCache.size > 64) fitCache.clear();
  fitCache.set(ck, s);
  return s;
}

const hash01 = (i, j) => (((Math.imul(i + 1, 73856093) ^ Math.imul(j + 1, 19349663)) >>> 0) % 1000) / 1000;

/**
 * @param {{shape: string, dir?: string, p: number, n?: number, mode?: string}} rv  p = 0 (nulla visibile) … 1 (tutto visibile)
 * @param {number} w larghezza del riquadro
 * @param {number} h altezza del riquadro
 * @returns {Array<{k:'rect',x:number,y:number,w:number,h:number}|{k:'rrect',x:number,y:number,w:number,h:number,r:number}|{k:'circle',cx:number,cy:number,r:number}|{k:'poly',pts:number[][]}>}
 */
export function revealShapes(rv, w, h) {
  const p = clamp(+rv.p || 0, 0, 1);
  if (p <= 0) return [];
  const diag = Math.hypot(w, h);
  const hw = w / 2;
  const hh = h / 2;
  switch (rv.shape) {
    case 'rect': {
      switch (rv.dir) {
        case 'left': return [{ k: 'rect', x: -hw, y: -hh, w: w * p, h }];
        case 'right': return [{ k: 'rect', x: hw - w * p, y: -hh, w: w * p, h }];
        case 'top': return [{ k: 'rect', x: -hw, y: -hh, w, h: h * p }];
        case 'bottom': return [{ k: 'rect', x: -hw, y: hh - h * p, w, h: h * p }];
        case 'center-x': return [{ k: 'rect', x: (-w * p) / 2, y: -hh, w: w * p, h }];
        case 'center-y': return [{ k: 'rect', x: -hw, y: (-h * p) / 2, w, h: h * p }];
        default: return [{ k: 'rect', x: -hw, y: -hh, w: w * p, h }];
      }
    }
    case 'circle':
      return [{ k: 'circle', cx: 0, cy: 0, r: p * diag * 0.5 }];
    case 'diamond':
      return [{ k: 'poly', pts: [[0, -h * p], [w * p, 0], [0, h * p], [-w * p, 0]] }];
    case 'rounded': {
      const s = p * 1.25;
      return [{ k: 'rrect', x: -hw * s, y: -hh * s, w: w * s, h: h * s, r: Math.min(w, h) * 0.2 * p }];
    }
    case 'star': {
      const k = p * fitScale('star', starUnit, w, h);
      return [{ k: 'poly', pts: starUnit.map(([x, y]) => [x * k, y * k]) }];
    }
    case 'heart': {
      const k = p * fitScale('heart', heartUnit, w, h);
      return [{ k: 'poly', pts: heartUnit.map(([x, y]) => [x * k, y * k]) }];
    }
    case 'clock': {
      const R = diag * 0.52;
      const sweep = TAU * p;
      const steps = Math.max(2, Math.ceil(p * 96));
      const pts = [[0, 0]];
      for (let i = 0; i <= steps; i++) {
        const a = -Math.PI / 2 + (sweep * i) / steps;
        pts.push([Math.cos(a) * R, Math.sin(a) * R]);
      }
      return [{ k: 'poly', pts }];
    }
    case 'blinds': {
      const n = clamp(Math.round(rv.n ?? 8), 2, 64);
      const out = [];
      for (let i = 0; i < n; i++) {
        if (rv.dir === 'v') out.push({ k: 'rect', x: -hw + (i * w) / n, y: -hh, w: (w / n) * p, h });
        else out.push({ k: 'rect', x: -hw, y: -hh + (i * h) / n, w, h: (h / n) * p });
      }
      return out;
    }
    case 'cells': {
      const cols = clamp(Math.round(rv.n ?? 8), 2, 40);
      const rows = Math.max(1, Math.round((cols * h) / w));
      const cw = w / cols;
      const ch = h / rows;
      const out = [];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const thr = rv.mode === 'checker' ? (i + j) & 1 : hash01(i, j);
          const f = clamp((p - thr * 0.6) / 0.4, 0, 1);
          if (f <= 0) continue;
          out.push({ k: 'rect', x: -hw + i * cw + (cw * (1 - f)) / 2, y: -hh + j * ch + (ch * (1 - f)) / 2, w: cw * f, h: ch * f });
        }
      }
      return out;
    }
    default:
      return [{ k: 'rect', x: -hw, y: -hh, w, h }];
  }
}

/** Il punto (x, y) è dentro una delle primitive? (serve alle prove) */
export function revealCovers(shapes, x, y) {
  for (const s of shapes) {
    if (s.k === 'rect' && x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return true;
    if (s.k === 'circle' && Math.hypot(x - s.cx, y - s.cy) <= s.r) return true;
    if (s.k === 'poly' && inPoly(s.pts, x, y)) return true;
    if (s.k === 'rrect') {
      if (x < s.x || x > s.x + s.w || y < s.y || y > s.y + s.h) continue;
      const cx = clamp(x, s.x + s.r, s.x + s.w - s.r);
      const cy = clamp(y, s.y + s.r, s.y + s.h - s.r);
      if (Math.hypot(x - cx, y - cy) <= s.r + 1e-9) return true;
    }
  }
  return false;
}
