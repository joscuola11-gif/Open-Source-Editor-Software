// Allineamento di un testo già scritto all'audio, senza modelli: si sa COSA viene detto (copione, testo letto dalla voce
// sintetica) e si cerca QUANDO. Si trovano le parti parlate (VAD), si assegnano le parole alle parti con la programmazione
// dinamica (durata attesa = sillabe / velocità di eloquio) e si rifiniscono i confini sui cali di energia. Puro.

import { detectSpeech, syllableNuclei } from './vad.js';
import { normalizeWords, placeWordsByValleys, spreadWords, syllables, wordWeight } from './wordtimes.js';

const END_PUNCT = /[.!?…;:,]["»”')\]]*$/;

/** Divide un testo in parole (con la punteggiatura attaccata). */
export function tokenize(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/**
 * Assegna le parole alle parti parlate in ordine. Restituisce per ogni parte l'intervallo di parole [a, b) (b = a se vuota).
 * @param {number[]} weights peso (durata attesa in sillabe) di ogni parola
 * @param {{start:number,end:number}[]} segments
 * @param {string[]} texts
 */
export function assignWords(weights, segments, texts, { syl = null, observed = null } = {}) {
  const n = weights.length;
  const m = segments.length;
  if (!n || !m) return segments.map(() => [0, 0]);
  const prefix = [0];
  for (const w of weights) prefix.push(prefix.at(-1) + w);
  const psyl = [0];
  if (syl) for (const x of syl) psyl.push(psyl.at(-1) + x);
  const speech = segments.reduce((a, s) => a + (s.end - s.start), 0);
  const rate = prefix[n] / Math.max(speech, 1e-6); // sillabe al secondo
  const K = Math.min(n, 80); // al massimo 80 parole per parte
  const SKIP = 1.2; // costo di non usare una parte (rumore)
  const INF = 1e12;
  // dp[j][i] = costo minimo avendo usato le prime i parole e le prime j parti
  const dp = Array.from({ length: m + 1 }, () => new Float64Array(n + 1).fill(INF));
  const back = Array.from({ length: m + 1 }, () => new Int32Array(n + 1).fill(-1));
  dp[0][0] = 0;
  for (let j = 1; j <= m; j++) {
    const d = Math.max(0.05, segments[j - 1].end - segments[j - 1].start);
    for (let i = 0; i <= n; i++) {
      // parte saltata
      if (dp[j - 1][i] + SKIP < dp[j][i]) {
        dp[j][i] = dp[j - 1][i] + SKIP;
        back[j][i] = i;
      }
      for (let a = Math.max(0, i - K); a < i; a++) {
        if (dp[j - 1][a] >= INF) continue;
        const expected = d * rate;
        const got = prefix[i] - prefix[a];
        let cost = (syl && observed ? 0.6 : 1) * Math.abs(Math.log(got / expected));
        if (syl && observed) {
          // le sillabe contate nell'audio dicono quante parole ci stanno, anche quando si parla lenti o veloci
          const sylGot = psyl[i] - psyl[a];
          cost += 1.3 * Math.abs(Math.log((sylGot + 1) / (observed[j - 1] + 1)));
        }
        // le pause del parlato di solito cadono dopo la punteggiatura
        if (END_PUNCT.test(texts[i - 1] ?? '')) cost -= 0.35;
        if (i < n && !END_PUNCT.test(texts[i - 1] ?? '')) cost += 0.15;
        const total = dp[j - 1][a] + cost;
        if (total < dp[j][i]) {
          dp[j][i] = total;
          back[j][i] = a;
        }
      }
    }
  }
  // tutte le parole devono essere state usate: si risale da (m, n)
  const ranges = Array.from({ length: m }, () => [0, 0]);
  let i = n;
  for (let j = m; j >= 1; j--) {
    const a = back[j][i];
    if (a < 0) {
      // nessun percorso (dati strani): tutto nella parte più lunga
      return segments.map((s, k) => (k === 0 ? [0, n] : [n, n]));
    }
    ranges[j - 1] = [a, i];
    i = a;
  }
  return ranges;
}

/**
 * @param {string} script testo detto nell'audio
 * @param {Float32Array} audio mono
 * @param {number} sr
 * @param {{vad?: object, blend?: number}} o
 * @returns {Array<{text:string,start:number,end:number}>}
 */
export function alignScript(script, audio, sr, { vad = null } = {}) {
  const texts = tokenize(script);
  if (!texts.length) return [];
  const v = vad ?? detectSpeech(audio, sr);
  const total = audio.length / sr;
  if (!v.segments.length) return spreadWords(texts, 0, Math.max(total, texts.length * 0.2));
  const weights = texts.map((t) => {
    const w = wordWeight(t);
    return w.speech;
  });
  const ranges = assignWords(weights, v.segments, texts, { syl: texts.map((t) => Math.max(1, syllables(t))), observed: v.segments.map((sg) => syllableNuclei(v, sg.start, sg.end)) });
  const words = [];
  ranges.forEach(([a, b], j) => {
    if (b <= a) return;
    const seg = v.segments[j];
    const s0 = seg.start + 0.04;
    const s1 = Math.max(s0 + (b - a) * 0.07, seg.end - 0.06);
    words.push(...placeWordsByValleys(texts.slice(a, b), s0, s1, v));
  });
  // se qualche parola non è stata assegnata (non dovrebbe), si accoda all'ultima
  while (words.length < texts.length) {
    const last = words.at(-1);
    words.push({ text: texts[words.length], start: last.end, end: last.end + 0.2 });
  }
  return normalizeWords(words, { total });
}
