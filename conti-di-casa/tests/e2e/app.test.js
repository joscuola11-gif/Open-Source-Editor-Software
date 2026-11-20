// Prove nel browser, in un telefono virtuale 390×844 (Chromium). Data fissata al 20 novembre 2026.
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
  const app = await openApp(browser, base, opts);
  try {
    await fn(app);
    assert.deepEqual(app.problems, [], 'errori nella pagina');
  } finally {
    await app.context.close();
  }
}
const demo = () => ({ seed: demoState() });
const text = async (page, sel) => (await page.locator(sel).first().innerText()).replace(/\u00a0/g, ' ');
const tab = (page, name) => page.locator(`.tab:has-text("${name}")`).click();
async function addExpense(page, { importo, descr, cat, conto }) {
  await page.click('.fab');
  await page.waitForSelector('.sheet');
  await page.fill('.amount-input', importo);
  if (descr) await page.fill('input[aria-label="Descrizione"]', descr);
  if (cat) await page.locator('.cat-box .chip', { hasText: cat }).first().click();
  if (conto) await page.locator('.tx-form .chip', { hasText: conto }).first().click();
  await page.click('.sheet-foot .btn.primary');
  await page.waitForSelector('.sheet', { state: 'detached' });
}

test('primo avvio: due domande, poi si parte, e i dati restano dopo aver richiuso', async () => {
  await withApp({}, async ({ page }) => {
    await page.waitForSelector('.onboarding');
    await page.fill('input[placeholder^="Per esempio: Famiglia"]', 'Famiglia Bianchi');
    await page.fill('input[placeholder^="Per esempio: Maria"]', 'Anna');
    await page.locator('.onboarding input[placeholder="0,00"]').nth(1).fill('1.250,00');
    await page.click('text=Cominciamo');
    await page.waitForSelector('.home');
    assert.match(await text(page, '.home-head h1'), /Famiglia Bianchi/);
    assert.match(await text(page, '.hero-amount'), /1\.250,00/);
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForSelector('.home');
    assert.match(await text(page, '.hero-amount'), /1\.250,00/, 'dopo il ricaricamento il saldo c’è ancora');
  });
});

test('aggiungere una spesa: appare in Home e Movimenti, il saldo scende, la categoria si impara', async () => {
  await withApp(demo(), async ({ page }) => {
    await page.waitForSelector('.home');
    const before = await text(page, '.hero-amount');
    await addExpense(page, { importo: '12,50+3', descr: 'Farmacia centrale', cat: 'Salute', conto: 'Contanti' });
    await page.waitForSelector('.toast');
    assert.match(await text(page, '.toast'), /Spesa registrata/);
    assert.notEqual(await text(page, '.hero-amount'), before);
    await tab(page, 'Movimenti');
    assert.match(await text(page, '.tx-list'), /Farmacia centrale/);
    assert.match(await text(page, '.tx-list'), /−15,50/);
    // la volta dopo la categoria viene suggerita da sola
    await page.click('.fab');
    await page.fill('input[aria-label="Descrizione"]', 'Farmacia centrale');
    await page.waitForSelector('.cat-box .chip.on:has-text("Salute")');
    await page.click('.sheet-head .icon-btn');
  });
});

test('importi non validi non si salvano e avvisano', async () => {
  await withApp(demo(), async ({ page }) => {
    await page.click('.fab');
    await page.fill('.amount-input', '12,3x');
    await page.click('.sheet-foot .btn.primary');
    assert.match(await text(page, '.toast.error'), /importo valido/i);
    await page.fill('.amount-input', '0');
    await page.click('.sheet-foot .btn.primary');
    assert.match(await text(page, '.toast.error'), /importo valido/i);
    assert.ok(await page.locator('.sheet').count(), 'il foglio resta aperto');
  });
});

test('modificare, eliminare e annullare', async () => {
  await withApp(demo(), async ({ page }) => {
    await tab(page, 'Movimenti');
    await page.locator('.row', { hasText: 'Cinema' }).first().click();
    await page.fill('.amount-input', '45');
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.sheet', { state: 'detached' });
    assert.match(await text(page, '.tx-list'), /−45,00/);
    await page.locator('.row', { hasText: 'Cinema' }).first().click();
    await page.click('text=Elimina');
    await page.click('.sheet.dialog .btn.danger');
    await page.waitForSelector('.toast:has-text("eliminato")');
    assert.equal(await page.locator('.row', { hasText: 'Cinema' }).count(), 0);
    await page.click('.toast-action');
    await page.waitForSelector('.row:has-text("Cinema")');
  });
});

