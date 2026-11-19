import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAMP_PRESETS, normalizeCurve, rampDuration, rampSegments, speedAt, warpTime } from '../../src/core/speedramp.js';
import { applySpeedRamp, addClip, validateProject, clipEnd } from '../../src/core/timeline.js';
import { createClip, createProject, findClip } from '../../src/core/project.js';
import { valueAt } from '../../src/core/keyframes.js';

function project({ dur = 4, speed = 1, mediaDur = 30, followers = 0, fps = 30 } = {}) {
  const p = createProject({ fps });
  p.media.m = { id: 'm', name: 'v', kind: 'video', mime: 'video/webm', size: 1, duration: mediaDur, width: 1920, height: 1080 };
  const c = createClip('video', { mediaId: 'm', duration: dur, speed, in: 1 });
  addClip(p, p.tracks[1].id, c, 2);
  for (let i = 0; i < followers; i++) addClip(p, p.tracks[1].id, createClip('video', { mediaId: 'm', duration: 2 }), 2 + dur + i * 2);
  return { p, id: c.id };
}

test('speedAt e normalizeCurve: interpolazione, punti ai bordi, limiti e ordine', () => {
  const pts = [{ t: 0.5, s: 4 }, { t: 0, s: 1 }];
  const n = normalizeCurve(pts);
  assert.deepEqual(n.map((p) => p.t), [0, 0.5, 1]);
  assert.equal(speedAt(pts, 0), 1);
  assert.equal(speedAt(pts, 0.25), 2.5);
  assert.equal(speedAt(pts, 0.5), 4);
  assert.equal(speedAt(pts, 1), 4, 'dopo l’ultimo punto resta l’ultima velocità');
  assert.equal(normalizeCurve([{ t: 0.5, s: 99 }])[0].s, 8);
  assert.equal(normalizeCurve([{ t: 0.5, s: 0 }])[0].s, 0.1);
  assert.throws(() => normalizeCurve([]), /vuota/);
  assert.throws(() => normalizeCurve([{ t: NaN, s: 1 }]), /vuota/);
});

test('rampSegments: velocità costante 2× = pezzi a 2× e durata dimezzata; la sorgente è coperta tutta', () => {
  const segs = rampSegments([{ t: 0, s: 2 }, { t: 1, s: 2 }], 8);
  assert.ok(segs.length >= 8);
  assert.ok(segs.every((g) => Math.abs(g.speed - 2) < 1e-9));
  assert.ok(Math.abs(rampDuration(segs) - 4) < 1e-9);
  assert.ok(Math.abs(segs.reduce((s, g) => s + g.src, 0) - 8) < 1e-9);
  assert.equal(segs[0].u0, 0);
  assert.ok(Math.abs(segs.at(-1).u1 - 1) < 1e-12);
});

test('rampSegments: ogni preset rispetta limiti di velocità, durata minima e l’integrale 1/velocità', () => {
  for (const pr of RAMP_PRESETS) {
    for (const span of [1, 2.5, 6, 20, 120]) {
      for (const fps of [24, 30, 60]) {
        const segs = rampSegments(pr.points, span, { fps });
        assert.ok(segs.length >= 2 && segs.length <= 48);
        assert.ok(segs.every((g) => g.speed >= 0.1 - 1e-9 && g.speed <= 8 + 1e-9), `${pr.id}: velocità nei limiti`);
        assert.ok(segs.every((g) => g.dur >= 1 / fps - 1e-9), `${pr.id}/${span}/${fps}: pezzo di almeno un fotogramma`);
        assert.ok(Math.abs(segs.reduce((s, g) => s + g.dur * g.speed, 0) - span) < 1e-9, 'sorgente consumata = span');
        // integrale numerico di 1/s(u) · span
        let integral = 0;
        const N = 4000;
        for (let i = 0; i < N; i++) integral += (1 / speedAt(pr.points, (i + 0.5) / N)) * (span / N);
        const got = rampDuration(segs);
        assert.ok(Math.abs(got - integral) / integral < (segs.length < 6 ? 0.22 : 0.08), `${pr.id}/${span}: durata ${got.toFixed(3)} vs integrale ${integral.toFixed(3)}`);
      }
    }
  }
});

