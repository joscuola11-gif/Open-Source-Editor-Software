import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, autoAdjust, levelsCurve, matchColors, wheelFor } from '../../src/core/autocolor.js';
import { applyGrade, sanitizeGrade, defaultGrade } from '../../src/core/grade.js';

/** Fotogramma sintetico: rampa di grigio orizzontale con un po' di variazione verticale, ridotta a [lo, hi] e con una dominante. */
function frame({ lo = 0, hi = 1, cast = [1, 1, 1], w = 64, h = 36, gamma = 1, seed = 1 } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const base = (x / (w - 1)) ** gamma * 0.9 + 0.05 * rnd() + 0.05 * (y / h);
      const v = lo + clamp01(base) * (hi - lo);
      const i = (y * w + x) * 4;
      data[i] = clamp255(v * cast[0] * 255);
      data[i + 1] = clamp255(v * cast[1] * 255);
      data[i + 2] = clamp255(v * cast[2] * 255);
      data[i + 3] = 255;
    }
  }
  return { data, w, h };
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const clamp255 = (v) => Math.min(255, Math.max(0, Math.round(v)));
const run = (frames, grade) => frames.map((f) => ({ ...f, data: applyGrade(new Uint8ClampedArray(f.data), f.w, f.h, grade) }));
const spread = (mid) => Math.max(...mid) - Math.min(...mid);
/** Come il programma: correzione, poi saturazione (filtro CSS saturate). */
const runFull = (frames, result) => run(frames, result.grade).map((f) => {
  const k = 1 + result.adjust.saturation / 100;
  const d = f.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.213 * d[i] + 0.715 * d[i + 1] + 0.072 * d[i + 2];
    for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, Math.max(0, l + (d[i + c] - l) * k));
  }
  return f;
});

test('analyze: media, percentili, dominante e vivacità di immagini note', () => {
  const grey = analyze([frame({ lo: 0, hi: 1 })]);
  assert.ok(grey.q(0.5) > 0.35 && grey.q(0.5) < 0.65);
  assert.ok(grey.q(0.01) < 0.12 && grey.q(0.99) > 0.9);
  assert.ok(spread(grey.mid) < 0.01, 'grigio: nessuna dominante');
  assert.ok(grey.chroma < 0.01);
  const warm = analyze([frame({ cast: [1, 0.85, 0.65] })]);
  assert.ok(warm.mid[0] > warm.mid[2]);
  assert.ok(warm.chroma > 0.05);
  const dark = analyze([frame({ lo: 0, hi: 0.3 })]);
  assert.ok(dark.q(0.99) < 0.32);
  // pixel trasparenti ignorati, immagine vuota non rompe nulla
  const clear = { data: new Uint8ClampedArray(64 * 4), w: 8, h: 8 };
  assert.equal(analyze([clear]).n, 0);
  assert.equal(analyze([]).n, 0);
});

test('wheelFor: la ruota «toni medi» spinge nella direzione chiesta (verifica con applyGrade)', () => {
  for (const offset of [[0.05, -0.02, -0.03], [-0.04, 0.01, 0.03], [0.0, 0.05, -0.05], [0.03, 0.03, -0.06]]) {
    const w = wheelFor(offset);
    const g = defaultGrade();
    g.wheels.mids = w;
    const f = { data: new Uint8ClampedArray([128, 128, 128, 255]), w: 1, h: 1 };
    applyGrade(f.data, 1, 1, g);
    const got = [f.data[0] / 255 - 128 / 255, f.data[1] / 255 - 128 / 255, f.data[2] / 255 - 128 / 255];
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(got[c] - offset[c]) < 0.012, `${offset} → ${got.map((v) => v.toFixed(3))}`);
  }
  assert.deepEqual(wheelFor([0, 0, 0]), { hue: 0, amount: 0 });
});

test('levelsCurve: identità con amount 0, estremi vicini a 2 e 98, crescente', () => {
  const id = levelsCurve(0.1, 0.9, 1.2, 0);
  assert.deepEqual(id, [0, 25, 50, 75, 100]);
  const c = levelsCurve(0.2, 0.8, 1, 1);
  assert.ok(Math.abs(c[0] - 2) < 0.01 && Math.abs(c[4] - 98) < 0.01);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] >= c[i - 1]);
});

test('autoAdjust: un’immagine scura e piatta diventa luminosa e con contrasto', () => {
  const frames = [frame({ lo: 0.04, hi: 0.3, seed: 1 }), frame({ lo: 0.05, hi: 0.32, seed: 2 })];
  const r = autoAdjust(frames);
  const out = analyze(run(frames, r.grade));
  assert.ok(out.q(0.5) > 0.35 && out.q(0.5) < 0.6, `mediana ${out.q(0.5).toFixed(2)}`);
  assert.ok(out.q(0.99) - out.q(0.01) > 0.8, `escursione ${(out.q(0.99) - out.q(0.01)).toFixed(2)}`);
  assert.ok(analyze(frames).q(0.5) < 0.25);
  assert.deepEqual(sanitizeGrade(r.grade), r.grade, 'il risultato è un grade valido');
});

test('autoAdjust: un’immagine bruciata si scurisce e rientra nei limiti', () => {
  const frames = [frame({ lo: 0.6, hi: 1, seed: 3 })];
  const r = autoAdjust(frames);
  const out = analyze(run(frames, r.grade));
  assert.ok(out.q(0.5) > 0.35 && out.q(0.5) < 0.62, `mediana ${out.q(0.5).toFixed(2)}`);
  assert.ok(out.q(0.01) < 0.12);
});

