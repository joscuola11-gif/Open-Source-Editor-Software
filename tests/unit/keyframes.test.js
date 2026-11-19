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
