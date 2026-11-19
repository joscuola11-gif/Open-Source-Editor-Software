import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARTICLE_IDS, PARTICLE_TYPES, particleField } from '../../src/core/particles.js';

const KINDS = new Set(['circle', 'line', 'rect', 'star', 'heart', 'grad']);
const num = (v) => typeof v === 'number' && Number.isFinite(v);

test('particelle: ogni tipo dà forme valide, in numero crescente con l’intensità, vuote a intensità 0', () => {
  for (const id of PARTICLE_IDS) {
    assert.deepEqual(particleField(id, 1, { amount: 0 }), [], `${id}: 0 = niente`);
    const few = particleField(id, 1.3, { amount: 10 });
    const many = particleField(id, 1.3, { amount: 100 });
    assert.ok(few.length >= 1 && many.length >= few.length, `${id}: ${few.length} → ${many.length}`);
    assert.ok(many.length <= PARTICLE_TYPES[id].max);
    for (const p of many) {
      assert.ok(KINDS.has(p.k), `${id}: forma ${p.k}`);
      assert.ok(p.a >= 0 && p.a <= 1.0001, `${id}: alfa ${p.a}`);
      for (const [key, v] of Object.entries(p)) if (typeof v === 'number') assert.ok(num(v), `${id}.${key} finito`);
    }
  }
  assert.deepEqual(particleField('inesistente', 1), []);
});

test('particelle: stesso tempo e stesso seme = stessa immagine; un altro seme cambia; scorre col tempo', () => {
  for (const id of PARTICLE_IDS) {
    const a = particleField(id, 2.5, { amount: 60, seed: 7 });
    assert.deepEqual(particleField(id, 2.5, { amount: 60, seed: 7 }), a, `${id}: ripetibile`);
    assert.notDeepEqual(particleField(id, 2.5, { amount: 60, seed: 8 }), a, `${id}: il seme conta`);
    assert.notDeepEqual(particleField(id, 3.2, { amount: 60, seed: 7 }), a, `${id}: cambia nel tempo`);
  }
});

test('particelle: la neve cade (y cresce nel tempo, tornando in cima), i cuori salgono, la pioggia è inclinata', () => {
  const at = (id, t) => particleField(id, t, { amount: 40, seed: 3 });
  const snow0 = at('snow', 0);
  const snow1 = at('snow', 0.5);
  let down = 0;
  snow0.forEach((p, i) => { const d = snow1[i].y - p.y; if (d > 0 || d < -0.5) down++; });
  assert.ok(down >= snow0.length * 0.95, 'la neve va giù (o ricomincia dall’alto)');
  const h0 = at('hearts', 0);
  const h1 = at('hearts', 0.5);
  let up = 0;
  h0.forEach((p, i) => { const d = h1[i].y - p.y; if (d < 0 || d > 0.5) up++; });
  assert.ok(up >= h0.length * 0.95, 'i cuori salgono');
  for (const l of at('rain', 1)) assert.ok(l.y2 > l.y1 && l.x2 < l.x1, 'goccia inclinata verso il basso a sinistra');
});

test('particelle: tutto resta nel riquadro (con un piccolo margine) per tempi e semi qualsiasi', () => {
  let s = 5;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let k = 0; k < 400; k++) {
    const id = PARTICLE_IDS[Math.floor(rnd() * PARTICLE_IDS.length)];
    if (id === 'leak') continue; // i gradienti possono uscire: sono sfumature a tutto riquadro
    const ps = particleField(id, rnd() * 600, { amount: rnd() * 100, seed: Math.floor(rnd() * 1e6) });
    for (const p of ps) {
      const x = p.x ?? p.x1;
      const y = p.y ?? p.y1;
      assert.ok(x >= -0.1 && x <= 1.1 && y >= -0.1 && y <= 1.1, `${id}: (${x}, ${y})`);
    }
  }
});

test('perdita di luce: sfumature con alfa tra 0 e 0.5 che si muovono lentamente', () => {
  const a = particleField('leak', 0, { amount: 100 });
  const b = particleField('leak', 10, { amount: 100 });
  assert.ok(a.length >= 1 && a.every((g) => g.k === 'grad' && g.a >= 0 && g.a <= 0.5 && g.stops.length === 2));
  assert.notDeepEqual(a[0].x0, b[0].x0);
});