test('rampSegments: clip troppo corto o durata non valida → errore comprensibile', () => {
  assert.throws(() => rampSegments(RAMP_PRESETS[0].points, 0.3), /troppo corto/);
  assert.throws(() => rampSegments(RAMP_PRESETS[0].points, 0), /troppo corto/);
  assert.throws(() => rampSegments(RAMP_PRESETS[0].points, NaN), /troppo corto/);
});

test('warpTime: monotona, 0 all’inizio, durata totale alla fine, coerente con i pezzi', () => {
  const segs = rampSegments(RAMP_PRESETS[1].points, 6);
  assert.equal(warpTime(segs, 0), 0);
  assert.ok(Math.abs(warpTime(segs, 1) - rampDuration(segs)) < 1e-9);
  let prev = -1;
  for (let u = 0; u <= 1; u += 0.01) {
    const t = warpTime(segs, u);
    assert.ok(t >= prev - 1e-12);
    prev = t;
  }
  assert.ok(Math.abs(warpTime(segs, segs[3].u1) - segs.slice(0, 4).reduce((s, g) => s + g.dur, 0)) < 1e-9);
});

test('applySpeedRamp: la sorgente è continua, la durata cambia e i clip seguenti scorrono', () => {
  const { p, id } = project({ dur: 6, speed: 1, followers: 2 });
  const before = p.tracks[1].clips.map((c) => c.start);
  const ids = applySpeedRamp(p, id, RAMP_PRESETS[1].points);
  assert.deepEqual(validateProject(p), []);
  const track = p.tracks[1];
  const mine = ids.map((i) => findClip(p, i).clip);
  assert.ok(mine.length >= 8);
  assert.equal(mine[0].id, id, 'il primo pezzo mantiene l’id del clip');
  assert.equal(mine[0].start, 2);
  let src = 1; // il clip partiva da 1 s di sorgente
  for (const c of mine) {
    assert.ok(Math.abs(c.in - src) < 1e-9, 'sorgente continua');
    src += c.duration * c.speed;
  }
  assert.ok(Math.abs(src - (1 + 6)) < 1e-9, 'la stessa parte di video è usata per intero');
  for (let i = 1; i < mine.length; i++) assert.ok(Math.abs(mine[i].start - clipEnd(mine[i - 1])) < 1e-9, 'pezzi attaccati');
  const newTotal = clipEnd(mine.at(-1)) - 2;
  const delta = newTotal - 6;
  const followers = track.clips.filter((c) => !ids.includes(c.id));
  assert.equal(followers.length, 2);
  followers.forEach((f, i) => assert.ok(Math.abs(f.start - (before[i + 1] + delta)) < 1e-9, 'i seguenti scorrono'));
  assert.ok(mine.every((c) => c.muted), 'audio muto per default');
});

test('applySpeedRamp: dissolvenze, transizione e animazioni stanno solo agli estremi; «audio» opzionale', () => {
  const { p, id } = project({ dur: 5 });
  const c = findClip(p, id).clip;
  c.fadeIn = 0.5;
  c.fadeOut = 0.7;
  c.anim.in = { type: 'fade', duration: 0.4 };
  c.anim.out = { type: 'fade', duration: 0.4 };
  const ids = applySpeedRamp(p, id, RAMP_PRESETS[0].points, { keepAudio: true });
  const mine = ids.map((i) => findClip(p, i).clip);
  assert.equal(mine[0].fadeIn, Math.min(0.5, mine[0].duration), 'la dissolvenza non supera il primo pezzo');
  assert.equal(mine.at(-1).fadeOut, Math.min(0.7, mine.at(-1).duration));
  assert.ok(mine.slice(1).every((x) => x.fadeIn === 0 && !x.anim.in));
  assert.ok(mine.slice(0, -1).every((x) => x.fadeOut === 0 && !x.anim.out));
  assert.ok(mine.every((x) => !x.muted));
  assert.deepEqual(validateProject(p), []);
});

