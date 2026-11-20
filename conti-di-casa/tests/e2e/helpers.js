import { chromium } from 'playwright';
import { createServer } from '../../tools/serve.js';
import { demoState } from './demo-state.js';

export const TODAY = '2026-11-20';
export const NOW = new Date('2026-11-20T10:30:00+01:00');

export async function startServer() {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}/` };
}

/** Apre un telefono virtuale (390×844) con la data fissata al 20 novembre 2026. `seed`: stato da mettere nel database prima di aprire l'app. */
export async function openApp(browser, base, { seed = null, viewport = { width: 390, height: 844 }, colorScheme = 'light', now = NOW, init = null } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'it-IT', timezoneId: 'Europe/Rome', colorScheme, acceptDownloads: true, serviceWorkers: 'block' });
  await context.grantPermissions([]);
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  await page.clock.setFixedTime(now);
  const problems = [];
  page.on('pageerror', (e) => problems.push(`errore: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  if (seed) {
    await page.goto(`${base}icons/icon-192.png`);
    await page.evaluate((state) => new Promise((resolve, reject) => {
      const req = indexedDB.open('conti-di-casa', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => {
        const tx = req.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(state, 'stato');
        tx.oncomplete = () => { req.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    }), seed);
  }
  await page.goto(base);
  return { context, page, problems };
}

export { chromium, demoState };
