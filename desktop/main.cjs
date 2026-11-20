'use strict';
// Guscio desktop di Ciak Studio: mostra l'editor (dist/ciak-studio.html) in una finestra nativa.
// La pagina NON ha accesso a Node: contextIsolation e sandbox attivi, nessun preload.

const { app, BrowserWindow, Menu, desktopCapturer, dialog, ipcMain, protocol, screen, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const tts = require('./tts.cjs');
const { createAsr } = require('./asr.cjs');

const APP_FILE = path.join(__dirname, '..', 'dist', 'ciak-studio.html');
const APP_URL = pathToFileURL(APP_FILE).href;
const ICON = path.join(__dirname, 'build', 'icon.png');

app.setAppUserModelId('app.ciakstudio.editor'); // raggruppa correttamente l'icona nella barra delle applicazioni

// ---- file del motore di ritaglio (MediaPipe) -------------------------------------------------------------
// La pagina non può leggere file locali con fetch: li serve un protocollo interno, solo da una cartella fissa e solo per nome di file.
protocol.registerSchemesAsPrivileged([{ scheme: 'ciak-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const MIME = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.tflite': 'application/octet-stream', '.binarypb': 'application/octet-stream' };
function mediapipeDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'mediapipe');
  return path.join(__dirname, '..', 'node_modules', '@mediapipe', 'selfie_segmentation');
}
function serveAsset(request) {
  const u = new URL(request.url);
  const name = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  if (u.host !== 'mediapipe' || !/^[\w.-]+$/.test(name) || !MIME[path.extname(name)]) return new Response('Non trovato', { status: 404 });
  const file = path.join(mediapipeDir(), name);
  if (!fs.existsSync(file)) return new Response('Non trovato', { status: 404 });
  return new Response(fs.readFileSync(file), { headers: { 'content-type': MIME[path.extname(name)], 'access-control-allow-origin': '*' } });
}

// ---- una sola istanza: un secondo avvio riporta in primo piano la finestra esistente ----------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;

// ---- dimensione e posizione della finestra ------------------------------------------------------------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const ok = [s.width, s.height].every((v) => Number.isFinite(v) && v >= 400);
    if (!ok) return {};
    const visible = Number.isFinite(s.x) && Number.isFinite(s.y) && screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      return s.x < b.x + b.width - 80 && s.x + s.width > b.x + 80 && s.y < b.y + b.height - 80 && s.y + 80 > b.y;
    });
    return { width: s.width, height: s.height, ...(visible ? { x: s.x, y: s.y } : {}), maximized: !!s.maximized };
  } catch {
    return {};
  }
}

function saveState(win) {
  try {
    if (win.isDestroyed() || win.isFullScreen()) return;
    fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {
    /* non è essenziale */
  }
}

// ---- sicurezza -------------------------------------------------------------------------------------------
/** Concede solo ciò che serve (microfono per il voice-over, schermo intero) e solo alla nostra pagina. */
const ours = (url) => typeof url === 'string' && url.startsWith('file://') && url.split('#')[0].split('?')[0] === APP_URL;

function hardenSession(ses) {
  // La pagina non deve poter raggiungere la rete: la versione per browser scarica il riconoscimento vocale da internet,
  // qui lo fa il processo principale (desktop/asr.cjs). Si blocca ogni richiesta che non sia un file locale.
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(file|blob|data|devtools|chrome-extension|ciak-asset):/i.test(details.url) }));
  const allowed = new Set(['media', 'display-capture', 'fullscreen']);
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => callback(allowed.has(permission) && ours(details.requestingUrl)));
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => allowed.has(permission) && (ours(details?.requestingUrl) || requestingOrigin === 'file://'));
}

// ---- registrazione dello schermo: la pagina chiede l'elenco di schermi e finestre, l'utente sceglie, e solo allora
// getDisplayMedia ottiene esattamente quella sorgente (senza una scelta recente la richiesta è rifiutata) ----------------
const captureSources = new Map();
let capturePick = null;

