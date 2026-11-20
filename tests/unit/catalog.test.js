// Il catalogo CapCut → stato: ogni voce ha uno stato, i motivi esistono e il README è aggiornato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REASONS, catalog, readmeWithTable } from '../../tools/catalog-status.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('catalogo: 431 voci in 22 sezioni, ognuna con uno stato valido', () => {
  const { items, sections } = catalog();
  assert.equal(items.length, 431);
  assert.equal(sections.length, 22);
  assert.deepEqual(items.map((i) => i.n), Array.from({ length: 431 }, (_, i) => i + 1), 'numeri consecutivi, nessuno saltato');
  for (const s of sections) assert.equal(s.items.length, s.count, `sezione ${s.id}: il titolo dice ${s.count} voci`);
  for (const i of items) assert.ok(['ok', 'parz', 'no'].includes(i.status), `voce ${i.n} «${i.title}» senza stato`);
  for (const i of items.filter((x) => x.status !== 'ok')) assert.ok(i.note && i.note.length > 5, `voce ${i.n}: manca la nota`);
  for (const i of items.filter((x) => x.status === 'no')) assert.ok(!Object.keys(REASONS).includes(i.note), 'il codice del motivo è stato sostituito dalla frase');
});

test('catalogo: la tabella del README è aggiornata (node tools/catalog-status.mjs --write)', () => {
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.equal(readmeWithTable(readme), readme);
  assert.match(readme, /\*\*431 funzioni\*\*/);
});

test('catalogo: le funzioni dichiarate «fatte» hanno il loro codice (controllo a campione sui file)', () => {
  const must = ['src/core/captions.js', 'src/core/transcribe.js', 'src/core/synth.js', 'src/core/scenes.js', 'src/core/tracker.js', 'src/core/reframe.js', 'src/core/cutout.js', 'src/core/speedramp.js', 'src/core/autocolor.js', 'src/core/layouts.js', 'src/core/templates.js'];
  for (const f of must) assert.ok(readFileSync(path.join(ROOT, f), 'utf8').length > 500, f);
});
