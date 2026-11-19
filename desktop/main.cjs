'use strict';
// Guscio desktop di Ciak Studio: mostra l'editor (dist/ciak-studio.html) in una finestra nativa.
// La pagina NON ha accesso a Node: contextIsolation e sandbox attivi, nessun preload.

const { app, BrowserWindow, Menu, dialog, ipcMain, screen, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_FILE = path.join(__dirname, '..', 'dist', 'ciak-studio.html');
const APP_URL = pathToFileURL(APP_FILE).href;
const ICON = path.join(__dirname, 'build', 'icon.png');

app.setAppUserModelId('app.ciakstudio.editor'); // raggruppa correttamente l'icona nella barra delle applicazioni

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
  const allowed = new Set(['media', 'fullscreen']);
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => callback(allowed.has(permission) && ours(details.requestingUrl)));
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => allowed.has(permission) && (ours(details?.requestingUrl) || requestingOrigin === 'file://'));
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
  const container = options.container === 'mov' ? 'mov' : 'mp4'; // MOV: stessa codifica H.264/AAC, contenitore QuickTime
  const fps = Math.min(120, Math.max(1, Math.round(Number(options.fps) || 30)));
  const duration = Number(options.duration) > 0 ? Number(options.duration) : 0;
  const crf = CRF[options.quality] ?? CRF.medium;

  // destinazione: scelta dall'utente (nei test automatici una cartella indicata da CIAK_TEST_SAVE_DIR)
  let dest;
  if (!app.isPackaged && process.env.CIAK_TEST_SAVE_DIR) dest = path.join(process.env.CIAK_TEST_SAVE_DIR, `${name}.${container}`);
  else {
    const r = await dialog.showSaveDialog(win, {
      title: container === 'mov' ? 'Salva il video MOV' : 'Salva il video MP4',
      defaultPath: path.join(app.getPath('videos'), `${name}.${container}`),
      filters: [{ name: container === 'mov' ? 'Video MOV' : 'Video MP4', extensions: [container] }],
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
      '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', // l'indice all'inizio: il video parte subito anche online
      '-f', container, tmpOut,
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
  hardenSession(session.defaultSession);
  app.on('web-contents-created', (_e, contents) => lockNavigation(contents));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
