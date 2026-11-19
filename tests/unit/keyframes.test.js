import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClip } from '../../src/core/project.js';
import { valueAt, upsertKeyframe, removeKeyframeAt, toggleKeyframe, setValueAt, splitKeyframes, hasKeyframes, keyframeIndexAt } from '../../src/core/keyframes.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('senza keyframe restituisce il valore base', () => {
  const c = createClip('image');
  c.transform.scale = 1.5;
  near(valueAt(c, 'scale', 0), 1.5);
  c.volume = 0.3;
  near(valueAt(c, 'volume', 2), 0.3);
});

test('interpolazione lineare, prima/dopo i keyframe restano costanti', () => {
  const c = createClip('image');
  upsertKeyframe(c, 'x', 1, 0);
  upsertKeyframe(c, 'x', 3, 1);
  near(valueAt(c, 'x', 0), 0);
  near(valueAt(c, 'x', 2), 0.5);
  near(valueAt(c, 'x', 2.5), 0.75);
  near(valueAt(c, 'x', 99), 1);
});

test('upsert mantiene l’ordine e aggiorna un keyframe vicino invece di duplicarlo', () => {
  const c = createClip('image');
  upsertKeyframe(c, 'y', 2, 2);
  upsertKeyframe(c, 'y', 0, 0);
  upsertKeyframe(c, 'y', 1, 1);
  upsertKeyframe(c, 'y', 1.00001, 5);
  assert.deepEqual(c.keyframes.y.map((k) => k.t), [0, 1, 2]);
  near(c.keyframes.y[1].v, 5);
});

test('easing: hold, ease-in e ease-out', () => {
  const c = createClip('image');
  upsertKeyframe(c, 'opacity', 0, 0, 'hold');
  upsertKeyframe(c, 'opacity', 2, 1);
  near(valueAt(c, 'opacity', 1.9), 0);
  const d = createClip('image');
  upsertKeyframe(d, 'opacity', 0, 0, 'ease-in');
  upsertKeyframe(d, 'opacity', 2, 1);
  assert.ok(valueAt(d, 'opacity', 1) < 0.5);
  const e = createClip('image');
  upsertKeyframe(e, 'opacity', 0, 0, 'ease-out');
  upsertKeyframe(e, 'opacity', 2, 1);
  assert.ok(valueAt(e, 'opacity', 1) > 0.5);
  near(valueAt(e, 'opacity', 2), 1);
});

test('toggle/remove/setValueAt (auto-key)', () => {
  const c = createClip('image');
  assert.equal(toggleKeyframe(c, 'scale', 1), true);
  assert.ok(hasKeyframes(c, 'scale'));
  setValueAt(c, 'scale', 2, 3);                  // con keyframe: scrive un keyframe
  assert.equal(c.keyframes.scale.length, 2);
  near(c.transform.scale, 1);                    // il valore base non cambia
  assert.equal(toggleKeyframe(c, 'scale', 1), false);
  assert.equal(removeKeyframeAt(c, 'scale', 2), true);
  assert.equal(c.keyframes.scale, undefined);
  setValueAt(c, 'scale', 0, 2);                  // senza keyframe: modifica la base
  near(c.transform.scale, 2);
  assert.equal(keyframeIndexAt(c, 'scale', 0), -1);
});

test('splitKeyframes: valore continuo al taglio con easing', () => {
  const c = createClip('image');
  upsertKeyframe(c, 'x', 0, 0, 'ease-in-out');
  upsertKeyframe(c, 'x', 4, 1, 'linear');
  const s = 1.7;
  const v = valueAt(c, 'x', s);
  const { left, right } = splitKeyframes(c, s);
  const L = { ...c, keyframes: left };
  const R = { ...c, keyframes: right };
  near(valueAt(L, 'x', s), v);
  near(valueAt(R, 'x', 0), v);
  near(valueAt(R, 'x', 4 - s), 1);
  near(valueAt(L, 'x', 0), 0);
});

// ---------------------------------------------------------------- curve di Bézier
import { BEZIER_PRESETS, bezierString, cubicBezier, parseBezier, sanitizeEasing, easeFn as easeFnB, valueAt as valueAtB } from '../../src/core/keyframes.js';

