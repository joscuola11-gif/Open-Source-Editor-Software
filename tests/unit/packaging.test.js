// Il pacchetto del programma per computer deve contenere ogni file che il codice carica: un file dimenticato
// (come tts.cjs nella 1.0.3) fa chiudere il programma appena si apre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** Un file è incluso se un elemento di build.files lo nomina o lo copre con * (come fa electron-builder). */
function included(rel, patterns) {
  return patterns.some((p) => {
    if (p.startsWith('!')) return false;
    if (p === rel) return true;
    const re = new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '§§').replace(/\*/g, '[^/]*').replace(/§§/g, '.*')}$`);
    return re.test(rel);
  });
}

test('pacchetto: ogni file locale caricato dal codice del programma per computer è incluso in build.files', () => {
  const dir = path.join(ROOT, 'desktop');
  const sources = readdirSync(dir).filter((f) => f.endsWith('.cjs'));
  assert.ok(sources.includes('main.cjs') && sources.includes('preload.cjs'));
  const patterns = pkg.build.files;
  const needed = new Set(sources.map((f) => `desktop/${f}`)); // i file stessi
  for (const f of sources) {
    const code = readFileSync(path.join(dir, f), 'utf8');
    for (const m of code.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const rel = path.posix.normalize(path.posix.join('desktop', m[1]));
      assert.ok(existsSync(path.join(ROOT, rel)), `${f} carica ${m[1]} ma il file non esiste`);
      needed.add(rel);
    }
  }
  for (const rel of needed) assert.ok(included(rel, patterns), `«${rel}» non è in build.files: il programma impacchettato non partirebbe`);
  assert.ok(included('dist/ciak-studio.html', patterns), 'la pagina costruita deve essere inclusa');
  assert.ok(included('package.json', patterns));
});

test('pacchetto: l’icona e i dati dichiarati esistono e il nome/versione sono coerenti', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.ok(existsSync(path.join(ROOT, 'desktop/build/icon.png')));
  assert.equal(pkg.main, 'desktop/main.cjs');
});

test('pacchetto: la funzione di confronto riconosce davvero un file mancante', () => {
  assert.equal(included('desktop/tts.cjs', ['desktop/main.cjs', 'desktop/preload.cjs']), false, 'come nella 1.0.3');
  assert.equal(included('desktop/tts.cjs', ['desktop/*.cjs']), true);
  assert.equal(included('desktop/sub/a.cjs', ['desktop/*.cjs']), false, '* non entra nelle cartelle');
  assert.equal(included('desktop/sub/a.cjs', ['desktop/**']), true);
});

// ---- riconoscimento vocale nel pacchetto ----------------------------------------------------------------------
const glob = (p) => new RegExp(`^${p.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\{([^}]+)\}/g, (_, a) => `(${a.split(',').join('|')})`).replace(/\*\*/g, '§§').replace(/\*/g, '[^/]*').replace(/§§/g, '.*')}$`);
/** Come electron-builder: ogni elemento in ordine, «!» toglie quello che ha già incluso. */
function kept(rel, patterns) {
  let on = false;
  for (const p of patterns) {
    if (p.startsWith('!')) {
      if (glob(p.slice(1)).test(rel)) on = false;
    } else if (glob(p).test(rel)) on = true;
  }
  return on;
}

test('pacchetto Windows: ci sono i file del motore Whisper per Windows x64 e non quelli inutili', () => {
  assert.ok(pkg.dependencies['@huggingface/transformers'], 'il motore deve essere una dipendenza di produzione');
  assert.ok(pkg.build.asarUnpack.some((p) => /onnxruntime-node/.test(p)), 'onnxruntime-node deve stare fuori da app.asar (librerie native)');
  assert.equal(pkg.build.npmRebuild, false);
  const win = [...pkg.build.win.files.filter((p) => !p.startsWith('!')), 'node_modules/**', ...pkg.build.win.files.filter((p) => p.startsWith('!'))];
  for (const f of ['onnxruntime.dll', 'onnxruntime_binding.node']) assert.equal(kept(`node_modules/onnxruntime-node/bin/napi-v6/win32/x64/${f}`, win), true, `${f} deve esserci`);
  assert.equal(kept('node_modules/onnxruntime-node/dist/index.js', win), true);
  for (const f of ['DirectML.dll', 'dxcompiler.dll', 'dxil.dll']) assert.equal(kept(`node_modules/onnxruntime-node/bin/napi-v6/win32/x64/${f}`, win), false, `${f} non serve (solo processore)`);
  for (const f of ['linux/x64/libonnxruntime.so.1', 'darwin/arm64/onnxruntime_binding.node', 'win32/arm64/onnxruntime.dll']) assert.equal(kept(`node_modules/onnxruntime-node/bin/napi-v6/${f}`, win), false, `${f} non va nel pacchetto Windows x64`);
  for (const f of ['node_modules/onnxruntime-web/dist/ort.min.js', 'node_modules/sharp/lib/index.js', 'node_modules/@img/sharp-linux-x64/lib/sharp.node']) assert.equal(kept(f, win), false, `${f} non serve`);
  assert.equal(kept('node_modules/@huggingface/transformers/dist/transformers.node.cjs', win), true);
  assert.equal(kept('node_modules/@huggingface/jinja/dist/index.js', win), true);
  // le librerie già incluse nella pagina non vanno duplicate nel pacchetto
  assert.equal(pkg.dependencies['@breezystack/lamejs'], undefined);
  assert.equal(pkg.dependencies.gifenc, undefined);
});

test('pacchetto: i file per piattaforma ripetono quelli comuni (altrimenti electron-builder impacchetta l’intero progetto)', () => {
  for (const plat of ['win', 'linux', 'mac']) {
    const files = pkg.build[plat].files;
    for (const p of pkg.build.files) assert.ok(files.includes(p), `${plat}.files deve includere «${p}»`);
    assert.equal(kept('squillo/dist/index.html', [...files, 'node_modules/**']), false, 'squillo non va nel pacchetto');
    assert.equal(kept('tests/fixtures/jfk.wav', files), false);
    assert.equal(kept('dist/ciak-studio.html', files), true);
  }
});

test('pacchetto: i file di MediaPipe vanno in resources/mediapipe e il protocollo interno è dichiarato', () => {
  for (const plat of ['win', 'linux', 'mac']) {
    const r = pkg.build[plat].extraResources.find((x) => x.to === 'mediapipe');
    assert.ok(r, `${plat}: extraResources mediapipe`);
    assert.equal(r.from, 'node_modules/@mediapipe/selfie_segmentation');
    for (const f of ['selfie_segmentation.js', 'selfie_segmentation.tflite', 'selfie_segmentation.binarypb']) assert.ok(r.filter.includes(f), `${plat}: ${f}`);
    assert.ok(r.filter.some((x) => /simd_wasm_bin/.test(x)) && r.filter.some((x) => /^selfie_segmentation_solution_wasm_bin/.test(x)), 'wasm normale e SIMD');
  }
  assert.ok(existsSync(path.join(ROOT, 'node_modules/@mediapipe/selfie_segmentation/selfie_segmentation.tflite')));
  const main = readFileSync(path.join(ROOT, 'desktop/main.cjs'), 'utf8');
  assert.match(main, /registerSchemesAsPrivileged\(\[\{ scheme: 'ciak-asset'/);
  assert.match(readFileSync(path.join(ROOT, 'desktop/preload.cjs'), 'utf8'), /mediapipeBase: 'ciak-asset:\/\/mediapipe\//);
  assert.match(readFileSync(path.join(ROOT, 'index.html'), 'utf8'), /script-src[^;]*ciak-asset:/);
});
