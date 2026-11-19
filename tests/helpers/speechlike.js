// Audio sintetico «simile al parlato»: voce a sillabe (armoniche con inviluppo a ~4 Hz) a tempi noti, su rumore di fondo.
// Serve a provare il rilevamento del parlato e l'allineamento con una verità esatta.

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {Array<{start:number,end:number,f0?:number}>} bursts parti parlate (secondi)
 * @param {{sr?:number, duration:number, noiseDb?:number, voiceDb?:number, seed?:number}} o
 */
export function speechLike(bursts, { sr = 16000, duration, noiseDb = -50, voiceDb = -16, seed = 1 } = {}) {
  const x = new Float32Array(Math.round(duration * sr));
  const r = rng(seed);
  const noiseAmp = 10 ** (noiseDb / 20);
  let lp = 0;
  for (let i = 0; i < x.length; i++) {
    lp = 0.9 * lp + 0.1 * (r() * 2 - 1); // rumore «rosa» grossolano
    x[i] = lp * noiseAmp * 3;
  }
  const amp = 10 ** (voiceDb / 20);
  for (const b of bursts) {
    const f0 = b.f0 ?? 110 + r() * 80;
    const i0 = Math.round(b.start * sr);
    const i1 = Math.min(x.length, Math.round(b.end * sr));
    let ph = 0;
    for (let i = i0; i < i1; i++) {
      const t = (i - i0) / sr;
      const edge = Math.min(1, t / 0.03, (b.end - b.start - t) / 0.04); // attacco e rilascio morbidi
      const syl = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t + 1.3) ** 2; // sillabe a ~4 Hz
      ph += (2 * Math.PI * (f0 * (1 + 0.03 * Math.sin(2 * Math.PI * 0.7 * t)))) / sr;
      let s = 0;
      for (let h = 1; h <= 10; h++) s += Math.sin(h * ph) / h ** 1.1;
      x[i] += Math.max(0, edge) * syl * amp * 0.55 * s;
    }
  }
  return x;
}
