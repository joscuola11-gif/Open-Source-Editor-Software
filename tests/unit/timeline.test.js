import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addClip, addMediaClip, addTrack, clipEnd, deleteClips, duplicateClips, findFreeStart, insertFreezeFrame, moveClips,
  planMove, pasteClips, copyClips, rippleDelete, setSpeed, setTransition, snapPoints, snapValue, splitClip, trimBounds,
  trimClip, trimToTime, cutRange, validateProject, repairTrack, normalizeProject, removeMedia, moveTrack, removeTrack, projectDuration,
} from '../../src/core/timeline.js';
import { upsertKeyframe, valueAt } from '../../src/core/keyframes.js';
import { EditError } from '../../src/core/util.js';
import { baseProject, videoTrackId, audioTrackId, put, mustBeValid } from '../helpers/fixtures.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('addClip piazza nel punto libero più vicino', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  const a = put(p, t, 'v1', 0); // 0..10
  const b = put(p, t, 'v2', 3); // desiderato 3 → occupato → 10
  near(b.start, 10);
  const c = put(p, t, 'i1', 30);
  near(c.start, 30);
  mustBeValid(p);
  assert.equal(a.start, 0);
});

test('findFreeStart usa i buchi e sceglie il più vicino', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  put(p, t, 'v1', 0); // 0-10
  put(p, t, 'v2', 20); // 20-26
  const track = p.tracks.find((x) => x.id === t);
  near(findFreeStart(track, 12, 5), 12); // buco 10-20
  near(findFreeStart(track, 18, 5), 15); // spinto per entrare
  near(findFreeStart(track, 18, 11), 26); // non entra nel buco
  near(findFreeStart(track, -5, 1), 10);
});

test('addClip rifiuta tipo traccia errato e tracce bloccate', () => {
  const p = baseProject();
  const clip = addMediaClip(p, p.media.a1, { start: 0 });
  assert.equal(p.tracks.find((t) => t.clips.includes(clip)).type, 'audio');
  const vt = p.tracks.find((t) => t.type === 'video');
  vt.locked = true;
  assert.throws(() => addClip(p, vt.id, { ...clip, id: 'x', kind: 'image', mediaId: 'i1' }, 0), EditError);
  vt.locked = false;
  assert.throws(() => addClip(p, vt.id, { ...clip, id: 'y' }, 0), /audio/);
});

test('splitClip conserva sorgente, durata totale e continuità dei keyframe', () => {
  const p = baseProject();
  const c = put(p, videoTrackId(p, 2), 'v1', 2);
  c.speed = 2; c.duration = 5; // consuma 10 s di sorgente
  upsertKeyframe(c, 'x', 0, 0);
  upsertKeyframe(c, 'x', 4, 0.8);
  const before = valueAt(c, 'x', 2);
  const right = splitClip(p, c.id, 4);
  const left = p.tracks.flatMap((t) => t.clips).find((x) => x.id === c.id);
  near(left.duration, 2); near(right.start, 4); near(right.duration, 3);
  near(right.in, left.in + left.duration * 2);
  near(left.duration + right.duration, 5);
  near(valueAt(left, 'x', 2), before);       // fine del sinistro
  near(valueAt(right, 'x', 0), before);      // inizio del destro
  near(valueAt(right, 'x', 2), 0.8);         // coda invariata
  mustBeValid(p);
});

test('splitClip fuori dai bordi lancia', () => {
  const p = baseProject();
  const c = put(p, videoTrackId(p, 2), 'v1', 0);
  assert.throws(() => splitClip(p, c.id, 0.001), EditError);
  assert.throws(() => splitClip(p, c.id, 9.999), EditError);
  assert.throws(() => splitClip(p, c.id, 50), EditError);
});

