// Spese ed entrate che si ripetono (affitto, bollette, abbonamenti, stipendio): scadenze e registrazione automatica.

import { addDays, addMonths, diffDays } from './dates.js';
import { alive } from './model.js';
import { transactionFromRecurring } from './ops.js';

const MAX_PER_RUN = 500;

/** La data della n-esima volta (0 = la prima). Mesi e anni si contano dall'inizio, così il 31 non «scivola» al 28 per sempre. */
export function occurrenceDate(rec, n) {
  switch (rec.unita) {
    case 'giorni': return addDays(rec.inizio, n * rec.ogni);
    case 'settimane': return addDays(rec.inizio, n * rec.ogni * 7);
    case 'anni': return addMonths(rec.inizio, n * rec.ogni * 12);
    default: return addMonths(rec.inizio, n * rec.ogni);
  }
}

/** Tutte le date della ricorrenza dentro [from, to] (compresi), rispettando l'inizio e l'eventuale fine. */
export function occurrences(rec, from, to) {
  const end = rec.fine && rec.fine < to ? rec.fine : to;
  const out = [];
  for (let n = 0; n < 5000; n++) {
    const d = occurrenceDate(rec, n);
    if (d > end) break;
    if (d >= from) out.push(d);
  }
  return out;
}

const registered = (state, rec) => new Set(state.movimenti.filter((m) => !m.x && m.ricorrenteId === rec.id).map((m) => m.data));

/** Le scadenze arrivate (fino a `today`) e non ancora registrate. */
export function dueDates(state, rec, today) {
  if (!rec.attiva || rec.x) return [];
  const done = registered(state, rec);
  const from = rec.ultima ? addDays(rec.ultima, 1) : rec.inizio;
  return occurrences(rec, from, today).filter((d) => !done.has(d));
}

/** Registra tutte le scadenze arrivate delle ricorrenze con «registra da sola». Sicuro da ripetere: non crea mai due volte lo stesso movimento. */
export function generateDue(state, today, now = Date.now()) {
  const created = [];
  for (const rec of alive(state.ricorrenze)) {
    if (!rec.autoRegistra) continue;
    for (const d of dueDates(state, rec, today)) {
      if (created.length >= MAX_PER_RUN) return created;
      created.push(transactionFromRecurring(state, rec, d, now));
      rec.ultima = d;
    }
    rec.u = Math.max(rec.u, now);
  }
  return created;
}

/** Registra a mano una scadenza («Pagata»). */
export function registerOccurrence(state, recId, date, now = Date.now()) {
  const rec = state.ricorrenze.find((r) => r.id === recId && !r.x);
  if (!rec) throw new Error('Ricorrenza non trovata.');
  if (registered(state, rec).has(date)) throw new Error('Questa scadenza è già registrata.');
  const tx = transactionFromRecurring(state, rec, date, now);
  if (!rec.ultima || date > rec.ultima) {
    // si avanza solo se non restano scadenze precedenti da registrare
    const earlier = dueDates(state, rec, addDays(date, -1));
    if (!earlier.length) rec.ultima = date;
  }
  rec.u = Math.max(rec.u, now);
  return tx;
}

/** Salta una scadenza senza registrarla (es. bolletta non arrivata). */
export function skipOccurrence(state, recId, date, now = Date.now()) {
  const rec = state.ricorrenze.find((r) => r.id === recId && !r.x);
  if (!rec) throw new Error('Ricorrenza non trovata.');
  if (!rec.ultima || date > rec.ultima) rec.ultima = date;
  rec.u = Math.max(rec.u, now);
  return rec;
}

/**
 * Cosa sta per scadere o è scaduto: [{ricorrenza, data, giorni (negativo = in ritardo), stato: 'scaduta'|'oggi'|'presto'}].
 * Le ricorrenze «registra da sola» compaiono solo per il futuro.
 */
export function upcoming(state, today, days = 14) {
  const out = [];
  const limit = addDays(today, days);
  for (const rec of alive(state.ricorrenze)) {
    if (!rec.attiva) continue;
    const done = registered(state, rec);
    const from = rec.ultima ? addDays(rec.ultima, 1) : rec.inizio;
    for (const d of occurrences(rec, from, limit)) {
      if (done.has(d)) continue;
      const giorni = diffDays(d, today);
      if (giorni < 0 && rec.autoRegistra) continue;
      out.push({ ricorrenza: rec, data: d, giorni, stato: giorni < 0 ? 'scaduta' : giorni === 0 ? 'oggi' : 'presto' });
    }
  }
  return out.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

/** Quanto si spende in un mese fra tutte le ricorrenze di spesa attive (stima, in centesimi al mese). */
export function monthlyCommitment(state) {
  let total = 0;
  for (const r of alive(state.ricorrenze)) {
    if (!r.attiva || r.tipo !== 'spesa') continue;
    const perMonth = { giorni: 30.4375 / r.ogni, settimane: 30.4375 / (7 * r.ogni), mesi: 1 / r.ogni, anni: 1 / (12 * r.ogni) }[r.unita];
    total += Math.round(r.importo * perMonth);
  }
  return total;
}
