// Rimuovi sfondo (persona) con MediaPipe, su una foto vera (astronauta, NASA, pubblico dominio): foto e video, sfondo sostituibile.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, importFiles, addMedia, selectClipByIndex, pixel, seek } from '../helpers/browser.js';
import { makeMedia } from '../helpers/make-media.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PHOTO = path.join(ROOT, 'tests', 'fixtures', 'astronaut.png');
let env;
let m;
before(async () => {
  m = makeMedia();
  env = await launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
});
after(async () => env?.close());

async function withApp(fn) {
  const s = await env.open();
  try {
    await s.page.addInitScript(() => { window.__ciakCutout = { base: '/node_modules/@mediapipe/selfie_segmentation/' }; });
    await s.page.reload();
    await s.page.waitForFunction(() => window.__ciak && document.querySelector('.timeline'));
    await fn(s);
    assert.deepEqual(s.errors.filter((e) => !/GL Driver Message|GPU stall/.test(e)), [], 'nessun errore in console/pagina');
  } finally {
    await s.context.close();
  }
}
const isGreen = ([r, g, b]) => g > 200 && r < 60 && b < 60;
const section = async (page) => {
  await page.locator('.insp-tabs .tab', { hasText: /^(Video|Immagine)$/ }).click();
  const sec = page.locator('details.section', { has: page.locator('summary', { hasText: 'Rimuovi sfondo' }) });
  if (!(await sec.evaluate((e) => e.open))) await sec.locator('summary').click();
  return sec;
};
const waitMasks = (page) => page.waitForFunction(() => window.__ciak.cutouts && window.__ciak.store.project.tracks.flatMap((t) => t.clips).filter((c) => c.cutout?.enabled).every((c) => window.__ciak.cutouts.covers(c)), null, { timeout: 120000 });

test('rimuovi sfondo: su una foto la persona resta e lo sfondo diventa trasparente (si vede il colore sotto)', async () => {
  await withApp(async ({ page }) => {
    await page.evaluate(() => window.__ciak.commit('Sfondo verde', (d) => { d.settings.background = '#00ff00'; }));
    await importFiles(page, [PHOTO]);
    await addMedia(page, 0);
    await selectClipByIndex(page, 0);
    // la foto è quadrata dentro un canvas 16:9: occupa il centro (da 22% a 78% in larghezza)
    const bgPoint = [0.25, 0.06]; // sfondo della foto, in alto a sinistra
    const face = [0.5, 0.3];
    assert.equal(isGreen(await pixel(page, ...bgPoint)), false, 'prima: si vede lo sfondo della foto');
    const before = await pixel(page, ...face);
    const sec = await section(page);
    await sec.locator('label.toggle').click();
    await waitMasks(page);
    await page.evaluate(() => window.__ciak.player.settle());
    assert.equal(isGreen(await pixel(page, ...bgPoint)), true, 'dopo: lo sfondo della foto è sparito (si vede il verde)');
    const after = await pixel(page, ...face);
    assert.equal(isGreen(after), false, 'la faccia c’è ancora');
    assert.ok(Math.abs(after[0] - before[0]) + Math.abs(after[1] - before[1]) + Math.abs(after[2] - before[2]) < 40, `il colore della persona non cambia (${before} → ${after})`);
    // il torace e il casco restano, i due angoli in alto sono sfondo
    assert.equal(isGreen(await pixel(page, 0.75, 0.06)), true);
    const people = await page.evaluate(() => window.__ciak.cutouts.people(window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].mediaId));
    assert.ok(people > 0.2 && people < 0.9, `quota di persona ${people}`);
    // annulla: torna com'era
    await page.evaluate(() => window.__ciak.store.undo());
    await page.evaluate(() => window.__ciak.player.settle());
    assert.equal(isGreen(await pixel(page, ...bgPoint)), false);
  });
});

