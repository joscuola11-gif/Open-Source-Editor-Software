// Statistiche: totali, categorie, membri, conti, serie nel tempo. I giroconti e le rettifiche del saldo non sono né spese né entrate.

import { alive } from './model.js';
import { addDays, diffDays } from './dates.js';
import { lastPeriods, periodOf, shiftPeriod } from './periods.js';

const counts = (t) => (t.tipo === 'spesa' || t.tipo === 'entrata') && !t.rettifica && !t.x;

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

/**
 * Riepilogo di un intervallo di date [from, to] (compresi).
 * @param {{membri?: string[], conti?: string[]}} filter
 * @returns {{entrate:number, uscite:number, saldo:number, movimenti:number, perCategoria:Array, perMembro:Array, perConto:Array, perGiorno:Map}}
 */
export function summarize(state, from, to, filter = {}) {
  let entrate = 0;
  let uscite = 0;
  let n = 0;
  const cat = new Map();
  const mem = new Map();
  const acc = new Map();
  const day = new Map();
  for (const t of state.movimenti) {
    if (!counts(t) || t.data < from || t.data > to) continue;
    if (filter.membri?.length && !filter.membri.includes(t.membroId ?? '')) continue;
    if (filter.conti?.length && !filter.conti.includes(t.contoId)) continue;
    n++;
    const key = t.categoriaId ?? '';
    if (t.tipo === 'spesa') {
      uscite += t.importo;
      cat.set(`s:${key}`, (cat.get(`s:${key}`) ?? 0) + t.importo);
      mem.set(t.membroId ?? '', (mem.get(t.membroId ?? '') ?? 0) + t.importo);
      acc.set(t.contoId, (acc.get(t.contoId) ?? 0) + t.importo);
    } else {
      entrate += t.importo;
      cat.set(`e:${key}`, (cat.get(`e:${key}`) ?? 0) + t.importo);
    }
    const d = day.get(t.data) ?? { entrate: 0, uscite: 0 };
    d[t.tipo === 'spesa' ? 'uscite' : 'entrate'] += t.importo;
    day.set(t.data, d);
  }
  const catList = (prefix, total) => [...cat.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ categoriaId: k.slice(2) || null, totale: v, percento: pct(v, total) })).sort((a, b) => b.totale - a.totale);
  return {
    entrate,
    uscite,
    saldo: entrate - uscite,
    movimenti: n,
    perCategoria: catList('s:', uscite),
    perCategoriaEntrate: catList('e:', entrate),
    perMembro: [...mem.entries()].map(([membroId, totale]) => ({ membroId: membroId || null, totale, percento: pct(totale, uscite) })).sort((a, b) => b.totale - a.totale),
    perConto: [...acc.entries()].map(([contoId, totale]) => ({ contoId, totale, percento: pct(totale, uscite) })).sort((a, b) => b.totale - a.totale),
    perGiorno: day,
  };
}

/** Entrate e uscite degli ultimi `n` periodi (dal più vecchio). */
export function periodSeries(state, today, n = 12, startDay = 1, filter = {}) {
  return lastPeriods(today, n, startDay).map((p) => {
    const s = summarize(state, p.from, p.to, filter);
    return { periodo: p, entrate: s.entrate, uscite: s.uscite, saldo: s.saldo };
  });
}

/** Confronto fra due totali: {delta, percento} (percento null se prima era zero). */
export function compare(now, before) {
  return { delta: now - before, percento: before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null };
}

/** Il periodo di `today` confrontato con il precedente. */
export function compareWithPrevious(state, today, startDay = 1, filter = {}) {
  const cur = periodOf(today, startDay);
  const prev = shiftPeriod(cur, -1, startDay);
  const a = summarize(state, cur.from, cur.to, filter);
  const b = summarize(state, prev.from, prev.to, filter);
  return { corrente: { periodo: cur, ...a }, precedente: { periodo: prev, ...b }, uscite: compare(a.uscite, b.uscite), entrate: compare(a.entrate, b.entrate) };
}

/** Quanto si spenderà a fine periodo se si continua così (media dei giorni trascorsi × giorni totali). */
export function projection(spentSoFar, elapsed, total) {
  if (elapsed <= 0 || total <= 0) return 0;
  return Math.round((spentSoFar / elapsed) * total);
}

/** Le spese più grandi di un intervallo. */
export function topExpenses(state, from, to, n = 5) {
  return state.movimenti.filter((t) => counts(t) && t.tipo === 'spesa' && t.data >= from && t.data <= to).sort((a, b) => b.importo - a.importo || (a.data < b.data ? 1 : -1)).slice(0, n);
}

/** Spesa media al giorno nell'intervallo, fino a `today`. */
export function dailyAverage(state, from, to, today) {
  const end = today < to ? today : to;
  if (end < from) return 0;
  const days = diffDays(end, from) + 1;
  return Math.round(summarize(state, from, end).uscite / days);
}

/** Andamento del patrimonio: saldo totale alla fine di ognuno degli ultimi `n` periodi. */
export function netWorthSeries(state, today, n, startDay, balancesFn) {
  return lastPeriods(today, n, startDay).map((p) => ({ periodo: p, valore: balancesFn(state, p.to < today ? p.to : today) }));
}

export { addDays, alive };
