import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captionsFromScript, emptyCuesFromSpeech, isHallucination, toMono16k, transcribe } from '../../src/core/transcribe.js';
import { checkCues } from '../../src/core/captions.js';
import { decodeWav } from '../../src/core/wav.js';
import { speechLike } from '../helpers/speechlike.js';

const jfk = decodeWav(new Uint8Array(readFileSync(new URL('../fixtures/jfk.wav', import.meta.url))));
const JFK_TEXT = 'And so my fellow Americans ask not what your country can do for you, ask what you can do for your country.';
/** Riconoscitore finto: restituisce un testo fisso e registra quanto audio ha ricevuto. */
const fake = (texts) => {
  const calls = [];
  let i = 0;
  return { calls, async transcribe(a, o) { calls.push({ len: a.length, language: o.language }); return { text: texts[Math.min(i++, texts.length - 1)] }; } };
};

test('toMono16k: stereo → mono, 44,1 kHz → 16 kHz, durata e frequenza conservate', () => {
  const sr = 44100;
  const n = sr * 2;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
    R[i] = L[i];
  }
  const m = toMono16k([L, R], sr);
  assert.ok(Math.abs(m.length - 32000) <= 2, `lunghezza ${m.length}`);
  let zc = 0;
  for (let i = 1; i < m.length; i++) if (m[i - 1] < 0 && m[i] >= 0) zc++;
  assert.ok(Math.abs(zc - 880) <= 6, `440 Hz per 2 s = 880 passaggi, trovati ${zc}`);
  assert.ok(Math.max(...m.slice(2000, 4000)) > 0.4 && Math.max(...m.slice(2000, 4000)) < 0.6);
  assert.equal(toMono16k([new Float32Array(10)], 16000).length, 10);
  // le frequenze sopra 8 kHz non devono «ripiegarsi» (aliasing) nella banda del parlato
  const hi = new Float32Array(n);
  for (let i = 0; i < n; i++) hi[i] = 0.5 * Math.sin((2 * Math.PI * 15000 * i) / sr);
  const mh = toMono16k([hi], sr);
  const rms = Math.sqrt(mh.slice(2000).reduce((a, b) => a + b * b, 0) / (mh.length - 2000));
  assert.ok(rms < 0.1, `15 kHz attenuata (rms ${rms.toFixed(3)})`);
});

test('isHallucination: frasi note e ripetizioni a ciclo sì, parlato normale no', () => {
  for (const t of ['Sottotitoli creati dalla comunità Amara.org', 'Thanks for watching!', 'Thank you.', '[Musica]', '♪ ♪', '', '   ', 'Grazie per la visione', 'ciao ciao ciao ciao ciao ciao ciao ciao ciao ciao ciao ciao', 'e poi e poi e poi e poi e poi e poi e poi e poi e poi e poi']) assert.equal(isHallucination(t), true, t);
  for (const t of ['Oggi parliamo di montaggio video.', 'Thank you for the gift, it was wonderful and kind.', 'ok ok va bene così', JFK_TEXT]) assert.equal(isHallucination(t), false, t);
});

test('transcribe (con riconoscitore finto) sulla voce vera: sottotitoli giusti, tempi dentro il parlato, lingua passata al motore', async () => {
  const eng = fake([JFK_TEXT]);
  const steps = [];
  const r = await transcribe({ channels: jfk.channels, sampleRate: jfk.sampleRate, language: 'english', engine: eng, onProgress: (p) => steps.push(p.step) });
  assert.equal(eng.calls.length, 1);
  assert.equal(eng.calls[0].language, 'english');
  assert.ok(eng.calls[0].len > 16000 * 10 && eng.calls[0].len <= 16000 * 12, 'ha ricevuto circa 11 s di audio a 16 kHz');
  assert.deepEqual(checkCues(r.cues), []);
  // i tempi vengono dall'audio (non da quelli del modello): le pause vere dividono il discorso come lo ha detto chi parla
  assert.deepEqual(r.cues.map((c) => c.text.replace(/\n/g, ' ')), ['And so my fellow Americans', 'ask not', 'what your country can do for you, ask what you can do for your country.']);
  assert.equal(r.words.length, 22);
  r.words.forEach((w, i) => {
    assert.ok(w.end > w.start && w.start >= 0 && w.end <= 11.01);
    if (i) assert.ok(w.start >= r.words[i - 1].start);
  });
  assert.ok(r.cues[0].start > 0.15 && r.cues[0].start < 0.8, `primo sottotitolo a ${r.cues[0].start}`);
  assert.ok(steps.includes('voce') && steps.includes('riconoscimento') && steps.includes('sottotitoli'));
  assert.ok(Math.abs(r.duration - 11) < 0.01);
});

