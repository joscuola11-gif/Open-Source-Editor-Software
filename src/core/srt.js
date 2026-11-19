// Lettura/scrittura sottotitoli SubRip (.srt).

const TS = /(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})/;

export function parseTimestamp(s) {
  const m = TS.exec(s);
  if (!m) return null;
  const ms = Number(m[4].padEnd(3, '0'));
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + ms / 1000;
}

/** Restituisce [{start, end, text}] ordinati; ignora i blocchi non validi. */
export function parseSrt(input) {
  const text = String(input ?? '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!text) return [];
  const cues = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const start = parseTimestamp(a);
    const end = parseTimestamp(b);
    if (start === null || end === null || end <= start) continue;
    const body = lines
      .slice(ti + 1)
      .join('\n')
      .replace(/<[^>]*>/g, '')
      .replace(/\{\\[^}]*\}/g, '')
      .trim();
    if (!body) continue;
    cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

export function formatTimestamp(t) {
  const total = Math.max(0, Math.round(t * 1000));
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

export function formatSrt(cues) {
  return (
    cues
      .map((c, i) => `${i + 1}\n${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${c.text}`)
      .join('\n\n') + '\n'
  );
}
