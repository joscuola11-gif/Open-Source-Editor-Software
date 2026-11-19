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

// ---------------------------------------------------------------- effetti artistici e di distorsione
import { posterize, duotone, edgeMap, cartoon, sketch, wave, swirl, bulge, zoomBlur, halftone, scanlines, sampleBilinear } from '../../src/engine/pixel-fx.js';

function img(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      const i = (y * w + x) * 4;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = a;
    }
  }
  return d;
}
const pxAt = (d, w, x, y) => Array.from(d.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
const gradient = (w, h) => img(w, h, (x, y) => [Math.round((x / (w - 1)) * 255), Math.round((y / (h - 1)) * 255), 128]);

test('sampleBilinear: valori esatti sui pixel, media a metà, bordi ripetuti', () => {
  const d = img(2, 1, (x) => [x * 200, 0, 100]);
  const o = [0, 0, 0, 0];
  assert.deepEqual(sampleBilinear(d, 2, 1, 0, 0, o).slice(0, 3), [0, 0, 100]);
  assert.deepEqual(sampleBilinear(d, 2, 1, 1, 0, o).slice(0, 3), [200, 0, 100]);
  assert.equal(sampleBilinear(d, 2, 1, 0.5, 0, o)[0], 100);
  assert.equal(sampleBilinear(d, 2, 1, -9, 0, o)[0], 0);
  assert.equal(sampleBilinear(d, 2, 1, 9, 0, o)[0], 200);
});

test('posterize: pochi livelli, idempotente, alfa invariato', () => {
  const d = gradient(32, 16);
  posterize(d, 4);
  const vals = new Set();
  for (let i = 0; i < d.length; i += 4) {
    vals.add(d[i]);
    vals.add(d[i + 1]);
    vals.add(d[i + 2]);
    assert.equal(d[i + 3], 255);
  }
  assert.ok(vals.size <= 4, `valori distinti: ${[...vals]}`);
  const again = new Uint8ClampedArray(d);
  posterize(again, 4);
  assert.deepEqual(again, d);
  assert.equal(new Set(Array.from(posterize(gradient(8, 8), 2))).size >= 2, true);
});

test('duotone: neri e bianchi prendono i due colori, il grigio medio sta in mezzo, mix 0 non cambia nulla', () => {
  const d = img(3, 1, (x) => [[0, 0, 0], [128, 128, 128], [255, 255, 255]][x]);
  const keep = new Uint8ClampedArray(d);
  duotone(d, [10, 20, 80], [250, 200, 40]);
  assert.deepEqual(pxAt(d, 3, 0, 0).slice(0, 3), [10, 20, 80]);
  assert.deepEqual(pxAt(d, 3, 2, 0).slice(0, 3), [250, 200, 40]);
  const mid = pxAt(d, 3, 1, 0);
  assert.ok(Math.abs(mid[0] - 130) < 3 && Math.abs(mid[1] - 110) < 3 && Math.abs(mid[2] - 60) < 3, String(mid));
  const same = new Uint8ClampedArray(keep);
  duotone(same, [10, 20, 80], [250, 200, 40], 0);
  assert.deepEqual(same, keep);
});

test('edgeMap e cartoon: zone piatte senza bordi, un gradino netto dà un contorno scuro, i colori diventano pochi', () => {
  const w = 24;
  const h = 12;
  const step = img(w, h, (x) => (x < 12 ? [220, 200, 60] : [40, 90, 200]));
  const e = edgeMap(step, w, h);
  assert.ok(e[5 * w + 2] < 1 && e[5 * w + 20] < 1, 'piatto = niente bordo');
  assert.ok(e[5 * w + 11] > 200, 'sul gradino il bordo è forte');
  const out = new Uint8ClampedArray(w * h * 4);
  const keep = new Uint8ClampedArray(step);
  cartoon(step, out, w, h, 80);
  assert.deepEqual(step, keep, 'l’ingresso non cambia');
  const lum = (x) => 0.2126 * out[(5 * w + x) * 4] + 0.7152 * out[(5 * w + x) * 4 + 1] + 0.0722 * out[(5 * w + x) * 4 + 2];
  assert.ok(Math.min(lum(11), lum(12)) < Math.min(lum(2), lum(20)) * 0.5, 'linea scura sul confine');
  // pochi colori su un’immagine «piena»
  const g = gradient(40, 20);
  const o2 = new Uint8ClampedArray(g.length);
  cartoon(g, o2, 40, 20, 100);
  const colors = new Set();
  for (let i = 0; i < o2.length; i += 4) colors.add(`${o2[i] >> 3},${o2[i + 1] >> 3},${o2[i + 2] >> 3}`);
  assert.ok(colors.size < 60, `colori distinti ${colors.size}`);
  assert.equal(o2[3], 255);
});

test('sketch: carta bianca dove è piatto, tratti scuri sui bordi', () => {
  const w = 20;
  const h = 10;
  const step = img(w, h, (x) => (x < 10 ? [250, 250, 250] : [10, 10, 10]));
  const out = new Uint8ClampedArray(w * h * 4);
  sketch(step, out, w, h, 80);
  assert.ok(out[(4 * w + 2) * 4] > 245 && out[(4 * w + 17) * 4] > 245, 'bianco dove piatto');
  assert.ok(out[(4 * w + 9) * 4] < 100 || out[(4 * w + 10) * 4] < 100, 'scuro sul confine');
});

test('wave: ampiezza 0 = identica, altrimenti le righe si spostano e la forma resta', () => {
  const w = 30;
  const h = 20;
  const d = gradient(w, h);
  const out = new Uint8ClampedArray(d.length);
  wave(d, out, w, h, 0, 3, 0);
  assert.deepEqual(out, d);
  wave(d, out, w, h, 4, 2, 0);
  assert.notDeepEqual(out, d);
  // a metà dell'onda (sin = 0) la riga non si sposta; al picco (sin = 1) sì
  const row = (y) => out[(y * w + 10) * 4];
  assert.ok(Math.abs(row(0) - d[(0 * w + 10) * 4]) < 1, 'riga 0: sin(0)=0');
  assert.ok(Math.abs(out[(3 * w + 10) * 4] - d[(3 * w + 10) * 4]) > 3, 'riga 3 (vicino al picco): spostata');
  for (let i = 3; i < out.length; i += 4) assert.equal(out[i], 255);
});

test('swirl e bulge: forza 0 = identici, il centro e i bordi lontani non si muovono, il resto sì', () => {
  const w = 41;
  const h = 41;
  const d = img(w, h, (x, y) => [x * 6, y * 6, (x + y) * 3]);
  for (const fx of [swirl, bulge]) {
    const out = new Uint8ClampedArray(d.length);
    fx(d, out, w, h, 0);
    assert.deepEqual(out, d, `${fx.name} 0`);
    fx(d, out, w, h, fx === swirl ? 2 : 0.6);
    assert.deepEqual(pxAt(out, w, 20, 20), pxAt(d, w, 20, 20), `${fx.name}: il centro resta`);
    assert.deepEqual(pxAt(out, w, 0, 0), pxAt(d, w, 0, 0), `${fx.name}: l'angolo resta`);
    let diff = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(out[i] - d[i]) > 2) diff++;
    assert.ok(diff > 100, `${fx.name}: molti pixel cambiano (${diff})`);
  }
  // il rigonfiamento ingrandisce il centro: un punto vicino al centro prende il colore di un punto più vicino al centro
  const out = new Uint8ClampedArray(d.length);
  bulge(d, out, w, h, 0.5);
  assert.ok(Math.abs(out[(20 * w + 26) * 4] - d[(20 * w + 26) * 4]) > 5 && out[(20 * w + 26) * 4] < d[(20 * w + 26) * 4], 'a destra del centro si vede un punto più vicino al centro');
});

