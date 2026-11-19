// Costruisce dist/: pagina, programma (un unico script classico: funziona anche aprendo il file dal disco),
// stili, manifest e service worker per l'installazione sul telefono.
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

const js = await build({ entryPoints: [path.join(ROOT, 'src/main.js')], bundle: true, minify: true, format: 'iife', target: 'es2022', write: false, legalComments: 'none', define: { 'process.env.NODE_ENV': '"production"' } });
const css = await build({ entryPoints: [path.join(ROOT, 'src/styles.css')], bundle: true, minify: true, write: false });
await writeFile(path.join(DIST, 'app.js'), js.outputFiles[0].text);
await writeFile(path.join(DIST, 'app.css'), css.outputFiles[0].text);

for (const f of ['index.html', 'manifest.webmanifest']) await cp(path.join(ROOT, f), path.join(DIST, f));
await writeFile(path.join(DIST, 'sw.js'), (await readFile(path.join(ROOT, 'sw.js'), 'utf8')).replace('__VERSION__', `${pkg.version}-${Date.now().toString(36)}`));
await cp(path.join(ROOT, 'icons'), path.join(DIST, 'icons'), { recursive: true });

console.log(`dist/ · app.js ${(js.outputFiles[0].text.length / 1024).toFixed(0)} KB · app.css ${(css.outputFiles[0].text.length / 1024).toFixed(0)} KB`);
