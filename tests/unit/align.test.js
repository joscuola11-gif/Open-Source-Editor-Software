import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alignScript, assignWords, tokenize } from '../../src/core/align.js';
import { detectSpeech } from '../../src/core/vad.js';
import { decodeWav } from '../../src/core/wav.js';
import { rng, speechLike } from '../helpers/speechlike.js';

test('tokenize: parole con punteggiatura attaccata, spazi e righe vuote ignorati, solo simboli scartati', () => {
  assert.deepEqual(tokenize('  Ciao,  mondo!\n\nCome  stai? — ok  '), ['Ciao,', 'mondo!', 'Come', 'stai?', 'ok']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize('... --- !!!'), []);
  assert.deepEqual(tokenize("l'amico è qui"), ["l'amico", 'è', 'qui']);
});

test('assignWords: le parole vanno alle parti parlate in proporzione alla durata, in ordine, usandole tutte', () => {
  const texts = 'uno due tre quattro cinque sei sette otto nove dieci'.split(' ');
  const weights = texts.map(() => 2);
  const segs = [{ start: 0, end: 2 }, { start: 3, end: 7 }, { start: 8, end: 9 }];
  const ranges = assignWords(weights, segs, texts);
  assert.equal(ranges[0][0], 0);
  assert.equal(ranges.at(-1)[1], texts.length);
  for (let j = 1; j < ranges.length; j++) assert.equal(ranges[j][0], ranges[j - 1][1]);
  const counts = ranges.map(([a, b]) => b - a);
  assert.ok(counts[1] > counts[0] && counts[0] >= counts[2], `parole per parte ${counts}`);
});

test('assignWords: una parte di solo rumore (poche sillabe di troppo) può essere saltata; più parti che frasi funziona', () => {
  const texts = 'a bb ccc dddd'.split(' ');
  const r = assignWords(texts.map(() => 2), [{ start: 0, end: 4 }, { start: 5, end: 5.15 }, { start: 6, end: 10 }], texts);
  assert.equal(r[1][1] - r[1][0], 0, 'la parte brevissima resta vuota');
  assert.equal(r.reduce((a, [x, y]) => a + y - x, 0), 4);
  assert.deepEqual(assignWords([], [{ start: 0, end: 1 }], []), [[0, 0]]);
  assert.deepEqual(assignWords([1, 1], [], ['a', 'b']), []);
});

test('alignScript: audio sintetico a parole note — errore medio sugli inizi sotto 0.12 s', () => {
  const r = rng(11);
  const text = 'questa è una prova di allineamento molto semplice, con parole brevi e lunghe. Poi continuo a parlare per un altro po di tempo.';
  const toks = tokenize(text);
  const truth = [];
  let t = 0.5;
  toks.forEach((w, i) => {
    const syl = Math.max(1, Math.round(w.length / 3));
    const d = syl * 0.17 + 0.06;
    truth.push({ text: w, start: t, end: t + d });
    t += d + (/[.,]$/.test(w) ? 0.55 + r() * 0.3 : 0.1 + r() * 0.1);
  });
  const audio = speechLike(truth.map((w) => ({ start: w.start, end: w.end })), { duration: t + 0.6, seed: 8 });
  const words = alignScript(text, audio, 16000);
  assert.equal(words.length, toks.length);
  let err = 0;
  words.forEach((w, i) => {
    assert.equal(w.text, toks[i]);
    err += Math.abs(w.start - truth[i].start);
    if (i) assert.ok(w.start >= words[i - 1].start);
  });
  assert.ok(err / words.length < 0.12, `errore medio ${(err / words.length).toFixed(3)} s`);
});

test('alignScript: senza parlato nell’audio distribuisce comunque le parole (nessun errore); testo vuoto → niente', () => {
  const silence = new Float32Array(16000 * 4);
  const w = alignScript('una frase qualsiasi qui', silence, 16000);
  assert.equal(w.length, 4);
  assert.ok(w.every((x, i) => x.end > x.start && (!i || x.start >= w[i - 1].start)));
  assert.deepEqual(alignScript('', silence, 16000), []);
});