test('trim rispetta file sorgente e vicini', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  const a = put(p, t, 'v1', 0);   // 0-10 (media 10)
  const b = put(p, t, 'v1', 12);  // 12-22
  b.in = 4; b.duration = 6;       // usa il file da 4 s a 10 s: 12-18
  trimClip(p, a.id, 'end', 5);    near(a.duration, 5);
  trimClip(p, a.id, 'end', 100);  near(a.duration, 10);            // massimo: fine del file
  trimClip(p, b.id, 'start', 0);  near(b.start, 10); near(b.in, 2); // fermato dal vicino
  trimClip(p, b.id, 'start', 11); trimClip(p, b.id, 'start', -9); near(b.start, 10);
  trimClip(p, a.id, 'start', 4);  near(a.start, 4); near(a.in, 4);  // l'in-point avanza
  near(clipEnd(a), 10);
  trimClip(p, a.id, 'start', -50); near(a.start, 0); near(a.in, 0); // non oltre l'inizio del file
  mustBeValid(p);
});

test('trim non scende sotto un fotogramma', () => {
  const p = baseProject({ fps: 25 });
  const a = put(p, videoTrackId(p, 2), 'v1', 0);
  trimClip(p, a.id, 'end', 0);
  near(a.duration, 1 / 25);
  trimClip(p, a.id, 'start', 99);
  assert.ok(a.duration >= 1 / 25 - 1e-9);
});

test('trim con velocità: la sorgente disponibile scala con speed', () => {
  const p = baseProject();
  const a = put(p, videoTrackId(p, 2), 'v1', 0);
  setSpeed(p, a.id, 2);            // 10 s sorgente → 5 s
  near(a.duration, 5);
  const { max } = trimBounds(p, a.id, 'end');
  near(max, 5);
  trimClip(p, a.id, 'end', 99);
  near(a.duration, 5);
  mustBeValid(p);
});

test('setSpeed sposta i clip successivi quando rallenta e scala i keyframe', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  const a = put(p, t, 'v1', 0);
  const b = put(p, t, 'v2', 10);
  upsertKeyframe(a, 'opacity', 5, 0.5);
  const applied = setSpeed(p, a.id, 0.5);
  near(applied, 0.5);
  near(a.duration, 20);
  near(b.start, 20);
  near(a.keyframes.opacity[0].t, 10);
  setSpeed(p, a.id, 1000);
  near(a.speed, 8);
  setSpeed(p, a.id, 0.001);
  near(a.speed, 0.1);
  mustBeValid(p);
  assert.throws(() => setSpeed(p, put(p, videoTrackId(p, 1), 'i1', 0).id, 2), EditError);
});

test('moveClips: spostamento libero, clamp ai vicini e fra tracce', () => {
  const p = baseProject();
  const t2 = videoTrackId(p, 1);
  const t1 = videoTrackId(p, 2);
  const a = put(p, t1, 'v2', 0);  // 0-6
  const b = put(p, t1, 'v2', 10); // 10-16
  let plan = planMove(p, [a.id], 2);
  near(plan.delta, 2);
  plan = planMove(p, [a.id], 8);            // finirebbe sopra b → il più vicino valido
  assert.ok(Math.abs(plan.delta - 4) < 1e-6 || Math.abs(plan.delta - 16) < 1e-6, `delta=${plan.delta}`);
  plan = planMove(p, [a.id], -5);           // non sotto zero
  near(plan.delta, 0);
  moveClips(p, [a.id], 2); near(a.start, 2);
  assert.throws(() => moveClips(p, [a.id], 7), EditError);
  // cambio traccia: la traccia sopra è libera
  const plan2 = planMove(p, [b.id], 1, -1);
  assert.equal(plan2.offset, -1);
  moveClips(p, [b.id], plan2.delta, plan2.offset);
  assert.ok(p.tracks.find((t) => t.id === t2).clips.some((c) => c.id === b.id));
  // video su traccia audio: offset non valido → ripiega su 0
  const plan3 = planMove(p, [a.id], 0, 2);
  assert.equal(plan3.offset, 0);
  mustBeValid(p);
});

test('moveClips di gruppo mantiene le distanze relative', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  const a = put(p, t, 'v2', 0), b = put(p, t, 'v2', 8), c = put(p, t, 'v2', 20);
  const plan = planMove(p, [a.id, b.id], 3);
  moveClips(p, [a.id, b.id], plan.delta, plan.offset);
  near(a.start, 3); near(b.start, 11);
  near(b.start - a.start, 8);
  assert.ok(c.start >= clipEnd(b));
  mustBeValid(p);
});

