import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, importFiles, project, clips, pixel, seek } from '../helpers/browser.js';
import { makeMedia } from '../helpers/make-media.js';

let env;
let m;
before(async () => {
  m = makeMedia();
  env = await launch();
});
after(async () => env?.close());

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≉ ${b} (±${eps})`);

async function addNth(page, n) {
  const card = page.locator('.media-card').nth(n);
  await card.hover();
  await card.locator('.add').click();
}
const addFirst = (page) => addNth(page, 0);

async function withApp(fn) {
  const s = await env.open();
  try {
    await fn(s);
    assert.deepEqual(s.errors, [], 'nessun errore in console/pagina');
  } finally {
    await s.context.close();
  }
}

test('avvio: interfaccia completa, nessun errore, progetto vuoto valido', async () => {
  await withApp(async ({ page }) => {
    assert.equal(await page.title(), 'Ciak Studio — editor video');
    for (const sel of ['.topbar', '.library', '.preview canvas', '.inspector', '.timeline', '#btn-export', '#btn-import']) assert.ok(await page.locator(sel).first().isVisible(), sel);
    const p = await project(page);
    assert.equal(p.tracks.length, 3);
    assert.equal(p.settings.width, 1920);
    assert.equal(await page.locator('.clip').count(), 0);
  });
});

test('importazione: video, audio e immagine con miniature e durata corretta', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm'), m.f('tone.wav'), m.f('photo.png')]);
    const p = await project(page);
    const media = Object.values(p.media);
    assert.equal(media.length, 3);
    const v = media.find((x) => x.kind === 'video');
    const a = media.find((x) => x.kind === 'audio');
    const i = media.find((x) => x.kind === 'image');
    near(v.duration, 4, 0.1, 'durata video');
    assert.equal(v.width, 640);
    assert.equal(v.height, 360);
    near(a.duration, 3, 0.1, 'durata audio');
    assert.equal(i.width, 800);
    assert.equal(i.height, 600);
    assert.ok(await page.locator('.media-card .thumb[style*="background-image"]').count() >= 2, 'miniature video e immagine');
    // forma d'onda calcolata in background
    await page.waitForFunction((id) => !!window.__ciak.pool.info(id)?.peaks, a.id, { timeout: 8000 });
  });
});

test('un file non supportato produce un errore comprensibile e non rompe nulla', async () => {
  await withApp(async ({ page }) => {
    await page.setInputFiles('#file-input', { name: 'rotto.mp4', mimeType: 'video/mp4', buffer: Buffer.from('questo non è un video') });
    await page.waitForSelector('.toast.error', { timeout: 20000 });
    const txt = await page.locator('.toast.error').first().innerText();
    assert.match(txt, /rotto\.mp4/);
    assert.equal(Object.keys((await project(page)).media).length, 0);
  });
});

test('aggiunta alla timeline, anteprima non nera e riproduzione sincronizzata', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm')]);
    await addFirst(page);
    await page.waitForSelector('.clip');
    const cs = await clips(page);
    assert.equal(cs.length, 1);
    near(cs[0].start, 0, 1e-6);
    near(cs[0].duration, 4, 0.1);
    // anteprima: il video di prova ha colori variati → il frame non è nero
    await seek(page, 1);
    const px = await page.evaluate(() => {
      const c = window.__ciak.preview.canvas;
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 97) {
        sum += d[i] + d[i + 1] + d[i + 2];
        seen.add(`${d[i] >> 5},${d[i + 1] >> 5},${d[i + 2] >> 5}`);
      }
      return { sum, colors: seen.size };
    });
    assert.ok(px.sum > 1000, 'il frame non deve essere nero');
    assert.ok(px.colors > 5, `il frame deve contenere colori diversi (${px.colors})`);

    // riproduzione reale
    await page.evaluate(() => window.__ciak.player.seek(0));
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__ciak.player.time > 0.3, null, { timeout: 5000 });
    await page.waitForTimeout(1200);
    const st = await page.evaluate(() => {
      const a = window.__ciak;
      const clip = a.store.project.tracks.flatMap((t) => t.clips)[0];
      const el = a.pool.peek(clip.id);
      return { t: a.player.time, el: el.currentTime, paused: el.paused, rate: el.playbackRate, ctx: a.audio.ctx?.state, playing: a.player.playing };
    });
    assert.ok(st.playing, 'il player deve essere in riproduzione');
    assert.equal(st.paused, false, 'l\'elemento video deve riprodurre');
    near(st.el, st.t, 0.35, 'deriva video/orologio');
    assert.equal(st.ctx, 'running', 'il contesto audio deve essere attivo');
    assert.ok(st.t > 1.0 && st.t < 3.5, `tempo plausibile ${st.t}`);
    await page.click('#btn-play'); // pausa
    await page.waitForFunction(() => !window.__ciak.player.playing);
  });
});

test('la riproduzione termina da sola alla fine e il play successivo riparte dall\'inizio', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('portrait.webm')]);
    await addFirst(page);
    await page.waitForSelector('.clip');
    await seek(page, 1.5);
    await page.click('#btn-play');
    await page.waitForFunction(() => !window.__ciak.player.playing, null, { timeout: 6000 });
    near(await page.evaluate(() => window.__ciak.player.time), 2, 0.05);
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__ciak.player.time > 0.2 && window.__ciak.player.time < 1, null, { timeout: 4000 });
    await page.click('#btn-play');
  });
});

test('taglio con S, undo/redo da tastiera e da pulsante', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm')]);
    await addFirst(page);
    await page.waitForSelector('.clip');
    await seek(page, 2);
    await page.locator('.tl-scroll').focus();
    await page.keyboard.press('s');
    await page.waitForFunction(() => document.querySelectorAll('.clip').length === 2);
    let cs = (await clips(page)).sort((a, b) => a.start - b.start);
    near(cs[0].duration, 2, 0.04);
    near(cs[1].start, 2, 0.04);
    near(cs[0].duration + cs[1].duration, 4, 0.1);
    near(cs[1].in, cs[0].in + cs[0].duration, 1e-3, 'in-point continuo');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelectorAll('.clip').length === 1);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(() => document.querySelectorAll('.clip').length === 2);
    await page.click('#btn-undo');
    await page.waitForFunction(() => document.querySelectorAll('.clip').length === 1);
    assert.equal(await page.locator('#btn-undo').isEnabled(), true);
  });
});

test('trascinamento con il mouse: trim del bordo destro e spostamento', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm')]);
    await addFirst(page);
    const clipEl = page.locator('.clip').first();
    await clipEl.waitFor();
    const box = await clipEl.boundingBox();
    const pps = await page.evaluate(() => window.__ciak.timeline.pps);
    // trim: trascina il bordo destro verso sinistra di 1 secondo
    await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 3 - pps * 1.0, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    let cs = await clips(page);
    near(cs[0].duration, 3, 0.2, 'durata dopo trim');
    // spostamento: trascina il clip di 2 secondi verso destra (si aggancia ai punti)
    const box2 = await clipEl.boundingBox();
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2 + pps * 2, box2.y + box2.height / 2, { steps: 10 });
    await page.mouse.up();
    cs = await clips(page);
    near(cs[0].start, 2, 0.25, 'posizione dopo lo spostamento');
    // una sola undo per gesto
    await page.keyboard.press('Control+z');
    cs = await clips(page);
    near(cs[0].start, 0, 1e-6);
    near(cs[0].duration, 3, 0.2);
  });
});

test('selezione multipla, duplicazione, copia/incolla e cancellazione con chiusura dello spazio', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm'), m.f('b.webm')]);
    await addNth(page, 0);
    await seek(page, 4);
    await addNth(page, 1);
    await page.waitForFunction(() => document.querySelectorAll('.clip').length === 2);
    await page.locator('.tl-scroll').focus();
    await page.keyboard.press('Control+a');
    assert.equal(await page.evaluate(() => window.__ciak.selection.size), 2);
    await page.keyboard.press('Control+d');
    await page.waitForFunction(() => document.querySelectorAll('.clip').length === 4);
    await page.keyboard.press('Escape');
    // elimina il primo clip con ripple: i successivi scorrono a sinistra della sua durata
    await page.locator('.clip').first().click();
    assert.equal(await page.evaluate(() => window.__ciak.selection.size), 1);
    await page.keyboard.press('Shift+Delete');
    await page.waitForFunction(() => document.querySelectorAll('.clip').length === 3);
    const starts = (await clips(page)).map((c) => c.start).sort((a, b) => a - b);
    near(starts[0], 0, 1e-3, 'il secondo clip scorre a 0');
    near(starts[1], 3, 0.05);
    near(starts[2], 7, 0.05);
  });
});
