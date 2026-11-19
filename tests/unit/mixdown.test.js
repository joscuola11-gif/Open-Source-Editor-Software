import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mixdown, softLimit } from '../../src/core/mixdown.js';
import { dominantFrequency } from '../../src/core/dsp.js';
import { createClip, createProject } from '../../src/core/project.js';
import { addClip } from '../../src/core/timeline.js';

const SR = 22050;
const sine = (f, sec, amp = 0.5) => Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR));
const rms = (x, a, b) => Math.sqrt(x.subarray(a, b).reduce((s, v) => s + v * v, 0) / (b - a));

function proj() {
  const p = createProject();
  p.media.a = { id: 'a', name: 'a', kind: 'audio', mime: 'audio/wav', size: 1, duration: 4, width: 0, height: 0, hasAudio: true };
  p.media.b = { id: 'b', name: 'b', kind: 'audio', mime: 'audio/wav', size: 1, duration: 4, width: 0, height: 0, hasAudio: true };
  return p;
}
const audioTrack = (p) => p.tracks.find((t) => t.type === 'audio');
const sources = () => new Map([['a', { channels: [sine(440, 4)], sampleRate: SR }], ['b', { channels: [sine(880, 4)], sampleRate: SR }]]);

test('mixdown: durata del progetto, due clip in momenti diversi, mono → stereo', () => {
  const p = proj();
  addClip(p, audioTrack(p).id, createClip('audio', { mediaId: 'a', start: 0, duration: 2 }), 0);
  addClip(p, p.tracks.filter((t) => t.type === 'audio')[0].id, createClip('audio', { mediaId: 'b', start: 3, duration: 1 }), 3);
  const { channels } = mixdown(p, sources(), { sampleRate: SR });
  assert.equal(channels.length, 2);
  assert.equal(channels[0].length, 4 * SR);
  assert.ok(Math.abs(dominantFrequency(channels[0], SR, 4000) - 440) < 8, 'prima 440 Hz');
  assert.ok(Math.abs(dominantFrequency(channels[0], SR, SR * 3 + 2000, 4096) - 880) < 16, 'poi 880 Hz');
  assert.ok(rms(channels[0], SR * 2.2, SR * 2.8) < 1e-6, 'silenzio fra i due');
  assert.deepEqual(channels[0], channels[1], 'mono duplicato');
});

test('mixdown: volume, dissolvenza in/out, traccia o clip silenziati', () => {
  const p = proj();
  const t = audioTrack(p);
  addClip(p, t.id, createClip('audio', { mediaId: 'a', start: 0, duration: 4, volume: 0.5, fadeIn: 1, fadeOut: 1 }), 0);
  const { channels } = mixdown(p, sources(), { sampleRate: SR });
  const mid = rms(channels[0], SR * 1.5, SR * 2.5);
  assert.ok(Math.abs(mid - (0.5 * 0.5) / Math.SQRT2) < 0.01, `volume dimezzato (${mid})`);
  assert.ok(rms(channels[0], 0, SR * 0.2) < mid * 0.35, 'la dissolvenza in parte da zero');
  assert.ok(rms(channels[0], SR * 3.8, SR * 4) < mid * 0.35, 'e finisce a zero');
  const q = proj();
  addClip(q, audioTrack(q).id, createClip('audio', { mediaId: 'a', start: 0, duration: 2, muted: true }), 0);
  assert.ok(mixdown(q, sources(), { sampleRate: SR }).channels[0].every((v) => v === 0), 'clip silenziato');
  const r = proj();
  addClip(r, audioTrack(r).id, createClip('audio', { mediaId: 'a', start: 0, duration: 2 }), 0);
  audioTrack(r).muted = true;
  assert.ok(mixdown(r, sources(), { sampleRate: SR }).channels[0].every((v) => v === 0), 'traccia silenziata');
});

test('mixdown: velocità (altezza conservata), «in» del clip, limitatore sulle somme alte', () => {
  const p = proj();
  addClip(p, audioTrack(p).id, createClip('audio', { mediaId: 'a', start: 0, duration: 1, speed: 2, in: 1 }), 0);
  const { channels } = mixdown(p, sources(), { sampleRate: SR });
  assert.equal(channels[0].length, SR);
  assert.ok(Math.abs(dominantFrequency(channels[0], SR, 2000, 4096) - 440) < 12, 'a velocità doppia l\'altezza resta 440 Hz');
  assert.ok(rms(channels[0], 4000, 18000) > 0.2);
  // due clip sovrapposti su tracce diverse non superano mai 1
  const q = proj();
  const tracks = q.tracks.filter((t) => t.type === 'audio');
  q.tracks.push({ ...structuredClone(tracks[0]), id: 'extra', clips: [] });
  addClip(q, 'extra', createClip('audio', { mediaId: 'a', start: 0, duration: 2, volume: 2 }), 0);
  addClip(q, tracks[0].id, createClip('audio', { mediaId: 'a', start: 0, duration: 2, volume: 2 }), 0);
  const hot = mixdown(q, sources(), { sampleRate: SR }).channels[0];
  assert.ok(Math.max(...hot.map(Math.abs)) <= 1, 'mai oltre 1');
  assert.ok(Math.max(...hot.map(Math.abs)) > 0.9, 'ma forte');
  assert.equal(softLimit(0.5), 0.5);
  assert.ok(softLimit(5) <= 1 && softLimit(5) > 0.95);
  assert.equal(softLimit(-0.3), -0.3);
  // frequenze diverse = errore chiaro
  assert.throws(() => mixdown(p, new Map([['a', { channels: [sine(440, 4)], sampleRate: 8000 }]]), { sampleRate: SR }), /stessa frequenza/);
  // nessun suono: silenzio della durata giusta
  const empty = createProject();
  assert.equal(mixdown(empty, new Map(), { sampleRate: SR }).channels[0].length, 1);
});