test('applySpeedRamp: i keyframe restano sullo stesso punto del video', () => {
  const { p, id } = project({ dur: 4 });
  const c = findClip(p, id).clip;
  c.keyframes.x = [{ t: 0, v: 0, e: 'linear' }, { t: 4, v: 1, e: 'linear' }]; // 0→1 lungo tutto il clip
  const ids = applySpeedRamp(p, id, RAMP_PRESETS[1].points);
  const mine = ids.map((i) => findClip(p, i).clip);
  // posizione di sorgente di ogni istante di uscita: x deve essere proporzionale (lineare nel video originale)
  const x0 = mine[0].start;
  const segs = rampSegments(RAMP_PRESETS[1].points, 4);
  let acc = 0;
  mine.forEach((m, i) => {
    const g = segs[i];
    // all'inizio del pezzo: x = u0 (tolleranza per interpolazione fra i punti)
    assert.ok(Math.abs(valueAt(m, 'x', 0) - g.u0) < 0.02, `pezzo ${i}: x iniziale ${valueAt(m, 'x', 0)} ≈ ${g.u0}`);
    assert.ok(Math.abs(valueAt(m, 'x', m.duration) - g.u1) < 0.02, `pezzo ${i}: x finale ${valueAt(m, 'x', m.duration)} ≈ ${g.u1}`);
    acc += m.duration;
  });
  assert.ok(Math.abs(mine.at(-1).start + mine.at(-1).duration - x0 - acc) < 1e-9);
  assert.deepEqual(validateProject(p), []);
});

test('applySpeedRamp: errori — clip audio, traccia bloccata, clip troppo corto', () => {
  const { p, id } = project({ dur: 4 });
  p.tracks[1].locked = true;
  assert.throws(() => applySpeedRamp(p, id, RAMP_PRESETS[0].points), /bloccata/);
  p.tracks[1].locked = false;
  const { p: q, id: idQ } = project({ dur: 0.3 });
  assert.throws(() => applySpeedRamp(q, idQ, RAMP_PRESETS[0].points), /troppo corto/);
  const a = createProject();
  a.media.s = { id: 's', name: 's', kind: 'audio', mime: 'audio/wav', size: 1, duration: 10, width: 0, height: 0 };
  const ac = createClip('audio', { mediaId: 's', duration: 4 });
  addClip(a, a.tracks[2].id, ac, 0);
  assert.throws(() => applySpeedRamp(a, ac.id, RAMP_PRESETS[0].points), /video/);
});

test('applySpeedRamp: prova a caso (durate, velocità di partenza, curve, seguenti) sempre valida e senza perdere sorgente', () => {
  let seed = 31;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let k = 0; k < 300; k++) {
    const dur = 0.6 + rnd() * 30;
    const speed = [0.5, 1, 1.5, 2, 4][Math.floor(rnd() * 5)];
    const fps = [24, 30, 60][Math.floor(rnd() * 3)];
    const { p, id } = project({ dur, speed, mediaDur: 300, followers: Math.floor(rnd() * 3), fps });
    const n = 2 + Math.floor(rnd() * 6);
    const pts = Array.from({ length: n }, () => ({ t: rnd(), s: 0.1 + rnd() * 7.9 }));
    const span = dur * speed;
    let ids;
    try {
      ids = applySpeedRamp(p, id, pts);
    } catch (e) {
      assert.match(e.message, /troppo corto|transizione|sovrappost/, `errore inatteso: ${e.message}`);
      continue;
    }
    assert.deepEqual(validateProject(p), [], `#${k}`);
    const mine = ids.map((i) => findClip(p, i).clip);
    const used = mine.reduce((s, c) => s + c.duration * c.speed, 0);
    assert.ok(Math.abs(used - span) < 1e-6, `#${k}: sorgente usata ${used} vs ${span}`);
  }
});
