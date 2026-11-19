// Rilevamento del ritmo: battiti al minuto e istanti dei battiti, dall'inviluppo delle «novità» del suono (flusso spettrale).
// Puro. Serve a mettere marcatori sui battiti e a dividere i clip a tempo di musica.

import { fft, hann } from './dsp.js';
import { mono } from './audio-fx.js';

const N = 1024;
const HOP = 512;

/** Quanto cambia lo spettro da un fotogramma al successivo (picchi = attacchi di batteria, note, sillabe forti). */
export function onsetEnvelope(x, sr) {
  const win = hann(N);
  const frames = Math.max(0, Math.floor((x.length - N) / HOP) + 1);
  const bins = Math.min(N / 2, Math.floor((6000 * N) / sr));
  const env = new Float32Array(frames);
  let prev = new Float64Array(bins);
  for (let f = 0; f < frames; f++) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[f * HOP + i] * win[i];
    fft(re, im);
    let flux = 0;
    const cur = new Float64Array(bins);
    for (let k = 1; k < bins; k++) {
      cur[k] = Math.log1p(50 * Math.hypot(re[k], im[k]) / N);
      const d = cur[k] - prev[k];
      if (d > 0) flux += d;
    }
    env[f] = flux;
    prev = cur;
  }
  // toglie la media mobile: restano solo i picchi
  const out = new Float32Array(frames);
  const w = 16;
  for (let i = 0; i < frames; i++) {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(frames - 1, i + w); j++) {
      s += env[j];
      c++;
    }
    out[i] = Math.max(0, env[i] - s / c);
  }
  return out;
}

/**
 * @returns {{bpm: number|null, beats: number[], confidence: number}} battiti (secondi) lungo tutto il brano
 */
export function detectBeats(channels, sr, { minBpm = 60, maxBpm = 190 } = {}) {
  const x = mono(channels);
  const raw = onsetEnvelope(x, sr);
  // leggera levigatura: i battiti non cadono su fotogrammi interi, senza questo il tempo dimezzato sembrerebbe «più preciso»
  const env = new Float32Array(raw.length);
  const kern = [1, 2, 3, 2, 1];
  for (let i = 0; i < raw.length; i++) {
    let v = 0;
    for (let k = -2; k <= 2; k++) v += (raw[i + k] ?? 0) * kern[k + 2];
    env[i] = v / 9;
  }
  const fps = sr / HOP;
  if (env.length < fps * 2) return { bpm: null, beats: [], confidence: 0 };
  const energy = env.reduce((a, b) => a + b, 0);
  if (energy < 1e-3) return { bpm: null, beats: [], confidence: 0 };

  // tempo: autocorrelazione dell'inviluppo
  const loLag = Math.floor((fps * 60) / maxBpm);
  const hiLag = Math.ceil((fps * 60) / minBpm);
  let best = -1;
  let bestScore = 0;
  let mean = 0;
  const scores = [];
  for (let lag = loLag; lag <= hiLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < env.length; i++) s += env[i] * env[i + lag];
    s /= env.length - lag;
    // leggera preferenza per i tempi comuni (≈120) per non scambiare un battito con il doppio o la metà
    const bpm = (fps * 60) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const weighted = s * (0.6 + 0.4 * prior);
    scores.push(weighted);
    mean += weighted;
    if (weighted > bestScore) {
      bestScore = weighted;
      best = lag;
    }
  }
  mean /= Math.max(1, scores.length);
  if (best < 0 || bestScore < mean * 1.6) return { bpm: null, beats: [], confidence: 0 };
  // errore tipico: scambiare un battito con la metà del tempo. Se a metà lag c'è quasi la stessa forza, è quello giusto
  for (let guard = 0; guard < 2; guard++) {
    const half = Math.round(best / 2);
    if (half >= loLag && scores[half - loLag] >= bestScore * 0.7) best = half;
    else break;
  }
  // affina il lag con interpolazione parabolica
  const i = best - loLag;
  let lag = best;
  if (i > 0 && i < scores.length - 1) {
    const a = scores[i - 1];
    const b = scores[i];
    const c = scores[i + 1];
    const den = a - 2 * b + c;
    if (Math.abs(den) > 1e-12) lag += (0.5 * (a - c)) / den;
  }
  const period = lag; // in fotogrammi
  // fase: dove far cadere i battiti
  let bestPhase = 0;
  let phaseScore = -1;
  for (let ph = 0; ph < period; ph += 0.5) {
    let s = 0;
    for (let t = ph; t < env.length; t += period) s += env[Math.round(t)] ?? 0;
    if (s > phaseScore) {
      phaseScore = s;
      bestPhase = ph;
    }
  }
  const beats = [];
  for (let t = bestPhase; t < env.length; t += period) {
    // si aggancia al massimo vicino (±15% del periodo): i battiti reali non sono su una griglia perfetta
    const r = Math.max(1, Math.round(period * 0.15));
    let bi = Math.round(t);
    let bv = env[bi] ?? 0;
    for (let j = Math.max(0, Math.round(t) - r); j <= Math.min(env.length - 1, Math.round(t) + r); j++) if (env[j] > bv) {
      bv = env[j];
      bi = j;
    }
    beats.push((bi * HOP + N / 2) / sr);
  }
  return { bpm: (fps * 60) / period, beats, confidence: Math.min(1, bestScore / (mean * 6)) };
}
