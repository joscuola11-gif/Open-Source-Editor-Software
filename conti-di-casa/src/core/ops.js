// Operazioni sugli elenchi (membri, conti, categorie, budget, ricorrenze, obiettivi, regolamenti, regole) con le regole che tengono i dati coerenti.

import { ACCOUNT_TYPES, COLORS, alive, byId, newId, touch } from './model.js';
import { addTransaction } from './ledger.js';

const COLLECTIONS = ['membri', 'conti', 'categorie', 'budget', 'ricorrenze', 'obiettivi', 'regolamenti', 'regole'];
const PREFIX = { membri: 'm', conti: 'c', categorie: 'k', budget: 'b', ricorrenze: 'r', obiettivi: 'o', regolamenti: 'g', regole: 'e' };

/** Aggiunge (senza id) o aggiorna (con id) un elemento di un elenco. */
export function upsert(state, key, input, now = Date.now()) {
  if (!COLLECTIONS.includes(key)) throw new Error(`Elenco sconosciuto: ${key}`);
  const rec = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)); // niente campi «indefiniti»
  const list = state[key];
  const found = rec.id ? list.find((x) => x.id === rec.id) : null;
  if (found) {
    Object.assign(found, rec);
    delete found.x;
    return touch(found, now);
  }
  const item = { ...rec, id: rec.id ?? newId(PREFIX[key]) };
  list.push(touch(item, now));
  return item;
}

function tombstone(state, key, id, now) {
  const it = state[key].find((x) => x.id === id && !x.x);
  if (!it) return null;
  it.x = true;
  return touch(it, now);
}

const usedBy = (state, test) => state.movimenti.some((m) => !m.x && test(m));

export function addMember(state, { nome, colore, emoji }, now) {
  if (!nome?.trim()) throw new Error('Scrivi il nome.');
  return upsert(state, 'membri', { nome: nome.trim(), colore: colore ?? COLORS[state.membri.length % COLORS.length], emoji: emoji || '🙂', archiviato: false }, now);
}

/** Un membro già usato non si cancella (si perderebbero i conti fra i membri): si può nascondere. */
export function removeMember(state, id, now) {
  if (alive(state.membri).filter((m) => !m.archiviato).length <= 1 && !byId(state.membri, id)?.archiviato) throw new Error('Deve restare almeno un membro.');
  const used = usedBy(state, (m) => m.membroId === id || m.divisione?.pagatoDa === id || m.divisione?.quote.some((q) => q.membroId === id))
    || state.regolamenti.some((g) => !g.x && (g.da === id || g.a === id)) || state.conti.some((c) => !c.x && c.membroId === id);
  if (used) throw new Error('Questo membro compare nei movimenti: puoi nasconderlo invece di cancellarlo.');
  return tombstone(state, 'membri', id, now);
}

export function archiveMember(state, id, archived = true, now) {
  const m = byId(state.membri, id);
  if (!m) throw new Error('Membro non trovato.');
  if (archived && alive(state.membri).filter((x) => !x.archiviato && x.id !== id).length === 0) throw new Error('Deve restare almeno un membro.');
  m.archiviato = archived;
  return touch(m, now);
}

export function addAccount(state, { nome, tipo = 'altro', saldoIniziale = 0, emoji, colore, nelTotale = true, membroId = null }, now) {
  if (!nome?.trim()) throw new Error('Scrivi il nome del conto.');
  if (alive(state.conti).some((c) => c.nome.toLowerCase() === nome.trim().toLowerCase())) throw new Error('Esiste già un conto con questo nome.');
  return upsert(state, 'conti', { nome: nome.trim(), tipo, saldoIniziale, emoji: emoji || ACCOUNT_TYPES[tipo]?.emoji || '👛', colore: colore ?? COLORS[state.conti.length % COLORS.length], archiviato: false, nelTotale, membroId }, now);
}

export function removeAccount(state, id, now) {
  if (usedBy(state, (m) => m.contoId === id || m.contoA === id) || state.ricorrenze.some((r) => !r.x && (r.contoId === id || r.contoA === id))) {
    throw new Error('Il conto ha dei movimenti: puoi archiviarlo invece di cancellarlo.');
  }
  return tombstone(state, 'conti', id, now);
}

