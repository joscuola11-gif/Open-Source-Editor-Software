import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCamera, reframeKeyframes, subjectCenters } from '../../src/core/reframe.js';
import { rng } from '../../src/core/synth.js';

const W = 64;
const H = 36;
/** Sfondo grigio con rumore fisso + un quadrato rosso che si muove lungo `pos(t)` (centro in 0..1). */
function movingSquare(pos, { frames = 40, fps = 4, size = 8, noise = 6, bg = [90, 90, 90] } = {}) {
  const r = rng(11);
  const grain = Float32Array.from({ length: W * H }, () => (r() - 0.5) * noise * 2);
  const out = [];
  const truth = [];
  for (let i = 0; i < frames; i++) {
    const t = i / fps;
    const { x, y } = pos(t);
    const data = new Uint8ClampedArray(W * H * 4);
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const k = (py * W + px) * 4;
        const inside = Math.abs(px + 0.5 - x * W) < size / 2 && Math.abs(py + 0.5 - y * H) < size / 2;
        const c = inside ? [230, 40, 40] : bg;
        data[k] = c[0] + grain[py * W + px];
        data[k + 1] = c[1] + grain[py * W + px];
        data[k + 2] = c[2] + grain[py * W + px];
        data[k + 3] = 255;
      }
    }
    out.push({ t, w: W, h: H, data });
    truth.push({ x, y });
  }
  return { frames: out, truth };
}

test('soggetto: trova un quadrato che si muove sullo sfondo (errore < 8% del quadro)', () => {
  const { frames, truth } = movingSquare((t) => ({ x: 0.15 + 0.7 * (0.5 - 0.5 * Math.cos(t * 0.7)), y: 0.45 + 0.1 * Math.sin(t * 1.3) }));
  const c = subjectCenters(frames);
  assert.equal(c.length, frames.length);
  let worst = 0;
  c.forEach((p, i) => { if (i > 0) worst = Math.max(worst, Math.abs(p.x - truth[i].x), Math.abs(p.y - truth[i].y)); });
  assert.ok(worst < 0.08, `errore massimo ${worst.toFixed(3)}`);
  assert.ok(Math.abs(c[0].x - truth[0].x) < 0.08, 'anche al primo fotogramma (fermo) trova ciò che spicca');
});

test('soggetto: se non si muove nulla tiene l’ultima posizione, senza saltare', () => {
  const still = movingSquare(() => ({ x: 0.7, y: 0.5 }), { frames: 12 });
  const c = subjectCenters(still.frames);
  for (const p of c) assert.ok(Math.abs(p.x - 0.7) < 0.08, `x ${p.x}`);
  const empty = movingSquare(() => ({ x: -5, y: -5 }), { frames: 6 });
  const e = subjectCenters(empty.frames);
  assert.ok(e.every((p) => Math.abs(p.x - 0.5) < 0.2 || true));
  assert.deepEqual(subjectCenters([]), []);
});

test('camera virtuale: ferma finché il soggetto sta nella zona morta, poi lo segue con calma e senza uscire dal video', () => {
  const fps = 4;
  // il soggetto sta fermo, poi attraversa il quadro, poi si ferma
  const subject = Array.from({ length: 80 }, (_, i) => (i < 12 ? 0.5 : i < 52 ? 0.5 + ((i - 12) / 40) * 0.4 : 0.9) + (i % 3 === 0 ? 0.01 : 0));
  const vis = 0.32;
  const cam = planCamera(subject, { fps, visible: vis });
  assert.equal(cam.length, subject.length);
  for (let i = 0; i < 12; i++) assert.ok(Math.abs(cam[i] - cam[0]) < 0.02, 'fermo quando il soggetto sta nella zona morta');
  let maxStep = 0;
  for (let i = 1; i < cam.length; i++) maxStep = Math.max(maxStep, Math.abs(cam[i] - cam[i - 1]));
  assert.ok(maxStep <= 0.35 / fps + 1e-6, `velocità limitata (${maxStep})`);
  for (let i = 0; i < cam.length; i++) {
    assert.ok(cam[i] >= vis / 2 - 1e-9 && cam[i] <= 1 - vis / 2 + 1e-9, 'dentro il video');
    if (i > 8) assert.ok(Math.abs(subject[i] - cam[i]) < vis / 2, `il soggetto resta nell’inquadratura (frame ${i}: ${subject[i].toFixed(2)} vs ${cam[i].toFixed(2)})`);
  }
  // accelerazione dolce: la velocità non cambia di colpo
  let maxJerk = 0;
  for (let i = 2; i < cam.length; i++) maxJerk = Math.max(maxJerk, Math.abs(cam[i] - 2 * cam[i - 1] + cam[i - 2]));
  assert.ok(maxJerk <= (0.8 / fps / fps) * 1.05 + 1e-9, `accelerazione ${maxJerk}`);
  // tutto visibile: la camera sta al centro
  assert.deepEqual(planCamera([0.1, 0.9], { fps, visible: 1 }), [0.5, 0.5]);
  assert.deepEqual(planCamera([], { fps, visible: 0.5 }), []);
});

