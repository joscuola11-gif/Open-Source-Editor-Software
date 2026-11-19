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

// ---------------------------------------------------------------- modelli
const openTemplatesTab = async (page) => {
  await page.click('#tab-templates');
  await page.waitForSelector('.tpl-card');
};
const canvasPainted = (page, selector) =>
  page.waitForFunction((sel) => {
    const cs = [...document.querySelectorAll(sel)];
    return cs.length > 0 && cs.every((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 16) s += d[i] + d[i + 1] + d[i + 2];
      return s > 2000;
    });
  }, selector, { timeout: 15000 });
const openCard = async (page, id) => {
  await page.click(`.tpl-card[data-id="${id}"]`);
  await page.waitForSelector('#template-dialog #tpl-canvas');
};
const slotIds = (page) => page.evaluate(() => [...document.querySelectorAll('#template-dialog .tpl-slot')].map((e) => e.dataset.slot));

test('modelli: la scheda mostra tutti i modelli con miniature disegnate, filtri per categoria e ricerca', async () => {
  await withApp(async ({ page }) => {
    await openTemplatesTab(page);
    const n = await page.locator('.tpl-card').count();
    assert.ok(n >= 11, `modelli: ${n}`);
    await canvasPainted(page, '.tpl-thumb');
    // categorie
    await page.click('.chip[data-cat="Social verticale"]');
    const vert = await page.locator('.tpl-card').count();
    assert.ok(vert >= 4 && vert < n, `verticali: ${vert}`);
    assert.ok((await page.locator('.tpl-card').evaluateAll((els) => els.every((e) => e.dataset.cat === 'Social verticale'))));
    await page.click('.chip[data-cat="Citazioni"]');
    assert.equal(await page.locator('.tpl-card').count(), 1);
    await page.click('.chip[data-cat="Tutti"]');
    // ricerca
    await page.fill('#tpl-search', 'griglia');
    assert.equal(await page.locator('.tpl-card').count(), 1);
    assert.match(await page.textContent('.tpl-name'), /Griglia/);
    await page.fill('#tpl-search', 'xyz-non-esiste');
    assert.equal(await page.locator('.tpl-card').count(), 0);
    assert.match(await page.textContent('#tpl-count'), /Nessun modello/);
    await page.fill('#tpl-search', '');
    assert.equal(await page.locator('.tpl-card').count(), n);
    // «I miei modelli» è vuoto e spiega come riempirlo
    await page.click('.chip[data-cat="I miei modelli"]');
    assert.match(await page.textContent('#tpl-count'), /Salva come modello/);
  });
});

test('modelli: l’anteprima si muove, si mette in pausa e cambia quando scegli i tuoi file e testi', async () => {
  await withApp(async ({ page }) => {
    await openTemplatesTab(page);
    await openCard(page, 'base-tre-momenti');
    await canvasPainted(page, '#tpl-canvas');
    assert.equal((await slotIds(page)).length, 3);
    assert.equal(await page.locator('#template-dialog [data-text]').count(), 4);
    // scorre il tempo
    await page.waitForFunction(() => !document.querySelector('#tpl-clock').textContent.startsWith('0:00'), null, { timeout: 8000 }); // l'orologio avanza
    // pausa
    await page.click('#tpl-play');
    await page.waitForTimeout(150);
    const frozen = await page.textContent('#tpl-clock');
    await page.waitForTimeout(500);
    assert.equal(await page.textContent('#tpl-clock'), frozen, 'in pausa è fermo');
    const sample = () => page.evaluate(() => {
      const c = document.querySelector('#tpl-canvas');
      return [...c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data];
    });
    const before = await sample();
    // il tuo file sul primo segnaposto: l'immagine cambia
    const [first] = await slotIds(page);
    await page.setInputFiles(`[data-slot="${first}"] input[type=file]`, m.f('photo.png'));
    await page.waitForFunction((id) => document.querySelector(`[data-slot="${id}"]`).dataset.state === 'picked', first);
    assert.equal(await page.textContent(`[data-slot="${first}"] .tpl-slot-state`), 'photo.png');
    await page.waitForTimeout(500);
    const after = await sample();
    assert.notDeepEqual(before, after, `l'anteprima mostra la tua foto: ${before} → ${after}`);
    // testo
    await page.fill('#template-dialog [data-text]', 'Il mio titolo speciale');
    await page.waitForTimeout(300);
    // un file audio su un segnaposto video viene rifiutato con un messaggio
    await page.setInputFiles(`[data-slot="${first}"] input[type=file]`, m.f('tone.wav'));
    await page.waitForSelector('.toast.warn');
    assert.match(await page.textContent('.toast.warn'), /serve un video o una foto/);
    assert.equal(await page.textContent(`[data-slot="${first}"] .tpl-slot-state`), 'photo.png', 'resta la scelta precedente');
    await page.click('[data-act="tpl-cancel"]');
    assert.equal(await page.locator('#template-dialog').count(), 0);
  });
});