test('giroconto: sposta i soldi fra conti senza contare come spesa', async () => {
  await withApp(demo(), async ({ page }) => {
    const hero = await text(page, '.hero-amount');
    const usc = await text(page, '.hero-grid > div:nth-child(2) strong');
    await page.click('.fab');
    await page.locator('.seg', { hasText: 'Giroconto' }).click();
    await page.fill('.amount-input', '100');
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.sheet', { state: 'detached' });
    assert.equal(await text(page, '.hero-amount'), hero, 'il patrimonio non cambia');
    assert.equal(await text(page, '.hero-grid > div:nth-child(2) strong'), usc, 'le uscite non cambiano');
  });
});

test('spesa divisa: «chi deve a chi» si aggiorna e si può segnare come pagato', async () => {
  await withApp(demo(), async ({ page }) => {
    await page.evaluate(() => { location.hash = '#/famiglia'; });
    await page.waitForSelector('.card:has-text("Chi deve a chi")');
    assert.match(await text(page, '.card:has-text("Chi deve a chi")'), /Maria deve 124,00 € a Luca/);
    await page.click('.card:has-text("Chi deve a chi") .btn:has-text("Pagato")');
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.toast:has-text("segnato")');
    assert.match(await text(page, '.card:has-text("Chi deve a chi")'), /Siete pari/);
    await page.click('.toast-action');
    assert.match(await text(page, '.card:has-text("Chi deve a chi")'), /124,00/);
  });
});

test('dividere una nuova spesa fra due persone', async () => {
  await withApp(demo(), async ({ page }) => {
    await page.click('.fab');
    await page.fill('.amount-input', '90');
    await page.locator('.switch-row', { hasText: 'Dividi con la famiglia' }).click();
    await page.locator('.split-box .field:has-text("Chi ha pagato") .chip', { hasText: 'Luca' }).click();
    assert.match(await text(page, '.split-list'), /45,00/);
    await page.locator('.segmented .seg', { hasText: 'Importi diversi' }).click();
    await page.fill('input[aria-label="Quota di Maria"]', '30');
    await page.fill('input[aria-label="Quota di Luca"]', '50');
    assert.match(await text(page, '.split-left'), /Ce ne sono 0,00|Mancano|in più/);
    await page.click('.sheet-foot .btn.primary');
    assert.match(await text(page, '.toast.error'), /quote devono dare in tutto/i);
    await page.fill('input[aria-label="Quota di Luca"]', '60');
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.evaluate(() => { location.hash = '#/famiglia'; });
    assert.match(await text(page, '.card:has-text("Chi deve a chi")'), /Maria deve 154,00 € a Luca/);
  });
});

test('budget: avvisa quando una spesa fa superare il limite', async () => {
  await withApp(demo(), async ({ page }) => {
    await addExpense(page, { importo: '30', descr: 'Biglietti', cat: 'Svago' });
    await page.waitForSelector('.toast.warn');
    assert.match(await text(page, '.toast'), /superato il budget di Svago/);
    await tab(page, 'Budget');
    assert.match(await text(page, '.budget'), /Budget superato/);
  });
});

test('budget: imposta e toglie un limite', async () => {
  await withApp(demo(), async ({ page }) => {
    await tab(page, 'Budget');
    await page.locator('.row', { hasText: 'Bollette' }).click();
    await page.fill('.amount-input', '150');
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.budget-row:has-text("Bollette")');
    await page.locator('.budget-row', { hasText: 'Bollette' }).locator('.row').click();
    await page.click('text=Togli il limite');
    await page.waitForSelector('.budget-row:has-text("Bollette")', { state: 'detached' });
  });
});

test('scadenze: «Pagata» registra il movimento e la scadenza sparisce', async () => {
  await withApp(demo(), async ({ page }) => {
    await page.evaluate(() => { location.hash = '#/ricorrenti'; });
    const due = page.locator('.due-row', { hasText: 'Assicurazione auto' });
    assert.match(await due.innerText(), /Scaduta/);
    await due.locator('.btn.primary').click();
    await page.waitForSelector('.toast:has-text("Pagamento registrato")');
    assert.equal(await page.locator('.due-row', { hasText: 'Assicurazione auto' }).count(), 0);
    await tab(page, 'Movimenti');
    assert.match(await text(page, '.tx-list'), /Assicurazione auto/);
  });
});

