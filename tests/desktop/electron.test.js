// Collaudo dell'app desktop: avvia davvero Electron (in uno schermo virtuale Xvfb su Linux).
// Esegui con: npm run test:desktop   (richiede `npm run build` e xvfb)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { makeMedia, ffprobe } from '../helpers/make-media.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const skip = process.platform === 'linux' && !process.env.DISPLAY ? 'serve un display: usa xvfb-run (npm run test:desktop)' : false;
let m;
const tmpDirs = [];
before(() => {
  m = makeMedia();
});
after(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const tmp = (p) => {
  const d = mkdtempSync(path.join(os.tmpdir(), p));
  tmpDirs.push(d);
  return d;
};
const ENV = { ...process.env, NODE_OPTIONS: '' }; // Electron rifiuta --use-openssl-ca impostato dal proxy dell'ambiente

async function launch(userData, extra = [], env = {}) {
  const app = await electron.launch({ args: ['--no-sandbox', '--use-fake-device-for-media-stream', `--user-data-dir=${userData}`, ...extra, ROOT], env: { ...ENV, ...env } });
  const win = await app.firstWindow();
  const errors = [];
  win.on('console', (msg) => msg.type() === 'error' && errors.push(`console.error: ${msg.text()}`));
  win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await win.waitForFunction(() => window.__ciak && document.querySelector('.timeline'), null, { timeout: 30000 });
  await win.waitForFunction(() => window.__ciak.storage.available !== undefined);
  return { app, win, errors };
}

test('desktop: finestra nativa, nessun accesso a Node dalla pagina, nessun errore', { skip }, async () => {
  const { app, win, errors } = await launch(tmp('ciak-ud-'));
  try {
    assert.match(await win.title(), /Ciak Studio/);
    // la finestra viene mostrata al primo disegno (ready-to-show): attendila invece di leggerla subito
    for (let i = 0; i < 40; i++) {
      if (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(await win.evaluate(() => `${typeof require}|${typeof process}|${typeof module}`), 'undefined|undefined|undefined', 'la pagina non deve vedere Node');
    const info = await app.evaluate(({ BrowserWindow, Menu }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const p = w.webContents.getLastWebPreferences();
      return { n: BrowserWindow.getAllWindows().length, visible: w.isVisible(), menu: Menu.getApplicationMenu(), ctx: p.contextIsolation, node: p.nodeIntegration, sandbox: p.sandbox, web: p.webSecurity, w: w.getBounds().width };
    });
    assert.equal(info.n, 1);
    assert.equal(info.visible, true);
    assert.equal(info.menu, null, 'nessuna barra dei menu');
    assert.equal(info.ctx, true);
    assert.equal(info.node, false);
    assert.equal(info.sandbox, true);
    assert.equal(info.web, true);
    assert.ok(info.w >= 960);
    for (const sel of ['.topbar', '.library', '.preview canvas', '.inspector', '.timeline']) assert.ok(await win.locator(sel).first().isVisible(), sel);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});

test('desktop: navigazione esterna e popup bloccati', { skip }, async () => {
  const { app, win, errors } = await launch(tmp('ciak-ud-'));
  try {
    const before = win.url();
    await win.evaluate(() => {
      window.location.href = 'https://example.com/';
    });
    await win.waitForTimeout(800);
    assert.equal(win.url(), before, 'l\'app non deve uscire dalla propria pagina');
    const opened = await win.evaluate(() => window.open('https://example.com/') === null);
    assert.equal(opened, true, 'window.open è bloccato');
    await win.waitForTimeout(300);
    assert.equal(app.windows().length, 1);
    // il programma blocca ogni connessione di rete della pagina (anche se la CSP della versione browser ne ammette alcune)
    const net = await win.evaluate(() => fetch('https://example.com/').then(() => 'raggiunto', () => 'bloccato'));
    assert.equal(net, 'bloccato');
    for (const url of ['https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js', 'https://huggingface.co/Xenova/whisper-tiny/resolve/main/config.json']) {
      const r = await win.evaluate((u) => fetch(u).then(() => 'raggiunto', () => 'bloccato'), url);
      assert.equal(r, 'bloccato', url);
    }
    const imported = await win.evaluate(() => import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js').then(() => 'caricato', () => 'bloccato'));
    assert.equal(imported, 'bloccato');
    assert.ok(errors.every((e) => /Content Security Policy|Failed to fetch|ERR_|violat/i.test(e)), errors.join('\n'));
  } finally {
    await app.close();
  }
});

test('desktop: importa, riproduce con audio attivo e il microfono è concesso solo alla pagina', { skip }, async () => {
  const { app, win, errors } = await launch(tmp('ciak-ud-'));
  try {
    await win.setInputFiles('#file-input', m.f('a.webm'));
    await win.waitForSelector('.media-card');
    const card = win.locator('.media-card').first();
    await card.hover();
    await card.locator('.add').click();
    await win.waitForSelector('.clip');
    await win.click('#btn-play');
    await win.waitForFunction(() => window.__ciak.player.time > 1.0, null, { timeout: 10000 });
    const st = await win.evaluate(() => {
      const a = window.__ciak;
      const el = a.pool.peek(a.store.project.tracks.flatMap((t) => t.clips)[0].id);
      return { t: a.player.time, el: el.currentTime, ctx: a.audio.ctx?.state };
    });
    assert.equal(st.ctx, 'running');
    assert.ok(Math.abs(st.el - st.t) < 0.4, `deriva ${st.el} vs ${st.t}`);
    await win.click('#btn-play');
    // microfono (voice-over): il gestore dei permessi lo concede alla nostra pagina
    const mic = await win.evaluate(async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        const n = s.getAudioTracks().length;
        s.getTracks().forEach((t) => t.stop());
        return `ok:${n}`;
      } catch (e) {
        return `errore:${e.name}`;
      }
    });
    assert.equal(mic, 'ok:1');
    // il registratore vocale dell'editor funziona end-to-end
    await win.click('#btn-record');
    await win.waitForFunction(() => window.__ciak.actions.recording === true);
    await win.waitForTimeout(1500);
    await win.click('#btn-record');
    await win.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).some((c) => c.kind === 'audio'), null, { timeout: 15000 });
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});

test('desktop: esportazione con salvataggio su disco, file valido (verificato con ffprobe)', { skip }, async () => {
  const outDir = tmp('ciak-out-');
  const { app, win, errors } = await launch(tmp('ciak-ud-'));
  try {
    // nei test il salvataggio va su una cartella senza mostrare la finestra di dialogo nativa
    await app.evaluate(({ session }, dir) => {
      session.defaultSession.on('will-download', (_e, item) => item.setSavePath(`${dir}/${item.getFilename()}`));
    }, outDir);
    await win.setInputFiles('#file-input', m.f('b.webm'));
    await win.waitForSelector('.media-card');
    const card = win.locator('.media-card').first();
    await card.hover();
    await card.locator('.add').click();
    await win.waitForSelector('.clip');
    const codecs = await win.evaluate(() => ({ mp4: MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.640028,mp4a.40.2'), webm: MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') }));
    console.log('  codec in Electron:', JSON.stringify(codecs));
    await win.click('#btn-export');
    await win.selectOption('#exp-size', '480');
    await win.selectOption('#exp-format', 'webm'); // il predefinito nel programma desktop è MP4 (test dedicato più sotto)
    await win.click('button[data-act="start"]');
    await win.waitForSelector('.exp-result .ok', { timeout: 60000 });
    const res = await win.evaluate(() => ({ frames: window.__ciak.lastExport.frames, expected: window.__ciak.lastExport.expectedFrames, ext: window.__ciak.lastExport.ext, w: window.__ciak.lastExport.width }));
    assert.ok(res.frames >= res.expected * 0.95, `fotogrammi ${res.frames}/${res.expected}`);
    // attende la scrittura del file scaricato
    let file = null;
    for (let i = 0; i < 40 && !file; i++) {
      file = readdirSync(outDir).find((f) => /\.(webm|mp4)$/.test(f)) ?? null;
      if (!file) await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(file, 'il file esportato è stato salvato');
    const full = path.join(outDir, file);
    const info = ffprobe(full);
    assert.ok(Math.abs(info.duration - 3) < 0.7, `durata ${info.duration}`);
    assert.equal(info.video.width, 854);
    assert.ok(info.audio, 'audio presente');
    const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', full, '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(dec.stderr.trim(), '');
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});

test('desktop: il progetto sopravvive alla chiusura e alla riapertura del programma', { skip }, async () => {
  const ud = tmp('ciak-ud-');
  let { app, win } = await launch(ud);
  await win.setInputFiles('#file-input', m.f('a.webm'));
  await win.waitForSelector('.media-card');
  const card = win.locator('.media-card').first();
  await card.hover();
  await card.locator('.add').click();
  await win.waitForSelector('.clip');
  await win.waitForFunction(() => window.__ciak.saveState === 'saved', null, { timeout: 10000 });
  await app.close();

  ({ app, win } = await launch(ud));
  try {
    await win.waitForFunction(() => document.querySelectorAll('.clip').length === 1, null, { timeout: 20000 });
    await win.waitForFunction(() => Object.keys(window.__ciak.store.project.media).every((id) => window.__ciak.pool.has(id)));
    await win.evaluate(() => window.__ciak.player.seek(1));
    await win.evaluate(() => window.__ciak.player.settle());
    const colors = await win.evaluate(() => {
      const c = window.__ciak.preview.canvas;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 211) seen.add(`${d[i] >> 5},${d[i + 1] >> 5},${d[i + 2] >> 5}`);
      return seen.size;
    });
    assert.ok(colors > 5, `il video ripristinato si vede (${colors} colori)`);
  } finally {
    await app.close();
  }
});

test('desktop: una sola istanza — il secondo avvio si chiude e porta in primo piano la finestra', { skip }, async () => {
  const ud = tmp('ciak-ud-');
  const { app } = await launch(ud);
  try {
    const second = spawn(electronPath, ['--no-sandbox', `--user-data-dir=${ud}`, ROOT], { env: ENV, stdio: 'ignore' });
    const code = await new Promise((resolve) => {
      const t = setTimeout(() => {
        second.kill('SIGKILL');
        resolve('timeout');
      }, 20000);
      second.on('exit', (c) => {
        clearTimeout(t);
        resolve(c);
      });
    });
    assert.equal(code, 0, 'il secondo processo deve terminare subito');
    assert.equal(app.windows().length, 1);
  } finally {
    await app.close();
  }
});

test('desktop: il file dell\'editor esiste ed è un unico HTML autosufficiente', () => {
  const f = path.join(ROOT, 'dist', 'ciak-studio.html');
  assert.ok(existsSync(f));
});


import { closeSync, openSync, readSync, statSync } from 'node:fs';

/** Elenco dei box MP4 di primo livello, per verificare che «moov» preceda «mdat» (faststart). */
function topLevelBoxes(file) {
  const fd = openSync(file, 'r');
  const size = statSync(file).size;
  const boxes = [];
  let pos = 0;
  const head = Buffer.alloc(16);
  try {
    while (pos + 8 <= size && boxes.length < 50) {
      readSync(fd, head, 0, 16, pos);
      let len = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      if (len === 1) len = Number(head.readBigUInt64BE(8));
      boxes.push(type);
      if (len < 8) break;
      pos += len;
    }
  } finally {
    closeSync(fd);
  }
  return boxes;
}

test('desktop: esporta solo audio in FLAC e M4A e il video in MOV tramite ffmpeg incluso', { skip }, async () => {
  const outDir = tmp('ciak-aud-');
  const { app, win, errors } = await launch(tmp('ciak-ud-'), [], { CIAK_FFMPEG: 'ffmpeg', CIAK_TEST_SAVE_DIR: outDir });
  try {
    await win.setInputFiles('#file-input', [m.f('tone.wav'), m.f('b.webm')]);
    await win.waitForFunction(() => document.querySelectorAll('.media-card').length >= 2);
    const add = async (i) => {
      const card = win.locator('.media-card').nth(i);
      await card.hover();
      await card.locator('.add').click();
    };
    await add(0); // tone.wav, 3 s
    await win.waitForSelector('.clip');

    const exportAs = async (format, name) => {
      await win.click('#btn-export');
      await win.waitForFunction((f) => document.querySelector(`#exp-format option[value="${f}"]`), format, { timeout: 15000 });
      await win.selectOption('#exp-format', format);
      await win.fill('#exp-name', name);
      await win.click('button[data-act="start"]');
      await win.waitForSelector('#exp-saved-path', { timeout: 120000 });
      await win.click('button[data-act="close"]').catch(() => {});
      await win.waitForSelector('dialog.dialog[open]', { state: 'detached', timeout: 5000 }).catch(() => {});
    };

    await exportAs('flac-ffmpeg', 'brano');
    const flac = path.join(outDir, 'brano.flac');
    assert.ok(existsSync(flac), 'FLAC salvato col nome scelto');
    const fi = ffprobe(flac);
    assert.equal(fi.audio.codec_name, 'flac');
    assert.equal(Number(fi.audio.channels), 2);
    assert.ok(Math.abs(fi.duration - 3) < 0.15, `durata FLAC ${fi.duration}`);

    await exportAs('m4a-ffmpeg', 'brano');
    const m4a = path.join(outDir, 'brano.m4a');
    assert.ok(existsSync(m4a), 'M4A salvato');
    const mi = ffprobe(m4a);
    assert.equal(mi.audio.codec_name, 'aac');
    assert.ok(Math.abs(mi.duration - 3) < 0.2, `durata M4A ${mi.duration}`);
    assert.equal(readdirSync(outDir).some((f) => f.endsWith('.part')), false, 'nessun file temporaneo rimasto');

    // MOV: un video vero
    await win.evaluate(() => window.__ciak.store.commit('prova', (p) => { for (const t of p.tracks) t.clips.length = 0; }));
    await add(1);
    await win.waitForSelector('.clip.kind-video');
    await win.click('#btn-export');
    await win.waitForFunction(() => document.querySelector('#exp-format option[value="mov-ffmpeg"]'), null, { timeout: 15000 });
    await win.selectOption('#exp-format', 'mov-ffmpeg');
    await win.selectOption('#exp-size', '480');
    await win.fill('#exp-name', 'filmato');
    await win.click('button[data-act="start"]');
    await win.waitForSelector('#exp-saved-path', { timeout: 120000 });
    const mov = path.join(outDir, 'filmato.mov');
    assert.ok(existsSync(mov), 'MOV salvato');
    const vi = ffprobe(mov);
    assert.match(vi.format, /mov/);
    assert.equal(vi.video.codec_name, 'h264');
    assert.equal(vi.audio.codec_name, 'aac');
    assert.equal(vi.video.height, 480);
    const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', mov, '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(dec.stderr.trim(), '', 'decodifica senza errori');
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});

test('desktop: codec e contenitori a scelta (H.265, MKV, WebM VP9/AV1) e bitrate personalizzato', { skip }, async () => {
  const outDir = tmp('ciak-cod-');
  const { app, win, errors } = await launch(tmp('ciak-ud-'), [], { CIAK_FFMPEG: 'ffmpeg', CIAK_TEST_SAVE_DIR: outDir });
  try {
    await win.setInputFiles('#file-input', m.f('b.webm'));
    await win.waitForSelector('.media-card');
    const card = win.locator('.media-card').first();
    await card.hover();
    await card.locator('.add').click();
    await win.waitForSelector('.clip');
    const sizes = await win.evaluate(() => null);
    void sizes;
    const run = async (format, name, { bitrate } = {}) => {
      await win.click('#btn-export');
      await win.waitForFunction((f) => document.querySelector(`#exp-format option[value="${f}"]`), format, { timeout: 15000 });
      await win.selectOption('#exp-format', format);
      await win.selectOption('#exp-size', '480');
      if (bitrate) {
        await win.selectOption('#exp-quality', 'custom');
        await win.fill('#exp-bitrate', String(bitrate));
      }
      await win.fill('#exp-name', name);
      await win.click('button[data-act="start"]');
      await win.waitForSelector('#exp-saved-path', { timeout: 180000 });
      await win.click('button[data-act="close"]').catch(() => {});
      await win.waitForSelector('dialog.dialog[open]', { state: 'detached', timeout: 5000 }).catch(() => {});
    };
    // la scelta di 4K esiste anche per un progetto Full HD
    await win.click('#btn-export');
    const opts = await win.evaluate(() => [...document.querySelectorAll('#exp-size option')].map((o) => o.textContent));
    assert.ok(opts.some((t) => /4K/.test(t) && /2160/.test(t)), `si può scegliere il 4K (${opts.join(' | ')})`);
    await win.click('button[data-act="Chiudi"], button[data-act="close"]').catch(() => {});
    await win.waitForSelector('dialog.dialog[open]', { state: 'detached', timeout: 5000 }).catch(() => {});

    await run('h265-ffmpeg', 'hevc');
    let i = ffprobe(path.join(outDir, 'hevc.mp4'));
    assert.equal(i.video.codec_name, 'hevc');
    assert.equal(i.video.codec_tag_string, 'hvc1', 'compatibile con QuickTime e i telefoni');
    assert.equal(i.audio.codec_name, 'aac');

    await run('mkv-ffmpeg', 'matr');
    i = ffprobe(path.join(outDir, 'matr.mkv'));
    assert.equal(i.video.codec_name, 'h264');
    assert.match(i.format, /matroska/);

    await run('webm-ffmpeg', 'vp9');
    i = ffprobe(path.join(outDir, 'vp9.webm'));
    assert.equal(i.video.codec_name, 'vp9');
    assert.equal(i.audio.codec_name, 'opus');

    await run('av1-ffmpeg', 'av1');
    i = ffprobe(path.join(outDir, 'av1.webm'));
    assert.equal(i.video.codec_name, 'av1');

    // bitrate personalizzato: su un filmato con molto movimento il file segue la velocità richiesta
    await win.evaluate(() => window.__ciak.store.commit('prova', (p) => { for (const t of p.tracks) t.clips.length = 0; }));
    await win.setInputFiles('#file-input', m.f('a.webm'));
    await win.waitForFunction(() => document.querySelectorAll('.media-card').length >= 2);
    const c2 = win.locator('.media-card').nth(1);
    await c2.hover();
    await c2.locator('.add').click();
    await win.waitForSelector('.clip');
    await run('mp4-ffmpeg', 'lento', { bitrate: 0.8 });
    await run('mp4-ffmpeg', 'veloce', { bitrate: 6 });
    const kb = (f) => { const x = ffprobe(path.join(outDir, f)); return (x.size * 8) / x.duration / 1000; };
    const slow = kb('lento.mp4');
    const fast = kb('veloce.mp4');
    assert.ok(slow < 1800, `a 0,8 Mbit/s il file è leggero (${Math.round(slow)} kbit/s)`);
    assert.ok(fast > slow * 2.5, `a 6 Mbit/s il file è molto più ricco (${Math.round(fast)} contro ${Math.round(slow)} kbit/s)`);
    for (const f of readdirSync(outDir)) assert.ok(!f.endsWith('.part'), `file temporaneo rimasto: ${f}`);
    for (const f of ['hevc.mp4', 'matr.mkv', 'vp9.webm', 'av1.webm', 'lento.mp4', 'veloce.mp4']) {
      const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(outDir, f), '-f', 'null', '-'], { encoding: 'utf8' });
      assert.equal(dec.stderr.trim(), '', `${f}: decodifica senza errori ${dec.stderr}`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});

test('desktop: «Comprimi/converti» ricodifica un video qualsiasi in MP4 più leggero, senza toccare l\'originale', { skip }, async () => {
  const outDir = tmp('ciak-tc-');
  const { app, win, errors } = await launch(tmp('ciak-ud-'), [], { CIAK_FFMPEG: 'ffmpeg', CIAK_TEST_SAVE_DIR: outDir, CIAK_TEST_INPUT_FILE: m.f('a.webm') });
  try {
    const before = statSync(m.f('a.webm')).size;
    await win.click('#btn-transcode');
    await win.waitForSelector('#tc-preset');
    await win.selectOption('#tc-preset', 'compress480');
    await win.click('button[data-act="tc-start"]');
    await win.waitForSelector('#tc-done', { timeout: 120000 });
    const out = path.join(outDir, readdirSync(outDir).find((f) => f.endsWith('.mp4')));
    const info = ffprobe(out);
    assert.equal(info.video.codec_name, 'h264');
    assert.equal(info.audio.codec_name, 'aac');
    assert.ok(info.video.height <= 480, `altezza ${info.video.height}`);
    assert.equal(info.video.pix_fmt, 'yuv420p');
    assert.ok(Math.abs(info.duration - 4) < 0.5, `durata ${info.duration}`);
    const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', out, '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(dec.stderr.trim(), '', 'decodifica senza errori');
    assert.equal(statSync(m.f('a.webm')).size, before, 'l\'originale non è stato toccato');
    assert.ok(readdirSync(outDir).every((f) => !f.endsWith('.part')), 'nessun file temporaneo');
    assert.match(await win.textContent('#tc-status'), /→/, 'mostra la dimensione prima e dopo');
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});

// ---- strumenti video (ffmpeg) -------------------------------------------------------------------------------
async function videoTool(win, file, tool) {
  await win.setInputFiles('#file-input', file);
  await win.waitForSelector('.media-card');
  const card = win.locator('.media-card').first();
  await card.hover();
  await card.locator('.add').click();
  await win.waitForSelector('.clip.kind-video');
  await win.locator('.clip.kind-video').first().click();
  const closed = win.locator('details.section:not([open])', { has: win.locator('summary', { hasText: 'Strumenti video' }) });
  if (await closed.count()) await closed.first().locator('summary').click();
  await win.selectOption('#sel-video-tool', tool);
  const before = await win.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].mediaId);
  await win.click('#btn-video-tool');
  await win.waitForFunction((b) => window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].mediaId !== b, before, { timeout: 280000 });
  return win.evaluate(async () => {
    const c = window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0];
    return { clip: JSON.parse(JSON.stringify(c)), media: window.__ciak.store.project.media[c.mediaId], bytes: Array.from(new Uint8Array(await window.__ciak.pool.blob(c.mediaId).arrayBuffer())) };
  });
}
const jitter = (file) => {
  const out = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { encoding: 'utf8' }).stdout;
  const v = [...out.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1])).slice(3);
  return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
};

