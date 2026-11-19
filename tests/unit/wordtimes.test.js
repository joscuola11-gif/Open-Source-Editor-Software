import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeWords, repairWordTimes, spreadWords, syllables, wordWeight } from '../../src/core/wordtimes.js';
import { detectSpeech, energyAt } from '../../src/core/vad.js';
import { decodeWav } from '../../src/core/wav.js';
import { rng, speechLike } from '../helpers/speechlike.js';

const jfkWords = JSON.parse(readFileSync(new URL('../fixtures/jfk.words.json', import.meta.url), 'utf8')).words;
const jfkAudio = decodeWav(new Uint8Array(readFileSync(new URL('../fixtures/jfk.wav', import.meta.url))));

test('syllables: parole italiane e inglesi di esempio', () => {
  const cases = { buongiorno: 3, montaggio: 3, programma: 3, gratuito: 3, video: 3, poeta: 3, computer: 3, tutti: 2, oggi: 2, a: 1, Americans: 4, country: 2, fellow: 2, time: 1, table: 2, strength: 1, 'l’amico': 3 };
  for (const [w, n] of Object.entries(cases)) assert.equal(syllables(w), n, w);
  assert.equal(syllables('123'), 0);
  assert.equal(syllables(''), 0);
  assert.equal(syllables('…,'), 0);
});

test('wordWeight: la punteggiatura aggiunge pausa, le parole lunghe pesano di più', () => {
  assert.ok(wordWeight('parlare.').pause > wordWeight('parlare,').pause && wordWeight('parlare,').pause > wordWeight('parlare').pause);
  assert.ok(wordWeight('programma').speech > wordWeight('il').speech);
});

test('spreadWords: copre l’intervallo, in ordine, le parole lunghe durano di più, dopo il punto c’è una pausa', () => {
  const w = spreadWords(['Il', 'programma', 'funziona.', 'Davvero'], 1, 5);
  assert.ok(Math.abs(w[0].start - 1) < 1e-9 && Math.abs(w.at(-1).end - 5) < 1e-9);
  for (let i = 0; i < w.length; i++) {
    assert.ok(w[i].end > w[i].start);
    if (i) assert.ok(w[i].start >= w[i - 1].end - 1e-9);
  }
  assert.ok(w[1].end - w[1].start > w[0].end - w[0].start);
  assert.ok(w[3].start - w[2].end > 0.2, 'pausa dopo il punto');
  assert.deepEqual(spreadWords([], 0, 1), []);
});

test('normalizeWords: niente sovrapposizioni, durate minime, ordine mantenuto, valori strani riparati', () => {
  const out = normalizeWords([{ text: 'a', start: 1, end: 0.5 }, { text: 'b', start: 0.2, end: 0.3 }, { text: 'c', start: NaN, end: NaN }, { text: 'd', start: 9, end: 20 }], { total: 10 });
  let prev = 0;
  for (const w of out) {
    assert.ok(w.start >= prev - 1e-9 && w.end >= w.start + 0.06 - 1e-9, JSON.stringify(w));
    prev = w.start;
  }
  assert.deepEqual(out.map((w) => w.text), ['a', 'b', 'c', 'd']);
  assert.ok(out.at(-1).end <= 10 + 0.06);
});

/** Parole sintetiche a tempi noti (n sillabe da ~0.18 s, pausa fra parole 0.08–0.15 s, pausa di frase 0.6 s) + tempi «del riconoscitore» sporcati. */
function synthetic(seed, jitter = 0.25) {
  const r = rng(seed);
  const truth = [];
  let t = 0.6;
  const names = [];
  for (let i = 0; i < 12; i++) {
    const syl = 1 + Math.floor(r() * 3);
    const dur = syl * 0.18 + 0.05;
    truth.push({ text: `w${i}${'a'.repeat(syl)}`, start: t, end: t + dur });
    t += dur + (i % 4 === 3 ? 0.6 : 0.09 + r() * 0.06);
    names.push(i);
  }
  const noisy = truth.map((w) => {
    const g = () => (r() + r() + r() - 1.5) * 2 * jitter;
    return { text: w.text, start: Math.max(0, w.start + g()), end: Math.max(0.05, w.end + g()) };
  });
  const bursts = truth.map((w) => ({ start: w.start, end: w.end }));
  const dur = t + 0.8;
  return { truth, noisy, audio: speechLike(bursts, { duration: dur, seed: seed + 100, noiseDb: -52 }), dur };
}

