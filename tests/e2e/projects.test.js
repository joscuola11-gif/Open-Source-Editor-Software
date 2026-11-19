// «I miei progetti» (elenco nel browser) e modelli.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, importFiles, clips, pixel, seek, addMedia } from '../helpers/browser.js';
import { makeMedia } from '../helpers/make-media.js';

let env;
let m;
before(async () => {
  m = makeMedia();
  env = await launch();
});
after(async () => env?.close());

async function withApp(fn) {
  const s = await env.open();
  try {
    await fn(s);
    assert.deepEqual(s.errors, [], 'nessun errore in console/pagina');
  } finally {
    await s.context.close();
  }
}

const openProjects = async (page) => {
  await page.evaluate(() => window.__ciak.selection.clear());
  await page.click('#btn-projects');
  await page.waitForSelector('#projects-dialog #proj-list');
};
const cardNames = (page) => page.locator('.proj-card .proj-title strong').allTextContents();
const closeDialog = (page) => page.click('[data-act="proj-close"]');

async function buildProject(page, name) {
  await importFiles(page, [m.f('a.webm')]);
  await addMedia(page, 0);
  await page.evaluate((n) => window.__ciak.commit('Nome', (d) => { d.name = n; }), name);
}

test('progetti: salva con nome, chiudi, riapri dall’elenco e ritrova clip e video funzionanti', async () => {
  await withApp(async ({ page }) => {
    await buildProject(page, 'Vacanza al mare');
    await openProjects(page);
    assert.equal(await page.locator('#proj-empty').count(), 1, 'all’inizio l’elenco è vuoto');
    await page.fill('#proj-name', 'Vacanza al mare');
    await page.click('#proj-save');
    await page.waitForSelector('.proj-card');
    assert.deepEqual(await cardNames(page), ['Vacanza al mare']);
    assert.match(await page.textContent('.proj-meta'), /0:04 · 1920×1080 · 1 clip · 1 file/);
    assert.equal(await page.locator('.proj-thumb').first().evaluate((e) => e.tagName), 'IMG', 'ha la miniatura');
    assert.equal(await page.locator('.proj-card .badge').count(), 1, 'è segnato come aperto');
    await closeDialog(page);

    // nuovo progetto: poiché è salvato e invariato non chiede conferma
    await page.evaluate(() => window.__ciak.actions.newProject());
    await page.waitForFunction(() => window.__ciak.store.project.tracks.every((t) => !t.clips.length) && !Object.keys(window.__ciak.store.project.media).length);
    assert.equal(await page.evaluate(() => document.querySelector('dialog[open]') !== null), false);

    await openProjects(page);
    assert.equal(await page.locator('.proj-card .badge').count(), 0);
    await page.click('.proj-card .proj-open');
    await page.waitForFunction(() => window.__ciak.store.project.name === 'Vacanza al mare' && window.__ciak.store.project.tracks.some((t) => t.clips.length));
    assert.equal(await page.locator('dialog[open]').count(), 0, 'la finestra si chiude');
    await page.waitForFunction(() => window.__ciak.pool.has(Object.keys(window.__ciak.store.project.media)[0]));
    await seek(page, 1);
    const [r, g, b] = await pixel(page, 0.5, 0.5);
    assert.ok(r + g + b > 60, `il video aperto dall’elenco si vede (${r},${g},${b})`);
    assert.equal((await clips(page)).length, 1);
  });
});

test('progetti: salvando di nuovo si aggiorna la stessa voce; «Salva come nuovo» ne crea un’altra con nome diverso', async () => {
  await withApp(async ({ page }) => {
    await buildProject(page, 'Film');
    await openProjects(page);
    await page.fill('#proj-name', 'Film');
    await page.click('#proj-save');
    await page.waitForSelector('.proj-card');
    await closeDialog(page);
    // modifica e riaggiorna
    await page.evaluate(() => window.__ciak.commit('Nome', (d) => { d.tracks[1].clips[0].volume = 0.3; }));
    assert.equal(await page.evaluate(() => window.__ciak.isSavedInList()), false, 'dopo una modifica non è più allineato');
    await openProjects(page);
    assert.match(await page.textContent('#proj-save'), /Aggiorna/);
    await page.click('#proj-save');
    await page.waitForFunction(() => window.__ciak.isSavedInList());
    assert.equal((await cardNames(page)).length, 1, 'ancora una sola voce');
    const vol = await page.evaluate(async () => (await window.__ciak.storage.listProjects()).length);
    assert.equal(vol, 1);
    await page.fill('#proj-name', 'Film');
    await page.click('#proj-save-new');
    await page.waitForFunction(() => document.querySelectorAll('.proj-card').length === 2);
    const names = (await cardNames(page)).sort();
    assert.deepEqual(names, ['Film', 'Film (2)']);
  });
});

