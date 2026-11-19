// Effetto karaoke: quante lettere del testo sono già «cantate» a un dato istante. Funzioni pure.
//  - 'word': ogni parola si colora intera quando arriva il suo momento;
//  - 'fill': il colore riempie le lettere una dopo l'altra dentro la parola.
// I tempi delle parole possono venire dal file importato (LRC esteso, ASS con \k) oppure, se mancano,
// si distribuiscono in proporzione alla lunghezza delle parole su tutta la durata del clip.

import { clamp, isNum } from './util.js';

export const KARAOKE_MODES = [{ id: 'word', label: 'Parola intera' }, { id: 'fill', label: 'Lettera per lettera' }];
export const defaultKaraoke = () => ({ enabled: false, mode: 'word', color: '#ffe14d' });

export function sanitizeKaraoke(raw) {
  const d = defaultKaraoke();
  if (!raw || typeof raw !== 'object') return d;
  return { enabled: raw.enabled === true, mode: raw.mode === 'fill' ? 'fill' : 'word', color: /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : d.color };
}

/** Parole con tempi dal file: devono essere crescenti; altrimenti si scartano (si useranno i tempi automatici). */
export function sanitizeWords(raw) {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out = [];
  for (const w of raw.slice(0, 500)) {
    if (!w || !isNum(w.t) || w.t < 0 || typeof w.w !== 'string' || !w.w.trim()) return null;
    if (out.length && w.t < out.at(-1).t) return null;
    out.push({ t: w.t, w: w.w.trim().slice(0, 60) });
  }
  return out;
}

const nonSpace = (s) => s.replace(/\s+/g, '').length;

/** [{t, w}] — dai tempi del file o distribuiti in automatico (con un piccolo anticipo e una coda finale). */
export function wordTimings(text, duration) {
  const given = sanitizeWords(text.words);
  if (given && given.map((w) => w.w).join('').replace(/\s/g, '') === String(text.content).replace(/\s/g, '')) return given;
  const words = String(text.content).split(/\s+/).filter(Boolean);
  const total = words.reduce((s, w) => s + w.length, 0) || 1;
  const lead = duration * 0.05;
  const span = duration * 0.85;
  let acc = 0;
  return words.map((w) => {
    const t = lead + (acc / total) * span;
    acc += w.length;
    return { t, w };
  });
}

/** Frazione (0..1) delle lettere non-spazio già colorate a `local` secondi dall'inizio del clip. */
export function karaokeFraction(text, local, duration) {
  const content = String(text.content ?? '');
  const totalChars = nonSpace(content);
  if (!totalChars || !isNum(local) || duration <= 0) return 0;
  const words = wordTimings(text, duration);
  let lit = 0;
  for (let i = 0; i < words.length; i++) {
    const start = words[i].t;
    const end = i + 1 < words.length ? words[i + 1].t : Math.max(start + 0.2, duration * 0.95);
    const n = nonSpace(words[i].w);
    if (local >= end) lit += n;
    else if (local > start) lit += text.karaoke?.mode === 'fill' ? n * clamp((local - start) / Math.max(1e-6, end - start), 0, 1) : n;
  }
  return clamp(lit / totalChars, 0, 1);
}

/** Posizione (indice) in `line` dopo `count` lettere non-spazio. */
export function prefixLength(line, count) {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < line.length; i++) {
    if (!/\s/.test(line[i])) seen++;
    if (seen >= count) return i + 1;
  }
  return line.length;
}
