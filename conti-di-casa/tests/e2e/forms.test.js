// I moduli meno usati: conti, familiari, scadenze, impostazioni.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, demoState, openApp, startServer } from './helpers.js';

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
async function withApp(opts, fn) {
  const app = await openApp(browser, base, { seed: demoState(), ...opts });
  try {
    await fn(app);
    assert.deepEqual(app.problems, [], 'errori nella pagina');
  } finally {
    await app.context.close();
  }
}
const text = async (page, sel) => (await page.locator(sel).first().innerText()).replace(/ /g, ' ');
const go = (page, r) => page.evaluate((r) => { location.hash = `#/${r}`; }, r);

test('nuovo conto con saldo di partenza, poi un movimento su quel conto', async () => {
  await withApp({}, async ({ page }) => {
    await go(page, 'conti');
    await page.click('text=＋ Nuovo');
    await page.fill('input[aria-label="Nome del conto"]', 'Carta Maria');
    await page.locator('.sheet .chip', { hasText: 'Carta prepagata' }).click();
    await page.fill('input[aria-label="Saldo di partenza"]', '250,50');
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.row:has-text("Carta Maria")');
    assert.match(await text(page, '.row:has-text("Carta Maria")'), /250,50/);
    // lo stesso nome due volte non si può
    await page.click('text=＋ Nuovo');
    await page.fill('input[aria-label="Nome del conto"]', 'carta maria');
    await page.click('.sheet-foot .btn.primary');
    assert.match(await text(page, '.toast.error'), /Esiste già un conto/);
    await page.click('.sheet-head .icon-btn');
    // si apre il conto e si aggiunge una spesa
    await page.locator('.row', { hasText: 'Carta Maria' }).click();
    await page.click('text=＋ Movimento');
    await page.fill('.amount-input', '50');
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.sheet', { state: 'detached' });
    assert.match(await text(page, '.hero-amount'), /200,50/);
  });
});

test('un conto con movimenti non si elimina: si archivia', async () => {
  await withApp({}, async ({ page }) => {
    await go(page, 'conti');
    await page.locator('.row', { hasText: 'Contanti' }).click();
    await page.click('.page-head .icon-btn[aria-label="Modifica il conto"]');
    await page.click('text=Elimina');
    await page.click('.sheet.dialog .btn.danger');
    await page.waitForSelector('.sheet.dialog:has-text("Non si può eliminare")');
    await page.click('.sheet.dialog .btn.primary');
    await page.waitForSelector('.page-head:has-text("Conti")');
    assert.equal(await page.locator('.row:has-text("Contanti")').count(), 1);
    assert.match(await text(page, '.screen'), /Archiviati/);
  });
});

test('nuovo familiare: compare nelle scelte; chi compare nei movimenti si nasconde, non si cancella', async () => {
  await withApp({}, async ({ page }) => {
    await go(page, 'famiglia');
    await page.click('text=＋ Aggiungi');
    await page.fill('input[aria-label="Nome"]', 'Nonna Rosa');
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.row:has-text("Nonna Rosa")');
    await page.click('.fab');
    assert.ok(await page.locator('.tx-form .chip', { hasText: 'Nonna Rosa' }).count());
    await page.click('.sheet-head .icon-btn');
    await go(page, 'famiglia');
    await page.locator('.list .row', { hasText: 'Maria' }).first().click();
    await page.click('text=Elimina');
    await page.click('.sheet.dialog .btn.danger');
    assert.match(await text(page, '.toast.error'), /nasconderlo invece di cancellarlo/);
  });
});

test('nuova scadenza mensile: compare, si paga, la successiva si sposta di un mese', async () => {
  await withApp({}, async ({ page }) => {
    await go(page, 'ricorrenti');
    await page.click('text=＋ Nuova');
    await page.fill('input[aria-label="Nome"]', 'Condominio');
    await page.fill('.sheet .amount-input', '120');
    await page.locator('.sheet .chip', { hasText: 'Casa' }).first().click();
    await page.fill('input[aria-label="Prima scadenza"]', '2026-11-20');
    await page.click('.sheet-foot .btn.primary');
    const due = page.locator('.due-row', { hasText: 'Condominio' });
    await due.waitFor();
    assert.match(await due.innerText(), /Oggi/);
    assert.equal(await page.locator('.due-row', { hasText: 'Condominio' }).count(), 1, 'una sola riga finché non è pagata');
    await due.locator('.btn.primary').click();
    await page.waitForSelector('.toast:has-text("Pagamento registrato")');
    const next = page.locator('.due-row', { hasText: 'Condominio' });
    await next.waitFor();
    assert.match(await next.innerText(), /20 dicembre|domenica 20 dicembre|dicembre/i);
    // si può anche saltare
    await next.locator('.btn', { hasText: 'Salta' }).click();
    await page.waitForSelector('.toast:has-text("saltata")');
  });
});

