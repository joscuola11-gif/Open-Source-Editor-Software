// Le licenze del software di terzi: il file con i testi è aggiornato, completo, e viaggia nel pacchetto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED, OUT, PACKAGES, build } from '../../tools/collect-licenses.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('licenze: il file LICENZE-TERZE.txt è aggiornato (node tools/collect-licenses.mjs --write) e nomina ogni libreria', () => {
  const file = readFileSync(OUT, 'utf8');
  assert.equal(file, build());
  for (const p of PACKAGES) assert.ok(file.includes(`===== ${p.name} `), p.name);
  for (const b of BUNDLED) assert.ok(file.includes(b.name), b.name);
  assert.match(file, /Apache License/, 'c\'è il testo completo della licenza Apache');
  assert.match(file, /GNU LESSER GENERAL PUBLIC LICENSE/i, 'c\'è il testo della LGPL (codificatore MP3)');
  assert.match(file, /lame\.sourceforge\.net/, 'LAME è riconosciuto con il suo sito, come chiede il progetto');
  assert.match(file, /Permission is hereby granted, free of charge/, 'c\'è il testo MIT');
});

test('licenze: ogni libreria di produzione o incorporata è elencata e il file viaggia nel pacchetto', () => {
  const listed = new Set(PACKAGES.map((p) => p.name));
  for (const dep of Object.keys(pkg.dependencies)) assert.ok(listed.has(dep), `${dep} è una dipendenza ma non è nell'elenco delle licenze`);
  for (const dev of ['@breezystack/lamejs', 'gifenc', '@mediapipe/selfie_segmentation']) assert.ok(listed.has(dev), dev);
  for (const plat of ['win', 'linux', 'mac']) {
    assert.ok(pkg.build[plat].extraResources.some((r) => r.from === 'docs/LICENZE-TERZE.txt' && r.to === 'LICENZE-TERZE.txt'), `${plat}: LICENZE-TERZE.txt nel pacchetto`);
  }
  assert.match(readFileSync(path.join(ROOT, 'README.md'), 'utf8'), /LICENZE-TERZE\.txt/);
});
