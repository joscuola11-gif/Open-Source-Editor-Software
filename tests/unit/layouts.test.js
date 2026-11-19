import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUTS, layoutClips, layoutById, placeInCell } from '../../src/core/layouts.js';
import { createClip, createProject, allClips, findClip } from '../../src/core/project.js';
import { addClip, addTrack, validateProject } from '../../src/core/timeline.js';

function project(n, { W = 1920, H = 1080, sizes = [], sequential = false } = {}) {
  const p = createProject({ width: W, height: H });
  const ids = [];
  for (let i = 0; i < n; i++) {
    const [w, h] = sizes[i] ?? [1920, 1080];
    p.media[`m${i}`] = { id: `m${i}`, name: `c${i}`, kind: 'video', mime: 'video/webm', size: 1, duration: 5, width: w, height: h };
    const c = createClip('video', { mediaId: `m${i}`, duration: 4 });
    let track = p.tracks[1];
    if (!sequential && i > 0) track = addTrack(p, 'video');
    addClip(p, track.id, c, sequential ? i * 4 : 0);
    ids.push(c.id);
  }
  return { p, ids };
}
/** Rettangolo visibile del clip sul canvas, in frazioni del canvas. */
function visibleRect(p, clip) {
  const media = p.media[clip.mediaId];
  const { width: W, height: H } = p.settings;
  const fit = Math.min(W / media.width, H / media.height);
  const fw = media.width * fit;
  const fh = media.height * fit;
  const w = fw * (1 - clip.crop.l - clip.crop.r) * clip.transform.scale;
  const h = fh * (1 - clip.crop.t - clip.crop.b) * clip.transform.scale;
  const cx = W / 2 + clip.transform.x * W + ((clip.crop.l - clip.crop.r) / 2) * fw * clip.transform.scale;
  const cy = H / 2 + clip.transform.y * H + ((clip.crop.t - clip.crop.b) / 2) * fh * clip.transform.scale;
  return { x: (cx - w / 2) / W, y: (cy - h / 2) / H, w: w / W, h: h / H };
}
const close = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≉ ${b}`);

test('placeInCell: due video 16:9 affiancati in un canvas 16:9 (riempi e adatta)', () => {
  const left = LAYOUTS.find((l) => l.id === 'split-2h').cells[0];
  const cover = placeInCell({ canvasW: 1920, canvasH: 1080, mediaW: 1920, mediaH: 1080, cell: left, fill: 'cover' });
  close(cover.x, -0.25);
  close(cover.y, 0);
  close(cover.scale, 1);
  close(cover.crop.l, 0.25);
  close(cover.crop.r, 0.25);
  close(cover.crop.t, 0);
  const contain = placeInCell({ canvasW: 1920, canvasH: 1080, mediaW: 1920, mediaH: 1080, cell: left, fill: 'contain' });
  close(contain.scale, 0.5);
  close(contain.crop.l, 0);
});

test('layoutClips: ogni disposizione riempie esattamente i riquadri, per ogni formato di canvas e di media', () => {
  for (const lay of LAYOUTS) {
    for (const [W, H] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
      for (const sizes of [[1920, 1080], [1080, 1920], [1000, 1000], [3000, 1000]]) {
        const { p, ids } = project(lay.cells.length, { W, H, sizes: Array(lay.cells.length).fill(sizes) });
        assert.equal(layoutClips(p, ids, lay.id), lay.cells.length);
        assert.deepEqual(validateProject(p), [], lay.id);
        ids.forEach((id, i) => {
          const rc = visibleRect(p, findClip(p, id).clip);
          const cell = lay.cells[i];
          close(rc.x, cell.x, 1e-6, `${lay.id} ${W}x${H} ${sizes} x`);
          close(rc.y, cell.y, 1e-6, `${lay.id} y`);
          close(rc.w, cell.w, 1e-6, `${lay.id} w`);
          close(rc.h, cell.h, 1e-6, `${lay.id} h`);
        });
      }
    }
  }
});

test('layoutClips «adatta»: il clip sta tutto dentro il riquadro, senza ritaglio', () => {
  const { p, ids } = project(2, { sizes: [[1080, 1920], [1080, 1920]] });
  layoutClips(p, ids, 'split-2h', { fill: 'contain' });
  for (const [i, id] of ids.entries()) {
    const c = findClip(p, id).clip;
    assert.deepEqual(c.crop, { l: 0, t: 0, r: 0, b: 0 });
    const rc = visibleRect(p, c);
    const cell = layoutById('split-2h').cells[i];
    assert.ok(rc.x >= cell.x - 1e-9 && rc.x + rc.w <= cell.x + cell.w + 1e-9 && rc.y >= -1e-9 && rc.y + rc.h <= 1 + 1e-9);
  }
});

test('layoutClips: clip in fila sulla stessa traccia vengono portati a iniziare insieme su tracce diverse', () => {
  const { p, ids } = project(3, { sequential: true });
  assert.equal(new Set(allClips(p).map((c) => c.start)).size, 3);
  layoutClips(p, ids, 'split-3h');
  assert.deepEqual(validateProject(p), []);
  const cs = ids.map((id) => findClip(p, id));
  assert.ok(cs.every((f) => f.clip.start === 0), 'tutti iniziano insieme');
  assert.equal(new Set(cs.map((f) => f.track.id)).size, 3, 'ognuno sulla sua traccia');
});

test('layoutClips: già sovrapposti restano dove sono; senza «stack» i tempi non cambiano', () => {
  const { p, ids } = project(2, { sequential: true });
  layoutClips(p, ids, 'split-2h', { stack: false });
  assert.equal(findClip(p, ids[1]).clip.start, 4);
  const { p: q, ids: idsQ } = project(2);
  const before = JSON.stringify(allClips(q).map((c) => [c.start, c.duration]));
  layoutClips(q, idsQ, 'pip-br');
  assert.equal(JSON.stringify(allClips(q).map((c) => [c.start, c.duration])), before);
});

test('layoutClips: errori chiari, clip in più e testi ignorati, vecchie animazioni di posizione tolte', () => {
  const { p, ids } = project(2);
  assert.throws(() => layoutClips(p, ids, 'non-esiste'), /sconosciuta/);
  assert.throws(() => layoutClips(p, [ids[0]], 'split-2h'), /almeno 2/);
  assert.throws(() => layoutClips(p, ids, 'grid-4'), /almeno 4/);
  const text = createClip('text', { duration: 2 });
  addClip(p, p.tracks[0].id, text, 0);
  assert.throws(() => layoutClips(p, [ids[0], text.id], 'split-2h'), /almeno 2/, 'il testo non conta');
  const c0 = findClip(p, ids[0]).clip;
  c0.keyframes.x = [{ t: 0, v: 0.5, e: 'linear' }];
  layoutClips(p, ids, 'split-2h');
  assert.equal(c0.keyframes.x, undefined);
  // più clip dei riquadri: gli altri restano intatti
  const { p: q, ids: idsQ } = project(3);
  const third = findClip(q, idsQ[2]).clip;
  const snap = JSON.stringify(third);
  assert.equal(layoutClips(q, idsQ, 'split-2h'), 2);
  assert.equal(JSON.stringify(third), snap);
});

test('layoutClips: prova a caso con molte combinazioni dà sempre un progetto valido', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let k = 0; k < 300; k++) {
    const lay = LAYOUTS[Math.floor(rnd() * LAYOUTS.length)];
    const n = lay.min + Math.floor(rnd() * 3);
    const sizes = Array.from({ length: n }, () => [200 + Math.floor(rnd() * 4000), 200 + Math.floor(rnd() * 4000)]);
    const { p, ids } = project(n, { W: 360 + Math.floor(rnd() * 3000), H: 360 + Math.floor(rnd() * 3000), sizes, sequential: rnd() < 0.5 });
    layoutClips(p, ids, lay.id, { fill: rnd() < 0.5 ? 'cover' : 'contain', stack: rnd() < 0.8 });
    assert.deepEqual(validateProject(p), [], `${k} ${lay.id}`);
    for (const id of ids.slice(0, lay.cells.length)) {
      const c = findClip(p, id).clip;
      assert.ok(c.crop.l >= 0 && c.crop.l < 0.95 && c.transform.scale > 0);
    }
  }
});

test('layoutClips PiP: il riquadro grande finisce sempre sotto quelli piccoli', () => {
  const { p, ids } = project(2);
  // ids[1] sta su una traccia più in alto: lo metto come grande
  layoutClips(p, [ids[1], ids[0]], 'pip-br');
  assert.deepEqual(validateProject(p), []);
  const idx = (id) => p.tracks.indexOf(findClip(p, id).track);
  assert.ok(idx(ids[1]) > idx(ids[0]), 'grande sotto, piccolo sopra (indice più alto = più in basso)');
  // già nell'ordine giusto: nessuna traccia nuova
  const { p: q, ids: iq } = project(2);
  const before = q.tracks.length;
  layoutClips(q, [iq[0], iq[1]], 'pip-tl');
  assert.equal(q.tracks.length, before);
});