test('rimuovi sfondo: su un video segue i fotogrammi; si può mettere un altro sfondo sotto', async () => {
  await withApp(async ({ page }) => {
    // sotto: un video a colori pieni (traccia in basso), sopra: la persona
    await importFiles(page, [m.f('red.webm'), m.f('person.webm')]);
    await addMedia(page, 0);
    await page.evaluate(() => window.__ciak.commit('Aspetto', (d) => { d.settings.width = 1280; d.settings.height = 720; }));
    await addMedia(page, 1);
    const ids = await page.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).map((c) => ({ id: c.id, media: c.mediaId, track: c.id })));
    // la persona deve stare sopra: l'ultimo clip aggiunto va sulla traccia più alta, se non lo è si sposta
    const person = await page.evaluate(() => {
      const p = window.__ciak.store.project;
      const clips = p.tracks.flatMap((t, i) => t.clips.map((c) => ({ c, i })));
      const pc = clips.find((x) => p.media[x.c.mediaId].name === 'person.webm');
      return { id: pc.c.id, trackIndex: pc.i };
    });
    assert.ok(ids.length === 2);
    await page.evaluate((id) => window.__ciak.selection.set([id]), person.id);
    const sec = await section(page);
    await sec.locator('label.toggle').click();
    await waitMasks(page);
    await seek(page, 1.2);
    const red = (px) => px[0] > 170 && px[1] < 80 && px[2] < 80;
    // il rosso del video sotto si vede dove c'era lo sfondo della persona (se la persona sta sopra)
    const topLeft = await pixel(page, 0.25, 0.06);
    const face = await pixel(page, 0.5, 0.3);
    assert.equal(person.trackIndex, 0, 'la persona sta sulla traccia più alta');
    assert.equal(red(topLeft), true, `sfondo sostituito dal rosso (${topLeft})`);
    assert.equal(red(face), false, `la persona resta (${face})`);
    // senza il ritaglio, in quel punto si vedrebbe la foto e non il rosso
    await page.evaluate((id) => window.__ciak.commit('Spegni', (d) => { d.tracks.flatMap((q) => q.clips).find((c) => c.id === id).cutout.enabled = false; }), person.id);
    await seek(page, 1.2);
    assert.equal(red(await pixel(page, 0.25, 0.06)), false, 'senza ritaglio il rosso non si vede');
    await page.evaluate((id) => window.__ciak.commit('Riaccendi', (d) => { d.tracks.flatMap((q) => q.clips).find((c) => c.id === id).cutout.enabled = true; }), person.id);
    await waitMasks(page);
    // bordi e contorno si regolano
    await sec.locator('.ctl.slider', { has: page.locator('.ctl-label', { hasText: /^Stringi \/ allarga$/ }) }).locator('input.num').fill('-60');
    await page.keyboard.press('Enter');
    const exp = await page.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).find((c) => c.cutout.enabled).cutout.expand);
    assert.equal(exp, -60);
  });
});

test('rimuovi sfondo: riaprendo il progetto le maschere si ricalcolano da sole; i progetti vecchi non hanno il campo e si aprono', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [PHOTO]);
    await addMedia(page, 0);
    await selectClipByIndex(page, 0);
    const sec = await section(page);
    await sec.locator('label.toggle').click();
    await waitMasks(page);
    // si «dimenticano» le maschere (come dopo un riavvio): il progetto ha ancora il ritaglio attivo e le rifà
    await page.evaluate(() => { window.__ciak.cutouts.clear(); window.__ciak.store.commit('Tocco', (d) => { d.name = 'Riaperto'; }); });
    await waitMasks(page);
    assert.equal(await page.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].cutout.enabled), true);
    // un clip senza campo `cutout` (progetto vecchio) si apre con il ritaglio spento
    const ok = await page.evaluate(async () => {
      const { normalizeProject } = await import('/src/core/timeline.js');
      const raw = JSON.parse(JSON.stringify(window.__ciak.store.project));
      for (const t of raw.tracks) for (const c of t.clips) delete c.cutout;
      const p = normalizeProject(raw);
      return p.tracks.flatMap((t) => t.clips).every((c) => c.cutout && c.cutout.enabled === false);
    });
    assert.equal(ok, true);
  });
});