test('autoAdjust: toglie una dominante di colore (blu, calda, verde)', () => {
  for (const cast of [[0.75, 0.9, 1], [1, 0.85, 0.65], [0.85, 1, 0.8]]) {
    const frames = [frame({ cast, seed: 4 }), frame({ cast, seed: 5, lo: 0.05, hi: 0.95 })];
    const r = autoAdjust(frames);
    const before = spread(analyze(frames).mid);
    const after = spread(analyze(run(frames, r.grade)).mid);
    assert.ok(after < before * 0.35, `${cast}: dominante ${before.toFixed(3)} → ${after.toFixed(3)}`);
    assert.ok(after < 0.03);
  }
});

test('autoAdjust: un’immagine già buona resta quasi uguale', () => {
  const frames = [frame({ lo: 0.02, hi: 0.98, gamma: 1.3, seed: 6 })];
  const r = autoAdjust(frames);
  const out = analyze(run(frames, r.grade));
  const inn = analyze(frames);
  assert.ok(Math.abs(out.q(0.5) - inn.q(0.5)) < 0.12, 'mediana simile');
  assert.ok(r.grade.wheels.mids.amount < 5);
  assert.equal(r.adjust.saturation, 0);
});

test('autoAdjust: «amount» 0 non cambia nulla, a metà cambia la metà', () => {
  const frames = [frame({ lo: 0.04, hi: 0.3 })];
  const none = autoAdjust(frames, { amount: 0 });
  assert.deepEqual(none.grade.curve, [0, 25, 50, 75, 100]);
  assert.equal(none.grade.wheels.mids.amount, 0);
  const half = autoAdjust(frames, { amount: 0.5 });
  const full = autoAdjust(frames, { amount: 1 });
  const m = (x) => analyze(run(frames, x.grade)).q(0.5);
  assert.ok(m(none) < m(half) && m(half) < m(full));
});

test('autoAdjust: immagine vuota o minuscola non lancia e restituisce un grade neutro', () => {
  assert.deepEqual(autoAdjust([]).grade, defaultGrade());
  const tiny = { data: new Uint8ClampedArray([10, 20, 30, 255]), w: 1, h: 1 };
  assert.deepEqual(autoAdjust([tiny]).grade, defaultGrade());
});

test('matchColors: il clip scuro e freddo prende luminosità e dominante del riferimento caldo e luminoso', () => {
  const src = [frame({ lo: 0.03, hi: 0.5, cast: [0.8, 0.95, 1], seed: 7 })];
  const ref = analyze([frame({ lo: 0.1, hi: 0.95, cast: [1, 0.88, 0.7], seed: 8 })]);
  const r = matchColors(src, ref);
  const out = analyze(runFull(src, r));
  assert.ok(Math.abs(out.q(0.5) - ref.q(0.5)) < 0.06, `mediana ${out.q(0.5).toFixed(2)} vs ${ref.q(0.5).toFixed(2)}`);
  assert.ok(Math.abs(out.q(0.9) - ref.q(0.9)) < 0.08, 'luci');
  const ratio = (m) => [m[0] / m[1], m[2] / m[1]];
  const a = ratio(out.mid);
  const b = ratio(ref.mid);
  assert.ok(Math.abs(a[0] - b[0]) < 0.06 && Math.abs(a[1] - b[1]) < 0.06, `dominante ${a.map((v) => v.toFixed(2))} vs ${b.map((v) => v.toFixed(2))}`);
  assert.deepEqual(sanitizeGrade(r.grade), r.grade);
  // già uguali: quasi nessun cambiamento
  const same = matchColors(src, analyze(src));
  const outSame = analyze(run(src, same.grade));
  assert.ok(Math.abs(outSame.q(0.5) - analyze(src).q(0.5)) < 0.03);
});

test('autoAdjust e matchColors: prova a caso, il grade è sempre valido e le immagini non vengono modificate', () => {
  let s = 77;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let k = 0; k < 120; k++) {
    const lo = rnd() * 0.5;
    const hi = lo + 0.05 + rnd() * (1 - lo - 0.05);
    const cast = [0.6 + rnd() * 0.4, 0.6 + rnd() * 0.4, 0.6 + rnd() * 0.4];
    const frames = [frame({ lo, hi, cast, gamma: 0.5 + rnd() * 2, seed: k + 1 })];
    const snap = Buffer.from(frames[0].data).toString('base64');
    const a = autoAdjust(frames, { amount: rnd() });
    assert.deepEqual(sanitizeGrade(a.grade), a.grade, `#${k}`);
    assert.ok(a.adjust.saturation >= -30 && a.adjust.saturation <= 40);
    const ref = analyze([frame({ lo: rnd() * 0.4, hi: 0.6 + rnd() * 0.4, cast: [1, 0.7 + rnd() * 0.3, 0.6 + rnd() * 0.4], seed: 500 + k })]);
    const m = matchColors(frames, ref, { amount: rnd() });
    assert.deepEqual(sanitizeGrade(m.grade), m.grade, `#${k} match`);
    assert.ok(m.grade.curve.every((v, i, arr) => i === 0 || v >= arr[i - 1]), 'curva crescente');
    assert.equal(Buffer.from(frames[0].data).toString('base64'), snap, 'i fotogrammi in ingresso non cambiano');
  }
});
