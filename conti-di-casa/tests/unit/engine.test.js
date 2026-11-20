// Il nucleo dei conti: saldi, giroconti, movimenti, categorie, budget, ricorrenze, divisioni, obiettivi.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createState, sanitizeState, setIdGenerator, alive, byId } from '../../src/core/model.js';
import { accountBalance, addTransaction, adjustBalance, balances, duplicateTransaction, filterTransactions, netWorth, removeTransaction, restoreTransaction, sortedTransactions, updateTransaction, validateTx } from '../../src/core/ledger.js';
import { addAccount, addCategory, addContribution, addMember, archiveAccount, archiveMember, removeAccount, removeCategory, removeContribution, removeMember, setBudget, upsert } from '../../src/core/ops.js';
import { summarize, periodSeries, compareWithPrevious, projection, topExpenses, dailyAverage } from '../../src/core/stats.js';
import { budgetState, budgetStatus } from '../../src/core/budgets.js';
import { dueDates, generateDue, monthlyCommitment, occurrenceDate, occurrences, registerOccurrence, skipOccurrence, upcoming } from '../../src/core/recurring.js';
import { equalSplit, memberBalances, settlements, weightedSplit } from '../../src/core/splits.js';
import { goalProgress } from '../../src/core/goals.js';
import { periodOf } from '../../src/core/periods.js';

let n = 0;
beforeEach(() => {
  n = 0;
  setIdGenerator((p) => `${p}${++n}`);
});

const mk = () => {
  const s = createState({ now: 1000 });
  return { s, cash: s.conti[0], bank: s.conti[1], me: s.membri[0], cat: (nome) => s.categorie.find((k) => k.nome === nome) };
};

test('saldi: spese, entrate e giroconti; il totale cambia solo con spese ed entrate', () => {
  const { s, cash, bank, cat } = mk();
  cash.saldoIniziale = 5000;
  bank.saldoIniziale = 100000;
  assert.equal(netWorth(s), 105000);
  addTransaction(s, { tipo: 'spesa', data: '2026-11-01', importo: 1250, contoId: cash.id, categoriaId: cat('Spesa alimentare').id });
  addTransaction(s, { tipo: 'entrata', data: '2026-11-02', importo: 200000, contoId: bank.id, categoriaId: cat('Stipendio').id });
  assert.equal(accountBalance(s, cash.id), 3750);
  assert.equal(accountBalance(s, bank.id), 300000);
  assert.equal(netWorth(s), 303750);
  addTransaction(s, { tipo: 'giroconto', data: '2026-11-03', importo: 50000, contoId: bank.id, contoA: cash.id });
  assert.equal(accountBalance(s, cash.id), 53750);
  assert.equal(accountBalance(s, bank.id), 250000);
  assert.equal(netWorth(s), 303750, 'un giroconto non cambia il patrimonio');
  // saldo a una certa data
  assert.equal(accountBalance(s, cash.id, { upTo: '2026-11-01' }), 3750);
  assert.equal(accountBalance(s, cash.id, { upTo: '2026-10-31' }), 5000);
  // un conto fuori dal totale non conta
  bank.nelTotale = false;
  assert.equal(netWorth(s), 53750);
  assert.equal(balances(s).size, 2);
});

