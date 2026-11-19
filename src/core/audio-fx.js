// Effetti audio «offline» (puri): riduzione del rumore, altezza del suono, voci speciali, normalizzazione,
// rimozione/isolamento della voce. Lavorano su canali Float32Array (-1..1) e restituiscono canali nuovi.

import { biquad, fft, filter, hann, resample } from './dsp.js';
import { clamp } from './util.js';

const N_FFT = 1024;
const HOP = 256;

const dbToGain = (db) => 10 ** (db / 20);
const toDb = (v) => 20 * Math.log10(Math.max(v, 1e-9));

// ---------------------------------------------------------------------------------------------------
// Livelli
// ---------------------------------------------------------------------------------------------------

/** Livello medio (RMS, solo dove c'è suono: i silenzi non abbassano la media) e picco, in dBFS. */
export function loudness(channels, sr) {
  const win = Math.max(1, Math.round(sr * 0.05));
  const len = channels[0]?.length ?? 0;
  let peak = 0;
  const blocks = [];
  for (let s = 0; s + win <= len; s += win) {
    let sum = 0;
    for (const ch of channels) for (let i = s; i < s + win; i++) {
      const v = ch[i];
      sum += v * v;
      if (Math.abs(v) > peak) peak = Math.abs(v);
    }
    blocks.push(sum / (win * channels.length));
  }
  if (!blocks.length) return { rmsDb: -120, peakDb: -120 };
  const meanAll = blocks.reduce((a, b) => a + b, 0) / blocks.length;
  const gate = meanAll * 0.1; // -10 dB sotto la media: scarta le pause
  const kept = blocks.filter((b) => b >= gate);
  const mean = kept.reduce((a, b) => a + b, 0) / Math.max(1, kept.length);
  return { rmsDb: toDb(Math.sqrt(mean)), peakDb: toDb(peak) };
}

/** Guadagno (lineare) per portare l'audio a `targetDb` senza superare `ceilDb` di picco. */
export function normalizeGain(channels, sr, { targetDb = -16, ceilDb = -1 } = {}) {
  const { rmsDb, peakDb } = loudness(channels, sr);
  if (rmsDb < -90) return 1;
  const wanted = targetDb - rmsDb;
  const maxByPeak = ceilDb - peakDb;
  return dbToGain(Math.min(wanted, maxByPeak));
}

export function applyGain(channels, gain) {
  return channels.map((ch) => {
    const o = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) o[i] = ch[i] * gain;
    return o;
  });
}

// ---------------------------------------------------------------------------------------------------
// Riduzione del rumore (sottrazione spettrale con profilo del rumore preso dai tratti più silenziosi)
// ---------------------------------------------------------------------------------------------------

function stftFrames(x, n, hop, win) {
  const frames = [];
  const total = Math.max(0, Math.ceil((x.length + n) / hop));
  for (let f = 0; f < total; f++) {
    const start = f * hop - (n - hop);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const v = x[start + i] ?? 0;
      re[i] = v * win[i];
    }
    fft(re, im);
    frames.push({ re, im, start });
  }
  return frames;
}

