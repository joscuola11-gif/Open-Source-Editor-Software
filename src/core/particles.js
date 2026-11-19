// Sovrapposizioni procedurali (neve, pioggia, coriandoli, scintille, bokeh, polvere, cuori, perdita di luce).
// Pure e deterministiche: dato il tempo restituiscono le forme da disegnare, quindi anteprima = esportazione.
// Coordinate normalizzate: x, y in frazioni del riquadro (0..1); le dimensioni `r`, `size`, `w`, `h` sono frazioni dell'ALTEZZA.

export const PARTICLE_TYPES = {
  snow: { label: 'Neve', max: 160 },
  rain: { label: 'Pioggia', max: 140 },
  confetti: { label: 'Coriandoli', max: 120 },
  sparkles: { label: 'Scintille', max: 60 },
  bokeh: { label: 'Bokeh (luci sfocate)', max: 24 },
  dust: { label: 'Polvere', max: 90 },
  hearts: { label: 'Cuori', max: 40 },
  leak: { label: 'Perdita di luce', max: 3 },
};
export const PARTICLE_IDS = Object.keys(PARTICLE_TYPES);

/** Numero casuale ripetibile da (seme, indice, canale): stesso ingresso, stesso numero. */
function hash(seed, i, k) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35) ^ Math.imul(k + 1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const frac = (v) => v - Math.floor(v);
const PALETTE = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#ff9f1c'];

/**
 * @param {string} type uno di PARTICLE_IDS
 * @param {number} t secondi
 * @param {{amount?: number, seed?: number}} o amount 0..100
 * @returns {Array<object>} forme: {k:'circle'|'line'|'rect'|'star'|'heart'|'grad', ...}
 */
export function particleField(type, t, { amount = 50, seed = 1 } = {}) {
  const spec = PARTICLE_TYPES[type];
  if (!spec) return [];
  const a = Math.max(0, Math.min(100, amount)) / 100;
  const n = Math.round(spec.max * (0.1 + 0.9 * a) * (a > 0 ? 1 : 0));
  const out = [];
  const r = (i, k) => hash(seed, i, k);
  for (let i = 0; i < n; i++) {
    switch (type) {
      case 'snow': {
        const sp = 0.05 + r(i, 1) * 0.1;
        out.push({ k: 'circle', x: frac(r(i, 0) + Math.sin(t * (0.6 + r(i, 2)) + r(i, 3) * 6.28) * 0.02), y: frac(r(i, 4) + t * sp), r: 0.004 + r(i, 5) * 0.009, a: 0.55 + r(i, 6) * 0.45, color: '#ffffff' });
        break;
      }
      case 'rain': {
        const sp = 0.9 + r(i, 1) * 0.8;
        const len = 0.04 + r(i, 2) * 0.05;
        const x = frac(r(i, 0) - t * 0.12 * sp * 0.25);
        const y = frac(r(i, 4) + t * sp);
        out.push({ k: 'line', x1: x, y1: y, x2: x - len * 0.18, y2: y + len, w: 0.0016 + r(i, 5) * 0.0012, a: 0.25 + r(i, 6) * 0.3, color: '#cfe3ff' });
        break;
      }
      case 'confetti': {
        const sp = 0.07 + r(i, 1) * 0.12;
        out.push({ k: 'rect', x: frac(r(i, 0) + Math.sin(t * (1 + r(i, 2) * 2) + r(i, 3) * 6.28) * 0.03), y: frac(r(i, 4) + t * sp), w: 0.008 + r(i, 5) * 0.01, h: 0.014 + r(i, 6) * 0.014, rot: (t * (1 + r(i, 7) * 4) + r(i, 8) * 6.28) % 6.2832, a: 0.95, color: PALETTE[Math.floor(r(i, 9) * PALETTE.length)] });
        break;
      }
      case 'sparkles': {
        const tw = Math.sin(t * (1.5 + r(i, 2) * 3) + r(i, 3) * 6.28) * 0.5 + 0.5;
        out.push({ k: 'star', x: r(i, 0), y: r(i, 4), r: 0.008 + r(i, 5) * 0.02, rot: r(i, 6) * 1.5, a: tw ** 3, color: r(i, 7) < 0.5 ? '#ffffff' : '#ffe9a8' });
        break;
      }
      case 'bokeh': {
        out.push({ k: 'circle', x: frac(r(i, 0) + t * (0.01 + r(i, 2) * 0.02) * (r(i, 3) < 0.5 ? 1 : -1)), y: frac(r(i, 4) + Math.sin(t * 0.3 + r(i, 5) * 6.28) * 0.03), r: 0.03 + r(i, 1) * 0.07, a: 0.08 + r(i, 6) * 0.2 + 0.05 * Math.sin(t * 0.8 + r(i, 7) * 6.28), color: ['#ffd9a0', '#ffb3c6', '#bde0fe', '#ffffff'][Math.floor(r(i, 8) * 4)] });
        break;
      }
      case 'dust': {
        const slot = Math.floor(t * 8); // la polvere «salta» di posto ogni ottavo di secondo
        out.push({ k: 'circle', x: r(i + slot * 131, 0), y: r(i + slot * 131, 4), r: 0.0012 + r(i, 5) * 0.003, a: 0.25 + r(i + slot * 131, 6) * 0.5, color: '#ffffff' });
        break;
      }
      case 'hearts': {
        const sp = 0.06 + r(i, 1) * 0.09;
        out.push({ k: 'heart', x: frac(r(i, 0) + Math.sin(t * (0.8 + r(i, 2)) + r(i, 3) * 6.28) * 0.03), y: 1 - frac(r(i, 4) + t * sp), size: 0.025 + r(i, 5) * 0.045, a: 0.55 + r(i, 6) * 0.4, color: ['#ff4d6d', '#ff85a1', '#ffb3c1', '#ff0a54'][Math.floor(r(i, 7) * 4)] });
        break;
      }
      case 'leak': {
        const ph = t * (0.18 + i * 0.07) + i * 2.1 + r(i, 0) * 6.28;
        out.push({ k: 'grad', x0: 0.5 + Math.cos(ph) * 0.6, y0: 0.5 + Math.sin(ph * 0.8) * 0.4, x1: 0.5 - Math.cos(ph) * 0.4, y1: 0.5 - Math.sin(ph * 0.8) * 0.5, a: (0.12 + 0.22 * a) * (0.6 + 0.4 * Math.sin(t * (0.7 + i * 0.3) + i)), stops: [[0, ['#ff7a18', '#ff3d77', '#ffd166'][i % 3]], [1, 'rgba(255,255,255,0)']] });
        break;
      }
      default:
    }
  }
  return out;
}