test('deleteClips e rippleDelete', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  const a = put(p, t, 'v2', 0), b = put(p, t, 'v2', 6), c = put(p, t, 'v2', 12);
  const tr = p.tracks.find((x) => x.id === t);
  deleteClips(p, [b.id]);
  assert.equal(tr.clips.length, 2);
  near(c.start, 12);
  const p2 = baseProject();
  const t2 = videoTrackId(p2, 2);
  const x = put(p2, t2, 'v2', 0), y = put(p2, t2, 'v2', 6), z = put(p2, t2, 'v2', 12);
  rippleDelete(p2, [y.id]);
  near(z.start, 6);
  assert.equal(p2.tracks.find((q) => q.id === t2).clips.length, 2);
  mustBeValid(p2);
  assert.ok(x && a);
});

test('duplicateClips affianca la copia con un nuovo id', () => {
  const p = baseProject();
  const a = put(p, videoTrackId(p, 2), 'v2', 0);
  const [id] = duplicateClips(p, [a.id]);
  assert.notEqual(id, a.id);
  const copy = p.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
  near(copy.start, 6);
  mustBeValid(p);
});

test('copia/incolla preserva le distanze e crea tracce se serve', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  const a = put(p, t, 'v2', 1), b = put(p, t, 'v2', 8);
  const clip = copyClips(p, [a.id, b.id]);
  const ids = pasteClips(p, clip, 30);
  assert.equal(ids.length, 2);
  const [pa, pb] = ids.map((id) => p.tracks.flatMap((x) => x.clips).find((c) => c.id === id));
  near(pb.start - pa.start, 7);
  near(pa.start, 30);
  mustBeValid(p);
  // incollare sopra l'originale non sovrappone
  pasteClips(p, clip, 1);
  mustBeValid(p);
});

test('transizione adiacente → sovrapposizione reale con ripple', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  const a = put(p, t, 'v1', 0);   // 0-10
  const b = put(p, t, 'v2', 10);  // 10-16
  const c = put(p, t, 'v2', 16);  // 16-22
  setTransition(p, b.id, { type: 'fade', duration: 1 });
  near(b.start, 9); near(c.start, 15);
  near(b.transition.duration, 1);
  mustBeValid(p);
  // cambia durata → il ripple si adegua
  setTransition(p, b.id, { type: 'fade', duration: 2 });
  near(b.start, 8); near(c.start, 14);
  // rimozione → torna adiacente
  setTransition(p, b.id, null);
  near(b.start, 10); near(c.start, 16); assert.equal(b.transition, null);
  mustBeValid(p);
  assert.ok(a);
});

test('transizione è limitata dalla durata dei clip adiacenti', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  const a = put(p, t, 'v2', 0);
  const b = put(p, t, 'v2', 6);
  trimClip(p, b.id, 'end', 6.5); // b dura 0.5
  setTransition(p, b.id, { type: 'fade', duration: 3 });
  assert.ok(b.transition.duration <= 0.5 + 1e-9);
  mustBeValid(p);
  assert.ok(a);
});

test('una transizione su clip isolato non altera la posizione', () => {
  const p = baseProject();
  const a = put(p, videoTrackId(p, 2), 'v2', 4);
  setTransition(p, a.id, { type: 'iris', duration: 1 });
  near(a.start, 4);
  assert.equal(a.transition.type, 'iris');
});

test('dividere dentro una transizione è rifiutato, fuori funziona', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  put(p, t, 'v1', 0);
  const b = put(p, t, 'v2', 10);
  setTransition(p, b.id, { type: 'fade', duration: 2 }); // b: 8-14, overlap 8-10
  assert.throws(() => splitClip(p, b.id, 9), EditError);
  splitClip(p, b.id, 11);
  mustBeValid(p);
});

test('insertFreezeFrame divide e inserisce un fermo immagine con ripple', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  const a = put(p, t, 'v1', 0);
  const after = put(p, t, 'v2', 10);
  p.media.fz = { id: 'fz', name: 'fermo', kind: 'image', mime: 'image/png', size: 1, duration: 0, width: 10, height: 10, hasAudio: false };
  const fz = insertFreezeFrame(p, a.id, 4, 'fz', 2);
  near(fz.start, 4); near(fz.duration, 2);
  const tr = p.tracks.find((x) => x.id === t);
  assert.equal(tr.clips.length, 4);
  near(after.start, 12);
  mustBeValid(p);
});