test('modelli: «Usa questo modello» crea il progetto con i tuoi file, il formato giusto e il segnaposto saltato si chiude', async () => {
  await withApp(async ({ page }) => {
    await openTemplatesTab(page);
    await openCard(page, 'base-tre-momenti');
    // senza file non parte
    await page.click('[data-act="tpl-use"]');
    await page.waitForSelector('.toast.warn');
    assert.match(await page.textContent('.toast.warn'), /almeno un video o una foto/);
    assert.equal(await page.locator('#template-dialog').count(), 1, 'la finestra resta aperta');
    const ids = await slotIds(page);
    await page.setInputFiles(`[data-slot="${ids[0]}"] input[type=file]`, m.f('photo.png'));
    await page.setInputFiles(`[data-slot="${ids[1]}"] input[type=file]`, m.f('a.webm'));
    await page.click(`[data-slot="${ids[2]}"] .tpl-skip`);
    await page.fill('#tpl-name', 'Il mio viaggio');
    await page.fill('#template-dialog [data-text]', 'IL MIO VIAGGIO');
    await page.waitForFunction(() => document.querySelectorAll('#template-dialog .tpl-slot[data-state]').length === 3);
    await page.click('[data-act="tpl-use"]');
    await page.waitForFunction(() => window.__ciak.store.project.name === 'Il mio viaggio', null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0);
    const info = await page.evaluate(() => {
      const p = window.__ciak.store.project;
      const cs = p.tracks.flatMap((t) => t.clips);
      return {
        w: p.settings.width, h: p.settings.height,
        media: Object.values(p.media).map((x) => [x.name, x.kind]).sort(),
        slots: cs.filter((c) => c.mediaId).map((c) => ({ kind: c.kind, start: c.start, duration: c.duration, scale: c.transform.scale, tr: c.transition?.type ?? null })).sort((a, b) => a.start - b.start),
        titles: cs.filter((c) => c.kind === 'text').map((c) => c.text.content),
        dur: Math.max(...cs.map((c) => c.start + c.duration)),
        poolOk: Object.keys(p.media).every((id) => window.__ciak.pool.has(id)),
      };
    });
    assert.deepEqual([info.w, info.h], [1080, 1920]);
    assert.deepEqual(info.media, [['a.webm', 'video'], ['photo.png', 'image']]);
    assert.equal(info.slots.length, 2);
    assert.equal(info.slots[0].kind, 'image');
    assert.equal(info.slots[1].kind, 'video');
    assert.ok(info.slots[0].scale > 1.5, `la foto 4:3 riempie lo schermo verticale (scala ${info.slots[0].scale})`);
    assert.equal(info.slots[1].tr, 'push-up', 'la transizione del modello resta');
    assert.ok(info.titles.includes('IL MIO VIAGGIO'));
    assert.ok(info.poolOk, 'i file sono nel progetto');
    assert.ok(info.dur < 6.6 && info.dur > 4, `durata dopo il salto ${info.dur}`);
    // il montaggio si vede davvero
    await seek(page, 1);
    const [r, g, b] = await pixel(page, 0.5, 0.5);
    assert.ok(r + g + b > 60, `si vede la foto (${r},${g},${b})`);
    // il progetto si salva da solo e si può modificare/annullare come ogni altro
    await page.evaluate(() => window.__ciak.commit('prova', (d) => { d.tracks[0].clips[0].volume = 0.5; }));
    assert.equal(await page.evaluate(() => window.__ciak.store.canUndo), true);
  });
});

test('modelli: un modello con sfondo opzionale (Citazione) si usa anche solo con i testi', async () => {
  await withApp(async ({ page }) => {
    await openTemplatesTab(page);
    await openCard(page, 'base-citazione');
    await page.fill('#template-dialog [data-text] >> nth=0', '«Meglio tardi che mai»');
    await page.click('[data-act="tpl-use"]');
    await page.waitForFunction(() => window.__ciak.store.project.tracks.some((t) => t.clips.some((c) => c.kind === 'text')), null, { timeout: 15000 });
    const cs = await clips(page);
    assert.ok(cs.some((c) => c.kind === 'text' && c.text.content === '«Meglio tardi che mai»'));
    assert.equal(cs.some((c) => c.mediaId), false, 'nessun media');
    assert.ok(cs.some((c) => c.kind === 'shape'), 'sfondo colorato e filetto restano');
    await seek(page, 2);
    const [r, g, b] = await pixel(page, 0.05, 0.05);
    assert.ok(r + g + b > 20 && b > r, `fondo blu scuro (${r},${g},${b})`);
  });
});