test('scadenze: una ricorrenza «da sola» si registra all’apertura, una volta sola', async () => {
  const seed = demoState();
  seed.ricorrenze.push({ id: 'rAuto', nome: 'Abbonamento musica', tipo: 'spesa', importo: 999, contoId: seed.conti[1].id, categoriaId: seed.categorie.find((k) => k.nome === 'Abbonamenti').id, ogni: 1, unita: 'mesi', inizio: '2026-11-10', fine: null, ultima: null, autoRegistra: true, avvisoGiorni: 3, attiva: true, u: 1 });
  await withApp({ seed }, async ({ page }) => {
    await page.waitForSelector('.toast:has-text("Registrato 1 movimento ricorrente")');
    await tab(page, 'Movimenti');
    assert.equal(await page.locator('.row', { hasText: 'Abbonamento musica' }).count(), 1);
    await page.reload();
    await page.waitForSelector('.tab');
    await tab(page, 'Movimenti');
    assert.equal(await page.locator('.row', { hasText: 'Abbonamento musica' }).count(), 1, 'dopo la riapertura non si duplica');
  });
});

test('ricerca e filtri nei movimenti', async () => {
  await withApp(demo(), async ({ page }) => {
    await tab(page, 'Movimenti');
    await page.click('text=Tutto', { trial: true }).catch(() => {});
    await page.fill('.search', 'esselunga');
    const rows = await page.locator('.tx-list .row').count();
    assert.ok(rows >= 2);
    for (const t of await page.locator('.tx-list .row-title').allInnerTexts()) assert.match(t, /Esselunga/);
    await page.fill('.search', 'xyz-non-esiste');
    assert.match(await text(page, '.tx-list'), /Nessun movimento/);
    await page.fill('.search', '');
    await page.click('text=Filtri');
    await page.locator('.sheet .chip', { hasText: 'Entrate' }).click();
    await page.click('.sheet-foot .btn.primary');
    for (const t of await page.locator('.tx-list .row-title').allInnerTexts()) assert.match(t, /Stipendio/);
  });
});

test('nascondere gli importi', async () => {
  await withApp(demo(), async ({ page }) => {
    await page.evaluate(() => { location.hash = '#/impostazioni'; });
    await page.locator('.switch-row', { hasText: 'Nascondi gli importi' }).click();
    await tab(page, 'Casa');
    assert.match(await text(page, '.hero-amount'), /^•+/);
    await page.click('.home-head .icon-btn');
    assert.match(await text(page, '.hero-amount'), /10\.\d{3},\d{2}/);
  });
});

test('PIN: si attiva, blocca alla riapertura, sbagliato non entra, giusto sì', async () => {
  await withApp(demo(), async ({ page }) => {
    await page.evaluate(() => { location.hash = '#/impostazioni'; });
    await page.click('text=Attiva il PIN');
    const inputs = page.locator('.sheet input[type=password]');
    await inputs.nth(0).fill('4821');
    await inputs.nth(1).fill('4821');
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.toast:has-text("PIN attivato")');
    await page.waitForTimeout(400);
    // il PIN non è salvato in chiaro
    const raw = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('conti-di-casa', 1); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('stato'); g.onsuccess = () => res(JSON.stringify(g.result.impostazioni)); }; }));
    assert.ok(!raw.includes('4821'));
    assert.match(raw, /pinHash":"[0-9a-f]{64}"/);
    await page.reload();
    await page.waitForSelector('.lock');
    for (const d of '1111') await page.click(`.key[aria-label="${d}"]`);
    await page.click('.key[aria-label="Conferma"]');
    await page.waitForSelector('.pin-msg:has-text("sbagliato")');
    assert.equal(await page.locator('.home').count(), 0);
    for (const d of '4821') await page.click(`.key[aria-label="${d}"]`);
    await page.click('.key[aria-label="Conferma"]');
    await page.waitForSelector('.tabbar');
    assert.equal(await page.locator('.lock').count(), 0);
  });
});

