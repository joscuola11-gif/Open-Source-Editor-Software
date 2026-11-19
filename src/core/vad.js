// Rilevamento del parlato (VAD): trova dove si parla e dove c'è silenzio o solo rumore di fondo.
// Si usa per mandare al riconoscimento vocale solo le parti con voce, per correggere i tempi delle parole
// e per far iniziare e finire i sottotitoli esattamente quando si parla. Puro, nessun modello.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Energia in dB di ogni finestra (dopo un filtro che toglie i rumori molto gravi). */
export function frameEnergies(x, sr, { frame = 0.025, hop = 0.01 } = {}) {
  const N = Math.max(8, Math.round(frame * sr));
  const H = Math.max(1, Math.round(hop * sr));
  const n = Math.max(0, Math.floor((x.length - N) / H) + 1);
  const out = new Float32Array(n);
  // passa-alto del primo ordine (~90 Hz): toglie ronzii e colpi sul microfono
  const a = Math.exp((-2 * Math.PI * 90) / sr);
  let px = 0;
  let py = 0;
  const hp = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const y = a * (py + x[i] - px);
    px = x[i];
    py = y;
    hp[i] = y;
  }
  for (let f = 0; f < n; f++) {
    let s = 0;
    const o = f * H;
    for (let i = 0; i < N; i++) s += hp[o + i] * hp[o + i];
    out[f] = 10 * Math.log10(s / N + 1e-12);
  }
  return out;
}

const percentile = (arr, p) => {
  const s = Float32Array.from(arr).sort();
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : -100;
};

const median5 = (a) => {
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const w = [a[Math.max(0, i - 2)], a[Math.max(0, i - 1)], a[i], a[Math.min(a.length - 1, i + 1)], a[Math.min(a.length - 1, i + 2)]].sort((p, q) => p - q);
    o[i] = w[2];
  }
  return o;
};

/**
 * @param {Float32Array} x audio mono
 * @param {number} sr
 * @param {{minSpeech?: number, minSilence?: number, padStart?: number, padEnd?: number, sensitivity?: number}} o
 *   sensitivity 0..1 (più alto = considera parlato anche i suoni deboli)
 * @returns {{segments: Array<{start: number, end: number}>, energies: Float32Array, hop: number, floorDb: number, speechDb: number}}
 */
export function detectSpeech(x, sr, { minSpeech = 0.18, minSilence = 0.3, padStart = 0.06, padEnd = 0.1, sensitivity = 0.5 } = {}) {
  const hop = 0.01;
  const raw = frameEnergies(x, sr, { hop });
  const e = median5(raw);
  const floor = percentile(e, 0.1);
  const loud = percentile(e, 0.95);
  const span = Math.max(0, loud - floor);
  const empty = { segments: [], energies: e, hop, floorDb: floor, speechDb: loud };
  // quasi silenzio assoluto o nessuna differenza fra rumore e voce: niente parlato
  if (!e.length || span < 9) return empty;
  const k = clamp(sensitivity, 0, 1);
  const hi = floor + Math.max(8, span * (0.42 - 0.2 * k));
  const lo = floor + Math.max(5, span * (0.26 - 0.12 * k));
  const frames = [];
  let on = false;
  let start = 0;
  for (let i = 0; i < e.length; i++) {
    if (!on && e[i] >= hi) {
      on = true;
      start = i;
    } else if (on && e[i] < lo) {
      on = false;
      frames.push([start, i]);
    }
  }
  if (on) frames.push([start, e.length]);
  // unisce i pezzi separati da pause brevi (respiri, consonanti) e toglie quelli troppo brevi
  const merged = [];
  for (const [s, f] of frames) {
    const last = merged[merged.length - 1];
    if (last && (s - last[1]) * hop < minSilence) last[1] = f;
    else merged.push([s, f]);
  }
  const dur = x.length / sr;
  const segments = merged
    .filter(([s, f]) => (f - s) * hop >= minSpeech)
    .map(([s, f]) => ({ start: clamp(s * hop - padStart, 0, dur), end: clamp(f * hop + padEnd, 0, dur) }));
  // dopo il margine due segmenti possono toccarsi: si uniscono
  const out = [];
  for (const sg of segments) {
    const last = out[out.length - 1];
    if (last && sg.start <= last.end + 0.02) last.end = Math.max(last.end, sg.end);
    else out.push({ ...sg });
  }
  return { segments: out, energies: e, hop, floorDb: floor, speechDb: loud };
}

