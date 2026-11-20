// Date: sempre testo «AAAA-MM-GG» (data del calendario, senza ora né fuso): così «20 novembre» è lo stesso giorno ovunque.

export const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
export const WEEKDAYS = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
export const WEEKDAYS_SHORT = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

const pad = (n, l = 2) => String(n).padStart(l, '0');

export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12

export function parseISO(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || y < 1900 || y > 2200) return null;
  return { y, m: mo, d };
}
export const isValidISO = (s) => parseISO(s) !== null;
export const toISO = (y, m, d) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** Oggi nel fuso del telefono. */
export function todayISO(now = new Date()) {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const utc = (iso) => {
  const p = parseISO(iso);
  if (!p) throw new Error(`Data non valida: ${iso}`);
  return Date.UTC(p.y, p.m - 1, p.d);
};
const fromUtc = (ms) => {
  const d = new Date(ms);
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

export const addDays = (iso, n) => fromUtc(utc(iso) + n * 86400000);
export const diffDays = (a, b) => Math.round((utc(a) - utc(b)) / 86400000); // a − b

/** Aggiunge mesi tenendo il giorno (o l'ultimo giorno del mese se non esiste: 31 gen + 1 mese = 28/29 feb). */
export function addMonths(iso, n) {
  const p = parseISO(iso);
  if (!p) throw new Error(`Data non valida: ${iso}`);
  const idx = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return toISO(y, m, Math.min(p.d, daysInMonth(y, m)));
}
export const addYears = (iso, n) => addMonths(iso, n * 12);

export const startOfMonth = (iso) => `${iso.slice(0, 8)}01`;
export function endOfMonth(iso) {
  const p = parseISO(iso);
  return toISO(p.y, p.m, daysInMonth(p.y, p.m));
}
export const monthKey = (iso) => iso.slice(0, 7);

/** 0 = lunedì … 6 = domenica. */
export const weekday = (iso) => (new Date(utc(iso)).getUTCDay() + 6) % 7;

/** «20 nov», «20 novembre 2026», «venerdì 20 novembre». */
export function formatDate(iso, style = 'short', today = null) {
  const p = parseISO(iso);
  if (!p) return '';
  const wd = WEEKDAYS[weekday(iso)];
  if (style === 'long') return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
  if (style === 'day') return `${wd} ${p.d} ${MONTHS[p.m - 1]}`;
  if (style === 'monthYear') return `${MONTHS[p.m - 1]} ${p.y}`;
  const sameYear = today ? parseISO(today)?.y === p.y : true;
  return `${p.d} ${MONTHS_SHORT[p.m - 1]}${sameYear ? '' : ` ${p.y}`}`;
}

/** «Oggi», «Ieri», «Domani», altrimenti «venerdì 20 novembre». */
export function relativeDay(iso, today) {
  const d = diffDays(iso, today);
  if (d === 0) return 'Oggi';
  if (d === -1) return 'Ieri';
  if (d === 1) return 'Domani';
  return formatDate(iso, 'day');
}

/** Legge date scritte in modi diversi: 20/11/2026, 20-11-26, 2026-11-20, 20.11.2026, «20 nov 2026». Altro → null. */
export function parseDateAny(text, { today = todayISO() } = {}) {
  if (typeof text !== 'string') return null;
  const s = text.trim();
  if (!s) return null;
  if (isValidISO(s.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  let m = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})(?:\D.*)?$/.exec(s);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += y >= 70 ? 1900 : 2000;
    const iso = toISO(y, +m[2], +m[1]);
    return isValidISO(iso) ? iso : null;
  }
  m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(s);
  if (m) {
    const iso = toISO(+m[1], +m[2], +m[3]);
    return isValidISO(iso) ? iso : null;
  }
  m = /^(\d{1,2})\s+([a-zà-ù]+)\.?\s*(\d{4})?$/i.exec(s);
  if (m) {
    const name = m[2].toLowerCase();
    const idx = MONTHS.findIndex((x) => x === name || x.slice(0, 3) === name.slice(0, 3));
    if (idx < 0) return null;
    const y = m[3] ? +m[3] : parseISO(today).y;
    const iso = toISO(y, idx + 1, +m[1]);
    return isValidISO(iso) ? iso : null;
  }
  return null;
}