ipcMain.handle('ciak:list-sources', async (event) => {
  assertOurs(event);
  const own = BrowserWindow.fromWebContents(event.sender)?.getMediaSourceId?.();
  const ask = (type) => desktopCapturer.getSources({ types: [type], thumbnailSize: { width: 360, height: 225 }, fetchWindowIcons: false }).catch(() => []);
  const list = [...(await ask('screen')), ...(await ask('window'))];
  captureSources.clear();
  const out = [];
  for (const s of list) {
    if (s.id === own || (!s.name && s.id.startsWith('window'))) continue; // la finestra di Ciak stessa creerebbe un tunnel infinito
    captureSources.set(s.id, s);
    out.push({ id: s.id, name: s.name || 'Schermo', kind: s.id.startsWith('screen') ? 'screen' : 'window', thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL() });
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'screen' ? -1 : 1));
});

ipcMain.handle('ciak:choose-source', (event, id, audio) => {
  assertOurs(event);
  if (!captureSources.has(id)) return false;
  capturePick = { id, audio: Boolean(audio), at: Date.now() };
  return true;
});

function installDisplayHandler(ses) {
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const p = capturePick;
    capturePick = null;
    const src = p && Date.now() - p.at < 30_000 && ours(request.frame?.url) ? captureSources.get(p.id) : null;
    if (!src) return callback({});
    const streams = { video: src };
    if (p.audio && process.platform === 'win32') streams.audio = 'loopback'; // audio del computer: solo Windows
    return callback(streams);
  }, { useSystemPicker: false });
}

function lockNavigation(contents) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' })); // niente finestre/popup esterne
  contents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] !== APP_URL) event.preventDefault(); // l'app non deve mai andare altrove
  });
  contents.setVisualZoomLevelLimits(1, 1).catch(() => {});
}

// ---- conversione in MP4 (ffmpeg incluso nel pacchetto) -----------------------------------------------------
// Il registratore del browser produce WebM; ffmpeg lo converte in un vero MP4 (H.264 + AAC) leggibile ovunque.

/** Percorso di ffmpeg: nel pacchetto (resources/ffmpeg), in sviluppo la copia scaricata o CIAK_FFMPEG. */
function ffmpegPath() {
  if (!app.isPackaged && process.env.CIAK_FFMPEG) return process.env.CIAK_FFMPEG;
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [path.join(process.resourcesPath || '', 'ffmpeg', exe), path.join(__dirname, 'ffmpeg', `${process.platform}-${process.arch}`, exe)];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

const CRF = { low: 26, medium: 22, high: 19, ultra: 16 };
// codec video disponibili in ffmpeg incluso; `crf` è la scala H.264 e qui si converte nella scala di ciascun codec
const VIDEO_CODECS = {
  h264: { enc: 'libx264', crf: (c) => c, args: ['-preset', 'fast'] },
  h265: { enc: 'libx265', crf: (c) => c + 4, args: ['-preset', 'fast', '-tag:v', 'hvc1'] },
  vp9: { enc: 'libvpx-vp9', crf: (c) => c + 8, args: ['-row-mt', '1', '-deadline', 'good', '-cpu-used', '4'] },
  av1: { enc: 'libaom-av1', crf: (c) => c + 12, args: ['-row-mt', '1', '-cpu-used', '8'] },
};
const savedFiles = new Set(); // solo i file che abbiamo scritto noi possono essere mostrati nella cartella
let convertProc = null;
let convertCancelled = false;

function assertOurs(event) {
  const url = event.senderFrame?.url ?? event.sender?.getURL?.() ?? '';
  if (!ours(url)) throw new Error('Mittente non autorizzato');
}

const safeName = (n) => String(n ?? 'video').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 100) || 'video';

ipcMain.handle('ciak:mp4-available', (event) => {
  assertOurs(event);
  return Boolean(ffmpegPath());
});

