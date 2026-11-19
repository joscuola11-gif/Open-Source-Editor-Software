import { test } from 'node:test';
import assert from 'node:assert/strict';
import { karaokeFraction, wordTimings, sanitizeKaraoke, sanitizeWords, prefixLength, defaultKaraoke } from '../../src/core/karaoke.js';
import { createClip, sanitizeClip, createProject } from '../../src/core/project.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const tx = (content, extra = {}) => ({ content, karaoke: { enabled: true, mode: 'word', color: '#ff0000' }, words: null, ...extra });

test('tempi automatici: crescenti, dentro la durata, proporzionali alla lunghezza delle parole', () => {
  const w = wordTimings(tx('a bbbb cc'), 10);
  assert.deepEqual(w.map((x) => x.w), ['a', 'bbbb', 'cc']);
  for (let i = 1; i < w.length; i++) assert.ok(w[i].t > w[i - 1].t);
  assert.ok(w[0].t >= 0 && w.at(-1).t < 10);
  assert.ok(w[2].t - w[1].t > w[1].t - w[0].t, 'la parola più lunga occupa più tempo');
  assert.deepEqual(wordTimings(tx(''), 5), []);
});

test('modo «parola intera»: la frazione sale a gradini sulle lettere, mai oltre 1, mai sotto 0', () => {
  const t = tx('uno due');
  const d = 4;
  assert.equal(karaokeFraction(t, -1, d), 0);
  assert.equal(karaokeFraction(t, 0, d), 0, 'a inizio clip niente è colorato');
  const mid = karaokeFraction(t, 1.0, d);
  assert.ok(mid > 0 && mid < 1, `a metà solo la prima parola (${mid})`);
  near(mid, 3 / 6); // «uno» = 3 lettere su 6
  assert.equal(karaokeFraction(t, d, d), 1);
  assert.equal(karaokeFraction(t, 99, d), 1);
  // monotona nel tempo
  let prev = 0;
  for (let x = 0; x <= d; x += 0.05) {
    const f = karaokeFraction(t, x, d);
    assert.ok(f >= prev - 1e-9 && f >= 0 && f <= 1);
    prev = f;
  }
});

test('modo «lettera per lettera»: dentro la parola la frazione cresce con continuità', () => {
  const t = tx('parola', { karaoke: { enabled: true, mode: 'fill', color: '#fff000' } });
  const d = 4;
  const a = karaokeFraction(t, 1, d);
  const b = karaokeFraction(t, 2, d);
  const c = karaokeFraction(t, 3, d);
  assert.ok(0 < a && a < b && b < c && c <= 1, `${a} < ${b} < ${c}`);
});

test('tempi del file: si usano quando coincidono con il testo, altrimenti si ignorano', () => {
  const words = [{ t: 0, w: 'Una' }, { t: 0.5, w: 'frase' }, { t: 1.5, w: 'cantata' }];
  const t = tx('Una frase cantata', { words });
  assert.equal(karaokeFraction(t, 0.4, 3), 3 / 15, 'solo «Una»');
  assert.equal(karaokeFraction(t, 1.0, 3), 8 / 15, '«Una frase»');
  assert.equal(karaokeFraction(t, 2.9, 3), 1);
  // testo modificato dopo l'import: i tempi non valgono più → automatici
  const edited = tx('Tutta un\'altra frase', { words });
  assert.notDeepEqual(wordTimings(edited, 3).map((w) => w.t), words.map((w) => w.t));
  // dati rovinati
  assert.equal(sanitizeWords([{ t: 1, w: 'a' }, { t: 0, w: 'b' }]), null, 'non crescenti');
  assert.equal(sanitizeWords([{ t: 'x', w: 'a' }, { t: 1, w: 'b' }]), null);
  assert.equal(sanitizeWords('boh'), null);
  assert.equal(sanitizeWords([{ t: 0, w: 'solo una' }]), null);
  assert.deepEqual(sanitizeWords([{ t: 0, w: ' a ' }, { t: 1, w: 'b' }]), [{ t: 0, w: 'a' }, { t: 1, w: 'b' }]);
});

test('prefissi per riga e valori predefiniti; i vecchi testi si aprono senza karaoke', () => {
  assert.equal(prefixLength('ciao mondo', 0), 0);
  assert.equal(prefixLength('ciao mondo', 4), 4);
  assert.equal(prefixLength('ciao mondo', 5), 10 - 4, 'dopo «ciao m»');
  assert.equal(prefixLength('ciao mondo', 99), 10);
  assert.equal(prefixLength('', 3), 0);
  assert.deepEqual(sanitizeKaraoke(null), defaultKaraoke());
  assert.deepEqual(sanitizeKaraoke({ enabled: 1, mode: 'x', color: 'rosso' }), defaultKaraoke());
  assert.deepEqual(sanitizeKaraoke({ enabled: true, mode: 'fill', color: '#00ff00' }), { enabled: true, mode: 'fill', color: '#00ff00' });
  const old = createClip('text');
  delete old.text.karaoke;
  delete old.text.words;
  const p = createProject();
  p.tracks[0].clips.push(old);
  const back = sanitizeClip(JSON.parse(JSON.stringify(old)), p);
  assert.deepEqual(back.text.karaoke, defaultKaraoke());
  assert.equal(back.text.words, null);
});
