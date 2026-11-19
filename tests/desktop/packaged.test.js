// Collaudo del programma IMPACCHETTATO (app.asar + ffmpeg in resources/): stessa struttura del pacchetto Windows.
// Prima: `npm run build && npx electron-builder --linux dir` (e `node tools/fetch-ffmpeg.mjs linux x64`).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { makeMedia, ffprobe } from '../helpers/make-media.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXE = path.join(ROOT, 'release', 'linux-unpacked', 'ciak-studio');
const skip = !existsSync(EXE) ? 'pacchetto non costruito (npx electron-builder --linux dir)' : process.platform === 'linux' && !process.env.DISPLAY ? 'serve xvfb-run' : false;
let m;
const dirs = [];
before(() => {
  m = makeMedia();
});
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = (p) => {
  const d = mkdtempSync(path.join(os.tmpdir(), p));
  dirs.push(d);
  return d;
};

test('programma impacchettato: usa ffmpeg del pacchetto e salva un MP4 valido dalla finestra «Salva con nome»', { skip }, async () => {
  const outDir = tmp('ciak-pk-out-');
  const decoy = tmp('ciak-pk-decoy-');
  const app = await electron.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', `--user-data-dir=${tmp('ciak-pk-ud-')}`],
    // le variabili di collaudo NON devono avere effetto in un programma impacchettato
    env: { ...process.env, NODE_OPTIONS: '', CIAK_FFMPEG: '/nonexistent/ffmpeg', CIAK_TEST_SAVE_DIR: decoy },
  });
  try {
    const win = await app.firstWindow();
    const errors = [];
    win.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    win.on('pageerror', (e) => errors.push(e.message));
    await win.waitForFunction(() => window.__ciak && document.querySelector('.timeline'), null, { timeout: 30000 });
    assert.equal(await app.evaluate(({ app: a }) => a.isPackaged), true);
    assert.equal(await win.evaluate(() => window.ciakDesktop.mp4Available()), true, 'ffmpeg trovato in resources/ffmpeg');

    const target = path.join(outDir, 'video-finale.mp4');
    await app.evaluate(({ dialog }, f) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); // simula la scelta dell'utente
    }, target);

    await win.setInputFiles('#file-input', m.f('b.webm'));
    await win.waitForSelector('.media-card');
    const card = win.locator('.media-card').first();
    await card.hover();
    await card.locator('.add').click();
    await win.waitForSelector('.clip');
    await win.click('#btn-export');
    await win.waitForFunction(() => document.querySelector('#exp-format option[value="mp4-ffmpeg"]'));
    await win.selectOption('#exp-size', '480');
    await win.click('button[data-act="start"]');
    await win.waitForSelector('#exp-saved-path', { timeout: 120000 });

    assert.ok(existsSync(target), 'MP4 scritto dove l\'utente ha scelto');
    assert.equal(readdirSync(decoy).length, 0, 'CIAK_TEST_SAVE_DIR è ignorata nel programma impacchettato');
    assert.equal(readdirSync(outDir).some((f) => f.endsWith('.part')), false);
    const info = ffprobe(target);
    assert.equal(info.video.codec_name, 'h264');
    assert.equal(info.video.pix_fmt, 'yuv420p');
    assert.equal(info.video.r_frame_rate, '30/1');
    assert.equal(info.audio.codec_name, 'aac');
    assert.ok(Math.abs(info.duration - 3) < 0.7);
    assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-i', target, '-f', 'null', '-'], { encoding: 'utf8' }).stderr.trim(), '');
    // F12 (strumenti sviluppatore) non è attivo nel programma finale
    await win.keyboard.press('F12');
    await win.waitForTimeout(400);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened()), false);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});
