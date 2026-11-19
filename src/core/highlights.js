// «Momenti migliori»: sceglie i tratti più vivaci di un video lungo (movimento + volume), per ricavare riassunti e clip brevi. Puro.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Volume (RMS) per intervallo di tempo, a `fps` valori al secondo. */
export function loudnessSeries(channels, sampleRate, fps, count) {
  const out = new Float32Array(count);
  const x = channels[0];
  const step = sampleRate / fps;
  for (let i = 0; i < count; i++) {
    const a = Math.floor(i * step);
    const b = Math.min(x.length, Math.floor((i + 1) * step));
    let e = 0;
    for (const ch of channels) for (let k = a; k < b; k++) e += ch[k] * ch[k];
    out[i] = b > a ? Math.sqrt(e / ((b - a) * channels.length)) : 0;
  }
  return out;
}

/** Porta una serie fra 0 e 1 usando il 95° percentile come «massimo» (un solo picco non schiaccia tutto il resto). */
function normalize(x) {
  if (!x?.length) return null;
  const s = [...x].sort((a, b) => a - b);
  const hi = s[Math.floor(s.length * 0.95)] || s.at(-1) || 1;
  if (hi < 1e-9) return new Float32Array(x.length);
  return Float32Array.from(x, (v) => clamp(v / hi, 0, 1.2));
}

function smooth(x, radius) {
  const out = new Float32Array(x.length);
  let acc = 0;
  const pre = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) {
    acc += x[i];
    pre[i + 1] = acc;
  }
  for (let i = 0; i < x.length; i++) {
    const a = Math.max(0, i - radius);
    const b = Math.min(x.length, i + radius + 1);
    out[i] = (pre[b] - pre[a]) / (b - a);
  }
  return out;
}

/**
 * @param {{motion?: ArrayLike<number>, loudness?: ArrayLike<number>|null, fps: number, length?: number, count?: number,
 *          minGap?: number, cuts?: number[], snap?: number, motionWeight?: number}} o serie a `fps` valori al secondo, dall'inizio del video
 * @returns {Array<{start:number,end:number,score:number}>} in ordine di tempo; i tratti non si sovrappongono
 */
export function pickHighlights({ motion, loudness = null, fps, length = 15, count = 3, minGap = 1, cuts = [], snap = 1, motionWeight = 0.6 }) {
  const m = normalize(motion);
  const l = normalize(loudness);
  const n = Math.max(m?.length ?? 0, l?.length ?? 0);
  if (!n || !(fps > 0)) return [];
  const w = m && l ? motionWeight : 1;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = (m ? (m[i] ?? 0) * w : 0) + (l ? (l[i] ?? 0) * (m ? 1 - w : 1) : 0);
  const score = smooth(raw, Math.max(1, Math.round(fps * 0.5)));
  const total = n / fps;
  const len = Math.min(length, total);
  const win = Math.max(1, Math.round(len * fps));
  // media in finestra scorrevole
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + score[i];
  const mean = (i) => (pre[Math.min(n, i + win)] - pre[i]) / win;
  const taken = [];
  const out = [];
  const gap = Math.round(minGap * fps);
  for (let k = 0; k < count; k++) {
    let best = -1;
    let bestV = -Infinity;
    for (let i = 0; i + win <= n; i++) {
      if (taken.some(([a, b]) => i < b + gap && i + win > a - gap)) continue;
      const v = mean(i);
      if (v > bestV) {
        bestV = v;
        best = i;
      }
    }
    if (best < 0) break;
    taken.push([best, best + win]);
    let start = best / fps;
    let end = (best + win) / fps;
    // se un taglio di scena sta vicino a un bordo, il tratto parte/finisce lì (niente mezze scene)
    const near = (t) => cuts.reduce((c, q) => (Math.abs(q - t) < Math.abs(c - t) ? q : c), Infinity);
    const cs = near(start);
    if (Math.abs(cs - start) <= snap) start = cs;
    const ce = near(end);
    if (Math.abs(ce - end) <= snap) end = ce;
    if (end - start >= 0.5 * len) out.push({ start: clamp(start, 0, total), end: clamp(end, 0, total), score: bestV });
  }
  return out.sort((a, b) => a.start - b.start);
}
