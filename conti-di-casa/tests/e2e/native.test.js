// Il «ponte» con Android, simulato: la pagina parla con un finto `ContiNativo` che risponde come farà la classe Java.
// (Verifica la parte JavaScript del ponte; la parte Java non si può provare qui senza un telefono o un emulatore.)
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, demoState, openApp, startServer } from './helpers.js';

const FAKE = `
  window.__log = [];
  window.ContiNativo = {
    canUnlock: () => !window.__noLock,
    unlock(id) { window.__log.push(['unlock']); setTimeout(() => window.__nativeResult(id, !window.__deny, window.__deny ? 'Operazione annullata.' : 'ok'), 20); },
    saveFile(id, name, mime, text) { window.__log.push(['save', name, mime]); window.__saved = { name, mime, text }; setTimeout(() => window.__nativeResult(id, true, 'ok'), 20); },
    shareText(id, title, text) { window.__log.push(['share', title, text]); setTimeout(() => window.__nativeResult(id, true, 'ok'), 20); },
    setSecure(on) { window.__log.push(['secure', on]); },
  };
`;

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

async function withNative(fn, extra = {}) {
  const app = await openApp(browser, base, { seed: demoState(), init: FAKE, ...extra });
  try {
    await fn(app);
    assert.deepEqual(app.problems, [], 'errori nella pagina');
  } finally {
    await app.context.close();
  }
}
const hideShow = (page) => page.evaluate(() => {
  const set = (v) => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); };
  set('hidden');
  set('visible');
});

test('copia di sicurezza nell’app: passa dal ponte e salva un JSON valido (niente download del browser)', async () => {
  await withNative(async ({ page }) => {
    await page.waitForSelector('.home');
    await page.evaluate(() => { location.hash = '#/dati'; });
    await page.click('text=Salva una copia');
    await page.waitForSelector('.toast:has-text("Copia salvata")');
    const saved = await page.evaluate(() => window.__saved);
    assert.equal(saved.name, 'conti-di-casa-2026-11-20.json');
    assert.equal(saved.mime, 'application/json');
    const data = JSON.parse(saved.text);
    assert.equal(data.app, 'conti-di-casa');
    assert.ok(data.dati.movimenti.length > 50);
  });
});

test('esportare CSV e condividere il riepilogo nell’app', async () => {
  await withNative(async ({ page }) => {
    await page.evaluate(() => { location.hash = '#/dati'; });
    await page.click('text=Esporta tutti i movimenti');
    await page.waitForSelector('.toast:has-text("Esportati")');
    const csv = await page.evaluate(() => window.__saved);
    assert.equal(csv.mime, 'text/csv');
    assert.ok(csv.text.startsWith('\uFEFFData;Tipo;Importo'));
    await page.click('text=Manda il riepilogo');
    await page.waitForFunction(() => window.__log.some((x) => x[0] === 'share'));
    const share = await page.evaluate(() => window.__log.find((x) => x[0] === 'share'));
    assert.match(share[2], /Famiglia Rossi/);
    assert.match(share[2], /Entrate:/);
  });
});

test('blocco del telefono: si attiva dopo una prova riuscita, poi all’apertura sblocca il telefono', async () => {
  await withNative(async ({ page }) => {
    await page.evaluate(() => { location.hash = '#/impostazioni'; });
    await page.locator('.switch-row', { hasText: 'Sblocca con il blocco del telefono' }).click();
    await page.waitForSelector('.toast:has-text("Blocco del telefono attivato")');
    assert.ok(await page.evaluate(() => window.__log.some((x) => x[0] === 'unlock')), 'ha chiesto davvero lo sblocco prima di attivarlo');
    assert.ok(await page.evaluate(() => window.__log.some((x) => x[0] === 'secure' && x[1] === true)), 'schermate nascoste nelle app recenti');
    await page.waitForTimeout(300);
    await page.reload();
    // all'apertura chiede lo sblocco da solo e, riuscito, entra
    await page.waitForSelector('.tabbar');
    assert.ok(await page.evaluate(() => window.__log.filter((x) => x[0] === 'unlock').length) >= 1);
  });
});

test('blocco del telefono: se lo sblocco viene annullato l’app resta chiusa e si può riprovare', async () => {
  const seed = demoState();
  seed.impostazioni.bloccoTelefono = true;
  await withNative(async ({ page }) => {
    await page.waitForSelector('.lock');
    await page.waitForTimeout(600);
    assert.equal(await page.locator('.tabbar').count(), 0, 'senza sblocco non si entra');
    assert.equal(await page.locator('.toast.error').count(), 0, 'annullare non è un errore da mostrare');
    await page.evaluate(() => { window.__deny = false; });
    await page.click('text=Sblocca con il telefono');
    await page.waitForSelector('.tabbar');
  }, { seed, init: `${FAKE}\nwindow.__deny = true;` });
});

test('PIN e blocco del telefono insieme: la schermata offre tutti e due', async () => {
  const seed = demoState();
  seed.impostazioni.bloccoTelefono = true;
  seed.impostazioni.pinSalt = '00112233445566778899aabbccddeeff';
  seed.impostazioni.pinHash = '0'.repeat(64);
  await withNative(async ({ page }) => {
    await page.waitForSelector('.lock');
    assert.ok(await page.locator('.keypad').count());
    assert.ok(await page.locator('text=Sblocca con il telefono').count());
  }, { seed });
});

test('dopo aver usato il ponte (salvataggio file) l’app non si blocca da sola al ritorno, ma poi sì', async () => {
  await withNative(async ({ page }) => {
    await page.evaluate(() => { location.hash = '#/impostazioni'; });
    await page.locator('.switch-row', { hasText: 'Sblocca con il blocco del telefono' }).click();
    await page.waitForSelector('.toast:has-text("Blocco del telefono attivato")');
    await page.locator('select[aria-label="Blocca dopo"]').selectOption('0');
    await page.evaluate(() => { location.hash = '#/dati'; });
    await page.click('text=Salva una copia');
    await page.waitForSelector('.toast:has-text("Copia salvata")');
    await hideShow(page); // si torna dal selettore di cartelle di Android
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.lock').count(), 0, 'non si blocca al ritorno dal selettore');
    await hideShow(page); // uscita e rientro veri
    await page.waitForSelector('.lock');
  });
});

test('telefono senza blocco schermo: l’impostazione spiega cosa fare', async () => {
  await withNative(async ({ page }) => {
    await page.evaluate(() => { location.hash = '#/impostazioni'; });
    await page.waitForSelector('text=attivane uno nelle impostazioni di Android');
    assert.equal(await page.locator('.switch-row:has-text("Sblocca con il blocco del telefono")').count(), 0);
  }, { init: `${FAKE}\nwindow.__noLock = true;` });
});

test('senza ponte (browser) il blocco del telefono non compare', async () => {
  const app = await openApp(browser, base, { seed: demoState() });
  try {
    await app.page.evaluate(() => { location.hash = '#/impostazioni'; });
    await app.page.waitForSelector('.card:has-text("Sicurezza")');
    assert.equal(await app.page.locator('text=blocco del telefono').count(), 0);
    assert.deepEqual(app.problems, []);
  } finally {
    await app.context.close();
  }
});