test('movimenti: controlli, modifica, cancellazione e ripristino', () => {
  const { s, cash, bank, me, cat } = mk();
  const bad = (tx, re) => assert.throws(() => addTransaction(s, tx), re);
  bad({ tipo: 'spesa', data: '2026-11-01', importo: 0, contoId: cash.id }, /maggiore di zero/);
  bad({ tipo: 'spesa', data: '2026-11-01', importo: -5, contoId: cash.id }, /maggiore di zero/);
  bad({ tipo: 'spesa', data: '2026-11-01', importo: 1.5, contoId: cash.id }, /maggiore di zero/);
  bad({ tipo: 'spesa', data: '2026-02-30', importo: 5, contoId: cash.id }, /data/);
  bad({ tipo: 'spesa', data: '2026-11-01', importo: 5, contoId: 'nope' }, /conto/);
  bad({ tipo: 'boh', data: '2026-11-01', importo: 5, contoId: cash.id }, /spesa, un’entrata/);
  bad({ tipo: 'giroconto', data: '2026-11-01', importo: 5, contoId: cash.id, contoA: cash.id }, /diversi/);
  bad({ tipo: 'giroconto', data: '2026-11-01', importo: 5, contoId: cash.id }, /destinazione/);
  bad({ tipo: 'spesa', data: '2026-11-01', importo: 5, contoId: cash.id, categoriaId: cat('Stipendio').id }, /per le entrate/);
  bad({ tipo: 'entrata', data: '2026-11-01', importo: 5, contoId: cash.id, categoriaId: cat('Casa').id }, /per le spese/);
  bad({ tipo: 'spesa', data: '2026-11-01', importo: 5, contoId: cash.id, membroId: 'fantasma' }, /membro/);
  assert.equal(s.movimenti.length, 0, 'nulla è stato aggiunto');
  const t = addTransaction(s, { tipo: 'spesa', data: '2026-11-05', importo: 999, contoId: cash.id, categoriaId: cat('Casa').id, membroId: me.id, descrizione: '  Idraulico ' }, 5000);
  assert.equal(t.descrizione, 'Idraulico');
  assert.equal(t.u, 5000);
  updateTransaction(s, t.id, { importo: 1999, contoId: bank.id }, 6000);
  assert.equal(accountBalance(s, cash.id), 0);
  assert.equal(accountBalance(s, bank.id), -1999);
  assert.equal(byId(s.movimenti, t.id).u, 6000);
  assert.throws(() => updateTransaction(s, t.id, { importo: 0 }), /maggiore di zero/);
  assert.equal(byId(s.movimenti, t.id).importo, 1999, 'una modifica rifiutata non cambia nulla');
  // da spesa a giroconto: la categoria sparisce
  updateTransaction(s, t.id, { tipo: 'giroconto', contoA: cash.id });
  assert.equal(byId(s.movimenti, t.id).categoriaId, undefined);
  removeTransaction(s, t.id, 7000);
  assert.equal(alive(s.movimenti).length, 0);
  assert.equal(accountBalance(s, bank.id), 0, 'cancellato = non conta');
  assert.equal(s.movimenti[0].x, true, 'resta come cancellato (serve a unire i dati)');
  restoreTransaction(s, t.id, 8000);
  assert.equal(alive(s.movimenti).length, 1);
  assert.equal(removeTransaction(s, 'nope'), null);
  const copy = duplicateTransaction(s, t.id, { data: '2026-11-10' });
  assert.notEqual(copy.id, t.id);
  assert.equal(copy.data, '2026-11-10');
  assert.equal(validateTx(s, copy).length, 0);
});

test('rettifica del saldo: il saldo diventa quello vero senza falsare le statistiche', () => {
  const { s, bank } = mk();
  bank.saldoIniziale = 10000;
  const r = adjustBalance(s, bank.id, 12345, { data: '2026-11-20' });
  assert.equal(r.tipo, 'entrata');
  assert.equal(r.importo, 2345);
  assert.equal(accountBalance(s, bank.id), 12345);
  const r2 = adjustBalance(s, bank.id, 10000, { data: '2026-11-21' });
  assert.equal(r2.tipo, 'spesa');
  assert.equal(accountBalance(s, bank.id), 10000);
  assert.equal(adjustBalance(s, bank.id, 10000, { data: '2026-11-22' }), null, 'già giusto');
  const sum = summarize(s, '2026-11-01', '2026-11-30');
  assert.deepEqual([sum.entrate, sum.uscite, sum.movimenti], [0, 0, 0]);
});

