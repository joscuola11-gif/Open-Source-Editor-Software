import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT_PRESETS, anchorTarget, boundingBox, cellFor, cellRect, containScale, isFitting, normalizeAngle, rotationScaleFactor } from '../../src/core/layout.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('normalizeAngle: intervallo (-180, 180], giri completi e valori strani', () => {
  assert.equal(normalizeAngle(0), 0);
  assert.equal(normalizeAngle(90), 90);
  assert.equal(normalizeAngle(180), 180);
  assert.equal(normalizeAngle(270), -90);
  assert.equal(normalizeAngle(-270), 90);
  assert.equal(normalizeAngle(360), 0);
  assert.equal(normalizeAngle(450), 90);
  assert.equal(normalizeAngle(-180), 180);
  assert.equal(normalizeAngle(NaN), 0);
  assert.equal(normalizeAngle(Infinity), 0);
});

test('boundingBox: multipli di 90° esatti, 45° e angoli negativi', () => {
  assert.deepEqual(boundingBox(1920, 1080, 0), { w: 1920, h: 1080 });
  assert.deepEqual(boundingBox(1920, 1080, 90), { w: 1080, h: 1920 });
  assert.deepEqual(boundingBox(1920, 1080, -90), { w: 1080, h: 1920 });
  assert.deepEqual(boundingBox(1920, 1080, 180), { w: 1920, h: 1080 });
  assert.deepEqual(boundingBox(1920, 1080, 270), { w: 1080, h: 1920 });
  const b = boundingBox(100, 100, 45);
  near(b.w, 141.4213562, 1e-6);
  near(b.h, 141.4213562, 1e-6);
  const c = boundingBox(200, 100, 30);
  near(c.w, 200 * Math.cos(Math.PI / 6) + 100 * Math.sin(Math.PI / 6), 1e-9);
});

test('containScale e isFitting', () => {
  near(containScale(1080, 1920, 1920, 1080), 0.5625);
  near(containScale(100, 50, 200, 200), 2);
  assert.equal(containScale(0, 10, 100, 100), 1, 'riquadro degenere: nessuna modifica');
  assert.equal(isFitting(1920, 1080, 1920, 1080), true);
  assert.equal(isFitting(960, 540, 1920, 1080), false, 'rimpicciolito: non adattato');
  assert.equal(isFitting(2400, 1350, 1920, 1080), false, 'zoomato: non adattato');
  assert.equal(isFitting(1000, 1080, 1920, 1080), true, 'tocca in altezza');
});

test('rotationScaleFactor: un 16:9 adattato ruotato di 90° si rimpicciolisce per restare nel quadro, e torna indietro', () => {
  const W = 1920, H = 1080;
  const down = rotationScaleFactor({ w: 1920, h: 1080, fromDeg: 0, toDeg: 90, W, H });
  near(down, 0.5625);
  // dopo la rotazione il clip misura 0,5625× → ruotando ancora di 90° (180°) deve tornare adattato (×1,7778)
  const w2 = 1920 * down, h2 = 1080 * down;
  const up = rotationScaleFactor({ w: w2, h: h2, fromDeg: 90, toDeg: 180, W, H });
  near(up, 1 / 0.5625, 1e-9);
  near(down * up, 1, 1e-9);
});

test('rotationScaleFactor: gli zoom dell\'utente non vengono toccati se il risultato entra nel quadro', () => {
  const W = 1920, H = 1080;
  // clip piccolo (40%): ruotato di 90° entra ancora nel quadro → nessuna modifica
  assert.equal(rotationScaleFactor({ w: 768, h: 432, fromDeg: 0, toDeg: 90, W, H }), 1);
  // clip zoomato che esce dal quadro dopo la rotazione → si riduce per rientrarci
  const k = rotationScaleFactor({ w: 1500, h: 900, fromDeg: 0, toDeg: 90, W, H });
  assert.ok(k < 1);
  const after = boundingBox(1500 * k, 900 * k, 90);
  assert.ok(after.w <= W + 1e-9 && after.h <= H + 1e-9);
});

test('rotationScaleFactor: un clip quadrato adattato resta adattato a qualsiasi multiplo di 90°', () => {
  for (const d of [90, 180, 270, -90]) near(rotationScaleFactor({ w: 1080, h: 1080, fromDeg: 0, toDeg: d, W: 1920, H: 1080 }), 1, 1e-9);
});

test('anchorTarget: angoli, centro e riquadro più grande del canvas', () => {
  const W = 1920, H = 1080;
  assert.deepEqual(anchorTarget(0, 0, W, H, 800, 600), { cx: 960, cy: 540 });
  assert.deepEqual(anchorTarget(-1, -1, W, H, 800, 600), { cx: 400, cy: 300 }); // il riquadro tocca l'angolo in alto a sinistra
  assert.deepEqual(anchorTarget(1, 1, W, H, 800, 600), { cx: 1520, cy: 780 });
  assert.deepEqual(anchorTarget(-1, 0, W, H, 2400, 600), { cx: 960, cy: 540 }, 'più largo del canvas: resta centrato in orizzontale');
});

test('disposizioni: celle coerenti, nell\'ordine di selezione', () => {
  for (const [id, p] of Object.entries(LAYOUT_PRESETS)) {
    assert.ok(p.label && p.hint, id);
    for (const c of p.cells) {
      assert.ok(c.x0 >= 0 && c.y0 >= 0 && c.x1 <= 1 && c.y1 <= 1 && c.x1 > c.x0 && c.y1 > c.y0, `${id}: cella valida`);
    }
  }
  assert.deepEqual(cellFor('split-h', 0), { x0: 0, y0: 0, x1: 0.5, y1: 1 });
  assert.deepEqual(cellFor('split-h', 1), { x0: 0.5, y0: 0, x1: 1, y1: 1 });
  assert.equal(cellFor('split-h', 2), null, 'il terzo clip non ha posto');
  assert.deepEqual(cellFor('full', 5), { x0: 0, y0: 0, x1: 1, y1: 1 }, '«Schermo intero» vale per tutti i clip');
  assert.equal(cellFor('inesistente', 0), null);
  const r = cellRect(cellFor('split-v', 1), 1920, 1080);
  assert.deepEqual(r, { x: 0, y: 540, w: 1920, h: 540 });
  // le due metà non si sovrappongono
  const a = cellRect(cellFor('split-h', 0), 1920, 1080);
  const b = cellRect(cellFor('split-h', 1), 1920, 1080);
  assert.ok(a.x + a.w <= b.x + 1e-9);
});
