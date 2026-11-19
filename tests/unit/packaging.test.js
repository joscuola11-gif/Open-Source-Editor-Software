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
