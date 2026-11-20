import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, formatAmount, formatPlain, parseAmount, splitEvenly } from '../../src/core/money.js';

test('importi: come si scrivono davvero', () => {
  const ok = {
    '12': 1200, '12,5': 1250, '12,50': 1250, '12.50': 1250, '0,99': 99, ',5': 50, '1.234,56': 123456, '1,234.56': 123456, '1.234': 123400, '12.345.678': 1234567800,
    '€ 12': 1200, '12 €': 1200, '12 EUR': 1200, '-5': -500, '+5': 500, '−7,25': -725, ' 3,00 ': 300, '1 234,5': 123450, '999': 99900,
  };
  for (const [text, cents] of Object.entries(ok)) assert.equal(parseAmount(text), cents, `«${text}»`);
  for (const bad of ['', ' ', 'abc', '12,345,6', '1,2,3', '12.5.5', '0,125', '1,234.567', '--5', '5-', '1e3', '12,,5', '€', '1.23.4'])
    assert.equal(parseAmount(bad), null, `«${bad}» non è un importo`);
  assert.equal(parseAmount(12.34), 1234);
  assert.equal(parseAmount(0.1 + 0.2), 30, 'niente errori di virgola mobile');
  assert.equal(parseAmount(NaN), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount('99999999999999999'), null, 'troppo grande');
});

test('importi: formattazione all’italiana e in altre valute', () => {
  assert.equal(formatAmount(123456), '1.234,56\u00a0€');
  assert.equal(formatAmount(1234567890), '12.345.678,90\u00a0€');
  assert.equal(formatAmount(99999), '999,99\u00a0€');
  assert.match(formatAmount(-5), /^−0,05\s€$/);
  assert.match(formatAmount(0), /^0,00\s€$/);
  assert.match(formatAmount(1000, { sign: true }), /^\+10,00\s€$/);
  assert.match(formatAmount(12345, { currency: 'USD', locale: 'en-US' }), /^\$123\.45$/);
  assert.equal(formatAmount(500, { currency: 'XXX9' }), '5,00\u00a0XXX9', 'valuta strana: non si rompe');
  assert.equal(formatAmount(NaN), '0,00\u00a0€');
  assert.equal(formatPlain(123456), '1234,56');
  assert.equal(formatPlain(-5), '-0,05');
  assert.equal(formatPlain(7), '0,07');
  // andata e ritorno
  for (const c of [0, 1, 99, 100, 123456, -250, 99999999]) assert.equal(parseAmount(formatPlain(c)), c);
});

test('divisione: le parti sommano sempre esattamente il totale', () => {
  assert.deepEqual(splitEvenly(100, 3), [34, 33, 33]);
  assert.deepEqual(splitEvenly(10, 4), [3, 3, 2, 2]);
  assert.deepEqual(splitEvenly(-100, 3), [-34, -33, -33]);
  assert.deepEqual(splitEvenly(0, 5), [0, 0, 0, 0, 0]);
  assert.throws(() => splitEvenly(100, 0));
  assert.throws(() => splitEvenly(1.5, 2));
  for (let t = -50; t <= 500; t += 7) for (let n = 1; n <= 9; n++) assert.equal(splitEvenly(t, n).reduce((a, b) => a + b, 0), t);
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(1000, [50, 30, 20]), [500, 300, 200]);
  assert.deepEqual(allocate(1, [1, 1]), [1, 0]);
  assert.throws(() => allocate(10, [0, 0]));
  for (let t = 0; t <= 999; t += 13) for (const w of [[1, 2, 3], [7, 7], [1, 1, 1, 1, 1, 1, 1], [0, 5, 0, 1]]) {
    const parts = allocate(t, w);
    assert.equal(parts.reduce((a, b) => a + b, 0), t);
    assert.ok(parts.every((p, i) => (w[i] === 0 ? p === 0 : p >= 0)));
  }
});
