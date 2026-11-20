// Categoria automatica: dalla descrizione («Esselunga», «Enel energia») si indovina la categoria, prima con le regole dell'utente, poi con lo storico.

import { alive } from './model.js';

const STOP = new Set(['con', 'per', 'del', 'della', 'dello', 'dei', 'delle', 'the', 'and', 'srl', 'spa', 'snc', 'sas', 'pagamento', 'pagam', 'carta', 'addebito', 'bonifico', 'disposto', 'favore', 'data', 'ora', 'pos', 'acquisto', 'euro', 'eur', 'from', 'via', 'sede', 'italia', 'filiale']);

export function normalize(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function tokens(s) {
  return [...new Set(normalize(s).split(' ').filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !STOP.has(t)))];
}

/**
 * Suggerisce una categoria per una descrizione.
 * @returns {{categoriaId: string, fonte: 'regola'|'storico', confidenza: number}|null}
 */
export function suggestCategory(state, descrizione, tipo = 'spesa') {
  const text = normalize(descrizione);
  if (!text) return null;
  const valid = new Map(alive(state.categorie).filter((k) => k.tipo === tipo).map((k) => [k.id, k]));
  for (const r of alive(state.regole)) {
    if (valid.has(r.categoriaId) && text.includes(normalize(r.contiene))) return { categoriaId: r.categoriaId, fonte: 'regola', confidenza: 1 };
  }
  const past = state.movimenti.filter((t) => !t.x && t.tipo === tipo && t.categoriaId && valid.has(t.categoriaId) && t.descrizione && !t.rettifica);
  // descrizione identica: vince la categoria più usata
  const exact = new Map();
  for (const t of past) if (normalize(t.descrizione) === text) exact.set(t.categoriaId, (exact.get(t.categoriaId) ?? 0) + 1);
  if (exact.size) {
    const [id, n] = [...exact.entries()].sort((a, b) => b[1] - a[1])[0];
    const total = [...exact.values()].reduce((a, b) => a + b, 0);
    return { categoriaId: id, fonte: 'storico', confidenza: Math.round((n / total) * 100) / 100 };
  }
  // parole in comune: ogni parola «vota» per le categorie in cui è già comparsa
  const toks = tokens(descrizione);
  if (!toks.length) return null;
  const votes = new Map();
  for (const tok of toks) {
    const per = new Map();
    let total = 0;
    for (const t of past) if (tokens(t.descrizione).includes(tok)) {
      per.set(t.categoriaId, (per.get(t.categoriaId) ?? 0) + 1);
      total++;
    }
    if (total < 1) continue;
    for (const [id, n] of per) votes.set(id, (votes.get(id) ?? 0) + (n / total) * Math.min(1, total / 2 + 0.5));
  }
  if (!votes.size) return null;
  const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const sum = sorted.reduce((a, [, v]) => a + v, 0);
  const [id, v] = sorted[0];
  const conf = Math.round((v / sum) * 100) / 100;
  return conf >= 0.6 ? { categoriaId: id, fonte: 'storico', confidenza: conf } : null;
}
