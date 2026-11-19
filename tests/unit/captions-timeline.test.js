import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCues, cuesForTimeline } from '../../src/core/captions.js';
import { sanitizeWords, wordTimings } from '../../src/core/karaoke.js';

const words = [
  { text: 'Ciao', start: 1, end: 1.4 }, { text: 'a', start: 1.45, end: 1.55 }, { text: 'tutti,', start: 1.6, end: 2.1 },
  { text: 'benvenuti', start: 2.2, end: 2.8 }, { text: 'nel', start: 2.85, end: 3.0 }, { text: 'canale.', start: 3.05, end: 3.6 },
];

test('cuesForTimeline: sposta e adatta alla velocità del clip', () => {
  const cues = buildCues(words, { style: 'standard' });
  const a = cuesForTimeline(cues, { offset: 10, speed: 2 });
  assert.equal(a.length, cues.length);
  assert.ok(Math.abs(a[0].start - (10 + cues[0].start / 2)) < 1e-9);
  assert.ok(Math.abs(a[0].end - (10 + cues[0].end / 2)) < 1e-9);
  assert.equal(a[0].words, undefined);
});

test('cuesForTimeline: parole karaoke relative all’inizio e coerenti con il testo', () => {
  const cues = buildCues(words, { style: 'standard' });
  const [c] = cuesForTimeline(cues, { karaoke: true });
  assert.ok(c.words.length >= 2);
  assert.equal(c.words[0].t, 0);
  for (let i = 1; i < c.words.length; i++) assert.ok(c.words[i].t >= c.words[i - 1].t);
  // il progetto accetta queste parole così come sono
  assert.ok(sanitizeWords(c.words));
  assert.deepEqual(wordTimings({ content: c.text, words: c.words }, c.end - c.start), c.words);
});

test('cuesForTimeline: testo corretto a mano → niente parole (ricalcolo automatico); testi vuoti scartati', () => {
  const cues = buildCues(words, { style: 'standard' });
  const edited = cues.map((c) => ({ ...c, text: `${c.text} (corretto)` }));
  edited.push({ start: 9, end: 10, text: '   ', words: [] });
  const out = cuesForTimeline(edited, { karaoke: true });
  assert.equal(out.length, cues.length);
  assert.ok(out.every((c) => c.words === undefined));
});

test('cuesForTimeline: tempi non validi si scartano', () => {
  const out = cuesForTimeline([{ start: 2, end: 2, text: 'a' }, { start: NaN, end: 3, text: 'b' }, { start: 1, end: 2, text: 'ok' }]);
  assert.deepEqual(out.map((c) => c.text), ['ok']);
});
