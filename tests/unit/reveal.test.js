import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revealShapes, revealCovers, REVEAL_SHAPES } from '../../src/core/reveal.js';
import { ANIMATIONS, TRANSITION_IDS, TRANSITION_GROUP_ORDER, transitionGroups, clipAnimationState, animationState, neutralState } from '../../src/core/animations.js';

const SPECS = [
  { shape: 'rect', dir: 'left' }, { shape: 'rect', dir: 'right' }, { shape: 'rect', dir: 'top' }, { shape: 'rect', dir: 'bottom' },
  { shape: 'rect', dir: 'center-x' }, { shape: 'rect', dir: 'center-y' },
  { shape: 'circle', dir: 'center' }, { shape: 'diamond' }, { shape: 'star' }, { shape: 'heart' }, { shape: 'rounded' }, { shape: 'clock' },
  { shape: 'blinds', dir: 'h', n: 8 }, { shape: 'blinds', dir: 'v', n: 10 }, { shape: 'cells', mode: 'checker', n: 8 }, { shape: 'cells', mode: 'random', n: 12 },
];
const SIZES = [[1600, 900], [1000, 1000], [900, 1600], [2100, 900]];

/** Frazione di punti di una griglia del riquadro coperta dalla rivelazione. */
function coverage(spec, p, w, h) {
  const shapes = revealShapes({ ...spec, p }, w, h);
  let hit = 0;
  let n = 0;
  for (let j = 0; j < 36; j++) {
    for (let i = 0; i < 48; i++) {
      const x = -w / 2 + ((i + 0.5) / 48) * w;
      const y = -h / 2 + ((j + 0.5) / 36) * h;
      n++;
      if (revealCovers(shapes, x, y)) hit++;
    }
  }
  return hit / n;
}

test('rivelazioni: a p=0 non si vede nulla e a p=1 il riquadro è tutto coperto (ogni forma, ogni proporzione)', () => {
  for (const spec of SPECS) {
    for (const [w, h] of SIZES) {
      assert.equal(coverage(spec, 0, w, h), 0, `${spec.shape}/${spec.dir ?? spec.mode} p=0 ${w}x${h}`);
      const full = coverage(spec, 1, w, h);
      assert.ok(full >= 0.999, `${spec.shape}/${spec.dir ?? spec.mode} p=1 copre ${(full * 100).toFixed(2)}% di ${w}x${h}`);
    }
  }
});

test('rivelazioni: la parte scoperta cresce sempre con p (mai a scatti all’indietro)', () => {
  for (const spec of SPECS) {
    for (const [w, h] of [[1600, 900], [900, 1600]]) {
      let prev = 0;
      for (let k = 1; k <= 20; k++) {
        const c = coverage(spec, k / 20, w, h);
        assert.ok(c >= prev - 0.012, `${spec.shape}/${spec.dir ?? spec.mode} non decresce: p=${k / 20} ${c.toFixed(3)} < ${prev.toFixed(3)}`);
        prev = c;
      }
      const mid = coverage(spec, 0.5, w, h);
      assert.ok(mid > 0.03 && mid < 0.985, `${spec.shape}/${spec.dir ?? spec.mode} a metà è parziale (${mid.toFixed(3)})`);
    }
  }
});

test('rivelazioni: geometria esatta di tendine e veneziane', () => {
  assert.deepEqual(revealShapes({ shape: 'rect', dir: 'left', p: 0.25 }, 400, 200), [{ k: 'rect', x: -200, y: -100, w: 100, h: 200 }]);
  assert.deepEqual(revealShapes({ shape: 'rect', dir: 'bottom', p: 0.5 }, 400, 200), [{ k: 'rect', x: -200, y: 0, w: 400, h: 100 }]);
  assert.deepEqual(revealShapes({ shape: 'rect', dir: 'center-x', p: 0.5 }, 400, 200), [{ k: 'rect', x: -100, y: -100, w: 200, h: 200 }]);
  const b = revealShapes({ shape: 'blinds', dir: 'h', n: 4, p: 0.5 }, 400, 200);
  assert.equal(b.length, 4);
  assert.deepEqual(b[1], { k: 'rect', x: -200, y: -50, w: 400, h: 25 });
  const c = revealShapes({ shape: 'circle', p: 0.5 }, 300, 400);
  assert.equal(c[0].r, 125);
});

test('rivelazioni: parametri fuori limite o forma sconosciuta non rompono nulla', () => {
  assert.deepEqual(revealShapes({ shape: 'circle', p: -3 }, 100, 100), []);
  assert.equal(revealShapes({ shape: 'circle', p: 9 }, 100, 100)[0].r, Math.hypot(100, 100) / 2);
  assert.equal(revealShapes({ shape: 'inventata', p: 0.5 }, 100, 50).length, 1);
  assert.deepEqual(revealShapes({ shape: 'rect', p: NaN }, 100, 100), []);
  assert.ok(revealShapes({ shape: 'blinds', n: 99999, p: 1 }, 100, 100).length <= 64);
  assert.ok(REVEAL_SHAPES.length >= 9);
});

