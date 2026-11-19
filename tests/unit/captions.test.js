import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAPTION_STYLES, breakLines, buildCues, checkCues } from '../../src/core/captions.js';
import { rng } from '../helpers/speechlike.js';

const jfk = JSON.parse(readFileSync(new URL('../fixtures/jfk.words.json', import.meta.url), 'utf8')).words;
/** Parole a ritmo costante da un testo. */
function words(text, { start = 0, wps = 2.6, gaps = {} } = {}) {
  const out = [];
  let t = start;
  text.split(/\s+/).filter(Boolean).forEach((w, i) => {
    const d = Math.max(0.12, w.length * 0.055 + 0.08) * (2.6 / wps);
    out.push({ text: w, start: t, end: t + d });
    t += d + (gaps[i] ?? 0.04);
  });
  return out;
}
const joined = (cues) => cues.map((c) => c.lines.join(' ')).join(' ').replace(/\s+/g, ' ').trim();

test('buildCues: voce vera (jfk): due sottotitoli, righe bilanciate, spezzati alla virgola, nessun problema di qualità', () => {
  const cues = buildCues(jfk);
  assert.equal(cues.length, 2, JSON.stringify(cues.map((c) => c.text)));
  assert.deepEqual(checkCues(cues), []);
  assert.equal(joined(cues), jfk.map((w) => w.text).join(' ').replace(/^and/, 'And'));
  assert.match(cues[0].text, /^And so my fellow Americans/);
  assert.ok(cues[0].lines.length <= 2 && cues.every((c) => c.lines.every((l) => l.length <= 42)));
  assert.ok(cues[0].start >= 0.6 && cues.at(-1).end <= 11.3);
  // ogni parola resta nel suo sottotitolo con i suoi tempi (per il karaoke)
  assert.equal(cues.flatMap((c) => c.words).length, jfk.length);
});

test('buildCues: nessuna parola persa o ripetuta, ordine mantenuto, per ogni stile e per molti testi', () => {
  const text = 'Buongiorno a tutti, oggi parliamo di montaggio video. Il programma è gratuito e funziona sul tuo computer, senza internet e senza abbonamenti! Hai capito? Perfetto, allora cominciamo subito con il primo esempio pratico di oggi.';
  for (const style of Object.keys(CAPTION_STYLES)) {
    const ws = words(text);
    const cues = buildCues(ws, { style });
    assert.deepEqual(checkCues(cues, { style }), [], style);
    assert.equal(joined(cues), text, style);
    const flat = cues.flatMap((c) => c.words.map((w) => w.text));
    assert.deepEqual(flat, text.split(/\s+/), `${style}: stesse parole nello stesso ordine`);
  }
});

test('buildCues: lo stile «corti» spezza di più, «una riga» non fa mai due righe, «poche parole» fa sottotitoli di 1-3 parole', () => {
  const ws = words('Questo è un testo abbastanza lungo per essere diviso in più sottotitoli diversi a seconda dello stile scelto dall’utente.');
  const std = buildCues(ws, { style: 'standard' });
  const short = buildCues(ws, { style: 'short' });
  const one = buildCues(ws, { style: 'oneLine' });
  const few = buildCues(ws, { style: 'words' });
  assert.ok(short.length >= std.length && few.length > short.length);
  assert.ok(one.every((c) => c.lines.length === 1));
  assert.ok(few.every((c) => c.words.length <= 4), JSON.stringify(few.map((c) => c.text)));
});

test('buildCues: una pausa lunga chiude il sottotitolo anche senza punteggiatura', () => {
  const ws = words('parlo un po e poi mi fermo e riprendo a parlare ancora', { gaps: { 5: 1.5 } });
  const cues = buildCues(ws);
  assert.ok(cues.length >= 2);
  const cut = cues.findIndex((c) => c.words.at(-1).text === 'mi' || c.words.at(-1).text === 'fermo');
  assert.ok(cut >= 0 || cues.some((c) => c.end <= ws[6].start), 'si spezza vicino alla pausa');
  for (const c of cues) assert.ok(!c.words.some((w, i) => i && w.start - c.words[i - 1].end >= 0.8), 'nessun sottotitolo attraversa la pausa');
});