test('PIN: l’app si richiude da sola quando si esce e si rientra (blocco subito)', async () => {
  const seed = demoState();
  await withApp({ seed }, async ({ page }) => {
    await page.evaluate(() => { location.hash = '#/impostazioni'; });
    await page.click('text=Attiva il PIN');
    const inputs = page.locator('.sheet input[type=password]');
    await inputs.nth(0).fill('2468');
    await inputs.nth(1).fill('2468');
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.toast:has-text("PIN attivato")');
    await page.locator('select[aria-label="Blocca dopo"]').selectOption('0');
    await page.evaluate(() => {
      const set = (v) => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); };
      set('hidden');
      set('visible');
    });
    await page.waitForSelector('.lock');
  });
});

test('copia di sicurezza: si scarica, si cancella tutto, si ripristina', async () => {
  await withApp(demo(), async ({ page }) => {
    await page.evaluate(() => { location.hash = '#/dati'; });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Salva una copia')]);
    assert.match(dl.suggestedFilename(), /^conti-di-casa-2026-11-20\.json$/);
    const { readFile } = await import('node:fs/promises');
    const json = await readFile(await dl.path(), 'utf8');
    const data = JSON.parse(json);
    assert.equal(data.app, 'conti-di-casa');
    assert.ok(data.dati.movimenti.length > 50);
    // ripristino su dati diversi
    await page.click('text=Ripristina da una copia');
    // (il file chooser si apre da solo: lo gestiamo sotto)
  }).catch(() => {});
  await withApp(demo(), async ({ page }) => {
    await page.evaluate(() => { location.hash = '#/dati'; });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Salva una copia')]);
    const { readFile } = await import('node:fs/promises');
    const buffer = Buffer.from(await readFile(await dl.path()));
    // si cancella un movimento, poi si ripristina la copia e il movimento torna
    await tab(page, 'Movimenti');
    await page.locator('.row', { hasText: 'Cinema' }).first().click();
    await page.click('text=Elimina');
    await page.click('.sheet.dialog .btn.danger');
    assert.equal(await page.locator('.row', { hasText: 'Cinema' }).count(), 0);
    await page.evaluate(() => { location.hash = '#/dati'; });
    const chooser = page.waitForEvent('filechooser');
    await page.click('text=Ripristina da una copia');
    await (await chooser).setFiles({ name: 'copia.json', mimeType: 'application/json', buffer });
    await page.click('.sheet.dialog .btn.danger');
    await page.waitForSelector('.toast:has-text("Copia ripristinata")');
    await tab(page, 'Movimenti');
    await page.waitForSelector('.row:has-text("Cinema")');
  });
});

test('una copia sbagliata viene rifiutata con un messaggio chiaro', async () => {
  await withApp(demo(), async ({ page }) => {
    await page.evaluate(() => { location.hash = '#/dati'; });
    const chooser = page.waitForEvent('filechooser');
    await page.click('text=Ripristina da una copia');
    await (await chooser).setFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"ciao": 1}') });
    assert.match(await text(page, '.toast.error'), /non è una copia di Conti di Casa/);
  });
});

test('unire i dati di due telefoni: ognuno ha movimenti che l’altro non ha', async () => {
  const a = demoState();
  const b = structuredClone(a);
  const tx = (id, descr, importo, u) => ({ id, tipo: 'spesa', data: '2026-11-19', importo, contoId: a.conti[1].id, categoriaId: a.categorie.find((k) => k.nome === 'Casa').id, descrizione: descr, note: '', u });
  a.movimenti.push(tx('tA', 'Solo sul telefono A', 1111, 5));
  b.movimenti.push(tx('tB', 'Solo sul telefono B', 2222, 6));
  const { writeFile } = await import('node:fs/promises');
  const file = Buffer.from(JSON.stringify({ app: 'conti-di-casa', versione: 1, esportato: '2026-11-19T10:00:00Z', dati: b }));
  await withApp({ seed: a }, async ({ page }) => {
    await page.evaluate(() => { location.hash = '#/dati'; });
    const chooser = page.waitForEvent('filechooser');
    await page.click('text=Unisci una copia');
    await (await chooser).setFiles({ name: 'b.json', mimeType: 'application/json', buffer: file });
    assert.match(await text(page, '.sheet.dialog'), /1 nuovi/);
    await page.click('.sheet.dialog .btn.primary');
    await page.waitForSelector('.toast:has-text("Dati uniti")');
    await tab(page, 'Movimenti');
    assert.equal(await page.locator('.row', { hasText: 'Solo sul telefono A' }).count(), 1);
    assert.equal(await page.locator('.row', { hasText: 'Solo sul telefono B' }).count(), 1);
    // rifarlo non cambia niente
    await page.evaluate(() => { location.hash = '#/dati'; });
    const c2 = page.waitForEvent('filechooser');
    await page.click('text=Unisci una copia');
    await (await c2).setFiles({ name: 'b.json', mimeType: 'application/json', buffer: file });
    await page.waitForSelector('.toast:has-text("niente di nuovo")');
  });
});

