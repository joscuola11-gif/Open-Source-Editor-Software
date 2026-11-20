// Budget: quanto si può spendere al mese per categoria, e a che punto si è.

import { alive } from './model.js';
import { periodProgress } from './periods.js';
import { summarize } from './stats.js';

export const WARN_AT = 80; // % oltre la quale si avvisa

export function budgetState(percento) {
  if (percento >= 100) return 'superato';
  if (percento >= WARN_AT) return 'attenzione';
  return 'ok';
}

/**
 * Stato dei budget in un periodo.
 * @returns {{righe: Array, totale: {limite:number, speso:number, rimanente:number, percento:number, stato:string}, senzaBudget: number, giorniRestanti: number}}
 */
export function budgetStatus(state, period, today) {
  const s = summarize(state, period.from, period.to);
  const spent = new Map(s.perCategoria.map((c) => [c.categoriaId ?? '', c.totale]));
  const { remaining, elapsed, total } = periodProgress(period, today);
  const days = Math.max(1, remaining + (elapsed > 0 && elapsed < total ? 1 : 0)); // oggi conta ancora
  const cat = new Map(state.categorie.map((k) => [k.id, k]));
  const righe = alive(state.budget).filter((b) => cat.has(b.categoriaId) && !cat.get(b.categoriaId).x).map((b) => {
    const speso = spent.get(b.categoriaId) ?? 0;
    const rimanente = b.importo - speso;
    const percento = Math.round((speso / b.importo) * 1000) / 10;
    return { budgetId: b.id, categoriaId: b.categoriaId, limite: b.importo, speso, rimanente, percento, stato: budgetState(percento), alGiorno: rimanente > 0 ? Math.floor(rimanente / days) : 0 };
  }).sort((a, b) => b.percento - a.percento);
  const limite = righe.reduce((x, r) => x + r.limite, 0);
  const speso = righe.reduce((x, r) => x + r.speso, 0);
  const withBudget = new Set(righe.map((r) => r.categoriaId));
  const senzaBudget = s.perCategoria.filter((c) => !withBudget.has(c.categoriaId ?? '')).reduce((x, c) => x + c.totale, 0);
  const percento = limite > 0 ? Math.round((speso / limite) * 1000) / 10 : 0;
  return { righe, totale: { limite, speso, rimanente: limite - speso, percento, stato: budgetState(percento) }, senzaBudget, giorniRestanti: days };
}
