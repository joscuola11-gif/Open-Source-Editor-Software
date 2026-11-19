// Suoni e musica generati: si misurano sul segnale (frequenze, durate, tempo, tonalità), non a orecchio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MUSIC_STYLES, SFX, SFX_GROUPS, chordOffsets, generateMusic, renderSfx, rng } from '../../src/core/synth.js';
import { dominantFrequency, fft, hann } from '../../src/core/dsp.js';
import { detectBeats } from '../../src/core/beats.js';
import { decodeWav, encodeWav } from '../../src/core/wav.js';

const SR = 44100;
const rms = (x, a = 0, b = x.length) => {
  let e = 0;
  for (let i = a; i < b; i++) e += x[i] * x[i];
  return Math.sqrt(e / Math.max(1, b - a));
};
const sec = (t) => Math.round(t * SR);
/** Centroide spettrale (Hz) di un tratto. */
function centroid(x, a, b) {
  let n = 1;
  while (n * 2 <= b - a && n < 16384) n *= 2;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const w = hann(n);
  for (let i = 0; i < n; i++) re[i] = (x[a + i] ?? 0) * w[i];
  fft(re, im);
  let num = 0;
  let den = 0;
  for (let k = 1; k < n / 2; k++) {
    const m = Math.hypot(re[k], im[k]);
    num += m * ((k * SR) / n);
    den += m;
  }
  return num / Math.max(1e-12, den);
}
/** Quota di energia sotto `f` Hz in tutto il segnale. */
function lowShare(x, f) {
  let n = 1;
  while (n * 2 <= x.length && n < 262144) n *= 2;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = x[i];
  fft(re, im);
  let lo = 0;
  let tot = 0;
  for (let k = 1; k < n / 2; k++) {
    const e = re[k] ** 2 + im[k] ** 2;
    tot += e;
    if ((k * SR) / n < f) lo += e;
  }
  return lo / tot;
}
/** Numero di «attacchi» (salite dell'inviluppo oltre una soglia, separati da almeno `gap` s). */
function onsets(x, { win = 0.004, gap = 0.04, rel = 0.25 } = {}) {
  const w = Math.round(win * SR);
  const env = [];
  for (let i = 0; i + w < x.length; i += w) env.push(rms(x, i, i + w));
  const max = Math.max(...env);
  const out = [];
  for (let i = 0; i < env.length; i++) {
    if (env[i] > rel * max && env[i] > (env[i - 1] ?? 0) * 1.8 && (!out.length || (i - out.at(-1)) * win >= gap)) out.push(i);
  }
  return out.map((i) => i * win);
}
const chroma = (x, from, to, lo = 60, hi = 900) => {
  let n = 1;
  while (n * 2 <= to - from && n < 131072) n *= 2;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const w = hann(n);
  for (let i = 0; i < n; i++) re[i] = x[from + i] * w[i];
  fft(re, im);
  const c = new Float64Array(12);
  for (let k = 1; k < n / 2; k++) {
    const f = (k * SR) / n;
    if (f < lo || f > hi) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    c[pc] += re[k] ** 2 + im[k] ** 2;
  }
  return c;
};
const peakOf = (x) => {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
};
const argmax = (a) => a.reduce((b, v, i) => (v > a[b] ? i : b), 0);
const pcOf = (key) => (key + 0) % 12; // Do = 0 = do (MIDI 36 ≡ 0 mod 12)

test('rng: deterministico e in [0, 1)', () => {
  const a = rng(5);
  const b = rng(5);
  const xs = Array.from({ length: 200 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 200 }, () => b()));
  assert.ok(xs.every((v) => v >= 0 && v < 1));
  assert.notDeepEqual(xs.slice(0, 5), Array.from({ length: 5 }, rng(6)));
});

