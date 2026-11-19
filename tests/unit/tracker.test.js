import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simplifyPath, toGray, trackPoint } from '../../src/core/tracker.js';
import { rng } from '../../src/core/synth.js';

const W = 200;
const H = 120;
const BIG = 400;

/** Una trama «naturale»: rumore sfumato (così ha dettagli a più scale). */
function texture(seed, w = BIG, h = BIG * 0.6) {
  const r = rng(seed);
  const base = new Float32Array(w * h);
  for (let i = 0; i < base.length; i++) base[i] = r() * 255;
  let img = base;
  for (let pass = 0; pass < 3; pass++) {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += img[yy * w + xx]; n++; }
      }
      out[y * w + x] = s / n;
    }
    img = out;
  }
  // allarga il contrasto
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of img) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return { w, h, g: img.map((v) => ((v - lo) / (hi - lo)) * 220 + 15) };
}
/** Ritaglio W×H della trama con origine frazionaria (interpolazione bilineare). */
function view(tex, ox, oy, { gain = 1, noise = 0, r = null } = {}) {
  const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = ox + x;
      const sy = oy + y;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const at = (xx, yy) => tex.g[Math.min(tex.h - 1, Math.max(0, yy)) * tex.w + Math.min(tex.w - 1, Math.max(0, xx))];
      const v = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
      g[y * W + x] = Math.min(255, Math.max(0, v * gain + (noise && r ? (r() - 0.5) * noise * 2 : 0)));
    }
  }
  return { w: W, h: H, g };
}

// la telecamera si muove: l'origine del ritaglio segue questo percorso; il punto fermo nel mondo si muove nel fotogramma al contrario
const cam = (i) => ({ x: 100 + 40 * Math.sin(i * 0.21), y: 70 + 25 * Math.cos(i * 0.17) });

test('inseguimento: un punto del mondo si segue con errore sotto il pixel lungo un movimento ampio', () => {
  const tex = texture(1);
  const world = { x: 190, y: 130 }; // punto nel mondo
  const frames = [];
  const truth = [];
  for (let i = 0; i < 90; i++) {
    const c = cam(i);
    frames.push(view(tex, c.x, c.y));
    truth.push({ x: world.x - c.x, y: world.y - c.y });
  }
  const path = trackPoint(frames, truth[0], { radius: 7, search: 12 });
  assert.equal(path.length, frames.length);
  let sum = 0;
  let max = 0;
  path.forEach((p, i) => {
    const e = Math.hypot(p.x - truth[i].x, p.y - truth[i].y);
    sum += e;
    max = Math.max(max, e);
    assert.equal(p.lost, false, `perso al fotogramma ${i}`);
  });
  assert.ok(sum / path.length < 0.35, `errore medio ${(sum / path.length).toFixed(3)} px`);
  assert.ok(max < 1.0, `errore massimo ${max.toFixed(3)} px`);
});

test('inseguimento: regge rumore e cambi di luce', () => {
  const tex = texture(2);
  const r = rng(5);
  const world = { x: 200, y: 120 };
  const frames = [];
  const truth = [];
  for (let i = 0; i < 80; i++) {
    const c = cam(i);
    frames.push(view(tex, c.x, c.y, { gain: 0.6 + 0.8 * (i / 80), noise: 10, r }));
    truth.push({ x: world.x - c.x, y: world.y - c.y });
  }
  const path = trackPoint(frames, truth[0], { radius: 8, search: 12 });
  const errs = path.map((p, i) => Math.hypot(p.x - truth[i].x, p.y - truth[i].y));
  assert.ok(errs.reduce((a, b) => a + b, 0) / errs.length < 0.8, `errore medio ${(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(2)}`);
  assert.ok(Math.max(...errs) < 2.5, `massimo ${Math.max(...errs).toFixed(2)}`);
  assert.ok(path.every((p) => !p.lost));
});

test('inseguimento: se il punto sparisce per qualche fotogramma lo segna perso e poi lo ritrova', () => {
  const tex = texture(3);
  const world = { x: 200, y: 120 };
  const frames = [];
  const truth = [];
  for (let i = 0; i < 60; i++) {
    const c = cam(i);
    const f = view(tex, c.x, c.y);
    if (i >= 20 && i < 26) f.g.fill(128); // ostacolo: tutto grigio
    frames.push(f);
    truth.push({ x: world.x - c.x, y: world.y - c.y });
  }
  const path = trackPoint(frames, truth[0], { radius: 7, search: 12 });
  assert.ok(path.slice(20, 26).every((p) => p.lost), 'durante l’ostacolo è perso');
  assert.ok(path.slice(0, 20).every((p) => !p.lost));
  const back = path.slice(30);
  assert.ok(back.every((p) => !p.lost), 'dopo l’ostacolo è ritrovato');
  const e = Math.hypot(path[40].x - truth[40].x, path[40].y - truth[40].y);
  assert.ok(e < 1.5, `ritrovato nel punto giusto (errore ${e.toFixed(2)})`);
});

test('inseguimento: punto troppo vicino al bordo o uscito dal fotogramma', () => {
  const tex = texture(4);
  const f0 = view(tex, 100, 70);
  assert.throws(() => trackPoint([f0, f0], { x: 2, y: 3 }), /troppo vicino al bordo/);
  // il mondo scivola e il punto esce a destra dal fotogramma
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push(view(tex, 100 - i * 6, 70));
  const path = trackPoint(frames, { x: 150, y: 60 }, { radius: 7, search: 10 });
  assert.equal(path[0].lost, false);
  assert.equal(path.at(-1).lost, true, 'uscito dal quadro = perso');
  assert.ok(path.at(-1).x <= W, 'la posizione resta dentro il quadro');
  assert.deepEqual(trackPoint([], { x: 1, y: 1 }), []);
});

test('percorso: la semplificazione tiene la forma con pochi punti', () => {
  const pts = Array.from({ length: 200 }, (_, i) => ({ t: i / 10, x: 0.5 + 0.2 * Math.sin(i / 20), y: 0.5 + 0.0005 * i }));
  const s = simplifyPath(pts, 0.002);
  assert.ok(s.length < 60 && s.length > 4, `${s.length} punti`);
  assert.equal(s[0], pts[0]);
  assert.equal(s.at(-1), pts.at(-1));
  // ricostruzione entro la tolleranza
  for (const p of pts) {
    const k = s.findLastIndex((q) => q.t <= p.t);
    const a = s[k];
    const b = s[Math.min(k + 1, s.length - 1)];
    const u = b.t === a.t ? 0 : (p.t - a.t) / (b.t - a.t);
    assert.ok(Math.abs(a.x + (b.x - a.x) * u - p.x) <= 0.0021);
  }
  assert.equal(simplifyPath(pts.slice(0, 2)).length, 2);
});

test('toGray: luminanza dei colori', () => {
  const g = toGray({ w: 2, h: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]) });
  assert.ok(Math.abs(g.g[0] - 76.245) < 0.01 && Math.abs(g.g[1] - 149.685) < 0.01);
});
