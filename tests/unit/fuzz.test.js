// Fuzzing: sequenze casuali di operazioni; dopo ogni commit il progetto deve restare valido,
// un'operazione rifiutata non deve cambiare nulla e undo/redo devono essere esatti.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../src/core/store.js';
import {
  addMarker, addMediaClip, addTrack, copyClips, deleteClips, duplicateClips, insertFreezeFrame, moveClips, moveTrack,
  pasteClips, planMove, removeTrack, rippleDelete, setSpeed, setTransition, splitClip, trimClip, trimToTime, cutRange, validateProject, allClips,
  clipEnd, applySpeedRamp, splitClipAtTimes, keepOnly,
} from '../../src/core/timeline.js';
import { upsertKeyframe } from '../../src/core/keyframes.js';
import { RAMP_PRESETS } from '../../src/core/speedramp.js';
import { baseProject } from '../helpers/fixtures.js';
import { EditError } from '../../src/core/util.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runFuzz(seed, steps) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const store = new Store(baseProject({ fps: pick([24, 25, 30, 60]) }));
  const mediaIds = ['v1', 'v2', 'a1', 'i1'];
  const initial = structuredClone(store.project);
  let clipboard = null;
  let last = null;
  let committed = 0;
  const stats = {};
  let undoChecked = false;
  // undo/redo esatti: undo di tutta la cronologia riporta allo stato iniziale, redo a quello corrente
  const checkUndoRedo = () => {
    const current = structuredClone(store.project);
    let n = 0;
    while (store.undo()) n++;
    assert.deepEqual(store.project, initial, `seed ${seed}: undo completo non riporta allo stato iniziale`);
    let m = 0;
    while (store.redo()) m++;
    assert.equal(n, m, `seed ${seed}: numero di undo/redo diverso`);
    assert.deepEqual(store.project, current, `seed ${seed}: redo completo non riporta allo stato corrente`);
  };
  const clipsOf = () => allClips(store.project);
  const randomClip = () => (clipsOf().length ? pick(clipsOf()) : null);
  const randomSel = () => {
    const cs = clipsOf();
    if (!cs.length) return [];
    const n = 1 + Math.floor(r() * Math.min(3, cs.length));
    const out = new Set();
    while (out.size < n) out.add(pick(cs).id);
    return [...out];
  };
  const time = () => (r() < 0.3 ? Math.round(r() * 40) : r() * 40);

  const ops = {
    add: () => store.commit('add', (p) => addMediaClip(p, p.media[pick(mediaIds)], { start: time() })),
    track: () => store.commit('track', (p) => (r() < 0.7 || !p.tracks.length ? addTrack(p, pick(['video', 'audio'])) : removeTrack(p, pick(p.tracks).id))),
    reorder: () => (store.project.tracks.length ? store.commit('reorder', (p) => moveTrack(p, pick(p.tracks).id, pick([-1, 1]))) : { ok: true, skipped: true }),
    move: () => {
      const ids = randomSel();
      if (!ids.length) return { ok: true, skipped: true };
      const plan = planMove(store.project, ids, (r() - 0.5) * 30, pick([0, 0, -1, 1]));
      if (!plan) return { ok: true, skipped: true };
      return store.commit('move', (p) => moveClips(p, ids, plan.delta, plan.offset));
    },
    trim: () => {
      const c = randomClip();
      if (!c) return { ok: true, skipped: true };
      const side = pick(['start', 'end']);
      const edge = c.start + (r() - 0.3) * 12;
      last = { op: 'trim', id: c.id, side, edge };
      return store.commit('trim', (p) => trimClip(p, c.id, side, edge));
    },
    split: () => {
      const c = randomClip();
      if (!c) return { ok: true, skipped: true };
      return store.commit('split', (p) => splitClip(p, c.id, c.start + r() * c.duration));
    },
    trimTime: () => {
      const c = randomClip();
      if (!c) return { ok: true, skipped: true };
      return store.commit('trimTime', (p) => trimToTime(p, c.id, pick(['left', 'right']), c.start + r() * c.duration));
    },
    cut: () => {
      const a = time();
      const len = r() < 0.2 ? 0.01 : r() * 6;
      const only = r() < 0.3 && store.project.tracks.length ? [pick(store.project.tracks).id] : null;
      return store.commit('cut', (p) => cutRange(p, a, a + len, { trackIds: only }));
    },
    splitMany: () => {
      const c = randomClip();
      if (!c) return { ok: true, skipped: true };
      const times = Array.from({ length: 1 + Math.floor(r() * 4) }, () => c.start + (r() < 0.15 ? 0.01 : r()) * c.duration);
      return store.commit('splitMany', (p) => splitClipAtTimes(p, c.id, times));
    },
    keep: () => {
      const ranges = Array.from({ length: 1 + Math.floor(r() * 3) }, () => { const a = time(); return { start: a, end: a + 0.05 + r() * 5 }; });
      const only = r() < 0.3 && store.project.tracks.length ? [pick(store.project.tracks).id] : null;
      return store.commit('keep', (p) => keepOnly(p, ranges, { trackIds: only }));
    },
    del: () => store.commit('del', (p) => deleteClips(p, randomSel())),
    ripple: () => store.commit('ripple', (p) => rippleDelete(p, randomSel())),
    speed: () => {
      const c = randomClip();
      if (!c) return { ok: true, skipped: true };
      return store.commit('speed', (p) => setSpeed(p, c.id, pick([0.1, 0.25, 0.5, 1, 1.5, 2, 4, 8, 20])));
    },
    transition: () => {
      const c = randomClip();
      if (!c) return { ok: true, skipped: true };
      return store.commit('transition', (p) => setTransition(p, c.id, r() < 0.25 ? null : { type: 'fade', duration: pick([0.1, 0.5, 1, 2, 5]) }));
    },
    ramp: () => {
      const c = clipsOf().find((x) => x.kind === 'video');
      if (!c) return { ok: true, skipped: true };
      const pts = r() < 0.5 ? pick(RAMP_PRESETS).points : Array.from({ length: 2 + Math.floor(r() * 4) }, () => ({ t: r(), s: 0.1 + r() * 7.9 }));
      return store.commit('ramp', (p) => applySpeedRamp(p, c.id, pts, { keepAudio: r() < 0.5 }));
    },
    dup: () => store.commit('dup', (p) => duplicateClips(p, randomSel())),
    copy: () => {
      const ids = randomSel();
      if (ids.length) clipboard = copyClips(store.project, ids);
      return { ok: true, skipped: true };
    },
    paste: () => (clipboard ? store.commit('paste', (p) => pasteClips(p, clipboard, time())) : { ok: true, skipped: true }),
    freeze: () => {
      const c = clipsOf().find((x) => x.kind === 'video');
      if (!c) return { ok: true, skipped: true };
      return store.commit('freeze', (p) => {
        p.media.fz ??= { id: 'fz', name: 'fz', kind: 'image', mime: 'image/png', size: 1, duration: 0, width: 4, height: 4, hasAudio: false };
        return insertFreezeFrame(p, c.id, c.start + r() * c.duration, 'fz', 1.5);
      });
    },
    keyframe: () => {
      const c = randomClip();
      if (!c) return { ok: true, skipped: true };
      return store.commit('kf', (p) => {
        const q = allClips(p).find((x) => x.id === c.id);
        upsertKeyframe(q, pick(['x', 'scale', 'opacity']), r() * q.duration, r());
      });
    },
    lock: () => (store.project.tracks.length ? store.commit('lock', (p) => { pick(p.tracks).locked = r() < 0.3; }) : { ok: true, skipped: true }),
    marker: () => store.commit('marker', (p) => addMarker(p, time())),
  };
  // operazioni con limiti calcolati: non devono mai produrre uno stato rifiutato dalla validazione
  const mustSucceed = new Set(['move', 'trim']);

  for (let i = 0; i < steps; i++) {
    const name = pick(Object.keys(ops));
    const before = store.project;
    let res;
    try {
      res = ops[name]();
    } catch (e) {
      assert.fail(`seed ${seed} passo ${i} (${name}): eccezione non gestita ${e?.stack ?? e}`);
    }
    stats[name] = (stats[name] ?? 0) + 1;
    if (res.ok === false) {
      assert.equal(store.project, before, `seed ${seed} passo ${i} (${name}): operazione rifiutata ma stato cambiato`);
      assert.ok(!/Stato non valido/.test(res.error), `seed ${seed} passo ${i} (${name}): produce stato non valido → ${res.error}`);
      if (mustSucceed.has(name) && !/bloccata/.test(res.error)) {
        const tr = before.tracks.find((t) => t.clips.some((c) => c.id === last?.id));
        const dump = tr?.clips.map((c) => `${c.id.slice(-4)}[${c.start.toFixed(4)}..${clipEnd(c).toFixed(4)} in=${c.in.toFixed(3)} sp=${c.speed} tr=${c.transition ? c.transition.duration.toFixed(3) : '-'}]`).join(' ');
        assert.fail(`seed ${seed} passo ${i} (${name}) doveva riuscire: ${res.error}\n  op=${JSON.stringify(last)}\n  traccia: ${dump}`);
      }
    } else if (!res.skipped) committed++;
    const errs = validateProject(store.project);
    assert.deepEqual(errs, [], `seed ${seed} passo ${i} (${name})`);
    if (!undoChecked && committed >= 95) {
      undoChecked = true;
      checkUndoRedo();
    }
    for (const c of clipsOf()) assert.ok(clipEnd(c) < 1e5, 'durata assurda');
  }

  return { committed, stats, undoChecked };
}

