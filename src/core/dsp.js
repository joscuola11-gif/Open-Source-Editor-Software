// Elaborazione del segnale (puro, senza DOM): FFT, finestre, filtri biquad e ricampionamento.

export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] /= n;
  }
}

export const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;

/** Finestra di Hann (periodica). */
export function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Frequenza dominante (Hz) di un segnale: serve alle prove. */
export function dominantFrequency(x, sr, from = 0, size = 8192) {
  let n = 1;
  while (n < size && from + n * 2 <= x.length) n *= 2;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const w = hann(n);
  for (let i = 0; i < n; i++) re[i] = (x[from + i] ?? 0) * w[i];
  fft(re, im);
  let best = 1;
  let bm = 0;
  for (let k = 1; k < n / 2; k++) {
    const m = re[k] * re[k] + im[k] * im[k];
    if (m > bm) {
      bm = m;
      best = k;
    }
  }
  return (best * sr) / n;
}

// ---- filtri biquad (formule «Audio EQ Cookbook») ---------------------------------------------------

export function biquad(type, sr, freq, q = Math.SQRT1_2, gainDb = 0) {
  const w0 = (2 * Math.PI * Math.min(freq, sr * 0.49)) / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  const A = 10 ** (gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lowpass':
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'bandpass':
      b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'peaking':
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
      break;
    default:
      throw new Error(`filtro sconosciuto: ${type}`);
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Applica il filtro a un segnale (nuovo array). */
export function filter(x, c) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    y[i] = v;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
  }
  return y;
}

/** Ricampiona con interpolazione cubica: `step` > 1 accorcia e alza l'altezza. */
export function resample(x, step) {
  const n = Math.max(1, Math.floor((x.length - 1) / step));
  const y = new Float32Array(n);
  const at = (i) => x[Math.min(x.length - 1, Math.max(0, i))];
  for (let i = 0; i < n; i++) {
    const p = i * step;
    const k = Math.floor(p);
    const t = p - k;
    const p0 = at(k - 1);
    const p1 = at(k);
    const p2 = at(k + 1);
    const p3 = at(k + 2);
    y[i] = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  }
  return y;
}
