import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_IDS, applyCameraMove, cameraKeyframes, clearCameraMove } from '../../src/core/camera.js';
import { createClip, createProject, sanitizeProject } from '../../src/core/project.js';
import { valueAt } from '../../src/core/keyframes.js';
import { addClip, validateProject } from '../../src/core/timeline.js';

const clip = (d = 4, tf = {}) => createClip('image', { mediaId: 'm', duration: d, transform: tf });

test('zoom avanti/indietro: scala crescente (o decrescente) e mai sotto il valore di partenza', () => {
  const c = clip(5);
  applyCameraMove(c, 'zoom-in', { amount: 100 });
  let prev = valueAt(c, 'scale', 0);
  assert.equal(prev, 1);
  for (let t = 0.25; t <= 5; t += 0.25) {
    const v = valueAt(c, 'scale', t);
    assert.ok(v >= prev - 1e-9, `non scende (${t}: ${v} < ${prev})`);
    prev = v;
  }
  assert.ok(Math.abs(valueAt(c, 'scale', 5) - 1.35) < 1e-9);
  applyCameraMove(c, 'zoom-out', { amount: 100 });
  assert.ok(Math.abs(valueAt(c, 'scale', 0) - 1.35) < 1e-9);
  assert.equal(valueAt(c, 'scale', 5), 1);
});

test('panoramiche: l’immagine non scopre mai i bordi (la scala copre lo spostamento) e la direzione è giusta', () => {
  for (const id of ['pan-left', 'pan-right', 'tilt-up', 'tilt-down']) {
    for (const amount of [10, 50, 100]) {
      const c = clip(4);
      applyCameraMove(c, id, { amount });
      const axis = id.startsWith('pan') ? 'x' : 'y';
      for (let t = 0; t <= 4; t += 0.5) {
        const s = valueAt(c, 'scale', t);
        const off = Math.abs(valueAt(c, axis, t));
        assert.ok(s - 1 >= 2 * off - 1e-9, `${id}/${amount}: a ${t}s scala ${s} copre lo spostamento ${off}`);
      }
    }
  }
  const c = clip(4);
  applyCameraMove(c, 'pan-right', { amount: 100 });
  assert.ok(valueAt(c, 'x', 4) > valueAt(c, 'x', 0));
  applyCameraMove(c, 'pan-left', { amount: 100 });
  assert.ok(valueAt(c, 'x', 4) < valueAt(c, 'x', 0));
  applyCameraMove(c, 'tilt-up', { amount: 100 });
  assert.ok(valueAt(c, 'y', 4) < valueAt(c, 'y', 0));
});

test('mano libera: sempre uguale con lo stesso seme, diversa con un altro, entro l’ampiezza, a tempi crescenti', () => {
  const a = cameraKeyframes('handheld', 6, { amount: 60, seed: 5 });
  const b = cameraKeyframes('handheld', 6, { amount: 60, seed: 5 });
  const c = cameraKeyframes('handheld', 6, { amount: 60, seed: 6 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  for (const p of ['x', 'y', 'rotation']) {
    const ts = a[p].map((k) => k.t);
    assert.deepEqual([...ts].sort((x, y) => x - y), ts, 'tempi ordinati');
    assert.equal(ts[0], 0);
    assert.ok(Math.abs(ts.at(-1) - 6) < 1e-9);
  }
  assert.ok(a.x.every((k) => Math.abs(k.v) <= 0.012 * 0.6 + 1e-9));
  assert.ok(a.rotation.every((k) => Math.abs(k.v) <= 0.8 * 0.6 + 1e-9));
  // clip lunghissimo: pochi punti
  assert.ok(cameraKeyframes('handheld', 3600, { amount: 100 }).x.length <= 152);
  // intensità zero: nessun movimento
  const z = cameraKeyframes('handheld', 4, { amount: 0 });
  assert.ok(z.x.every((k) => k.v === 0));
});

test('si parte dai valori del clip, si sostituiscono i vecchi keyframe e si possono togliere', () => {
  const c = clip(4, { scale: 0.8, x: 0.1, y: -0.2, rotation: 5 });
  c.keyframes.opacity = [{ t: 0, v: 0, e: 'linear' }, { t: 1, v: 1, e: 'linear' }];
  c.keyframes.x = [{ t: 0, v: 0.5, e: 'linear' }];
  const set = applyCameraMove(c, 'ken-burns', { amount: 50, seed: 3 });
  assert.deepEqual(set.sort(), ['scale', 'x', 'y']);
  assert.ok(valueAt(c, 'scale', 0) > 0.8, 'parte dalla scala del clip');
  assert.ok(Math.abs(valueAt(c, 'x', 2) - 0.1) < 0.05, 'resta vicino alla posizione del clip');
  assert.ok(c.keyframes.opacity, 'l’opacità non si tocca');
  clearCameraMove(c);
  assert.equal(c.keyframes.scale, undefined);
  assert.ok(c.keyframes.opacity);
  assert.throws(() => cameraKeyframes('boh', 4), /sconosciuto/);
});

test('ogni movimento dà keyframe validi per il progetto (anche dopo salvataggio e rilettura)', () => {
  for (const id of CAMERA_IDS) {
    for (const d of [0.1, 0.5, 3, 40]) {
      const p = createProject();
      p.media.m = { id: 'm', name: 'a', kind: 'image', mime: 'image/png', size: 1, duration: 0, width: 100, height: 100 };
      const c = clip(d);
      addClip(p, p.tracks[1].id, c, 0);
      applyCameraMove(c, id, { amount: 80, seed: 9 });
      assert.deepEqual(validateProject(p), [], `${id}/${d}`);
      const back = sanitizeProject(JSON.parse(JSON.stringify(p)));
      assert.deepEqual(back.tracks[1].clips[0].keyframes, c.keyframes, `${id}/${d} sopravvive al salvataggio`);
    }
  }
});