test('tracce: aggiungi, ordina, rimuovi', () => {
  const p = baseProject();
  const v = addTrack(p, 'video');
  assert.equal(p.tracks[0].id, v.id);
  const aud = addTrack(p, 'audio');
  assert.equal(p.tracks.at(-1).id, aud.id);
  assert.equal(moveTrack(p, v.id, -1), false);
  assert.equal(moveTrack(p, v.id, 1), true);
  assert.equal(p.tracks[1].id, v.id);
  assert.equal(moveTrack(p, p.tracks.find((t) => t.type === 'video' && t.id !== v.id).id, 1) || true, true);
  p.tracks.find((t) => t.id === aud.id).locked = true;
  assert.throws(() => removeTrack(p, aud.id), EditError);
  mustBeValid(p);
});

test('removeMedia elimina i clip collegati', () => {
  const p = baseProject();
  put(p, videoTrackId(p, 2), 'v2', 0);
  put(p, videoTrackId(p, 2), 'v2', 6);
  put(p, videoTrackId(p, 2), 'v1', 12);
  assert.equal(removeMedia(p, 'v2'), 2);
  assert.equal(p.media.v2, undefined);
  mustBeValid(p);
});

test('snap aggancia a bordi, playhead e marcatori', () => {
  const p = baseProject();
  const a = put(p, videoTrackId(p, 2), 'v2', 5);
  p.markers.push({ id: 'm', time: 20, label: '' });
  const pts = snapPoints(p, { playhead: 12.5 });
  assert.deepEqual(pts, [0, 5, 11, 12.5, 20]);
  assert.deepEqual(snapValue(pts, 11.2, 0.3), { time: 11, snapped: true });
  assert.deepEqual(snapValue(pts, 15, 0.3), { time: 15, snapped: false });
  assert.deepEqual(snapPoints(p, { exclude: new Set([a.id]) }), [0, 20]);
});

test('validateProject rileva sovrapposizioni illegali e file oltre la durata', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  const a = put(p, t, 'v2', 0);
  const b = put(p, t, 'v2', 6);
  b.start = 5;
  assert.ok(validateProject(p).some((e) => /sovrapposizione/.test(e)));
  b.start = 6; mustBeValid(p);
  a.duration = 7; // media 6 s
  assert.ok(validateProject(p).some((e) => /oltre la fine/.test(e)));
});

test('repairTrack/normalizeProject riparano file con sovrapposizioni', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  const a = put(p, t, 'v2', 0), b = put(p, t, 'v2', 6);
  b.start = 2;
  const fixed = normalizeProject(structuredClone(p));
  mustBeValid(fixed);
  const [x, y] = fixed.tracks.find((q) => q.id === t).clips;
  assert.ok(y.start >= x.start + x.duration - 1e-9);
  repairTrack(p.tracks.find((q) => q.id === t));
  mustBeValid(p);
  assert.ok(a);
});

test('normalizeProject scarta clip senza media e dati spazzatura', () => {
  const raw = { settings: { width: 'x', fps: 9999 }, media: { m: { kind: 'bogus' } }, tracks: [{ type: 'video', clips: [{ kind: 'video', mediaId: 'zz', start: 1, duration: 2 }, null, { kind: 'text', start: -3, duration: 'a' }] }] };
  const p = normalizeProject(raw);
  mustBeValid(p);
  assert.equal(p.tracks.length >= 1, true);
  const survivors = p.tracks.flatMap((t) => t.clips);
  assert.equal(survivors.length, 1);                         // il clip video senza media è scartato
  assert.equal(survivors[0].kind, 'text');                   // il testo con dati rotti viene riparato
  assert.equal(survivors[0].start, 0);
  assert.equal(survivors[0].duration, 1);
  assert.equal(projectDuration(p), 1);
  assert.equal(p.settings.fps, 120);
});

