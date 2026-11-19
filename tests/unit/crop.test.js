import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CROP_ASPECTS, cropForAspect, dragCrop, edgeForFlip, visibleRatio } from '../../src/core/crop.js';

const close = (a, b, eps = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= eps, `${m} ${a} ≉ ${b}`);

test('cropForAspect: rapporti giusti per ogni formato e per ogni file, sempre centrato e senza sprechi', () => {
  for (const [mw, mh] of [[1920, 1080], [1080, 1920], [1000, 1000], [4000, 900], [300, 3000]]) {
    for (const a of CROP_ASPECTS.filter((x) => x.ratio)) {
      const c = cropForAspect(mw, mh, a.ratio);
      close(visibleRatio(mw, mh, c), a.ratio, 1e-9, `${mw}x${mh} → ${a.id}`);
      close(c.l, c.r);
      close(c.t, c.b);
      assert.ok(c.l === 0 && c.r === 0 || c.t === 0 && c.b === 0, 'si ritaglia su un asse solo');
      assert.ok(Math.min(c.l, c.t, c.r, c.b) >= 0 && Math.max(c.l, c.t, c.r, c.b) < 0.95);
    }
  }
  assert.deepEqual(cropForAspect(1920, 1080, 16 / 9), { l: 0, t: 0, r: 0, b: 0 }, 'già del rapporto giusto');
  assert.deepEqual(cropForAspect(0, 10, 1), { l: 0, t: 0, r: 0, b: 0 });
  assert.deepEqual(cropForAspect(10, 10, NaN), { l: 0, t: 0, r: 0, b: 0 });
});

test('dragCrop: ogni bordo e angolo sposta i lati giusti nel verso giusto', () => {
  const z = { l: 0, t: 0, r: 0, b: 0 };
  assert.deepEqual(dragCrop(z, 'l', 0.2, 0.9), { l: 0.2, t: 0, r: 0, b: 0 });
  assert.deepEqual(dragCrop(z, 'r', -0.3, 0.9), { l: 0, t: 0, r: 0.3, b: 0 });
  assert.deepEqual(dragCrop(z, 't', 0.9, 0.1), { l: 0, t: 0.1, r: 0, b: 0 });
  assert.deepEqual(dragCrop(z, 'b', 0.9, -0.25), { l: 0, t: 0, r: 0, b: 0.25 });
  assert.deepEqual(dragCrop(z, 'tl', 0.1, 0.2), { l: 0.1, t: 0.2, r: 0, b: 0 });
  assert.deepEqual(dragCrop(z, 'br', -0.1, -0.2), { l: 0, t: 0, r: 0.1, b: 0.2 });
  // trascinare verso l'esterno toglie il ritaglio, senza andare sotto zero
  assert.deepEqual(dragCrop({ l: 0.1, t: 0, r: 0, b: 0 }, 'l', -0.5, 0), z);
});

test('dragCrop: non si può togliere più del 95%, né far sparire l’immagine', () => {
  let c = { l: 0, t: 0, r: 0.6, b: 0 };
  c = dragCrop(c, 'l', 0.9, 0);
  assert.ok(c.l + c.r <= 0.95 + 1e-12);
  c = dragCrop({ l: 0, t: 0.5, r: 0, b: 0.2 }, 't', 0, 0.9);
  assert.ok(c.t + c.b <= 0.95 + 1e-12);
  for (const edge of ['l', 'r', 't', 'b', 'tl', 'tr', 'bl', 'br']) {
    const r = dragCrop({ l: 0.3, t: 0.3, r: 0.3, b: 0.3 }, edge, 5, 5);
    assert.ok(r.l + r.r <= 0.95 + 1e-12 && r.t + r.b <= 0.95 + 1e-12, edge);
    assert.ok([r.l, r.t, r.r, r.b].every((v) => v >= 0));
  }
});

test('dragCrop: angolo con rapporto fisso mantiene il rapporto', () => {
  for (const ratio of [1, 16 / 9, 9 / 16]) {
    for (const edge of ['tl', 'tr', 'bl', 'br']) {
      for (const [dx, dy] of [[0.1, 0.05], [-0.1, 0.2], [0.2, -0.1]]) {
        const start = cropForAspect(1920, 1080, ratio);
        const c = dragCrop(start, edge, dx, dy, { ratio, mw: 1920, mh: 1080 });
        const vr = visibleRatio(1920, 1080, c);
        const hitLimit = c.t === 0.95 || c.b === 0.95 || c.t === 0 && c.b === 0 && Math.abs(vr - ratio) > 1e-6;
        if (!hitLimit && c.t + c.b < 0.94 && c.l + c.r < 0.94) close(vr, ratio, 1e-6, `${edge} ${ratio} ${dx},${dy}`);
      }
    }
  }
});

test('edgeForFlip: con il clip ribaltato i lati si scambiano', () => {
  assert.equal(edgeForFlip('l', false, false), 'l');
  assert.equal(edgeForFlip('l', true, false), 'r');
  assert.equal(edgeForFlip('r', true, false), 'l');
  assert.equal(edgeForFlip('t', false, true), 'b');
  assert.equal(edgeForFlip('tl', true, true), 'br');
  assert.equal(edgeForFlip('tr', true, false), 'tl');
  assert.equal(edgeForFlip('bl', false, true), 'tl');
});