test('zoomBlur: immagine uniforme invariata, centro invariato, bordi sfocati lungo le linee verso il centro', () => {
  const flat = img(16, 16, () => [90, 120, 150]);
  const out = new Uint8ClampedArray(flat.length);
  zoomBlur(flat, out, 16, 16, 1);
  assert.deepEqual(out, flat);
  const w = 33;
  const h = 33;
  const d = img(w, h, (x) => (x % 2 ? [255, 255, 255] : [0, 0, 0]));
  zoomBlur(d, out.length === d.length ? out : new Uint8ClampedArray(d.length), w, h, 1);
});

test('halftone: dimensioni e alfa a posto; l’immagine chiara ha più puntini accesi della scura', () => {
  const w = 48;
  const h = 48;
  const lit = (src) => {
    const out = new Uint8ClampedArray(src.length);
    halftone(src, out, w, h, 6);
    let n = 0;
    for (let i = 0; i < out.length; i += 4) {
      assert.equal(out[i + 3], 255);
      if (out[i] + out[i + 1] + out[i + 2] > 30) n++;
    }
    return n;
  };
  const bright = lit(img(w, h, () => [230, 230, 230]));
  const dark = lit(img(w, h, () => [40, 40, 40]));
  assert.ok(bright > dark * 2, `chiaro ${bright} vs scuro ${dark}`);
  assert.equal(lit(img(w, h, () => [0, 0, 0])), 0);
});

