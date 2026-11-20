// CSV, importazione degli estratti conto, categoria automatica, unione fra telefoni, copie di sicurezza, PIN.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createState, setIdGenerator, alive } from '../../src/core/model.js';
import { addTransaction, removeTransaction, updateTransaction, balances } from '../../src/core/ledger.js';
import { addAccount, addCategory, addMember, upsert } from '../../src/core/ops.js';
import { detectSeparator, formatCsv, parseCsv, safeText } from '../../src/core/csv.js';
import { buildTransactions, detectMapping, hasHeader } from '../../src/core/importer.js';
import { suggestCategory, tokens } from '../../src/core/rules.js';
import { canonical, mergeStates } from '../../src/core/merge.js';
import { makeBackup, readBackup } from '../../src/core/backup.js';
import { hashPin, isValidPin, makeSalt, verifyPin } from '../../src/core/pin.js';
import { HEADER, monthSummaryText, transactionRows } from '../../src/core/export.js';
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

test('csv: scrittura e lettura (virgolette, ritorni a capo, separatori)', () => {
  const rows = [['Data', 'Descrizione', 'Importo'], ['2026-11-20', 'Pizza "da Mario"; con amici', '-12,50'], ['2026-11-21', 'riga1\nriga2', '3,00'], ['2026-11-22', '  spazi  ', '0,01']];
  const text = formatCsv(rows);
  assert.ok(text.startsWith('﻿'), 'BOM per Excel');
  assert.ok(text.includes('\r\n'));
  const back = parseCsv(text);
  assert.equal(back.sep, ';');
  assert.deepEqual(back.righe, rows);
  assert.equal(formatCsv([], { bom: false }), '');
  assert.deepEqual(parseCsv('a,b,c\n1,2,3\n\n4,5,6\n').righe, [['a', 'b', 'c'], ['1', '2', '3'], ['4', '5', '6']]);
  assert.deepEqual(parseCsv('a;b\r\n"x;y";"z""w"\r\n').righe, [['a', 'b'], ['x;y', 'z"w']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2').righe, [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('x|y\n1|2').righe, [['x', 'y'], ['1', '2']]);
  assert.deepEqual(parseCsv('').righe, []);
  assert.deepEqual(parseCsv('solo').righe, [['solo']]);
  assert.equal(detectSeparator('a;b;c\n1;2;3'), ';');
  assert.equal(detectSeparator('"a,b";c;d\n1;2;3'), ';', 'la virgola dentro le virgolette non conta');
  assert.equal(detectSeparator('a,b,c\n1,2,3'), ',');
  // casuale: qualunque testo sopravvive all'andata e ritorno
  const alphabet = ['a', 'B', ' ', ';', ',', '"', '\n', '\r\n', 'è', '€', '1', ''];
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = 0; k < 300; k++) {
    const data = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => Array.from({ length: 3 }, () => Array.from({ length: Math.floor(rnd() * 6) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('') || 'x'));
    const got = parseCsv(formatCsv(data), ';').righe;
    // gli spazi alle estremità e le righe vuote non sono significativi qui: confrontiamo dopo aver normalizzato i ritorni a capo
    const norm = (rr) => rr.map((r) => r.map((c) => c.replace(/\r\n/g, '\n').replace(/\r/g, '\n')));
    assert.deepEqual(norm(got), norm(data.filter((r) => r.some((c) => c.trim() !== ''))), JSON.stringify(data));
  }
});

test('csv: le formule di Excel nelle descrizioni vengono disinnescate', () => {
  assert.equal(safeText('=1+1'), "'=1+1");
  assert.equal(safeText('@SOMMA(A1)'), "'@SOMMA(A1)");
  assert.equal(safeText('+39 333'), "'+39 333");
  assert.equal(safeText('-cmd'), "'-cmd");
  assert.equal(safeText('-12,50'), '-12,50', 'un importo negativo resta un numero');
  assert.equal(safeText('Pizza'), 'Pizza');
  assert.equal(safeText(null), '');
});

test('esportazione: movimenti in righe e riepilogo del mese', () => {
  const { s, cash, bank, me, cat } = mk();
  addTransaction(s, { tipo: 'spesa', data: '2026-11-05', importo: 1250, contoId: cash.id, categoriaId: cat('Ristoranti e bar').id, membroId: me.id, descrizione: '=HYPERLINK("x")', tag: ['uscita', 'amici'] });
  addTransaction(s, { tipo: 'entrata', data: '2026-11-01', importo: 200000, contoId: bank.id, categoriaId: cat('Stipendio').id, descrizione: 'Stipendio' });
  addTransaction(s, { tipo: 'giroconto', data: '2026-11-03', importo: 5000, contoId: bank.id, contoA: cash.id });
  const rows = transactionRows(s);
  assert.deepEqual(rows[0], HEADER);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[1].slice(0, 3), ['2026-11-01', 'Entrata', '2000,00'], 'dal più vecchio');
  assert.deepEqual(rows[3].slice(0, 6), ['2026-11-05', 'Spesa', '-12,50', 'Contanti', '', 'Ristoranti e bar']);
  assert.equal(rows[3][7], "'=HYPERLINK(\"x\")");
  assert.deepEqual(rows[2].slice(1, 5), ['Giroconto', '50,00', 'Conto corrente', 'Contanti']);
  assert.equal(transactionRows(s, { from: '2026-11-04' }).length, 2);
  // andata e ritorno con l'importatore
  const parsed = parseCsv(formatCsv(rows));
  assert.deepEqual(parsed.righe, rows);
  const text = monthSummaryText(s, periodOf('2026-11-20'));
  assert.match(text, /^📒 La mia famiglia — Novembre 2026\nEntrate: 2\.000,00 €\nUscite: 12,50 €\nRisparmio: 1\.987,50 €/);
  assert.match(text, /🍽️ Ristoranti e bar: 12,50 € \(100%\)/);
  assert.match(text, /Dal 1 novembre 2026 al 30 novembre 2026$/);
});

test('importazione: intestazioni di banche diverse, segni, doppioni, errori', () => {
  assert.deepEqual(detectMapping(['Data operazione', 'Descrizione', 'Importo']), { data: 0, descrizione: 1, importo: 2 });
  assert.deepEqual(detectMapping(['Data', 'Causale', 'Dare', 'Avere', 'Saldo']), { data: 0, descrizione: 1, uscite: 2, entrate: 3 });
  assert.deepEqual(detectMapping(['Date', 'Description', 'Amount', 'Category']), { data: 0, descrizione: 1, importo: 2, categoria: 3 });
  assert.equal(hasHeader([['Data', 'Importo']]), true);
  assert.equal(hasHeader([['20/11/2026', '-5,00']]), false);
  assert.equal(hasHeader([['5,00', 'x']]), false);
  const { s, bank, cat } = mk();
  addTransaction(s, { tipo: 'spesa', data: '2026-11-18', importo: 4590, contoId: bank.id, categoriaId: cat('Spesa alimentare').id, descrizione: 'ESSELUNGA MILANO' });
  addTransaction(s, { tipo: 'spesa', data: '2026-11-02', importo: 6000, contoId: bank.id, categoriaId: cat('Carburante').id, descrizione: 'ENI STATION' });
  const rows = [
    ['20/11/2026', 'PAGAMENTO POS ESSELUNGA 123 MILANO', '-45,90'],
    ['18/11/2026', 'ESSELUNGA MILANO', '-45,90'],
    ['19/11/2026', 'ACCREDITO STIPENDIO', '1.850,00'],
    ['17/11/2026', 'ENI STATION VIA ROMA', '-55,00'],
    ['boh', 'DATA ROTTA', '-1,00'],
    ['16/11/2026', 'IMPORTO ROTTO', 'abc'],
    ['15/11/2026', 'CAFFE', '-1,20'],
    ['15/11/2026', 'CAFFE', '-1,20'],
  ];
  const r = buildTransactions(rows, { data: 0, descrizione: 1, importo: 2 }, { state: s, contoId: bank.id, today: '2026-11-21' });
  assert.deepEqual(r.errori.map((e) => e.riga), [5, 6]);
  assert.match(r.errori[0].motivo, /Data non valida/);
  assert.equal(r.voci.length, 6);
  assert.deepEqual(r.voci.map((v) => [v.tx.tipo, v.tx.importo, v.doppione]), [['spesa', 4590, false], ['spesa', 4590, true], ['entrata', 185000, false], ['spesa', 5500, false], ['spesa', 120, false], ['spesa', 120, false]]);
  assert.equal(r.voci[0].tx.categoriaId, cat('Spesa alimentare').id, 'categoria proposta dallo storico');
  assert.equal(r.voci[3].tx.categoriaId, cat('Carburante').id);
  assert.equal(r.voci[2].tx.categoriaId, undefined, 'nessuna idea: lasciata vuota');
  assert.equal(r.voci[4].doppione, false, 'due caffè uguali nello stesso estratto sono due caffè');
  // dare/avere in colonne separate
  const r2 = buildTransactions([['01/11/2026', 'Bolletta', '80,00', ''], ['02/11/2026', 'Rimborso', '', '25,50']], { data: 0, descrizione: 1, uscite: 2, entrate: 3 }, { state: s, contoId: bank.id });
  assert.deepEqual(r2.voci.map((v) => [v.tx.tipo, v.tx.importo]), [['spesa', 8000], ['entrata', 2550]]);
  // segno invertito (carte di credito)
  const r3 = buildTransactions([['01/11/2026', 'Acquisto', '30,00']], { data: 0, descrizione: 1, importo: 2 }, { state: s, contoId: bank.id, invertSign: true });
  assert.equal(r3.voci[0].tx.tipo, 'spesa');
  // colonna categoria con il nome di una categoria esistente
  const r4 = buildTransactions([['01/11/2026', 'x', '-10', 'Casa']], { data: 0, descrizione: 1, importo: 2, categoria: 3 }, { state: s, contoId: bank.id });
  assert.equal(r4.voci[0].tx.categoriaId, cat('Casa').id);
  // le voci importate sono tutte valide per il libro
  for (const v of [...r.voci, ...r2.voci]) assert.doesNotThrow(() => addTransaction(s, v.tx), JSON.stringify(v.tx));
});

test('categoria automatica: regole dell’utente e storico', () => {
  const { s, bank, cat } = mk();
  const T = (d, k, text) => addTransaction(s, { tipo: 'spesa', data: d, importo: 1000, contoId: bank.id, categoriaId: cat(k).id, descrizione: text });
  T('2026-10-01', 'Spesa alimentare', 'Esselunga via Torino');
  T('2026-10-05', 'Spesa alimentare', 'Esselunga viale Monza');
  T('2026-10-07', 'Carburante', 'Eni station');
  T('2026-10-09', 'Bollette', 'Enel energia luce');
  T('2026-10-11', 'Bollette', 'Enel energia gas');
  assert.deepEqual(tokens('PAGAMENTO POS Esselunga 123 Milano'), ['esselunga', 'milano']);
  assert.equal(suggestCategory(s, 'Esselunga via Torino').categoriaId, cat('Spesa alimentare').id);
  assert.equal(suggestCategory(s, 'Esselunga via Torino').confidenza, 1);
  assert.equal(suggestCategory(s, 'ESSELUNGA Roma').categoriaId, cat('Spesa alimentare').id, 'riconosce la parola');
  assert.equal(suggestCategory(s, 'Enel energia').categoriaId, cat('Bollette').id);
  assert.equal(suggestCategory(s, 'Negozio sconosciuto'), null);
  assert.equal(suggestCategory(s, ''), null);
  assert.equal(suggestCategory(s, 'Esselunga', 'entrata'), null, 'una entrata non prende categorie di spesa');
  // una regola scritta dall'utente vince sullo storico
  upsert(s, 'regole', { contiene: 'esselunga', categoriaId: cat('Casa').id });
  const r = suggestCategory(s, 'Esselunga via Torino');
  assert.deepEqual([r.categoriaId, r.fonte], [cat('Casa').id, 'regola']);
  // se la regola punta a una categoria di altro tipo non vale
  upsert(s, 'regole', { contiene: 'stipendio', categoriaId: cat('Casa').id });
  assert.equal(suggestCategory(s, 'Stipendio novembre', 'entrata'), null);
});

// ---- unione fra telefoni -------------------------------------------------------------------------------------------

function twoPhones() {
  const base = createState({ now: 1000 });
  const a = structuredClone(base);
  const b = structuredClone(base);
  return { base, a, b };
}

test('unione: ognuno aggiunge, tutti vedono tutto; ripeterla non cambia nulla', () => {
  const { a, b } = twoPhones();
  const cat = (s, nome) => s.categorie.find((k) => k.nome === nome);
  addTransaction(a, { tipo: 'spesa', data: '2026-11-05', importo: 1000, contoId: a.conti[0].id, categoriaId: cat(a, 'Casa').id, descrizione: 'dal telefono A' }, 2000);
  addTransaction(b, { tipo: 'spesa', data: '2026-11-06', importo: 2000, contoId: b.conti[0].id, categoriaId: cat(b, 'Casa').id, descrizione: 'dal telefono B' }, 2100);
  const ab = mergeStates(a, b);
  const ba = mergeStates(b, a);
  assert.deepEqual(canonical(ab.stato), canonical(ba.stato), 'A+B = B+A');
  assert.equal(alive(ab.stato.movimenti).length, 2);
  assert.deepEqual(ab.riepilogo, { aggiunti: 1, aggiornati: 0, cancellati: 0, ripristinati: 0 });
  const again = mergeStates(ab.stato, b);
  assert.deepEqual(canonical(again.stato), canonical(ab.stato), 'idempotente');
  assert.deepEqual(again.riepilogo, { aggiunti: 0, aggiornati: 0, cancellati: 0, ripristinati: 0 });
});

test('unione: vince la modifica più recente; una cancellazione più recente vince', () => {
  const { a, b } = twoPhones();
  const k = a.categorie.find((x) => x.nome === 'Casa');
  const tx = addTransaction(a, { tipo: 'spesa', data: '2026-11-05', importo: 1000, contoId: a.conti[0].id, categoriaId: k.id, descrizione: 'originale' }, 2000);
  const b0 = mergeStates(b, a).stato;
  const a1 = structuredClone(a);
  const b1 = structuredClone(b0);
  updateTransaction(a1, tx.id, { descrizione: 'modificata su A', importo: 1500 }, 3000);
  updateTransaction(b1, tx.id, { descrizione: 'modificata su B' }, 4000);
  const m = mergeStates(a1, b1).stato;
  assert.equal(alive(m.movimenti)[0].descrizione, 'modificata su B', 'B è più recente');
  assert.equal(alive(m.movimenti)[0].importo, 1000, 'la modifica più recente sostituisce tutto l’elemento, non si mescolano i campi');
  assert.deepEqual(canonical(mergeStates(b1, a1).stato), canonical(m));
  // cancellazione su A più recente della modifica su B
  const a2 = structuredClone(a);
  removeTransaction(a2, tx.id, 5000);
  const r = mergeStates(b1, a2);
  assert.equal(alive(r.stato.movimenti).length, 0);
  assert.equal(r.riepilogo.cancellati, 1);
  // modifica su B più recente della cancellazione su A: torna
  const b3 = structuredClone(b0);
  updateTransaction(b3, tx.id, { descrizione: 'risorta' }, 6000);
  const r2 = mergeStates(a2, b3);
  assert.equal(alive(r2.stato.movimenti).length, 1);
  assert.equal(r2.riepilogo.ripristinati, 1);
});

test('unione: il PIN e il blocco restano quelli di questo telefono', () => {
  const { a, b } = twoPhones();
  a.impostazioni.pinHash = 'aa'.repeat(32);
  a.impostazioni.pinSalt = 'bb'.repeat(16);
  a.impostazioni.u = 100;
  b.impostazioni.pinHash = 'cc'.repeat(32);
  b.impostazioni.valuta = 'USD';
  b.impostazioni.u = 200;
  const m = mergeStates(a, b).stato;
  assert.equal(m.impostazioni.pinHash, 'aa'.repeat(32));
  assert.equal(m.impostazioni.valuta, 'USD', 'la valuta più recente vale');
});

test('unione: proprietà su moltissimi casi casuali (commutativa, idempotente, associativa)', () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  for (let round = 0; round < 60; round++) {
    const base = createState({ now: 1 });
    const phones = [structuredClone(base), structuredClone(base), structuredClone(base)];
    let clock = 10;
    for (let step = 0; step < 25; step++) {
      const p = pick(phones);
      clock += 1 + Math.floor(rnd() * 3);
      const r = rnd();
      const live = alive(p.movimenti);
      try {
        if (r < 0.5 || !live.length) addTransaction(p, { tipo: pick(['spesa', 'entrata']), data: `2026-11-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`, importo: 100 * (1 + Math.floor(rnd() * 50)), contoId: pick(p.conti).id, descrizione: `m${step}` }, clock);
        else if (r < 0.75) updateTransaction(p, pick(live).id, { importo: 100 * (1 + Math.floor(rnd() * 50)) }, clock);
        else if (r < 0.9) removeTransaction(p, pick(live).id, clock);
        else upsert(p, 'categorie', { nome: `Cat${step}`, tipo: 'spesa', emoji: '🧾', colore: '#e4572e', archiviata: false }, clock);
      } catch { /* qualche modifica può non valere: va bene */ }
      if (rnd() < 0.2) {
        const q = pick(phones);
        if (q !== p) Object.assign(q, structuredClone(mergeStates(q, p).stato));
      }
    }
    const [A, B, C] = phones;
    const c = (x) => canonical(x);
    assert.deepEqual(c(mergeStates(A, B).stato), c(mergeStates(B, A).stato), 'commutativa');
    assert.deepEqual(c(mergeStates(mergeStates(A, B).stato, C).stato), c(mergeStates(A, mergeStates(B, C).stato).stato), 'associativa');
    const ab = mergeStates(A, B).stato;
    assert.deepEqual(c(mergeStates(ab, ab).stato), c(ab), 'idempotente');
    assert.deepEqual(c(mergeStates(ab, A).stato), c(ab), 'riunire ciò che c’è già non cambia nulla');
    // dopo l'unione tutti i saldi sono calcolabili e finiti
    for (const v of balances(ab).values()) assert.ok(Number.isSafeInteger(v));
  }
});