test('effetti: tutti validi (finiti, stereo, né muti né saturi), deterministici e con più varianti', () => {
  assert.ok(SFX.length >= 25, `almeno 25 effetti (${SFX.length})`);
  assert.ok(SFX_GROUPS.length >= 5);
  assert.equal(new Set(SFX.map((s) => s.id)).size, SFX.length, 'id unici');
  for (const s of SFX) {
    const r = renderSfx(s.id, { seed: 1 });
    assert.equal(r.channels.length, 2);
    assert.equal(r.channels[0].length, r.channels[1].length);
    assert.ok(r.duration > 0.03 && r.duration < 12, `${s.id}: durata ${r.duration}`);
    let peak = 0;
    for (const c of r.channels) for (const v of c) { assert.ok(Number.isFinite(v), `${s.id}: valore non finito`); peak = Math.max(peak, Math.abs(v)); }
    assert.ok(peak > 0.3 && peak <= 0.99, `${s.id}: picco ${peak}`);
    assert.ok(rms(r.channels[0]) > 0.004, `${s.id}: muto`);
    // l'inizio e la fine non devono avere scatti
    assert.ok(Math.abs(r.channels[0].at(-1)) < 0.02, `${s.id}: fine con scatto`);
    const again = renderSfx(s.id, { seed: 1 });
    assert.deepEqual(again.channels[0].slice(0, 2000), r.channels[0].slice(0, 2000), `${s.id}: stesso seme, stesso suono`);
  }
  const a = renderSfx('whoosh', { seed: 1 }).channels[0];
  const b = renderSfx('whoosh', { seed: 2 }).channels[0];
  assert.notDeepEqual(a.slice(10000, 10010), b.slice(10000, 10010), 'un altro seme dà un’altra variante');
  assert.throws(() => renderSfx('inesistente'), /Effetto sconosciuto/);
});

test('effetti: altezza e volume', () => {
  const base = renderSfx('ding');
  const up = renderSfx('ding', { pitch: 12 });
  const down = renderSfx('ding', { pitch: -12 });
  assert.ok(Math.abs(up.duration / base.duration - 0.5) < 0.01, 'un’ottava sopra dura la metà');
  assert.ok(Math.abs(down.duration / base.duration - 2) < 0.02);
  const f0 = dominantFrequency(base.channels[0], SR, 0, 8192);
  const f1 = dominantFrequency(up.channels[0], SR, 0, 8192);
  assert.ok(Math.abs(f1 / f0 - 2) < 0.05, `frequenza ×2 (${f0} → ${f1})`);
  const quiet = renderSfx('ding', { volume: 0.3 });
  const peak = peakOf(quiet.channels[0]);
  assert.ok(Math.abs(peak - 0.3 * 0.98) < 0.01, `picco ${peak}`);
});

test('effetti: «Din» ha l’altezza giusta e «Notifica» fa due note', () => {
  const ding = renderSfx('ding').channels[0];
  const f = dominantFrequency(ding, SR, sec(0.02), 8192);
  assert.ok(Math.abs(f / 1175 - 1) < 0.03, `Din ≈ 1175 Hz (${f.toFixed(0)})`);
  const n = renderSfx('notify').channels[0];
  const f1 = dominantFrequency(n, SR, sec(0.02), 4096);
  const f2 = dominantFrequency(n, SR, sec(0.2), 4096);
  assert.ok(Math.abs(f1 / 880 - 1) < 0.03, `prima nota ≈ 880 (${f1.toFixed(0)})`);
  assert.ok(Math.abs(f2 / 1318.5 - 1) < 0.03, `seconda nota ≈ 1318 (${f2.toFixed(0)})`);
  const success = renderSfx('success').channels[0];
  const fs = [0.02, 0.11, 0.2, 0.29].map((t) => dominantFrequency(success, SR, sec(t), 2048));
  for (let i = 1; i < fs.length; i++) assert.ok(fs[i] > fs[i - 1] * 1.1, `Successo sale: ${fs.map(Math.round)}`);
});

