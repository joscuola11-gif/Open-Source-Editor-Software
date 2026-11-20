import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, addYears, daysInMonth, diffDays, endOfMonth, formatDate, isValidISO, parseDateAny, parseISO, relativeDay, startOfMonth, todayISO, weekday } from '../../src/core/dates.js';
import { lastPeriods, periodOf, periodProgress, shiftPeriod } from '../../src/core/periods.js';

test('date: validità e calendario (anni bisestili, mesi lunghi)', () => {
  assert.ok(isValidISO('2026-11-20') && isValidISO('2024-02-29'));
  for (const bad of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-11-31', '26-11-20', '2026-1-1', '', null, 5, '2026-11-20T10:00']) assert.equal(isValidISO(bad), false, String(bad));
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(1900, 2), 28, '1900 non è bisestile');
  assert.equal(daysInMonth(2000, 2), 29);
  assert.deepEqual(parseISO('2026-11-20'), { y: 2026, m: 11, d: 20 });
});

test('date: aggiungere giorni, mesi, anni (fine mese senza sbavature)', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-11-20', 3), '2027-02-20');
  assert.equal(addMonths('2026-03-15', -3), '2025-12-15');
  assert.equal(addMonths('2026-01-31', 13), '2027-02-28');
  assert.equal(addYears('2024-02-29', 1), '2025-02-28');
  assert.equal(diffDays('2026-11-20', '2026-11-01'), 19);
  assert.equal(diffDays('2027-01-01', '2026-01-01'), 365);
  assert.equal(diffDays('2026-11-01', '2026-11-20'), -19);
  assert.equal(startOfMonth('2026-11-20'), '2026-11-01');
  assert.equal(endOfMonth('2026-02-10'), '2026-02-28');
  // il giorno della settimana: il 20 novembre 2026 è un venerdì
  assert.equal(weekday('2026-11-20'), 4);
  assert.equal(weekday('2026-11-22'), 6);
  assert.equal(weekday('2026-11-23'), 0);
});

test('date: oggi nel fuso del telefono e testi in italiano', () => {
  assert.equal(todayISO(new Date(2026, 10, 20, 23, 59)), '2026-11-20');
  assert.equal(todayISO(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
  assert.equal(formatDate('2026-11-20', 'long'), '20 novembre 2026');
  assert.equal(formatDate('2026-11-20', 'day'), 'venerdì 20 novembre');
  assert.equal(formatDate('2026-11-20', 'short', '2026-05-05'), '20 nov');
  assert.equal(formatDate('2025-11-20', 'short', '2026-05-05'), '20 nov 2025');
  assert.equal(formatDate('2026-11-20', 'monthYear'), 'novembre 2026');
  assert.equal(formatDate('boh'), '');
  assert.equal(relativeDay('2026-11-20', '2026-11-20'), 'Oggi');
  assert.equal(relativeDay('2026-11-19', '2026-11-20'), 'Ieri');
  assert.equal(relativeDay('2026-11-21', '2026-11-20'), 'Domani');
  assert.equal(relativeDay('2026-11-10', '2026-11-20'), 'martedì 10 novembre');
});

test('date: si leggono i formati più comuni (anche degli estratti conto)', () => {
  const t = { today: '2026-11-20' };
  const cases = { '2026-11-20': '2026-11-20', '20/11/2026': '2026-11-20', '20-11-2026': '2026-11-20', '20.11.2026': '2026-11-20', '5/3/26': '2026-03-05', '5/3/99': '1999-03-05', '2026/11/20': '2026-11-20', '20 nov 2026': '2026-11-20', '20 novembre': '2026-11-20', '2026-11-20T10:30:00Z': '2026-11-20', '20/11/2026 14:30': '2026-11-20' };
  for (const [text, iso] of Object.entries(cases)) assert.equal(parseDateAny(text, t), iso, text);
  for (const bad of ['', 'ciao', '31/02/2026', '2026-02-30', '13/13/2026', null, '32 nov']) assert.equal(parseDateAny(bad, t), null, String(bad));
});

test('periodi: mese di calendario', () => {
  const p = periodOf('2026-11-20');
  assert.deepEqual([p.from, p.to, p.key, p.label], ['2026-11-01', '2026-11-30', '2026-11-01', 'Novembre 2026']);
  assert.equal(periodOf('2024-02-10').to, '2024-02-29');
  assert.equal(periodOf('2026-12-31').to, '2026-12-31');
  assert.equal(periodOf('2026-01-01').from, '2026-01-01');
});

test('periodi: «mese» che inizia il 27 (stipendio)', () => {
  let p = periodOf('2026-11-20', 27);
  assert.deepEqual([p.from, p.to], ['2026-10-27', '2026-11-26']);
  assert.match(p.label, /^Novembre 2026 \(27 ott – 26 nov\)$/);
  p = periodOf('2026-11-27', 27);
  assert.deepEqual([p.from, p.to], ['2026-11-27', '2026-12-26']);
  p = periodOf('2026-01-10', 27);
  assert.deepEqual([p.from, p.to], ['2025-12-27', '2026-01-26']);
  p = periodOf('2026-12-30', 27);
  assert.deepEqual([p.from, p.to], ['2026-12-27', '2027-01-26']);
  // giorno non valido → si torna al 1
  assert.equal(periodOf('2026-11-20', 31).from, '2026-11-01');
  assert.equal(periodOf('2026-11-20', 0).from, '2026-11-01');
  assert.equal(periodOf('2026-02-28', 28).from, '2026-02-28');
  // ogni data sta in uno e un solo periodo, e i periodi si susseguono senza buchi
  for (const s of [1, 5, 15, 27, 28]) {
    let prev = null;
    for (let i = 0; i < 800; i++) {
      const d = addDays('2024-01-01', i);
      const per = periodOf(d, s);
      assert.ok(per.from <= d && d <= per.to, `${d} dentro ${per.from}..${per.to} (s=${s})`);
      if (prev && prev.key !== per.key) assert.equal(addDays(prev.to, 1), per.from, `nessun buco dopo ${prev.to}`);
      prev = per;
    }
  }
});

test('periodi: spostarsi, ultimi periodi, avanzamento', () => {
  const p = periodOf('2026-11-20');
  assert.equal(shiftPeriod(p, -1).from, '2026-10-01');
  assert.equal(shiftPeriod(p, 2).from, '2027-01-01');
  assert.equal(shiftPeriod(periodOf('2026-11-20', 27), -1, 27).from, '2026-09-27');
  const last = lastPeriods('2026-11-20', 12);
  assert.equal(last.length, 12);
  assert.equal(last[0].from, '2025-12-01');
  assert.equal(last.at(-1).from, '2026-11-01');
  assert.deepEqual(periodProgress(p, '2026-11-20'), { total: 30, elapsed: 20, remaining: 10 });
  assert.deepEqual(periodProgress(p, '2026-11-01'), { total: 30, elapsed: 1, remaining: 29 });
  assert.deepEqual(periodProgress(p, '2026-12-15'), { total: 30, elapsed: 30, remaining: 0 });
  assert.deepEqual(periodProgress(p, '2026-10-15'), { total: 30, elapsed: 0, remaining: 30 });
  assert.throws(() => periodOf('boh'));
});
