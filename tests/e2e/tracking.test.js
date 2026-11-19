// Inseguimento di un punto e inquadratura automatica, su video veri con movimento noto.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, importFiles, clips, addMedia, seek, selectClipByIndex, inspectorTab } from '../helpers/browser.js';
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
const openSection = async (page, title) => {
  const sec = page.locator('details.section', { has: page.locator('summary', { hasText: title }) });
  if (!(await sec.evaluate((e) => e.open))) await sec.locator('summary').click();
  return sec;
};
const toasts = (page) => page.evaluate(() => document.querySelector('.toasts')?.textContent ?? '');

test('inseguimento: un testo segue un punto di una ripresa con la camera che si muove (errore < 1,2% del quadro sui fotogrammi seguiti)', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('shaky.webm')]);
    await addMedia(page, 0);
    await seek(page, 0);
    await page.evaluate(() => window.__ciak.actions.addText());
    await page.waitForSelector('.clip.kind-text');
    // il testo è selezionato: la sezione di inseguimento propone il video
    await inspectorTab(page, 'Video');
    const sec = await openSection(page, 'Segui un oggetto del video');
    assert.ok((await sec.locator('#track-video option').count()) === 1);
    await sec.locator('#btn-track-pick').click();
    assert.equal(await page.locator('.stage-box.picking').count(), 1, 'modalità «scegli il punto» attiva');
    // clic al centro dell'anteprima = pixel (320,180) del video
    const box = await page.locator('.preview-canvas').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'text')?.keyframes?.x?.length > 1, null, { timeout: 60000 });
    assert.equal(await page.locator('.stage-box.picking').count(), 0, 'la modalità finisce dopo il clic');
    const res = await page.evaluate(() => {
      const a = window.__ciak;
      const p = a.store.project;
      const text = p.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'text');
      const { width: W, height: H } = p.settings;
      // il video mostra il fotogramma (30 fps) che precede l'istante t: è quello il punto che si vede
      // (i tempi dei fotogrammi nel file sono arrotondati al millisecondo: a cavallo di un fotogramma può comparire quello prima o quello dopo)
      const truth = (t, back) => {
        const tf = (Math.floor(t * 30 + 1e-6) - back) / 30;
        const ox = 130 + 40 * Math.sin(2 * Math.PI * tf * 2);
        const oy = 110 + 30 * Math.cos(2 * Math.PI * tf * 3);
        return { x: ((450 - ox) / 640) * W, y: ((320 - oy) / 360) * H };
      };
      const err = (t) => {
        const g = a.renderer.geometry(p, text, t, W, H);
        const c = [0, 1].map((back) => { const q = truth(t, back); return { dx: (g.cx - q.x) / W, dy: (g.cy - q.y) / H }; });
        const best = c.sort((u, v) => Math.hypot(u.dx, u.dy) - Math.hypot(v.dx, v.dy))[0];
        return { t, ...best };
      };
      const kfTimes = text.keyframes.x.map((k) => text.start + k.t).filter((t) => t < 2.95);
      return { atKeyframes: kfTimes.map(err), between: [0.15, 0.4, 0.7, 1.0, 1.4, 1.9, 2.4, 2.8].map(err), n: text.keyframes.x.length };
    });
    assert.ok(res.n >= 8, `keyframe ${res.n}`);
    for (const r of res.atKeyframes) assert.ok(Math.abs(r.dx) < 0.012 && Math.abs(r.dy) < 0.012, `keyframe a ${r.t.toFixed(2)}s: scarto ${(r.dx * 100).toFixed(2)}% , ${(r.dy * 100).toFixed(2)}%`);
    // fra un keyframe e l'altro il video salta di fotogramma in fotogramma mentre l'elemento scivola: scarto massimo ≈ 1 fotogramma di scossa
    for (const r of res.between) assert.ok(Math.abs(r.dx) < 0.035 && Math.abs(r.dy) < 0.035, `t=${r.t}: scarto ${(r.dx * 100).toFixed(1)}% , ${(r.dy * 100).toFixed(1)}%`);
    assert.match(await toasts(page), /segue il punto|Fatto/);
    // un solo passo di annullamento
    await page.evaluate(() => window.__ciak.store.undo());
    assert.equal(await page.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'text').keyframes.x?.length ?? 0), 0);
  });
});