test('effetti: il movimento fa quello che dice (whoosh, salita, discesa, laser)', () => {
  const w = renderSfx('whoosh').channels[0];
  const edge = Math.max(rms(w, 0, sec(0.05)), rms(w, w.length - sec(0.05)));
  assert.ok(rms(w, sec(0.3), sec(0.6)) > edge * 8, 'il whoosh nasce e si spegne');
  const r = renderSfx('riser').channels[0];
  assert.ok(rms(r, r.length - sec(0.6)) > rms(r, 0, sec(0.6)) * 6, 'la salita cresce di volume');
  assert.ok(centroid(r, r.length - sec(0.8), r.length - 100) > centroid(r, 0, sec(0.8)) * 1.8, 'la salita si fa più acuta');
  const d = renderSfx('downlifter').channels[0];
  assert.ok(centroid(d, 0, sec(0.4)) > centroid(d, sec(1.4), sec(1.8)) * 1.5, 'la discesa si fa più grave');
  assert.ok(rms(d, 0, sec(0.3)) > rms(d, d.length - sec(0.3)) * 4, 'e si spegne');
  const l = renderSfx('laser').channels[0];
  const early = dominantFrequency(l, SR, sec(0.01), 1024);
  const late = dominantFrequency(l, SR, sec(0.25), 1024);
  assert.ok(early > late * 1.6, `il laser scende di tono (${early.toFixed(0)} → ${late.toFixed(0)})`);
});

test('effetti: impatti e piccoli suoni (peso, durata, ripetizioni)', () => {
  assert.ok(lowShare(renderSfx('impact').channels[0], 250) > 0.8, 'l’impatto è quasi tutto grave');
  assert.ok(lowShare(renderSfx('thud').channels[0], 250) > 0.8);
  assert.ok(lowShare(renderSfx('click').channels[0], 600) < 0.15, 'il clic è acuto');
  const c = renderSfx('click').channels[0];
  assert.ok(rms(c, 0, sec(0.012)) ** 2 * sec(0.012) > 0.95 * rms(c) ** 2 * c.length, 'il clic finisce in 12 ms');
  const hb = onsets(renderSfx('heartbeat').channels[0], { win: 0.02, gap: 0.15, rel: 0.3 });
  assert.equal(hb.length, 8, `4 battiti doppi (${hb.map((v) => v.toFixed(2))})`);
  assert.ok(Math.abs(hb[1] - hb[0] - 0.28) < 0.06 && Math.abs(hb[2] - hb[0] - 1) < 0.06, 'distanze del cuore');
  assert.equal(onsets(renderSfx('tick').channels[0], { gap: 0.3 }).length, 4, 'quattro tic');
  assert.ok(onsets(renderSfx('typing').channels[0], { gap: 0.03, rel: 0.1 }).length >= 14, 'molti tasti');
  const e = renderSfx('error').channels[0];
  assert.ok(dominantFrequency(e, SR, sec(0.05), 4096) < 400, 'l’errore è un ronzio grave');
});

test('effetti: ambienti (pioggia, vento, applauso, vinile)', () => {
  const rain = renderSfx('rain').channels[0];
  assert.ok(centroid(rain, sec(1), sec(1) + 16384) > 2000, 'pioggia: acuta');
  const levels = [0, 2, 4, 6].map((t) => rms(rain, sec(t), sec(t + 2)));
  assert.ok(Math.max(...levels) / Math.min(...levels) < 1.5, `pioggia: costante (${levels.map((v) => v.toFixed(3))})`);
  const wind = renderSfx('wind').channels[0];
  assert.ok(centroid(wind, sec(1), sec(1) + 16384) < 1800, 'vento: grave');
  const wl = [0, 1, 2, 3, 4, 5, 6, 7].map((t) => rms(wind, sec(t), sec(t + 1)));
  assert.ok(Math.max(...wl) / Math.min(...wl) > 1.3, 'vento: a folate');
  const ap = renderSfx('applause').channels[0];
  assert.ok(rms(ap, sec(2), sec(3)) > rms(ap, 0, sec(0.4)) * 2 && rms(ap, sec(2), sec(3)) > rms(ap, ap.length - sec(0.4)) * 2, 'applauso: sale e scende');
  const cr = renderSfx('crackle').channels[0];
  const crest = peakOf(cr) / rms(cr);
  assert.ok(crest > 6, `vinile: rari scoppiettii (fattore di cresta ${crest.toFixed(1)})`);
  // i due canali delle ambienze sono diversi (stereo vero)
  assert.notDeepEqual(rain.slice(5000, 5020), renderSfx('rain').channels[1].slice(5000, 5020));
});

