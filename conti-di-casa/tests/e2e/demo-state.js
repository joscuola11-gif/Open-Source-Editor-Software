// Famiglia di prova con qualche mese di movimenti, per le prove nel browser e per guardare l'interfaccia.

import { COLORS, createState, setIdGenerator } from '../../src/core/model.js';
import { addTransaction } from '../../src/core/ledger.js';
import { addAccount, addContribution, addMember, setBudget, upsert } from '../../src/core/ops.js';
import { addDays, addMonths, toISO } from '../../src/core/dates.js';
import { equalSplit } from '../../src/core/splits.js';

export function demoState(today = '2026-11-20') {
  let n = 0;
  setIdGenerator((p) => `${p}${String(++n).padStart(5, '0')}`);
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const now = Date.parse(`${today}T08:00:00Z`);
  const s = createState({ nome: 'Famiglia Rossi', membro: 'Maria', now });
  const maria = s.membri[0];
  const luca = addMember(s, { nome: 'Luca', emoji: '👨', colore: COLORS[4] }, now);
  const cash = s.conti.find((c) => c.tipo === 'contanti');
  const bank = s.conti.find((c) => c.tipo === 'corrente');
  bank.saldoIniziale = 185000;
  cash.saldoIniziale = 12000;
  const card = addAccount(s, { nome: 'Carta Luca', tipo: 'carta', saldoIniziale: 0, membroId: luca.id }, now);
  const save = addAccount(s, { nome: 'Risparmi', tipo: 'risparmio', saldoIniziale: 520000 }, now);
  const cat = (name) => s.categorie.find((k) => k.nome === name).id;
  const month0 = `${today.slice(0, 7)}-01`;
  let t = 0;
  const add = (tx) => addTransaction(s, { descrizione: '', ...tx }, now + (t++));
  for (let m = -3; m <= 0; m++) {
    const first = addMonths(month0, m);
    const [y, mo] = first.split('-').map(Number);
    const day = (d) => toISO(y, mo, d);
    const limit = (d) => day(d) <= today;
    if (limit(27)) add({ tipo: 'entrata', data: day(27), importo: 214000, contoId: bank.id, categoriaId: cat('Stipendio'), membroId: maria.id, descrizione: 'Stipendio Maria' });
    if (limit(10)) add({ tipo: 'entrata', data: day(10), importo: 96000, contoId: bank.id, categoriaId: cat('Stipendio'), membroId: luca.id, descrizione: 'Stipendio Luca' });
    if (limit(5)) add({ tipo: 'spesa', data: day(5), importo: 65000, contoId: bank.id, categoriaId: cat('Casa'), membroId: maria.id, descrizione: 'Affitto' });
    if (limit(12)) add({ tipo: 'spesa', data: day(12), importo: 8400 + Math.round(rnd() * 3000), contoId: bank.id, categoriaId: cat('Bollette'), descrizione: 'Enel energia', membroId: luca.id });
    if (limit(8)) add({ tipo: 'spesa', data: day(8), importo: 1299, contoId: card.id, categoriaId: cat('Abbonamenti'), descrizione: 'Netflix', membroId: luca.id });
    for (let d = 2; d <= 28; d += 3) {
      if (!limit(d)) continue;
      add({ tipo: 'spesa', data: day(d), importo: 2500 + Math.round(rnd() * 9000), contoId: d % 2 ? card.id : cash.id, categoriaId: cat('Spesa alimentare'), descrizione: d % 2 ? 'Esselunga' : 'Mercato', membroId: d % 2 ? luca.id : maria.id });
    }
    for (let d = 4; d <= 28; d += 9) if (limit(d)) add({ tipo: 'spesa', data: day(d), importo: 4000 + Math.round(rnd() * 3500), contoId: card.id, categoriaId: cat('Carburante'), descrizione: 'Distributore Q8', membroId: luca.id });
    if (limit(15)) add({ tipo: 'spesa', data: day(15), importo: 6200, contoId: card.id, categoriaId: cat('Ristoranti e bar'), descrizione: 'Pizzeria da Gino', membroId: luca.id, divisione: equalSplit(6200, [maria.id, luca.id], luca.id) });
    if (limit(20)) add({ tipo: 'spesa', data: day(20), importo: 3900, contoId: cash.id, categoriaId: cat('Svago'), descrizione: 'Cinema', membroId: maria.id });
    if (limit(28)) add({ tipo: 'giroconto', data: day(28), importo: 30000, contoId: bank.id, contoA: save.id, descrizione: 'Risparmio del mese' });
  }
  setBudget(s, cat('Spesa alimentare'), 40000, now);
  setBudget(s, cat('Ristoranti e bar'), 12000, now);
  setBudget(s, cat('Svago'), 3500, now);
  setBudget(s, cat('Carburante'), 20000, now);
  upsert(s, 'ricorrenze', { nome: 'Affitto', tipo: 'spesa', importo: 65000, contoId: bank.id, categoriaId: cat('Casa'), ogni: 1, unita: 'mesi', inizio: addMonths(`${today.slice(0, 7)}-05`, -3), fine: null, ultima: `${today.slice(0, 7)}-05`, autoRegistra: false, avvisoGiorni: 3, attiva: true }, now);
  upsert(s, 'ricorrenze', { nome: 'Assicurazione auto', tipo: 'spesa', importo: 41000, contoId: bank.id, categoriaId: cat('Assicurazioni'), ogni: 6, unita: 'mesi', inizio: addDays(today, -1), fine: null, ultima: null, autoRegistra: false, avvisoGiorni: 7, attiva: true }, now);
  upsert(s, 'ricorrenze', { nome: 'Palestra', tipo: 'spesa', importo: 3500, contoId: card.id, categoriaId: cat('Salute'), ogni: 1, unita: 'mesi', inizio: addDays(today, 2), fine: null, ultima: null, autoRegistra: false, avvisoGiorni: 3, attiva: true }, now);
  const g = upsert(s, 'obiettivi', { nome: 'Vacanze in Sardegna', emoji: '🏖️', importo: 200000, scadenza: addDays(today, 200), versamenti: [] }, now);
  addContribution(s, g.id, { data: addDays(today, -40), importo: 50000 }, now);
  addContribution(s, g.id, { data: addDays(today, -8), importo: 30000, membroId: maria.id }, now);
  upsert(s, 'regole', { contiene: 'distributore', categoriaId: cat('Carburante') }, now);
  setIdGenerator(null);
  return s;
}
