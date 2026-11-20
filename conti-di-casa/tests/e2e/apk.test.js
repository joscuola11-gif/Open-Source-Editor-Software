// Controlli sull'APK costruito (si saltano se l'APK non c'è: `npm run dist:apk`). Non sostituiscono la prova su un telefono vero.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chromium, demoState, openApp, startServer } from './helpers.js';

const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const APK = new URL(`../../release/ContiDiCasa-${version}-Android.apk`, import.meta.url).pathname;
const has = existsSync(APK);
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

let server;
let base;
let browser;
before(async () => {
  ({ server, base } = await startServer());
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
  server.close();
});

test('APK: pacchetto, versioni e NESSUN permesso (non può usare internet)', { skip: !has }, () => {
  const badging = run('aapt2', ['dump', 'badging', APK]);
  assert.match(badging, /package: name='app\.contidicasa' versionCode='\d+' versionName='[\d.]+'/);
  assert.match(badging, /sdkVersion:'24'/);
  assert.match(badging, /application-label:'Conti di Casa'/);
  assert.match(badging, /launchable-activity: name='app\.contidicasa\.MainActivity'/);
  assert.doesNotMatch(badging, /uses-permission/);
  const perms = run('aapt2', ['dump', 'permissions', APK]);
  assert.doesNotMatch(perms, /INTERNET|CAMERA|RECORD_AUDIO|LOCATION|CONTACTS|STORAGE/);
  const xml = run('aapt2', ['dump', 'xmltree', '--file', 'AndroidManifest.xml', APK]);
  assert.match(xml, /allowBackup.*false/);
  assert.doesNotMatch(xml, /usesCleartextTraffic.*true/);
});

test('APK: firmato e allineato', { skip: !has }, () => {
  const out = run('apksigner', ['verify', '--verbose', APK]);
  assert.match(out, /Verified using v2 scheme \(APK Signature Scheme v2\): true/);
  assert.doesNotThrow(() => run('zipalign', ['-c', '-p', '4', APK]));
});

test('APK: contiene il programma, il ponte Java e ogni file che la pagina chiede', { skip: !has }, async () => {
  const names = new Set(run('unzip', ['-Z1', APK]).split('\n').filter(Boolean));
  assert.ok(names.has('classes.dex'));
  assert.ok(!names.has('assets/web/sw.js'), 'il service worker non serve nell’app');
  const dex = execFileSync('unzip', ['-p', APK, 'classes.dex']);
  for (const cls of ['Lapp/contidicasa/MainActivity;', 'Lapp/contidicasa/Util;', 'ContiNativo', 'appassets.androidplatform.net']) assert.ok(dex.includes(cls), `nel DEX manca ${cls}`);
  // ogni richiesta della pagina deve trovare il suo file nell'APK, con la stessa regola di Util.assetPath
  const app = await openApp(browser, base, { seed: demoState() });
  const seen = new Set();
  app.page.on('request', (r) => { const u = new URL(r.url()); if (u.origin === new URL(base).origin) seen.add(u.pathname); });
  await app.page.reload(); // (un cambio di sola «#» non rifarebbe le richieste)
  await app.page.waitForSelector('.home');
  await app.context.close();
  assert.ok(seen.size >= 3, `la pagina chiede troppo pochi file: ${[...seen]}`);
  for (const p of seen) {
    const path = p === '/' ? '/index.html' : p;
    assert.ok(names.has(`assets/web${path}`), `nell'APK manca ${path}`);
  }
  // i file nominati dentro index.html
  const html = execFileSync('unzip', ['-p', APK, 'assets/web/index.html'], { encoding: 'utf8' });
  for (const m of html.matchAll(/(?:href|src)="([^"#]+)"/g)) assert.ok(names.has(`assets/web/${m[1]}`), `index.html nomina ${m[1]} che nell'APK non c'è`);
  // e i file dichiarati nel manifest della pagina
  const manifest = JSON.parse(execFileSync('unzip', ['-p', APK, 'assets/web/manifest.webmanifest'], { encoding: 'utf8' }));
  for (const i of manifest.icons) assert.ok(names.has(`assets/web/${i.src}`), `manca l'icona ${i.src}`);
});
