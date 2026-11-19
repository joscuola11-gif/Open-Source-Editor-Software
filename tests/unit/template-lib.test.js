import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtinTemplates, TEMPLATE_CATEGORIES } from '../../src/core/template-lib.js';
import { applyTemplate, sanitizeTemplate, serializeTemplate } from '../../src/core/templates.js';
import { allClips, projectDuration } from '../../src/core/project.js';
import { validateProject } from '../../src/core/timeline.js';
import { ANIMATIONS } from '../../src/core/animations.js';
import { FILTERS } from '../../src/core/presets.js';

const rec = (id, kind, duration, w = 1280, h = 720) => ({ id, name: `${id}.${kind}`, kind, mime: `${kind}/x`, size: 10, duration, width: w, height: h });
const fillAll = (t, kind = 'image', dur = 5) => ({ media: Object.fromEntries(t.slots.map((s) => [s.id, rec(`n_${s.id}`, s.kind === 'audio' ? 'audio' : kind, s.kind === 'audio' ? 40 : dur)])) });

test('modelli pronti: ci sono, hanno nomi e id unici, categorie note e descrizione', () => {
  const ts = builtinTemplates();
  assert.ok(ts.length >= 10);
  assert.equal(new Set(ts.map((t) => t.id)).size, ts.length);
  assert.equal(new Set(ts.map((t) => t.name)).size, ts.length);
  for (const t of ts) {
    assert.ok(TEMPLATE_CATEGORIES.includes(t.category), `${t.id}: categoria ${t.category}`);
    assert.ok(t.description.length > 20, `${t.id}: descrizione`);
    assert.equal(t.builtin, true);
    assert.ok(t.duration >= 5 && t.duration <= 30, `${t.id}: durata ${t.duration}`);
  }
  assert.ok(TEMPLATE_CATEGORIES.every((c) => ts.some((t) => t.category === c)));
  assert.ok(ts.some((t) => t.aspect.height > t.aspect.width), 'ci sono modelli verticali');
  assert.ok(ts.some((t) => t.aspect.width > t.aspect.height), 'ci sono modelli orizzontali');
  assert.ok(ts.some((t) => t.aspect.width === t.aspect.height), 'ci sono modelli quadrati');
});

test('modelli pronti: nessun file dentro, segnaposto e testi coerenti, solo transizioni/filtri/effetti che esistono', () => {
  for (const t of builtinTemplates()) {
    const clips = allClips(t.project);
    assert.deepEqual(t.project.media, {}, t.id);
    assert.ok(clips.every((c) => c.mediaId === null), `${t.id}: nessun mediaId`);
    assert.ok(t.slots.length >= 1 || t.texts.length >= 1, `${t.id}: qualcosa da riempire`);
    for (const c of clips) {
      if (c.transition) assert.ok(ANIMATIONS[c.transition.type], `${t.id}: transizione ${c.transition.type}`);
      if (c.anim?.in) assert.ok(ANIMATIONS[c.anim.in.type], `${t.id}: animazione ${c.anim.in.type}`);
      if (c.anim?.out) assert.ok(ANIMATIONS[c.anim.out.type], `${t.id}: animazione ${c.anim.out.type}`);
      if (c.filter?.id && c.filter.id !== 'none') assert.ok(FILTERS.some((f) => f.id === c.filter.id), `${t.id}: filtro`);
    }
    // ogni clip di testo ha un contenuto
    assert.ok(t.texts.every((x) => x.content.trim()), `${t.id}: testi pieni`);
    // tutto rientra nella durata dichiarata e niente nasce oltre la fine delle clip principali visive
    assert.equal(Math.round(t.duration * 1000), Math.round(projectDuration(t.project) * 1000));
  }
});

test('modelli pronti: riempiti con foto, video e musica danno progetti validi della stessa durata', () => {
  for (const t of builtinTemplates()) {
    for (const kind of ['image', 'video']) {
      const out = applyTemplate(t, fillAll(t, kind, kind === 'image' ? 0 : 60));
      assert.deepEqual(validateProject(out), [], `${t.id}/${kind}`);
      assert.equal(out.settings.width, t.aspect.width);
      assert.ok(Math.abs(projectDuration(out) - t.duration) < 1e-6, `${t.id}/${kind}: durata ${projectDuration(out)} vs ${t.duration}`);
      assert.equal(Object.keys(out.media).length, t.slots.length);
    }
  }
});

test('modelli pronti: con clip più corti, con segnaposto saltati e a caso restano sempre validi', () => {
  let seed = 99;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  for (const t of builtinTemplates()) {
    for (let k = 0; k < 60; k++) {
      const media = {};
      for (const s of t.slots) {
        if (rnd() < 0.25) continue;
        media[s.id] = rec(`r${k}${s.id}`, s.kind === 'audio' ? 'audio' : rnd() < 0.5 ? 'video' : 'image', 0.3 + rnd() * 12, 300 + Math.floor(rnd() * 2500), 300 + Math.floor(rnd() * 2500));
      }
      const out = applyTemplate(t, { media });
      assert.deepEqual(validateProject(out), [], `${t.id} #${k}`);
    }
  }
});

test('modelli pronti: sopravvivono al salvataggio su file e rilettura', () => {
  for (const t of builtinTemplates()) {
    const back = sanitizeTemplate(JSON.parse(serializeTemplate(t)));
    assert.equal(back.slots.length, t.slots.length, t.id);
    assert.equal(back.texts.length, t.texts.length);
    assert.deepEqual(validateProject(applyTemplate(back, fillAll(back))), [], t.id);
  }
});

test('modelli pronti: i testi con le animazioni e i cicli sono validi dopo l’uso', () => {
  const t = builtinTemplates().find((x) => x.id === 'base-lancio-prodotto');
  const out = applyTemplate(t, fillAll(t));
  const pill = allClips(out).find((c) => c.kind === 'text' && c.text.content === 'NOVITÀ');
  assert.ok(pill.anim.in && pill.anim.loop, 'animazione di ingresso e ciclo conservati');
  const star = allClips(out).find((c) => c.kind === 'shape' && c.shape.type === 'star');
  assert.ok(star && star.anim.in.type === 'pop');
});