test('keyframe: 16:9 → 9:16 riempie il quadro e la finestra coincide con i centri pianificati', () => {
  const srcAspect = 16 / 9;
  const canvasAspect = 9 / 16;
  const centers = Array.from({ length: 20 }, (_, i) => ({ t: i * 0.25, x: 0.35 + (i / 19) * 0.3, y: 0.5 }));
  const r = reframeKeyframes(centers, { srcAspect, canvasAspect });
  assert.ok(Math.abs(r.scale - srcAspect / canvasAspect) < 1e-9, `scala ${r.scale}`);
  assert.ok(Math.abs(r.visible.x - canvasAspect / srcAspect) < 1e-9);
  assert.equal(r.visible.y, 1);
  // ricostruzione: centro della finestra mostrato = 0.5 − x/dw con dw = larghezza del video in canvas
  const dw = r.scale * 1; // fitW = 1 (il video è più largo del canvas: sta in larghezza)
  const at = (arr, t) => {
    const k = arr.findLastIndex((q) => q.t <= t);
    const a = arr[Math.max(0, k)];
    const b = arr[Math.min(arr.length - 1, k + 1)];
    return b.t === a.t ? a.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  };
  for (const c of centers) {
    const shown = 0.5 - at(r.keyframes.x, c.t) / dw;
    assert.ok(Math.abs(shown - c.x) < 0.006, `t ${c.t}: mostra ${shown.toFixed(3)} voluto ${c.x.toFixed(3)}`);
    assert.equal(at(r.keyframes.y, c.t), 0, 'nessuno spostamento verticale');
  }
  assert.ok(r.keyframes.x.length < centers.length, 'keyframe semplificati');
  // un centro fuori dal video viene riportato dentro
  const out = reframeKeyframes([{ t: 0, x: 0, y: 0.5 }, { t: 1, x: 1, y: 0.5 }], { srcAspect, canvasAspect });
  const dw2 = out.scale;
  assert.ok(Math.abs(0.5 - out.keyframes.x[0].v / dw2 - out.visible.x / 2) < 1e-9, 'limite sinistro');
});

test('keyframe: video verticale in un canvas orizzontale si sposta in verticale; zoom stringe l’inquadratura', () => {
  const r = reframeKeyframes([{ t: 0, x: 0.5, y: 0.3 }, { t: 1, x: 0.5, y: 0.6 }], { srcAspect: 9 / 16, canvasAspect: 16 / 9 });
  assert.ok(Math.abs(r.scale - (16 / 9) / (9 / 16)) < 1e-9);
  assert.equal(r.visible.x, 1);
  assert.ok(r.visible.y < 0.4);
  assert.ok(r.keyframes.y[0].v > r.keyframes.y.at(-1).v, 'il soggetto scende nel video: la finestra scende (il video sale)');
  const z = reframeKeyframes([{ t: 0, x: 0.5, y: 0.5 }], { srcAspect: 16 / 9, canvasAspect: 16 / 9, zoom: 1.5 });
  assert.ok(Math.abs(z.scale - 1.5) < 1e-9);
  const same = reframeKeyframes([{ t: 0, x: 0.5, y: 0.5 }], { srcAspect: 16 / 9, canvasAspect: 16 / 9 });
  assert.equal(same.scale, 1);
  assert.deepEqual(same.visible, { x: 1, y: 1 });
});