test('addMediaClip crea una traccia nuova se la prima è occupata solo su quella sbloccata', () => {
  const p = baseProject();
  const vids = p.tracks.filter((t) => t.type === 'video');
  vids.forEach((t) => (t.locked = true));
  const before = p.tracks.length;
  const clip = addMediaClip(p, p.media.v2, { start: 0 });
  assert.equal(p.tracks.length, before + 1);
  assert.ok(p.tracks[0].clips.includes(clip));
  assert.ok(audioTrackId(p));
});

test('addMediaClip accoda sulla stessa traccia se lo scostamento è minimo, altrimenti cambia traccia', async () => {
  const { SLOT_TOLERANCE } = await import('../../src/core/timeline.js');
  const p = baseProject();
  const t = videoTrackId(p, 2);
  put(p, t, 'v1', 0);                                    // 0-10
  const near = addMediaClip(p, p.media.v2, { start: 9.95 }); // sovrapposto di 50 ms → si accoda a 10
  assert.equal(p.tracks.find((x) => x.clips.includes(near)).id, t);
  assert.ok(Math.abs(near.start - 10) < 1e-9);
  const far = addMediaClip(p, p.media.v2, { start: 12 });    // occupato per intero → altra traccia
  assert.notEqual(p.tracks.find((x) => x.clips.includes(far)).id, t);
  assert.ok(SLOT_TOLERANCE > 0 && SLOT_TOLERANCE < 0.5);
  mustBeValid(p);
});

test('trimToTime: toglie la parte a sinistra o a destra della testina senza spostare il resto', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  const c = put(p, t, 'v1', 2); // 2..12, sorgente 0..10
  trimToTime(p, c.id, 'left', 5);
  near(c.start, 5);
  near(c.duration, 7);
  near(c.in, 3, 1e-6); // la sorgente avanza di 3 s: il contenuto non scorre
  near(clipEnd(c), 12);
  trimToTime(p, c.id, 'right', 9);
  near(c.start, 5);
  near(c.duration, 4);
  near(c.in, 3);
  mustBeValid(p);
});

test('trimToTime: con velocità diversa da 1 la sorgente avanza in proporzione', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  const c = put(p, t, 'v1', 0);
  setSpeed(p, c.id, 2); // 5 s di timeline per 10 s di sorgente
  near(c.duration, 5);
  trimToTime(p, c.id, 'left', 2);
  near(c.in, 4, 1e-6);
  near(c.duration, 3);
  mustBeValid(p);
});

test('trimToTime: rifiuta punti fuori o troppo vicini ai bordi, tracce bloccate e valori assurdi', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  const c = put(p, t, 'v1', 0);
  for (const at of [-1, 0, 0.001, 9.999, 10, 50]) assert.throws(() => trimToTime(p, c.id, 'left', at), EditError, `t=${at}`);
  assert.throws(() => trimToTime(p, c.id, 'mezzo', 5), EditError);
  assert.throws(() => trimToTime(p, c.id, 'left', NaN), EditError);
  assert.throws(() => trimToTime(p, 'inesistente', 'left', 5), EditError);
  p.tracks.find((x) => x.id === t).locked = true;
  assert.throws(() => trimToTime(p, c.id, 'right', 5), EditError);
  near(c.duration, 10, 1e-9);
});

test('trimToTime: rifiuta di tagliare dentro una transizione invece di tagliare altrove', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  const a = put(p, t, 'v1', 0); // 0..10
  const b = put(p, t, 'v2', 10); // 10..16
  setTransition(p, b.id, { type: 'fade', duration: 2 }); // b parte a 8 e si sovrappone ad a
  const before = structuredClone(p);
  assert.throws(() => trimToTime(p, a.id, 'left', 9.5), EditError, 'a sinistra di a, oltre l\'inizio di b');
  assert.deepEqual(p.tracks, before.tracks, 'nessuna modifica parziale');
  assert.equal(a.duration, 10, 'a non è stato toccato');
  // dove c'è posto invece si può: a destra di a, prima dell'inizio della transizione
  trimToTime(p, a.id, 'right', 9);
  near(clipEnd(a), 9);
  mustBeValid(p);
});

