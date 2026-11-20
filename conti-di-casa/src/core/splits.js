// Spese divise fra i membri della famiglia e «chi deve a chi».

import { allocate, splitEvenly } from './money.js';
import { alive } from './model.js';

/** Divisione in parti uguali fra `memberIds`; `pagatoDa` ha anticipato tutto. */
export function equalSplit(importo, memberIds, pagatoDa) {
  const parts = splitEvenly(importo, memberIds.length);
  return { pagatoDa, quote: memberIds.map((membroId, i) => ({ membroId, importo: parts[i] })) };
}

/** Divisione in proporzione a pesi (percentuali o quote): [{membroId, peso}]. */
export function weightedSplit(importo, weights, pagatoDa) {
  const parts = allocate(importo, weights.map((w) => w.peso));
  return { pagatoDa, quote: weights.map((w, i) => ({ membroId: w.membroId, importo: parts[i] })) };
}

/**
 * Saldo di ogni membro: positivo = gli altri gli devono, negativo = deve agli altri.
 * Conta le spese divise e i pagamenti già fatti fra membri (regolamenti). La somma è sempre zero.
 * @returns {Map<string, number>}
 */
export function memberBalances(state) {
  const net = new Map();
  const add = (id, v) => net.set(id, (net.get(id) ?? 0) + v);
  for (const t of state.movimenti) {
    if (t.x || !t.divisione) continue;
    add(t.divisione.pagatoDa, t.importo);
    for (const q of t.divisione.quote) add(q.membroId, -q.importo);
  }
  for (const g of alive(state.regolamenti)) {
    add(g.da, g.importo); // chi ha pagato il suo debito è «meno in debito»
    add(g.a, -g.importo);
  }
  return net;
}

/** Il minimo di pagamenti per pareggiare tutto: [{da, a, importo}]. */
export function settlements(net) {
  const cred = [...net.entries()].filter(([, v]) => v > 0).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v);
  const deb = [...net.entries()].filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < cred.length && j < deb.length) {
    const pay = Math.min(cred[i].v, deb[j].v);
    if (pay > 0) out.push({ da: deb[j].id, a: cred[i].id, importo: pay });
    cred[i].v -= pay;
    deb[j].v -= pay;
    if (cred[i].v === 0) i++;
    if (deb[j].v === 0) j++;
  }
  return out;
}
