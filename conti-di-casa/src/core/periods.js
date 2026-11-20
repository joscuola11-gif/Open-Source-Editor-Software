// Periodi contabili: di base il mese di calendario; si può far iniziare il «mese» un altro giorno (es. il 27, quando arriva lo stipendio).

import { MONTHS, MONTHS_SHORT, addDays, addMonths, daysInMonth, parseISO, toISO } from './dates.js';

export const clampStartDay = (s) => (Number.isInteger(s) && s >= 1 && s <= 28 ? s : 1);

/** Il periodo che contiene `iso`: {from, to, key (= from), label}. */
export function periodOf(iso, startDay = 1) {
  const s = clampStartDay(startDay);
  const p = parseISO(iso);
  if (!p) throw new Error(`Data non valida: ${iso}`);
  let y = p.y;
  let m = p.m;
  if (p.d < s) {
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  const from = toISO(y, m, s);
  const to = s === 1 ? toISO(y, m, daysInMonth(y, m)) : addDays(addMonths(from, 1), -1);
  return { from, to, key: from, label: periodLabel(from, to, s) };
}

function periodLabel(from, to, s) {
  const f = parseISO(from);
  const t = parseISO(to);
  if (s === 1) return `${MONTHS[f.m - 1].replace(/^./, (c) => c.toUpperCase())} ${f.y}`;
  // periodo a cavallo di due mesi: si chiama come il mese in cui finisce
  return `${MONTHS[t.m - 1].replace(/^./, (c) => c.toUpperCase())} ${t.y} (${f.d} ${MONTHS_SHORT[f.m - 1]} – ${t.d} ${MONTHS_SHORT[t.m - 1]})`;
}

/** Il periodo `n` periodi dopo (o prima, se negativo). */
export function shiftPeriod(period, n, startDay = 1) {
  return periodOf(addMonths(period.from, n), startDay);
}

/** Gli ultimi `n` periodi che finiscono con quello di `iso`, dal più vecchio. */
export function lastPeriods(iso, n, startDay = 1) {
  const cur = periodOf(iso, startDay);
  return Array.from({ length: n }, (_, i) => shiftPeriod(cur, i - (n - 1), startDay));
}

/** Giorni totali e giorni trascorsi/restanti del periodo a una certa data. */
export function periodProgress(period, today) {
  const a = Date.UTC(...parts(period.from));
  const b = Date.UTC(...parts(period.to));
  const t = Date.UTC(...parts(today));
  const total = Math.round((b - a) / 86400000) + 1;
  const elapsed = Math.min(total, Math.max(0, Math.round((t - a) / 86400000) + 1));
  return { total, elapsed, remaining: total - elapsed };
}
const parts = (iso) => {
  const p = parseISO(iso);
  return [p.y, p.m - 1, p.d];
};