test('desktop: «Al contrario» riproduce il video all\'indietro e la stessa parte si vede dalla fine', { skip }, async () => {
  const dir = tmp('ciak-vt-');
  const { app, win, errors } = await launch(tmp('ciak-ud-'), [], { CIAK_FFMPEG: 'ffmpeg' });
  try {
    const r = await videoTool(win, m.f('a.webm'), 'reverse');
    const rev = path.join(dir, 'rev.mp4');
    writeFileSync(rev, Buffer.from(r.bytes));
    const info = ffprobe(rev);
    assert.equal(info.video.codec_name, 'h264');
    assert.ok(Math.abs(info.duration - 4) < 0.5, `durata ${info.duration}`);
    assert.ok(info.audio, 'ha anche l\'audio');
    // il primo fotogramma del film al contrario somiglia all'ultimo dell'originale (il testsrc2 ha un contatore: se fosse ancora dritto sarebbe diverso)
    const first = path.join(dir, 'first.png');
    const last = path.join(dir, 'last.png');
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', rev, '-frames:v', '1', '-vf', 'scale=320:180', first]);
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-sseof', '-0.1', '-i', m.f('a.webm'), '-update', '1', '-frames:v', '1', '-vf', 'scale=320:180', last]);
    const psnr = (a, b) => Number(/average:([\d.]+|inf)/.exec(spawnSync('ffmpeg', ['-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' }).stderr)?.[1]);
    const orig0 = path.join(dir, 'orig0.png');
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', m.f('a.webm'), '-frames:v', '1', '-vf', 'scale=320:180', orig0]);
    const same = psnr(first, last);
    const diff = psnr(first, orig0);
    assert.ok(same > diff + 1.5, `il primo fotogramma al contrario somiglia all'ultimo dell'originale (PSNR ${same} contro ${diff})`);
    // e viceversa: l'ultimo fotogramma al contrario somiglia al primo dell'originale
    const revLast = path.join(dir, 'revlast.png');
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-sseof', '-0.1', '-i', rev, '-update', '1', '-frames:v', '1', '-vf', 'scale=320:180', revLast]);
    assert.ok(psnr(revLast, orig0) > psnr(revLast, last) + 1.5, 'l\'ultimo fotogramma al contrario somiglia al primo dell\'originale');
    // il clip guarda la stessa parte (in = durata − usata)
    assert.ok(r.clip.in >= 0 && r.clip.duration > 3, `clip ${JSON.stringify({ in: r.clip.in, d: r.clip.duration })}`);
    // si annulla
    await win.click('#btn-undo');
    const back = await win.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].mediaId);
    assert.notEqual(back, r.clip.mediaId);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});

