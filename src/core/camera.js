// Movimenti di camera simulati: generano keyframe di scala, posizione e rotazione su tutta la durata del clip
// (zoom lento, panoramiche, mano libera). Pure.

export const CAMERA_MOVES = [
  { id: 'zoom-in', label: 'Zoom avanti lento' },
  { id: 'zoom-out', label: 'Zoom indietro lento' },
  { id: 'pan-left', label: 'Panoramica verso sinistra' },
  { id: 'pan-right', label: 'Panoramica verso destra' },
  { id: 'tilt-up', label: 'Inclina verso l’alto' },
  { id: 'tilt-down', label: 'Inclina verso il basso' },
  { id: 'ken-burns', label: 'Ken Burns (zoom + spostamento)' },
  { id: 'handheld', label: 'Mano libera (camera a spalla)' },
  { id: 'dolly-zoom', label: 'Zoom «alla Hitchcock» (avanti e indietro)' },
];
export const CAMERA_IDS = CAMERA_MOVES.map((m) => m.id);
const PROPS = ['scale', 'x', 'y', 'rotation'];

/** Generatore pseudo-casuale con seme (mulberry32): stesso seme, stessi movimenti. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const kf = (t, v, e = 'ease-in-out') => ({ t, v, e });

/**
 * Keyframe del movimento per un clip lungo `d` secondi. `base` = {scale, x, y, rotation} di partenza.
 * @param {string} id uno di CAMERA_IDS
 * @param {number} d durata del clip
 * @param {{amount?: number, base?: object, seed?: number}} o amount 0..100
 * @returns {Record<string, Array<{t:number,v:number,e:string}>>}
 */
export function cameraKeyframes(id, d, { amount = 50, base = {}, seed = 1 } = {}) {
  if (!CAMERA_IDS.includes(id)) throw new Error(`Movimento sconosciuto: ${id}`);
  const k = Math.min(100, Math.max(0, amount)) / 100;
  const s0 = base.scale ?? 1;
  const x0 = base.x ?? 0;
  const y0 = base.y ?? 0;
  const r0 = base.rotation ?? 0;
  const end = Math.max(0.1, d);
  const out = {};
  switch (id) {
    case 'zoom-in':
      out.scale = [kf(0, s0), kf(end, s0 * (1 + 0.35 * k))];
      break;
    case 'zoom-out':
      out.scale = [kf(0, s0 * (1 + 0.35 * k)), kf(end, s0)];
      break;
    case 'pan-left':
    case 'pan-right': {
      const pan = 0.08 * k;
      const sign = id === 'pan-left' ? -1 : 1; // «a sinistra» = la camera va a sinistra, l'immagine scorre verso destra
      out.scale = [kf(0, s0 * (1 + 2 * pan)), kf(end, s0 * (1 + 2 * pan))];
      out.x = [kf(0, x0 - sign * pan), kf(end, x0 + sign * pan)];
      break;
    }
    case 'tilt-up':
    case 'tilt-down': {
      const tilt = 0.08 * k;
      const sign = id === 'tilt-up' ? -1 : 1;
      out.scale = [kf(0, s0 * (1 + 2 * tilt)), kf(end, s0 * (1 + 2 * tilt))];
      out.y = [kf(0, y0 - sign * tilt), kf(end, y0 + sign * tilt)];
      break;
    }
    case 'ken-burns': {
      const r = rng(seed);
      const dir = r() < 0.5 ? -1 : 1;
      const dirY = r() < 0.5 ? -1 : 1;
      out.scale = [kf(0, s0 * (1 + 0.06 * k)), kf(end, s0 * (1 + 0.06 * k + 0.25 * k))];
      out.x = [kf(0, x0 - dir * 0.03 * k), kf(end, x0 + dir * 0.03 * k)];
      out.y = [kf(0, y0 - dirY * 0.02 * k), kf(end, y0 + dirY * 0.02 * k)];
      break;
    }
    case 'dolly-zoom': {
      out.scale = [kf(0, s0), kf(end / 2, s0 * (1 + 0.4 * k)), kf(end, s0)];
      break;
    }
    case 'handheld': {
      const r = rng(seed);
      const step = Math.max(0.2, end / 150); // al massimo 150 punti
      const n = Math.ceil(end / step);
      const amp = 0.012 * k;
      const rot = 0.8 * k;
      out.scale = [kf(0, s0 * (1 + 2.2 * amp + 0.01), 'linear'), kf(end, s0 * (1 + 2.2 * amp + 0.01), 'linear')];
      out.x = [];
      out.y = [];
      out.rotation = [];
      for (let i = 0; i <= n; i++) {
        const t = Math.min(end, i * step);
        out.x.push(kf(t, x0 + (r() * 2 - 1) * amp, 'ease-in-out'));
        out.y.push(kf(t, y0 + (r() * 2 - 1) * amp, 'ease-in-out'));
        out.rotation.push(kf(t, r0 + (r() * 2 - 1) * rot, 'ease-in-out'));
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/** Sostituisce i keyframe di scala/posizione/rotazione del clip con quelli del movimento. */
export function applyCameraMove(clip, id, { amount = 50, seed = 1 } = {}) {
  const base = { scale: clip.transform.scale, x: clip.transform.x, y: clip.transform.y, rotation: clip.transform.rotation };
  const kfs = cameraKeyframes(id, clip.duration, { amount, base, seed });
  clip.keyframes ??= {};
  for (const p of PROPS) delete clip.keyframes[p];
  for (const [p, list] of Object.entries(kfs)) clip.keyframes[p] = list;
  return Object.keys(kfs);
}

/** Toglie i keyframe di movimento (il clip torna ai valori di base). */
export function clearCameraMove(clip) {
  for (const p of PROPS) delete clip.keyframes?.[p];
}
