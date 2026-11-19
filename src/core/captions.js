// Costruzione dei sottotitoli da parole con tempi: dove spezzare, a capo bilanciati, durate leggibili, nessuna sovrapposizione.
// Puro. Funziona con l'output di qualunque riconoscitore (o con parole allineate a un testo).

export const CAPTION_STYLES = {
  standard: { label: 'Standard (film e YouTube)', maxChars: 42, maxLines: 2, maxDuration: 6, minDuration: 1, maxCps: 20 },
  short: { label: 'Corti per social (9:16)', maxChars: 22, maxLines: 2, maxDuration: 3.2, minDuration: 0.8, maxCps: 18 },
  oneLine: { label: 'Una sola riga', maxChars: 38, maxLines: 1, maxDuration: 4, minDuration: 0.9, maxCps: 20 },
  words: { label: 'Poche parole alla volta (karaoke)', maxChars: 16, maxLines: 1, maxDuration: 2.4, minDuration: 0.5, maxCps: 22 },
};

const STRONG = /[.!?…]["»”')\]]*$/;
const WEAK = /[,;:–—]["»”')\]]*$/;
// parole dopo cui non conviene andare a capo (articoli, preposizioni corte) e prima delle quali conviene (congiunzioni)
const NO_BREAK_AFTER = new Set(['il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra', 'del', 'dello', 'della', 'dei', 'degli', 'delle', 'al', 'allo', 'alla', 'ai', 'agli', 'alle', 'nel', 'nello', 'nella', 'nei', 'sul', 'sulla', 'e', 'o', 'ma', 'che', 'non', 'mi', 'ti', 'si', 'ci', 'vi', 'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'and', 'or', 'but', 'my', 'your', 'his', 'her', 'our', 'their', 'is', 'are', 'was', 'el', 'los', 'las', 'un', 'une', 'des', 'les', 'de', 'du', 'der', 'die', 'das', 'ein', 'eine', 'o', 'os', 'um', 'uma']);
const BREAK_BEFORE = new Set(['e', 'ma', 'che', 'perché', 'quando', 'se', 'però', 'quindi', 'and', 'but', 'that', 'because', 'when', 'so', 'or', 'o', 'pero', 'porque', 'mais', 'et', 'und', 'aber', 'weil']);
const FILLERS = new Set(['eh', 'ehm', 'ehh', 'uhm', 'uhh', 'umm', 'mmm', 'hmm', 'mh', 'um', 'uh', 'erm', 'ah', 'ehi']);

const plain = (w) => w.toLowerCase().replace(/[^a-zà-ÿ0-9]/g, '');
const len = (ws) => ws.reduce((n, w, i) => n + w.text.length + (i ? 1 : 0), 0);

/** Punteggio di un punto di rottura DOPO la parola i (più alto = meglio spezzare qui). */
function breakScore(words, i, gap) {
  const w = words[i];
  const next = words[i + 1];
  let s = 0;
  if (STRONG.test(w.text)) s += 6;
  else if (WEAK.test(w.text)) s += 3;
  if (gap >= 0.7) s += 5;
  else if (gap >= 0.35) s += 2.5;
  if (next && BREAK_BEFORE.has(plain(next.text))) s += 1.5;
  if (NO_BREAK_AFTER.has(plain(w.text)) && !STRONG.test(w.text)) s -= 4;
  if (plain(w.text).length <= 2 && !STRONG.test(w.text) && !WEAK.test(w.text)) s -= 1;
  return s;
}

/** Divide `words` in al massimo `maxLines` righe bilanciate, spezzando dove conviene. */
export function breakLines(words, maxChars, maxLines) {
  if (maxLines <= 1 || len(words) <= maxChars || words.length < 2) return [words];
  if (maxLines === 2) {
    let best = null;
    for (let i = 0; i < words.length - 1; i++) {
      const a = words.slice(0, i + 1);
      const b = words.slice(i + 1);
      const la = len(a);
      const lb = len(b);
      if (la > maxChars || lb > maxChars) continue;
      const balance = 1 - Math.abs(la - lb) / Math.max(la, lb, 1);
      const score = balance * 3 + breakScore(words, i, words[i + 1].start - words[i].end);
      if (!best || score > best.score) best = { score, i };
    }
    if (best) return [words.slice(0, best.i + 1), words.slice(best.i + 1)];
    // nessuna divisione entra nei limiti (parola lunghissima): la più equilibrata
    const half = Math.round(words.length / 2);
    return [words.slice(0, half), words.slice(half)];
  }
  // 3 righe o più: riempimento goloso
  const lines = [];
  let cur = [];
  for (const w of words) {
    if (cur.length && len([...cur, w]) > maxChars) {
      lines.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** Le parole entrano in `maxLines` righe da `maxChars` (una parola sola, anche lunghissima, entra sempre). */
function fitsLines(ws, maxChars, maxLines) {
  if (ws.length <= 1 || len(ws) <= maxChars) return true;
  if (maxLines <= 1) return false;
  if (maxLines === 2) {
    for (let i = 0; i < ws.length - 1; i++) if (len(ws.slice(0, i + 1)) <= maxChars && len(ws.slice(i + 1)) <= maxChars) return true;
    return false;
  }
  return breakLines(ws, maxChars, maxLines).length <= maxLines && breakLines(ws, maxChars, maxLines).every((l) => l.length === 1 || len(l) <= maxChars);
}

/**
 * @param {Array<{text:string,start:number,end:number}>} words
 * @param {{style?: keyof typeof CAPTION_STYLES, maxChars?: number, maxLines?: number, maxDuration?: number, minDuration?: number, maxCps?: number,
 *          pauseSplit?: number, removeFillers?: boolean, capitalize?: boolean, gap?: number, hold?: number}} o
 * @returns {Array<{start:number,end:number,text:string,lines:string[],words:Array<{text:string,start:number,end:number}>}>}
 */
export function buildCues(words, o = {}) {
  const st = { ...CAPTION_STYLES[o.style ?? 'standard'], ...o };
  const { maxChars, maxLines, maxDuration, minDuration, maxCps } = st;
  const pauseSplit = o.pauseSplit ?? 0.8;
  const gapMin = o.gap ?? 0.04;
  const hold = o.hold ?? 0.25;
  let ws = words.filter((w) => w && typeof w.text === 'string' && w.text.trim() && Number.isFinite(w.start) && Number.isFinite(w.end)).map((w) => ({ text: w.text.trim(), start: w.start, end: Math.max(w.end, w.start + 0.05) }));
  if (o.removeFillers) ws = ws.filter((w) => !FILLERS.has(plain(w.text)));
  if (o.capitalize !== false) {
    let cap = true;
    ws = ws.map((w) => {
      const t = cap ? w.text.replace(/^(["«“'(]*)([a-zà-ÿ])/, (_, p, c) => p + c.toUpperCase()) : w.text;
      cap = STRONG.test(w.text);
      return { ...w, text: t };
    });
  }
  if (!ws.length) return [];
  const fits = (a) => fitsLines(a, maxChars, maxLines);
  const limit = maxChars * maxLines;
  const cues = [];
  let cur = [];
  const flush = (upTo = cur.length) => {
    if (!upTo) return;
    cues.push(cur.splice(0, upTo));
  };
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    const prev = cur[cur.length - 1];
    // pausa lunga: si chiude il sottotitolo prima di questa parola
    if (prev && w.start - prev.end >= pauseSplit) flush();
    cur.push(w);
    const tooLong = () => !fits(cur) || cur.at(-1).end - cur[0].start > maxDuration;
    if (tooLong() && cur.length > 1) {
      // si cerca il miglior punto di rottura nella seconda metà; dopo aver chiuso il primo pezzo, il resto deve entrare a sua volta
      while (cur.length > 1 && tooLong()) {
        let best = -1;
        let bestScore = -Infinity;
        const from = Math.max(0, Math.floor((cur.length - 1) * 0.4));
        for (let k = from; k < cur.length - 1; k++) {
          const head = cur.slice(0, k + 1);
          if (!fits(head) || head.at(-1).end - head[0].start > maxDuration) continue;
          const score = breakScore(cur, k, cur[k + 1].start - cur[k].end) + (k + 1) / cur.length;
          if (score > bestScore) {
            bestScore = score;
            best = k;
          }
        }
        flush(best >= 0 ? best + 1 : cur.length - 1);
      }
    } else if (STRONG.test(w.text) && (len(cur) >= limit * 0.45 || w.end - cur[0].start >= maxDuration * 0.5)) {
      // fine frase e il sottotitolo è già abbastanza pieno: si chiude
      flush();
    }
  }
  flush();
  // niente sottotitoli di una sola parolina quando si può unirla al vicino
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (c.length === 1 && c[0].text.length <= 3 && !STRONG.test(c[0].text)) {
      const j = i + 1 < cues.length ? i + 1 : i - 1;
      if (j >= 0 && j < cues.length) {
        const merged = j > i ? [...c, ...cues[j]] : [...cues[j], ...c];
        const gap = j > i ? cues[j][0].start - c[0].end : c[0].start - cues[j].at(-1).end;
        if (fits(merged) && merged.at(-1).end - merged[0].start <= maxDuration && gap < pauseSplit) {
          cues[Math.min(i, j)] = merged;
          cues.splice(Math.max(i, j), 1);
          i = Math.max(-1, i - 2);
        }
      }
    }
  }
  const out = cues.map((c) => {
    const lines = breakLines(c, maxChars, maxLines);
    return { start: c[0].start, end: c.at(-1).end, lines: lines.map((l) => l.map((w) => w.text).join(' ')), text: lines.map((l) => l.map((w) => w.text).join(' ')).join('\n'), words: c.map((w) => ({ ...w })) };
  });
  // durate leggibili: si allunga nella pausa seguente (mai oltre la prossima voce), e si lascia un respiro fra i sottotitoli
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    const nextStart = i + 1 < out.length ? out[i + 1].start : Infinity;
    const chars = c.text.replace(/\n/g, '').length;
    const speechEnd = c.end;
    const want = Math.max(minDuration, chars / maxCps, c.end - c.start + hold);
    const room = Math.max(c.end - c.start, nextStart - gapMin - c.start);
    let end = c.start + Math.min(Math.max(c.end - c.start, want), Math.min(room, maxDuration + hold));
    end = Math.min(end, nextStart - gapMin);
    // se il respiro non ci sta (parole attaccate) il sottotitolo finisce dov'era finito il parlato: mai sovrapposto al prossimo
    c.end = end >= c.start + 0.1 && end >= speechEnd - 0.5 ? end : Math.min(speechEnd, nextStart);
  }
  return out;
}

/** Controlli di qualità sui sottotitoli: restituisce l'elenco dei problemi (vuoto = tutto a posto). */
export function checkCues(cues, o = {}) {
  const st = { ...CAPTION_STYLES[o.style ?? 'standard'], ...o };
  const issues = [];
  cues.forEach((c, i) => {
    if (!(c.end > c.start)) issues.push(`#${i}: durata non valida`);
    if (c.lines.length > st.maxLines) issues.push(`#${i}: ${c.lines.length} righe`);
    for (const l of c.lines) if (l.length > st.maxChars && l.includes(' ')) issues.push(`#${i}: riga troppo lunga (${l.length})`);
    if (c.end - c.start > st.maxDuration + 0.6) issues.push(`#${i}: troppo lungo (${(c.end - c.start).toFixed(1)} s)`);
    if (i && c.start < cues[i - 1].end - 1e-6) issues.push(`#${i}: si sovrappone al precedente`);
  });
  return issues;
}