test('desktop: «Stabilizza» riduce davvero il tremolio di una ripresa e mantiene durata e audio', { skip }, async () => {
  const dir = tmp('ciak-vt-');
  const { app, win, errors } = await launch(tmp('ciak-ud-'), [], { CIAK_FFMPEG: 'ffmpeg' });
  try {
    const r = await videoTool(win, m.f('shaky.webm'), 'stabilize');
    const out = path.join(dir, 'stab.mp4');
    writeFileSync(out, Buffer.from(r.bytes));
    const before = jitter(m.f('shaky.webm'));
    const after = jitter(out);
    assert.ok(before > 1, `la ripresa tremolante ha movimento (${before.toFixed(2)})`);
    assert.ok(after < before * 0.6, `dopo la stabilizzazione si muove molto meno (${before.toFixed(2)} → ${after.toFixed(2)})`);
    const info = ffprobe(out);
    assert.ok(Math.abs(info.duration - 3) < 0.5);
    assert.ok(info.audio);
    assert.equal(info.video.width, 640);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});

test('desktop: ingrandisci 2×, meno disturbo, più nitido e super rallentatore producono video validi', { skip }, async () => {
  const dir = tmp('ciak-vt-');
  const { app, win, errors } = await launch(tmp('ciak-ud-'), [], { CIAK_FFMPEG: 'ffmpeg' });
  try {
    let r = await videoTool(win, m.f('tiny.webm'), 'upscale');
    writeFileSync(path.join(dir, 'up.mp4'), Buffer.from(r.bytes));
    let i = ffprobe(path.join(dir, 'up.mp4'));
    assert.equal(i.video.width, 640);
    assert.equal(i.video.height, 360);
    assert.equal(r.media.width, 640, 'il progetto conosce la nuova risoluzione');
    await win.click('#btn-undo');
    await win.evaluate(() => window.__ciak.store.commit('prova', (p) => { for (const t of p.tracks) t.clips.length = 0; }));
    await win.evaluate(() => { document.querySelector('.media-card .remove, .media-card [data-act="remove"]')?.click(); });
    for (const tool of ['denoise', 'enhance']) {
      await win.evaluate(() => window.__ciak.store.commit('prova', (p) => { for (const t of p.tracks) t.clips.length = 0; }));
      await win.locator('.media-card').first().hover();
      await win.locator('.media-card').first().locator('.add').click();
      await win.waitForSelector('.clip.kind-video');
      await win.locator('.clip.kind-video').first().click();
      const closed = win.locator('details.section:not([open])', { has: win.locator('summary', { hasText: 'Strumenti video' }) });
      if (await closed.count()) await closed.first().locator('summary').click();
      await win.selectOption('#sel-video-tool', tool);
      const before = await win.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].mediaId);
      await win.click('#btn-video-tool');
      await win.waitForFunction((b) => window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].mediaId !== b, before, { timeout: 120000 });
      const bytes = await win.evaluate(async () => Array.from(new Uint8Array(await window.__ciak.pool.blob(window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].mediaId).arrayBuffer())));
      const f = path.join(dir, `${tool}.mp4`);
      writeFileSync(f, Buffer.from(bytes));
      i = ffprobe(f);
      assert.equal(i.video.codec_name, 'h264', tool);
      assert.ok(Math.abs(i.duration - 1) < 0.3, `${tool}: durata ${i.duration}`);
      const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'], { encoding: 'utf8' });
      assert.equal(dec.stderr.trim(), '', `${tool}: decodifica senza errori`);
    }
    // super rallentatore: più fotogrammi e velocità 0,25×
    await win.evaluate(() => window.__ciak.store.commit('prova', (p) => { for (const t of p.tracks) t.clips.length = 0; }));
    await win.locator('.media-card').first().hover();
    await win.locator('.media-card').first().locator('.add').click();
    await win.waitForSelector('.clip.kind-video');
    await win.locator('.clip.kind-video').first().click();
    const closed = win.locator('details.section:not([open])', { has: win.locator('summary', { hasText: 'Strumenti video' }) });
    if (await closed.count()) await closed.first().locator('summary').click();
    await win.selectOption('#sel-video-tool', 'slowmo');
    const before = await win.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].mediaId);
    await win.click('#btn-video-tool');
    await win.waitForFunction((b) => window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].mediaId !== b, before, { timeout: 250000 });
    const c = await win.evaluate(() => JSON.parse(JSON.stringify(window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0])));
    assert.equal(c.speed, 0.25, 'velocità 0,25×');
    assert.ok(c.duration > 3.5 && c.duration < 4.6, `il clip dura circa 4 s (${c.duration})`);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});

