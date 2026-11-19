// Matematica del «Layout»: rotazioni di 90°, adattamento al quadro, ancoraggi e disposizioni.
// Funzioni pure (nessun DOM), testate in tests/unit/layout.test.js.
//
// Convenzioni: W×H = dimensioni del canvas del progetto; w×h = dimensioni a schermo di un clip (già scalate);
// gli angoli sono in gradi, positivi in senso orario (come ctx.rotate).

const rad = (d) => (d * Math.PI) / 180;
const EPS = 1e-9;

/** Porta un angolo nell'intervallo (-180, 180]. */
export function normalizeAngle(a) {
  if (!Number.isFinite(a)) return 0;
  const r = ((a % 360) + 360) % 360;
  return r > 180 ? r - 360 : r;
}

/** Rettangolo (w×h) ruotato di `deg`: dimensioni del suo ingombro (bounding box allineato agli assi). */
export function boundingBox(w, h, deg) {
  const r = rad(deg);
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  // gli angoli multipli di 90° devono dare valori esatti (cos(90°) in virgola mobile non è 0)
  const snap = (v) => (Math.abs(v) < 1e-12 ? 0 : Math.abs(v - 1) < 1e-12 ? 1 : v);
  const cc = snap(c);
  const ss = snap(s);
  return { w: w * cc + h * ss, h: w * ss + h * cc };
}

/** Fattore di scala che fa entrare (contain) un riquadro box dentro un'area. */
export function containScale(boxW, boxH, areaW, areaH) {
  if (boxW <= EPS || boxH <= EPS) return 1;
  return Math.min(areaW / boxW, areaH / boxH);
}

/** Vero se il riquadro tocca il canvas su un asse (è «adattato», non zoomato né rimpicciolito). */
export function isFitting(boxW, boxH, W, H, tol = 0.02) {
  return Math.abs(Math.max(boxW / W, boxH / H) - 1) <= tol;
}

/**
 * Fattore da applicare alla scala dopo aver ruotato un clip da `fromDeg` a `toDeg`, in modo che il
 * contenuto ruotato resti nel quadro: se prima era adattato torna adattato; altrimenti si riduce solo
 * se uscirebbe dal canvas (gli zoom dell'utente non vengono toccati).
 */
export function rotationScaleFactor({ w, h, fromDeg, toDeg, W, H }) {
  const before = boundingBox(w, h, fromDeg);
  const after = boundingBox(w, h, toDeg);
  const k = containScale(after.w, after.h, W, H);
  if (isFitting(before.w, before.h, W, H)) return k;
  return k < 1 ? k : 1;
}

/**
 * Centro (in px canvas) che porta un riquadro bw×bh contro l'ancora (ax, ay) ∈ {-1, 0, 1}².
 * Se il riquadro è più grande del canvas su un asse viene centrato su quell'asse.
 */
export function anchorTarget(ax, ay, W, H, bw, bh) {
  return {
    cx: W / 2 + ax * Math.max(0, (W - bw) / 2),
    cy: H / 2 + ay * Math.max(0, (H - bh) / 2),
  };
}

const cell = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });

/** Disposizioni pronte: celle normalizzate (0..1) assegnate ai clip nell'ordine di selezione. */
export const LAYOUT_PRESETS = {
  full: { label: 'Schermo intero', short: 'Intero', hint: 'Adatta il clip a tutto il quadro', cells: [cell(0, 0, 1, 1)], applyToAll: true },
  'split-h': { label: 'Affiancati', short: 'Affiancati', hint: 'Due clip: uno a sinistra e uno a destra', cells: [cell(0, 0, 0.5, 1), cell(0.5, 0, 1, 1)] },
  'split-v': { label: 'Sopra e sotto', short: 'Sopra/sotto', hint: 'Due clip: uno sopra e uno sotto', cells: [cell(0, 0, 1, 0.5), cell(0, 0.5, 1, 1)] },
  pip: { label: 'Picture-in-picture', short: 'In un angolo', hint: 'Il primo clip è lo sfondo, il secondo è piccolo in basso a destra', cells: [cell(0, 0, 1, 1), cell(0.64, 0.62, 0.97, 0.97)] },
};

/** Cella da usare per l'i-esimo clip, oppure null se la disposizione non ha posto per lui. */
export function cellFor(presetId, index) {
  const p = LAYOUT_PRESETS[presetId];
  if (!p) return null;
  if (index < p.cells.length) return p.cells[index];
  return p.applyToAll ? p.cells[p.cells.length - 1] : null;
}

/** Rettangolo in px canvas di una cella normalizzata. */
export function cellRect(c, W, H) {
  return { x: c.x0 * W, y: c.y0 * H, w: (c.x1 - c.x0) * W, h: (c.y1 - c.y0) * H };
}