test('elenchi: ordine e ricerca', () => {
  const { s, cash, bank, me, cat } = mk();
  const a = addTransaction(s, { tipo: 'spesa', data: '2026-11-05', importo: 1250, contoId: cash.id, categoriaId: cat('Ristoranti e bar').id, descrizione: 'Pizzeria Da Mario', membroId: me.id }, 10);
  const b = addTransaction(s, { tipo: 'spesa', data: '2026-11-05', importo: 4000, contoId: bank.id, categoriaId: cat('Carburante').id, descrizione: 'Benzina', tag: ['auto'] }, 20);
  const c = addTransaction(s, { tipo: 'entrata', data: '2026-11-10', importo: 150000, contoId: bank.id, categoriaId: cat('Stipendio').id, descrizione: 'Stipendio novembre' }, 30);
  assert.deepEqual(sortedTransactions(s).map((t) => t.id), [c.id, b.id, a.id], 'dal più recente; a parità di giorno l’ultimo inserito prima');
  const ids = (f) => filterTransactions(s, f).map((t) => t.id);
  assert.deepEqual(ids({ q: 'pizz' }), [a.id]);
  assert.deepEqual(ids({ q: 'BENZINA' }), [b.id]);
  assert.deepEqual(ids({ q: 'auto' }), [b.id], 'anche nei tag');
  assert.deepEqual(ids({ q: 'carburante' }), [b.id], 'anche nel nome della categoria');
  assert.deepEqual(ids({ q: '12,50' }), [a.id], 'anche l’importo scritto');
  assert.deepEqual(ids({ q: 'stipendio 1500' }), [c.id], 'più parole: tutte');
  assert.deepEqual(ids({ tipo: 'spesa' }), [b.id, a.id]);
  assert.deepEqual(ids({ conti: [cash.id] }), [a.id]);
  assert.deepEqual(ids({ membri: [me.id] }), [a.id]);
  assert.deepEqual(ids({ from: '2026-11-06' }), [c.id]);
  assert.deepEqual(ids({ to: '2026-11-05', min: 2000 }), [b.id]);
  assert.deepEqual(ids({ categorie: [cat('Stipendio').id] }), [c.id]);
  assert.deepEqual(ids({ q: 'zzz' }), []);
});

test('regole su conti, categorie e membri: non si perde nulla', () => {
  const { s, cash, bank, me, cat } = mk();
  const t = addTransaction(s, { tipo: 'spesa', data: '2026-11-05', importo: 100, contoId: cash.id, categoriaId: cat('Casa').id, membroId: me.id });
  assert.throws(() => removeAccount(s, cash.id), /archiviarlo/);
  archiveAccount(s, cash.id);
  assert.equal(byId(s.conti, cash.id).archiviato, true);
  assert.equal(accountBalance(s, cash.id), -100, 'un conto archiviato tiene i suoi saldi');
  const empty = addAccount(s, { nome: 'Vecchio libretto', tipo: 'risparmio' });
  assert.throws(() => addAccount(s, { nome: 'vecchio LIBRETTO' }), /già un conto/);
  assert.throws(() => addAccount(s, { nome: '  ' }), /nome/);
  removeAccount(s, empty.id);
  assert.equal(alive(s.conti).some((c) => c.id === empty.id), false);
  // categorie
  assert.throws(() => addCategory(s, { nome: 'casa', tipo: 'spesa' }), /già una categoria/);
  const nuova = addCategory(s, { nome: 'Giardino', tipo: 'spesa', emoji: '🌳' });
  setBudget(s, cat('Casa').id, 50000);
  updateTransaction(s, t.id, { categoriaId: cat('Casa').id });
  assert.throws(() => removeCategory(s, cat('Casa').id, { reassignTo: cat('Stipendio').id }), /destinazione/, 'non si sposta da spesa a entrata');
  removeCategory(s, cat('Casa').id, { reassignTo: nuova.id });
  assert.equal(byId(s.movimenti, t.id).categoriaId, nuova.id);
  assert.equal(alive(s.budget).length, 0, 'il budget della categoria cancellata sparisce');
  removeCategory(s, nuova.id);
  assert.equal(byId(s.movimenti, t.id).categoriaId, undefined, 'senza destinazione: senza categoria');
  // membri
  const anna = addMember(s, { nome: 'Anna' });
  assert.throws(() => removeMember(s, me.id), /compare nei movimenti/);
  archiveMember(s, me.id);
  assert.throws(() => archiveMember(s, anna.id), /almeno un membro/);
  const solo = createState({ now: 1 });
  assert.throws(() => removeMember(solo, solo.membri[0].id), /almeno un membro/);
  assert.throws(() => removeMember(s, anna.id), /almeno un membro/, 'è l’unico attivo');
  archiveMember(s, me.id, false);
  removeMember(s, anna.id);
  assert.equal(alive(s.membri).length, 1);
  void bank;
});