test('musica: durata esatta in battute, stereo, senza valori non validi, livello giusto', () => {
  for (const style of Object.keys(MUSIC_STYLES)) {
    const m = generateMusic({ style, seconds: 20, seed: 4 });
    const bar = 4 * 60 / m.bpm;
    assert.equal(m.channels.length, 2);
    assert.ok(Math.abs(m.duration - m.bars * bar) < 2 / SR, `${style}: durata ${m.duration} vs ${m.bars * bar}`);
    assert.ok(Math.abs(m.duration - 20) < bar, `${style}: vicina ai 20 s richiesti`);
    const [a, b] = MUSIC_STYLES[style].bpm;
    assert.ok(m.bpm >= a && m.bpm <= b, `${style}: tempo ${m.bpm} nella gamma`);
    let peak = 0;
    for (const c of m.channels) for (const v of c) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); }
    assert.ok(peak > 0.7 && peak <= 0.99, `${style}: picco ${peak}`);
    const db = 20 * Math.log10(rms(m.channels[0]));
    assert.ok(db > -28 && db < -9, `${style}: livello ${db.toFixed(1)} dBFS`);
    assert.ok(Math.abs(m.channels[0].at(-1)) < 0.01 && Math.abs(m.channels[0][0]) < 0.01, `${style}: nessuno scatto agli estremi`);
    // stereo vero: i canali non sono uguali
    let diff = 0;
    for (let i = 0; i < m.channels[0].length; i += 997) diff += Math.abs(m.channels[0][i] - m.channels[1][i]);
    assert.ok(diff > 1, `${style}: stereo`);
  }
  assert.equal(generateMusic({ bars: 4, bpm: 120, seed: 1 }).duration, 8);
  assert.throws(() => generateMusic({ style: 'inesistente' }), /Stile sconosciuto/);
});

test('musica: stesso seme = stessa musica, seme diverso = altra musica; bpm e tonalità scelti rispettati', () => {
  const a = generateMusic({ style: 'pop', bars: 4, seed: 7 });
  const b = generateMusic({ style: 'pop', bars: 4, seed: 7 });
  const c = generateMusic({ style: 'pop', bars: 4, seed: 8 });
  assert.deepEqual(a.channels[0].slice(0, 5000), b.channels[0].slice(0, 5000));
  assert.equal(a.key, b.key);
  assert.notDeepEqual(a.channels[0].slice(20000, 20020), c.channels[0].slice(20000, 20020));
  const d = generateMusic({ style: 'electro', bars: 2, bpm: 128, key: 5, mode: 'major', seed: 1 });
  assert.equal(d.bpm, 128);
  assert.equal(d.key, 5);
  assert.equal(d.mode, 'major');
  assert.equal(generateMusic({ bpm: 500, bars: 1 }).bpm, 200, 'tempo limitato');
});

test('musica: il tempo si sente (battiti rilevati dal nostro stesso rilevatore)', () => {
  const cases = [['pop', 100], ['pop', 124], ['electro', 120], ['electro', 128], ['chill', 80], ['corporate', 108]];
  for (const [style, bpm] of cases) {
    const m = generateMusic({ style, bpm, bars: Math.round((24 * bpm) / 240), seed: 3, fadeOut: 0 });
    const r = detectBeats(m.channels, SR);
    assert.ok(r.bpm, `${style} ${bpm}: nessun tempo rilevato`);
    assert.ok(Math.abs(r.bpm / bpm - 1) < 0.03 || Math.abs(r.bpm / bpm - 2) < 0.06 || Math.abs(r.bpm / bpm - 0.5) < 0.015, `${style}: voluto ${bpm}, rilevato ${r.bpm}`);
  }
});

