// CSV: per aprire i movimenti in Excel e per importare gli estratti conto della banca.

const NEEDS_QUOTES = /["\n\r]|^\s|\s$/;

/** Una cella di testo libero: se comincia come una formula, Excel la eseguirebbe: la si disinnesca con un apice. */
export function safeText(v) {
  const s = String(v ?? '');
  return /^[=+\-@\t\r]/.test(s) && !/^[-+]?\d[\d.,]*$/.test(s) ? `'${s}` : s;
}

/** Righe (array di array) → testo CSV. Di base per Excel italiano: separatore «;», fine riga Windows, BOM UTF-8. */
export function formatCsv(rows, { sep = ';', bom = true, eol = '\r\n' } = {}) {
  const cell = (v) => {
    const s = String(v ?? '');
    return NEEDS_QUOTES.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `${bom ? '﻿' : ''}${rows.map((r) => r.map(cell).join(sep)).join(eol)}${rows.length ? eol : ''}`;
}

/** Il separatore più probabile (fra «;», «,», tab, «|»): quello che compare in modo regolare fuori dalle virgolette nelle prime righe. */
export function detectSeparator(text) {
  const sample = text.replace(/^﻿/, '').split(/\r\n|\n|\r/).slice(0, 8);
  let best = ';';
  let bestScore = -1;
  for (const sep of [';', ',', '\t', '|']) {
    const counts = sample.filter((l) => l.trim()).map((l) => {
      let n = 0;
      let q = false;
      for (const ch of l) {
        if (ch === '"') q = !q;
        else if (ch === sep && !q) n++;
      }
      return n;
    });
    if (!counts.length || counts[0] === 0) continue;
    const regular = counts.filter((c) => c === counts[0]).length;
    const score = regular * 100 + counts[0];
    if (score > bestScore) {
      bestScore = score;
      best = sep;
    }
  }
  return best;
}

/** Testo CSV → {righe: string[][], sep}. Gestisce virgolette, virgolette doppie, a capo dentro le celle, BOM. Le righe vuote si saltano. */
export function parseCsv(text, sep = null) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const sp = sep ?? detectSeparator(src);
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  let any = false;
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c.trim() !== '') || any) if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
    any = false;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      q = true;
      any = true;
    } else if (ch === sp) endCell();
    else if (ch === '\r') {
      if (src[i + 1] === '\n') i++;
      endRow();
    } else if (ch === '\n') endRow();
    else cell += ch;
  }
  if (cell !== '' || row.length) endRow();
  return { righe: rows, sep: sp };
}
