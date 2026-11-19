// Sottotitoli in più formati: SRT, WebVTT (.vtt), SubStation Alpha (.ass/.ssa), testi con tempi (.lrc) e testo semplice (.txt).
// Funzioni pure. Ogni «cue» è {start, end, text, words?}; `words` = [{t, w}] con t in secondi dall'inizio della cue
// (parola per parola: serve all'effetto karaoke).

import { formatTimestamp, parseSrt } from './srt.js';

export const SUBTITLE_FORMATS = ['srt', 'vtt', 'ass', 'lrc', 'txt'];

const clean = (s) => String(s ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const entities = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** «[hh:]mm:ss[.,]fff» → secondi (null se non è un tempo). */
export function parseTime(s) {
  const m = /^\s*(?:(\d+):)?(\d{1,3}):(\d{2})(?:[.,](\d{1,3}))?\s*$/.exec(String(s));
  if (!m) return null;
  const frac = m[4] ? Number(m[4].padEnd(3, '0').slice(0, 3)) / 1000 : 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac;
}

export function detectFormat(text, filename = '') {
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  if (ext === 'srt' || ext === 'vtt' || ext === 'lrc' || ext === 'txt') return ext;
  if (ext === 'ass' || ext === 'ssa') return 'ass';
  const t = clean(text).trimStart();
  if (/^WEBVTT/.test(t)) return 'vtt';
  if (/^\[Script Info\]/im.test(t) || /^Dialogue:/m.test(t)) return 'ass';
  if (/-->/.test(t)) return 'srt';
  if (/^\[\d+:\d{2}(?:[.:]\d+)?\]/m.test(t)) return 'lrc';
  return 'txt';
}

// ---- WebVTT ------------------------------------------------------------------------------------

export function parseVtt(input) {
  const text = clean(input).trim().replace(/^WEBVTT[^\n]*\n?/, '');
  const cues = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue; // NOTE, STYLE, REGION…
    const [a, b] = lines[ti].split('-->');
    const start = parseTime(a.trim().split(/\s+/)[0]);
    const end = parseTime(b.trim().split(/\s+/)[0]);
    if (start === null || end === null || end <= start) continue;
    const body = entities(lines.slice(ti + 1).join('\n').replace(/<[^>]*>/g, '')).trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

// ---- ASS / SSA ---------------------------------------------------------------------------------

/** Toglie i codici di stile ASS e, se ci sono i tag di karaoke \k, ricava le parole con i loro tempi. */
function assText(raw) {
  const words = [];
  let acc = 0;
  let pendingDur = null;
  let plain = '';
  const re = /\{([^}]*)\}|([^{]+)/g;
  let m;
  while ((m = re.exec(raw))) {
    if (m[1] !== undefined) {
      const k = /\\k[fo]?(\d+)/.exec(m[1]);
      if (k) pendingDur = Number(k[1]) / 100;
    } else {
      const piece = m[2].replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\\h/g, ' ');
      plain += piece;
      if (pendingDur !== null && piece.trim()) {
        words.push({ t: acc, w: piece.trim() });
        acc += pendingDur;
        pendingDur = null;
      } else if (pendingDur !== null) {
        acc += pendingDur;
        pendingDur = null;
      }
    }
  }
  return { text: plain.trim(), words: words.length > 1 ? words : null };
}

export function parseAss(input) {
  const lines = clean(input).split('\n');
  let inEvents = false;
  let cols = ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'];
  const cues = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) {
      inEvents = /^\[events\]$/i.test(line);
      continue;
    }
    if (!inEvents) continue;
    if (/^Format:/i.test(line)) {
      cols = line.slice(7).split(',').map((c) => c.trim());
      continue;
    }
    if (!/^Dialogue:/i.test(line)) continue;
    const body = line.slice(9).trimStart();
    const parts = [];
    let rest = body;
    for (let i = 0; i < cols.length - 1; i++) {
      const k = rest.indexOf(',');
      if (k < 0) break;
      parts.push(rest.slice(0, k));
      rest = rest.slice(k + 1);
    }
    parts.push(rest);
    const get = (name) => parts[cols.findIndex((c) => c.toLowerCase() === name)];
    const start = parseTime(get('start') ?? '');
    const end = parseTime(get('end') ?? '');
    if (start === null || end === null || end <= start) continue;
    const { text, words } = assText(get('text') ?? '');
    if (text) cues.push(words ? { start, end, text, words } : { start, end, text });
  }
  return cues.sort((x, y) => x.start - y.start);
}

