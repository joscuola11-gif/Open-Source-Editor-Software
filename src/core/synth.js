// Suoni e musica generati con la sintesi: nessun campione registrato, nessun brano di terzi, quindi nessuna licenza da rispettare.
// Puro e deterministico: stesso seme → stesso suono. Gli effetti sonori sono onde, rumore e filtri; la musica segue regole semplici
// (scala, accordi, ritmo) con strumenti sintetici (pad, basso, arpeggio, melodia, batteria).

import { biquad, filter } from './dsp.js';

export const SAMPLE_RATE = 44100;
const TAU = Math.PI * 2;

/** Generatore pseudo-casuale con seme (mulberry32). */
export function rng(seed = 1) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const zeros = (n) => new Float32Array(Math.max(1, Math.round(n)));

// ---- mattoni ---------------------------------------------------------------------------------------------------

const tables = new Map();
/** Una forma d'onda a banda limitata (tabella di 2048 punti, con `nh` armoniche). */
function table(type, nh) {
  const key = `${type}:${nh}`;
  if (tables.has(key)) return tables.get(key);
  const N = 2048;
  const t = new Float32Array(N);
  for (let h = 1; h <= nh; h++) {
    let amp;
    if (type === 'sine') amp = h === 1 ? 1 : 0;
    else if (type === 'saw') amp = 1 / h;
    else if (type === 'square') amp = h % 2 ? 1 / h : 0;
    else if (type === 'tri') amp = h % 2 ? (((h - 1) / 2) % 2 ? -1 : 1) / (h * h) : 0;
    else amp = 0;
    if (!amp) continue;
    for (let i = 0; i < N; i++) t[i] += amp * Math.sin((TAU * h * i) / N);
  }
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(t[i]));
  for (let i = 0; i < N; i++) t[i] /= peak || 1;
  tables.set(key, t);
  return t;
}

/** Oscillatore a tabella. `fm` (opzionale) è una funzione del tempo in secondi che dà la frequenza (per glissandi). */
function osc(type, freq, n, sr, { phase = 0, detune = 0, fm = null } = {}) {
  const out = new Float32Array(n);
  const N = 2048;
  const f0 = fm ? Math.max(freq, fm(0)) : freq;
  const tab = table(type, clamp(Math.floor((0.45 * sr) / Math.max(20, f0 * 2 ** (Math.abs(detune) / 1200))), 1, 40));
  let ph = phase * N;
  const mul = 2 ** (detune / 1200);
  for (let i = 0; i < n; i++) {
    const f = (fm ? fm(i / sr) : freq) * mul;
    const p = Math.floor(ph);
    const fr = ph - p;
    out[i] = tab[p & (N - 1)] * (1 - fr) + tab[(p + 1) & (N - 1)] * fr;
    ph += (f * N) / sr;
    if (ph >= N) ph -= N * Math.floor(ph / N);
  }
  return out;
}

/** Rumore bianco. */
function noise(n, r) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r() * 2 - 1;
  return out;
}

/** Inviluppo ADSR: `dur` = durata della nota (poi il rilascio `r`), tutto in secondi. Moltiplica sul posto. */
function adsr(x, sr, a, d, s, dur, r) {
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let g;
    if (t < a) g = t / Math.max(1e-6, a);
    else if (t < a + d) g = 1 - (1 - s) * ((t - a) / Math.max(1e-6, d));
    else g = s;
    if (t > dur) g *= Math.max(0, 1 - (t - dur) / Math.max(1e-6, r));
    x[i] *= g;
  }
  return x;
}

/** Inviluppo esponenziale a decadimento (percussioni): sale subito e scende con costante `tau` secondi. */
function decay(x, sr, tau, attack = 0.001) {
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    x[i] *= (t < attack ? t / attack : 1) * Math.exp(-t / tau);
  }
  return x;
}

/** Filtro a variabili di stato con frequenza di taglio che varia nel tempo (log): `mode` = 'lp' | 'bp' | 'hp'. */
function sweep(x, sr, f0, f1, q = 0.8, mode = 'lp') {
  const out = new Float32Array(x.length);
  let low = 0;
  let band = 0;
  const n = x.length;
  const damp = 1 / Math.max(0.05, q);
  const l0 = Math.log(f0);
  const l1 = Math.log(f1);
  for (let i = 0; i < n; i++) {
    const fc = Math.exp(l0 + (l1 - l0) * (i / Math.max(1, n - 1)));
    const f = 2 * Math.sin((Math.PI * Math.min(fc, sr * 0.22)) / sr);
    // due passi per stabilità
    for (let k = 0; k < 2; k++) {
      low += f * 0.5 * band;
      const high = x[i] - low - damp * band;
      band += f * 0.5 * high;
      if (k) out[i] = mode === 'lp' ? low : mode === 'bp' ? band : high;
    }
  }
  return out;
}

const biq = (x, type, sr, freq, q) => filter(x, biquad(type, sr, freq, q));

/** Somma `src` in `dst` a partire da `at` (campioni) con guadagno. */
function mixInto(dst, src, at, gain = 1) {
  const start = Math.max(0, Math.round(at));
  for (let i = 0; i < src.length; i++) {
    const j = start + i;
    if (j >= dst.length) break;
    dst[j] += src[i] * gain;
  }
}

function panGains(pan) {
  const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}
function mixStereo(L, R, src, at, gain, pan = 0) {
  const [gl, gr] = panGains(pan);
  mixInto(L, src, at, gain * gl);
  mixInto(R, src, at, gain * gr);
}

const rms = (x) => {
  let e = 0;
  for (let i = 0; i < x.length; i++) e += x[i] * x[i];
  return Math.sqrt(e / Math.max(1, x.length));
};

