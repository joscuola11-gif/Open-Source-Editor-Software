import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvasToSource, followKeyframes, sourceToCanvas } from '../../src/core/trackmap.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('coordinate: andata e ritorno con rotazione, ritaglio e ribaltamento', () => {
  const cases = [
    { geom: { cx: 640, cy: 360, w: 1280, h: 720, rotation: 0 }, opt: {} },
    { geom: { cx: 500, cy: 400, w: 900, h: 506, rotation: 25 }, opt: { crop: { l: 0.1, t: 0.05, r: 0.2, b: 0.15 } } },
    { geom: { cx: 700, cy: 300, w: 640, h: 360, rotation: -70 }, opt: { flipX: true, crop: { l: 0.2, t: 0, r: 0, b: 0.3 } } },
    { geom: { cx: 300, cy: 300, w: 400, h: 300, rotation: 180 }, opt: { flipX: true, flipY: true } },
  ];
  for (const c of cases) {
    for (const [u, v] of [[0.3, 0.4], [0.5, 0.5], [0.8, 0.7]]) {
      const p = sourceToCanvas(c.geom, u, v, c.opt);
      const q = canvasToSource(c.geom, p.x, p.y, c.opt);
      assert.ok(close(q.u, u, 1e-9) && close(q.v, v, 1e-9), `${JSON.stringify(c)} (${u},${v}) → (${q.u},${q.v})`);
    }
  }
});

test('coordinate: casi noti', () => {
  const g = { cx: 640, cy: 360, w: 1280, h: 720, rotation: 0 };
  assert.deepEqual(canvasToSource(g, 640, 360), { u: 0.5, v: 0.5 });
  assert.deepEqual(canvasToSource(g, 0, 0), { u: 0, v: 0 });
  assert.deepEqual(sourceToCanvas(g, 1, 1), { x: 1280, y: 720 });
  // con il ritaglio a sinistra del 20%, il bordo sinistro dell'immagine mostrata è u = 0.2
  const c = { crop: { l: 0.2, t: 0, r: 0, b: 0 } };
  assert.ok(close(canvasToSource({ ...g, w: 1024 }, 640 - 512, 360, c).u, 0.2));
  // ribaltato: la destra dello schermo è la sinistra dell'immagine
  assert.ok(close(canvasToSource(g, 1280, 360, { flipX: true }).u, 0, 1e-12));
  // ruotato di 90° in senso orario (come sullo schermo): la larghezza del contenuto (200) corre in verticale;
  // 50 px sopra il centro sono un quarto della larghezza, dal lato sinistro dell'immagine
  const r = canvasToSource({ cx: 100, cy: 100, w: 200, h: 100, rotation: 90 }, 100, 100 - 50, {});
  assert.ok(close(r.u, 0.25, 1e-9) && close(r.v, 0.5, 1e-9), `u ${r.u} v ${r.v}`);
});

test('segui: l’elemento mantiene la distanza iniziale dal punto e ne ripete il movimento', () => {
  const W = 1280;
  const H = 720;
  const pts = Array.from({ length: 41 }, (_, i) => ({ t: i * 0.1, x: 400 + i * 12, y: 300 + 80 * Math.sin(i / 6) }));
  const kf = followKeyframes(pts, { W, H, anchor: 5, base: { x: 0.1, y: -0.2 }, tolerance: 0.0005 });
  const at = (arr, t) => {
    const k = arr.findLastIndex((q) => q.t <= t + 1e-12);
    const a = arr[Math.max(0, k)];
    const b = arr[Math.min(arr.length - 1, k + 1)];
    return b.t === a.t ? a.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  };
  assert.ok(close(at(kf.x, pts[5].t), 0.1, 1e-9) && close(at(kf.y, pts[5].t), -0.2, 1e-9), 'nel punto di aggancio vale la posizione di partenza');
  for (const p of pts) {
    const want = { x: 0.1 + (p.x - pts[5].x) / W, y: -0.2 + (p.y - pts[5].y) / H };
    assert.ok(Math.abs(at(kf.x, p.t) - want.x) <= 0.00051 && Math.abs(at(kf.y, p.t) - want.y) <= 0.00051, `t ${p.t}`);
  }
  assert.ok(kf.x.length < pts.length && kf.x.length >= 2);
  assert.ok(kf.x.every((k) => k.e === 'linear'));
  assert.deepEqual(followKeyframes([], { W, H, base: { x: 0, y: 0 } }), { x: [], y: [] });
});
