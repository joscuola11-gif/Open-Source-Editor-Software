// Esportazione dei movimenti in righe (per il CSV) e riepilogo testuale (da mandare in famiglia).

import { formatDate } from './dates.js';
import { formatAmount, formatPlain } from './money.js';
import { safeText } from './csv.js';
import { sortedTransactions } from './ledger.js';
import { summarize } from './stats.js';

export const HEADER = ['Data', 'Tipo', 'Importo', 'Conto', 'Conto di arrivo', 'Categoria', 'Membro', 'Descrizione', 'Note', 'Tag'];

/** Righe CSV dei movimenti (di base tutti, dal più vecchio). Le spese hanno l'importo negativo, come negli estratti conto. */
export function transactionRows(state, { from = null, to = null } = {}) {
  const acc = new Map(state.conti.map((c) => [c.id, c.nome]));
  const cat = new Map(state.categorie.map((k) => [k.id, k.nome]));
  const mem = new Map(state.membri.map((m) => [m.id, m.nome]));
  const list = sortedTransactions(state).filter((t) => (!from || t.data >= from) && (!to || t.data <= to)).reverse();
  return [HEADER, ...list.map((t) => [
    t.data, t.tipo === 'spesa' ? 'Spesa' : t.tipo === 'entrata' ? 'Entrata' : 'Giroconto', formatPlain(t.tipo === 'spesa' ? -t.importo : t.importo), acc.get(t.contoId) ?? '', t.contoA ? acc.get(t.contoA) ?? '' : '',
    cat.get(t.categoriaId) ?? '', mem.get(t.membroId) ?? '', safeText(t.descrizione), safeText(t.note), safeText((t.tag ?? []).join(' ')),
  ])];
}

/** Testo del riepilogo di un periodo, da condividere (WhatsApp, e-mail). */
export function monthSummaryText(state, period, { currency = 'EUR' } = {}) {
  const s = summarize(state, period.from, period.to);
  const cat = new Map(state.categorie.map((k) => [k.id, k]));
  const fmt = (c) => formatAmount(c, { currency });
  const lines = [`📒 ${state.famiglia.nome} — ${period.label}`, `Entrate: ${fmt(s.entrate)}`, `Uscite: ${fmt(s.uscite)}`, `Risparmio: ${fmt(s.saldo)}`];
  if (s.perCategoria.length) {
    lines.push('', 'Dove sono andati i soldi:');
    for (const c of s.perCategoria.slice(0, 8)) lines.push(`${cat.get(c.categoriaId)?.emoji ?? '🧾'} ${cat.get(c.categoriaId)?.nome ?? 'Senza categoria'}: ${fmt(c.totale)} (${String(c.percento).replace('.', ',')}%)`);
  }
  lines.push('', `Dal ${formatDate(period.from, 'long')} al ${formatDate(period.to, 'long')}`);
  return lines.join('\n');
}