test('transizioni: ogni tipo ha etichetta e gruppo, i gruppi sono completi e senza doppioni', () => {
  const groups = transitionGroups();
  assert.deepEqual(groups.map((g) => g.label), TRANSITION_GROUP_ORDER.filter((l) => groups.some((g) => g.label === l)));
  const all = groups.flatMap((g) => g.ids);
  assert.equal(new Set(all).size, all.length, 'nessun doppione');
  assert.deepEqual([...all].sort(), [...TRANSITION_IDS].sort(), 'tutte le transizioni sono in un gruppo');
  for (const id of TRANSITION_IDS) assert.ok(ANIMATIONS[id].label && ANIMATIONS[id].group, id);
  for (const g of ['Spinta', 'Tendine e divisione', 'Maschera', 'Grafiche', 'Zoom', 'Sfocatura', 'Scorrimento', 'Dissolvenza']) assert.ok(groups.some((x) => x.label === g), g);
  assert.ok(TRANSITION_IDS.length >= 40, `almeno 40 transizioni (${TRANSITION_IDS.length})`);
});

test('transizioni: ogni tipo parte "assente" (p=0) e finisce "presente" e neutra (p=1)', () => {
  for (const id of TRANSITION_IDS) {
    const end = animationState(id, 1);
    const neutral = neutralState();
    assert.equal(end.alpha, neutral.alpha, `${id} alpha finale`);
    assert.ok(Math.abs(end.dx) < 1e-9 && Math.abs(end.dy) < 1e-9, `${id} posizione finale`);
    assert.ok(Math.abs(end.scale - 1) < 1e-9 && end.blur < 1e-6 && !end.overlay?.alpha, `${id} scala/sfocatura finali`);
    if (end.reveal) assert.ok(end.reveal.p >= 0.9999, `${id} a p=1 è tutto scoperto`);
    // a p=0 il clip che entra non deve coprire l'altro
    const start = animationState(id, 0);
    const hidden = start.alpha < 0.01 || start.scale < 0.01 || Math.abs(start.dx) >= 0.99 || Math.abs(start.dy) >= 0.99 || (start.reveal && start.reveal.p <= 0.0001) || start.blur > 5 || start.chars === 0 || start.sy < 0.01 || start.sx < 0.01;
    assert.ok(hidden || ['spin', 'pop', 'bounce', 'glitch'].includes(id) || start.alpha < 1, `${id} all'inizio non nasconde nulla del clip uscente?`);
  }
});

test('transizioni con partner: la spinta sposta anche il clip che esce, in direzione opposta e senza buchi', () => {
  const prev = { start: 0, duration: 5, transition: null, anim: {} };
  const next = { start: 4, duration: 5, transition: { type: 'push-left', duration: 1 }, anim: {} };
  for (const q of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const t = 4 + q; // secondi assoluti
    const out = clipAnimationState(prev, t - prev.start, next);
    const inn = clipAnimationState(next, t - next.start);
    assert.ok(out.dx < 0, `esce verso sinistra (q=${q}: ${out.dx})`);
    assert.ok(inn.dx > 0, `entra da destra (q=${q}: ${inn.dx})`);
    assert.ok(Math.abs(inn.dx - out.dx - 1) < 1e-9, `i due bordi combaciano: nessun buco né sovrapposizione (q=${q})`);
  }
  // fuori dalla finestra della transizione il clip precedente resta fermo
  assert.deepEqual(clipAnimationState(prev, 3.5, next).dx, 0);
  assert.equal(clipAnimationState(prev, 4.999 + 0.0001 * 0, null).dx, 0, 'senza clip successivo nessuna spinta');
  // un tipo senza partner non muove il clip precedente
  const plain = { ...next, transition: { type: 'fade', duration: 1 } };
  assert.equal(clipAnimationState(prev, 4.5, plain).dx, 0);
  // tipo sconosciuto (vecchio progetto) ignorato
  assert.doesNotThrow(() => clipAnimationState(prev, 4.5, { ...next, transition: { type: 'boh', duration: 1 } }));
  // direzioni
  for (const [type, axis, sign] of [['push-right', 'dx', 1], ['push-up', 'dy', -1], ['push-down', 'dy', 1]]) {
    const o = clipAnimationState(prev, 4.5, { ...next, transition: { type, duration: 1 } });
    assert.ok(o[axis] * sign > 0, `${type}: il clip uscente va verso il lato giusto (${o[axis]})`);
  }
});

test('transizioni: lo zoom attraverso dissolve il clip uscente mentre ingrandisce, lo scatto sfoca entrambi a metà', () => {
  const prev = { start: 0, duration: 5, transition: null, anim: {} };
  const mk = (type) => ({ start: 4, duration: 5, transition: { type, duration: 1 }, anim: {} });
  const z = clipAnimationState(prev, 4.5, mk('zoom-through'));
  assert.ok(z.scale > 1.3 && z.alpha < 0.6, `uscente ingrandito e sfumato (${z.scale}, ${z.alpha})`);
  const w = clipAnimationState(prev, 4.5, mk('whip-left'));
  assert.ok(w.blur > 20, `scatto sfocato a metà (${w.blur})`);
  assert.equal(clipAnimationState(prev, 4.0, mk('whip-left')).blur, 0, 'all’inizio nitido');
});