ipcMain.handle('ciak:convert-cancel', (event) => {
  assertOurs(event);
  convertCancelled = true;
  convertProc?.kill();
  return true;
});

ipcMain.handle('ciak:reveal', (event, filePath) => {
  assertOurs(event);
  if (typeof filePath === 'string' && savedFiles.has(filePath)) shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('ciak:convert-mp4', async (event, input, options = {}) => {
  assertOurs(event);
  const bin = ffmpegPath();
  if (!bin) return { ok: false, error: 'ffmpeg non è disponibile in questa installazione.' };
  if (convertProc) return { ok: false, error: 'Una conversione è già in corso.' };
  const data = input instanceof ArrayBuffer ? Buffer.from(input) : ArrayBuffer.isView(input) ? Buffer.from(input.buffer, input.byteOffset, input.byteLength) : null;
  if (!data || data.length < 100) return { ok: false, error: 'Dati video non validi.' };

  const win = BrowserWindow.fromWebContents(event.sender);
  const name = safeName(options.name);
  const container = ['mov', 'mkv', 'webm'].includes(options.container) ? options.container : 'mp4';
  const codecId = VIDEO_CODECS[options.codec] ? options.codec : container === 'webm' ? 'vp9' : 'h264';
  if (container === 'webm' && !['vp9', 'av1'].includes(codecId)) return { ok: false, error: 'WebM accetta solo VP9 o AV1.' };
  if ((container === 'mp4' || container === 'mov') && !['h264', 'h265'].includes(codecId)) return { ok: false, error: 'MP4 e MOV accettano H.264 o H.265.' };
  const customBitrate = Number(options.bitrate) > 0 ? Math.min(200_000_000, Math.max(200_000, Math.round(Number(options.bitrate)))) : 0;
  const fps = Math.min(120, Math.max(1, Math.round(Number(options.fps) || 30)));
  const duration = Number(options.duration) > 0 ? Number(options.duration) : 0;
  const crf = CRF[options.quality] ?? CRF.medium;

  // destinazione: scelta dall'utente (nei test automatici una cartella indicata da CIAK_TEST_SAVE_DIR)
  let dest;
  if (!app.isPackaged && process.env.CIAK_TEST_SAVE_DIR) dest = path.join(process.env.CIAK_TEST_SAVE_DIR, `${name}.${container}`);
  else {
    const r = await dialog.showSaveDialog(win, {
      title: `Salva il video ${container.toUpperCase()}`,
      defaultPath: path.join(app.getPath('videos'), `${name}.${container}`),
      filters: [{ name: `Video ${container.toUpperCase()}`, extensions: [container] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    dest = r.filePath.toLowerCase().endsWith(`.${container}`) ? r.filePath : `${r.filePath}.${container}`;
  }

  const tmpIn = path.join(app.getPath('temp'), `ciak-in-${process.pid}-${Date.now()}.webm`);
  const tmpOut = `${dest}.part`;
  const cleanup = () => {
    for (const f of [tmpIn, tmpOut]) fs.rm(f, { force: true }, () => {});
  };
  try {
    fs.writeFileSync(tmpIn, data);
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
      '-i', tmpIn,
      '-fps_mode', 'cfr', '-r', String(fps), // frequenza costante: richiesta dai programmi di montaggio
      // il registratore produce YUV a gamma completa (pc) BT.709: l'MP4 standard è a gamma limitata (tv) BT.709,
      // altrimenti molti lettori mostrano colori slavati o contrasto sbagliato
      '-vf', 'scale=out_range=tv:out_color_matrix=bt709,format=yuv420p',
      '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-c:v', VIDEO_CODECS[codecId].enc, ...VIDEO_CODECS[codecId].args,
      // qualità costante (CRF) oppure, se l'utente ha scelto un bitrate, velocità di dati fissa
      ...(customBitrate ? ['-b:v', String(customBitrate), '-maxrate', String(Math.round(customBitrate * 1.5)), '-bufsize', String(customBitrate * 2)] : ['-crf', String(VIDEO_CODECS[codecId].crf(crf)), ...(codecId === 'vp9' ? ['-b:v', '0'] : codecId === 'av1' ? ['-b:v', '0'] : [])]),
      '-pix_fmt', 'yuv420p',
      ...(container === 'webm' ? ['-c:a', 'libopus', '-b:a', '160k'] : ['-c:a', 'aac', '-b:a', '192k']),
      ...(container === 'mp4' || container === 'mov' ? ['-movflags', '+faststart'] : []), // l'indice all'inizio: il video parte subito anche online
      '-f', container === 'mkv' ? 'matroska' : container, tmpOut,
    ];
    convertCancelled = false;
    const result = await new Promise((resolve) => {
      const proc = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      convertProc = proc;
      let err = '';
      let buf = '';
      let last = 0;
      proc.stdout.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
          if (!m || !duration) continue;
          const now = Date.now();
          if (now - last < 120) continue;
          last = now;
          const sec = Number(m[1]) / 1e6;
          if (!event.sender.isDestroyed()) event.sender.send('ciak:convert-progress', Math.min(1, sec / duration));
        }
      });
      proc.stderr.on('data', (c) => {
        err = (err + c).slice(-2000);
      });
      proc.on('error', (e) => resolve({ ok: false, error: `Impossibile avviare ffmpeg: ${e.message}` }));
      proc.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: convertCancelled ? 'Conversione annullata.' : `ffmpeg ha terminato con errore ${code}. ${err.trim().split('\n').slice(-2).join(' ')}` , cancelled: convertCancelled }));
    });
    if (!result.ok) return result;
    fs.renameSync(tmpOut, dest);
    savedFiles.add(dest);
    return { ok: true, path: dest, bytes: fs.statSync(dest).size };
  } catch (e) {
    return { ok: false, error: `Conversione non riuscita: ${e.message}` };
  } finally {
    convertProc = null;
    cleanup();
  }
});

