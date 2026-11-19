// Teleprompter: logica pura (nessun DOM). Il testo scorre in modo che la lettura finisca esattamente
// nel tempo calcolato dalla velocità scelta in parole al minuto.

export const WPM_MIN = 40;
export const WPM_MAX = 320;
export const WPM_DEFAULT = 140; // lettura a voce alta, calma

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const clampWpm = (v) => Math.round(clamp(Number.isFinite(+v) ? +v : WPM_DEFAULT, WPM_MIN, WPM_MAX));

/**
 * Divide lo script in righe visibili. Le righe che iniziano con `//` sono appunti privati:
 * non si vedono mentre si legge e non contano come parole.
 * @returns {{lines: string[], notes: string[], words: number}}
 */
export function parseScript(text) {
  const lines = [];
  const notes = [];
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('//')) {
      notes.push(line.replace(/^\/\/\s?/, ''));
      continue;
    }
    // le righe vuote consecutive diventano una sola pausa visiva
    if (!line && (lines.length === 0 || lines[lines.length - 1] === '')) continue;
    lines.push(line);
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const words = lines.reduce((n, l) => n + (l.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-.,:;!?]*/gu)?.length ?? 0), 0);
  return { lines, notes, words };
}

export const wordCount = (text) => parseScript(text).words;

/** Secondi di lettura a voce alta. */
export const readingSeconds = (words, wpm) => (words > 0 ? (words / clampWpm(wpm)) * 60 : 0);

/**
 * Piano di scorrimento. Il contenuto è alto `contentHeight` (con margini già inclusi) in una finestra alta
 * `viewHeight`: si scorre di `distance` pixel in `seconds` secondi.
 * @returns {{seconds: number, distance: number, pxPerSecond: number}}
 */
export function scrollPlan({ words, wpm, contentHeight, viewHeight }) {
  const seconds = readingSeconds(words, wpm);
  const distance = Math.max(0, (contentHeight || 0) - (viewHeight || 0));
  return { seconds, distance, pxPerSecond: seconds > 0 ? distance / seconds : 0 };
}

/** Posizione (px) dopo `elapsed` secondi dall'inizio, limitata alla fine del testo. */
export const scrollOffset = (plan, elapsed) => clamp(plan.pxPerSecond * Math.max(0, elapsed), 0, plan.distance);

/** Tempo trascorso corrispondente a una posizione, per riprendere da dove si è fermi dopo aver cambiato velocità. */
export const elapsedAt = (plan, offset) => (plan.pxPerSecond > 0 ? clamp(offset, 0, plan.distance) / plan.pxPerSecond : 0);