test('inseguimento: Esc annulla la scelta; punto fuori dal video o testina fuori dal clip avvisano', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('shaky.webm')]);
    await addMedia(page, 0);
    await seek(page, 0);
    await page.evaluate(() => window.__ciak.actions.addText());
    await page.waitForSelector('.clip.kind-text');
    await inspectorTab(page, 'Video');
    const sec = await openSection(page, 'Segui un oggetto del video');
    await sec.locator('#btn-track-pick').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.stage-box.picking').count(), 0);
    // punto vicino al bordo
    const ids = await page.evaluate(() => { const c = window.__ciak.store.project.tracks.flatMap((t) => t.clips); return { text: c.find((x) => x.kind === 'text').id, video: c.find((x) => x.kind === 'video').id }; });
    await page.evaluate(({ text, video }) => window.__ciak.actions.trackObject({ overlayId: text, videoId: video, px: 5, py: 5 }), ids);
    await page.waitForFunction(() => /fuori dal video o troppo vicino/.test(document.querySelector('.toasts')?.textContent ?? ''));
    // testina oltre la fine
    await seek(page, 3.0);
    await page.evaluate(({ text, video }) => window.__ciak.actions.trackObject({ overlayId: text, videoId: video, px: 960, py: 540 }), ids);
    await page.waitForFunction(() => /Metti la testina|File non/.test(document.querySelector('.toasts')?.textContent ?? ''));
    assert.equal(await page.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'text').keyframes.x?.length ?? 0), 0, 'nulla è cambiato');
  });
});

test('inquadratura automatica: 16:9 → 9:16, il quadrato rosso in movimento resta in vista', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('mover.webm')]);
    await addMedia(page, 0);
    await page.evaluate(() => window.__ciak.actions.setAspect({ width: 1080, height: 1920 }));
    await selectClipByIndex(page, 0);
    const sec = await openSection(page, 'Analisi del video');
    await sec.locator('#btn-reframe').click();
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'video')?.keyframes?.x?.length > 1, null, { timeout: 60000 });
    const info = await page.evaluate(async () => {
      const a = window.__ciak;
      const p = a.store.project;
      const clip = p.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'video');
      const { width: W, height: H } = p.settings;
      const rows = [];
      for (const t of [0.3, 0.9, 1.5, 2.1, 2.7, 3.3, 3.9, 4.5, 5.1, 5.7]) {
        const g = a.renderer.geometry(p, clip, t, W, H);
        const uc = 0.5 - (g.cx - W / 2) / g.w; // dove, nel video, sta il centro dell'inquadratura
        const f = 0.12 + 0.76 * (0.5 - 0.5 * Math.cos(t * 0.9));
        const usq = (560 * f + 40) / 640;
        rows.push({ t, uc, usq, d: uc - usq, w: g.w / W, h: g.h / H });
      }
      return { rows, scale: clip.keyframes.scale?.[0]?.v };
    });
    assert.ok(Math.abs(info.scale - (16 / 9) / (9 / 16)) < 0.01, `scala ${info.scale}`);
    const visible = (9 / 16) / (16 / 9);
    const inView = info.rows.filter((r) => Math.abs(r.d) <= visible / 2 - 0.0625 + 0.02);
    assert.ok(inView.length >= 9, `il quadrato è tutto in vista in ${inView.length} di ${info.rows.length} istanti: ${info.rows.map((r) => r.d.toFixed(2))}`);
    // e anche nei pixel: si vede davvero del rosso nell'anteprima
    for (const t of [0.9, 2.7, 4.5]) {
      await seek(page, t);
      const red = await page.evaluate(() => {
        const c = window.__ciak.preview.canvas;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 170 && d[i + 1] < 90 && d[i + 2] < 90) n++;
        return { n, area: c.width * c.height };
      });
      assert.ok(red.n > red.area * 0.03, `a ${t}s il rosso occupa ${(red.n / red.area * 100).toFixed(1)}%`);
    }
    await page.evaluate(() => window.__ciak.store.undo());
    assert.equal(await page.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'video').keyframes.x?.length ?? 0), 0);
  });
});

test('inquadratura automatica: stesso formato senza zoom non fa nulla; con ritaglio avvisa', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('mover.webm')]);
    await addMedia(page, 0);
    await selectClipByIndex(page, 0);
    const sec = await openSection(page, 'Analisi del video');
    await sec.locator('#btn-reframe').click();
    await page.waitForFunction(() => /ha già le proporzioni/.test(document.querySelector('.toasts')?.textContent ?? ''));
    assert.equal(await page.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'video').keyframes.x?.length ?? 0), 0);
    // con zoom si può seguire il soggetto anche nello stesso formato
    await sec.locator('#reframe-zoom').evaluate((e) => { e.value = 160; });
    await sec.locator('#btn-reframe').click();
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'video')?.keyframes?.x?.length > 1, null, { timeout: 60000 });
    const sc = await page.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'video').keyframes.scale[0].v);
    assert.ok(Math.abs(sc - 1.6) < 0.01);
    await page.evaluate(() => window.__ciak.store.undo());
    await page.evaluate(() => window.__ciak.commit('Ritaglio', (d) => { d.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'video').crop.l = 0.2; }));
    await page.evaluate(() => window.__ciak.actions.autoReframe({ zoom: 1.5 }));
    await page.waitForFunction(() => /Azzera prima il ritaglio/.test(document.querySelector('.toasts')?.textContent ?? ''));
  });
});
