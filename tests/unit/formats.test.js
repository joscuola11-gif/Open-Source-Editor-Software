import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSrt, formatSrt, parseTimestamp, formatTimestamp } from '../../src/core/srt.js';
import { fixWebmDuration, readWebmDuration } from '../../src/core/webm.js';
import { zipStore, unzipStore, crc32 } from '../../src/core/zip.js';
import { clipGain, fadeEnvelope } from '../../src/core/audio-math.js';
import { createClip } from '../../src/core/project.js';
import { upsertKeyframe } from '../../src/core/keyframes.js';
import { ANIMATIONS, clipAnimationState, animationState, TRANSITION_IDS, ENTER_EXIT_IDS } from '../../src/core/animations.js';
import { formatTimecode, formatDuration, formatBytes, hexToRgb, mergeDeep } from '../../src/core/util.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

// ---------------------------------------------------------------- SRT
test('srt: parsing robusto (BOM, CRLF, punto decimale, tag HTML, senza indice)', () => {
  const src = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Ciao</i>\r\nmondo\r\n\r\n00:00:03.250 --> 00:00:04.000\r\n{\\an8}Solo timing\r\n\r\n3\r\nrotto --> x\r\nnope\r\n\r\n4\r\n00:00:09,000 --> 00:00:08,000\r\ninvertito\r\n';
  const cues = parseSrt(src);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 1, end: 2.5, text: 'Ciao\nmondo' });
  near(cues[1].start, 3.25);
  assert.equal(cues[1].text, 'Solo timing');
  assert.deepEqual(parseSrt(''), []);
  assert.deepEqual(parseSrt(null), []);
});

test('srt: round trip e arrotondamento dei millisecondi', () => {
  const cues = [{ start: 0, end: 1.9996, text: 'a' }, { start: 3661.001, end: 3662, text: 'b\nc' }];
  const out = formatSrt(cues);
  assert.match(out, /00:00:00,000 --> 00:00:02,000/);
  assert.match(out, /01:01:01,001 --> 01:01:02,000/);
  const back = parseSrt(out);
  assert.equal(back.length, 2);
  assert.equal(back[1].text, 'b\nc');
  assert.equal(formatTimestamp(59.9996), '00:01:00,000');
  near(parseTimestamp('00:00:01,5'), 1.5);
});

// ---------------------------------------------------------------- WebM
function vint(n) { return n < 127 ? Uint8Array.of(0x80 | n) : Uint8Array.of(0x40 | (n >> 8), n & 255); }
const el = (idBytes, data) => Uint8Array.of(...idBytes, ...vint(data.length), ...data);
const cat = (...a) => Uint8Array.from(a.flatMap((x) => [...x]));
function fakeWebm({ withDuration = false, unknownSegment = true } = {}) {
  const header = el([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]);
  const scale = el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]); // 1.000.000 ns
  const dur = withDuration ? cat(Uint8Array.of(0x44, 0x89, 0x88), new Uint8Array(new Float64Array([1234]).buffer).reverse()) : new Uint8Array();
  const info = el([0x15, 0x49, 0xa9, 0x66], cat(scale, dur));
  const cluster = el([0x1f, 0x43, 0xb6, 0x75], [0xe7, 0x81, 0x00]);
  const body = cat(info, cluster);
  const segHdr = unknownSegment ? Uint8Array.of(0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff) : Uint8Array.of(0x18, 0x53, 0x80, 0x67, 0x01, 0, 0, 0, 0, 0, 0, body.length);
  return cat(header, segHdr, body);
}

test('webm: inserisce Duration quando manca (Segment a dimensione ignota)', () => {
  const src = fakeWebm();
  assert.equal(readWebmDuration(src), null);
  const fixed = fixWebmDuration(src, 5230.5);
  assert.equal(fixed.length, src.length + 11);
  near(readWebmDuration(fixed), 5230.5, 1e-6);
  // il Cluster è rimasto intatto in coda
  assert.deepEqual([...fixed.slice(-6)], [...src.slice(-6)]);
});

