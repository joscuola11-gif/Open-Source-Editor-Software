import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjacentScores, bestBoundary, detectScenes, featureDistance, frameFeatures, motionSeries } from '../../src/core/scenes.js';
import { rng } from '../../src/core/synth.js';

const W = 64;
const H = 36;

/** Un «ripresa»: sfondo sfumato + rettangoli colorati (dipendono dal seme) che scorrono lentamente, con un po' di rumore. */
function makeShot(seed, { pan = 2, noise = 3 } = {}) {
  const r = rng(seed * 977 + 5);
  const bg = [r() * 255, r() * 255, r() * 255];
  const bg2 = [r() * 255, r() * 255, r() * 255];
  const rects = Array.from({ length: 6 }, () => ({ x: r() * W, y: r() * H, w: 8 + r() * 22, h: 6 + r() * 14, c: [r() * 255, r() * 255, r() * 255] }));
  return (t, nr) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const k = y / H;
        let c = [bg[0] * (1 - k) + bg2[0] * k, bg[1] * (1 - k) + bg2[1] * k, bg[2] * (1 - k) + bg2[2] * k];
        const sx = (x + pan * t * 4) % W;
        for (const q of rects) if (sx >= q.x && sx < q.x + q.w && y >= q.y && y < q.y + q.h) c = q.c;
        data[i] = c[0] + (nr() - 0.5) * noise * 2;
        data[i + 1] = c[1] + (nr() - 0.5) * noise * 2;
        data[i + 2] = c[2] + (nr() - 0.5) * noise * 2;
        data[i + 3] = 255;
      }
    }
    return data;
  };
}

/** Sequenza di riprese: [{seed, dur}] campionata a `fps`. `fade` = durata di una dissolvenza fra una ripresa e la successiva. */
function sequence(shots, { fps = 4, fade = 0, noise = 3, pan = 2, flicker = 0 } = {}) {
  const nr = rng(99);
  const gens = shots.map((s) => makeShot(s.seed, { pan, noise }));
  const total = shots.reduce((a, s) => a + s.dur, 0);
  const bounds = [];
  let acc = 0;
  for (const s of shots) {
    bounds.push(acc);
    acc += s.dur;
  }
  const frames = [];
  for (let t = 0; t < total - 1e-9; t += 1 / fps) {
    let idx = bounds.findLastIndex((b) => b <= t + 1e-9);
    let data = gens[idx](t, nr);
    if (fade && idx + 1 < shots.length) {
      const toEnd = bounds[idx + 1] - t;
      if (toEnd < fade / 2) {
        const mix = 0.5 * (1 - toEnd / (fade / 2));
        const other = gens[idx + 1](t, nr);
        data = data.map((v, i) => v * (1 - mix) + other[i] * mix);
      }
    }
    if (fade && idx > 0) {
      const since = t - bounds[idx];
      if (since < fade / 2) {
        const mix = 0.5 + 0.5 * (since / (fade / 2));
        const prev = gens[idx - 1](t, nr);
        data = Uint8ClampedArray.from(data, (v, i) => prev[i] * (1 - mix) + v * mix);
        // (mix = peso della ripresa corrente)
      }
    }
    if (flicker) {
      const g = 1 + flicker * Math.sin(t * 7);
      data = Uint8ClampedArray.from(data, (v, i) => (i % 4 === 3 ? 255 : v * g));
    }
    frames.push({ t, w: W, h: H, data: Uint8ClampedArray.from(data) });
  }
  return { frames, cuts: bounds.slice(1) };
}

const near = (a, b, tol) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('scene: quattro riprese → tre tagli nei punti giusti (±un fotogramma)', () => {
  const { frames, cuts } = sequence([{ seed: 1, dur: 2 }, { seed: 2, dur: 1.5 }, { seed: 3, dur: 3 }, { seed: 4, dur: 1.25 }]);
  const found = detectScenes(frames);
  assert.ok(near(found.map((c) => c.t), cuts, 0.26), `trovati ${found.map((c) => c.t)} voluti ${cuts}`);
  assert.ok(found.every((c) => c.kind === 'cut'));
});

test('scene: una sola ripresa con movimento, rumore e sfarfallio non ha tagli', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { frames } = sequence([{ seed, dur: 12 }], { pan: 6, noise: 8, flicker: 0.08 });
    assert.deepEqual(detectScenes(frames), [], `seme ${seed}`);
  }
});