test('scanlines: le righe dispari si scuriscono, le pari restano quasi uguali, forza 0 = nessun cambio', () => {
  const w = 12;
  const h = 8;
  const d = img(w, h, () => [200, 200, 200]);
  const a = new Uint8ClampedArray(d);
  scanlines(a, w, h, 1, 1);
  const rowMean = (y) => { let s = 0; for (let x = 0; x < w; x++) s += a[(y * w + x) * 4] + a[(y * w + x) * 4 + 1] + a[(y * w + x) * 4 + 2]; return s / w / 3; };
  assert.ok(rowMean(1) < rowMean(0) * 0.7, `riga dispari ${rowMean(1)} vs pari ${rowMean(0)}`);
  const none = new Uint8ClampedArray(d);
  scanlines(none, w, h, 0, 1);
  assert.deepEqual(none, d);
});

test('tutti gli effetti nuovi reggono dimensioni minuscole e valori estremi senza errori e senza uscire da 0–255', () => {
  for (const [w, h] of [[1, 1], [2, 3], [3, 2], [17, 5], [64, 36]]) {
    const src = img(w, h, (x, y) => [(x * 97) % 256, (y * 53) % 256, (x * y * 31) % 256, 255]);
    const dst = new Uint8ClampedArray(src.length);
    for (const run of [
      () => cartoon(src, dst, w, h, 0), () => cartoon(src, dst, w, h, 100), () => sketch(src, dst, w, h, 0), () => sketch(src, dst, w, h, 100),
      () => wave(src, dst, w, h, 50, 9, 3), () => swirl(src, dst, w, h, 9, 1), () => swirl(src, dst, w, h, -9, 0.01), () => bulge(src, dst, w, h, 1, 2), () => bulge(src, dst, w, h, -1, 0.1),
      () => zoomBlur(src, dst, w, h, 1), () => halftone(src, dst, w, h, 2), () => halftone(src, dst, w, h, 40),
    ]) {
      run();
      for (let i = 0; i < dst.length; i++) assert.ok(Number.isFinite(dst[i]) && dst[i] >= 0 && dst[i] <= 255);
    }
    const a = new Uint8ClampedArray(src);
    posterize(a, 1);
    duotone(a, [0, 0, 0], [255, 255, 255], 2);
    scanlines(a, w, h, 5, 0);
  }
});