const SEEDS = Number(process.env.FUZZ_SEEDS ?? 60);
const STEPS = Number(process.env.FUZZ_STEPS ?? 200);
test(`fuzz: ${SEEDS} sequenze × ${STEPS} operazioni mantengono il progetto valido`, () => {
  let total = 0;
  let undoChecks = 0;
  const agg = {};
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { committed, stats, undoChecked } = runFuzz(seed, STEPS);
    total += committed;
    if (undoChecked) undoChecks++;
    for (const [k, v] of Object.entries(stats)) agg[k] = (agg[k] ?? 0) + v;
  }
  assert.ok(total > SEEDS * STEPS * 0.5, `poche operazioni riuscite (${total}): il fuzzer non esercita abbastanza il codice`);
  console.log(`  fuzz: ${total} commit riusciti su ${SEEDS * STEPS} tentativi, verifica undo/redo completa in ${undoChecks} sequenze`);
  assert.ok(undoChecks >= SEEDS * 0.5, 'la verifica undo/redo deve girare nella maggior parte delle sequenze');
});

test('Store: una modifica che lancia non lascia tracce, il gesto produce una sola voce', () => {
  const store = new Store(baseProject());
  const r1 = store.commit('x', () => {
    throw new EditError('no');
  });
  assert.equal(r1.ok, false);
  assert.equal(store.canUndo, false);
  assert.throws(() => store.commit('x', () => { throw new TypeError('bug vero'); }), TypeError);

  store.commit('add', (p) => addMediaClip(p, p.media.v2, { start: 0 }));
  const id = allClips(store.project)[0].id;
  store.beginGesture('trascina');
  for (let i = 1; i <= 20; i++) store.previewGesture((p) => moveClips(p, [id], i * 0.1, 0));
  assert.equal(store.previewGesture((p) => moveClips(p, [id], -50, 0)).ok, false); // non valida: ignorata
  assert.ok(Math.abs(allClips(store.project)[0].start - 2) < 1e-9);               // ultimo stato buono
  store.commitGesture();
  assert.ok(Math.abs(allClips(store.project)[0].start - 2) < 1e-9);
  store.undo();
  assert.equal(allClips(store.project)[0].start, 0);       // una sola undo annulla l'intero gesto
  store.undo();
  assert.equal(allClips(store.project).length, 0);
  store.redo(); store.redo();
  assert.ok(Math.abs(allClips(store.project)[0].start - 2) < 1e-9);

  store.beginGesture('annulla');
  store.previewGesture((p) => moveClips(p, [id], 1, 0));
  store.cancelGesture();
  assert.ok(Math.abs(allClips(store.project)[0].start - 2) < 1e-9);
  assert.equal(store.canRedo, false);
});

test('Store: coalesce unisce modifiche ravvicinate con la stessa chiave', () => {
  const store = new Store(baseProject());
  store.commit('add', (p) => addMediaClip(p, p.media.v2, { start: 0 }));
  const id = allClips(store.project)[0].id;
  for (let i = 1; i <= 4; i++) store.commit('vol', (p) => { allClips(p).find((c) => c.id === id).volume = i / 5; }, { coalesce: 'vol' });
  assert.equal(allClips(store.project)[0].volume, 0.8);
  store.undo();                                              // una sola undo annulla l'intera serie
  assert.equal(allClips(store.project)[0].volume, 1);
  store.undo();
  assert.equal(allClips(store.project).length, 0);
});
