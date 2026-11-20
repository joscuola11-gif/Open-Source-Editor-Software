// Il libro dei conti: saldi, movimenti, giroconti, rettifiche. Le funzioni che cambiano lo stato lo modificano sul posto e restituiscono l'elemento.

import { TX_TYPES, alive, byId, newId, touch } from './model.js';
import { clone } from './clone.js';
import { isValidISO } from './dates.js';

/** Cosa fa un movimento ai conti: [{contoId, delta}]. */
export function txEffect(tx) {
  if (tx.x) return [];
  if (tx.tipo === 'spesa') return [{ contoId: tx.contoId, delta: -tx.importo }];
  if (tx.tipo === 'entrata') return [{ contoId: tx.contoId, delta: tx.importo }];
  return [{ contoId: tx.contoId, delta: -tx.importo }, { contoId: tx.contoA, delta: tx.importo }];
}

/** Saldo di ogni conto (anche archiviato) alla data `upTo` compresa (o oggi e oltre se null). */
export function balances(state, { upTo = null } = {}) {
  const out = new Map();
  for (const c of state.conti) if (!c.x) out.set(c.id, c.saldoIniziale);
  for (const tx of state.movimenti) {
    if (tx.x || (upTo && tx.data > upTo)) continue;
    for (const { contoId, delta } of txEffect(tx)) if (out.has(contoId)) out.set(contoId, out.get(contoId) + delta);
  }
  return out;
}

export const accountBalance = (state, contoId, opts) => balances(state, opts).get(contoId) ?? 0;

/** Patrimonio: somma dei conti che contano nel totale. */
export function netWorth(state, opts) {
  const b = balances(state, opts);
  let total = 0;
  for (const c of alive(state.conti)) if (c.nelTotale) total += b.get(c.id) ?? 0;
  return total;
}

/** Problemi di un movimento (testi in italiano). Vuoto = a posto. */
export function validateTx(state, tx) {
  const e = [];
  if (!TX_TYPES.includes(tx.tipo)) e.push('Scegli se è una spesa, un’entrata o un giroconto.');
  if (!Number.isInteger(tx.importo) || tx.importo <= 0) e.push('L’importo deve essere maggiore di zero.');
  if (!isValidISO(tx.data)) e.push('La data non è valida.');
  if (!byId(state.conti, tx.contoId)) e.push('Scegli il conto.');
  if (tx.tipo === 'giroconto') {
    if (!byId(state.conti, tx.contoA)) e.push('Scegli il conto di destinazione.');
    else if (tx.contoA === tx.contoId) e.push('Il conto di partenza e quello di arrivo devono essere diversi.');
  } else if (tx.categoriaId) {
    const k = byId(state.categorie, tx.categoriaId);
    if (!k) e.push('La categoria non esiste.');
    else if (k.tipo !== tx.tipo) e.push(tx.tipo === 'spesa' ? 'Questa categoria è per le entrate.' : 'Questa categoria è per le spese.');
  }
  if (tx.membroId && !byId(state.membri, tx.membroId)) e.push('Il membro della famiglia non esiste.');
  if (tx.divisione) {
    const sum = tx.divisione.quote.reduce((s, q) => s + q.importo, 0);
    if (tx.tipo !== 'spesa') e.push('Solo le spese si possono dividere.');
    else if (sum !== tx.importo) e.push('Le quote della divisione devono sommare esattamente l’importo.');
    else if (!byId(state.membri, tx.divisione.pagatoDa) || tx.divisione.quote.some((q) => !byId(state.membri, q.membroId))) e.push('La divisione usa un membro che non esiste.');
  }
  return e;
}

const clean = (tx) => {
  const t = { ...tx };
  if (t.tipo === 'giroconto') {
    delete t.categoriaId;
    delete t.divisione;
  } else delete t.contoA;
  for (const k of ['categoriaId', 'membroId', 'contoA', 'ricorrenteId']) if (t[k] === '' || t[k] == null) delete t[k];
  for (const k of Object.keys(t)) if (t[k] === undefined || t[k] === null) delete t[k]; // «togliere» un campo = passarlo null/undefined
  if (Array.isArray(t.tag) && !t.tag.length) delete t.tag;
  t.descrizione = (t.descrizione ?? '').trim();
  t.note = (t.note ?? '').trim();
  return t;
};

export function addTransaction(state, tx, now = Date.now()) {
  const t = clean({ ...tx, id: tx.id ?? newId('t') });
  const errors = validateTx(state, t);
  if (errors.length) throw new Error(errors[0]);
  t.u = now;
  state.movimenti.push(t);
  return t;
}

