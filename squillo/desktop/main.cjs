'use strict';
// Guscio desktop di Squillo: mostra l'app (dist/index.html) in una finestra nativa.
// La pagina NON ha accesso a Node (sandbox + contextIsolation). Ha solo il ponte di preload.cjs.

const { app, BrowserWindow, Menu, desktopCapturer, ipcMain, powerSaveBlocker, screen, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_FILE = path.join(__dirname, '..', 'dist', 'index.html');
const APP_URL = pathToFileURL(APP_FILE).href;
const ICON = path.join(__dirname, 'build', 'icon.png');

app.setAppUserModelId('app.squillo.chiamate');

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
    if (![s.width, s.height].every((v) => Number.isFinite(v) && v >= 360)) return {};
    const visible =
      Number.isFinite(s.x) &&
      Number.isFinite(s.y) &&
      screen.getAllDisplays().some((d) => {
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
const ours = (url) => typeof url === 'string' && url.startsWith('file://') && url.split('#')[0].split('?')[0] === APP_URL;

function hardenSession(ses) {
  // microfono/camera, schermo, notifiche e schermo intero: solo per la nostra pagina
  const allowed = new Set(['media', 'display-capture', 'notifications', 'fullscreen']);
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => callback(allowed.has(permission) && ours(details.requestingUrl)));
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => allowed.has(permission) && (ours(details?.requestingUrl) || requestingOrigin === 'file://'));
}

function lockNavigation(contents) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] !== APP_URL) event.preventDefault();
  });
  contents.setVisualZoomLevelLimits(1, 1).catch(() => {});
}

function assertOurs(event) {
  const url = event.senderFrame?.url ?? event.sender?.getURL?.() ?? '';
  if (!ours(url)) throw new Error('Mittente non autorizzato');
}

// ---- condivisione dello schermo ---------------------------------------------------------------------------
// La pagina chiede l'elenco di schermi e finestre (con anteprima), l'utente sceglie, e solo allora
// getDisplayMedia ottiene esattamente quella sorgente. Senza una scelta recente la richiesta è rifiutata.
const sources = new Map();
let pick = null;

ipcMain.handle('squillo:list-sources', async (event) => {
  assertOurs(event);
  const own = mainWindow?.getMediaSourceId?.();
  // schermi e finestre si chiedono separatamente: se un tipo non è disponibile (per esempio senza gestore di finestre) l'altro funziona lo stesso
  const ask = (type) => desktopCapturer.getSources({ types: [type], thumbnailSize: { width: 360, height: 225 }, fetchWindowIcons: false }).catch(() => []);
  const list = [...(await ask('screen')), ...(await ask('window'))];
  sources.clear();
  const out = [];
  for (const s of list) {
    if (s.id === own) continue; // la finestra di Squillo stessa: condividerla farebbe un tunnel infinito
    if (!s.name && s.id.startsWith('window')) continue;
    sources.set(s.id, s);
    out.push({ id: s.id, name: s.name || 'Schermo', kind: s.id.startsWith('screen') ? 'screen' : 'window', thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL() });
  }
  // schermi per primi, poi le finestre
  out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'screen' ? -1 : 1));
  return out;
});

ipcMain.handle('squillo:choose-source', (event, id, audio) => {
  assertOurs(event);
  if (!sources.has(id)) return false;
  pick = { id, audio: Boolean(audio), at: Date.now() };
  return true;
});

function installDisplayHandler(ses) {
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      const p = pick;
      pick = null;
      const src = p && Date.now() - p.at < 30_000 && ours(request.frame?.url) ? sources.get(p.id) : null;
      if (!src) return callback({});
      const streams = { video: src };
      // l'audio del computer si può catturare solo su Windows (loopback)
      if (p.audio && process.platform === 'win32') streams.audio = 'loopback';
      return callback(streams);
    },
    { useSystemPicker: false },
  );
}

// ---- varie -----------------------------------------------------------------------------------------------
ipcMain.on('squillo:alert', (event) => {
  try {
    assertOurs(event);
  } catch {
    return;
  }
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.flashFrame(true);
  setTimeout(() => mainWindow && !mainWindow.isDestroyed() && mainWindow.flashFrame(false), 8000);
});

let awake = null;
ipcMain.on('squillo:keep-awake', (event, on) => {
  try {
    assertOurs(event);
  } catch {
    return;
  }
  if (on && awake === null) awake = powerSaveBlocker.start('prevent-display-sleep');
  else if (!on && awake !== null) {
    powerSaveBlocker.stop(awake);
    awake = null;
  }
});

function createWindow() {
  const st = loadState();
  mainWindow = new BrowserWindow({
    width: st.width ?? 1100,
    height: st.height ?? 720,
    x: st.x,
    y: st.y,
    minWidth: 360,
    minHeight: 520,
    show: false,
    backgroundColor: '#0b0e17',
    title: 'Squillo',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.cjs'),
      spellcheck: false,
      backgroundThrottling: false, // una chiamata non deve rallentare se la finestra è dietro un'altra
    },
  });
  if (st.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  lockNavigation(mainWindow.webContents);
  for (const ev of ['resize', 'move']) mainWindow.on(ev, () => saveState(mainWindow));
  mainWindow.on('close', () => saveState(mainWindow));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.loadURL(APP_URL);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
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