// ---- copie di sicurezza e PIN --------------------------------------------------------------------------------------

test('copia di sicurezza: andata e ritorno e file sbagliati', () => {
  const { s, cash, cat } = mk();
  addMember(s, { nome: 'Anna' });
  addAccount(s, { nome: 'Libretto', tipo: 'risparmio', saldoIniziale: 50000 });
  addCategory(s, { nome: 'Giardino', tipo: 'spesa' });
  addTransaction(s, { tipo: 'spesa', data: '2026-11-05', importo: 777, contoId: cash.id, categoriaId: cat('Casa').id, descrizione: 'perché è così' });
  const text = makeBackup(s, new Date('2026-11-20T10:00:00Z'));
  const { stato, info } = readBackup(text);
  assert.deepEqual(canonical(stato), canonical(s));
  assert.deepEqual(info, { esportato: '2026-11-20T10:00:00.000Z', movimenti: 1, conti: 3, membri: 2 });
  assert.deepEqual(canonical(readBackup(`﻿${text}`).stato), canonical(s), 'con il BOM');
  assert.deepEqual(canonical(readBackup(JSON.stringify(s)).stato), canonical(s), 'anche lo stato nudo');
  assert.throws(() => readBackup('non è json'), /non si legge/);
  assert.throws(() => readBackup('{"ciao": 1}'), /non è una copia/);
  assert.throws(() => readBackup('[]'), /non è una copia/);
  assert.throws(() => readBackup(JSON.stringify({ app: 'conti-di-casa', versione: 99, dati: {} })), /versione più nuova/);
});

test('PIN: impronta, verifica, cifre valide', async () => {
  assert.ok(isValidPin('1234') && isValidPin('12345678'));
  for (const bad of ['123', '123456789', 'abcd', '12 34', '', null, 1234]) assert.equal(isValidPin(bad), false);
  const salt = makeSalt();
  assert.match(salt, /^[0-9a-f]{32}$/);
  assert.notEqual(makeSalt(), salt);
  const h = await hashPin('4821', salt);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(await hashPin('4821', salt), h, 'stesso PIN e sale: stessa impronta');
  assert.notEqual(await hashPin('4821', makeSalt()), h, 'un altro sale cambia l’impronta');
  assert.ok(!h.includes('4821'));
  assert.equal(await verifyPin('4821', salt, h), true);
  assert.equal(await verifyPin('4822', salt, h), false);
  assert.equal(await verifyPin('', salt, h), false);
  assert.equal(await verifyPin('4821', salt, ''), false);
  await assert.rejects(hashPin('12', salt), /4 a 8 cifre/);
  await assert.rejects(hashPin('1234', salt, null), /non permette/);
});
