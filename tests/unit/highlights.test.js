import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loudnessSeries, pickHighlights } from '../../src/core/highlights.js';
import { createProject, createClip } from '../../src/core/project.js';
import { addClip, addTrack, allClips, clipEnd, keepOnly, splitClipAtTimes } from '../../src/core/timeline.js';
import { rng } from '../../src/core/synth.js';

const FPS = 4;
function series(total, bursts, base = 0.02, level = 0.3, seed = 1) {
  const r = rng(seed);
  const x = new Float32Array(total * FPS);
  for (let i = 0; i < x.length; i++) {
    const t = i / FPS;
    x[i] = base * (0.5 + r()) + (bursts.some(([a, b]) => t >= a && t < b) ? level * (0.7 + 0.6 * r()) : 0);
  }
  return x;
}

test('momenti migliori: trova i tratti vivaci (movimento) e li ordina nel tempo', () => {
  const motion = series(120, [[20, 30], [70, 80], [100, 108]]);
  const r = pickHighlights({ motion, fps: FPS, length: 10, count: 3 });
  assert.equal(r.length, 3);
  const centers = r.map((h) => (h.start + h.end) / 2);
  for (const [c, want] of centers.map((c, i) => [c, [25, 75, 104][i]])) assert.ok(Math.abs(c - want) <= 3.5, `centro ${c} vs ${want}`);
  assert.ok(r.every((h, i) => !i || h.start >= r[i - 1].end), 'senza sovrapposizioni');
  assert.ok(r.every((h) => Math.abs(h.end - h.start - 10) < 0.6));
});

test('momenti migliori: movimento e volume si sommano; il solo volume basta', () => {
  const motion = series(100, [[10, 20]], 0.02, 0.3, 1);
  const loud = series(100, [[60, 70]], 0.01, 0.4, 2);
  const both = pickHighlights({ motion, loudness: loud, fps: FPS, length: 10, count: 2 });
  assert.deepEqual(both.map((h) => Math.round((h.start + h.end) / 2 / 5) * 5), [15, 65]);
  const onlyLoud = pickHighlights({ loudness: loud, fps: FPS, length: 10, count: 1 });
  assert.ok(Math.abs((onlyLoud[0].start + onlyLoud[0].end) / 2 - 65) <= 3);
});

test('momenti migliori: i bordi si agganciano ai tagli di scena vicini', () => {
  const motion = series(100, [[20.3, 31]], 0.02, 0.3);
  const r = pickHighlights({ motion, fps: FPS, length: 10, count: 1, cuts: [20, 30.5, 55] });
  assert.equal(r[0].start, 20);
  assert.ok([30, 30.5].includes(r[0].end) || Math.abs(r[0].end - 30.5) <= 1);
});

test('momenti migliori: casi limite', () => {
  assert.deepEqual(pickHighlights({ motion: [], fps: 4 }), []);
  assert.deepEqual(pickHighlights({ motion: series(10, []), fps: 0 }), []);
  const flat = pickHighlights({ motion: new Float32Array(40), fps: 4, length: 5, count: 2 });
  assert.ok(flat.length <= 2);
  const short = pickHighlights({ motion: series(8, [[2, 4]]), fps: FPS, length: 30, count: 3 });
  assert.equal(short.length, 1, 'il video è più corto della durata chiesta: un solo tratto, tutto il video');
  assert.ok(short[0].start === 0 && Math.abs(short[0].end - 8) < 0.3);
  const many = pickHighlights({ motion: series(30, [[5, 25]]), fps: FPS, length: 10, count: 9 });
  assert.ok(many.length <= 3, 'non si sovrappongono: al massimo 3 tratti da 10 s in 30 s');
});

test('volume per intervallo: segue il livello del segnale', () => {
  const sr = 8000;
  const x = new Float32Array(sr * 4);
  for (let i = sr; i < sr * 2; i++) x[i] = 0.5 * Math.sin(i * 0.3);
  const l = loudnessSeries([x], sr, 4, 16);
  assert.ok(l[5] > 0.3 && l[0] < 0.01 && l[12] < 0.01, Array.from(l).map((v) => v.toFixed(2)).join(' '));
});

// ---- operazioni sul montaggio -------------------------------------------------------------------------------------

function project() {
  const p = createProject({ name: 't' });
  p.media.m1 = { id: 'm1', name: 'a.mp4', kind: 'video', mime: 'video/mp4', size: 1, duration: 60, width: 640, height: 360, hasAudio: true };
  const v = p.tracks.find((q) => q.type === 'video') ?? addTrack(p, 'video');
  const c = createClip('video', { mediaId: 'm1', start: 0, duration: 60 });
  addClip(p, v.id, c, 0);
  const a = p.tracks.find((q) => q.type === 'audio') ?? addTrack(p, 'audio');
  const ca = createClip('audio', { mediaId: 'm1', start: 0, duration: 60 });
  addClip(p, a.id, ca, 0);
  return { p, vid: c.id, aud: ca.id };
}

test('divisione in più punti: tutti i tagli giusti, anche vicino ai bordi o ripetuti', () => {
  const { p, vid } = project();
  const n = splitClipAtTimes(p, vid, [10, 10, 25.5, 0.01, 59.99, 40, NaN]);
  assert.equal(n, 3);
  const cs = p.tracks.find((t) => t.type === 'video').clips;
  assert.deepEqual(cs.map((c) => [c.start, c.duration]), [[0, 10], [10, 15.5], [25.5, 14.5], [40, 20]]);
  assert.deepEqual(cs.map((c) => c.in), [0, 10, 25.5, 40]);
  assert.equal(p.tracks.find((t) => t.type === 'audio').clips.length, 1, 'l’altra traccia non si tocca');
});

test('montaggio dei momenti migliori: si tengono solo gli intervalli e i buchi si chiudono su tutte le tracce', () => {
  const { p } = project();
  const removed = keepOnly(p, [{ start: 10, end: 20 }, { start: 40, end: 45 }, { start: 20, end: 22 }]);
  assert.equal(removed, 3);
  for (const t of p.tracks.filter((q) => q.clips.length)) {
    const cs = [...t.clips].sort((a, b) => a.start - b.start);
    assert.equal(cs.reduce((a, c) => a + c.duration, 0), 17, 'durata 12 + 5');
    assert.ok(cs.every((c, i) => !i || Math.abs(c.start - clipEnd(cs[i - 1])) < 1e-6), 'senza buchi');
    assert.equal(cs[0].in, 10);
    assert.equal(cs.at(-1).in + cs.at(-1).duration, 45);
  }
  assert.throws(() => keepOnly(p, []), /Nessun intervallo/);
  assert.equal(allClips(p).length >= 4, true);
});