test('statistiche: totali, categorie, membri e periodi', () => {
  const { s, cash, bank, me, cat } = mk();
  const anna = addMember(s, { nome: 'Anna' });
  const T = (tipo, data, importo, conto, k, m) => addTransaction(s, { tipo, data, importo, contoId: conto.id, categoriaId: k ? cat(k).id : undefined, membroId: m?.id });
  T('spesa', '2026-11-02', 10000, cash, 'Spesa alimentare', me);
  T('spesa', '2026-11-09', 5000, cash, 'Spesa alimentare', anna);
  T('spesa', '2026-11-10', 20000, bank, 'Casa', me);
  T('spesa', '2026-11-15', 5000, bank, undefined, me);
  T('entrata', '2026-11-01', 300000, bank, 'Stipendio', me);
  T('spesa', '2026-10-05', 7000, bank, 'Casa', me);
  addTransaction(s, { tipo: 'giroconto', data: '2026-11-04', importo: 99999, contoId: bank.id, contoA: cash.id });
  const sum = summarize(s, '2026-11-01', '2026-11-30');
  assert.deepEqual([sum.entrate, sum.uscite, sum.saldo, sum.movimenti], [300000, 40000, 260000, 5]);
  assert.deepEqual(sum.perCategoria.map((c) => [c.categoriaId, c.totale, c.percento]), [[cat('Casa').id, 20000, 50], [cat('Spesa alimentare').id, 15000, 37.5], [null, 5000, 12.5]]);
  assert.deepEqual(sum.perMembro.map((m) => [m.membroId, m.totale]), [[me.id, 35000], [anna.id, 5000]]);
  assert.deepEqual(sum.perConto.map((c) => [c.contoId, c.totale]), [[bank.id, 25000], [cash.id, 15000]]);
  assert.equal(sum.perGiorno.get('2026-11-10').uscite, 20000);
  assert.equal(summarize(s, '2026-11-01', '2026-11-30', { membri: [anna.id] }).uscite, 5000);
  assert.equal(summarize(s, '2026-11-01', '2026-11-30', { conti: [cash.id] }).uscite, 15000);
  assert.equal(summarize(s, '2027-01-01', '2027-01-31').movimenti, 0);
  const series = periodSeries(s, '2026-11-20', 3);
  assert.deepEqual(series.map((x) => [x.periodo.key, x.entrate, x.uscite]), [['2026-09-01', 0, 0], ['2026-10-01', 0, 7000], ['2026-11-01', 300000, 40000]]);
  const cmp = compareWithPrevious(s, '2026-11-20');
  assert.equal(cmp.uscite.delta, 33000);
  assert.equal(cmp.uscite.percento, 471.4);
  assert.equal(compareWithPrevious(s, '2026-10-20').uscite.percento, null, 'prima era zero');
  assert.deepEqual(topExpenses(s, '2026-11-01', '2026-11-30', 2).map((t) => t.importo), [20000, 10000]);
  assert.equal(dailyAverage(s, '2026-11-01', '2026-11-30', '2026-11-20'), 2000);
  assert.equal(projection(40000, 20, 30), 60000);
  assert.equal(projection(0, 0, 30), 0);
});

test('budget: percentuali, stati e quanto resta al giorno', () => {
  const { s, cash, cat } = mk();
  assert.equal(budgetState(79.9), 'ok');
  assert.equal(budgetState(80), 'attenzione');
  assert.equal(budgetState(100), 'superato');
  assert.throws(() => setBudget(s, cat('Stipendio').id, 100), /categorie di spesa/);
  setBudget(s, cat('Spesa alimentare').id, 40000);
  setBudget(s, cat('Svago').id, 10000);
  const T = (data, importo, k) => addTransaction(s, { tipo: 'spesa', data, importo, contoId: cash.id, categoriaId: cat(k).id });
  T('2026-11-03', 25000, 'Spesa alimentare');
  T('2026-11-12', 8500, 'Svago');
  T('2026-11-13', 3000, 'Casa');
  T('2026-10-13', 99999, 'Spesa alimentare');
  const st = budgetStatus(s, periodOf('2026-11-20'), '2026-11-20');
  assert.deepEqual(st.righe.map((r) => [r.categoriaId === cat('Svago').id ? 'svago' : 'spesa', r.speso, r.percento, r.stato]), [['svago', 8500, 85, 'attenzione'], ['spesa', 25000, 62.5, 'ok']]);
  assert.equal(st.righe[1].rimanente, 15000);
  assert.equal(st.giorniRestanti, 11, 'dal 20 al 30 novembre compreso');
  assert.equal(st.righe[1].alGiorno, Math.floor(15000 / 11));
  assert.deepEqual([st.totale.limite, st.totale.speso, st.totale.rimanente], [50000, 33500, 16500]);
  assert.equal(st.senzaBudget, 3000, 'la spesa fuori budget si vede lo stesso');
  T('2026-11-14', 20000, 'Spesa alimentare');
  const over = budgetStatus(s, periodOf('2026-11-20'), '2026-11-20').righe.find((r) => r.categoriaId === cat('Spesa alimentare').id);
  assert.equal(over.stato, 'superato');
  assert.equal(over.alGiorno, 0);
  setBudget(s, cat('Svago').id, 0);
  assert.equal(budgetStatus(s, periodOf('2026-11-20'), '2026-11-20').righe.length, 1, 'limite zero = tolto');
  assert.equal(alive(s.budget).length, 1);
});

