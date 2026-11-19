// Collaudo del programma desktop: avvia davvero Electron (in uno schermo virtuale Xvfb su Linux)
// e lo fa chiamare da una persona nel browser. La cattura dello schermo qui è VERA (desktopCapturer).
// Esegui con: npm run test:desktop   (richiede `npm run build` e xvfb)
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { launch, sleep } from '../helpers/net.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const skip = process.platform === 'linux' && !process.env.DISPLAY ? 'serve un display: usa xvfb-run (npm run test:desktop)' : false;
let env;
const dirs = [];
const apps = [];
before(async () => {
  env = await launch();
});
after(async () => {
  await env?.close();
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});
afterEach(async () => {
  await env?.closeAll();
  await Promise.all(apps.splice(0).map((a) => a.close().catch(() => {})));
});

/** Avvia Squillo desktop già collegato al centralino di prova, con il codice dato. */
async function desktop(code, name = 'Desktop') {
  const userData = mkdtempSync(path.join(os.tmpdir(), 'squillo-ud-'));
  dirs.push(userData);
  const app = await electron.launch({
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', `--user-data-dir=${userData}`, ROOT],
    env: { ...process.env, NODE_OPTIONS: '' }, // Electron rifiuta --use-openssl-ca impostato dal proxy dell'ambiente
  });
  apps.push(app);
  const win = await app.firstWindow();
  const errors = [];
  win.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
  win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await win.waitForFunction(() => window.__squillo);
  const settings = { code, name, server: { host: '127.0.0.1', port: env.centralino.port, path: '/', secure: false, key: 'peerjs' }, ice: JSON.stringify([{ urls: 'stun:127.0.0.1:3478' }]) };
  await win.evaluate((s) => localStorage.setItem('squillo:v1', JSON.stringify(s)), settings);
  await win.reload();
  await win.waitForFunction(() => window.__squillo?.line.status === 'online', null, { timeout: 30000 });
  errors.length = 0; // il primo avvio puntava al servizio pubblico (irraggiungibile da qui): non conta
  return { app, win, errors };
}

async function webPerson(code, name) {
  const p = await env.person(code, { name });
  await p.page.waitForFunction(() => window.__squillo.line.status === 'online', null, { timeout: 20000 });
  return p;
}

const inbound = (page, which = 'screen') =>
  page.evaluate(async (w) => {
    const call = window.__squillo.calls.call;
    const pc = (w === 'screen' ? call.remoteScreenMc : call.mainMc)?.peerConnection;
    const out = { frames: 0, w: 0, h: 0 };
    if (!pc) return out;
    for (const r of (await pc.getStats()).values()) if (r.type === 'inbound-rtp' && r.kind === 'video') {
      out.frames += r.framesDecoded ?? 0;
      out.w = Math.max(out.w, r.frameWidth ?? 0);
      out.h = Math.max(out.h, r.frameHeight ?? 0);
    }
    return out;
  }, which);

async function callDesktopFromWeb(web, d) {
  await web.page.fill('#dial-input', '555 555 555');
  await web.page.click('#btn-call');
  await d.win.waitForSelector('#btn-answer', { timeout: 15000 });
  await d.win.click('#btn-answer');
  for (const page of [web.page, d.win]) await page.waitForFunction(() => window.__squillo.calls.state === 'active', null, { timeout: 25000 });
}

