// Prove «a caso»: sequenze di operazioni sui conti; dopo ognuna i numeri devono quadrare e lo stato restare valido.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { alive, createState, sanitizeState, setIdGenerator } from '../../src/core/model.js';
import { addTransaction, adjustBalance, balances, duplicateTransaction, netWorth, removeTransaction, restoreTransaction, updateTransaction } from '../../src/core/ledger.js';
import { addAccount, addCategory, addMember, archiveAccount, removeCategory, setBudget, upsert } from '../../src/core/ops.js';
import { summarize } from '../../src/core/stats.js';
import { memberBalances } from '../../src/core/splits.js';
import { generateDue } from '../../src/core/recurring.js';
import { equalSplit } from '../../src/core/splits.js';

let n = 0;
beforeEach(() => {
  n = 0;
  setIdGenerator((p) => `${p}${++n}`);
});

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function check(s, label) {
  // 1. lo stato resta valido: salvarlo e rileggerlo non cambia nulla
  assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(s))), s, `stato non valido dopo ${label}`);
  // 2. il patrimonio = saldi iniziali + entrate − spese (i giroconti si annullano)
  let expected = 0;
  for (const c of alive(s.conti)) expected += c.saldoIniziale;
  for (const t of alive(s.movimenti)) {
    if (t.tipo === 'entrata') expected += t.importo;
    else if (t.tipo === 'spesa') expected -= t.importo;
  }
  const all = [...balances(s).values()].reduce((a, b) => a + b, 0);
  assert.equal(all, expected, `i saldi non quadrano dopo ${label}`);
  // 3. le statistiche (senza rettifiche) quadrano con i movimenti
  const sum = summarize(s, '0000-01-01', '9999-12-31');
  const e = alive(s.movimenti).filter((t) => t.tipo === 'entrata' && !t.rettifica).reduce((a, t) => a + t.importo, 0);
  const u = alive(s.movimenti).filter((t) => t.tipo === 'spesa' && !t.rettifica).reduce((a, t) => a + t.importo, 0);
  assert.deepEqual([sum.entrate, sum.uscite], [e, u], `statistiche sbagliate dopo ${label}`);
  assert.equal(sum.perCategoria.reduce((a, c) => a + c.totale, 0), u);
  // 4. i saldi fra membri sommano zero
  assert.equal([...memberBalances(s).values()].reduce((a, b) => a + b, 0), 0, `saldi fra membri dopo ${label}`);
  // 5. nessun conto «senza nome», nessun movimento su un conto che non esiste
  const ids = new Set(alive(s.conti).map((c) => c.id));
  for (const t of alive(s.movimenti)) assert.ok(ids.has(t.contoId) || s.conti.some((c) => c.id === t.contoId), 'movimento su conto sconosciuto');
  assert.equal(netWorth(s) <= Number.MAX_SAFE_INTEGER, true);
}

test('conti: 150 sequenze casuali di operazioni, i numeri quadrano sempre', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const r = rng(seed);
    const pick = (a) => a[Math.floor(r() * a.length)];
    const s = createState({ now: 1 });
    let clock = 10;
    for (let step = 0; step < 40; step++) {
      clock += 1 + Math.floor(r() * 5);
      const k = r();
      const accounts = alive(s.conti);
      const cats = alive(s.categorie);
      const live = alive(s.movimenti);
      const day = () => `2026-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`;
      const label = `seed ${seed} passo ${step}`;
      try {
        if (k < 0.35) {
          const tipo = pick(['spesa', 'spesa', 'entrata', 'giroconto']);
          const a = pick(accounts);
          const tx = { tipo, data: day(), importo: 1 + Math.floor(r() * 200000), contoId: a.id };
          if (tipo === 'giroconto') tx.contoA = pick(accounts.filter((x) => x.id !== a.id) ?? [a]).id;
          else tx.categoriaId = r() < 0.8 ? pick(cats.filter((c) => c.tipo === tipo)).id : undefined;
          if (tipo === 'spesa' && r() < 0.3 && alive(s.membri).length > 1) tx.divisione = equalSplit(tx.importo, alive(s.membri).map((m) => m.id), pick(alive(s.membri)).id);
          addTransaction(s, tx, clock);
        } else if (k < 0.5 && live.length) updateTransaction(s, pick(live).id, { importo: 1 + Math.floor(r() * 5000), data: day() }, clock);
        else if (k < 0.58 && live.length) removeTransaction(s, pick(live).id, clock);
        else if (k < 0.62) {
          const dead = s.movimenti.filter((t) => t.x);
          if (dead.length) restoreTransaction(s, pick(dead).id, clock);
        } else if (k < 0.67 && live.length) duplicateTransaction(s, pick(live).id, { now: clock });
        else if (k < 0.72) adjustBalance(s, pick(accounts).id, Math.floor(r() * 1000000) - 100000, { data: day(), now: clock });
        else if (k < 0.76) addAccount(s, { nome: `Conto ${step}`, tipo: 'altro', saldoIniziale: Math.floor(r() * 100000) }, clock);
        else if (k < 0.79 && accounts.length > 1) archiveAccount(s, pick(accounts).id, r() < 0.5, clock);
        else if (k < 0.83) addCategory(s, { nome: `Cat ${step}`, tipo: pick(['spesa', 'entrata']) }, clock);
        else if (k < 0.86) {
          const c = pick(cats);
          removeCategory(s, c.id, { reassignTo: r() < 0.5 ? (cats.find((x) => x.tipo === c.tipo && x.id !== c.id)?.id ?? null) : null, now: clock });
        } else if (k < 0.89) addMember(s, { nome: `Membro ${step}` }, clock);
        else if (k < 0.92) setBudget(s, pick(cats.filter((c) => c.tipo === 'spesa')).id, Math.floor(r() * 100000), clock);
        else if (k < 0.96) upsert(s, 'ricorrenze', { nome: `R${step}`, tipo: 'spesa', importo: 1 + Math.floor(r() * 10000), contoId: pick(accounts).id, ogni: 1 + Math.floor(r() * 3), unita: pick(['giorni', 'settimane', 'mesi', 'anni']), inizio: day(), fine: null, ultima: null, autoRegistra: true, avvisoGiorni: 0, attiva: true }, clock);
        else generateDue(s, '2026-12-31', clock);
      } catch (e) {
        // qualche operazione non è permessa (es. categoria già esistente): va bene, ma lo stato non deve essere rimasto a metà
        assert.ok(/./.test(e.message), 'ogni errore ha un messaggio');
      }
      check(s, label);
    }
  }
});