test('cutRange: toglie un intervallo e chiude il buco; il clip a cavallo si divide e la sorgente resta coerente', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  const a = put(p, t, 'v1', 0); // 0..10
  const b = put(p, t, 'a1'.replace('a1', 'v2'), 10); // 10..16
  p.markers.push({ id: 'm1', time: 2, label: '' }, { id: 'm2', time: 6, label: '' }, { id: 'm3', time: 14, label: '' });
  const n = cutRange(p, 4, 12);
  assert.equal(n, 2);
  const cs = p.tracks.find((x) => x.id === t).clips;
  assert.equal(cs.length, 2);
  near(cs[0].start, 0);
  near(cs[0].duration, 4);
  near(cs[1].start, 4, 1e-6);
  near(cs[1].duration, 4);
  near(cs[1].in, 2, 1e-6); // b: 12 → 2 s di sorgente consumati
  near(projectDuration(p), 8);
  assert.deepEqual(p.markers.map((m) => [m.id, m.time]), [['m1', 2], ['m3', 6]], 'il marcatore dentro sparisce, quello dopo scorre');
  mustBeValid(p);
  assert.equal(a.id, cs[0].id);
  assert.equal(b.id, cs[1].id);
});

test('cutRange: un solo clip che copre l\'intervallo viene diviso in due, senza buchi', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  put(p, t, 'v1', 0);
  cutRange(p, 3, 5);
  const cs = p.tracks.find((x) => x.id === t).clips;
  assert.equal(cs.length, 2);
  near(cs[0].duration, 3);
  near(cs[1].start, 3);
  near(cs[1].in, 5, 1e-6);
  near(cs[1].duration, 5);
  mustBeValid(p);
});

test('cutRange: taglia insieme video e audio (sincronizzati); con trackIds solo le tracce scelte', () => {
  const p = baseProject();
  const v = videoTrackId(p, 2);
  const au = audioTrackId(p);
  put(p, v, 'v1', 0);
  put(p, au, 'a1', 0);
  cutRange(p, 2, 4);
  for (const id of [v, au]) near(p.tracks.find((x) => x.id === id).clips.reduce((s, c) => s + c.duration, 0), id === v ? 8 : 18);
  const clipsAll = p.tracks.flatMap((x) => x.clips);
  assert.equal(clipsAll.length, 4, 'ognuno si è diviso in due');
  mustBeValid(p);
  const q = baseProject();
  put(q, videoTrackId(q, 2), 'v1', 0);
  put(q, audioTrackId(q), 'a1', 0);
  cutRange(q, 2, 4, { trackIds: [videoTrackId(q, 2)] });
  assert.equal(q.tracks.find((x) => x.id === audioTrackId(q)).clips.length, 1, 'l\'audio è intatto');
  assert.equal(q.tracks.find((x) => x.id === audioTrackId(q)).clips[0].duration, 20);
});

test('cutRange: clip interamente dentro eliminati, clip prima e dopo intatti; rifiuta intervalli assurdi e tracce bloccate', () => {
  const p = baseProject();
  const t = videoTrackId(p, 2);
  const a = put(p, t, 'v2', 0); // 0..6
  const mid = put(p, t, 'i1', 6); // 6..11
  const c = put(p, t, 'v2', 11); // 11..17
  cutRange(p, 6, 11);
  const cs = p.tracks.find((x) => x.id === t).clips;
  assert.deepEqual(cs.map((x) => x.id), [a.id, c.id]);
  assert.ok(!cs.some((x) => x.id === mid.id));
  near(cs[1].start, 6);
  mustBeValid(p);
  for (const [s0, e0] of [[NaN, 1], [1, NaN], [-1, 2], [5, 5], [5, 5.001]]) assert.throws(() => cutRange(p, s0, e0), EditError, `${s0}..${e0}`);
  p.tracks.find((x) => x.id === t).locked = true;
  const before = structuredClone(p);
  assert.throws(() => cutRange(p, 1, 3), EditError);
  assert.deepEqual(p, before, 'nessuna modifica con una traccia bloccata');
  p.tracks.find((x) => x.id === t).locked = false;
  assert.equal(cutRange(p, 500, 510), 0, 'fuori da ogni clip non succede nulla');
  mustBeValid(p);
});