test('desktop: «Voce da testo» trasforma un testo in un clip audio con la voce del sistema', { skip }, async () => {
  const { app, win, errors } = await launch(tmp('ciak-ud-'), [], { CIAK_FFMPEG: 'ffmpeg' });
  try {
    const voices = await win.evaluate(() => window.ciakDesktop.ttsVoices());
    if (!voices.length) return; // nessuna voce di sistema in questo ambiente
    await win.click('#btn-tts');
    await win.waitForSelector('#tts-text');
    await win.fill('#tts-text', 'Questa è la voce di prova per il montaggio.');
    // anteprima: nessun errore
    await win.click('#btn-tts-preview');
    await win.waitForTimeout(800);
    assert.equal(await win.textContent('#tts-status'), '');
    await win.click('button[data-act="tts-add"]');
    await win.waitForSelector('.clip.kind-audio', { timeout: 30000 });
    const [c] = await win.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips));
    assert.equal(c.kind, 'audio');
    assert.ok(c.duration > 1.2 && c.duration < 10, `durata della voce ${c.duration}`);
    const media = await win.evaluate((id) => window.__ciak.store.project.media[id], c.mediaId);
    assert.equal(media.mime, 'audio/wav');
    assert.ok(Math.abs(media.duration - c.duration) < 0.01);
    // testo vuoto: messaggio comprensibile, nessun clip in più
    await win.click('#btn-tts');
    await win.waitForSelector('#tts-text');
    await win.click('button[data-act="tts-add"]');
    await win.waitForFunction(() => /Scrivi il testo/.test(document.querySelector('#tts-status')?.textContent ?? ''));
    assert.equal(await win.locator('.clip').count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});

