// Una riga di movimento (per Home, Movimenti, Conto).

import { row, fmt } from './kit.js';
import { byId } from '../core/model.js';

export function txTitle(state, t) {
  if (t.rettifica) return 'Correzione del saldo';
  if (t.descrizione) return t.descrizione;
  if (t.tipo === 'giroconto') return 'Giroconto';
  return byId(state.categorie, t.categoriaId)?.nome ?? (t.tipo === 'spesa' ? 'Spesa' : 'Entrata');
}

/** `ctx`: id del conto che si sta guardando (per i giroconti: in entrata o in uscita). */
export function txRow(state, t, { onClick, contoId = null, showAccount = true } = {}) {
  const k = byId(state.categorie, t.categoriaId);
  const conto = byId(state.conti, t.contoId);
  const arrivo = t.contoA ? byId(state.conti, t.contoA) : null;
  const mem = t.membroId ? byId(state.membri, t.membroId) : null;
  let right;
  let tone;
  let icon = k?.emoji ?? (t.tipo === 'spesa' ? '🧾' : '💰');
  let color = k?.colore;
  if (t.tipo === 'giroconto') {
    icon = '⇄';
    color = '#5c6b73';
    if (contoId && t.contoA === contoId) { right = fmt(t.importo, { sign: true }); tone = 'pos'; }
    else if (contoId && t.contoId === contoId) { right = fmt(-t.importo); tone = 'neg'; }
    else { right = fmt(t.importo); tone = 'transfer'; }
  } else if (t.tipo === 'spesa') { right = fmt(-t.importo); tone = 'neg'; } else { right = fmt(t.importo, { sign: true }); tone = 'pos'; }
  if (t.rettifica) { icon = '⚖️'; color = '#5c6b73'; }
  const parts = [];
  if (t.tipo === 'giroconto') parts.push(`${conto?.nome ?? '?'} → ${arrivo?.nome ?? '?'}`);
  else {
    parts.push(k?.nome ?? 'Senza categoria');
    if (showAccount && conto) parts.push(conto.nome);
  }
  if (mem && state.membri.filter((m) => !m.x && !m.archiviato).length > 1) parts.push(mem.nome);
  if (t.divisione) parts.push('👥 divisa');
  if (t.ricorrenteId) parts.push('🔁');
  return row({ icon, color, title: txTitle(state, t), subtitle: parts.join(' · '), right, tone, onClick });
}
