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

/** Il punto più «vuoto» (energia minima) entro ±radius secondi da t; se il calo è piccolo resta t. */
function snapToDip(vad, t, radius, minDrop = 0.06) {
  const steps = Math.max(1, Math.round(radius / vad.hop));
  let best = t;
  let bestE = energyAt(vad, t);
  let sum = bestE;
  let n = 1;
  for (let i = -steps; i <= steps; i++) {
    const tt = t + i * vad.hop;
    const e = energyAt(vad, tt);
    sum += e;
    n++;
    if (e < bestE - 1e-9) {
      bestE = e;
      best = tt;
    }
  }
  const mean = sum / n;
  return mean - bestE >= minDrop ? best : t;
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
export function repairWordTimes(words, vad, { blend = 0.4, minWord = 0.07, snap = 0.1, total = Infinity } = {}) {
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
  // 3. confini sul calo di energia (solo fra parole dello stesso segmento, mantenendo l'ordine)
  for (let k = 0; k + 1 < out.length; k++) {
    if (owner[k] !== owner[k + 1]) continue;
    const a = out[k];
    const b = out[k + 1];
    const t = (a.end + b.start) / 2;
    const lo = a.start + minWord;
    const hi = b.end - minWord;
    const snapped = clamp(snapToDip(vad, t, snap), lo, hi);
    const gap = Math.max(0, b.start - a.end);
    a.end = snapped - gap / 2;
    b.start = snapped + gap / 2;
    if (a.end < a.start + minWord) a.end = a.start + minWord;
    if (b.start > b.end - minWord) b.start = b.end - minWord;
  }
  return normalizeWords(out, { minWord, total });
}
