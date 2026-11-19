// Analisi del video: cambi di scena e momenti migliori, su video veri (ffmpeg) con tagli e movimento noti.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, importFiles, clips, addMedia, selectClipByIndex, inspectorTab } from '../helpers/browser.js';
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
const videoClips = async (page) => (await clips(page)).filter((c) => c.kind === 'video').sort((a, b) => a.start - b.start);

async function openAnalysis(page) {
  await selectClipByIndex(page, 0);
  const sec = page.locator('details.section', { has: page.locator('summary', { hasText: 'Analisi del video' }) });
  await sec.locator('summary').click();
  return sec;
}

test('analisi: «Dividi per scene» trova i tre tagli veri (±2 fotogrammi) e si annulla in un passo', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('scenes.webm')]);
    await addMedia(page, 0);
    await openAnalysis(page);
    await page.click('#btn-split-scenes');
    await page.waitForFunction(() => document.querySelectorAll('.clip.kind-video').length === 4, null, { timeout: 60000 });
    const cs = await videoClips(page);
    const starts = cs.map((c) => c.start);
    for (const [got, want] of starts.slice(1).map((v, i) => [v, [1.5, 3.5, 4.5][i]])) assert.ok(Math.abs(got - want) <= 0.07, `taglio a ${got} invece di ${want}`);
    assert.ok(cs.every((c, i) => !i || Math.abs(c.start - (cs[i - 1].start + cs[i - 1].duration)) < 1e-6), 'senza buchi');
    assert.ok(Math.abs(cs.at(-1).start + cs.at(-1).duration - 7) < 0.05, 'la durata totale non cambia');
    assert.equal(cs[0].in, 0);
    assert.ok(Math.abs(cs[2].in - 3.5) <= 0.07, 'ogni parte parte dal punto giusto del file');
    await page.evaluate(() => window.__ciak.store.undo());
    assert.equal((await videoClips(page)).length, 1);
  });
});

test('analisi: un video senza cambi di scena non viene toccato', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm')]);
    await addMedia(page, 0);
    await openAnalysis(page);
    await page.click('#btn-split-scenes');
    await page.waitForFunction(() => /Non ho trovato cambi di scena/.test(document.querySelector('.toasts')?.textContent ?? ''), null, { timeout: 60000 });
    assert.equal((await videoClips(page)).length, 1);
  });
});

test('analisi: «Momenti migliori» trova il movimento e il volume e fa il montaggio', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('hl.webm')]);
    await addMedia(page, 0);
    await openAnalysis(page);
    await page.click('#btn-highlights');
    await page.waitForSelector('#highlights-dialog');
    await page.fill('#hl-length', '5');
    await page.fill('#hl-count', '2');
    await page.click('#hl-run');
    await page.waitForSelector('#hl-list .hl-item', { timeout: 120000 });
    const items = await page.locator('#hl-list .sub-time').allTextContents();
    assert.equal(items.length, 2, items.join(' | '));
    const parse = (s) => s.split('→').map((x) => { const [mm, ss] = x.trim().split(':'); return Number(mm) * 60 + Number(ss); });
    const [a, b] = items.map(parse);
    assert.ok(Math.abs(a[0] - 10) <= 1.6 && Math.abs(a[1] - 15) <= 1.6, `movimento a ${a}`);
    assert.ok(Math.abs(b[0] - 20) <= 1.6 && Math.abs(b[1] - 25) <= 1.6, `volume a ${b}`);
    // marcatori
    await page.click('#hl-markers');
    assert.equal(await page.evaluate(() => window.__ciak.store.project.markers.length), 2);
    // montaggio: restano 10 s, due parti
    await page.click('#hl-montage');
    await page.waitForSelector('#highlights-dialog', { state: 'detached' });
    const cs = await videoClips(page);
    assert.equal(cs.length, 2);
    assert.ok(Math.abs(cs.reduce((s, c) => s + c.duration, 0) - 10) < 0.6);
    assert.ok(Math.abs(cs[0].in - a[0]) <= 0.2 && Math.abs(cs[1].in - b[0]) <= 0.2);
    assert.ok(Math.abs(cs[1].start - (cs[0].start + cs[0].duration)) < 1e-6, 'senza buchi');
    await page.evaluate(() => window.__ciak.store.undo());
    assert.equal((await videoClips(page)).length, 1);
  });
});

test('analisi: «Momenti migliori» senza un clip video selezionato avvisa e non apre nulla', async () => {
  await withApp(async ({ page }) => {
    await page.evaluate(() => window.__ciak.actions.openHighlights());
    assert.equal(await page.locator('#highlights-dialog').count(), 0);
    await page.waitForFunction(() => /Seleziona prima un clip video/.test(document.querySelector('.toasts')?.textContent ?? ''));
  });
});
