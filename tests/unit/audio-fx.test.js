import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fft, dominantFrequency, biquad, filter, resample } from '../../src/core/dsp.js';
import { loudness, normalizeGain, applyGain, noiseReduceChannel, pitchShiftChannel, applyVoiceEffect, VOICE_EFFECTS, removeVoice, isolateVoice, timeStretch } from '../../src/core/audio-fx.js';
import { detectBeats } from '../../src/core/beats.js';
import { encodeWav, decodeWav } from '../../src/core/wav.js';

const SR = 22050;
const sine = (f, sec, amp = 0.5, sr = SR) => Float32Array.from({ length: Math.round(sec * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / sr));
const rms = (x, a = 0, b = x.length) => Math.sqrt(x.subarray(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const noise = (n, amp) => Float32Array.from({ length: n }, () => amp * rnd());

test('FFT: trasformata e inversa tornano al segnale; trova la frequenza giusta', () => {
  const x = Float64Array.from({ length: 256 }, (_, i) => Math.sin(i * 0.3) + 0.2 * Math.cos(i * 1.1));
  const re = Float64Array.from(x);
  const im = new Float64Array(256);
  fft(re, im);
  fft(re, im, true);
  for (let i = 0; i < 256; i++) assert.ok(Math.abs(re[i] - x[i]) < 1e-9);
  assert.ok(Math.abs(dominantFrequency(sine(1000, 1), SR) - 1000) < 10);
});

test('filtri: il passa-alto toglie i bassi, il passa-basso toglie gli acuti; il ricampionamento cambia la durata', () => {
  const low = sine(100, 1);
  const high = sine(5000, 1);
  const hp = biquad('highpass', SR, 1000);
  const lp = biquad('lowpass', SR, 1000);
  assert.ok(rms(filter(low, hp), 4000) < rms(low, 4000) * 0.05, 'bassi attenuati dal passa-alto');
  assert.ok(rms(filter(high, hp), 4000) > rms(high, 4000) * 0.9, 'acuti intatti');
  assert.ok(rms(filter(high, lp), 4000) < rms(high, 4000) * 0.05);
  assert.ok(rms(filter(low, lp), 4000) > rms(low, 4000) * 0.9);
  assert.throws(() => biquad('boh', SR, 100));
  const r = resample(sine(440, 1), 2);
  assert.ok(Math.abs(r.length - SR / 2) < 3);
  assert.ok(Math.abs(dominantFrequency(r, SR) - 880) < 12);
});

test('livelli: RMS di una sinusoide, silenzi ignorati, normalizzazione con tetto sul picco', () => {
  const a = loudness([sine(440, 2, 0.5)], SR);
  assert.ok(Math.abs(a.rmsDb - (20 * Math.log10(0.5 / Math.SQRT2))) < 0.3, `RMS ${a.rmsDb}`);
  assert.ok(Math.abs(a.peakDb - 20 * Math.log10(0.5)) < 0.1);
  // metà del file è silenzio: la media «con suono» non cambia
  const half = new Float32Array(SR * 4);
  half.set(sine(440, 2, 0.5));
  assert.ok(Math.abs(loudness([half], SR).rmsDb - a.rmsDb) < 0.5);
  assert.equal(loudness([new Float32Array(0)], SR).rmsDb, -120);
  const g = normalizeGain([sine(440, 2, 0.05)], SR, { targetDb: -16, ceilDb: -1 });
  const out = applyGain([sine(440, 2, 0.05)], g);
  assert.ok(Math.abs(loudness(out, SR).rmsDb + 16) < 0.5, 'portato a -16 dB');
  // un brano con un picco alto non deve saturare: il tetto vince
  const peaky = sine(440, 2, 0.05);
  peaky[1000] = 0.9;
  const g2 = normalizeGain([peaky], SR, { targetDb: -6, ceilDb: -1 });
  assert.ok(g2 * 0.9 <= 10 ** (-1 / 20) + 1e-6, 'picco sotto -1 dB');
  assert.equal(normalizeGain([new Float32Array(SR)], SR), 1, 'silenzio: nessun guadagno');
});

test('riduzione del rumore: migliora il rapporto segnale/rumore e conserva il segnale', () => {
  const n = SR * 4;
  const clean = new Float32Array(n);
  clean.set(sine(300, 2, 0.4), SR); // 1 s di silenzio, poi 2 s di tono, poi silenzio
  const hiss = noise(n, 0.08);
  const noisy = Float32Array.from(clean, (v, i) => v + hiss[i]);
  const den = noiseReduceChannel(noisy, { amount: 0.8 });
  assert.equal(den.length, noisy.length);
  const noiseBefore = rms(noisy, 0, SR * 0.8);
  const noiseAfter = rms(den, 0, SR * 0.8);
  assert.ok(noiseAfter < noiseBefore * 0.4, `rumore nei silenzi ${noiseBefore.toFixed(4)} → ${noiseAfter.toFixed(4)}`);
  const sigBefore = rms(noisy, SR * 1.3, SR * 2.7);
  const sigAfter = rms(den, SR * 1.3, SR * 2.7);
  assert.ok(sigAfter > sigBefore * 0.8, `il tono resta (${sigBefore.toFixed(3)} → ${sigAfter.toFixed(3)})`);
  assert.ok(Math.abs(dominantFrequency(den, SR, SR * 1.5) - 300) < 8, 'frequenza intatta');
  assert.ok(den.every(Number.isFinite));
  // meno intenso = più delicato
  const gentle = noiseReduceChannel(noisy, { amount: 0.2 });
  assert.ok(rms(gentle, 0, SR * 0.8) > noiseAfter, 'intensità minore toglie meno rumore');
  // segnali troppo corti non si rompono
  assert.equal(noiseReduceChannel(new Float32Array(100)).length, 100);
});

test('altezza del suono: un\'ottava su/giù e un semitono; la durata non cambia', () => {
  const x = sine(440, 2);
  const up = pitchShiftChannel(x, 12);
  const down = pitchShiftChannel(x, -12);
  const semi = pitchShiftChannel(x, 1);
  assert.equal(up.length, x.length);
  assert.ok(Math.abs(dominantFrequency(up, SR, 4000) - 880) < 15, 'ottava sopra');
  assert.ok(Math.abs(dominantFrequency(down, SR, 4000) - 220) < 8, 'ottava sotto');
  assert.ok(Math.abs(dominantFrequency(semi, SR, 4000) - 440 * 2 ** (1 / 12)) < 8, 'un semitono');
  assert.deepEqual(pitchShiftChannel(x, 0), x, 'zero = invariato');
  assert.ok(up.every(Number.isFinite) && Math.max(...up.map(Math.abs)) < 1.2, 'nessuna esplosione di ampiezza');
  assert.ok(rms(up, 4000, 20000) > 0.2 && rms(up, 4000, 20000) < 0.5, 'volume simile');
  const st = timeStretch(sine(440, 1), 2);
  assert.ok(Math.abs(st.length / SR - 2) < 0.2, 'allungato di circa il doppio');
  assert.ok(Math.abs(dominantFrequency(st, SR, 4000) - 440) < 8, 'senza cambiare l\'altezza');
});

test('voci ed effetti: tutti producono audio valido della lunghezza attesa, con la loro firma', () => {
  const x = [sine(220, 1.5, 0.4), sine(220, 1.5, 0.4)];
  for (const id of Object.keys(VOICE_EFFECTS)) {
    const out = applyVoiceEffect(x, SR, id);
    assert.equal(out.length, 2, id);
    assert.ok(out[0].length >= x[0].length - 8, `${id}: lunghezza`);
    assert.ok(out[0].every(Number.isFinite), `${id}: valori finiti`);
    assert.ok(Math.max(...out[0].map(Math.abs)) <= 1.6, `${id}: ampiezza ragionevole`);
    assert.ok(rms(out[0]) > 0.01, `${id}: non è silenzio`);
  }
  assert.ok(Math.abs(dominantFrequency(applyVoiceEffect(x, SR, 'high')[0], SR, 4000) - 220 * 2 ** (5 / 12)) < 8, 'voce acuta = +5 semitoni');
  assert.ok(Math.abs(dominantFrequency(applyVoiceEffect(x, SR, 'deep')[0], SR, 4000) - 220 * 2 ** (-5 / 12)) < 8);
  const hi = [sine(6000, 1, 0.4)];
  assert.ok(rms(applyVoiceEffect(hi, SR, 'telephone')[0], 4000) < rms(hi[0], 4000) * 0.3, 'il telefono toglie gli acuti');
  const echo = applyVoiceEffect([Float32Array.from({ length: SR }, (_, i) => (i < 100 ? 1 : 0))], SR, 'echo')[0];
  assert.ok(Math.abs(echo[Math.round(SR * 0.3) + 5]) > 0.05, 'si sente l\'eco dopo 0,3 s');
  assert.throws(() => applyVoiceEffect(x, SR, 'boh'));
});

test('togliere e isolare la voce in un brano stereo', () => {
  const n = SR * 2;
  const voice = sine(500, 2, 0.3); // uguale a sinistra e a destra (centro)
  const guitarL = sine(1500, 2, 0.3);
  const guitarR = Float32Array.from(guitarL, (v) => -v * 0.9); // opposta (laterale)
  const L = Float32Array.from(voice, (v, i) => v + guitarL[i]);
  const R = Float32Array.from(voice, (v, i) => v + guitarR[i]);
  const [nv] = removeVoice([L, R]);
  assert.ok(Math.abs(dominantFrequency(nv, SR, 2000) - 1500) < 10, 'resta la chitarra');
  assert.ok(rms(nv) > 0.2);
  const [only] = isolateVoice([L, R], SR);
  assert.ok(Math.abs(dominantFrequency(only, SR, 2000) - 500) < 10, 'resta la voce');
  assert.throws(() => removeVoice([L]), /stereo/);
  assert.equal(n, L.length);
});

test('ritmo: trova il tempo e i battiti di una base ritmica sintetica', () => {
  const click = (bpm, offset, sec = 10, sr = SR) => {
    const x = noise(Math.round(sec * sr), 0.01);
    const period = 60 / bpm;
    for (let t = offset; t < sec - 0.1; t += period) {
      const s = Math.round(t * sr);
      for (let i = 0; i < 700; i++) x[s + i] += 0.8 * Math.sin(i * 0.5) * Math.exp(-i / 150);
    }
    return x;
  };
  for (const [bpm, off] of [[120, 0.13], [90, 0.4], [150, 0.05]]) {
    const r = detectBeats([click(bpm, off)], SR);
    assert.ok(r.bpm && Math.abs(r.bpm - bpm) < bpm * 0.03, `${bpm} BPM → ${r.bpm}`);
    assert.ok(r.beats.length >= Math.floor((9.5 - off) / (60 / bpm)) - 1, `battiti trovati (${r.beats.length})`);
    const gaps = r.beats.slice(1).map((b, i) => b - r.beats[i]);
    assert.ok(gaps.every((g) => Math.abs(g - 60 / bpm) < 0.06), `intervalli regolari a ${bpm}`);
    const per = 60 / bpm;
    const ph = (((r.beats[0] - off) % per) + per) % per;
    assert.ok(Math.min(ph, per - ph) < 0.05, `in fase con i colpi (scarto ${Math.min(ph, per - ph).toFixed(3)} s)`);
  }
  assert.deepEqual(detectBeats([new Float32Array(SR * 5)], SR).beats, [], 'silenzio: nessun battito');
  assert.equal(detectBeats([noise(SR * 5, 0.2)], SR).bpm, null, 'rumore: nessun ritmo');
  assert.deepEqual(detectBeats([new Float32Array(100)], SR).beats, []);
});

test('WAV: scrittura e lettura senza perdite (16 bit), mono e stereo', () => {
  const ch = [sine(440, 0.2), sine(660, 0.2)];
  const bytes = encodeWav(ch, 44100);
  assert.equal(bytes.length, 44 + ch[0].length * 4);
  const back = decodeWav(bytes);
  assert.equal(back.sampleRate, 44100);
  assert.equal(back.channels.length, 2);
  for (let i = 0; i < ch[0].length; i += 37) assert.ok(Math.abs(back.channels[0][i] - ch[0][i]) < 1 / 16384);
  assert.throws(() => decodeWav(new Uint8Array(10)), /WAV/);
  const clipped = decodeWav(encodeWav([Float32Array.from([2, -2, 0.5])], 8000));
  assert.ok(clipped.channels[0][0] > 0.999 && clipped.channels[0][1] < -0.999, 'i valori fuori scala si limitano');
});