test('webm: Segment a dimensione nota viene aggiornato in modo coerente', () => {
  const src = fakeWebm({ unknownSegment: false });
  const fixed = fixWebmDuration(src, 1000);
  near(readWebmDuration(fixed), 1000, 1e-6);
  // intestazione EBML (12 byte) + id Segment (4) + campo dimensione (8) = dati dal byte 24
  assert.equal(fixed[23], fixed.length - 24, 'la dimensione del Segment deve coprire esattamente i dati');
  assert.equal(src[23], src.length - 24);
});

test('webm: Duration già presente viene sovrascritta; dati non validi restano intatti', () => {
  const src = fakeWebm({ withDuration: true });
  near(readWebmDuration(src), 1234, 1e-6);
  const fixed = fixWebmDuration(src, 99);
  assert.equal(fixed.length, src.length);
  near(readWebmDuration(fixed), 99, 1e-6);
  const junk = Uint8Array.from([1, 2, 3, 4, 5]);
  assert.deepEqual([...fixWebmDuration(junk, 5)], [...junk]);
  assert.deepEqual([...fixWebmDuration(new Uint8Array(0), 5)], []);
});

// ---------------------------------------------------------------- ZIP
test('zip: round trip con nomi unicode e file vuoti, crc verificato', () => {
  const files = [
    { name: 'project.json', data: new TextEncoder().encode('{"a":1}') },
    { name: 'media/città ✓.bin', data: Uint8Array.from({ length: 70000 }, (_, i) => i % 251) },
    { name: 'vuoto.txt', data: new Uint8Array(0) },
  ];
  const zip = zipStore(files);
  const back = unzipStore(zip);
  assert.equal(back.length, 3);
  assert.deepEqual(back.map((f) => f.name), files.map((f) => f.name));
  for (let i = 0; i < files.length; i++) assert.deepEqual([...back[i].data], [...files[i].data]);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const bad = zip.slice();
  bad[30 + 'project.json'.length + 2] ^= 0xff; // corrompe un byte dei dati del primo file
  assert.throws(() => unzipStore(bad), /Checksum|corrotto|non valido/);
  assert.throws(() => unzipStore(new Uint8Array(10)), /non valido/);
});

// ---------------------------------------------------------------- audio
test('audio: volume, dissolvenze, keyframe, mute e crossfade a potenza costante', () => {
  const c = createClip('audio', { duration: 10, volume: 0.5, fadeIn: 2, fadeOut: 2 });
  c.start = 5;
  const track = { muted: false, clips: [c] };
  near(clipGain(track, c, 5), 0);
  near(clipGain(track, c, 6), 0.25);
  near(clipGain(track, c, 8), 0.5);
  near(clipGain(track, c, 14), 0.25);
  track.muted = true;
  near(clipGain(track, c, 8), 0);
  track.muted = false; c.muted = true;
  near(clipGain(track, c, 8), 0);
  c.muted = false;
  upsertKeyframe(c, 'volume', 0, 1); upsertKeyframe(c, 'volume', 10, 0);
  near(clipGain(track, c, 8), 0.7 * fadeEnvelope(c, 3));
  const a = createClip('video', { duration: 10 }); a.start = 0;
  const b = createClip('video', { duration: 10 }); b.start = 9; b.transition = { type: 'fade', duration: 1 };
  const t2 = { muted: false, clips: [a, b] };
  near(clipGain(t2, a, 8.5), 1);
  near(clipGain(t2, a, 9.5) ** 2 + clipGain(t2, b, 9.5) ** 2, 1, 1e-9); // potenza costante
  near(clipGain(t2, b, 9), 0);
});

// ---------------------------------------------------------------- animazioni
test('animazioni: ogni tipo produce valori finiti e p=1 è neutro', () => {
  for (const id of Object.keys(ANIMATIONS)) {
    for (const p of [0, 0.25, 0.5, 0.99, 1]) {
      const s = animationState(id, p);
      for (const k of ['alpha', 'dx', 'dy', 'scale', 'sx', 'sy', 'rotation', 'blur', 'chars']) assert.ok(Number.isFinite(s[k]), `${id}@${p}.${k}`);
    }
    const end = animationState(id, 1);
    assert.equal(end.alpha, 1, `${id} alpha finale`);
    near(end.scale, 1, 1e-9); near(end.dx, 0, 1e-9); near(end.dy, 0, 1e-9);
  }
  assert.ok(TRANSITION_IDS.includes('dip-black') && !TRANSITION_IDS.includes('typewriter'));
  assert.ok(!ENTER_EXIT_IDS.includes('dip-black'));
});