test('alignScript sulla voce vera (jfk.wav): le parole del testo cadono nel parlato e in ordine', () => {
  const { channels, sampleRate } = decodeWav(new Uint8Array(readFileSync(new URL('../fixtures/jfk.wav', import.meta.url))));
  const text = 'And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country.';
  const vad = detectSpeech(channels[0], sampleRate);
  const words = alignScript(text, channels[0], sampleRate, { vad });
  assert.equal(words.length, 22);
  let inside = 0;
  words.forEach((w, i) => {
    if (i) assert.ok(w.start >= words[i - 1].start - 1e-9);
    const mid = (w.start + w.end) / 2;
    if (vad.segments.some((s) => mid >= s.start - 0.05 && mid <= s.end + 0.05)) inside++;
    assert.ok(w.end - w.start >= 0.06 && w.end - w.start <= 1.5, `${w.text} ${(w.end - w.start).toFixed(2)}`);
  });
  assert.ok(inside >= 21, `${inside}/22 nel parlato`);
  assert.ok(words[0].start > 0.15 && words[0].start < 0.9 && words.at(-1).end > 9.5 && words.at(-1).end <= 11.01);
  // le pause vere (dopo «Americans,», dopo «ask not», dopo «you,») separano le frasi come le ha dette chi parla
  const pause = (a, b) => words.find((w) => w.text === b).start - words.find((w) => w.text === a).end;
  assert.ok(pause('Americans,', 'ask') >= 0.5, `pausa dopo Americans: ${pause('Americans,', 'ask').toFixed(2)} s`);
  assert.ok(pause('not', 'what') >= 0.5, `pausa dopo ask not: ${pause('not', 'what').toFixed(2)} s`);
  // il numero di sillabe contate nell'audio decide dove sta «ask not» (2 sillabe) e dove «what your country can do for you,» (8)
  const at = (w) => words.find((x) => x.text === w);
  assert.ok(at('ask').start > 3 && at('ask').start < 3.6 && at('what').start > 5.2 && at('what').start < 5.6, 'ask a ~3,3 s, what a ~5,4 s');
});

// --- Con una voce sintetica vera (espeak-ng) e tempi di verità noti: ogni parola è sintetizzata a parte e poi incollata ---
const espeak = spawnSync('espeak-ng', ['--version']).status === 0;
test('alignScript con voce sintetica vera (espeak-ng, parole incollate a tempi noti): inizio parola entro 0.15 s di mediana, 0.3 s al 90%', { skip: !espeak && 'espeak-ng non installato' }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ciak-align-'));
  try {
    const text = 'buongiorno a tutti, oggi parliamo di montaggio video. Il programma è gratuito e funziona sul tuo computer.';
    const toks = tokenize(text);
    const r = rng(5);
    const sr = 16000;
    const chunks = [];
    const truth = [];
    let pos = 0.4;
    chunks.push({ at: 0, data: new Float32Array(Math.round(0.4 * sr)) });
    const ffmpeg = process.env.CIAK_FFMPEG || 'ffmpeg';
    toks.forEach((w, i) => {
      const f = path.join(dir, `w${i}.wav`);
      execFileSync('espeak-ng', ['-v', 'it', '-s', '150', '-w', f, w.replace(/[.,]/g, '')]);
      const raw = execFileSync(ffmpeg, ['-v', 'error', '-i', f, '-f', 'f32le', '-ac', '1', '-ar', String(sr), '-']);
      const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
      // si tolgono silenzio iniziale e finale di espeak per avere la verità esatta
      let a = 0;
      let b = x.length - 1;
      while (a < b && Math.abs(x[a]) < 0.01) a++;
      while (b > a && Math.abs(x[b]) < 0.01) b--;
      const seg = x.slice(a, b + 1);
      truth.push({ text: w, start: pos, end: pos + seg.length / sr });
      chunks.push({ data: seg });
      const gap = /[.,]$/.test(w) ? 0.6 + r() * 0.3 : 0.15 + r() * 0.15;
      chunks.push({ data: new Float32Array(Math.round(gap * sr)) });
      pos += seg.length / sr + gap;
    });
    chunks.push({ data: new Float32Array(sr) });
    const total = chunks.reduce((n, c) => n + c.data.length, 0);
    const audio = new Float32Array(total);
    let o = 0;
    for (const c of chunks) {
      audio.set(c.data, o);
      o += c.data.length;
    }
    const words = alignScript(text, audio, sr);
    assert.equal(words.length, toks.length);
    if (process.env.ALIGN_DEBUG) console.log(words.map((w, i) => `${w.text} got ${w.start.toFixed(2)}-${w.end.toFixed(2)} truth ${truth[i].start.toFixed(2)}-${truth[i].end.toFixed(2)}`).join('\n') + '\nVAD ' + JSON.stringify(detectSpeech(audio, sr).segments.map((s) => [+s.start.toFixed(2), +s.end.toFixed(2)])));
    const errs = words.map((w, i) => Math.abs(w.start - truth[i].start)).sort((a, b) => a - b);
    const med = errs[Math.floor(errs.length / 2)];
    const p90 = errs[Math.floor(errs.length * 0.9)];
    assert.ok(med < 0.08, `errore mediano ${med.toFixed(3)} s`);
    assert.ok(p90 < 0.15, `errore al 90% ${p90.toFixed(3)} s`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
