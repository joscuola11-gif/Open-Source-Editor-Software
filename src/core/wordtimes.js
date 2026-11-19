// Tempi delle parole: stima delle sillabe e correzione dei tempi dati da un riconoscitore (che spesso sbaglia di mezzo
// secondo) usando dove si parla davvero (VAD) e dove l'energia della voce scende fra una parola e l'altra. Puro.

import { energyAt } from './vad.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Numero approssimato di sillabe di una parola (gruppi di vocali; meglio di niente per it, en, es, fr, de, pt). */
export function syllables(word) {
  const w = String(word).toLowerCase().replace(/[^a-zà-ÿ]/g, '');
  if (!w) return 0;
  const groups = w.match(/[aeiouyàèéìíòóùúâêîôûäöüáíóúãõ]+/g) ?? [];
  let n = groups.length;
  // iato: due vocali «forti» vicine (a, e, o) sono sillabe diverse (vi-de-o, po-e-ta); i dittonghi con i/u restano una sillaba
  for (const g of groups) n += (g.match(/[aeoàèéòóáâêôãõ](?=[aeoàèéòóáâêôãõ])/g) ?? []).length;
  // in inglese la «e» muta finale non fa sillaba (make, time) ma «le» sì (table): regola grossolana
  if (/[^aeiouy]e$/.test(w) && !/le$/.test(w) && n > 1) n--;
  return Math.max(1, n);
}

/** Peso temporale di una parola: sillabe + una pausa dopo virgole e punti. */
export function wordWeight(text) {
  const s = syllables(text) || 1;
  const t = String(text);
  let pause = 0;
  if (/[.!?…]$/.test(t)) pause = 1.4;
  else if (/[,;:]$/.test(t)) pause = 0.7;
  return { speech: s + 0.35, pause };
}

/** Distribuisce le parole fra `start` e `end` in proporzione al loro peso (le pause dopo la punteggiatura pesano di più). */
export function spreadWords(texts, start, end) {
  const ws = texts.map(wordWeight);
  const total = ws.reduce((a, w) => a + w.speech + w.pause, 0) || 1;
  // la pausa dopo l'ultima parola non conta: sta fuori dal parlato
  const last = ws.at(-1);
  const usable = total - (last ? last.pause : 0);
  const out = [];
  let t = start;
  const k = (end - start) / Math.max(usable, 1e-6);
  texts.forEach((text, i) => {
    const d = ws[i].speech * k;
    out.push({ text, start: t, end: Math.min(end, t + d) });
    t += d + (i < texts.length - 1 ? ws[i].pause * k : 0);
  });
  return out;
}

/** Sistema sovrapposizioni, durate negative e parole fuori dall'audio senza cambiare l'ordine. */
export function normalizeWords(words, { minWord = 0.06, total = Infinity } = {}) {
  const out = [];
  let prevEnd = 0;
  for (const w of words) {
    let s = clamp(Number.isFinite(w.start) ? w.start : prevEnd, prevEnd, total);
    let e = clamp(Number.isFinite(w.end) ? w.end : s + minWord, s + minWord, Math.max(total, s + minWord));
    if (e < s + minWord) e = s + minWord;
    out.push({ ...w, start: s, end: e });
    prevEnd = Math.min(e, e);
    // le parole non si sovrappongono: la successiva inizia al più alla fine di questa
    if (prevEnd < s) prevEnd = s;
  }
  return out;
}

/**
 * Cerca entro ±radius secondi da t il calo di energia più profondo (una pausa fra due parole) e ne restituisce
 * l'intervallo a metà profondità: {t: punto più basso, start, end}. Se non c'è un calo netto, null.
 */
function findGap(vad, t, radius, minDrop = 0.06) {
  const steps = Math.max(1, Math.round(radius / vad.hop));
  let best = t;
  let bestE = Infinity;
  let sum = 0;
  let n = 0;
  for (let i = -steps; i <= steps; i++) {
    const tt = t + i * vad.hop;
    const e = energyAt(vad, tt);
    sum += e;
    n++;
    // a parità di profondità si preferisce il punto più vicino a t
    if (e < bestE - 1e-9 || (Math.abs(e - bestE) < 1e-9 && Math.abs(tt - t) < Math.abs(best - t))) {
      bestE = e;
      best = tt;
    }
  }
  const mean = sum / n;
  if (mean - bestE < minDrop) return null;
  const half = bestE + (mean - bestE) * 0.5;
  let a = best;
  let b = best;
  while (a - vad.hop >= t - radius && energyAt(vad, a - vad.hop) <= half) a -= vad.hop;
  while (b + vad.hop <= t + radius && energyAt(vad, b + vad.hop) <= half) b += vad.hop;
  return { t: best, start: a, end: b + vad.hop };
}

