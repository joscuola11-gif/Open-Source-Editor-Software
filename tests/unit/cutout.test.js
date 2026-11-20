import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blendMasks, coverage, maskIndex, refineMask, sanitizeCutout } from '../../src/core/cutout.js';
import { createClip, sanitizeClip, createProject } from '../../src/core/project.js';
import { rng } from '../../src/core/synth.js';

const W = 64;
const H = 48;
/** Disco «persona» con bordo morbido e un po' di rumore, come lo darebbe un riconoscitore. */
function disk(cx, cy, radius, { noise = 0, seed = 1 } = {}) {
  const r = rng(seed);
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - cx, y - cy);
    const p = 1 / (1 + Math.exp((d - radius) / 2.2));
    m[y * W + x] = Math.max(0, Math.min(255, Math.round(255 * p + (r() - 0.5) * noise * 2)));
  }
  return m;
}
const count = (m, lo, hi) => m.reduce((n, v) => n + (v >= lo && v <= hi ? 1 : 0), 0);

test('rifinitura: interno pieno, esterno vuoto, bordo corto e senza scalini', () => {
  const raw = disk(32, 24, 14, { noise: 20 });
  const out = refineMask(raw, W, H, { softness: 30, expand: 0 });
  assert.equal(out[24 * W + 32], 255);
  assert.equal(out[2 * W + 2], 0);
  // il bordo non ha una banda enorme di valori intermedi, ma ne ha (è morbido)
  const mid = count(out, 20, 235);
  assert.ok(mid > 20 && mid < W * H * 0.2, `valori intermedi ${mid}`);
  // area quasi uguale a quella del disco
  const area = coverage(out) * W * H;
  assert.ok(Math.abs(area - Math.PI * 14 * 14) / (Math.PI * 14 * 14) < 0.12, `area ${area}`);
});

test('rifinitura: «allarga» e «stringi» cambiano l’area in modo monotono', () => {
  const raw = disk(32, 24, 12);
  const areas = [-100, -50, 0, 50, 100].map((expand) => coverage(refineMask(raw, W, H, { softness: 0, expand })));
  for (let i = 1; i < areas.length; i++) assert.ok(areas[i] > areas[i - 1], `aree ${areas.map((a) => a.toFixed(3))}`);
  assert.ok(areas[4] > areas[2] * 1.2 && areas[0] < areas[2] * 0.8);
});

test('rifinitura: più morbidezza = bordo più largo; zero = bordo netto', () => {
  const raw = disk(32, 24, 12);
  const hard = count(refineMask(raw, W, H, { softness: 0 }), 20, 235);
  const soft = count(refineMask(raw, W, H, { softness: 100 }), 20, 235);
  assert.ok(soft > hard * 2, `${soft} vs ${hard}`);
  // maschera tutta vuota o tutta piena resta tale
  assert.equal(coverage(refineMask(new Uint8Array(W * H), W, H, { softness: 100, expand: 100 })), 0);
  assert.equal(coverage(refineMask(new Uint8Array(W * H).fill(255), W, H, { softness: 100, expand: -100 })), 1);
});

test('fluidità: la fusione con la precedente riduce il tremolio', () => {
  const frames = Array.from({ length: 30 }, (_, i) => disk(32, 24, 12 + (i % 2) * 3, { seed: i }));
  const flick = (fs) => fs.slice(1).reduce((s, f, i) => s + Math.abs(coverage(f) - coverage(fs[i])), 0);
  let prev = null;
  const smooth = frames.map((f) => (prev = blendMasks(prev, f, 0.4)));
  assert.ok(flick(smooth) < flick(frames) * 0.6, `${flick(smooth)} vs ${flick(frames)}`);
  assert.deepEqual(Array.from(blendMasks(null, new Uint8Array([1, 2]))), [1, 2]);
  assert.deepEqual(Array.from(blendMasks(new Uint8Array([0, 100]), new Uint8Array([100, 100]), 0.5)), [50, 100]);
});

test('indice della maschera e dati del progetto', () => {
  assert.equal(maskIndex(0, 0, 10, 20), 0);
  assert.equal(maskIndex(1.04, 0, 10, 20), 10);
  assert.equal(maskIndex(99, 0, 10, 20), 19);
  assert.equal(maskIndex(-3, 2, 10, 20), 0);
  assert.equal(maskIndex(1, 0, 10, 0), -1);
  assert.deepEqual(sanitizeCutout(undefined), { enabled: false, softness: 25, expand: 0 });
  assert.deepEqual(sanitizeCutout({ enabled: 'si', softness: 500, expand: -999 }), { enabled: false, softness: 100, expand: -100 });
  assert.deepEqual(sanitizeCutout({ enabled: true, softness: NaN }), { enabled: true, softness: 25, expand: 0 });
  // progetti vecchi (senza il campo) si aprono; il campo sopravvive al salvataggio
  const p = createProject({ name: 'v' });
  p.media.m = { id: 'm', name: 'a.webm', kind: 'video', mime: 'video/webm', size: 1, duration: 2, width: 640, height: 360, hasAudio: false };
  const raw = JSON.parse(JSON.stringify(createClip('video', { mediaId: 'm', start: 0, duration: 2 })));
  delete raw.cutout;
  assert.equal(sanitizeClip(raw, p).cutout.enabled, false);
  raw.cutout = { enabled: true, softness: 40, expand: 10 };
  assert.deepEqual(sanitizeClip(raw, p).cutout, { enabled: true, softness: 40, expand: 10 });
});