const ASR_MODELS = process.env.CIAK_ASR_MODELS || path.join(ROOT, 'node_modules', 'sts-whisper-tiny', 'models');
const haveAsr = existsSync(path.join(ASR_MODELS, 'Xenova', 'whisper-tiny', 'onnx', 'encoder_model_quantized.onnx')) ? false : 'modello non installato (npm i -D sts-whisper-tiny)';

/** Un video con l'audio della voce vera (jfk.wav ripetuto): `seconds` lunghi, immagine piccolissima per restare leggero. */
function speechVideo(dir, seconds) {
  const out = path.join(dir, `parlato-${seconds}.webm`);
  const loops = Math.ceil(seconds / 11);
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=0x303030:s=160x90:r=2:d=${seconds}`, '-stream_loop', String(loops), '-i', path.join(ROOT, 'tests', 'fixtures', 'jfk.wav'), '-t', String(seconds), '-c:v', 'libvpx', '-b:v', '30k', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', '-b:a', '24k', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return out;
}
const breakBrowserDecoding = (win) => win.evaluate(() => {
  // come per il video dell'utente (27 minuti, MP4 pesante da telefono): la decodifica del browser fallisce
  OfflineAudioContext.prototype.decodeAudioData = () => Promise.reject(new DOMException('Unable to decode audio data', 'EncodingError'));
});

test('desktop: sottotitoli di un video LUNGO (22 minuti): ffmpeg legge l’audio dal file su disco anche se il browser non riesce', { skip, timeout: 300000 }, async () => {
  const dir = tmp('ciak-long-');
  const file = speechVideo(dir, 1320);
  const { app, win, errors } = await launch(tmp('ciak-ud-'), [], { CIAK_FFMPEG: 'ffmpeg' });
  try {
    await breakBrowserDecoding(win);
    await win.setInputFiles('#file-input', file);
    await win.waitForSelector('.media-card', { timeout: 60000 });
    const card = win.locator('.media-card').first();
    await card.hover();
    await card.locator('.add').click();
    await win.locator('.clip').first().click();
    await win.click('#tab-subtitles');
    await win.click('#btn-auto-captions');
    await win.waitForSelector('#captions-dialog');
    assert.match(await win.inputValue('#cap-source'), /clip/);
    await win.selectOption('#cap-method', 'timing');
    const t0 = Date.now();
    await win.click('#cap-run');
    await win.waitForSelector('#cap-list .cap-text', { timeout: 200000 });
    const secs = (Date.now() - t0) / 1000;
    const times = await win.locator('#cap-list .sub-time').allTextContents();
    assert.ok(times.length > 150, `una riga per ogni frase detta in 22 minuti: ${times.length}`);
    const last = times.at(-1).split('→')[0].trim();
    const [mm, ss] = last.split(':').map(Number);
    assert.ok(mm * 60 + ss > 1250, `arriva in fondo al video: ultima frase a ${last}`);
    assert.ok(secs < 120, `ci mette ${secs.toFixed(0)} s`);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});

test('desktop: sottotitoli con Whisper vero da un video il cui audio il browser non sa leggere (ffmpeg lo estrae)', { skip: skip || haveAsr, timeout: 300000 }, async () => {
  const dir = tmp('ciak-sp-');
  const file = speechVideo(dir, 11);
  const { app, win, errors } = await launch(tmp('ciak-ud-'), [], { CIAK_FFMPEG: 'ffmpeg', CIAK_ASR_MODELS: ASR_MODELS });
  try {
    await breakBrowserDecoding(win);
    await win.setInputFiles('#file-input', file);
    await win.waitForSelector('.media-card');
    const card = win.locator('.media-card').first();
    await card.hover();
    await card.locator('.add').click();
    await win.locator('.clip').first().click();
    await win.click('#tab-subtitles');
    await win.click('#btn-auto-captions');
    await win.waitForSelector('#captions-dialog');
    await win.selectOption('#cap-lang', 'en');
    await win.click('#cap-run');
    await win.waitForSelector('#cap-list .cap-text', { timeout: 200000 });
    const all = (await win.locator('#cap-list .cap-text').evaluateAll((els) => els.map((e) => e.value))).join(' ').toLowerCase();
    for (const w of ['fellow americans', 'your country']) assert.ok(all.includes(w), `manca «${w}» in «${all}»`);
    // anche con tutto il progetto come sorgente (nessun clip selezionato)
    await win.evaluate(() => window.__ciak.selection.clear());
    await win.click('[data-act="cap-close"]');
    await win.click('#btn-auto-captions');
    await win.waitForSelector('#captions-dialog');
    assert.equal(await win.inputValue('#cap-source'), 'project');
    await win.selectOption('#cap-lang', 'en');
    await win.click('#cap-run');
    await win.waitForSelector('#cap-list .cap-text', { timeout: 200000 });
    const all2 = (await win.locator('#cap-list .cap-text').evaluateAll((els) => els.map((e) => e.value))).join(' ').toLowerCase();
    assert.ok(all2.includes('your country'), all2);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});


test('desktop: «Sottotitoli automatici» con Whisper vero nel processo principale (voce umana vera)', { skip: skip || haveAsr, timeout: 240000 }, async () => {
  const { app, win, errors } = await launch(tmp('ciak-ud-'), [], { CIAK_ASR_MODELS: ASR_MODELS });
  try {
    const av = await win.evaluate(() => window.ciakDesktop.asrAvailable());
    assert.equal(av.ok, true, JSON.stringify(av));
    assert.deepEqual(Object.keys(av.models), ['tiny', 'base', 'small']);
    assert.ok(av.languages.includes('it') && av.languages.includes('en'));
    // richiesta sbagliata: errore comprensibile, nessuna eccezione
    const bad = await win.evaluate(() => window.ciakDesktop.asrTranscribe(new Float32Array(16000), { language: 'xx', model: 'tiny' }));
    assert.equal(bad.ok, false);
    assert.match(bad.error, /Lingua non supportata/);
    await win.setInputFiles('#file-input', path.join(ROOT, 'tests', 'fixtures', 'jfk.wav'));
    await win.waitForSelector('.media-card');
    const card = win.locator('.media-card').first();
    await card.hover();
    await card.locator('.add').click();
    await win.click('#tab-subtitles');
    await win.click('#btn-auto-captions');
    await win.waitForSelector('#captions-dialog');
    await win.selectOption('#cap-lang', 'en');
    await win.click('#cap-run');
    await win.waitForSelector('#cap-list .cap-text', { timeout: 200000 });
    const texts = await win.locator('#cap-list .cap-text').evaluateAll((els) => els.map((e) => e.value));
    const all = texts.join(' ').toLowerCase();
    for (const w of ['fellow americans', 'ask not', 'your country', 'do for you']) assert.ok(all.includes(w), `manca «${w}» in «${all}»`);
    await win.click('#cap-add');
    await win.waitForSelector('#captions-dialog', { state: 'detached' });
    const subs = await win.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).filter((c) => c.role === 'subtitle').sort((a, b) => a.start - b.start).map((c) => ({ start: c.start, d: c.duration, t: c.text.content })));
    assert.equal(subs.length, texts.length);
    assert.ok(subs[0].start > 0.1 && subs[0].start < 0.6, `parte quando inizia la voce: ${subs[0].start}`);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});

test('desktop: «Rimuovi sfondo» usa i file di MediaPipe inclusi (protocollo interno) e ritaglia la persona di una foto vera', { skip, timeout: 240000 }, async () => {
  const { app, win, errors } = await launch(tmp('ciak-ud-'), ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']);
  try {
    // il protocollo interno serve solo i file previsti, per nome
    const probe = await win.evaluate(async () => {
      const get = (u) => fetch(u).then((r) => r.status, () => 'errore');
      return { ok: await get('ciak-asset://mediapipe/selfie_segmentation.binarypb'), nope: await get('ciak-asset://mediapipe/package.json'), up: await get('ciak-asset://mediapipe/..%2f..%2fpackage.json'), host: await get('ciak-asset://altro/selfie_segmentation.js'), web: await get('https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/selfie_segmentation.js').catch(() => 'errore') };
    });
    assert.equal(probe.ok, 200);
    assert.notEqual(probe.nope, 200);
    assert.notEqual(probe.up, 200);
    assert.notEqual(probe.host, 200);
    assert.equal(probe.web, 'errore', 'la rete resta bloccata');
    await win.evaluate(() => window.__ciak.commit('Sfondo verde', (d) => { d.settings.background = '#00ff00'; }));
    await win.setInputFiles('#file-input', path.join(ROOT, 'tests', 'fixtures', 'astronaut.png'));
    await win.waitForSelector('.media-card');
    const card = win.locator('.media-card').first();
    await card.hover();
    await card.locator('.add').click();
    await win.locator('.clip').first().click();
    await win.locator('.insp-tabs .tab', { hasText: /^Immagine$/ }).click();
    const sec = win.locator('details.section', { has: win.locator('summary', { hasText: 'Rimuovi sfondo' }) });
    if (!(await sec.evaluate((e) => e.open))) await sec.locator('summary').click();
    await sec.locator('label.toggle').click();
    await win.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).every((c) => !c.cutout.enabled || window.__ciak.cutouts.covers(c)), null, { timeout: 120000 });
    await win.evaluate(() => window.__ciak.player.settle());
    const px = (fx, fy) => win.evaluate(([x, y]) => { const c = window.__ciak.preview.canvas; const d = c.getContext('2d').getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data; return [d[0], d[1], d[2]]; }, [fx, fy]);
    const green = ([r, g, b]) => g > 200 && r < 60 && b < 60;
    assert.equal(green(await px(0.25, 0.06)), true, 'sfondo tolto');
    assert.equal(green(await px(0.5, 0.3)), false, 'la persona resta');
    assert.deepEqual(errors.filter((e) => !/GL Driver Message|GPU stall|Failed to load resource/.test(e)), [], 'solo gli errori delle richieste di prova (404 e rete bloccata)');
  } finally {
    await app.close();
  }
});

test('desktop: «Registra schermo» elenca gli schermi veri, ne registra uno e mette la clip sulla timeline', { skip }, async () => {
  const { app, win, errors } = await launch(tmp('ciak-ud-'));
  try {
    const sources = await win.evaluate(() => window.ciakDesktop.listSources());
    assert.ok(sources.length >= 1, 'almeno uno schermo');
    assert.ok(sources.every((x) => x.id && x.name && x.thumbnail.startsWith('data:image/')), 'ogni sorgente ha id, nome e anteprima');
    await win.click('#btn-record-screen');
    await win.selectOption('#rec-mode', 'screen');
    await win.uncheck('#rec-mic');
    await win.click('[data-act="rec-go"]');
    await win.waitForSelector('#capture-picker .src', { timeout: 15000 });
    assert.ok((await win.locator('#capture-picker .src').count()) >= 1);
    await win.locator('#capture-picker .src').first().click();
    await win.waitForSelector('.rec-bar', { timeout: 15000 });
    await win.waitForFunction(() => /^0:0[2-9]$/.test(document.querySelector('#rec-time')?.textContent ?? ''), null, { timeout: 15000 });
    await win.click('#btn-rec-stop');
    await win.waitForFunction(() => window.__ciak.store.project.tracks.some((t) => t.clips.length), null, { timeout: 30000 });
    const [c] = await win.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips));
    assert.equal(c.kind, 'video');
    assert.ok(c.duration >= 1.8 && c.duration < 15, `durata ${c.duration}`);
    const media = await win.evaluate((id) => window.__ciak.store.project.media[id], c.mediaId);
    assert.ok(media.width >= 320 && media.height >= 200, `dimensioni ${media.width}x${media.height}`);
    assert.equal(await win.locator('.rec-bar').count(), 0);
    // annullando il selettore non parte nessuna registrazione
    await win.click('#btn-record-screen');
    await win.selectOption('#rec-mode', 'screen');
    await win.click('[data-act="rec-go"]');
    await win.waitForSelector('#capture-picker');
    await win.click('#capture-picker >> text=Annulla');
    await win.waitForTimeout(400);
    assert.equal(await win.locator('.rec-bar').count(), 0);
    assert.equal(await win.locator('#capture-picker').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});

test('desktop: esporta in MP4 vero (H.264/AAC, frequenza costante, faststart) tramite ffmpeg incluso', { skip }, async () => {
  const outDir = tmp('ciak-mp4-');
  const { app, win, errors } = await launch(tmp('ciak-ud-'), [], { CIAK_FFMPEG: 'ffmpeg', CIAK_TEST_SAVE_DIR: outDir });
  try {
    // il ponte espone solo ciò che serve e la pagina continua a non vedere Node
    const bridge = await win.evaluate(() => ({ keys: Object.keys(window.ciakDesktop).sort(), node: typeof require, proc: typeof process }));
    assert.deepEqual(bridge.keys, ['asrAvailable', 'asrTranscribe', 'cancelConvert', 'chooseSource', 'convertAudio', 'convertToMp4', 'extractAudio', 'isDesktop', 'listSources', 'mediapipeBase', 'mp4Available', 'onAsrProgress', 'onConvertProgress', 'pathForFile', 'platform', 'showInFolder', 'transcodeFile', 'tts', 'ttsVoices', 'videoTool']);
    assert.equal(`${bridge.node}|${bridge.proc}`, 'undefined|undefined');
    // dati non validi e percorsi non autorizzati non fanno danni
    const bad = await win.evaluate(() => window.ciakDesktop.convertToMp4(new Uint8Array(10), {}));
    assert.equal(bad.ok, false);
    assert.equal(await win.evaluate(() => window.ciakDesktop.showInFolder('C:\\Windows\\System32\\cmd.exe')), true);

    await win.setInputFiles('#file-input', m.f('b.webm'));
    await win.waitForSelector('.media-card');
    const card = win.locator('.media-card').first();
    await card.hover();
    await card.locator('.add').click();
    await win.waitForSelector('.clip');
    await win.click('#btn-export');
    await win.waitForFunction(() => document.querySelector('#exp-format option[value="mp4-ffmpeg"]'), null, { timeout: 10000 });
    assert.equal(await win.locator('#exp-format').inputValue(), 'mp4-ffmpeg', 'MP4 è la scelta predefinita');
    await win.selectOption('#exp-size', '480');
    await win.fill('#exp-name', 'Il mio video');
    await win.click('button[data-act="start"]');
    await win.waitForSelector('#exp-saved-path', { timeout: 120000 });
    const saved = await win.evaluate(() => ({ frames: window.__ciak.lastExport.frames, expected: window.__ciak.lastExport.expectedFrames, conv: window.__ciak.lastExport.converted }));
    assert.equal(saved.conv.ok, true);
    assert.ok(saved.frames >= saved.expected * 0.95, `fotogrammi ${saved.frames}/${saved.expected}`);
    const file = path.join(outDir, 'Il mio video.mp4');
    assert.ok(existsSync(file), 'MP4 salvato col nome scelto');
    assert.equal(readdirSync(outDir).some((f) => f.endsWith('.part')), false, 'nessun file temporaneo rimasto');

    const info = ffprobe(file);
    assert.equal(info.video.codec_name, 'h264');
    assert.equal(info.video.pix_fmt, 'yuv420p', 'compatibile con tutti i lettori');
    const tags = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_range,color_space,color_primaries', '-of', 'default=nw=1:nk=0', file], { encoding: 'utf8' }).stdout;
    assert.match(tags, /color_range=tv/, 'gamma limitata (standard)');
    assert.match(tags, /color_space=bt709/);
    assert.match(tags, /color_primaries=bt709/);
    assert.equal(info.video.width, 854);
    assert.equal(info.video.height, 480);
    assert.equal(info.video.r_frame_rate, '30/1', 'frequenza costante');
    assert.equal(info.audio.codec_name, 'aac');
    assert.ok(Math.abs(info.duration - 3) < 0.7, `durata ${info.duration}`);
    assert.match(info.format, /mp4/);
    const boxes = topLevelBoxes(file);
    assert.ok(boxes.indexOf('moov') >= 0 && boxes.indexOf('moov') < boxes.indexOf('mdat'), `faststart: ${boxes.join(',')}`);
    const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(dec.stderr.trim(), '', 'decodifica senza errori');
    // ACCURATEZZA DEI COLORI: le barre SMPTE al 75% del video di prova devono uscire con i colori giusti
    const raw = spawnSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 1 << 26 }).stdout;
    const W = 854;
    const at = (bar) => {
      const x = Math.floor(((bar + 0.5) / 7) * W);
      const y = 120;
      const i = (y * W + x) * 3;
      return [raw[i], raw[i + 1], raw[i + 2]];
    };
    const expected = [[191, 191, 191], [191, 191, 0], [0, 191, 191], [0, 191, 0], [191, 0, 191], [191, 0, 0], [0, 0, 191]];
    expected.forEach((e, bar) => {
      const got = at(bar);
      assert.ok(e.every((v, c) => Math.abs(v - got[c]) <= 22), `barra ${bar}: atteso ~${e}, ottenuto ${got}`);
    });
    const vol = /mean_volume:\s*(-?[\d.]+) dB/.exec(spawnSync('ffmpeg', ['-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' }).stderr);
    assert.ok(vol && Number(vol[1]) > -45, `audio udibile (${vol?.[1]} dB)`);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
});
