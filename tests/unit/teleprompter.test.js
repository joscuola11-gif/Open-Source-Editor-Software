import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScript, wordCount, readingSeconds, scrollPlan, scrollOffset, elapsedAt, clampWpm, WPM_MIN, WPM_MAX, WPM_DEFAULT } from '../../src/core/teleprompter.js';

test('parseScript: conta le parole (anche accentate e con punteggiatura) e ignora gli appunti con //', () => {
  const r = parseScript('Ciao a tutti, benvenuti!\n// ricorda: sorridere\n\nOggi parliamo di perché è così.\n');
  assert.deepEqual(r.lines, ['Ciao a tutti, benvenuti!', '', 'Oggi parliamo di perché è così.']);
  assert.deepEqual(r.notes, ['ricorda: sorridere']);
  assert.equal(r.words, 10);
});

test('parseScript: righe vuote doppie diventano una, nessuna riga vuota in testa o in coda, CRLF ok', () => {
  const r = parseScript('\r\n\r\nuno\r\n\r\n\r\n\r\ndue  tre\r\n\r\n');
  assert.deepEqual(r.lines, ['uno', '', 'due  tre']);
  assert.equal(r.words, 3);
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount(null), 0);
  assert.equal(wordCount('// solo appunto'), 0);
});

test('clampWpm: limiti e valori non numerici', () => {
  assert.equal(clampWpm(5), WPM_MIN);
  assert.equal(clampWpm(9999), WPM_MAX);
  assert.equal(clampWpm('abc'), WPM_DEFAULT);
  assert.equal(clampWpm(150.4), 150);
});

test('readingSeconds: 140 parole a 140 al minuto = 60 s; 0 parole = 0 s', () => {
  assert.equal(readingSeconds(140, 140), 60);
  assert.equal(readingSeconds(0, 140), 0);
  assert.equal(readingSeconds(70, 1), (70 / WPM_MIN) * 60); // la velocità viene limitata
});

test('scrollPlan e scrollOffset: la fine del testo arriva esattamente allo scadere del tempo', () => {
  const plan = scrollPlan({ words: 280, wpm: 140, contentHeight: 3000, viewHeight: 600 });
  assert.equal(plan.seconds, 120);
  assert.equal(plan.distance, 2400);
  assert.equal(plan.pxPerSecond, 20);
  assert.equal(scrollOffset(plan, 0), 0);
  assert.equal(scrollOffset(plan, 30), 600);
  assert.equal(scrollOffset(plan, 120), 2400);
  assert.equal(scrollOffset(plan, 999), 2400, 'non va oltre la fine');
  assert.equal(scrollOffset(plan, -5), 0);
  // più veloce = più px al secondo
  const fast = scrollPlan({ words: 280, wpm: 280, contentHeight: 3000, viewHeight: 600 });
  assert.equal(fast.pxPerSecond, 40);
});

test('scrollPlan: testo più corto della finestra o vuoto non scorre e non divide per zero', () => {
  const small = scrollPlan({ words: 10, wpm: 140, contentHeight: 300, viewHeight: 600 });
  assert.equal(small.distance, 0);
  assert.equal(scrollOffset(small, 5), 0);
  const empty = scrollPlan({ words: 0, wpm: 140, contentHeight: 900, viewHeight: 600 });
  assert.equal(empty.pxPerSecond, 0);
  assert.equal(scrollOffset(empty, 5), 0);
  assert.equal(elapsedAt(empty, 100), 0);
});

test('elapsedAt: cambiando velocità si riprende dalla stessa riga', () => {
  const a = scrollPlan({ words: 280, wpm: 140, contentHeight: 3000, viewHeight: 600 });
  const offset = scrollOffset(a, 45);
  const b = scrollPlan({ words: 280, wpm: 280, contentHeight: 3000, viewHeight: 600 });
  assert.equal(scrollOffset(b, elapsedAt(b, offset)), offset);
});
