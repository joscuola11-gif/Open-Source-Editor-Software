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

import { LOOPS, LOOP_IDS, loopState, sanitizeLoop, clipAnimationState } from '../../src/core/animations.js';
import { TEXT_PRESETS } from '../../src/core/presets.js';

test('animazioni cicliche: periodiche, neutre a intensità zero, combinate con ingresso e uscita', () => {
  assert.ok(LOOP_IDS.length >= 8);
  for (const id of LOOP_IDS) {
    const loop = { type: id, speed: 2, amount: 80 };
    const a = loopState(loop, 0.3);
    const b = loopState(loop, 0.3 + 1 / 2);
    for (const k of ['alpha', 'dx', 'dy', 'scale', 'rotation']) {
      if (id === 'spin-loop' && k === 'rotation') continue; // 360° = 0°: stessa posizione
      assert.ok(Math.abs(a[k] - b[k]) < 1e-6, `${id}.${k} si ripete dopo un ciclo`);
    }
    const zero = loopState({ type: id, speed: 2, amount: 0 }, 0.37);
    assert.equal(zero.alpha, 1, `${id}: alfa neutro a intensità 0`);
    assert.ok(Math.abs(zero.scale - 1) < 1e-9 && zero.dx === 0 && zero.dy === 0 && zero.rotation === 0, `${id}: nessun movimento a intensità 0`);
  }
  // valori sempre finiti, anche per tempi strani
  for (const id of LOOP_IDS) for (const t of [0, 1e-9, 0.5, 123.456, 1e6]) {
    const s = loopState({ type: id, speed: 8, amount: 100 }, t);
    for (const k of ['alpha', 'dx', 'dy', 'scale', 'rotation']) assert.ok(Number.isFinite(s[k]), `${id}@${t}.${k}`);
    assert.ok(s.alpha >= 0 && s.alpha <= 1);
  }
  assert.equal(loopState({ type: 'sconosciuta' }, 1).scale, 1);
  assert.equal(loopState(null, 1).alpha, 1);
  assert.equal(loopState({ type: 'pulse' }, -5).scale, 1, 'tempo negativo = neutro');
  // sanitizzazione
  assert.deepEqual(sanitizeLoop({ type: 'pulse', speed: 99, amount: -4 }), { type: 'pulse', speed: 8, amount: 0 });
  assert.deepEqual(sanitizeLoop({ type: 'pulse' }), { type: 'pulse', speed: 1, amount: 60 });
  assert.equal(sanitizeLoop({ type: 'boh' }), null);
  assert.equal(sanitizeLoop('x'), null);
  // combinazione con l'ingresso: alfa e scala si moltiplicano
  const clip = { duration: 5, transition: null, anim: { in: { type: 'fade', duration: 1 }, out: null, loop: { type: 'blink', speed: 1, amount: 100 } } };
  const mid = clipAnimationState(clip, 0.25);
  assert.ok(mid.alpha < 0.3, 'dissolvenza in ingresso × lampeggio');
  const late = clipAnimationState(clip, 2.75); // dopo l'ingresso: solo il ciclo
  assert.ok(late.alpha <= 1 && late.alpha >= 0);
  assert.equal(clipAnimationState({ duration: 3, anim: { in: null, out: null, loop: null } }, 1).alpha, 1);
  assert.ok(LOOPS.pulse.label);
});

test('modelli di testo: identificatori unici, valori validi, animazioni e cicli che esistono', async () => {
  const { ANIMATIONS } = await import('../../src/core/animations.js');
  const ids = TEXT_PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'id unici');
  assert.ok(ids.length >= 20, `almeno 20 modelli (${ids.length})`);
  for (const p of TEXT_PRESETS) {
    assert.ok(p.label && p.text.content, p.id);
    if (p.animIn) assert.ok(ANIMATIONS[p.animIn], `${p.id}: animazione di ingresso «${p.animIn}»`);
    if (p.loop) assert.ok(sanitizeLoop(p.loop), `${p.id}: ciclo valido`);
    const c = createClip('text', { text: structuredClone(p.text) });
    assert.equal(c.text.karaoke.enabled, false);
    assert.ok(c.text.size > 0 && c.text.size <= 40, `${p.id}: dimensione`);
    if (p.y !== undefined) assert.ok(Math.abs(p.y) <= 0.5, `${p.id}: posizione dentro il fotogramma`);
  }
});