test('scadenza che non finisce prima di cominciare: i dati strani vengono respinti', async () => {
  await withApp({}, async ({ page }) => {
    await go(page, 'ricorrenti');
    await page.click('text=＋ Nuova');
    await page.fill('input[aria-label="Nome"]', 'Prova');
    await page.fill('.sheet .amount-input', '10');
    await page.locator('.sheet .chip', { hasText: 'Casa' }).first().click();
    await page.fill('input[aria-label="Prima scadenza"]', '2026-11-20');
    await page.fill('input[aria-label="Ultima scadenza"]', '2026-01-01');
    await page.click('.sheet-foot .btn.primary');
    assert.match(await text(page, '.toast.error'), /dopo la prima/);
    await page.fill('.sheet .amount-input', 'abc');
    await page.click('.sheet-foot .btn.primary');
    assert.match(await text(page, '.toast.error'), /importo valido/);
  });
});

test('impostazioni: il mese può cominciare il 27, il tema cambia, la valuta cambia gli importi', async () => {
  await withApp({}, async ({ page }) => {
    await go(page, 'impostazioni');
    await page.locator('select[aria-label="Giorno di inizio del mese"]').selectOption('27');
    await go(page, 'home');
    assert.match(await text(page, '.period-label'), /\(27 ott – 26 nov\)/);
    await go(page, 'impostazioni');
    await page.locator('.segmented .seg', { hasText: 'Scuro' }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await page.locator('select[aria-label="Valuta"]').selectOption('USD');
    await go(page, 'home');
    assert.match(await text(page, '.hero-amount'), /\$/);
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForSelector('.home');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'il tema resta dopo la riapertura');
  });
});

test('PIN: cambiarlo e toglierlo chiedono quello attuale', async () => {
  await withApp({}, async ({ page }) => {
    await go(page, 'impostazioni');
    await page.click('text=Attiva il PIN');
    let inputs = page.locator('.sheet input[type=password]');
    await inputs.nth(0).fill('1357');
    await inputs.nth(1).fill('1357');
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.toast:has-text("PIN attivato")');
    await page.click('text=Cambia PIN');
    inputs = page.locator('.sheet input[type=password]');
    await inputs.nth(0).fill('9999');
    await inputs.nth(1).fill('2468');
    await inputs.nth(2).fill('2468');
    await page.click('.sheet-foot .btn.primary');
    assert.match(await text(page, '.toast.error'), /PIN attuale non è giusto/);
    await inputs.nth(0).fill('1357');
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.toast:has-text("PIN cambiato")');
    await page.click('text=Togli PIN');
    await page.fill('.sheet input[type=password]', '1357'); // il vecchio non vale più
    await page.click('.sheet-foot .btn.danger');
    assert.match(await text(page, '.toast.error'), /PIN non è giusto/);
    await page.fill('.sheet input[type=password]', '2468');
    await page.click('.sheet-foot .btn.danger');
    await page.waitForSelector('.toast:has-text("PIN tolto")');
    assert.ok(await page.locator('text=PIN non attivo').count());
  });
});

test('regole automatiche: una regola nuova sceglie la categoria', async () => {
  await withApp({}, async ({ page }) => {
    await go(page, 'regole');
    await page.click('text=＋ Nuova');
    await page.fill('input[aria-label="Parola da cercare"]', 'farmacia');
    await page.locator('.sheet .chip', { hasText: 'Salute' }).click();
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.row:has-text("«farmacia»")');
    await page.click('.fab');
    await page.fill('input[aria-label="Descrizione"]', 'Farmacia Rossi');
    await page.waitForSelector('.cat-box .chip.on:has-text("Salute")');
    assert.match(await text(page, '.tx-form'), /Scelta da una tua regola/);
    await page.click('.sheet-head .icon-btn');
  });
});

test('ripetere una spesa dal modulo del movimento crea anche la scadenza', async () => {
  await withApp({}, async ({ page }) => {
    await page.click('.fab');
    await page.fill('.amount-input', '9,99');
    await page.fill('input[aria-label="Descrizione"]', 'Abbonamento giornale');
    await page.locator('.switch-row', { hasText: 'Ripeti nel tempo' }).click();
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.sheet', { state: 'detached' });
    await go(page, 'ricorrenti');
    const row = page.locator('.row', { hasText: 'Abbonamento giornale' });
    await row.first().waitFor();
    assert.match(await row.last().innerText(), /Ogni mese · prossima 20 dic/);
    // oggi non risulta scaduta (è già registrata oggi): in arrivo c'è solo quella di dicembre
    const due = page.locator('.due-row', { hasText: 'Abbonamento giornale' });
    assert.equal(await due.count(), 1);
    assert.doesNotMatch(await due.innerText(), /Scaduta|Oggi/);
    assert.match(await due.innerText(), /dicembre/);
  });
});
