import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeProject, uniqueName, makeEntry, whenLabel } from '../../src/core/projects.js';
import { createProject, createClip } from '../../src/core/project.js';
import { addClip } from '../../src/core/timeline.js';

test('summarizeProject: durata, clip e media', () => {
  const p = createProject({ width: 1080, height: 1920 });
  assert.deepEqual(summarizeProject(p), { duration: 0, clips: 0, mediaCount: 0, mediaBytes: 0, width: 1080, height: 1920 });
  p.media.m1 = { id: 'm1', name: 'a', kind: 'video', mime: 'video/webm', duration: 4, size: 1000 };
  p.media.m2 = { id: 'm2', name: 'b', kind: 'image', mime: 'image/png', duration: 0, size: 500 };
  addClip(p, p.tracks[1].id, createClip('video', { mediaId: 'm1', duration: 4 }), 2);
  const s = summarizeProject(p);
  assert.equal(s.duration, 6);
  assert.equal(s.clips, 1);
  assert.equal(s.mediaCount, 2);
  assert.equal(s.mediaBytes, 1500);
});

test('uniqueName: nomi nuovi, doppioni, numerazione e ripetizioni', () => {
  assert.equal(uniqueName('Vacanza', []), 'Vacanza');
  assert.equal(uniqueName('Vacanza', ['vacanza']), 'Vacanza (2)');
  assert.equal(uniqueName('Vacanza', ['Vacanza', 'Vacanza (2)']), 'Vacanza (3)');
  assert.equal(uniqueName('Vacanza (2)', ['Vacanza', 'Vacanza (2)']), 'Vacanza (3)');
  assert.equal(uniqueName('   ', []), 'Progetto');
  assert.equal(uniqueName(undefined, ['Progetto']), 'Progetto (2)');
  assert.equal(uniqueName('x'.repeat(300), []).length, 100);
});

test('makeEntry: copia profonda, nome applicato, riepilogo e date', () => {
  const p = createProject();
  p.media.m = { id: 'm', name: 'a', kind: 'image', mime: 'image/png', duration: 0, size: 7 };
  const e = makeEntry({ id: 'p1', name: 'Mio', project: p, thumb: 'data:x', now: 1000 });
  assert.equal(e.project.name, 'Mio');
  assert.equal(p.name, 'Nuovo progetto', 'l’originale non cambia');
  assert.equal(e.created, 1000);
  assert.equal(e.updated, 1000);
  assert.equal(e.mediaCount, 1);
  p.media.m.name = 'cambiato';
  assert.equal(e.project.media.m.name, 'a', 'copia indipendente');
  const e2 = makeEntry({ id: 'p1', name: 'Mio 2', project: p, now: 5000, created: 1000 });
  assert.equal(e2.created, 1000);
  assert.equal(e2.updated, 5000);
});

test('whenLabel: oggi, ieri, giorni fa e data', () => {
  const now = new Date(2026, 10, 19, 15, 0).getTime();
  assert.match(whenLabel(new Date(2026, 10, 19, 9, 5).getTime(), now), /^oggi alle 09[:.]05$/);
  assert.match(whenLabel(new Date(2026, 10, 18, 23, 59).getTime(), now), /^ieri alle 23[:.]59$/);
  assert.equal(whenLabel(new Date(2026, 10, 16, 8, 0).getTime(), now), '3 giorni fa');
  assert.match(whenLabel(new Date(2026, 9, 1).getTime(), now), /1 ott/);
  assert.match(whenLabel(new Date(2025, 9, 1).getTime(), now), /2025/);
});