test('progetti: duplica, rinomina, elimina; i file non più usati da nessuno vengono rimossi, gli altri restano', async () => {
  await withApp(async ({ page }) => {
    await buildProject(page, 'Uno');
    await openProjects(page);
    await page.click('#proj-save');
    await page.waitForSelector('.proj-card');
    const ids = await page.evaluate(() => Object.keys(window.__ciak.store.project.media));
    assert.equal(ids.length, 1);
    await page.click('.proj-dup');
    await page.waitForFunction(() => document.querySelectorAll('.proj-card').length === 2);
    assert.deepEqual((await cardNames(page)).sort(), ['Copia di Uno', 'Uno']);
    // rinomina la copia
    await page.locator('.proj-card', { hasText: 'Copia di Uno' }).locator('.proj-rename').click();
    await page.fill('.dialog:last-of-type input.text-input', 'Seconda versione');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.proj-title strong')].some((e) => e.textContent === 'Seconda versione'));
    // elimina l'originale: il file resta perché lo usa ancora la copia
    await page.locator('.proj-card', { has: page.locator('strong', { hasText: /^Uno$/ }) }).locator('.proj-del').click();
    await page.click('.dialog:last-of-type [data-act="Elimina"]');
    await page.waitForFunction(() => document.querySelectorAll('.proj-card').length === 1);
    assert.deepEqual(await page.evaluate(() => window.__ciak.storage.mediaIds()), ids, 'il file serve ancora alla copia');
    // elimina anche la copia e chiudi il progetto aperto: il file non serve più a nessuno
    await page.locator('.proj-card .proj-del').click();
    await page.click('.dialog:last-of-type [data-act="Elimina"]');
    await page.waitForFunction(() => document.querySelectorAll('.proj-card').length === 0);
    await closeDialog(page);
    // il progetto di lavoro usa ancora quel file, quindi non viene toccato
    assert.deepEqual(await page.evaluate(() => window.__ciak.storage.mediaIds()), ids);
    // il progetto aperto non è più nell'elenco: chiude solo dopo conferma
    await page.evaluate(() => { window.__ciak.actions.newProject(); });
    await page.click('.dialog:last-of-type [data-act="Nuovo progetto"]');
    await page.waitForFunction(() => !Object.keys(window.__ciak.store.project.media).length);
    await page.waitForFunction(async () => (await window.__ciak.storage.mediaIds()).length === 0, null, { timeout: 5000 });
  });
});

test('progetti: aprendo un altro progetto con modifiche non salvate chiede cosa fare (annulla / senza salvare / salva e apri)', async () => {
  await withApp(async ({ page }) => {
    await buildProject(page, 'Primo');
    await openProjects(page);
    await page.click('#proj-save');
    await page.waitForSelector('.proj-card');
    await closeDialog(page);
    // lavoro nuovo non salvato
    await page.evaluate(() => window.__ciak.actions.newProject());
    await page.waitForFunction(() => !Object.keys(window.__ciak.store.project.media).length);
    await page.waitForFunction(() => !document.querySelector('.media-card'), null, { timeout: 5000 }); // la libreria si svuota
    await page.evaluate(() => window.__ciak.commit('Nome', (d) => { d.name = 'Bozza'; }));
    await importFiles(page, [m.f('b.webm')]);
    await addMedia(page, 0);
    await openProjects(page);
    // annulla: resta la bozza
    await page.click('.proj-open');
    await page.waitForSelector('[data-act="Annulla"]');
    await page.click('.dialog:last-of-type [data-act="Annulla"]');
    assert.equal(await page.evaluate(() => window.__ciak.store.project.name), 'Bozza');
    // salva e apri: la bozza finisce nell'elenco e si apre «Primo»
    await page.click('.proj-open');
    await page.click('[data-act="open-save"]');
    await page.waitForFunction(() => window.__ciak.store.project.name === 'Primo');
    const names = await page.evaluate(async () => (await window.__ciak.storage.listProjects()).map((e) => e.name).sort());
    assert.deepEqual(names, ['Bozza', 'Primo']);
  });
});

test('progetti: l’elenco e i file restano dopo aver ricaricato la pagina e si può riaprire', async () => {
  await withApp(async ({ page }) => {
    await buildProject(page, 'Persistente');
    await openProjects(page);
    await page.click('#proj-save');
    await page.waitForSelector('.proj-card');
    await closeDialog(page);
    await page.evaluate(() => window.__ciak.actions.newProject());
    await page.waitForFunction(() => !Object.keys(window.__ciak.store.project.media).length);
    await page.waitForTimeout(900); // lascia scrivere il salvataggio automatico
    await page.reload();
    await page.waitForFunction(() => window.__ciak && document.querySelector('.timeline'));
    await page.waitForFunction(() => window.__ciak.storage.available !== undefined);
    await openProjects(page);
    assert.deepEqual(await cardNames(page), ['Persistente']);
    await page.click('.proj-open');
    await page.waitForFunction(() => window.__ciak.store.project.name === 'Persistente' && window.__ciak.pool.has(Object.keys(window.__ciak.store.project.media)[0]));
    await seek(page, 1);
    const [r, g, b] = await pixel(page, 0.5, 0.5);
    assert.ok(r + g + b > 60);
  });
});

test('archivio vecchio (versione 1): si aggiorna da solo, il progetto di lavoro si ripristina e l’elenco funziona', async () => {
  await withApp(async ({ page }) => {
    // sostituisce il database con uno della versione precedente, contenente un progetto con un testo
    await page.evaluate(async () => {
      const proj = JSON.parse(JSON.stringify(window.__ciak.store.project));
      proj.name = 'Vecchio progetto';
      proj.tracks[0].clips.push({ ...window.__ciak.actions ? {} : {}, id: 'cOld1', kind: 'text', name: 'Titolo', start: 0, duration: 2 });
      await new Promise((res, rej) => { const r = indexedDB.deleteDatabase('ciak-studio'); r.onsuccess = res; r.onerror = () => rej(r.error); r.onblocked = res; });
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('ciak-studio', 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('meta'); r.result.createObjectStore('media'); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      await new Promise((res, rej) => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(proj, 'project'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      db.close();
    });
    await page.reload();
    await page.waitForFunction(() => window.__ciak && document.querySelector('.timeline'));
    await page.waitForFunction(() => window.__ciak.storage.available === true);
    await page.waitForFunction(() => window.__ciak.store.project.name === 'Vecchio progetto', null, { timeout: 8000 });
    assert.equal(await page.evaluate(async () => (await window.__ciak.storage.listProjects()).length), 0);
    await openProjects(page);
    assert.equal(await page.locator('#proj-empty').count(), 1);
  });
});