// Audio già mixato dall'editor (WAV) → FLAC (senza perdite) o M4A/AAC con ffmpeg.
const AUDIO_SPECS = {
  flac: { ext: 'flac', title: 'Salva l’audio FLAC', label: 'Audio FLAC', args: ['-vn', '-c:a', 'flac', '-f', 'flac'] },
  m4a: { ext: 'm4a', title: 'Salva l’audio M4A', label: 'Audio M4A (AAC)', args: ['-vn', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-f', 'ipod'] },
};

ipcMain.handle('ciak:convert-audio', async (event, input, options = {}) => {
  assertOurs(event);
  const spec = AUDIO_SPECS[options.kind];
  if (!spec) return { ok: false, error: 'Formato audio non supportato.' };
  const bin = ffmpegPath();
  if (!bin) return { ok: false, error: 'ffmpeg non è disponibile in questa installazione.' };
  if (convertProc) return { ok: false, error: 'Una conversione è già in corso.' };
  const data = input instanceof ArrayBuffer ? Buffer.from(input) : ArrayBuffer.isView(input) ? Buffer.from(input.buffer, input.byteOffset, input.byteLength) : null;
  if (!data || data.length < 100) return { ok: false, error: 'Dati audio non validi.' };
  const win = BrowserWindow.fromWebContents(event.sender);
  const name = safeName(options.name);
  let dest;
  if (!app.isPackaged && process.env.CIAK_TEST_SAVE_DIR) dest = path.join(process.env.CIAK_TEST_SAVE_DIR, `${name}.${spec.ext}`);
  else {
    const r = await dialog.showSaveDialog(win, { title: spec.title, defaultPath: path.join(app.getPath('music'), `${name}.${spec.ext}`), filters: [{ name: spec.label, extensions: [spec.ext] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    dest = r.filePath.toLowerCase().endsWith(`.${spec.ext}`) ? r.filePath : `${r.filePath}.${spec.ext}`;
  }
  const tmpIn = path.join(app.getPath('temp'), `ciak-in-${process.pid}-${Date.now()}.wav`);
  const tmpOut = `${dest}.part`;
  try {
    fs.writeFileSync(tmpIn, data);
    convertCancelled = false;
    const result = await new Promise((resolve) => {
      const proc = spawn(bin, ['-y', '-hide_banner', '-loglevel', 'error', '-i', tmpIn, ...spec.args, tmpOut], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      convertProc = proc;
      let err = '';
      proc.stderr.on('data', (c) => {
        err = (err + c).slice(-2000);
      });
      proc.on('error', (e) => resolve({ ok: false, error: `Impossibile avviare ffmpeg: ${e.message}` }));
      proc.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: convertCancelled ? 'Conversione annullata.' : `ffmpeg ha terminato con errore ${code}. ${err.trim().split('\n').slice(-2).join(' ')}` }));
    });
    if (!result.ok) return result;
    fs.renameSync(tmpOut, dest);
    savedFiles.add(dest);
    return { ok: true, path: dest, bytes: fs.statSync(dest).size };
  } catch (e) {
    return { ok: false, error: `Conversione non riuscita: ${e.message}` };
  } finally {
    convertProc = null;
    for (const f of [tmpIn, tmpOut]) fs.rm(f, { force: true }, () => {});
  }
});

// ---- comprimi o converti un video qualsiasi (strumento a parte, non serve un progetto) -----------------------
const TRANSCODE = {
  compress720: { label: 'compresso 720p', vf: 'scale=-2:min(720\\,ih)', crf: 28 },
  compress480: { label: 'compresso 480p', vf: 'scale=-2:min(480\\,ih)', crf: 30 },
  convert: { label: 'MP4', vf: null, crf: 20 },
};

ipcMain.handle('ciak:transcode-file', async (event, options = {}) => {
  assertOurs(event);
  const spec = TRANSCODE[options.preset];
  if (!spec) return { ok: false, error: 'Scelta non valida.' };
  const bin = ffmpegPath();
  if (!bin) return { ok: false, error: 'ffmpeg non è disponibile in questa installazione.' };
  if (convertProc) return { ok: false, error: 'Una conversione è già in corso.' };
  const win = BrowserWindow.fromWebContents(event.sender);
  let input;
  if (!app.isPackaged && process.env.CIAK_TEST_INPUT_FILE) input = process.env.CIAK_TEST_INPUT_FILE;
  else {
    const r = await dialog.showOpenDialog(win, { title: 'Scegli il video', properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', '3gp'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    input = r.filePaths[0];
  }
  const base = safeName(path.basename(input, path.extname(input)));
  let dest;
  if (!app.isPackaged && process.env.CIAK_TEST_SAVE_DIR) dest = path.join(process.env.CIAK_TEST_SAVE_DIR, `${base}-${spec.label.replace(/\s+/g, '-')}.mp4`);
  else {
    const r = await dialog.showSaveDialog(win, { title: 'Salva il video', defaultPath: path.join(path.dirname(input), `${base} (${spec.label}).mp4`), filters: [{ name: 'Video MP4', extensions: ['mp4'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    dest = r.filePath.toLowerCase().endsWith('.mp4') ? r.filePath : `${r.filePath}.mp4`;
  }
  if (path.resolve(dest) === path.resolve(input)) return { ok: false, error: 'Scegli un nome diverso da quello del file originale.' };
  const tmpOut = `${dest}.part`;
  const args = ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', ...(spec.vf ? ['-vf', spec.vf] : []), '-c:v', 'libx264', '-preset', 'medium', '-crf', String(spec.crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', tmpOut];
  convertCancelled = false;
  try {
    const result = await new Promise((resolve) => {
      const proc = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      convertProc = proc;
      let err = '';
      let total = 0;
      let buf = '';
      let last = 0;
      proc.stderr.on('data', (c) => {
        err = (err + c).slice(-4000);
        const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
        if (d && !total) total = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
      });
      proc.stdout.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
          if (!m || !total || Date.now() - last < 150) continue;
          last = Date.now();
          if (!event.sender.isDestroyed()) event.sender.send('ciak:convert-progress', Math.min(1, Number(m[1]) / 1e6 / total));
        }
      });
      proc.on('error', (e) => resolve({ ok: false, error: `Impossibile avviare ffmpeg: ${e.message}` }));
      proc.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: convertCancelled ? 'Conversione annullata.' : `ffmpeg ha terminato con errore ${code}. ${err.trim().split('\n').slice(-2).join(' ')}` }));
    });
    if (!result.ok) return result;
    fs.renameSync(tmpOut, dest);
    savedFiles.add(dest);
    return { ok: true, path: dest, bytesIn: fs.statSync(input).size, bytesOut: fs.statSync(dest).size };
  } catch (e) {
    return { ok: false, error: `Conversione non riuscita: ${e.message}` };
  } finally {
    convertProc = null;
    fs.rm(tmpOut, { force: true }, () => {});
  }
});

// ---- strumenti video con ffmpeg: al contrario, stabilizza, riduci disturbo, migliora, antisfarfallio, fluidifica, super rallentatore ----
// Sono algoritmi classici (non intelligenza artificiale). Il risultato torna all'editor come nuovo file: l'originale non cambia.
const VIDEO_TOOLS = {
  reverse: { label: 'Al contrario', vf: 'reverse', af: 'areverse', maxBytes: 600e6 },
  denoise: { label: 'Meno disturbo', vf: 'hqdn3d=4:3:6:4.5' },
  enhance: { label: 'Più nitido', vf: 'hqdn3d=2:1.5:3:3,unsharp=5:5:0.7:5:5:0.0,eq=contrast=1.06:saturation=1.08' },
  deflicker: { label: 'Senza sfarfallio', vf: 'deflicker=mode=pm:size=5' },
  upscale: { label: 'Ingrandito 2×', vf: 'scale=min(iw*2\\,3840):-2:flags=lanczos,unsharp=5:5:0.5' },
  smooth: { label: 'Più fluido', vf: 'minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1', maxBytes: 200e6 },
  slowmo: { label: 'Super rallentatore', vf: 'minterpolate=fps=120:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1', maxBytes: 100e6 },
  stabilize: { label: 'Stabilizzato', twoPass: true },
};

ipcMain.handle('ciak:video-tool', async (event, input, options = {}) => {
  assertOurs(event);
  const tool = VIDEO_TOOLS[options.tool];
  if (!tool) return { ok: false, error: 'Strumento sconosciuto.' };
  const bin = ffmpegPath();
  if (!bin) return { ok: false, error: 'ffmpeg non è disponibile in questa installazione.' };
  if (convertProc) return { ok: false, error: 'Una conversione è già in corso.' };
  const data = input instanceof ArrayBuffer ? Buffer.from(input) : ArrayBuffer.isView(input) ? Buffer.from(input.buffer, input.byteOffset, input.byteLength) : null;
  if (!data || data.length < 100) return { ok: false, error: 'Dati video non validi.' };
  if (data.length > (tool.maxBytes ?? 1.5e9)) return { ok: false, error: `Questo strumento lavora su file fino a ${Math.round((tool.maxBytes ?? 1.5e9) / 1e6)} MB: il tuo video è troppo grande. Accorcialo prima (taglia il pezzo che ti serve).` };
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'ciak-vt-'));
  const tmpIn = path.join(dir, 'in.media');
  const tmpOut = path.join(dir, 'out.mp4');
  const duration = Number(options.duration) > 0 ? Number(options.duration) : 0;
  const run = (args, onProgress) => new Promise((resolve) => {
    const proc = spawn(bin, args, { cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    convertProc = proc;
    let err = '';
    let buf = '';
    let last = 0;
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (!m || !duration || Date.now() - last < 150) continue;
        last = Date.now();
        onProgress?.(Math.min(1, Number(m[1]) / 1e6 / duration));
      }
    });
    proc.stderr.on('data', (c) => { err = (err + c).slice(-2000); });
    proc.on('error', (e) => resolve({ ok: false, error: `Impossibile avviare ffmpeg: ${e.message}` }));
    proc.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: convertCancelled ? 'Operazione annullata.' : `ffmpeg ha terminato con errore ${code}. ${err.trim().split('\n').slice(-2).join(' ')}` }));
  });
  const send = (v) => { if (!event.sender.isDestroyed()) event.sender.send('ciak:convert-progress', v); };
  convertCancelled = false;
  try {
    fs.writeFileSync(tmpIn, data);
    const base = ['-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1'];
    let vf = tool.vf;
    if (tool.twoPass) {
      // 1° passaggio: misura i tremolii; 2° passaggio: li corregge (con un leggero ingrandimento per nascondere i bordi)
      const a = await run([...base, '-i', tmpIn, '-vf', 'vidstabdetect=shakiness=6:accuracy=15:result=transforms.trf', '-f', 'null', '-'], (v) => send(v * 0.45));
      if (!a.ok) return a;
      vf = 'vidstabtransform=input=transforms.trf:zoom=2:smoothing=20:optzoom=1,unsharp=5:5:0.6:5:5:0.0';
    }
    const pass = tool.twoPass ? (v) => send(0.45 + v * 0.55) : send;
    const args = [...base, '-i', tmpIn, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, ...(tool.af ? ['-af', tool.af] : []), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', tmpOut];
    const r = await run(args, pass);
    if (!r.ok) return r;
    const out = fs.readFileSync(tmpOut);
    return { ok: true, video: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) };
  } catch (e) {
    return { ok: false, error: `Elaborazione non riuscita: ${e.message}` };
  } finally {
    convertProc = null;
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
});

