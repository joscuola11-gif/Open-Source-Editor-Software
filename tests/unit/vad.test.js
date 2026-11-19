import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chunkSegments, detectSpeech, energyAt, frameEnergies, inSpeech } from '../../src/core/vad.js';
import { decodeWav } from '../../src/core/wav.js';
import { speechLike } from '../helpers/speechlike.js';

const near = (a, b, eps, m = '') => assert.ok(Math.abs(a - b) <= eps, `${m} ${a} ≉ ${b} (±${eps})`);

test('frameEnergies: il silenzio è molto sotto la voce, le finestre sono quelle attese', () => {
  const x = speechLike([{ start: 1, end: 2 }], { duration: 3 });
  const e = frameEnergies(x, 16000);
  assert.ok(Math.abs(e.length - 298) <= 2, `finestre ${e.length}`);
  assert.ok(e[150] > e[20] + 20, `voce ${e[150].toFixed(1)} dB vs silenzio ${e[20].toFixed(1)} dB`);
});

test('detectSpeech: trova le parti parlate a tempi noti, con margini piccoli', () => {
  const bursts = [{ start: 0.5, end: 1.8 }, { start: 2.6, end: 3.4 }, { start: 4.5, end: 7.0 }];
  const x = speechLike(bursts, { duration: 8 });
  const { segments } = detectSpeech(x, 16000);
  assert.equal(segments.length, 3, JSON.stringify(segments));
  bursts.forEach((b, i) => {
    near(segments[i].start, b.start, 0.12, `inizio ${i}`);
    near(segments[i].end, b.end, 0.2, `fine ${i}`);
  });
});

test('detectSpeech: regge anche rumore forte (voce 15 dB sopra) e voce debole', () => {
  const bursts = [{ start: 1, end: 2.5 }, { start: 4, end: 5.2 }];
  for (const [noiseDb, voiceDb] of [[-40, -16], [-45, -30], [-55, -12]]) {
    const x = speechLike(bursts, { duration: 6.5, noiseDb, voiceDb, seed: 5 });
    const { segments } = detectSpeech(x, 16000);
    assert.equal(segments.length, 2, `rumore ${noiseDb} voce ${voiceDb}: ${JSON.stringify(segments)}`);
    near(segments[0].start, 1, 0.2);
    near(segments[1].end, 5.2, 0.25);
  }
});

test('detectSpeech: silenzio, solo rumore costante o audio vuoto non danno parlato', () => {
  assert.equal(detectSpeech(new Float32Array(16000 * 3), 16000).segments.length, 0);
  assert.equal(detectSpeech(new Float32Array(0), 16000).segments.length, 0);
  assert.equal(detectSpeech(speechLike([], { duration: 4, noiseDb: -35 }), 16000).segments.length, 0);
  assert.equal(detectSpeech(new Float32Array(10), 16000).segments.length, 0);
});

test('detectSpeech: pause brevi dentro una frase non la spezzano, le pause lunghe sì; i suoni cortissimi si ignorano', () => {
  const x = speechLike([{ start: 1, end: 1.8 }, { start: 2.0, end: 3.0 }, { start: 4.5, end: 5.5 }, { start: 7, end: 7.06 }], { duration: 8.5 });
  const { segments } = detectSpeech(x, 16000);
  assert.equal(segments.length, 2, JSON.stringify(segments));
  near(segments[0].start, 1, 0.12);
  near(segments[0].end, 3.0, 0.2);
});

test('detectSpeech: la sensibilità cambia quanto parlato debole viene accettato', () => {
  const x = speechLike([{ start: 1, end: 2 }, { start: 3, end: 4, }], { duration: 5, voiceDb: -18, noiseDb: -42, seed: 3 });
  const low = detectSpeech(x, 16000, { sensitivity: 0 }).segments;
  const high = detectSpeech(x, 16000, { sensitivity: 1 }).segments;
  const total = (s) => s.reduce((a, b) => a + b.end - b.start, 0);
  assert.ok(total(high) >= total(low) - 1e-9, 'più sensibile = almeno altrettanto parlato');
});

test('detectSpeech su voce umana vera (jfk.wav): parlato dalla prima parola alla fine, pause fra le frasi, niente nel silenzio iniziale', () => {
  const { channels, sampleRate } = decodeWav(new Uint8Array(readFileSync(new URL('../fixtures/jfk.wav', import.meta.url))));
  const v = detectSpeech(channels[0], sampleRate);
  assert.ok(v.segments.length >= 2 && v.segments.length <= 6, JSON.stringify(v.segments));
  assert.ok(v.segments[0].start > 0.1 && v.segments[0].start < 0.6, `prima voce a ${v.segments[0].start}`);
  assert.ok(v.segments.at(-1).end > 10.3, 'arriva alla fine');
  const speech = v.segments.reduce((a, b) => a + b.end - b.start, 0);
  assert.ok(speech > 8 && speech < 11, `parlato totale ${speech.toFixed(1)} s`);
  assert.ok(inSpeech(v.segments, 1.0) && !inSpeech(v.segments, 0.05));
  // dentro il parlato l'energia normalizzata è alta, nel silenzio iniziale bassa
  assert.ok(energyAt(v, 1.0) > 0.35 && energyAt(v, 0.05) < 0.2, `${energyAt(v, 1.0)} / ${energyAt(v, 0.05)}`);
});

test('chunkSegments: blocchi entro il massimo, spezzati solo nelle pause, con un po’ di margine; un parlato lunghissimo si divide in parti uguali', () => {
  const segs = [{ start: 0.5, end: 9 }, { start: 10, end: 20 }, { start: 21, end: 30 }, { start: 31, end: 40 }, { start: 50, end: 52 }];
  const chunks = chunkSegments(segs, { maxLen: 28, pad: 0.25, total: 60 });
  for (const c of chunks) assert.ok(c.end - c.start <= 28 + 0.5 + 1e-9, `blocco ${c.start}-${c.end}`);
  assert.ok(chunks.length >= 2);
  const covered = chunks.flatMap((c) => c.segments);
  assert.deepEqual(covered.map((s) => [s.start, s.end]).sort((a, b) => a[0] - b[0]), segs.map((s) => [s.start, s.end]));
  assert.ok(chunks[0].start >= 0 && chunks.at(-1).end <= 60);
  const long = chunkSegments([{ start: 0, end: 100 }], { maxLen: 30, total: 100 });
  assert.equal(long.length, 4);
  long.forEach((c) => near(c.end - c.start, 25, 0.6));
  assert.deepEqual(chunkSegments([], { total: 10 }), []);
});

test('detectSpeech: prova a caso (durate, rumore, posizioni) non fallisce e dà segmenti ordinati e dentro l’audio', () => {
  let s = 99;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let k = 0; k < 40; k++) {
    const dur = 2 + rnd() * 20;
    const bursts = [];
    let t = rnd() * 1.5;
    while (t < dur - 1) {
      const len = 0.3 + rnd() * 3;
      bursts.push({ start: t, end: Math.min(dur - 0.1, t + len) });
      t += len + 0.4 + rnd() * 2;
    }
    const x = speechLike(bursts, { duration: dur, noiseDb: -60 + rnd() * 25, voiceDb: -25 + rnd() * 12, seed: k + 1 });
    const { segments } = detectSpeech(x, 16000);
    let prevEnd = -1;
    for (const sg of segments) {
      assert.ok(sg.start >= 0 && sg.end <= dur + 1e-6 && sg.end > sg.start && sg.start >= prevEnd - 1e-9, `#${k} ${JSON.stringify(sg)}`);
      prevEnd = sg.end;
    }
  }
});