export function archiveAccount(state, id, archived = true, now) {
  const c = byId(state.conti, id);
  if (!c) throw new Error('Conto non trovato.');
  c.archiviato = archived;
  return touch(c, now);
}

export function addCategory(state, { nome, tipo, emoji, colore }, now) {
  if (!nome?.trim()) throw new Error('Scrivi il nome della categoria.');
  if (alive(state.categorie).some((k) => k.tipo === tipo && k.nome.toLowerCase() === nome.trim().toLowerCase())) throw new Error('Esiste già una categoria con questo nome.');
  return upsert(state, 'categorie', { nome: nome.trim(), tipo, emoji: emoji || '🧾', colore: colore ?? COLORS[state.categorie.length % COLORS.length], archiviata: false }, now);
}

/** Cancella una categoria: i movimenti passano a `reassignTo` (o restano senza categoria), i suoi budget e le sue regole spariscono. */
export function removeCategory(state, id, { reassignTo = null, now } = {}) {
  const k = byId(state.categorie, id);
  if (!k) return null;
  if (reassignTo) {
    const dest = byId(state.categorie, reassignTo);
    if (!dest || dest.tipo !== k.tipo || dest.id === id) throw new Error('La categoria di destinazione non va bene.');
  }
  for (const m of state.movimenti) if (!m.x && m.categoriaId === id) {
    if (reassignTo) m.categoriaId = reassignTo;
    else delete m.categoriaId;
    touch(m, now);
  }
  for (const r of state.ricorrenze) if (!r.x && r.categoriaId === id) {
    if (reassignTo) r.categoriaId = reassignTo;
    else delete r.categoriaId;
    touch(r, now);
  }
  for (const b of state.budget) if (!b.x && b.categoriaId === id) tombstone(state, 'budget', b.id, now);
  for (const g of state.regole) if (!g.x && g.categoriaId === id) {
    if (reassignTo) {
      g.categoriaId = reassignTo;
      touch(g, now);
    } else tombstone(state, 'regole', g.id, now);
  }
  return tombstone(state, 'categorie', id, now);
}

/** Limite mensile di una categoria (0 = nessun limite). */
export function setBudget(state, categoriaId, importo, now) {
  const k = byId(state.categorie, categoriaId);
  if (!k || k.tipo !== 'spesa') throw new Error('Il budget si imposta sulle categorie di spesa.');
  const cur = state.budget.find((b) => !b.x && b.categoriaId === categoriaId);
  if (!(importo > 0)) return cur ? tombstone(state, 'budget', cur.id, now) : null;
  return upsert(state, 'budget', { id: cur?.id, categoriaId, importo }, now);
}

export function removeItem(state, key, id, now) {
  if (!COLLECTIONS.includes(key)) throw new Error(`Elenco sconosciuto: ${key}`);
  return tombstone(state, key, id, now);
}

// ---- obiettivi di risparmio ---------------------------------------------------------------------------------------

export function addContribution(state, goalId, { data, importo, membroId }, now) {
  const g = byId(state.obiettivi, goalId);
  if (!g) throw new Error('Obiettivo non trovato.');
  if (!Number.isInteger(importo) || importo === 0) throw new Error('Scrivi quanto metti da parte.');
  const v = { id: newId('v'), data, importo, ...(membroId ? { membroId } : {}) };
  g.versamenti.push(v);
  touch(g, now);
  return v;
}

export function removeContribution(state, goalId, contributionId, now) {
  const g = byId(state.obiettivi, goalId);
  if (!g) return null;
  const i = g.versamenti.findIndex((v) => v.id === contributionId);
  if (i < 0) return null;
  const [v] = g.versamenti.splice(i, 1);
  touch(g, now);
  return v;
}

/** Un movimento qualunque a partire da una ricorrenza (usato quando scade). */
export function transactionFromRecurring(state, rec, data, now) {
  return addTransaction(state, {
    tipo: rec.tipo, data, importo: rec.importo, contoId: rec.contoId, ...(rec.contoA ? { contoA: rec.contoA } : {}), ...(rec.categoriaId ? { categoriaId: rec.categoriaId } : {}),
    ...(rec.membroId ? { membroId: rec.membroId } : {}), descrizione: rec.nome, ricorrenteId: rec.id,
  }, now);
}
