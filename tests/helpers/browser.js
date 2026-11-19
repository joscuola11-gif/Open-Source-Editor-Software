// Avvia server + Chromium e restituisce una pagina con raccolta degli errori.
import { chromium } from 'playwright';
import { createServer } from '../../tools/serve.js';

export async function launch({ viewport = { width: 1440, height: 860 }, args = [] } = {}) {
  const server = createServer();
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', ...args],
  });
  const open = async (opts = {}) => {
    const context = opts.context ?? (await browser.newContext({ viewport, acceptDownloads: true, deviceScaleFactor: 1, colorScheme: 'dark' }));
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    // ERR_ABORTED = richiesta annullata di proposito (es. elemento <video> rilasciato): non è un errore
    page.on('requestfailed', (r) => {
      const why = r.failure()?.errorText ?? '';
      if (!/ERR_ABORTED/.test(why)) errors.push(`requestfailed: ${r.url()} ${why}`);
    });
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(() => window.__ciak && document.querySelector('.timeline'));
    await page.waitForFunction(() => window.__ciak.storage.available !== undefined);
    return { page, context, errors, url: `http://localhost:${port}/` };
  };
  const close = async () => {
    await browser.close();
    server.close();
  };
  return { open, close, browser, port };
}

/** Importa i file nella libreria e attende che compaiano le schede. */
export async function importFiles(page, files) {
  const before = await page.locator('.media-card').count();
  await page.setInputFiles('#file-input', files);
  await page.waitForFunction((n) => document.querySelectorAll('.media-card').length >= n, before + files.length, { timeout: 20000 });
  // attende le miniature/forme d'onda in background
  await page.waitForTimeout(400);
}

export const project = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__ciak.store.project)));
export const clips = (page) => page.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips.map((c) => ({ ...JSON.parse(JSON.stringify(c)), track: t.id }))));

/** Valore RGBA di un pixel dell'anteprima, dopo aver atteso il ridisegno. */
export async function pixel(page, fx = 0.5, fy = 0.5) {
  await page.evaluate(() => window.__ciak.player.settle());
  return page.evaluate(([x, y]) => {
    const c = window.__ciak.preview.canvas;
    const g = c.getContext('2d');
    const d = g.getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }, [fx, fy]);
}

export async function seek(page, t) {
  await page.evaluate((t) => window.__ciak.player.seek(t), t);
  await page.evaluate(() => window.__ciak.player.settle());
}

export const openTab = async (page, id) => {
  await page.click(`#tab-${id}`);
};
export const inspectorTab = async (page, label) => {
  await page.locator('.insp-tabs .tab', { hasText: label }).click();
};
/** Imposta il valore numerico di uno slider dell'inspector (per etichetta) come farebbe l'utente. */
export async function setNum(page, label, value) {
  const num = page.locator('.ctl.slider', { has: page.locator('.ctl-label', { hasText: new RegExp(`^${label}$`) }) }).locator('input.num');
  await num.fill(String(value));
  await num.press('Enter');
}
export async function addMedia(page, n) {
  const card = page.locator('.media-card').nth(n);
  await card.hover();
  await card.locator('.add').click();
}
export const selectClipByIndex = (page, i) => page.locator('.clip').nth(i).click();
export const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Attende (con retry) che il testo di un elemento corrisponda a una regex. */
export async function waitText(page, selector, regex, timeout = 5000) {
  await page.waitForFunction(([sel, src, flags]) => {
    const el = document.querySelector(sel);
    return !!el && new RegExp(src, flags).test(el.textContent ?? '');
  }, [selector, regex.source, regex.flags], { timeout });
}