// ---- LRC ---------------------------------------------------------------------------------------

export function parseLrc(input) {
  const rows = [];
  let offset = 0;
  for (const raw of clean(input).split('\n')) {
    const line = raw.trim();
    const off = /^\[offset:\s*([+-]?\d+)\s*\]/i.exec(line);
    if (off) {
      offset = -Number(off[1]) / 1000; // convenzione più diffusa: «+» = i testi compaiono prima
      continue;
    }
    const stamps = [];
    let rest = line;
    let m;
    while ((m = /^\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/.exec(rest))) {
      stamps.push(Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) / 1000 : 0));
      rest = rest.slice(m[0].length);
    }
    if (!stamps.length) continue;
    // formato esteso: <mm:ss.xx>parola
    const words = [];
    let plain = '';
    const re = /<(\d+):(\d{2})(?:[.:](\d{1,3}))?>|([^<]+)/g;
    let wm;
    let wt = null;
    while ((wm = re.exec(rest))) {
      if (wm[4] === undefined) wt = Number(wm[1]) * 60 + Number(wm[2]) + (wm[3] ? Number(wm[3].padEnd(3, '0').slice(0, 3)) / 1000 : 0);
      else {
        plain += wm[4];
        if (wt !== null && wm[4].trim()) words.push({ abs: wt, w: wm[4].trim() });
        wt = null;
      }
    }
    const text = plain.trim();
    if (!text) continue;
    for (const s of stamps) rows.push({ start: Math.max(0, s + offset), text, words: words.length > 1 ? words : null });
  }
  rows.sort((a, b) => a.start - b.start);
  return rows.map((r, i) => {
    const next = rows[i + 1]?.start;
    const lastWord = r.words?.at(-1)?.abs;
    const end = next !== undefined && next > r.start ? next : Math.max(r.start + 3, (lastWord ?? r.start) + 1);
    const cue = { start: r.start, end, text: r.text };
    if (r.words) cue.words = r.words.map((w) => ({ t: Math.max(0, w.abs + offset - r.start), w: w.w }));
    return cue;
  });
}

// ---- testo semplice ----------------------------------------------------------------------------

/** Una cue per paragrafo (o per riga se non ci sono righe vuote), con durata proporzionale alla lunghezza. */
export function parseTxt(input, { charsPerSecond = 14, gap = 0.1 } = {}) {
  const text = clean(input).trim();
  if (!text) return [];
  const blocks = /\n\s*\n/.test(text) ? text.split(/\n\s*\n/) : text.split('\n');
  const cues = [];
  let t = 0;
  for (const b of blocks) {
    const body = b.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    if (!body) continue;
    const dur = Math.min(6, Math.max(1.5, body.replace(/\s/g, '').length / charsPerSecond));
    cues.push({ start: t, end: t + dur, text: body });
    t += dur + gap;
  }
  return cues;
}

/** Legge qualunque formato supportato. @returns {{format: string, cues: object[]}} */
export function parseSubtitles(input, filename = '') {
  const format = detectFormat(input, filename);
  const cues = { srt: parseSrt, vtt: parseVtt, ass: parseAss, lrc: parseLrc, txt: parseTxt }[format](input);
  return { format, cues };
}

// ---- scrittura ---------------------------------------------------------------------------------

const stampDot = (t) => formatTimestamp(t).replace(',', '.');
const oneLine = (s) => s.replace(/\s*\n\s*/g, ' ').trim();

export function formatVtt(cues) {
  return `WEBVTT\n\n${cues.map((c) => `${stampDot(c.start)} --> ${stampDot(c.end)}\n${c.text}`).join('\n\n')}\n`;
}

export function formatTxt(cues) {
  return `${cues.map((c) => c.text).join('\n\n')}\n`;
}

export function formatLrc(cues) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${cues
    .map((c) => {
      const cs = Math.round(Math.max(0, c.start) * 100);
      return `[${p(Math.floor(cs / 6000))}:${p(Math.floor(cs / 100) % 60)}.${p(cs % 100)}]${oneLine(c.text)}`;
    })
    .join('\n')}\n`;
}

export const WRITERS = { vtt: formatVtt, txt: formatTxt, lrc: formatLrc };
export const MIME = { srt: 'application/x-subrip', vtt: 'text/vtt', txt: 'text/plain', lrc: 'text/plain' };
