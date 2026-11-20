// Prova con il MODELLO VERO (Whisper «tiny», dal pacchetto npm di sviluppo `sts-whisper-tiny`) e voce umana vera (jfk.wav):
// riconoscimento, tempi e sottotitoli fino in fondo, in Node. Se il modello non è installato la prova si salta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCues } from '../../src/core/captions.js';
import { transcribe } from '../../src/core/transcribe.js';
import { decodeWav } from '../../src/core/wav.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODELS = process.env.CIAK_ASR_MODELS || path.join(ROOT, 'node_modules', 'sts-whisper-tiny', 'models');
const have = existsSync(path.join(MODELS, 'Xenova', 'whisper-tiny', 'onnx', 'encoder_model_quantized.onnx'));
const skip = have ? false : 'modello non installato (npm i -D sts-whisper-tiny)';
const { createAsr } = require('../../desktop/asr.cjs');
const jfk = decodeWav(new Uint8Array(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'jfk.wav'))));

let asr;
let tmp;
const init = () => {
  tmp ??= mkdtempSync(path.join(os.tmpdir(), 'ciak-asr-'));
  asr ??= createAsr({ cacheDir: tmp, localModelsDir: MODELS, allowRemote: false });
  return asr;
};
test.after?.(() => tmp && rmSync(tmp, { recursive: true, force: true }));

test('motore Whisper: si avvia e riconosce la voce vera (jfk.wav) con le parole giuste', { skip }, async () => {
  const a = init();
  assert.deepEqual(await a.available(), { ok: true });
  const events = [];
  const r = await a.transcribe(jfk.channels[0], { language: 'en', model: 'tiny', onProgress: (e) => events.push(e.status) });
  const t = r.text.toLowerCase();
  for (const w of ['fellow americans', 'ask not', 'your country', 'do for you']) assert.ok(t.includes(w), `manca «${w}» in «${r.text}»`);
  assert.ok(r.words.length >= 18, `parole ${r.words.length}`);
  assert.ok(r.words.every((w) => w.end >= w.start && w.start >= 0 && w.end <= 11.5));
});

test('motore Whisper: lingua o modello sconosciuti danno errori chiari, «auto» non esiste, audio vuoto = testo vuoto', { skip }, async () => {
  const a = init();
  await assert.rejects(() => a.transcribe(jfk.channels[0], { language: 'auto' }), /Lingua non supportata/);
  await assert.rejects(() => a.transcribe(jfk.channels[0], { language: 'klingon' }), /Lingua non supportata/);
  await assert.rejects(() => a.transcribe(jfk.channels[0], { model: 'enorme' }), /Modello sconosciuto/);
  assert.deepEqual(await a.transcribe(new Float32Array(0), {}), { text: '', words: [] });
  await assert.rejects(() => a.transcribe(new Float32Array(16000 * 41), {}), /troppo lungo/);
});

test('motore Whisper: senza modello in locale e senza internet l’errore dice cosa fare', { skip }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ciak-asr-empty-'));
  try {
    const empty = createAsr({ cacheDir: dir, localModelsDir: dir, allowRemote: false });
    await assert.rejects(() => empty.transcribe(jfk.channels[0], { language: 'en', model: 'base' }), /scaricare il modello|Errore del modello/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tutta la catena con il modello vero: transcribe() → sottotitoli sensati, tempi dentro il parlato', { skip }, async () => {
  const a = init();
  const engine = { transcribe: (audio, o) => a.transcribe(audio, { language: o.language ?? 'en', model: 'tiny' }) };
  const r = await transcribe({ channels: jfk.channels, sampleRate: jfk.sampleRate, language: 'en', engine });
  assert.deepEqual(checkCues(r.cues), []);
  assert.ok(r.cues.length >= 2 && r.cues.length <= 4, JSON.stringify(r.cues.map((c) => c.text)));
  const text = r.cues.map((c) => c.text).join(' ').toLowerCase();
  assert.ok(text.includes('fellow americans') && text.includes('your country'), text);
  assert.ok(r.cues[0].start > 0.15 && r.cues[0].start < 0.9, `inizia a ${r.cues[0].start}`);
  assert.ok(r.cues.at(-1).end > 9.5 && r.cues.at(-1).end <= 11.6);
  // ogni parola cade dentro il parlato rilevato
  let inside = 0;
  for (const w of r.words) if (r.speech.some((s) => (w.start + w.end) / 2 >= s.start - 0.05 && (w.start + w.end) / 2 <= s.end + 0.05)) inside++;
  assert.ok(inside >= r.words.length - 1, `${inside}/${r.words.length}`);
});

test('motore Whisper: non carica «sharp» (nel pacchetto per Windows non c’è) e funziona lo stesso', { skip }, async () => {
  init();
  const loaded = Object.keys(require.cache).filter((k) => /node_modules[\\/]sharp[\\/]/.test(k));
  assert.deepEqual(loaded, [], 'sharp non deve essere caricato');
  assert.deepEqual(await asr.available(), { ok: true });
});

test('motore Whisper: «translate» scrive in inglese il parlato italiano (voce sintetica) e un compito sconosciuto dà errore', { skip }, async () => {
  const { spawnSync } = await import('node:child_process');
  const wav = path.join(tmp ?? mkdtempSync(path.join(os.tmpdir(), 'ciak-asr-')), 'it.wav');
  const r = spawnSync('espeak-ng', ['-v', 'it', '-s', '135', '-w', wav, 'Buongiorno a tutti, oggi parliamo del montaggio dei video e dei sottotitoli automatici.']);
  if (r.status !== 0) return; // senza sintetizzatore vocale nell'ambiente non si può provare
  const a = init();
  const { decodeWav: dec } = await import('../../src/core/wav.js');
  const { toMono16k } = await import('../../src/core/transcribe.js');
  const w = dec(new Uint8Array(readFileSync(wav)));
  const samples = toMono16k(w.channels, w.sampleRate);
  const it = await a.transcribe(samples, { language: 'it', model: 'tiny', task: 'transcribe' });
  const en = await a.transcribe(samples, { language: 'it', model: 'tiny', task: 'translate' });
  assert.ok(it.text.length > 10, `trascrizione: «${it.text}»`);
  assert.ok(en.text.length > 5, `traduzione: «${en.text}»`);
  assert.notEqual(en.text.toLowerCase(), it.text.toLowerCase(), 'la traduzione non è la stessa frase');
  assert.ok(/^[\x20-\x7e]+$/.test(en.text), `solo caratteri inglesi (senza accenti): «${en.text}»`);
  await assert.rejects(a.transcribe(samples, { language: 'it', model: 'tiny', task: 'volo' }), /Operazione sconosciuta/);
});