export function noiseReduceChannel(x, { amount = 0.7 } = {}) {
  if (x.length < N_FFT * 2) return Float32Array.from(x);
  const win = hann(N_FFT).map(Math.sqrt);
  const frames = stftFrames(x, N_FFT, HOP, win);
  const bins = N_FFT / 2 + 1;
  // energia per fotogramma → profilo del rumore dal 15% più silenzioso
  const energy = frames.map((f) => {
    let e = 0;
    for (let k = 1; k < bins; k++) e += f.re[k] * f.re[k] + f.im[k] * f.im[k];
    return e;
  });
  const order = [...energy.keys()].sort((a, b) => energy[a] - energy[b]);
  const take = Math.max(3, Math.floor(order.length * 0.15));
  const noise = new Float64Array(bins);
  for (let i = 0; i < take; i++) {
    const f = frames[order[i]];
    for (let k = 0; k < bins; k++) noise[k] += Math.hypot(f.re[k], f.im[k]) / take;
  }
  const alpha = 1.2 + 2.4 * amount;
  const floorGain = 0.04 + 0.2 * (1 - amount);
  const out = new Float32Array(x.length);
  const norm = new Float32Array(x.length);
  const prevGain = new Float64Array(bins).fill(1);
  const gains = new Float64Array(bins);
  for (const f of frames) {
    for (let k = 0; k < bins; k++) {
      const m = Math.hypot(f.re[k], f.im[k]);
      gains[k] = m > 1e-12 ? Math.max(floorGain, 1 - (alpha * noise[k]) / m) : floorGain;
    }
    // un po' di levigatura in frequenza e nel tempo: meno «rumore musicale»
    for (let k = 0; k < bins; k++) {
      const a = gains[Math.max(0, k - 1)];
      const c = gains[Math.min(bins - 1, k + 1)];
      const g = (a + 2 * gains[k] + c) / 4;
      const sm = g < prevGain[k] ? 0.5 * prevGain[k] + 0.5 * g : 0.15 * prevGain[k] + 0.85 * g;
      prevGain[k] = sm;
    }
    const re = new Float64Array(N_FFT);
    const im = new Float64Array(N_FFT);
    for (let k = 0; k < bins; k++) {
      re[k] = f.re[k] * prevGain[k];
      im[k] = f.im[k] * prevGain[k];
      if (k > 0 && k < N_FFT / 2) {
        re[N_FFT - k] = re[k];
        im[N_FFT - k] = -im[k];
      }
    }
    fft(re, im, true);
    for (let i = 0; i < N_FFT; i++) {
      const p = f.start + i;
      if (p < 0 || p >= x.length) continue;
      out[p] += re[i] * win[i];
      norm[p] += win[i] * win[i];
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0;
  return out;
}

export const noiseReduce = (channels, opts) => channels.map((c) => noiseReduceChannel(c, opts));

// ---------------------------------------------------------------------------------------------------
// Altezza del suono (vocoder di fase + ricampionamento): cambia l'intonazione senza cambiare la durata
// ---------------------------------------------------------------------------------------------------

/** Allunga il segnale di `factor` volte senza cambiarne l'altezza. */
export function timeStretch(x, factor) {
  const n = 2048;
  const hs = n / 4;
  const ha = hs / factor;
  const win = hann(n);
  const frames = Math.max(1, Math.floor((x.length - n) / ha) + 1);
  const outLen = Math.ceil(frames * hs + n);
  const out = new Float32Array(outLen);
  const wsum = new Float32Array(outLen);
  const phase = new Float64Array(n / 2 + 1);
  const synth = new Float64Array(n / 2 + 1);
  let prevStart = 0;
  for (let f = 0; f < frames; f++) {
    const start = Math.round(f * ha);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = (x[start + i] ?? 0) * win[i];
    fft(re, im);
    const hop = f === 0 ? ha : Math.max(1, start - prevStart);
    for (let k = 0; k <= n / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const ph = Math.atan2(im[k], re[k]);
      if (f === 0) synth[k] = ph;
      else {
        const omega = (2 * Math.PI * k) / n;
        let d = ph - phase[k] - omega * hop;
        d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
        synth[k] += (omega + d / hop) * hs;
      }
      phase[k] = ph;
      re[k] = mag * Math.cos(synth[k]);
      im[k] = mag * Math.sin(synth[k]);
      if (k > 0 && k < n / 2) {
        re[n - k] = re[k];
        im[n - k] = -im[k];
      }
    }
    fft(re, im, true);
    const o = f * hs;
    for (let i = 0; i < n; i++) {
      out[o + i] += re[i] * win[i];
      wsum[o + i] += win[i] * win[i];
    }
    prevStart = start;
  }
  for (let i = 0; i < outLen; i++) if (wsum[i] > 1e-3) out[i] /= wsum[i];
  return out;
}

/** Cambia l'altezza di `semitones` (+12 = un'ottava sopra) mantenendo la durata. */
export function pitchShiftChannel(x, semitones) {
  if (!semitones || x.length < 4096) return Float32Array.from(x);
  const ratio = 2 ** (semitones / 12);
  const stretched = timeStretch(x, ratio);
  const y = resample(stretched, ratio);
  const out = new Float32Array(x.length);
  out.set(y.subarray(0, Math.min(y.length, out.length)));
  return out;
}
export const pitchShift = (channels, semitones) => channels.map((c) => pitchShiftChannel(c, semitones));

// ---------------------------------------------------------------------------------------------------
// Voci e filtri
// ---------------------------------------------------------------------------------------------------

const softClip = (v) => Math.tanh(v);

export const VOICE_EFFECTS = {
  deep: { label: 'Voce grave', hint: 'Abbassa il tono di 5 semitoni' },
  high: { label: 'Voce acuta', hint: 'Alza il tono di 5 semitoni' },
  chipmunk: { label: 'Scoiattolo', hint: 'Voce molto acuta (+9 semitoni)' },
  monster: { label: 'Mostro', hint: 'Molto grave (-9 semitoni) con un po\' di ruvidità' },
  robot: { label: 'Robot', hint: 'Voce metallica' },
  telephone: { label: 'Telefono', hint: 'Suono da vecchio telefono' },
  megaphone: { label: 'Megafono', hint: 'Suono da megafono' },
  echo: { label: 'Eco', hint: 'Ripetizioni che si spengono' },
  cave: { label: 'Caverna', hint: 'Riverbero lungo' },
  enhance: { label: 'Voce più chiara', hint: 'Toglie i fruscii, taglia i rimbombi e dà presenza' },
};

export function applyVoiceEffect(channels, sr, id) {
  const per = (fn) => channels.map((c) => fn(c));
  switch (id) {
    case 'deep': return pitchShift(channels, -5);
    case 'high': return pitchShift(channels, 5);
    case 'chipmunk': return pitchShift(channels, 9);
    case 'monster': return per((c) => Float32Array.from(pitchShiftChannel(c, -9), softClip).map((v) => v * 0.9)).map((c) => filter(c, biquad('lowpass', sr, 4500)));
    case 'robot':
      return per((c) => {
        const out = new Float32Array(c.length);
        const d = Math.max(1, Math.round(sr * 0.007));
        for (let i = 0; i < c.length; i++) {
          const ring = c[i] * Math.sin((2 * Math.PI * 65 * i) / sr);
          const comb = i >= d ? out[i - d] * 0.45 : 0;
          out[i] = 0.35 * c[i] + 0.8 * ring + comb;
        }
        return out;
      });
    case 'telephone': return per((c) => Float32Array.from(filter(filter(c, biquad('highpass', sr, 400, 0.9)), biquad('lowpass', sr, 3300, 0.9)), (v) => softClip(v * 1.6) * 0.8));
    case 'megaphone': return per((c) => Float32Array.from(filter(filter(c, biquad('highpass', sr, 600, 1)), biquad('lowpass', sr, 4200, 1)), (v) => softClip(v * 3) * 0.7));
    case 'echo': return per((c) => feedbackDelay(c, Math.round(sr * 0.3), 0.45, 0.55));
    case 'cave': return per((c) => feedbackDelay(feedbackDelay(c, Math.round(sr * 0.047), 0.5, 0.5), Math.round(sr * 0.113), 0.55, 0.45));
    case 'enhance': {
      const cleaned = noiseReduce(channels, { amount: 0.5 });
      return cleaned.map((c) => filter(filter(c, biquad('highpass', sr, 90, 0.8)), biquad('peaking', sr, 3200, 0.9, 3.5)));
    }
    default: throw new Error(`Effetto sconosciuto: ${id}`);
  }
}

function feedbackDelay(x, d, feedback, mix) {
  const tail = Math.round(d * 6);
  const y = new Float32Array(x.length + tail);
  for (let i = 0; i < y.length; i++) {
    const dry = i < x.length ? x[i] : 0;
    const wet = i >= d ? y[i - d] * feedback : 0;
    y[i] = dry + wet * 1;
  }
  const out = new Float32Array(y.length);
  for (let i = 0; i < y.length; i++) out[i] = (i < x.length ? x[i] : 0) * (1 - mix * 0.5) + (y[i] - (i < x.length ? x[i] : 0)) * mix;
  return out.subarray(0, x.length + tail);
}

// ---------------------------------------------------------------------------------------------------
// Voce in un brano stereo: togliere (karaoke) o isolare (approssimato: sfrutta il canale centrale)
// ---------------------------------------------------------------------------------------------------

export function removeVoice(channels) {
  if (channels.length < 2) throw new Error('Per togliere la voce serve un brano stereo.');
  const [l, r] = channels;
  const out = new Float32Array(l.length);
  for (let i = 0; i < out.length; i++) out[i] = (l[i] - r[i]) * 0.5;
  return [out, Float32Array.from(out)];
}

export function isolateVoice(channels, sr) {
  const [l, r = channels[0]] = channels;
  const mid = new Float32Array(l.length);
  for (let i = 0; i < mid.length; i++) mid[i] = (l[i] + r[i]) * 0.5;
  const band = filter(filter(mid, biquad('highpass', sr, 150, 0.8)), biquad('lowpass', sr, 5500, 0.8));
  return [band, Float32Array.from(band)];
}

/** Mescola i canali in uno solo (per l'analisi). */
export function mono(channels) {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const c of channels) for (let i = 0; i < out.length; i++) out[i] += c[i] / channels.length;
  return out;
}

export { clamp };