test('desktop: finestra nativa, nessun accesso a Node, navigazione e finestre esterne bloccate', { skip }, async () => {
  const d = await desktop('555555555');
  assert.match(await d.win.title(), /Squillo/);
  assert.equal(await d.win.evaluate(() => `${typeof require}|${typeof process}|${typeof module}`), 'undefined|undefined|undefined', 'la pagina non deve vedere Node');
  assert.equal(await d.win.evaluate(() => window.squilloDesktop.isDesktop), true);
  assert.deepEqual(await d.win.evaluate(() => Object.keys(window.squilloDesktop).sort()), ['alert', 'chooseSource', 'isDesktop', 'keepAwake', 'listSources', 'platform'], 'il ponte espone solo il necessario');
  assert.match(await d.win.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'), /script-src 'self'/);
  // la navigazione verso l'esterno è bloccata
  const before = d.win.url();
  await d.win.evaluate(() => {
    location.href = 'https://example.com/';
  });
  await sleep(600);
  assert.equal(d.win.url(), before);
  assert.equal(await d.win.evaluate(() => window.open('https://example.com') === null), true);
  assert.equal(await d.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  for (let i = 0; i < 40; i++) {
    if (await d.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())) break;
    await sleep(150);
  }
  assert.equal(await d.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  assert.equal(await d.win.locator('#my-code').textContent(), '555 555 555');
  assert.deepEqual(d.errors, []);
});

test('desktop: lo schermo non si può catturare senza che l\'utente scelga dal selettore', { skip }, async () => {
  const d = await desktop('555555555');
  const result = await d.win.evaluate(async () => {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
      s.getTracks().forEach((t) => t.stop());
      return 'catturato';
    } catch (e) {
      return e.name;
    }
  });
  assert.notEqual(result, 'catturato', 'senza scelta la richiesta va rifiutata');
  assert.ok(['NotAllowedError', 'NotSupportedError', 'AbortError', 'NotReadableError'].includes(result), result);
});

test('desktop: chiamata dal browser, risposta, selettore dello schermo e condivisione vera', { skip }, async () => {
  const d = await desktop('555555555');
  const web = await webPerson('666666666', 'Web');
  await callDesktopFromWeb(web, d);
  await sleep(1500);
  const mv = await inbound(web.page, 'main');
  assert.ok(mv.frames > 5, 'la camera del desktop arriva al browser');

  await d.win.click('#c-screen');
  await d.win.click('#btn-share-go');
  await d.win.waitForSelector('dialog.picker[open] .src', { timeout: 15000 });
  const names = await d.win.locator('.picker .src').allInnerTexts();
  assert.ok(names.length >= 1, `il selettore elenca gli schermi (${names.join(' | ')})`);
  assert.ok(!names.some((n) => /^Squillo$/i.test(n.trim())), 'la finestra di Squillo non è in elenco');
  assert.ok(await d.win.locator('.picker .src img').first().getAttribute('src').then((s) => s.startsWith('data:image')), 'ogni voce ha l\'anteprima');
  await d.win.locator('.picker .src').first().click();

  await web.page.waitForSelector('#badge-screen', { timeout: 25000 });
  await web.page.waitForFunction(() => document.querySelector('.v-main').videoWidth > 0, null, { timeout: 20000 });
  await sleep(3000);
  const rx = await inbound(web.page, 'screen');
  assert.ok(rx.frames > 10, `il browser riceve lo schermo vero (${rx.frames} fotogrammi)`);
  assert.ok(rx.w >= 640 && rx.h >= 360, `dimensione ricevuta ${rx.w}×${rx.h}`);
  assert.equal(await d.win.evaluate(() => window.__squillo.calls.call.screenStream.getVideoTracks()[0].contentHint), 'detail');
  assert.equal(await d.win.evaluate(() => window.__squillo.calls.call.stats.screen?.codecOut ?? 'VP9'), 'VP9');

  await d.win.click('#btn-stop-share');
  await web.page.waitForFunction(() => !document.querySelector('#badge-screen'), null, { timeout: 10000 });
  assert.equal(await d.win.evaluate(() => window.__squillo.calls.state), 'active', 'la chiamata continua');

  // annullare il selettore non condivide nulla
  await d.win.click('#c-screen');
  await d.win.click('#btn-share-go');
  await d.win.waitForSelector('dialog.picker[open]');
  await d.win.locator('.picker button', { hasText: 'Annulla' }).click();
  await sleep(500);
  assert.equal(await d.win.evaluate(() => !!window.__squillo.calls.call.screenStream), false);
  assert.equal(await web.page.locator('#badge-screen').count(), 0);
  assert.deepEqual([...d.errors, ...web.errors], []);
});

test('desktop: una chiamata in arrivo riporta in primo piano la finestra nascosta', { skip }, async () => {
  const d = await desktop('555555555');
  await d.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  assert.equal(await d.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  const web = await webPerson('666666666', 'Web');
  await web.page.fill('#dial-input', '555 555 555');
  await web.page.click('#btn-call');
  await d.win.waitForSelector('#btn-answer', { state: 'attached', timeout: 15000 });
  for (let i = 0; i < 30 && !(await d.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())); i++) await sleep(150);
  assert.equal(await d.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true, 'la finestra è tornata visibile');
  await d.win.click('#btn-decline');
  assert.deepEqual(d.errors, []);
});