export function updateTransaction(state, id, patch, now = Date.now()) {
  const old = state.movimenti.find((m) => m.id === id && !m.x);
  if (!old) throw new Error('Movimento non trovato.');
  const t = clean({ ...old, ...patch, id });
  const errors = validateTx(state, t);
  if (errors.length) throw new Error(errors[0]);
  Object.keys(old).forEach((k) => delete old[k]);
  Object.assign(old, t);
  touch(old, now);
  return old;
}

/** Cancella (resta come «cancellato» per poter unire i dati di altri telefoni). */
export function removeTransaction(state, id, now = Date.now()) {
  const t = state.movimenti.find((m) => m.id === id && !m.x);
  if (!t) return null;
  t.x = true;
  touch(t, now);
  return t;
}

export function restoreTransaction(state, id, now = Date.now()) {
  const t = state.movimenti.find((m) => m.id === id && m.x);
  if (!t) return null;
  delete t.x;
  touch(t, now);
  return t;
}

export function duplicateTransaction(state, id, { data, now = Date.now() } = {}) {
  const t = state.movimenti.find((m) => m.id === id && !m.x);
  if (!t) throw new Error('Movimento non trovato.');
  const copy = { ...clone(t), id: newId('t') };
  delete copy.ricorrenteId;
  delete copy.x;
  if (data) copy.data = data;
  return addTransaction(state, copy, now);
}

/**
 * «Il saldo vero è X»: aggiunge una rettifica (entrata o spesa) pari alla differenza, che non conta nelle statistiche.
 * @returns {object|null} il movimento creato, o null se il saldo era già giusto
 */
export function adjustBalance(state, contoId, newBalance, { data, now = Date.now(), membroId } = {}) {
  const current = accountBalance(state, contoId);
  const diff = newBalance - current;
  if (diff === 0) return null;
  return addTransaction(state, { tipo: diff > 0 ? 'entrata' : 'spesa', data, importo: Math.abs(diff), contoId, descrizione: 'Rettifica del saldo', rettifica: true, ...(membroId ? { membroId } : {}) }, now);
}

// ---- elenchi e ricerca --------------------------------------------------------------------------------------------

export const transactions = (state) => state.movimenti.filter((m) => !m.x);

/** Ordine del libro: dal più recente; a parità di giorno, l'ultimo inserito (per `u`) prima. */
export function sortedTransactions(state) {
  return transactions(state).sort((a, b) => (a.data === b.data ? b.u - a.u || (a.id < b.id ? 1 : -1) : a.data < b.data ? 1 : -1));
}

/**
 * Filtra i movimenti. `q` cerca nel testo (descrizione, note, categoria, conto, membro, tag, importo scritto).
 * @param {{q?: string, tipo?: string, categorie?: string[], conti?: string[], membri?: string[], from?: string, to?: string, min?: number, max?: number, senzaRettifiche?: boolean}} f
 */
export function filterTransactions(state, f = {}) {
  const q = (f.q ?? '').trim().toLowerCase();
  const cat = new Map(state.categorie.map((k) => [k.id, k.nome.toLowerCase()]));
  const acc = new Map(state.conti.map((c) => [c.id, c.nome.toLowerCase()]));
  const mem = new Map(state.membri.map((m) => [m.id, m.nome.toLowerCase()]));
  const words = q ? q.split(/\s+/) : [];
  return sortedTransactions(state).filter((t) => {
    if (f.tipo && t.tipo !== f.tipo) return false;
    if (f.categorie?.length && !f.categorie.includes(t.categoriaId ?? '')) return false;
    if (f.conti?.length && !f.conti.includes(t.contoId) && !(t.contoA && f.conti.includes(t.contoA))) return false;
    if (f.membri?.length && !f.membri.includes(t.membroId ?? '')) return false;
    if (f.from && t.data < f.from) return false;
    if (f.to && t.data > f.to) return false;
    if (f.min != null && t.importo < f.min) return false;
    if (f.max != null && t.importo > f.max) return false;
    if (f.senzaRettifiche && t.rettifica) return false;
    if (words.length) {
      const hay = [t.descrizione, t.note, cat.get(t.categoriaId), acc.get(t.contoId), acc.get(t.contoA), mem.get(t.membroId), ...(t.tag ?? []), (t.importo / 100).toFixed(2), (t.importo / 100).toFixed(2).replace('.', ',')].filter(Boolean).join(' ').toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}