test('modelli: con un progetto non salvato chiede se salvarlo prima, e «Annulla» non cambia nulla', async () => {
  await withApp(async ({ page }) => {
    await buildProject(page, 'Lavoro in corso');
    await openTemplatesTab(page);
    await openCard(page, 'base-prima-e-dopo');
    const ids = await slotIds(page);
    await page.setInputFiles(`[data-slot="${ids[0]}"] input[type=file]`, m.f('photo.png'));
    await page.waitForFunction((id) => document.querySelector(`[data-slot="${id}"]`).dataset.state === 'picked', ids[0]);
    await page.click('[data-act="tpl-use"]');
    await page.waitForSelector('[data-act="open-save"]');
    await page.click('.dialog:last-of-type [data-act="Annulla"]');
    assert.equal(await page.evaluate(() => window.__ciak.store.project.name), 'Lavoro in corso', 'il progetto resta');
    await page.click('[data-act="tpl-use"]');
    await page.click('[data-act="open-save"]');
    await page.waitForFunction(() => window.__ciak.store.project.name === 'Prima e dopo', null, { timeout: 15000 });
    const saved = await page.evaluate(async () => (await window.__ciak.storage.listProjects()).map((e) => e.name));
    assert.deepEqual(saved, ['Lavoro in corso'], 'il lavoro precedente è stato salvato nell’elenco');
  });
});

test('modelli: salva come modello, ritrovalo in «I miei modelli», riusalo con un altro file, esporta, elimina e reimporta', async () => {
  await withApp(async ({ page, context }) => {
    await buildProject(page, 'Il mio stile');
    await page.evaluate(() => window.__ciak.selection.clear());
    await page.click('#btn-save-template');
    await page.fill('.dialog:last-of-type input.text-input', 'Mio modello');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.toast.success');
    await openTemplatesTab(page);
    await page.click('.chip[data-cat^="I miei modelli"]');
    assert.equal(await page.locator('.tpl-card').count(), 1);
    assert.match(await page.textContent('.chip[data-cat^="I miei modelli"]'), /\(1\)/);
    await canvasPainted(page, '.tpl-thumb');
    await openCard(page, await page.getAttribute('.tpl-card', 'data-id'));
    assert.equal((await slotIds(page)).length, 1);
    // esporta
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="tpl-export"]')]);
    assert.match(dl.suggestedFilename(), /^Mio modello\.ciak-modello$/);
    const path = await dl.path();
    const fs = await import('node:fs');
    const file = JSON.parse(fs.readFileSync(path, 'utf8'));
    assert.equal(file.format, 'ciak-modello');
    assert.deepEqual(file.project.media, {}, 'nessun file multimediale nel modello');
    // usa con un altro file
    const [slot] = await slotIds(page);
    await page.setInputFiles(`[data-slot="${slot}"] input[type=file]`, m.f('b.webm'));
    await page.waitForFunction((id) => document.querySelector(`[data-slot="${id}"]`).dataset.state === 'picked', slot);
    await page.click('[data-act="tpl-use"]');
    await page.waitForSelector('[data-act="open-save"]').catch(() => {});
    if (await page.locator('[data-act="open-nosave"]').count()) await page.click('[data-act="open-nosave"]');
    await page.waitForFunction(() => Object.values(window.__ciak.store.project.media).some((x) => x.name === 'b.webm'), null, { timeout: 15000 });
    // elimina
    await openTemplatesTab(page);
    await page.click('.chip[data-cat^="I miei modelli"]');
    await page.click('.tpl-card');
    await page.waitForSelector('[data-act="tpl-delete"]');
    await page.click('[data-act="tpl-delete"]');
    await page.click('.dialog:last-of-type [data-act="Elimina"]');
    await page.waitForFunction(() => document.querySelectorAll('.tpl-card').length === 0);
    // reimporta il file esportato
    await page.setInputFiles('#tpl-import-input', path);
    await page.waitForFunction(() => document.querySelectorAll('.tpl-card').length === 1, null, { timeout: 8000 });
    assert.match(await page.textContent('.tpl-name'), /Mio modello/);
    // un file qualsiasi non è un modello
    const bad = '/tmp/claude-0/non-modello.txt';
    fs.writeFileSync(bad, 'ciao');
    await page.setInputFiles('#tpl-import-input', bad);
    await page.waitForSelector('.toast.error');
    assert.match(await page.textContent('.toast.error'), /valido|modello/);
    assert.equal(await page.locator('.tpl-card').count(), 1);
    void context;
  });
});