// ---- voce da testo (sintetizzatore del sistema) -------------------------------------------------------------
ipcMain.handle('ciak:tts-voices', async (event) => {
  assertOurs(event);
  return tts.listVoices();
});

ipcMain.handle('ciak:tts', async (event, text, options = {}) => {
  assertOurs(event);
  try {
    const wav = await tts.synthesize(String(text ?? ''), { voice: typeof options.voice === 'string' ? options.voice : undefined, rate: Number(options.rate) || 1 });
    return { ok: true, wav: wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---- riconoscimento vocale (sottotitoli automatici) ------------------------------------------------------------
// Whisper locale (desktop/asr.cjs). I modelli si scaricano la prima volta (serve internet) e restano in %APPDATA%/…/modelli.
// Per le prove: CIAK_ASR_MODELS = cartella con i modelli già pronti, e niente rete (ignorata nel programma impacchettato).
let asrEngine = null;
function asr() {
  if (!asrEngine) {
    const testModels = !app.isPackaged && process.env.CIAK_ASR_MODELS ? process.env.CIAK_ASR_MODELS : null;
    const bundled = path.join(process.resourcesPath || '', 'models');
    asrEngine = createAsr({
      cacheDir: path.join(app.getPath('userData'), 'modelli'),
      localModelsDir: testModels ?? (fs.existsSync(bundled) ? bundled : null),
      allowRemote: !testModels,
    });
  }
  return asrEngine;
}

ipcMain.handle('ciak:asr-available', async (event) => {
  assertOurs(event);
  const a = asr();
  const r = await a.available();
  return { ...r, models: Object.fromEntries(Object.entries(a.models).map(([k, v]) => [k, { label: v.label, mb: v.mb }])), languages: a.languages };
});

ipcMain.handle('ciak:asr-transcribe', async (event, samples, options = {}) => {
  assertOurs(event);
  try {
    if (!(samples instanceof Float32Array) && !(samples instanceof ArrayBuffer)) throw new Error('Audio non valido.');
    const input = samples instanceof ArrayBuffer ? new Float32Array(samples) : samples;
    const sender = event.sender;
    const r = await asr().transcribe(input, {
      language: typeof options.language === 'string' ? options.language : 'it',
      model: typeof options.model === 'string' ? options.model : 'tiny',
      task: options.task === 'translate' ? 'translate' : 'transcribe',
      onProgress: (p) => !sender.isDestroyed() && sender.send('ciak:asr-progress', p),
    });
    return { ok: true, text: r.text, words: r.words };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---- finestra ----------------------------------------------------------------------------------------------
function createWindow() {
  const st = loadState();
  const win = new BrowserWindow({
    width: st.width ?? 1440,
    height: st.height ?? 900,
    x: st.x,
    y: st.y,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'Ciak Studio',
    backgroundColor: '#0e1014',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.cjs'), // ponte minimo: solo conversione in MP4
      autoplayPolicy: 'no-user-gesture-required', // l'audio parte con il pulsante Play senza blocchi
      backgroundThrottling: false, // l'esportazione non rallenta se la finestra è coperta o ridotta a icona
    },
  });
  mainWindow = win;
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  lockNavigation(win.webContents);

  // F11 = schermo intero della finestra (senza menu non esiste una scorciatoia di sistema)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (!app.isPackaged && input.key === 'F12') win.webContents.toggleDevTools();
  });

  // chiudere durante un'esportazione la interromperebbe: chiedi conferma
  let closing = false;
  win.on('close', async (event) => {
    saveState(win);
    if (closing) return;
    let exporting = false;
    try {
      exporting = await win.webContents.executeJavaScript('Boolean(window.__ciak && window.__ciak.exporter && window.__ciak.exporter.running)');
    } catch {
      /* pagina non raggiungibile: si chiude */
    }
    if (!exporting) return;
    event.preventDefault();
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Continua l’esportazione', 'Chiudi comunque'],
      defaultId: 0,
      cancelId: 0,
      title: 'Esportazione in corso',
      message: 'Se chiudi ora l’esportazione verrà interrotta.',
      detail: 'Il progetto è salvato automaticamente; il video in corso di esportazione andrebbe perso.',
    });
    if (response === 1) {
      closing = true;
      win.close();
    }
  });
  win.on('closed', () => {
    mainWindow = null;
  });

  // se il processo di rendering si chiude in modo anomalo il progetto (salvato in automatico) si recupera ricaricando
  win.webContents.on('render-process-gone', async (_e, details) => {
    if (details.reason === 'clean-exit') return;
    const { response } = await dialog.showMessageBox(win, {
      type: 'error',
      buttons: ['Riapri', 'Esci'],
      defaultId: 0,
      title: 'Ciak Studio',
      message: 'L’editor si è chiuso in modo imprevisto.',
      detail: 'Il tuo progetto è salvato automaticamente e verrà ripristinato alla riapertura.',
    });
    if (response === 0) win.loadFile(APP_FILE);
    else app.quit();
  });

  win.loadFile(APP_FILE);
  return win;
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (!fs.existsSync(APP_FILE)) {
    dialog.showErrorBox('Ciak Studio', `File dell'editor non trovato:\n${APP_FILE}\n\nEsegui «npm run build» prima di avviare la versione desktop.`);
    app.quit();
    return;
  }
  Menu.setApplicationMenu(null); // nessuna barra dei menu: le scorciatoie le gestisce l'editor
  protocol.handle('ciak-asset', serveAsset);
  hardenSession(session.defaultSession);
  installDisplayHandler(session.defaultSession);
  app.on('web-contents-created', (_e, contents) => lockNavigation(contents));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