test('Bézier: estremi 0 e 1, la curva (0,0,1,1) è lineare, valori noti del CSS «ease»', () => {
  const f = cubicBezier(0.25, 0.1, 0.25, 1);
  assert.equal(f(0), 0);
  assert.equal(f(1), 1);
  assert.ok(Math.abs(f(0.5) - 0.8024) < 0.002, `ease a metà ${f(0.5)}`);
  assert.ok(Math.abs(f(0.25) - 0.4095) < 0.003, `ease a un quarto ${f(0.25)}`);
  const lin = cubicBezier(0, 0, 1, 1);
  for (let x = 0; x <= 1; x += 0.05) assert.ok(Math.abs(lin(x) - x) < 1e-5);
  // fuori dall'intervallo si limita
  assert.equal(f(-3), 0);
  assert.equal(f(7), 1);
});

test('Bézier: con punti di controllo normali la curva è monotona; con anticipo e superamento esce da [0,1]', () => {
  for (const b of [[0.42, 0, 0.58, 1], [0.55, 0, 1, 0.45], [0, 0.55, 0.45, 1], [0.9, 0, 0.1, 1]]) {
    const f = cubicBezier(...b);
    let prev = -1;
    for (let x = 0; x <= 1; x += 0.01) {
      const y = f(x);
      assert.ok(y >= prev - 1e-9, `${b}: monotona a ${x}`);
      prev = y;
    }
  }
  const back = cubicBezier(0.34, 1.56, 0.64, 1);
  assert.ok(Math.max(...Array.from({ length: 101 }, (_, i) => back(i / 100))) > 1.05, 'supera il valore finale');
  const wind = cubicBezier(0.68, -0.55, 0.27, 1.55);
  assert.ok(Math.min(...Array.from({ length: 101 }, (_, i) => wind(i / 100))) < -0.05, 'prima va all’indietro');
});

test('Bézier: lettura del testo, rifiuto di valori non validi, pulizia dei progetti letti da file', () => {
  assert.deepEqual(parseBezier('bezier(0.42, 0, 0.58, 1)'), [0.42, 0, 0.58, 1]);
  assert.deepEqual(parseBezier('bezier(0,-0.5,1,1.5)'), [0, -0.5, 1, 1.5]);
  for (const bad of ['bezier(2,0,1,1)', 'bezier(0.5,0,-1,1)', 'bezier(a,b,c,d)', 'bezier(0,0,1)', 'bezier(0,9,1,1)', 'linear', '', null, 'bezier(0,0,1,1) ; drop']) assert.equal(parseBezier(bad), null, String(bad));
  assert.equal(bezierString(0.123456, 0, 1, 1.004), 'bezier(0.12,0,1,1)');
  assert.equal(sanitizeEasing('ease-in-out'), 'ease-in-out');
  assert.equal(sanitizeEasing('bezier(0.4,0,0.2,1)'), 'bezier(0.4,0,0.2,1)');
  assert.equal(sanitizeEasing('bezier(9,9,9,9)'), 'linear');
  assert.equal(sanitizeEasing(42), 'linear');
  assert.equal(sanitizeEasing('magia'), 'linear');
  // easeFn con valori strani non lancia
  assert.equal(easeFnB('bezier(x)')(0.3), 0.3);
  assert.equal(easeFnB(undefined)(0.3), 0.3);
});

test('Bézier: i keyframe interpolano con la curva scelta e i presets sono coerenti', () => {
  const clip = { keyframes: { x: [{ t: 0, v: 0, e: 'bezier(0.9,0,0.1,1)' }, { t: 2, v: 10, e: 'linear' }] }, transform: { x: 0 }, volume: 1 };
  const mid = valueAtB(clip, 'x', 1);
  assert.ok(Math.abs(mid - 5) < 0.01, 'una curva simmetrica passa per il centro');
  const early = valueAtB(clip, 'x', 0.3);
  assert.ok(early < 1.5 * (0.3 / 2) * 10, `a inizio resta indietro rispetto alla lineare (${early})`);
  for (const p of BEZIER_PRESETS) {
    assert.equal(sanitizeEasing(p.e), p.e === 'linear' ? 'linear' : p.e, p.id);
    if (p.e !== 'linear') assert.deepEqual(parseBezier(p.e), p.b, p.id);
  }
});