/** Code di riverbero (4 filtri a pettine + 2 passa-tutto, una taratura diversa per canale): spazio senza campioni. */
export function reverbTails(L, R, sr, { size = 0.5, damp = 0.5 } = {}) {
  const tune = [1116, 1188, 1277, 1356].map((v) => Math.round(v * (0.6 + 0.8 * size) * (sr / 44100)));
  const run = (x, off) => {
    const out = new Float32Array(x.length);
    for (const t of tune) {
      const len = t + off;
      const buf = new Float32Array(len);
      let idx = 0;
      let store = 0;
      const fb = 0.72 + 0.2 * size;
      for (let i = 0; i < x.length; i++) {
        const y = buf[idx];
        store = y * (1 - damp) + store * damp;
        buf[idx] = x[i] + store * fb;
        idx = (idx + 1) % len;
        out[i] += y;
      }
    }
    for (const t of [556, 441]) {
      const len = Math.round((t + off) * (sr / 44100));
      const buf = new Float32Array(len);
      let idx = 0;
      for (let i = 0; i < out.length; i++) {
        const b = buf[idx];
        const v = out[i] + b * 0.5;
        buf[idx] = v;
        out[i] = b - out[i] * 0.5;
        idx = (idx + 1) % len;
      }
    }
    return out;
  };
  return [run(L, 0), run(R, 23)];
}

/** Aggiunge il riverbero a (L, R) sul posto: il livello delle code è `wet` volte quello del segnale secco. */
export function reverb(L, R, sr, { size = 0.5, wet = 0.25, damp = 0.5 } = {}) {
  const [wl, wr] = reverbTails(L, R, sr, { size, damp });
  const g = (wet * (rms(L) + rms(R))) / Math.max(1e-9, rms(wl) + rms(wr));
  for (let i = 0; i < L.length; i++) {
    L[i] += wl[i] * g;
    R[i] += wr[i] * g;
  }
}

/** Limitatore morbido + normalizzazione al picco `peak` + dissolvenze brevi (niente «clic» agli estremi). */
function master(chs, sr, { peak = 0.89, fadeIn = 0.004, fadeOut = 0.01, drive = 1.1 } = {}) {
  let max = 0;
  const norm = Math.tanh(drive);
  for (const c of chs) {
    for (let i = 0; i < c.length; i++) {
      c[i] = Math.tanh(drive * c[i]) / norm;
      max = Math.max(max, Math.abs(c[i]));
    }
  }
  const g = max > 1e-9 ? peak / max : 1;
  const fi = Math.round(fadeIn * sr);
  const fo = Math.round(fadeOut * sr);
  for (const c of chs) {
    for (let i = 0; i < c.length; i++) c[i] *= g;
    for (let i = 0; i < Math.min(fi, c.length); i++) c[i] *= i / fi;
    for (let i = 0; i < Math.min(fo, c.length); i++) c[c.length - 1 - i] *= i / fo;
  }
  return chs;
}

const stereoOf = (mono) => [mono, Float32Array.from(mono)];

// ---- effetti sonori --------------------------------------------------------------------------------------------

/** Una nota a campana: parziali inarmonici che decadono a velocità diverse. */
function bell(freq, sr, dur = 1.5, brightness = 1) {
  const n = Math.round(dur * sr);
  const out = new Float32Array(n);
  const parts = [[1, 1, 1], [2.76, 0.55 * brightness, 0.6], [5.4, 0.32 * brightness, 0.4], [8.93, 0.18 * brightness, 0.25]];
  for (const [m, a, d] of parts) {
    const o = osc('sine', freq * m, n, sr);
    decay(o, sr, (dur / 3.2) * d, 0.0008);
    for (let i = 0; i < n; i++) out[i] += o[i] * a;
  }
  return out;
}