/** Raggruppa i segmenti di parlato in blocchi lunghi al massimo `maxLen` secondi, spezzando solo nelle pause. */
export function chunkSegments(segments, { maxLen = 28, pad = 0.25, total = Infinity } = {}) {
  const chunks = [];
  let cur = null;
  const flush = () => {
    if (cur) chunks.push(cur);
    cur = null;
  };
  for (const s of segments) {
    let seg = { ...s };
    // un singolo segmento più lungo del massimo si taglia in parti uguali (la voce continua: succede con monologhi senza pause)
    if (seg.end - seg.start > maxLen) {
      flush();
      const parts = Math.ceil((seg.end - seg.start) / maxLen);
      const len = (seg.end - seg.start) / parts;
      for (let i = 0; i < parts; i++) chunks.push({ start: seg.start + i * len, end: seg.start + (i + 1) * len, segments: [{ start: seg.start + i * len, end: seg.start + (i + 1) * len }] });
      continue;
    }
    if (cur && seg.end - cur.start <= maxLen) {
      cur.end = seg.end;
      cur.segments.push(seg);
    } else {
      flush();
      cur = { start: seg.start, end: seg.end, segments: [seg] };
    }
  }
  flush();
  // un po' di silenzio attorno a ogni blocco aiuta il riconoscimento
  return chunks.map((c) => ({ ...c, start: Math.max(0, c.start - pad), end: Math.min(total, c.end + pad) }));
}

/** Dove c'è parlato a un certo istante? */
export const inSpeech = (segments, t) => segments.some((s) => t >= s.start - 1e-9 && t <= s.end + 1e-9);

/** Energia normalizzata 0..1 (0 = rumore di fondo, 1 = voce forte) all'istante t. */
export function energyAt(v, t) {
  const i = clamp(Math.round(t / v.hop), 0, v.energies.length - 1);
  const span = Math.max(1, v.speechDb - v.floorDb);
  return clamp((v.energies[i] - v.floorDb) / span, 0, 1);
}

/**
 * Quanti «nuclei sillabici» (picchi di energia, uno per vocale) ci sono fra a e b secondi. Serve a capire quante sillabe
 * sono state dette in una parte parlata, indipendentemente da quanto lentamente si parli: molto più affidabile della durata.
 */
export function syllableNuclei(vad, a, b, { minProminence = 2, minDistance = 0.085 } = {}) {
  const i0 = Math.max(0, Math.floor(a / vad.hop));
  const i1 = Math.min(vad.energies.length - 1, Math.floor(b / vad.hop));
  if (i1 - i0 < 3) return 0;
  const sm = [];
  for (let i = i0; i <= i1; i++) {
    let s = 0;
    let n = 0;
    for (let d = -3; d <= 3; d++) {
      const j = i + d;
      if (j >= i0 && j <= i1) {
        s += vad.energies[j];
        n++;
      }
    }
    sm.push(s / n);
  }
  const peaks = [];
  for (let i = 1; i < sm.length - 1; i++) {
    if (!(sm[i] >= sm[i - 1] && sm[i] > sm[i + 1])) continue;
    let lmin = sm[i];
    let l = i;
    while (l > 0 && sm[l - 1] <= sm[i]) {
      l--;
      lmin = Math.min(lmin, sm[l]);
    }
    let rmin = sm[i];
    let r = i;
    while (r < sm.length - 1 && sm[r + 1] <= sm[i]) {
      r++;
      rmin = Math.min(rmin, sm[r]);
    }
    const prom = sm[i] - Math.max(lmin, rmin);
    if (prom >= minProminence) peaks.push({ t: (i0 + i) * vad.hop, prom });
  }
  const out = [];
  for (const p of peaks) {
    const last = out[out.length - 1];
    if (last && p.t - last.t < minDistance) {
      if (p.prom > last.prom) out[out.length - 1] = p;
    } else out.push(p);
  }
  return out.length;
}
