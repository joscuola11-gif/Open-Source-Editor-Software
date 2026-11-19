// Build: un unico file HTML autosufficiente (JS e CSS inclusi, minificati) → dist/ciak-studio.html
// Si apre con doppio clic, anche senza server né connessione.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const js = await build({ entryPoints: [path.join(ROOT, 'src/main.js')], bundle: true, minify: true, format: 'esm', target: 'es2022', write: false, legalComments: 'none' });
const css = await build({ entryPoints: [path.join(ROOT, 'src/styles.css')], bundle: true, minify: true, write: false });

let html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
const script = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const style = css.outputFiles[0].text;
if (!html.includes('<link rel="stylesheet" href="src/styles.css" />')) throw new Error('index.html: link CSS non trovato');
if (!html.includes('<script type="module" src="src/main.js"></script>')) throw new Error('index.html: script non trovato');
html = html.replace('<link rel="stylesheet" href="src/styles.css" />', () => `<style>${style}</style>`).replace('<script type="module" src="src/main.js"></script>', () => `<script type="module">${script}</script>`);

await mkdir(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', 'ciak-studio.html');
await writeFile(out, html);
console.log(`dist/ciak-studio.html · ${(html.length / 1024).toFixed(0)} KB (JS ${(script.length / 1024).toFixed(0)} KB, CSS ${(style.length / 1024).toFixed(0)} KB)`);