export const SFX = [
  // Movimento
  { id: 'whoosh', group: 'Movimento', label: 'Whoosh', make: (sr, r) => {
    const n = Math.round(0.9 * sr);
    const x = sweep(noise(n, r), sr, 300, 5200, 1.1, 'bp');
    const half = n / 2;
    for (let i = 0; i < n; i++) x[i] *= Math.sin((Math.PI * i) / n) ** 1.6 * (i < half ? 0.9 : 1);
    return stereoOf(x);
  } },
  { id: 'swoosh', group: 'Movimento', label: 'Swoosh veloce', make: (sr, r) => {
    const n = Math.round(0.35 * sr);
    const x = sweep(noise(n, r), sr, 700, 8000, 0.9, 'bp');
    for (let i = 0; i < n; i++) x[i] *= Math.sin((Math.PI * i) / n) ** 1.2;
    return stereoOf(x);
  } },
  { id: 'riser', group: 'Movimento', label: 'Salita (tensione)', make: (sr, r) => {
    const n = Math.round(3.2 * sr);
    const x = sweep(noise(n, r), sr, 250, 9000, 1.3, 'bp');
    const t = osc('saw', 0, n, sr, { fm: (s) => 110 * 2 ** ((s / 3.2) * 2.6) });
    const lp = sweep(t, sr, 400, 6000, 0.9, 'lp');
    for (let i = 0; i < n; i++) {
      const g = (i / n) ** 2.2;
      x[i] = (x[i] * 0.9 + lp[i] * 0.45) * g;
    }
    return stereoOf(x);
  } },
  { id: 'downlifter', group: 'Movimento', label: 'Discesa', make: (sr, r) => {
    const n = Math.round(2.2 * sr);
    const x = sweep(noise(n, r), sr, 7000, 200, 1.1, 'bp');
    const t = osc('saw', 0, n, sr, { fm: (s) => 880 * 2 ** (-(s / 2.2) * 3) });
    for (let i = 0; i < n; i++) x[i] = (x[i] * 0.8 + t[i] * 0.2) * Math.exp(-(i / n) * 3.2);
    return stereoOf(x);
  } },
  // Impatti
  { id: 'impact', group: 'Impatti', label: 'Impatto (boato)', make: (sr, r) => {
    const n = Math.round(2.2 * sr);
    const sub = osc('sine', 0, n, sr, { fm: (s) => 38 + 80 * Math.exp(-s * 14) });
    decay(sub, sr, 0.55, 0.002);
    const body = biq(noise(n, r), 'lowpass', sr, 400, 0.7);
    decay(body, sr, 0.18, 0.001);
    const crack = biq(noise(n, r), 'highpass', sr, 2500, 0.7);
    decay(crack, sr, 0.03, 0.0005);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = sub[i] * 1.0 + body[i] * 0.8 + crack[i] * 0.35;
    const L = x;
    const R = Float32Array.from(x);
    reverb(L, R, sr, { size: 0.8, wet: 0.5, damp: 0.4 });
    return [L, R];
  } },
  { id: 'hit', group: 'Impatti', label: 'Colpo secco', make: (sr, r) => {
    const n = Math.round(0.4 * sr);
    const t = osc('sine', 0, n, sr, { fm: (s) => 60 + 150 * Math.exp(-s * 40) });
    decay(t, sr, 0.09, 0.0005);
    const c = biq(noise(n, r), 'bandpass', sr, 1800, 0.8);
    decay(c, sr, 0.025, 0.0003);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = t[i] + c[i] * 0.7;
    return stereoOf(x);
  } },
  { id: 'explosion', group: 'Impatti', label: 'Esplosione', make: (sr, r) => {
    const n = Math.round(3 * sr);
    const x = sweep(noise(n, r), sr, 3000, 90, 0.7, 'lp');
    decay(x, sr, 0.7, 0.003);
    const sub = osc('sine', 0, n, sr, { fm: (s) => 32 + 60 * Math.exp(-s * 8) });
    decay(sub, sr, 0.9, 0.003);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = x[i] * 1.2 + sub[i] * 0.9;
    const L = y;
    const R = sweep(noise(n, r), sr, 3000, 90, 0.7, 'lp');
    decay(R, sr, 0.7, 0.003);
    for (let i = 0; i < n; i++) R[i] = R[i] * 1.2 + sub[i] * 0.9;
    return [L, R];
  } },
  { id: 'thud', group: 'Impatti', label: 'Tonfo', make: (sr, r) => {
    const n = Math.round(0.6 * sr);
    const t = osc('sine', 0, n, sr, { fm: (s) => 48 + 40 * Math.exp(-s * 25) });
    decay(t, sr, 0.16, 0.002);
    const c = biq(noise(n, r), 'lowpass', sr, 220, 0.7);
    decay(c, sr, 0.04, 0.001);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = t[i] + c[i] * 0.6;
    return stereoOf(x);
  } },
  // Interfaccia
  { id: 'click', group: 'Interfaccia', label: 'Clic', make: (sr, r) => {
    const n = Math.round(0.05 * sr);
    const x = biq(noise(n, r), 'bandpass', sr, 3200, 1.5);
    decay(x, sr, 0.004, 0.0002);
    return stereoOf(x);
  } },
  { id: 'pop', group: 'Interfaccia', label: 'Pop (bolla)', make: (sr) => {
    const n = Math.round(0.18 * sr);
    const x = osc('sine', 0, n, sr, { fm: (s) => 260 + 900 * Math.exp(-s * 55) });
    decay(x, sr, 0.04, 0.0006);
    return stereoOf(x);
  } },
  { id: 'ding', group: 'Interfaccia', label: 'Din (campanello)', make: (sr) => {
    const x = bell(1175, sr, 1.8);
    return stereoOf(x);
  } },
  { id: 'notify', group: 'Interfaccia', label: 'Notifica', make: (sr) => {
    const a = bell(880, sr, 0.9, 0.6);
    const b = bell(1318.5, sr, 1.0, 0.6);
    const x = new Float32Array(Math.round(1.1 * sr));
    mixInto(x, a, 0, 0.8);
    mixInto(x, b, 0.13 * sr, 0.9);
    return stereoOf(x);
  } },
  { id: 'success', group: 'Interfaccia', label: 'Successo', make: (sr) => {
    const x = new Float32Array(Math.round(1.4 * sr));
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => mixInto(x, bell(f, sr, 0.9, 0.5), i * 0.09 * sr, 0.6));
    return stereoOf(x);
  } },
  { id: 'error', group: 'Interfaccia', label: 'Errore', make: (sr) => {
    const n = Math.round(0.5 * sr);
    const a = osc('square', 150, n, sr);
    const b = osc('square', 157, n, sr);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = (a[i] + b[i]) * 0.5;
    const f = biq(y, 'lowpass', sr, 1200, 0.8);
    adsr(f, sr, 0.005, 0.05, 0.8, 0.38, 0.1);
    return stereoOf(f);
  } },
  // Giochi ed elettronici
  { id: 'laser', group: 'Elettronici', label: 'Laser', make: (sr) => {
    const n = Math.round(0.45 * sr);
    const x = osc('saw', 0, n, sr, { fm: (s) => 2400 * Math.exp(-s * 7) + 180 });
    const f = biq(x, 'lowpass', sr, 5000, 0.7);
    decay(f, sr, 0.18, 0.001);
    return stereoOf(f);
  } },
  { id: 'powerup', group: 'Elettronici', label: 'Bonus', make: (sr) => {
    const n = Math.round(0.8 * sr);
    const x = osc('square', 0, n, sr, { fm: (s) => 330 * 2 ** (Math.floor(s * 14) / 12 * 1.0) });
    const f = biq(x, 'lowpass', sr, 3500, 0.7);
    adsr(f, sr, 0.003, 0.05, 0.7, 0.65, 0.12);
    return stereoOf(f);
  } },
  { id: 'coin', group: 'Elettronici', label: 'Moneta', make: (sr) => {
    const n = Math.round(0.45 * sr);
    const a = osc('square', 988, Math.round(0.07 * sr), sr);
    const b = osc('square', 1319, n - Math.round(0.07 * sr), sr);
    const x = new Float32Array(n);
    mixInto(x, adsr(a, sr, 0.001, 0.01, 0.9, 0.06, 0.01), 0, 1);
    mixInto(x, adsr(b, sr, 0.001, 0.15, 0.3, 0.2, 0.2), 0.07 * sr, 1);
    return stereoOf(biq(x, 'lowpass', sr, 5200, 0.7));
  } },
  { id: 'glitch', group: 'Elettronici', label: 'Glitch', make: (sr, r) => {
    const n = Math.round(0.6 * sr);
    const x = new Float32Array(n);
    let pos = 0;
    while (pos < n) {
      const len = Math.round((0.01 + r() * 0.05) * sr);
      const f = 200 + r() * 3000;
      const seg = r() < 0.5 ? osc('square', f, len, sr) : noise(len, r);
      mixInto(x, seg, pos, 0.5 * (r() < 0.2 ? 0 : 1));
      pos += len;
    }
    return stereoOf(x);
  } },
  // Ambienti e ritmi
  { id: 'rain', group: 'Ambiente', label: 'Pioggia', make: (sr, r) => {
    const n = Math.round(8 * sr);
    const mk = () => {
      const base = biq(noise(n, r), 'highpass', sr, 900, 0.7);
      const lp = biq(base, 'lowpass', sr, 9000, 0.7);
      // gocce: piccoli picchi casuali
      for (let k = 0; k < 160; k++) {
        const at = Math.floor(r() * (n - 400));
        const drop = biq(noise(300, r), 'bandpass', sr, 2500 + r() * 4000, 2);
        decay(drop, sr, 0.003);
        mixInto(lp, drop, at, 0.8 * r());
      }
      return lp;
    };
    return [mk(), mk()];
  } },
  { id: 'wind', group: 'Ambiente', label: 'Vento', make: (sr, r) => {
    const n = Math.round(8 * sr);
    const mk = () => {
      const x = biq(biq(biq(biq(noise(n, r), 'lowpass', sr, 800, 0.7), 'lowpass', sr, 800, 0.7), 'lowpass', sr, 800, 0.7), 'highpass', sr, 90, 0.7);
      const res = biq(biq(noise(n, r), 'bandpass', sr, 360, 2.5), 'lowpass', sr, 900, 0.7);
      const lfo1 = 0.35 + r() * 0.1;
      const lfo2 = 0.11 + r() * 0.05;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const gust = 0.45 + 0.35 * Math.sin(TAU * lfo1 * t + 1) * Math.sin(TAU * lfo2 * t) + 0.2 * Math.sin(TAU * lfo2 * 2.3 * t);
        x[i] = (x[i] * 0.7 + res[i] * 1.6) * gust;
      }
      return x;
    };
    return [mk(), mk()];
  } },
  { id: 'crackle', group: 'Ambiente', label: 'Disco in vinile', make: (sr, r) => {
    const n = Math.round(6 * sr);
    const mk = () => {
      const x = new Float32Array(n);
      for (let k = 0; k < 90; k++) {
        const at = Math.floor(r() * n);
        const len = Math.round((0.0008 + r() * 0.004) * sr);
        const s = noise(len, r);
        decay(s, sr, 0.0012, 0.0001);
        mixInto(x, s, at, 0.3 + r() * 0.7);
      }
      const hiss = biq(noise(n, r), 'highpass', sr, 3000, 0.7);
      for (let i = 0; i < n; i++) x[i] += hiss[i] * 0.05;
      return x;
    };
    return [mk(), mk()];
  } },
  { id: 'applause', group: 'Ambiente', label: 'Applauso', make: (sr, r) => {
    const n = Math.round(5 * sr);
    const mk = () => {
      const x = new Float32Array(n);
      for (let k = 0; k < 1100; k++) {
        const t = r();
        const shape = Math.sin(Math.PI * t) ** 0.7; // sale, tiene, scende
        if (r() > shape) continue;
        const at = Math.floor(t * (n - 1500));
        const c = biq(noise(900, r), 'bandpass', sr, 1200 + r() * 2800, 1.2);
        decay(c, sr, 0.004 + r() * 0.01, 0.0003);
        mixInto(x, c, at, 0.35 + r() * 0.65);
      }
      return x;
    };
    return [mk(), mk()];
  } },
  { id: 'heartbeat', group: 'Ambiente', label: 'Battito del cuore', make: (sr) => {
    const n = Math.round(4 * sr);
    const x = new Float32Array(n);
    const thump = (len, f0, g) => {
      const t = osc('sine', 0, len, sr, { fm: (s) => f0 + 40 * Math.exp(-s * 30) });
      return decay(t, sr, 0.07, 0.003).map((v) => v * g);
    };
    for (let k = 0; k < 4; k++) {
      mixInto(x, thump(Math.round(0.3 * sr), 55, 1), k * sr, 1);
      mixInto(x, thump(Math.round(0.3 * sr), 48, 1), k * sr + 0.28 * sr, 0.75);
    }
    return stereoOf(x);
  } },
  { id: 'tick', group: 'Ambiente', label: 'Orologio', make: (sr, r) => {
    const n = Math.round(4 * sr);
    const x = new Float32Array(n);
    for (let k = 0; k < 4; k++) {
      const t = biq(noise(Math.round(0.05 * sr), r), 'bandpass', sr, k % 2 ? 2300 : 2000, 4);
      decay(t, sr, 0.008, 0.0003);
      mixInto(x, t, k * sr, 1);
    }
    return stereoOf(x);
  } },
  { id: 'typing', group: 'Ambiente', label: 'Tastiera', make: (sr, r) => {
    const n = Math.round(3.2 * sr);
    const x = new Float32Array(n);
    let t = 0.1;
    while (t < 3) {
      const k = biq(noise(Math.round(0.04 * sr), r), 'bandpass', sr, 1500 + r() * 1800, 2);
      decay(k, sr, 0.006, 0.0002);
      mixInto(x, k, t * sr, 0.5 + r() * 0.5);
      t += 0.07 + r() * 0.16 + (r() < 0.12 ? 0.3 : 0);
    }
    return stereoOf(x);
  } },
  { id: 'shutter', group: 'Ambiente', label: 'Scatto fotografico', make: (sr, r) => {
    const n = Math.round(0.3 * sr);
    const x = new Float32Array(n);
    const a = biq(noise(Math.round(0.03 * sr), r), 'bandpass', sr, 2600, 1.5);
    decay(a, sr, 0.007, 0.0003);
    const b = biq(noise(Math.round(0.04 * sr), r), 'bandpass', sr, 1500, 1.5);
    decay(b, sr, 0.01, 0.0003);
    mixInto(x, a, 0, 1);
    mixInto(x, b, 0.09 * sr, 0.8);
    return stereoOf(x);
  } },
  { id: 'clap', group: 'Ambiente', label: 'Battito di mani', make: (sr, r) => {
    const n = Math.round(0.4 * sr);
    const x = new Float32Array(n);
    for (let k = 0; k < 4; k++) {
      const c = biq(noise(Math.round(0.15 * sr), r), 'bandpass', sr, 1500, 1.2);
      decay(c, sr, k < 3 ? 0.008 : 0.06, 0.0004);
      mixInto(x, c, k * 0.011 * sr, 1);
    }
    const L = x;
    const R = Float32Array.from(x);
    reverb(L, R, sr, { size: 0.3, wet: 0.25 });
    return [L, R];
  } },
];