test('musica: tonalità e accordi corretti (misurati sul suono)', () => {
  // niente batteria: si sente solo la parte tonale
  for (const [key, mode] of [[2, 'major'], [9, 'minor'], [7, 'major']]) {
    const m = generateMusic({ style: 'ambient', bars: 4, bpm: 70, key, mode, progression: [1, 1, 1, 1], seed: 2, fadeOut: 0 });
    const x = m.channels[0];
    const bar = 4 * 60 / 70;
    for (const b of [0, 1, 2]) {
      const c = chroma(x, Math.round((b * bar + 0.5) * SR), Math.round(((b + 1) * bar) * SR), 120, 700);
      assert.equal(argmax(c), pcOf(key), `tonica ${key} ${mode} battuta ${b + 1}: ${[...c].map((v) => v.toExponential(0))}`);
    }
  }
  // cambio di accordo: I → IV → V → I in Re maggiore (Re, Sol, La, Re)
  const m = generateMusic({ style: 'ambient', bars: 4, bpm: 70, key: 2, mode: 'major', progression: [1, 4, 5, 1], seed: 2, fadeOut: 0 });
  const bar = 4 * 60 / 70;
  const roots = [0, 1, 2, 3].map((b) => argmax(chroma(m.channels[0], Math.round((b * bar + 0.5) * SR), Math.round((b + 1) * bar * SR), 120, 500)));
  assert.deepEqual(roots, [2, 7, 9, 2], `radici ${roots}`);
});

test('musica: solo note della scala (fuori scala < 12% dell’energia dei picchi)', () => {
  for (const [style, key, mode] of [['ambient', 0, 'major'], ['chill', 9, 'minor'], ['corporate', 5, 'major'], ['epic', 4, 'minor']]) {
    const m = generateMusic({ style, bars: 8, key, mode, seed: 5, fadeOut: 0 });
    const x = m.channels[0];
    const c = chroma(x, sec(1), Math.min(x.length, sec(1) + 131072), 150, 1500);
    const scale = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] }[mode].map((s) => (s + key) % 12);
    const inScale = scale.reduce((s, pc) => s + c[pc], 0);
    const total = c.reduce((a, b) => a + b, 0);
    // la sensibile della minore armonica non c'è: tutte le note sono diatoniche
    assert.ok(inScale / total > 0.88, `${style}: ${((inScale / total) * 100).toFixed(0)}% in scala`);
  }
});

test('musica: gli strumenti entrano a poco a poco e la fine sfuma', () => {
  const m = generateMusic({ style: 'pop', bars: 16, bpm: 110, key: 0, seed: 9, fadeOut: 1.5 });
  const bar = 4 * 60 / 110;
  const x = m.channels[0];
  const barRms = (b) => rms(x, Math.round(b * bar * SR), Math.round((b + 1) * bar * SR));
  assert.ok(barRms(10) > barRms(0) * 1.05, 'dopo qualche battuta c’è più strumenti');
  const tail = rms(x, x.length - sec(0.2));
  const body = rms(x, sec(8), sec(10));
  assert.ok(tail < body * 0.25, `fine sfumata (${tail.toFixed(3)} vs ${body.toFixed(3)})`);
  // brani brevi: tutti gli strumenti dall'inizio
  const s = generateMusic({ style: 'pop', bars: 2, bpm: 110, seed: 9, fadeOut: 0 });
  assert.ok(rms(s.channels[0], 0, sec(1)) > 0.05);
});

test('accordi: triadi e settime sui gradi della scala', () => {
  assert.deepEqual(chordOffsets('major', 1), [0, 4, 7]);
  assert.deepEqual(chordOffsets('major', 5), [7, 11, 14]);
  assert.deepEqual(chordOffsets('major', 6), [9, 12, 16]);
  assert.deepEqual(chordOffsets('minor', 1), [0, 3, 7]);
  assert.deepEqual(chordOffsets('minor', 6), [8, 12, 15]);
  assert.deepEqual(chordOffsets('major', 1, true), [0, 4, 7, 11]);
});

test('i suoni si possono salvare e rileggere come WAV senza perdere nulla di udibile', () => {
  const r = renderSfx('coin');
  const back = decodeWav(encodeWav(r.channels, r.sampleRate));
  assert.equal(back.sampleRate, SR);
  assert.equal(back.channels[0].length, r.channels[0].length);
  let err = 0;
  for (let i = 0; i < r.channels[0].length; i++) err = Math.max(err, Math.abs(back.channels[0][i] - r.channels[0][i]));
  assert.ok(err < 1e-3, `errore ${err}`);
});