test('scene: la dissolvenza è trovata al centro e non è confusa con un taglio', () => {
  const { frames, cuts } = sequence([{ seed: 11, dur: 3 }, { seed: 12, dur: 3 }], { fade: 1.6 });
  const found = detectScenes(frames);
  assert.equal(found.length, 1, JSON.stringify(found.map((f) => [f.t, f.kind])));
  assert.equal(found[0].kind, 'dissolve');
  assert.ok(Math.abs(found[0].t - cuts[0]) <= 0.5, `centro ${found[0].t} vs ${cuts[0]}`);
  assert.equal(detectScenes(frames, { dissolves: false }).length, 0);
});

test('scene: riprese troppo corte si fondono e la sensibilità cambia i risultati', () => {
  const { frames } = sequence([{ seed: 1, dur: 2 }, { seed: 2, dur: 0.5 }, { seed: 3, dur: 2 }]);
  const strict = detectScenes(frames, { minLength: 1.2 });
  assert.equal(strict.length, 1, 'con scene minime di 1,2 s resta un solo taglio (il più forte)');
  const loose = detectScenes(frames, { minLength: 0.3 });
  assert.equal(loose.length, 2);
  // due riprese quasi uguali (stessi colori): poco sensibile non la vede, molto sensibile sì
  const a = makeShot(7);
  const nr = rng(3);
  const b = (t) => { const d = a(t, nr); for (let i = 0; i < d.length; i += 4) { d[i] = Math.min(255, d[i] * 1.1 + 4); } return d; };
  const frames2 = [];
  for (let t = 0; t < 8; t += 0.25) frames2.push({ t, w: W, h: H, data: Uint8ClampedArray.from(t < 4 ? a(t, nr) : b(t)) });
  assert.equal(detectScenes(frames2, { sensitivity: 0 }).length, 0, 'poco sensibile: ignora una lieve variazione di tinta');
  assert.equal(detectScenes(frames2, { sensitivity: 1 }).length, 1, 'molto sensibile: la vede');
});

test('scene: precisione e richiamo su 40 sequenze casuali (≥ 95%)', () => {
  const r = rng(2024);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (let n = 0; n < 40; n++) {
    const count = 2 + Math.floor(r() * 5);
    const shots = Array.from({ length: count }, (_, i) => ({ seed: n * 10 + i + 1, dur: 1.2 + r() * 4 }));
    const { frames, cuts } = sequence(shots, { pan: 1 + r() * 6, noise: 2 + r() * 8 });
    const found = detectScenes(frames).map((c) => c.t);
    for (const c of cuts) {
      if (found.some((f) => Math.abs(f - c) <= 0.26)) tp++;
      else fn++;
    }
    fp += found.filter((f) => !cuts.some((c) => Math.abs(f - c) <= 0.26)).length;
  }
  const precision = tp / (tp + fp);
  const recall = tp / (tp + fn);
  assert.ok(precision >= 0.95, `precisione ${precision.toFixed(3)} (tp ${tp} fp ${fp} fn ${fn})`);
  assert.ok(recall >= 0.95, `richiamo ${recall.toFixed(3)} (tp ${tp} fp ${fp} fn ${fn})`);
});

test('scene: l’affinamento trova il fotogramma esatto del taglio', () => {
  const { frames, cuts } = sequence([{ seed: 1, dur: 1 }, { seed: 2, dur: 1 }], { fps: 30 });
  const b = bestBoundary(frames);
  assert.ok(Math.abs(b.t - cuts[0]) < 1 / 30 + 1e-6, `${b.t} vs ${cuts[0]}`);
  assert.equal(bestBoundary(frames.slice(0, 1)), null);
});

test('scene: serie di movimento e distanze (basi)', () => {
  const fast = sequence([{ seed: 1, dur: 3 }], { pan: 12 }).frames;
  const slow = sequence([{ seed: 1, dur: 3 }], { pan: 0.3 }).frames;
  const m = (fr) => motionSeries(fr).reduce((a, b) => a + b, 0) / fr.length;
  assert.ok(m(fast) > m(slow) * 3, `${m(fast)} vs ${m(slow)}`);
  const f = frameFeatures(fast[0]);
  assert.equal(featureDistance(f, f), 0);
  assert.ok(featureDistance(f, frameFeatures(sequence([{ seed: 9, dur: 1 }]).frames[0])) > 0.2);
  assert.equal(adjacentScores(fast)[0], 0);
  assert.deepEqual(detectScenes(fast.slice(0, 2)), []);
});
