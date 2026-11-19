import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSilences, removeSilences, timelineRanges } from '../../src/core/silence.js';
import { clipEnd, projectDuration, validateProject } from '../../src/core/timeline.js';
import { EditError } from '../../src/core/util.js';
import { baseProject, videoTrackId, put } from '../helpers/fixtures.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
/** Inviluppo sintetico a 50/s: sequenza di [secondi, ampiezza]. */
const env = (...parts) => Uint8Array.from(parts.flatMap(([sec, amp]) => Array(Math.round(sec * 50)).fill(amp)));

test('findSilences: trova solo i tratti abbastanza lunghi e lascia un margine ai lati', () => {
  const peaks = env([1, 200], [1.5, 2], [1, 200], [0.3, 2], [1, 200], [1, 0]);
  const s = findSilences(peaks, 50, { threshold: 0.05, minSilence: 0.6, keep: 0.1 });
  assert.equal(s.length, 2, 'la pausa di 0,3 s è troppo breve, quella finale conta');
  near(s[0].start, 1.1);
  near(s[0].end, 2.4);
  near(s[1].start, 4.9, 1e-6);
  near(s[1].end, 5.7, 1e-6);
});

test('findSilences: soglia, intervallo e input assurdi', () => {
  const peaks = env([1, 30], [1, 200], [1, 30]);
  assert.equal(findSilences(peaks, 50, { threshold: 0.05, minSilence: 0.5, keep: 0 }).length, 0, '30/255 = 12% è sopra la soglia del 5%');
  assert.equal(findSilences(peaks, 50, { threshold: 0.2, minSilence: 0.5, keep: 0 }).length, 2, 'soglia più alta: i fruscii sono silenzio');
  const only = findSilences(peaks, 50, { threshold: 0.2, minSilence: 0.5, keep: 0, from: 1.1, to: 1.9 });
  assert.equal(only.length, 0, 'limitato al tratto sonoro');
  assert.deepEqual(findSilences(new Uint8Array(0), 50), []);
  assert.deepEqual(findSilences(null, 50), []);
  assert.deepEqual(findSilences(peaks, 0), []);
  assert.deepEqual(findSilences(env([5, 0]), 50, { minSilence: 0.6, keep: 3 }), [], 'il margine mangia tutta la pausa');
  const all = findSilences(env([5, 0]), 50, { minSilence: 0.6, keep: 0 });
  assert.equal(all.length, 1);
  near(all[0].end - all[0].start, 5);
});

test('removeSilences: toglie le pause dal clip e da tutte le tracce, chiudendo i buchi', () => {
  const p = baseProject();
  const v = videoTrackId(p, 2);
  const c = put(p, v, 'v1', 2); // timeline 2..12, sorgente 0..10
  const a = put(p, p.tracks.find((t) => t.type === 'audio').id, 'a1', 2); // sincronizzato
  const sil = [{ start: 1, end: 2.5 }, { start: 6, end: 7 }]; // secondi di sorgente
  const before = projectDuration(p);
  const r = removeSilences(p, c.id, sil);
  assert.equal(r.cuts, 2);
  near(r.removed, 2.5);
  near(before - projectDuration(p), 2.5, 1e-6);
  const vs = p.tracks.find((t) => t.id === v).clips;
  assert.equal(vs.length, 3);
  near(vs[0].start, 2);
  near(vs[0].duration, 1);
  near(vs[1].start, 3);
  near(vs[1].in, 2.5, 1e-6);
  near(vs[1].duration, 3.5);
  near(vs[2].start, 6.5);
  near(vs[2].in, 7, 1e-6);
  near(vs[2].duration, 3);
  assert.equal(p.tracks.flatMap((t) => t.clips).filter((x) => x.kind === 'audio').length, 3, 'anche l\'audio è stato tagliato negli stessi punti');
  assert.deepEqual(validateProject(p), []);
  assert.ok(a);
});

test('removeSilences: velocità diversa da 1, solo la traccia del clip, e errori comprensibili', () => {
  const p = baseProject();
  const v = videoTrackId(p, 2);
  const c = put(p, v, 'v1', 0);
  c.speed = 2;
  c.duration = 5; // 10 s di sorgente in 5 s di timeline
  const r = timelineRanges(p, c, [{ start: 2, end: 4 }, { start: 9, end: 12 }, { start: 20, end: 30 }]);
  assert.equal(r.length, 2);
  near(r[0].start, 1);
  near(r[0].end, 2);
  near(r[1].start, 4.5);
  near(clipEnd(c), r[1].end, 1e-6, 'il secondo tratto è tagliato alla fine del clip');
  const q = baseProject();
  const vv = videoTrackId(q, 2);
  const cc = put(q, vv, 'v1', 0);
  const aa = put(q, q.tracks.find((t) => t.type === 'audio').id, 'a1', 0);
  removeSilences(q, cc.id, [{ start: 2, end: 4 }], { trackIds: [vv] });
  assert.equal(q.tracks.find((t) => t.id === q.tracks.find((x) => x.type === 'audio').id).clips[0].duration, 20, 'l\'altra traccia non si tocca');
  assert.throws(() => removeSilences(q, cc.id, []), EditError);
  assert.throws(() => removeSilences(q, 'nessuno', [{ start: 1, end: 2 }]), EditError);
  assert.throws(() => removeSilences(q, aa.id, [{ start: 500, end: 600 }]), EditError, 'tratti fuori dal clip');
});