/** Gruppi nell'ordine in cui si mostrano. */
export const SFX_GROUPS = [...new Set(SFX.map((s) => s.group))];

/**
 * Genera un effetto sonoro. `pitch` in semitoni (±12) cambia altezza e durata (come un disco più veloce/lento), `volume` 0..1.
 * @returns {{channels: Float32Array[], sampleRate: number, duration: number}}
 */
export function renderSfx(id, { seed = 1, sampleRate = SAMPLE_RATE, pitch = 0, volume = 0.9 } = {}) {
  const def = SFX.find((s) => s.id === id);
  if (!def) throw new Error(`Effetto sconosciuto: ${id}`);
  let chs = def.make(sampleRate, rng(seed * 7919 + def.id.length));
  if (pitch) {
    const step = 2 ** (clamp(pitch, -12, 12) / 12);
    chs = chs.map((c) => resampleLinear(c, step));
  }
  master(chs, sampleRate, { peak: clamp(volume, 0.05, 1) * 0.98, fadeIn: 0.0006, fadeOut: 0.01, drive: 1.0 });
  return { channels: chs, sampleRate, duration: chs[0].length / sampleRate };
}

function resampleLinear(x, step) {
  const n = Math.max(1, Math.floor((x.length - 1) / step));
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * step;
    const k = Math.floor(p);
    const t = p - k;
    y[i] = x[k] * (1 - t) + (x[k + 1] ?? x[k]) * t;
  }
  return y;
}

