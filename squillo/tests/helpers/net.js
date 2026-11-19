// Utilità per le prove: un centralino locale, due partecipanti con camera/microfono finti e uno schermo finto.
import { chromium } from 'playwright';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../tools/serve.js';

/** Avvia il vero centralino (server/centralino.js) in un processo a parte: si prova anche lo script che si metterà online. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function startCentralino() {
  const port = await new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port: p } = probe.address();
      probe.close(() => resolve(p));
    });
  });
  const proc = spawn(process.execPath, [path.join(ROOT, 'server/centralino.js')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise((r) => proc.once('exit', r));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break;
    } catch {
      /* ancora in avvio */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.stdout.resume();
  return {
    port,
    close: async () => {
      proc.kill('SIGTERM');
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    },
  };
}

export async function launch({ headless = true, args = [], viewport = { width: 1280, height: 800 } } = {}) {
  const centralino = await startCentralino();
  const web = createServer();
  await new Promise((r) => web.listen(0, r));
  const url = `http://localhost:${web.address().port}/`;
  const browser = await chromium.launch({
    headless,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', ...args],
  });
  const people = [];

  /** Apre un partecipante con il suo codice, già collegato al centralino di prova. */
  async function person(code, { name = '', prefs = {}, display = true, perms = ['camera', 'microphone'] } = {}) {
    const context = await browser.newContext({ viewport, permissions: perms, colorScheme: 'dark', acceptDownloads: true });
    const settings = { code, name, server: { host: '127.0.0.1', port: centralino.port, path: '/', secure: false, key: 'peerjs' }, ice: JSON.stringify([{ urls: 'stun:127.0.0.1:3478' }]), ...prefs };
    await context.addInitScript(([s]) => {
      try {
        if (!localStorage.getItem('squillo:v1')) localStorage.setItem('squillo:v1', JSON.stringify(s));
      } catch {}
    }, [settings]);
    if (display) await context.addInitScript(fakeScreenScript);
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(url);
    await page.waitForFunction(() => window.__squillo);
    const p = { page, context, errors, code, name };
    people.push(p);
    return p;
  }

  return {
    url,
    centralino,
    person,
    browser,
    /** Chiude tutti i partecipanti aperti (da usare dopo ogni prova, anche se fallisce). */
    async closeAll() {
      await Promise.all(people.splice(0).map((p) => p.context.close().catch(() => {})));
      await new Promise((r) => setTimeout(r, 300)); // il centralino libera i codici
    },
    async close() {
      await browser.close();
      web.close();
      await centralino.close();
    },
  };
}

/** Sostituisce getDisplayMedia con uno schermo finto che si muove (canvas), per provare senza finestre vere. */
export const fakeScreenScript = () => {
  navigator.mediaDevices.getDisplayMedia = async (opts) => {
    window.__displayRequest = opts;
    const c = document.createElement('canvas');
    c.width = 1920;
    c.height = 1080;
    const g = c.getContext('2d');
    let n = 0;
    const draw = () => {
      g.fillStyle = '#f4f4f4';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#222';
      g.font = '48px monospace';
      for (let i = 0; i < 12; i++) g.fillText(`riga ${i} del documento condiviso — prova di testo nitido`, 60, 100 + i * 70);
      g.fillStyle = '#d33';
      g.fillRect((n * 12) % (c.width - 200), 900, 200, 120);
      n++;
    };
    draw();
    const timer = setInterval(draw, 33);
    const stream = c.captureStream(30);
    const track = stream.getVideoTracks()[0];
    const stop = track.stop.bind(track);
    track.stop = () => {
      clearInterval(timer);
      stop();
    };
    return stream;
  };
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
