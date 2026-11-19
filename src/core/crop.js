// Ritaglio dell'inquadratura: calcoli puri per le maniglie nell'anteprima e per i formati (1:1, 9:16…).
// `crop` = frazioni tolte da ogni lato del file sorgente: {l, t, r, b}.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MAX_CUT = 0.95; // non si può togliere più del 95% su un asse

export const CROP_ASPECTS = [
  { id: 'free', label: 'Libero', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '21:9', label: '21:9', ratio: 21 / 9 },
];

/** Ritaglio centrato che dà il rapporto `ratio` (larghezza/altezza della parte visibile) tenendo più immagine possibile. */
export function cropForAspect(mw, mh, ratio) {
  if (!(mw > 0) || !(mh > 0) || !(ratio > 0)) return { l: 0, t: 0, r: 0, b: 0 };
  if (mw / mh > ratio) {
    const side = (1 - (mh * ratio) / mw) / 2;
    return { l: side, t: 0, r: side, b: 0 };
  }
  const side = (1 - mw / ratio / mh) / 2;
  return { l: 0, t: side, r: 0, b: side };
}

/** Rapporto larghezza/altezza della parte visibile del file. */
export const visibleRatio = (mw, mh, c) => (mw * (1 - c.l - c.r)) / (mh * (1 - c.t - c.b));

/**
 * Trascinamento di un bordo o di un angolo. `dx`, `dy` = spostamento in frazioni dell'immagine intera (non ritagliata),
 * positivo verso destra e verso il basso. `edge`: l r t b (bordi) oppure tl tr bl br (angoli).
 * Con `ratio` (e le dimensioni del file) l'angolo mantiene il rapporto.
 */
export function dragCrop(crop, edge, dx, dy, { ratio = null, mw = 0, mh = 0 } = {}) {
  const L = edge.includes('l');
  const R = edge.includes('r');
  const T = edge.includes('t');
  const B = edge.includes('b');
  let { l, t, r, b } = crop;
  if (L) l += dx;
  if (R) r -= dx;
  if (T) t += dy;
  if (B) b -= dy;
  l = clamp(l, 0, MAX_CUT);
  r = clamp(r, 0, MAX_CUT);
  t = clamp(t, 0, MAX_CUT);
  b = clamp(b, 0, MAX_CUT);
  if (l + r > MAX_CUT) {
    if (L) l = MAX_CUT - r;
    else r = MAX_CUT - l;
  }
  if (t + b > MAX_CUT) {
    if (T) t = MAX_CUT - b;
    else b = MAX_CUT - t;
  }
  if (ratio && mw > 0 && mh > 0 && edge.length === 2) {
    // angolo con rapporto fisso: la larghezza decide, l'altezza segue spostando il lato verticale trascinato
    const vw = 1 - l - r;
    const vh = clamp((vw * mw) / ratio / mh, 0.02, 1);
    const cut = 1 - vh;
    if (T) t = clamp(cut - b, 0, MAX_CUT);
    else b = clamp(cut - t, 0, MAX_CUT);
  }
  return { l, t, r, b };
}

/** Con il clip ribaltato il bordo che si vede a sinistra è quello destro del file (e così via). */
export function edgeForFlip(edge, flipX, flipY) {
  const swap = { l: 'r', r: 'l', t: 'b', b: 't' };
  return [...edge].map((ch) => ((flipX && (ch === 'l' || ch === 'r')) || (flipY && (ch === 't' || ch === 'b')) ? swap[ch] : ch)).join('');
}