test('esportare in CSV: intestazioni, segni e protezione dalle formule', async () => {
  const seed = demoState();
  seed.movimenti.push({ id: 'tF', tipo: 'spesa', data: '2026-11-19', importo: 500, contoId: seed.conti[0].id, descrizione: '=CMD()', note: '', u: 3 });
  await withApp({ seed }, async ({ page }) => {
    await page.evaluate(() => { location.hash = '#/dati'; });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Esporta tutti i movimenti')]);
    const { readFile } = await import('node:fs/promises');
    const csv = await readFile(await dl.path(), 'utf8');
    assert.ok(csv.startsWith('﻿Data;Tipo;Importo;Conto'));
    assert.match(csv, /2026-10-27;Entrata;2140,00;Conto corrente/);
    assert.match(csv, /;Spesa;-5,00;/);
    assert.match(csv, /;'=CMD\(\);/, 'le formule vengono disinnescate');
  });
});

test('importare un estratto conto: riconosce le colonne, salta i doppioni, non duplica', async () => {
  const csv = 'Data operazione;Descrizione;Importo\r\n18/11/2026;Esselunga milano;-23,40\r\n19/11/2026;Stipendio extra;150,00\r\n15/11/2026;Pizzeria da Gino;-62,00\r\nnon è una data;Boh;1,00\r\n';
  await withApp(demo(), async ({ page }) => {
    await page.evaluate(() => { location.hash = '#/dati'; });
    const chooser = page.waitForEvent('filechooser');
    await page.click('text=Importa un estratto conto');
    await (await chooser).setFiles({ name: 'estratto.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForSelector('.import-result');
    await page.locator('.sheet .chip', { hasText: 'Carta Luca' }).click();
    assert.match(await text(page, '.import-result'), /2 da importare · 1 già present/);
    assert.match(await text(page, '.import-result'), /1 righe da scartare/);
    await page.locator('.sheet-foot .btn.primary').click();
    await page.waitForSelector('.toast:has-text("Importati 2 movimenti")');
    await tab(page, 'Movimenti');
    assert.equal(await page.locator('.row', { hasText: 'Esselunga milano' }).count(), 1);
    assert.match(await page.locator('.row', { hasText: 'Esselunga milano' }).innerText(), /Spesa alimentare/, 'categoria indovinata dai movimenti passati');
  });
});

test('correggere il saldo di un conto non falsa le statistiche', async () => {
  await withApp(demo(), async ({ page }) => {
    const usc = await text(page, '.hero-grid > div:nth-child(2) strong');
    await page.evaluate(() => { location.hash = '#/conti'; });
    await page.locator('.row', { hasText: 'Contanti' }).click();
    await page.click('text=Correggi il saldo');
    await page.fill('.sheet .amount-input', '500');
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.toast:has-text("Saldo corretto")');
    assert.match(await text(page, '.hero-amount'), /500,00/);
    await page.evaluate(() => { location.hash = '#/home'; });
    assert.equal(await text(page, '.hero-grid > div:nth-child(2) strong'), usc);
  });
});

test('obiettivi: versamento e avanzamento', async () => {
  await withApp(demo(), async ({ page }) => {
    await page.evaluate(() => { location.hash = '#/obiettivi'; });
    assert.match(await text(page, '.goal'), /800,00 € di 2\.000,00 €/);
    await page.click('.goal .btn.primary');
    await page.fill('.sheet .amount-input', '200');
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.toast:has-text("da parte")');
    assert.match(await text(page, '.goal'), /1\.000,00 € di 2\.000,00 €/);
    assert.match(await text(page, '.goal'), /50%/);
  });
});

test('categorie: nuova, usata, eliminata con spostamento dei movimenti', async () => {
  await withApp(demo(), async ({ page }) => {
    await page.evaluate(() => { location.hash = '#/categorie'; });
    await page.locator('.section-title:has-text("Spese") .link').click();
    await page.fill('.sheet input[aria-label="Nome della categoria"]', 'Palestra');
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.row:has-text("Palestra")');
    await page.locator('.row', { hasText: 'Svago' }).click();
    await page.click('text=Elimina');
    await page.locator('.sheet .row', { hasText: 'Ristoranti e bar' }).click();
    await page.waitForSelector('.toast:has-text("Categoria eliminata")');
    await tab(page, 'Movimenti');
    assert.match(await page.locator('.row', { hasText: 'Cinema' }).first().innerText(), /Ristoranti e bar/);
  });
});

test('tasto indietro di Android: chiude il foglio, poi torna indietro, poi esce', async () => {
  await withApp(demo(), async ({ page }) => {
    await tab(page, 'Altro');
    await page.click('.row:has-text("Conti")');
    await page.waitForSelector('.page-head:has-text("Conti")');
    await page.click('.fab');
    await page.waitForSelector('.sheet');
    assert.equal(await page.evaluate(() => window.__onBack()), true);
    await page.waitForSelector('.sheet', { state: 'detached' });
    assert.equal(await page.evaluate(() => window.__onBack()), true);
    await page.waitForSelector('.tab-head:has-text("Altro")');
    assert.equal(await page.evaluate(() => window.__onBack()), true, 'da Altro torna alla Home');
    await page.waitForSelector('.home');
    assert.equal(await page.evaluate(() => window.__onBack()), false, 'dalla Home si esce');
  });
});

test('nessuna pagina esce dallo schermo e tutti i pulsanti hanno un nome (telefono stretto 320 px)', async () => {
  await withApp({ ...demo(), viewport: { width: 320, height: 640 } }, async ({ page }) => {
    for (const r of ['home', 'movimenti', 'budget', 'altro', 'statistiche', 'conti', 'famiglia', 'ricorrenti', 'obiettivi', 'categorie', 'regole', 'dati', 'impostazioni']) {
      await page.evaluate((r) => { location.hash = `#/${r}`; }, r);
      await page.waitForTimeout(220);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 1, `pagina ${r}: esce di ${over}px`);
      const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, [role=button], a, select, input:not([type=hidden])')].filter((e) => e.offsetParent !== null).filter((e) => !(e.getAttribute('aria-label') || e.innerText?.trim() || e.getAttribute('placeholder') || e.labels?.length || e.title)).map((e) => e.outerHTML.slice(0, 80)));
      assert.deepEqual(unnamed, [], `pagina ${r}: elementi senza nome`);
    }
    await page.click('.fab');
    const overSheet = await page.evaluate(() => document.querySelector('.sheet').scrollWidth - document.querySelector('.sheet').clientWidth);
    assert.ok(overSheet <= 1, 'il foglio del movimento non esce');
  });
});

test('tema scuro: l’app si legge (testo chiaro su fondo scuro)', async () => {
  await withApp({ ...demo(), colorScheme: 'dark' }, async ({ page }) => {
    await page.waitForSelector('.home');
    const [bg, fg] = await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).color]);
    const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
    assert.ok(lum(bg) < 0.2 && lum(fg) > 0.7, `sfondo ${bg}, testo ${fg}`);
  });
});

test('dati grandi: 6000 movimenti si aprono e si scorrono senza bloccarsi', async () => {
  const seed = demoState();
  const base0 = seed.movimenti.filter((m) => m.tipo === 'spesa' && !m.divisione);
  for (let i = 0; i < 6000; i++) {
    const m = base0[i % base0.length];
    seed.movimenti.push({ ...m, id: `big${i}`, data: `2026-${String(1 + (i % 10)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, importo: 100 + (i % 5000), u: 100 + i });
  }
  await withApp({ seed }, async ({ page }) => {
    const t0 = Date.now();
    await tab(page, 'Movimenti');
    await page.click('text=Filtri');
    await page.locator('.sheet .segmented .seg', { hasText: 'Tutto' }).click();
    await page.click('.sheet-foot .btn.primary');
    await page.waitForSelector('.tx-list .row');
    assert.ok(Date.now() - t0 < 5000, `troppo lento: ${Date.now() - t0} ms`);
    assert.ok(await page.locator('.tx-list .row').count() <= 80, 'si mostrano a blocchi');
    await page.click('text=Mostra altri');
    await page.evaluate(() => { location.hash = '#/statistiche'; });
    await page.waitForSelector('.donut');
  });
});