test('transcribe: più blocchi (parlato lungo) → un sottotitolo continuo con i tempi nei posti giusti; le invenzioni del modello si scartano', async () => {
  // due frasi a 40 s di distanza: due blocchi
  const sr = 16000;
  const x = speechLike([{ start: 1, end: 3 }, { start: 41, end: 43.5 }], { duration: 46, sr });
  const eng = fake(['Prima frase di prova.', 'Sottotitoli creati dalla comunità Amara.org']);
  const r = await transcribe({ channels: [x], sampleRate: sr, language: 'italian', engine: eng });
  assert.equal(eng.calls.length, 2);
  assert.equal(r.cues.length, 1, 'la seconda è un’invenzione: scartata');
  assert.ok(r.cues[0].start >= 0.9 && r.cues[0].end <= 3.8);
  const eng2 = fake(['Prima frase di prova.', 'Seconda frase altrettanto breve.']);
  const r2 = await transcribe({ channels: [x], sampleRate: sr, engine: eng2 });
  assert.equal(r2.cues.length, 2);
  assert.ok(r2.cues[1].start >= 40.9 && r2.cues[1].end <= 44.3, `${r2.cues[1].start}-${r2.cues[1].end}`);
  assert.equal(eng2.calls[0].language, undefined);
});

test('transcribe: audio senza parlato → nessun sottotitolo e il motore non viene nemmeno chiamato; audio vuoto → errore chiaro', async () => {
  const eng = fake(['non dovrebbe servire']);
  const r = await transcribe({ channels: [new Float32Array(16000 * 3)], sampleRate: 16000, engine: eng });
  assert.deepEqual(r.cues, []);
  assert.equal(eng.calls.length, 0);
  await assert.rejects(() => transcribe({ channels: [new Float32Array(0)], sampleRate: 16000, engine: eng }), /audio/);
  await assert.rejects(() => transcribe({ channels: [], sampleRate: 16000, engine: eng }), /audio/);
});

test('transcribe: si può annullare; un errore del motore arriva a chi chiama', async () => {
  const x = speechLike([{ start: 1, end: 3 }, { start: 41, end: 43 }], { duration: 46 });
  const signal = { aborted: false };
  const eng = { async transcribe() { signal.aborted = true; return { text: 'uno due tre' }; } };
  await assert.rejects(() => transcribe({ channels: [x], sampleRate: 16000, engine: eng, signal }), /annullata/);
  const broken = { async transcribe() { throw new Error('modello non scaricato'); } };
  await assert.rejects(() => transcribe({ channels: [x], sampleRate: 16000, engine: broken }), /modello non scaricato/);
});

test('captionsFromScript: testo noto → sottotitoli con i tempi del parlato vero', () => {
  const r = captionsFromScript({ channels: jfk.channels, sampleRate: jfk.sampleRate, script: JFK_TEXT });
  assert.equal(r.cues.length, 3);
  assert.deepEqual(checkCues(r.cues), []);
  assert.ok(r.cues[0].start > 0.15 && r.cues[0].start < 0.8 && r.cues.at(-1).end > 10 && r.cues.at(-1).end <= 11.5);
  assert.throws(() => captionsFromScript({ channels: [new Float32Array(0)], sampleRate: 16000, script: 'x' }), /audio/);
  assert.deepEqual(captionsFromScript({ channels: jfk.channels, sampleRate: jfk.sampleRate, script: '' }).cues, []);
});

test('emptyCuesFromSpeech: una riga vuota per ogni frase parlata (pause lunghe separano)', () => {
  const x = speechLike([{ start: 0.5, end: 1.5 }, { start: 1.8, end: 2.6 }, { start: 4.5, end: 6 }], { duration: 7 });
  const r = emptyCuesFromSpeech({ channels: [x], sampleRate: 16000, minGap: 0.5 });
  assert.equal(r.cues.length, 2, JSON.stringify(r.cues.map((c) => [c.start, c.end])));
  assert.ok(r.cues.every((c) => c.text === '' && c.end > c.start));
  assert.ok(r.cues[0].start > 0.3 && r.cues[0].end < 3.2 && r.cues[1].start > 4.2);
});