test('repairWordTimes: avvicina i tempi sporcati a quelli veri (errore medio più basso, parole mai troppo brevi)', () => {
  let before = 0;
  let after = 0;
  let n = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { truth, noisy, audio, dur } = synthetic(seed);
    const vad = detectSpeech(audio, 16000);
    const fixed = repairWordTimes(noisy, vad, { total: dur });
    assert.equal(fixed.length, truth.length);
    truth.forEach((w, i) => {
      before += Math.abs(noisy[i].start - w.start) + Math.abs(noisy[i].end - w.end);
      after += Math.abs(fixed[i].start - w.start) + Math.abs(fixed[i].end - w.end);
      n += 2;
      assert.ok(fixed[i].end - fixed[i].start >= 0.07 - 1e-9, `parola troppo breve ${JSON.stringify(fixed[i])}`);
      if (i) assert.ok(fixed[i].start >= fixed[i - 1].start, 'in ordine');
    });
  }
  const b = before / n;
  const a = after / n;
  assert.ok(a < b * 0.8, `errore medio ${b.toFixed(3)} s → ${a.toFixed(3)} s`);
  assert.ok(a < 0.16, `errore finale ${a.toFixed(3)} s`);
});

test('repairWordTimes: con tempi già giusti non li rovina (errore medio ≤ 0.1 s)', () => {
  let err = 0;
  let n = 0;
  for (let seed = 20; seed < 28; seed++) {
    const { truth, audio, dur } = synthetic(seed, 0);
    const vad = detectSpeech(audio, 16000);
    const fixed = repairWordTimes(truth, vad, { total: dur });
    truth.forEach((w, i) => {
      err += Math.abs(fixed[i].start - w.start) + Math.abs(fixed[i].end - w.end);
      n += 2;
    });
  }
  assert.ok(err / n < 0.1, `errore ${(err / n).toFixed(3)} s`);
});

test('repairWordTimes: senza parlato rilevato restituisce i tempi normalizzati; parole fuori dall’audio non lanciano', () => {
  const w = [{ text: 'a', start: 3, end: 2 }, { text: 'b', start: 1, end: 2 }];
  const out = repairWordTimes(w, { segments: [], energies: new Float32Array(0), hop: 0.01, floorDb: -60, speechDb: -10 });
  assert.equal(out.length, 2);
  assert.ok(out[0].end >= out[0].start);
  assert.deepEqual(repairWordTimes([], { segments: [] }), []);
  const { audio } = synthetic(3);
  const vad = detectSpeech(audio, 16000);
  assert.doesNotThrow(() => repairWordTimes([{ text: 'x', start: 500, end: 600 }, { text: 'y', start: -4, end: -2 }], vad, { total: 8 }));
});

test('repairWordTimes sulla voce vera (jfk.wav + tempi di Whisper tiny): parole dentro il parlato, ordinate, confini sui cali di energia', () => {
  const vad = detectSpeech(jfkAudio.channels[0], jfkAudio.sampleRate);
  const fixed = repairWordTimes(jfkWords, vad, { total: 11 });
  assert.equal(fixed.length, jfkWords.length);
  let inside = 0;
  fixed.forEach((w, i) => {
    assert.ok(w.end - w.start >= 0.07 - 1e-9 && w.end - w.start <= 1.8, `${w.text}: ${(w.end - w.start).toFixed(2)} s`);
    if (i) assert.ok(w.start >= fixed[i - 1].start - 1e-9);
    const mid = (w.start + w.end) / 2;
    if (vad.segments.some((s) => mid >= s.start - 0.05 && mid <= s.end + 0.05)) inside++;
  });
  assert.ok(inside >= fixed.length - 1, `${inside}/${fixed.length} parole dentro il parlato`);
  // le parole originali di Whisper avevano durate assurde (es. «for» 1,1 s, «you,» 0,02 s): ora sono ragionevoli
  const durs = fixed.map((w) => w.end - w.start);
  const spread = (a) => Math.max(...a) / Math.min(...a);
  assert.ok(spread(durs) < spread(jfkWords.map((w) => w.end - w.start)), 'durate meno estreme di prima');
  // i confini cadono dove l'energia è più bassa che al centro delle parole
  const dip = (ws) => {
    let b = 0;
    let c = 0;
    let n = 0;
    for (let i = 0; i + 1 < ws.length; i++) {
      b += energyAt(vad, (ws[i].end + ws[i + 1].start) / 2);
      c += energyAt(vad, (ws[i].start + ws[i].end) / 2);
      n++;
    }
    return (c - b) / n;
  };
  assert.ok(dip(fixed) >= dip(jfkWords) - 0.01, `calo ai confini ${dip(fixed).toFixed(3)} (prima ${dip(jfkWords).toFixed(3)})`);
  assert.ok(dip(fixed) > 0.03, 'i confini sono più «vuoti» del centro delle parole');
});