/**
 * Corregge i tempi delle parole:
 *  1. ogni parola va nella parte parlata più vicina (niente parole nel silenzio);
 *  2. dentro ogni parte parlata i tempi del riconoscitore si mescolano con una distribuzione per sillabe
 *     (`blend` = quanto fidarsi del riconoscitore, 0..1);
 *  3. i confini fra parole si spostano sul calo di energia più vicino.
 * @param {Array<{text:string,start:number,end:number}>} words
 * @param {{segments: object[], energies: Float32Array, hop: number, floorDb: number, speechDb: number}} vad risultato di detectSpeech
 */
export function repairWordTimes(words, vad, { blend = 0.4, minWord = 0.07, snap = 0.1, gaps = true, total = Infinity } = {}) {
  if (!words.length) return [];
  const segs = vad?.segments ?? [];
  const base = normalizeWords(words, { minWord, total });
  if (!segs.length) return base;
  // 1. assegnazione ai segmenti (per punto medio; le parole fuori vanno al segmento più vicino)
  const owner = base.map((w) => {
    const mid = (w.start + w.end) / 2;
    let best = 0;
    let bestD = Infinity;
    segs.forEach((s, i) => {
      const d = mid < s.start ? s.start - mid : mid > s.end ? mid - s.end : 0;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  });
  const out = base.map((w) => ({ ...w }));
  let i = 0;
  while (i < out.length) {
    let j = i;
    while (j + 1 < out.length && owner[j + 1] === owner[i]) j++;
    const seg = segs[owner[i]];
    const group = out.slice(i, j + 1);
    // 2. mescola con la distribuzione per sillabe dentro il segmento (senza i margini di sicurezza del VAD)
    const s0 = seg.start + 0.04;
    const s1 = Math.max(s0 + group.length * minWord, seg.end - 0.06);
    const spread = spreadWords(group.map((w) => w.text), s0, s1);
    group.forEach((w, k) => {
      const ws = clamp(w.start, s0, s1);
      const we = clamp(w.end, ws, s1);
      w.start = blend * ws + (1 - blend) * spread[k].start;
      w.end = blend * we + (1 - blend) * spread[k].end;
    });
    // il primo e l'ultimo di ogni segmento coincidono col parlato reale
    group[0].start = s0;
    group[group.length - 1].end = s1;
    i = j + 1;
  }
  // 3. confini sul calo di energia (solo fra parole dello stesso segmento, mantenendo l'ordine): la parola finisce dove
  //    comincia la pausa e la successiva comincia dove la pausa finisce
  for (let k = 0; k + 1 < out.length; k++) {
    if (owner[k] !== owner[k + 1]) continue;
    const a = out[k];
    const b = out[k + 1];
    const t = (a.end + b.start) / 2;
    // il raggio di ricerca non supera ~metà della più breve delle due parole: altrimenti si finirebbe in un'altra pausa
    const gap = findGap(vad, t, Math.max(vad.hop * 3, Math.min(snap, 0.5 * Math.min(a.end - a.start, b.end - b.start))));
    if (!gap) continue;
    const lo = a.start + minWord;
    const hi = b.end - minWord;
    let ge = clamp(gap.start, lo, hi);
    let gs = clamp(gap.end, ge, hi);
    if (!gaps) {
      ge = clamp(gap.t, lo, hi);
      gs = ge;
    }
    a.end = ge;
    b.start = gs;
  }
  return normalizeWords(out, { minWord, total });
}

// ---------------------------------------------------------------------------
// Posizionamento delle parole sulle pause vere (per l'allineamento a un testo noto)
// ---------------------------------------------------------------------------

/** Tutte le pause (cali di energia) fra a e b secondi: [{t, start, end, depth}], dalla più a sinistra. */
export function valleysIn(vad, a, b, { minDrop = 0.05, radius = 0.15 } = {}) {
  const i0 = Math.max(0, Math.floor(a / vad.hop));
  const i1 = Math.min(vad.energies.length - 1, Math.ceil(b / vad.hop));
  const en = [];
  for (let i = i0; i <= i1; i++) en.push(energyAt(vad, i * vad.hop));
  // media mobile su 3 finestre
  const sm = en.map((_, i) => (en[Math.max(0, i - 1)] + en[i] + en[Math.min(en.length - 1, i + 1)]) / 3);
  const R = Math.max(2, Math.round(radius / vad.hop));
  const found = [];
  for (let i = 1; i < sm.length - 1; i++) {
    let isMin = true;
    let sum = 0;
    let n = 0;
    for (let d = -R; d <= R; d++) {
      const j = i + d;
      if (j < 0 || j >= sm.length) continue;
      sum += sm[j];
      n++;
      if (sm[j] < sm[i] - 1e-9 || (sm[j] === sm[i] && d < 0)) isMin = false;
    }
    const depth = sum / n - sm[i];
    if (!isMin || depth < minDrop) continue;
    const half = sm[i] + depth * 0.5;
    let s = i;
    let e = i;
    while (s > 0 && sm[s - 1] <= half) s--;
    while (e < sm.length - 1 && sm[e + 1] <= half) e++;
    found.push({ t: (i0 + i) * vad.hop, start: (i0 + s) * vad.hop, end: (i0 + e + 1) * vad.hop, depth });
  }
  // pause troppo vicine sono la stessa: si tiene la più profonda
  const out = [];
  for (const v of found) {
    const last = out[out.length - 1];
    if (last && v.start - last.end < 0.05) {
      if (v.depth > last.depth) out[out.length - 1] = v;
    } else out.push(v);
  }
  return out;
}

/**
 * Colloca le parole di una parte parlata [start, end] sulle pause trovate: programmazione dinamica che sceglie
 * quali pause sono confini fra parole, in modo che la durata di ogni parola somigli a quella attesa (sillabe).
 * Se mancano pause (parole attaccate) usa le posizioni proporzionali come ripiego.
 */
export function placeWordsByValleys(texts, start, end, vad) {
  const k = texts.length;
  if (k === 0) return [];
  if (k === 1) return [{ text: texts[0], start, end }];
  const ws = texts.map((t) => wordWeight(t).speech);
  const wsum = ws.reduce((a, b) => a + b, 0);
  const len = Math.max(0.05, end - start);
  const rate = wsum / (len * 0.9); // sillabe al secondo, tolte le pause
  const valleys = valleysIn(vad, start, end).filter((v) => v.start > start + 0.04 && v.end < end - 0.04);
  // posizioni proporzionali (ripiego) per ogni confine
  const cum = [];
  let c = 0;
  for (let i = 0; i < k - 1; i++) {
    c += ws[i];
    cum.push(start + (c / wsum) * len);
  }
  const FREE = 0.9;
  const layers = [];
  for (let j = 0; j < k - 1; j++) {
    const cands = valleys.map((v) => ({ gs: v.end, ge: v.start, cost: -0.8 * Math.min(1, v.depth / 0.4), free: false }));
    cands.push({ gs: cum[j], ge: cum[j], cost: FREE, free: true });
    layers.push(cands);
  }
  const INF = 1e12;
  const wordCost = (from, to, j) => {
    const dur = to - from;
    if (dur < 0.06) return INF;
    return Math.abs(Math.log(dur / (ws[j] / rate)));
  };
  // dp[j][q] = costo migliore con il confine j sul candidato q (parole 0..j già collocate)
  const dp = layers.map((l) => new Float64Array(l.length).fill(INF));
  const back = layers.map((l) => new Int32Array(l.length).fill(-1));
  layers[0].forEach((q, qi) => {
    dp[0][qi] = wordCost(start, q.ge, 0) + q.cost;
  });
  for (let j = 1; j < layers.length; j++) {
    layers[j].forEach((q, qi) => {
      layers[j - 1].forEach((p, pi) => {
        if (dp[j - 1][pi] >= INF) return;
        const cost = dp[j - 1][pi] + wordCost(p.gs, q.ge, j) + q.cost;
        if (cost < dp[j][qi]) {
          dp[j][qi] = cost;
          back[j][qi] = pi;
        }
      });
    });
  }
  const last = layers.length - 1;
  let bestQ = -1;
  let bestC = INF;
  layers[last].forEach((q, qi) => {
    const cost = dp[last][qi] + wordCost(q.gs, end, k - 1);
    if (cost < bestC) {
      bestC = cost;
      bestQ = qi;
    }
  });
  if (bestQ < 0) return spreadWords(texts, start, end);
  const chosen = new Array(layers.length);
  let q = bestQ;
  for (let j = last; j >= 0; j--) {
    chosen[j] = layers[j][q];
    q = back[j][q];
  }
  const out = [];
  for (let i = 0; i < k; i++) {
    const s = i === 0 ? start : chosen[i - 1].gs;
    const e = i === k - 1 ? end : chosen[i].ge;
    out.push({ text: texts[i], start: s, end: Math.max(e, s + 0.05) });
  }
  return out;
}