test('ricorrenze: scadenze, registrazione automatica senza duplicati, saltare', () => {
  const { s, bank, cat } = mk();
  const aff = upsert(s, 'ricorrenze', { nome: 'Affitto', tipo: 'spesa', importo: 70000, contoId: bank.id, categoriaId: cat('Casa').id, ogni: 1, unita: 'mesi', inizio: '2026-08-31', fine: null, ultima: null, autoRegistra: true, avvisoGiorni: 3, attiva: true });
  assert.equal(occurrenceDate(aff, 0), '2026-08-31');
  assert.equal(occurrenceDate(aff, 1), '2026-09-30');
  assert.equal(occurrenceDate(aff, 2), '2026-10-31', 'il 31 non scivola al 30 per sempre');
  assert.equal(occurrenceDate(aff, 6), '2027-02-28');
  assert.deepEqual(occurrences(aff, '2026-09-01', '2026-11-30'), ['2026-09-30', '2026-10-31', '2026-11-30']);
  assert.deepEqual(dueDates(s, aff, '2026-11-15'), ['2026-08-31', '2026-09-30', '2026-10-31']);
  const made = generateDue(s, '2026-11-15', 5000);
  assert.equal(made.length, 3);
  assert.deepEqual(made.map((t) => [t.data, t.importo, t.descrizione, t.ricorrenteId === aff.id]), [['2026-08-31', 70000, 'Affitto', true], ['2026-09-30', 70000, 'Affitto', true], ['2026-10-31', 70000, 'Affitto', true]]);
  assert.equal(generateDue(s, '2026-11-15').length, 0, 'ripeterlo non crea doppioni');
  assert.equal(generateDue(s, '2026-11-30').length, 1);
  assert.equal(accountBalance(s, bank.id), -280000);
  // senza «registra da sola»: compare tra le scadenze
  const bol = upsert(s, 'ricorrenze', { nome: 'Luce', tipo: 'spesa', importo: 9000, contoId: bank.id, categoriaId: cat('Bollette').id, ogni: 2, unita: 'mesi', inizio: '2026-10-20', fine: null, ultima: null, autoRegistra: false, avvisoGiorni: 5, attiva: true });
  let up = upcoming(s, '2026-11-18', 30).filter((u) => u.ricorrenza.id === bol.id);
  assert.deepEqual(up.map((u) => [u.data, u.giorni, u.stato]), [['2026-10-20', -29, 'scaduta'], ['2026-12-20', 32 - 30 + 0, 'presto']].slice(0, 1), 'solo ottobre è scaduta, dicembre è oltre 30 giorni');
  registerOccurrence(s, bol.id, '2026-10-20');
  assert.throws(() => registerOccurrence(s, bol.id, '2026-10-20'), /già registrata/);
  up = upcoming(s, '2026-12-18', 7).filter((u) => u.ricorrenza.id === bol.id);
  assert.deepEqual(up.map((u) => [u.data, u.stato]), [['2026-12-20', 'presto']]);
  skipOccurrence(s, bol.id, '2026-12-20');
  assert.equal(upcoming(s, '2026-12-18', 7).filter((u) => u.ricorrenza.id === bol.id).length, 0, 'saltata = non compare più');
  // le automatiche compaiono solo per il futuro
  assert.ok(upcoming(s, '2026-12-25', 10).some((u) => u.ricorrenza.id === aff.id && u.data === '2026-12-31' && u.stato === 'presto'));
  assert.ok(!upcoming(s, '2026-12-25', 10).some((u) => u.ricorrenza.id === aff.id && u.data < '2026-12-25'), 'quelle già registrate o passate non compaiono');
  // fine e pausa
  aff.fine = '2026-12-31';
  assert.deepEqual(occurrences(aff, '2026-12-01', '2027-03-01'), ['2026-12-31']);
  aff.attiva = false;
  assert.deepEqual(dueDates(s, aff, '2030-01-01'), []);
  assert.equal(monthlyCommitment(s), 9000 / 2, 'solo le attive: la luce ogni 2 mesi');
});

