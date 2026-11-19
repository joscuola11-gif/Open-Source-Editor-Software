import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromaKey, rgbSplit, mulberry32, fillNoise, glitchSlices } from '../../src/engine/pixel-fx.js';

const px = (...rgba) => Uint8ClampedArray.from(rgba);

test('chroma key: il verde diventa trasparente, il resto resta opaco', () => {
  const d = px(0, 255, 0, 255, 20, 200, 30, 255, 255, 0, 0, 255, 200, 160, 140, 255, 0, 0, 255, 255);
  chromaKey(d, [0, 255, 0], { similarity: 0.4, smoothness: 0.1 });
  assert.equal(d[3], 0, 'verde puro trasparente');
  assert.equal(d[7], 0, 'verde scuro/variante trasparente (indipendente dalla luminosità)');
  assert.equal(d[11], 255, 'rosso opaco');
  assert.equal(d[15], 255, 'tono pelle opaco');
  assert.equal(d[19], 255, 'blu opaco');
});

test('chroma key: similarity maggiore rimuove più colori; il bordo è graduale', () => {
  const near = [60, 190, 80, 255];
  const strict = px(...near); chromaKey(strict, [0, 255, 0], { similarity: 0.01, smoothness: 0.01 });
  const loose = px(...near); chromaKey(loose, [0, 255, 0], { similarity: 0.8, smoothness: 0.1 });
  assert.ok(strict[3] > loose[3]);
  const alphas = [];
  for (const g of [255, 230, 200, 170, 140]) { const d = px(60, g, 60, 255); chromaKey(d, [0, 255, 0], { similarity: 0.3, smoothness: 0.6 }); alphas.push(d[3]); }
  for (let i = 1; i < alphas.length; i++) assert.ok(alphas[i] >= alphas[i - 1], `alpha monotono: ${alphas}`);
});

test('chroma key: non altera l\'alpha già trasparente e non produce NaN', () => {
  const d = px(0, 255, 0, 0, 10, 10, 10, 128);
  chromaKey(d, [0, 255, 0]);
  assert.equal(d[3], 0);
  assert.ok(Number.isFinite(d[7]));
});

test('rgbSplit sposta rosso e blu e lascia verde e alpha', () => {
  // riga di 5 pixel con un impulso bianco al centro
  const src = new Uint8ClampedArray(5 * 4);
  src.set([255, 255, 255, 255], 2 * 4);
  for (let x = 0; x < 5; x++) src[x * 4 + 3] = 255;
  const dst = rgbSplit(src, new Uint8ClampedArray(src.length), 5, 1, 1);
  assert.equal(dst[(3) * 4], 255, 'rosso spostato a destra (letto da x-1)');
  assert.equal(dst[(1) * 4 + 2], 255, 'blu spostato a sinistra (letto da x+1)');
  assert.equal(dst[2 * 4 + 1], 255, 'verde fermo');
  assert.equal(dst[2 * 4], 0);
  for (let x = 0; x < 5; x++) assert.equal(dst[x * 4 + 3], 255);
});

test('rumore e glitch sono deterministici per seed', () => {
  const a = fillNoise(new Uint8ClampedArray(64), 7);
  const b = fillNoise(new Uint8ClampedArray(64), 7);
  const c = fillNoise(new Uint8ClampedArray(64), 8);
  assert.deepEqual([...a], [...b]);
  assert.notDeepEqual([...a], [...c]);
  assert.deepEqual(glitchSlices(100, 60, 5), glitchSlices(100, 60, 5));
  let dirty = 0;
  for (let s = 0; s < 200; s++) if (glitchSlices(100, 60, s).length) dirty++;
  assert.ok(dirty > 60 && dirty < 160, `glitch intermittente (${dirty}/200)`);
  for (const s of glitchSlices(100, 100, 1).concat(glitchSlices(100, 100, 2), glitchSlices(100, 100, 3))) assert.ok(s.y >= 0 && s.y + s.h <= 100);
  const r = mulberry32(1);
  for (let i = 0; i < 1000; i++) { const v = r(); assert.ok(v >= 0 && v < 1); }
});

import { applyFilterParams, filterCss, filterMatrix, IDENTITY_PARAMS, isIdentityParams } from '../../src/engine/pixel-fx.js';

test('fallback filtri: identità, grayscale, invert, brightness, contrast', () => {
  const base = () => Uint8ClampedArray.from([200, 100, 50, 255]);
  const f = (over) => applyFilterParams(base(), { ...IDENTITY_PARAMS, ...over });
  assert.deepEqual([...f({})], [200, 100, 50, 255]);
  const gray = f({ grayscale: 1 });
  assert.ok(Math.abs(gray[0] - gray[1]) <= 1 && Math.abs(gray[1] - gray[2]) <= 1, `r=g=b ${[...gray]}`);
  assert.ok(Math.abs(gray[0] - (0.2126 * 200 + 0.7152 * 100 + 0.0722 * 50)) <= 1);
  assert.deepEqual([...f({ invert: 1 })], [55, 155, 205, 255]);
  assert.deepEqual([...f({ brightness: 0.5 })], [100, 50, 25, 255]);
  const c = f({ contrast: 2 });          // (v-128)*2+128 ≈ (v/255-0.5)*2+0.5
  assert.ok(Math.abs(c[0] - Math.min(255, ((200 / 255 - 0.5) * 2 + 0.5) * 255)) <= 1);
  assert.ok(Math.abs(c[1] - ((100 / 255 - 0.5) * 2 + 0.5) * 255) <= 1, 'canale medio: (v-0.5)*2+0.5');
  assert.ok(c[2] === 0, 'clamp a 0');
  const sat0 = f({ saturate: 0 });
  assert.ok(Math.abs(sat0[0] - sat0[2]) <= 1);
  const hue = f({ hue: 360 });
  assert.ok(Math.abs(hue[0] - 200) <= 2 && Math.abs(hue[2] - 50) <= 2, 'hue 360° ≈ identità');
});

test('filterCss emette solo i filtri attivi, filterMatrix identità', () => {
  assert.equal(filterCss(IDENTITY_PARAMS), '');
  assert.equal(filterCss({ ...IDENTITY_PARAMS, grayscale: 1, brightness: 1.2 }), 'grayscale(1.000) brightness(1.200)');
  assert.equal(filterCss(IDENTITY_PARAMS, 3), 'blur(3.00px)');
  assert.ok(isIdentityParams(IDENTITY_PARAMS));
  const { m, o } = filterMatrix(IDENTITY_PARAMS);
  assert.deepEqual(m, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.deepEqual(o, [0, 0, 0]);
});