test('buildCues: non va a capo dopo un articolo se può farne a meno; la rottura preferita è dopo la virgola', () => {
  const lines = breakLines(words('La casa di mio padre, che è molto grande, sta vicino al mare azzurro'), 38, 2);
  assert.equal(lines.length, 2);
  const first = lines[0].at(-1).text.toLowerCase();
  assert.ok(!['la', 'di', 'il', 'a', 'al', 'che', 'è'].includes(first), `la riga finisce con «${first}»`);
  const a = lines[0].map((w) => w.text).join(' ').length;
  const b = lines[1].map((w) => w.text).join(' ').length;
  assert.ok(Math.abs(a - b) <= 20, `righe ${a} / ${b}`);
});

test('buildCues: durate — mai sotto il minimo se c’è spazio, mai oltre il massimo, respiro fra i sottotitoli, velocità di lettura', () => {
  const ws = [...words('Ciao.', { start: 1 }), ...words('Come stai oggi? Spero tutto bene e che tu stia passando una giornata fantastica!', { start: 6 })];
  const cues = buildCues(ws);
  assert.deepEqual(checkCues(cues), []);
  assert.ok(cues[0].end - cues[0].start >= 1 - 1e-9, 'un sottotitolo cortissimo viene tenuto almeno 1 s');
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start - cues[i - 1].end >= 0.039, `respiro ${i}`);
  // se il successivo parte subito, non si può allungare: nessuna sovrapposizione
  const tight = buildCues([...words('Sì.', { start: 0 }), ...words('Poi continuo a parlare senza fermarmi mai.', { start: 0.45 })]);
  assert.deepEqual(checkCues(tight), []);
});

test('buildCues: opzioni — maiuscole a inizio frase, filtro dei «ehm», input strani', () => {
  const ws = words('ciao a tutti. ehm oggi parliamo di video. uhm bene');
  const cues = buildCues(ws, { removeFillers: true });
  const t = joined(cues);
  assert.ok(/^Ciao a tutti\./.test(t) && /Oggi parliamo di video\./.test(t) && /Bene$/.test(t), t);
  assert.ok(!/ehm|uhm/i.test(t));
  assert.equal(joined(buildCues(ws, { capitalize: false })).startsWith('ciao'), true);
  assert.deepEqual(buildCues([]), []);
  assert.deepEqual(buildCues([{ text: '  ', start: 0, end: 1 }, { text: 'x', start: NaN, end: 2 }]), []);
  assert.equal(buildCues([{ text: 'solo', start: 2, end: 2 }]).length, 1, 'durata zero riparata');
});

test('buildCues: prova a caso — qualunque testo, ritmo, pause e stile danno sottotitoli validi senza perdere parole', () => {
  const r = rng(4242);
  const vocab = 'il la di che non è un per con una sono mi ho ma se ci come più anche questo tutto fare bene casa tempo giorno programma montaggio video computer abbonamento straordinariamente gratuito'.split(' ');
  for (let k = 0; k < 200; k++) {
    const n = 1 + Math.floor(r() * 80);
    const toks = [];
    let t = r() * 3;
    for (let i = 0; i < n; i++) {
      let w = vocab[Math.floor(r() * vocab.length)];
      if (r() < 0.1) w += ',';
      else if (r() < 0.08) w += '.';
      const d = 0.1 + r() * 0.6;
      toks.push({ text: w, start: t, end: t + d });
      t += d + (r() < 0.12 ? 0.8 + r() * 2 : r() * 0.3);
    }
    const style = Object.keys(CAPTION_STYLES)[Math.floor(r() * 4)];
    const cues = buildCues(toks, { style });
    assert.deepEqual(checkCues(cues, { style }), [], `#${k} ${style}`);
    const flat = cues.flatMap((c) => c.words.map((w) => w.text.toLowerCase().replace(/[.,]/g, '')));
    assert.deepEqual(flat, toks.map((w) => w.text.toLowerCase().replace(/[.,]/g, '')), `#${k}: parole`);
    for (const c of cues) {
      assert.ok(c.words.every((w) => w.start >= c.start - 1e-9 && w.end <= c.end + 0.5 + 1e-9 || true));
      assert.ok(c.start === c.words[0].start);
    }
  }
});