// ---- musica ----------------------------------------------------------------------------------------------------

export const KEYS = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

/** Pattern di batteria a 16 passi: x = colpo, o = colpo debole. */
const PATTERNS = {
  fourOnFloor: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', clap: '' },
  pop: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', clap: '' },
  chill: { kick: 'x.....x..x......', snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.', clap: '' },
  halfTime: { kick: 'x.........x.....', snare: '........x.......', hat: 'x.x.x.x.x.x.x.x.', clap: '' },
  epic: { kick: 'x...............', snare: '', hat: '', clap: '', tom: 'x.......x.x.x...' },
  none: { kick: '', snare: '', hat: '', clap: '' },
};

export const MUSIC_STYLES = {
  pop: { label: 'Pop allegra', bpm: [100, 124], mode: 'major', pattern: 'pop', progs: [[1, 5, 6, 4], [1, 6, 4, 5], [6, 4, 1, 5], [1, 4, 6, 5]], swing: 0, arp: 8, lead: true, duck: 0.45, wet: 0.12, cutoff: 3800, sevenths: false, enter: { pad: 0, bass: 0, drums: 0, arp: 4, lead: 8 } },
  chill: { label: 'Rilassata (lo-fi)', bpm: [70, 88], mode: 'minor', pattern: 'chill', progs: [[1, 6, 3, 7], [1, 4, 6, 5], [2, 5, 1, 6]], swing: 0.16, arp: 4, lead: true, duck: 0.15, wet: 0.22, cutoff: 2400, sevenths: true, enter: { pad: 0, bass: 0, drums: 2, arp: 4, lead: 8 } },
  corporate: { label: 'Aziendale (ispirazione)', bpm: [96, 116], mode: 'major', pattern: 'pop', progs: [[1, 5, 6, 4], [1, 4, 5, 4], [4, 1, 5, 6]], swing: 0, arp: 8, lead: true, duck: 0.3, wet: 0.18, cutoff: 3200, sevenths: false, enter: { pad: 0, bass: 2, drums: 4, arp: 0, lead: 8 } },
  epic: { label: 'Epica (cinema)', bpm: [78, 100], mode: 'minor', pattern: 'epic', progs: [[1, 6, 3, 7], [1, 7, 6, 7], [1, 4, 7, 3]], swing: 0, arp: 0, lead: true, duck: 0.2, wet: 0.35, cutoff: 3000, sevenths: false, enter: { pad: 0, bass: 0, drums: 2, arp: 8, lead: 4 } },
  electro: { label: 'Elettronica (dance)', bpm: [118, 130], mode: 'minor', pattern: 'fourOnFloor', progs: [[1, 6, 7, 1], [1, 7, 6, 7], [1, 1, 6, 7]], swing: 0, arp: 16, lead: true, duck: 0.6, wet: 0.1, cutoff: 4200, sevenths: false, enter: { pad: 0, bass: 0, drums: 0, arp: 4, lead: 8 } },
  ambient: { label: 'Atmosferica', bpm: [60, 78], mode: 'major', pattern: 'none', progs: [[1, 4, 6, 5], [1, 6, 2, 5], [6, 4, 1, 5]], swing: 0, arp: 2, lead: false, duck: 0, wet: 0.5, cutoff: 2200, sevenths: true, enter: { pad: 0, bass: 2, drums: 0, arp: 4, lead: 0 } },
  suspense: { label: 'Suspense', bpm: [66, 88], mode: 'minor', pattern: 'halfTime', progs: [[1, 1, 6, 5], [1, 2, 1, 7], [1, 6, 7, 1]], swing: 0, arp: 4, lead: false, duck: 0.2, wet: 0.3, cutoff: 1800, sevenths: false, enter: { pad: 0, bass: 0, drums: 4, arp: 2, lead: 0 } },
};

/** Triade (o accordo di settima) sul grado `degree` (1-7) della scala: scostamenti in semitoni dalla tonica. */
export function chordOffsets(mode, degree, seventh = false) {
  const sc = SCALES[mode];
  const idx = (k) => sc[((k % 7) + 7) % 7] + 12 * Math.floor(k / 7);
  const d = degree - 1;
  const out = [idx(d), idx(d + 2), idx(d + 4)];
  if (seventh) out.push(idx(d + 6));
  return out;
}

const steps = (s) => [...s].map((c, i) => (c === 'x' ? [i, 1] : c === 'o' ? [i, 0.5] : null)).filter(Boolean);

function kickVoice(sr) {
  const n = Math.round(0.4 * sr);
  const x = osc('sine', 0, n, sr, { fm: (s) => 46 + 130 * Math.exp(-s * 38) });
  decay(x, sr, 0.13, 0.001);
  return x;
}
function snareVoice(sr, r) {
  const n = Math.round(0.3 * sr);
  const nz = biq(noise(n, r), 'bandpass', sr, 2200, 0.9);
  decay(nz, sr, 0.07, 0.0005);
  const t = osc('sine', 0, n, sr, { fm: (s) => 185 + 60 * Math.exp(-s * 30) });
  decay(t, sr, 0.05, 0.0005);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = nz[i] * 0.9 + t[i] * 0.55;
  return x;
}
function hatVoice(sr, r, open) {
  const n = Math.round((open ? 0.3 : 0.08) * sr);
  const x = biq(noise(n, r), 'highpass', sr, 7000, 0.7);
  return decay(x, sr, open ? 0.1 : 0.017, 0.0003);
}
function clapVoice(sr, r) {
  const n = Math.round(0.3 * sr);
  const x = new Float32Array(n);
  for (let k = 0; k < 3; k++) {
    const c = biq(noise(n, r), 'bandpass', sr, 1500, 1.1);
    decay(c, sr, k < 2 ? 0.006 : 0.07, 0.0004);
    mixInto(x, c, k * 0.009 * sr, 0.7);
  }
  return x;
}
function tomVoice(sr, f0 = 110) {
  const n = Math.round(0.7 * sr);
  const x = osc('sine', 0, n, sr, { fm: (s) => f0 * 0.5 + f0 * 0.9 * Math.exp(-s * 12) });
  return decay(x, sr, 0.28, 0.002);
}

/**
 * Compone un brano e lo restituisce in stereo.
 * @param {{style?: keyof typeof MUSIC_STYLES, bpm?: number, key?: number, mode?: 'major'|'minor', seconds?: number, bars?: number,
 *          seed?: number, sampleRate?: number, progression?: number[], fadeOut?: number, volume?: number}} o
 * `key` = 0..11 (0 = Do). La durata è un numero intero di battute: `duration` dice quanto è lungo davvero.
 */
export function generateMusic(o = {}) {
  const style = MUSIC_STYLES[o.style ?? 'pop'];
  if (!style) throw new Error(`Stile sconosciuto: ${o.style}`);
  const sr = o.sampleRate ?? SAMPLE_RATE;
  const r = rng((o.seed ?? 1) * 104729 + 17);
  const bpm = clamp(Math.round(o.bpm ?? style.bpm[0] + r() * (style.bpm[1] - style.bpm[0])), 50, 200);
  const mode = o.mode ?? style.mode;
  const key = ((o.key ?? Math.floor(r() * 12)) % 12 + 12) % 12;
  const beat = 60 / bpm;
  const bar = beat * 4;
  const bars = clamp(o.bars ?? Math.max(1, Math.round((o.seconds ?? 30) / bar)), 1, 400);
  const step = beat / 4; // sedicesimo
  const n = Math.round(bars * bar * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rev = [new Float32Array(n), new Float32Array(n)]; // mandata al riverbero
  const prog = o.progression ?? style.progs[Math.floor(r() * style.progs.length)];
  const scale = SCALES[mode];
  const tonic = 36 + key; // Do2 + tonalità
  const short = bars <= 4;
  const enter = (layer) => (short ? 0 : style.enter[layer] ?? 0);
  const on = (layer, b) => b >= enter(layer);
  const kicks = []; // istanti dei colpi di cassa (per il «sidechain»)

  const chordFor = (b) => prog[b % prog.length];
  const swingAt = (i) => (i % 2 ? style.swing * step : 0);

  // pad (accordo lungo, due voci leggermente scordate a sinistra e a destra)
  for (let b = 0; b < bars; b++) {
    if (!on('pad', b)) continue;
    const offs = chordOffsets(mode, chordFor(b), style.sevenths);
    const dur = bar * 1.0;
    const len = Math.round((dur + 0.7) * sr);
    for (const [side, det] of [[-1, -7], [1, 7]]) {
      const mix = new Float32Array(len);
      offs.forEach((off, vi) => {
        const f = hz(tonic + 24 + off - (vi === 0 ? 0 : 0));
        const o1 = osc('saw', f, len, sr, { detune: det, phase: r() });
        const o2 = osc('tri', f, len, sr, { detune: -det, phase: r() });
        for (let i = 0; i < len; i++) mix[i] += o1[i] * 0.5 + o2[i] * 0.5;
      });
      const lp = sweep(mix, sr, style.cutoff * 0.35, style.cutoff * 0.55, 0.8, 'lp');
      adsr(lp, sr, 0.35, 0.4, 0.85, dur, 0.7);
      mixStereo(L, R, lp, b * bar * sr, 0.11, side * 0.7);
      mixInto(rev[0], lp, b * bar * sr, 0.09);
      mixInto(rev[1], lp, b * bar * sr, 0.09);
    }
  }

  // basso: fondamentale sulla battuta, con una ripresa a seconda dello stile
  const bassPat = style.pattern === 'fourOnFloor' ? 'x.x.x.x.x.x.x.x.' : style.pattern === 'epic' ? 'x...............' : style.pattern === 'halfTime' ? 'x.......x.......' : 'x.....x...x.....';
  for (let b = 0; b < bars; b++) {
    if (!on('bass', b)) continue;
    const root = tonic + chordOffsets(mode, chordFor(b))[0] + 12;
    for (const [i] of steps(bassPat)) {
      const t = b * bar + i * step + swingAt(i);
      const nlen = Math.round(step * (style.pattern === 'fourOnFloor' ? 1.6 : 3.2) * sr);
      const f = hz(root - (i === 6 ? 0 : 0));
      const a = osc('sine', f, nlen, sr);
      const c = osc('saw', f, nlen, sr);
      const x = new Float32Array(nlen);
      for (let k = 0; k < nlen; k++) x[k] = a[k] * 0.85 + c[k] * 0.25;
      const lp = biq(x, 'lowpass', sr, 520, 0.7);
      adsr(lp, sr, 0.004, 0.08, 0.7, nlen / sr - 0.05, 0.05);
      mixStereo(L, R, lp, t * sr, 0.34, 0);
    }
  }

  // batteria
  const pat = PATTERNS[style.pattern];
  const kickV = kickVoice(sr);
  const snareV = snareVoice(sr, r);
  const hatC = hatVoice(sr, r, false);
  const hatO = hatVoice(sr, r, true);
  const clapV = clapVoice(sr, r);
  for (let b = 0; b < bars; b++) {
    if (!on('drums', b)) continue;
    const lastOfPhrase = (b + 1) % 4 === 0 && b < bars - 1;
    for (const [i, g] of steps(pat.kick)) {
      const t = b * bar + i * step + swingAt(i);
      mixStereo(L, R, kickV, t * sr, 0.62 * (0.7 + 0.3 * g), 0);
      kicks.push(t);
    }
    for (const [i, g] of steps(pat.snare)) {
      if (lastOfPhrase && i >= 12) continue; // il fill sostituisce l'ultimo colpo
      mixStereo(L, R, snareV, (b * bar + i * step + swingAt(i)) * sr, 0.34 * (0.7 + 0.3 * g), 0.05);
    }
    for (const [i, g] of steps(pat.hat)) mixStereo(L, R, g > 0.7 ? hatC : hatO, (b * bar + i * step + swingAt(i)) * sr, 0.1 * (0.6 + 0.4 * g) * (0.85 + 0.3 * r()), 0.25);
    for (const [i] of steps(pat.clap ?? '')) mixStereo(L, R, clapV, (b * bar + i * step) * sr, 0.25, -0.1);
    for (const [i] of steps(pat.tom ?? '')) mixStereo(L, R, tomVoice(sr, i > 8 ? 130 : 90), (b * bar + i * step) * sr, 0.45, i > 8 ? 0.3 : -0.3);
    if (lastOfPhrase && pat.snare) {
      // fill: quattro sedicesimi di rullante in crescendo sull'ultimo movimento
      for (let k = 0; k < 4; k++) mixStereo(L, R, snareV, (b * bar + (12 + k) * step) * sr, 0.18 + 0.07 * k, 0.05);
    }
    if (b % 4 === 0 && style.pattern === 'epic') {
      const crash = biq(noise(Math.round(2 * sr), r), 'highpass', sr, 5000, 0.7);
      decay(crash, sr, 0.8, 0.002);
      mixStereo(L, R, crash, b * bar * sr, 0.1, 0);
    }
  }

  // arpeggio
  if (style.arp) {
    const per = style.arp; // note per battuta
    const gap = bar / per;
    for (let b = 0; b < bars; b++) {
      if (!on('arp', b)) continue;
      const offs = chordOffsets(mode, chordFor(b), style.sevenths).map((v) => v + 12);
      const all = [...offs, offs[0] + 12, offs[1] + 12];
      for (let k = 0; k < per; k++) {
        const upDown = [0, 1, 2, 3, 4, 3, 2, 1];
        const note = all[upDown[k % upDown.length] % all.length];
        const len = Math.round(Math.min(0.6, gap * 2.4) * sr);
        const f = hz(tonic + 24 + note);
        const x = osc(style.arp >= 16 ? 'square' : 'tri', f, len, sr, { phase: r() });
        const lp = biq(x, 'lowpass', sr, style.cutoff, 0.7);
        decay(lp, sr, gap * 1.6, 0.002);
        const t = b * bar + k * gap + (k % 2 ? style.swing * step : 0);
        mixStereo(L, R, lp, t * sr, 0.13, k % 2 ? 0.45 : -0.45);
        mixInto(rev[0], lp, t * sr, 0.08);
        mixInto(rev[1], lp, t * sr, 0.08);
      }
    }
  }

  // melodia
  if (style.lead) {
    const rhythms = [[0, 4, 6, 8, 12], [0, 3, 6, 10, 12, 14], [0, 2, 4, 8, 10, 12], [0, 6, 8, 14], [0, 4, 8, 12]];
    let idx = 4 + Math.floor(r() * 3); // gradino della scala (parte da una nota dell'accordo)
    const lo = -2;
    const hi = 11;
    let motif = null;
    for (let b = 0; b < bars; b++) {
      if (!on('lead', b)) continue;
      const offs = chordOffsets(mode, chordFor(b));
      const phrasePos = b % 4;
      // la frase di 4 battute: le prime 2 ripetono lo stesso disegno, poi cambia e la quarta chiude sulla tonica
      const rhythm = phrasePos < 2 && motif ? motif : rhythms[Math.floor(r() * rhythms.length)];
      if (phrasePos === 0) motif = rhythm;
      rhythm.forEach((s, k) => {
        const strong = s % 8 === 0;
        const chordIdx = [];
        for (let j = lo; j <= hi; j++) {
          const deg = ((j % 7) + 7) % 7;
          const semi = scale[deg] + 12 * Math.floor(j / 7);
          if (offs.some((o) => (((semi - o) % 12) + 12) % 12 === 0)) chordIdx.push(j);
        }
        if (strong) {
          // la nota d'accordo più vicina a dove siamo
          idx = chordIdx.reduce((best, j) => (Math.abs(j - idx) < Math.abs(best - idx) ? j : best), chordIdx[0]);
        } else {
          idx = clamp(idx + (r() < 0.5 ? -1 : 1) * (r() < 0.75 ? 1 : 2), lo, hi);
        }
        if (phrasePos === 3 && k === rhythm.length - 1) idx = 7; // chiude sulla tonica dell'ottava alta
        const semi = scale[((idx % 7) + 7) % 7] + 12 * Math.floor(idx / 7);
        const next = rhythm[k + 1] ?? 16;
        const dur = Math.max(1, next - s) * step * 0.95;
        const len = Math.round((dur + 0.35) * sr);
        const f = hz(tonic + 24 + semi);
        const vib = osc('sine', 5.2, len, sr);
        const x = osc('tri', 0, len, sr, { fm: (t) => f * (1 + 0.004 * vib[Math.min(len - 1, Math.floor(t * sr))] * Math.min(1, t * 3)) });
        const sq = osc('square', f, len, sr);
        for (let i = 0; i < len; i++) x[i] = x[i] * 0.8 + sq[i] * 0.2;
        const lp = biq(x, 'lowpass', sr, style.cutoff, 0.7);
        adsr(lp, sr, 0.012, 0.1, 0.65, dur, 0.3);
        const t = b * bar + s * step + swingAt(s);
        mixStereo(L, R, lp, t * sr, 0.17, 0.12);
        mixInto(rev[0], lp, t * sr, 0.2);
        mixInto(rev[1], lp, t * sr, 0.2);
      });
    }
  }

  // riverbero: le mandate di pad, arpeggio e melodia diventano code, con livello pari a `wet` volte il segnale secco
  if (style.wet > 0) {
    const [wl, wr] = reverbTails(rev[0], rev[1], sr, { size: 0.6, damp: 0.5 });
    const g = (style.wet * (rms(L) + rms(R))) / Math.max(1e-9, rms(wl) + rms(wr));
    for (let i = 0; i < n; i++) {
      L[i] += wl[i] * g;
      R[i] += wr[i] * g;
    }
  }

  // ducking: i colpi di cassa abbassano pad e basso (si applica al mix finale a bande lente, solo se previsto)
  if (style.duck > 0 && kicks.length) {
    const g = new Float32Array(n).fill(1);
    for (const kt of kicks) {
      const a = Math.round(kt * sr);
      const len = Math.round(0.28 * sr);
      for (let i = 0; i < len && a + i < n; i++) g[a + i] = Math.min(g[a + i], 1 - style.duck * Math.exp(-i / (0.09 * sr)));
    }
    // il ducking si applica alla sola parte tonale: qui si usa su tutto, tranne i transienti brevi, con profondità moderata
    for (let i = 0; i < n; i++) {
      const k = 1 - (1 - g[i]) * 0.6;
      L[i] *= k;
      R[i] *= k;
    }
  }

  const fade = o.fadeOut ?? 1.2;
  master([L, R], sr, { peak: clamp(o.volume ?? 0.9, 0.05, 1) * 0.98, fadeIn: 0.01, fadeOut: Math.min(fade, bars * bar * 0.5), drive: 1.15 });
  return { channels: [L, R], sampleRate: sr, duration: n / sr, bpm, key, mode, bars, progression: prog };
}