test('ricorrenze: settimane, giorni, anni', () => {
  const { s, cash } = mk();
  const w = upsert(s, 'ricorrenze', { nome: 'Paghetta', tipo: 'spesa', importo: 1000, contoId: cash.id, ogni: 1, unita: 'settimane', inizio: '2026-11-06', fine: null, ultima: null, autoRegistra: true, avvisoGiorni: 0, attiva: true });
  assert.deepEqual(occurrences(w, '2026-11-01', '2026-11-30'), ['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27']);
  const d = { ...w, unita: 'giorni', ogni: 10 };
  assert.deepEqual(occurrences(d, '2026-11-01', '2026-12-01'), ['2026-11-06', '2026-11-16', '2026-11-26']);
  const y = { ...w, unita: 'anni', ogni: 1, inizio: '2024-02-29' };
  assert.deepEqual(occurrences(y, '2024-01-01', '2027-12-31'), ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28']);
});

test('divisione delle spese e «chi deve a chi»', () => {
  const { s, cash, me } = mk();
  const anna = addMember(s, { nome: 'Anna' });
  const luca = addMember(s, { nome: 'Luca' });
  const all = [me.id, anna.id, luca.id];
  // pago 90 € io per tutti e tre
  addTransaction(s, { tipo: 'spesa', data: '2026-11-01', importo: 9000, contoId: cash.id, divisione: equalSplit(9000, all, me.id) });
  // Anna paga 10 € solo per sé e per Luca (non per me)
  addTransaction(s, { tipo: 'spesa', data: '2026-11-02', importo: 1000, contoId: cash.id, divisione: equalSplit(1000, [anna.id, luca.id], anna.id) });
  // 100 € in proporzione 50/30/20, pagati da Luca
  addTransaction(s, { tipo: 'spesa', data: '2026-11-03', importo: 10000, contoId: cash.id, divisione: weightedSplit(10000, [{ membroId: me.id, peso: 50 }, { membroId: anna.id, peso: 30 }, { membroId: luca.id, peso: 20 }], luca.id) });
  const net = memberBalances(s);
  assert.equal([...net.values()].reduce((a, b) => a + b, 0), 0, 'la somma dei saldi è sempre zero');
  assert.equal(net.get(me.id), 9000 - 3000 - 5000);
  assert.equal(net.get(anna.id), 1000 - 3000 - 500 - 3000);
  assert.equal(net.get(luca.id), 10000 - 3000 - 500 - 2000);
  const pay = settlements(net);
  assert.ok(pay.length <= 2, 'con tre persone bastano due pagamenti');
  // eseguendo i pagamenti proposti tutti tornano a zero
  const after = new Map(net);
  for (const p of pay) {
    after.set(p.da, after.get(p.da) + p.importo);
    after.set(p.a, after.get(p.a) - p.importo);
  }
  assert.ok([...after.values()].every((v) => v === 0));
  // registro un pagamento: i saldi si aggiornano
  const first = pay[0];
  upsert(s, 'regolamenti', { data: '2026-11-10', da: first.da, a: first.a, importo: first.importo, nota: '' });
  const net2 = memberBalances(s);
  assert.equal([...net2.values()].reduce((a, b) => a + b, 0), 0);
  assert.ok(settlements(net2).length < pay.length || pay.length === 1 || settlements(net2).length <= pay.length);
  // controlli
  assert.throws(() => addTransaction(s, { tipo: 'spesa', data: '2026-11-04', importo: 1000, contoId: cash.id, divisione: { pagatoDa: me.id, quote: [{ membroId: me.id, importo: 999 }] } }), /sommare esattamente/);
  assert.throws(() => addTransaction(s, { tipo: 'spesa', data: '2026-11-04', importo: 1000, contoId: cash.id, divisione: { pagatoDa: 'fantasma', quote: [{ membroId: me.id, importo: 1000 }] } }), /non esiste/);
  assert.throws(() => addTransaction(s, { tipo: 'entrata', data: '2026-11-04', importo: 1000, contoId: cash.id, divisione: equalSplit(1000, [me.id], me.id) }), /Solo le spese/);
  assert.deepEqual(settlements(new Map()), []);
  assert.deepEqual(settlements(new Map([['a', 0]])), []);
  // un membro già usato non si cancella
  assert.throws(() => removeMember(s, luca.id), /compare nei movimenti/);
});

test('obiettivi di risparmio', () => {
  const { s } = mk();
  const g = upsert(s, 'obiettivi', { nome: 'Vacanza', emoji: '🏖️', importo: 120000, scadenza: '2027-06-20', versamenti: [] });
  assert.deepEqual(goalProgress(g, '2026-11-20'), { versato: 0, mancante: 120000, percento: 0, stato: 'in corso', giorniMancanti: 212, alMese: Math.ceil(120000 / 7) });
  addContribution(s, g.id, { data: '2026-11-20', importo: 30000 });
  const v2 = addContribution(s, g.id, { data: '2026-11-21', importo: 10000 });
  let p = goalProgress(g, '2026-11-21');
  assert.deepEqual([p.versato, p.mancante, p.percento], [40000, 80000, 33.3]);
  removeContribution(s, g.id, v2.id);
  assert.equal(goalProgress(g, '2026-11-21').versato, 30000);
  addContribution(s, g.id, { data: '2026-12-01', importo: 100000 });
  p = goalProgress(g, '2026-12-01');
  assert.deepEqual([p.stato, p.mancante, p.alMese], ['raggiunto', 0, 0]);
  const late = upsert(s, 'obiettivi', { nome: 'Bici', importo: 50000, scadenza: '2026-10-01', versamenti: [] });
  assert.equal(goalProgress(late, '2026-11-20').stato, 'scaduto');
  const free = upsert(s, 'obiettivi', { nome: 'Fondo emergenze', importo: 500000, versamenti: [] });
  assert.equal(goalProgress(free, '2026-11-20').alMese, null);
  assert.throws(() => addContribution(s, g.id, { data: '2026-12-01', importo: 0 }), /quanto/);
  assert.throws(() => addContribution(s, 'nope', { data: '2026-12-01', importo: 5 }), /non trovato/);
  // prelievo (versamento negativo)
  addContribution(s, free.id, { data: '2026-12-02', importo: 10000 });
  addContribution(s, free.id, { data: '2026-12-03', importo: -4000 });
  assert.equal(goalProgress(free, '2026-12-03').versato, 6000);
});

test('dati: qualunque file sporco diventa uno stato valido, senza lanciare errori', () => {
  for (const junk of [null, undefined, 5, 'ciao', [], {}, { movimenti: 'x', conti: 5 }, { membri: [null, 3, {}], conti: [{}], movimenti: [{ tipo: 'spesa' }] }]) {
    const s = sanitizeState(junk);
    assert.ok(alive(s.membri).length >= 1, 'almeno un membro');
    assert.equal(s.versione, 1);
    assert.ok(Array.isArray(s.movimenti));
  }
  const { s, cash, cat } = mk();
  addTransaction(s, { tipo: 'spesa', data: '2026-11-05', importo: 500, contoId: cash.id, categoriaId: cat('Casa').id });
  const round = sanitizeState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(round, s, 'salvare e rileggere non cambia nulla');
  // elementi guasti scartati, il resto resta
  const raw = JSON.parse(JSON.stringify(s));
  raw.movimenti.push({ id: 'z', tipo: 'spesa', data: '2026-13-01', importo: 5, contoId: cash.id }, { id: 'y', tipo: 'spesa', data: '2026-11-01', importo: -5, contoId: cash.id }, { id: 'w', tipo: 'giroconto', data: '2026-11-01', importo: 5, contoId: cash.id, contoA: cash.id });
  raw.impostazioni.inizioMese = 99;
  raw.impostazioni.valuta = 'euro';
  raw.impostazioni.tema = 'viola';
  const clean = sanitizeState(raw);
  assert.equal(clean.movimenti.length, 1);
  assert.equal(clean.impostazioni.inizioMese, 28);
  assert.equal(clean.impostazioni.valuta, 'EUR');
  assert.equal(clean.impostazioni.tema, 'auto');
  // una divisione con somma sbagliata si scarta
  raw.movimenti[0].divisione = { pagatoDa: s.membri[0].id, quote: [{ membroId: s.membri[0].id, importo: 1 }] };
  assert.equal(sanitizeState(raw).movimenti[0].divisione, undefined);
});