test('clipAnimationState combina transizione, ingresso e uscita', () => {
  const c = createClip('image', { duration: 4 });
  c.transition = { type: 'fade', duration: 1 };
  c.anim = { in: { type: 'zoom-in', duration: 1 }, out: { type: 'fade', duration: 1 } };
  const s0 = clipAnimationState(c, 0.5);
  assert.ok(s0.alpha < 0.5 && s0.scale < 1);
  const mid = clipAnimationState(c, 2);
  assert.equal(mid.alpha, 1); assert.equal(mid.scale, 1);
  const out = clipAnimationState(c, 3.5);
  near(out.alpha, 0.5);
});

// ---------------------------------------------------------------- util
test('util: timecode, durate, byte, colori, merge', () => {
  assert.equal(formatTimecode(0, 30), '00:00:00');
  assert.equal(formatTimecode(61.5, 30), '01:01:15');
  assert.equal(formatTimecode(3600, 25), '01:00:00:00');
  assert.equal(formatTimecode(-3, 30), '00:00:00');
  assert.equal(formatTimecode(NaN, 30), '00:00:00');
  assert.equal(formatDuration(75), '1:15');
  assert.equal(formatDuration(75.25, 1), '1:15.3');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.deepEqual(hexToRgb('#ff8000'), [255, 128, 0]);
  assert.deepEqual(hexToRgb('zzz'), [0, 0, 0]);
  assert.deepEqual(mergeDeep({ a: { b: 1, c: 2 }, d: [1] }, { a: { b: 9 }, d: [2, 3], e: 1 }), { a: { b: 9, c: 2 }, d: [2, 3], e: 1 });
});

test('formatDuration non perde un secondo per errori di virgola mobile', () => {
  assert.equal(formatDuration(1.9999999999), '0:02');
  assert.equal(formatDuration(0.1 + 0.2 + 0.7 + 1), '0:02');
  assert.equal(formatDuration(59.9999999), '1:00');
});

test('formatDuration con decimali riporta correttamente al minuto successivo', () => {
  assert.equal(formatDuration(59.96, 1), '1:00.0');
  assert.equal(formatDuration(119.99, 1), '2:00.0');
  assert.equal(formatDuration(75.25, 1), '1:15.3');
  assert.equal(formatDuration(0, 1), '0:00.0');
});

test('sfondo dietro il clip: valori di partenza, riparazione di valori strani e vecchi progetti senza il campo', async () => {
  const { createClip, sanitizeBackdrop, sanitizeProject } = await import('../../src/core/project.js');
  const c = createClip('video');
  assert.deepEqual(c.backdrop, { mode: 'none', amount: 60, color: '#000000' });
  assert.deepEqual(sanitizeBackdrop(null), { mode: 'none', amount: 60, color: '#000000' });
  assert.deepEqual(sanitizeBackdrop({ mode: 'blur', amount: 500, color: 'rosso' }), { mode: 'blur', amount: 100, color: '#000000' });
  assert.deepEqual(sanitizeBackdrop({ mode: 'magia', amount: -4, color: '#12AB34' }), { mode: 'none', amount: 0, color: '#12AB34' });
  // un progetto salvato prima di questa funzione si apre con lo sfondo spento
  const old = { name: 'vecchio', settings: { width: 1920, height: 1080, fps: 30, background: '#000000' }, media: { m: { id: 'm', kind: 'image', name: 'a', mime: 'image/png', size: 1, duration: 0, width: 10, height: 10 } }, tracks: [{ id: 't', type: 'video', name: 'V', clips: [{ id: 'c1', kind: 'image', mediaId: 'm', start: 0, duration: 2 }] }] };
  const p = sanitizeProject(old);
  assert.equal(p.tracks[0].clips[0].backdrop.mode, 'none');
});
