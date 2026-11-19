import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, importFiles, project, clips, pixel, seek, openTab, inspectorTab, setNum, addMedia, lum, waitText } from '../helpers/browser.js';
import { makeMedia } from '../helpers/make-media.js';

let env;
let m;
before(async () => {
  m = makeMedia();
  env = await launch();
});
after(async () => env?.close());

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≉ ${b} (±${eps})`);

async function withApp(fn) {
  const s = await env.open();
  try {
    await fn(s);
    assert.deepEqual(s.errors, [], 'nessun errore in console/pagina');
  } finally {
    await s.context.close();
  }
}

test('testo: aggiunta, modifica dal pannello e rendering sul canvas', async () => {
  await withApp(async ({ page }) => {
    await openTab(page, 'text');
    await page.click('#btn-add-text');
    await page.waitForSelector('.clip.kind-text');
    const [c] = await clips(page);
    assert.equal(c.kind, 'text');
    near(c.duration, 3, 1e-6);
    // sfondo nero + testo bianco: devono esserci pixel chiari al centro e nessuno agli angoli
    await seek(page, 1);
    const bright = await page.evaluate(() => {
      const cv = window.__ciak.preview.canvas;
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0, corner = 0;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        if (d[i] > 200 && d[i + 1] > 200) { n++; if (x < 20 && y < 20) corner++; }
      }
      return { n, corner };
    });
    assert.ok(bright.n > 300, `testo visibile (${bright.n} px chiari)`);
    assert.equal(bright.corner, 0);
    // modifica del contenuto dal pannello proprietà
    const ta = page.locator('.insp-body textarea').first();
    await ta.fill('Ciak Studio');
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].text.content === 'Ciak Studio');
    await waitText(page, '.clip.kind-text .clip-name', /Ciak Studio/);
    // cambio colore: il testo deve diventare rosso
    await page.locator('.ctl.color', { hasText: /^Colore$/ }).locator('input[type=color]').first().fill('#ff0000');
    await seek(page, 1);
    const red = await page.evaluate(() => {
      const cv = window.__ciak.preview.canvas;
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let r = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) r++; if (d[i] > 200 && d[i + 1] > 200) w++; }
      return { r, w };
    });
    assert.ok(red.r > 200 && red.w < red.r * 0.2, `testo rosso (${JSON.stringify(red)})`);
  });
});

test('filtro «Noir»: i colori diventano grigi', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm')]);
    await addMedia(page, 0);
    await page.waitForSelector('.clip');
    await seek(page, 1);
    const samples = [[0.2, 0.3], [0.8, 0.3], [0.5, 0.7], [0.3, 0.8]];
    let colorful = 0;
    for (const [x, y] of samples) {
      const [r, g, b] = await pixel(page, x, y);
      if (Math.max(r, g, b) - Math.min(r, g, b) > 40) colorful++;
    }
    assert.ok(colorful >= 1, 'il video di prova ha colori saturi');
    await page.locator('.clip').first().click();
    await openTab(page, 'filters');
    await page.locator('[data-filter="noir"]').click();
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].filter.id === 'noir');
    for (const [x, y] of samples) {
      const [r, g, b] = await pixel(page, x, y);
      assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 3, `pixel (${x},${y}) grigio: ${r},${g},${b}`);
    }
    // l'anteprima della scheda filtri è stata disegnata (non vuota)
    const thumbOk = await page.evaluate(() => [...document.querySelectorAll('.filter-thumb')].some((c) => c.getContext('2d').getImageData(10, 10, 1, 1).data[3] > 0));
    assert.ok(thumbOk);
  });
});

test('keyframe di opacità dal pannello: interpolazione lineare nel tempo', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('photo.png')]);
    await addMedia(page, 0);
    await page.locator('.clip').first().click();
    await seek(page, 0);
    await page.locator('.ctl.slider', { hasText: 'Opacità' }).locator('.kf-btn').click();
    await setNum(page, 'Opacità', 0);
    await seek(page, 2);
    await page.locator('.ctl.slider', { hasText: 'Opacità' }).locator('.kf-btn').click();
    await setNum(page, 'Opacità', 100);
    const c = (await clips(page))[0];
    assert.equal(c.keyframes.opacity.length, 2);
    near(c.keyframes.opacity[0].v, 0, 1e-6);
    near(c.keyframes.opacity[1].v, 1, 1e-6);
    await seek(page, 2);
    const full = await pixel(page, 0.5, 0.2);
    assert.ok(lum(full) > 60, 'riferimento visibile');
    await seek(page, 0);
    assert.ok(lum(await pixel(page, 0.5, 0.2)) < 4, 'a t=0 è trasparente');
    await seek(page, 1);
    const half = await pixel(page, 0.5, 0.2);
    near(lum(half) / lum(full), 0.5, 0.06, 'a metà ≈ 50%');
    // i diamanti dei keyframe sono mostrati sul clip selezionato
    assert.ok(await page.locator('.clip .kf-dot').count() >= 2);
  });
});

test('scala e posizione dal pannello: il contenuto si ridimensiona e si sposta', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('photo.png')]);
    await addMedia(page, 0);
    await page.locator('.clip').first().click();
    await seek(page, 1);
    assert.ok(lum(await pixel(page, 0.5, 0.5)) > 20);
    // l'immagine 4:3 in un canvas 16:9 occupa il 75% della larghezza: x=0.15 è dentro, 0.05 fuori
    assert.ok(lum(await pixel(page, 0.2, 0.5)) > 20, 'dentro il riquadro');
    await setNum(page, 'Scala', 40);
    await seek(page, 1);
    assert.ok(lum(await pixel(page, 0.2, 0.5)) < 4, 'con scala 40% il bordo è vuoto');
    assert.ok(lum(await pixel(page, 0.5, 0.5)) > 20, 'il centro resta pieno');
    await setNum(page, 'Posizione X', 30);
    await seek(page, 1);
    assert.ok(lum(await pixel(page, 0.8, 0.5)) > 20, 'spostato a destra');
    assert.ok(lum(await pixel(page, 0.5, 0.5)) < 20 || lum(await pixel(page, 0.35, 0.5)) < 4, 'centro/sinistra liberati');
    // doppio clic sull'etichetta ripristina
    await page.locator('.ctl.slider', { hasText: 'Scala' }).locator('.ctl-label').dblclick();
    assert.equal((await clips(page))[0].transform.scale, 1);
  });
});

test('chroma key: lo schermo verde diventa trasparente e il resto resta', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('green.webm')]);
    await openTab(page, 'elements');
    await page.locator('.swatch[aria-label="Sfondo #0a84ff"]').click();
    await page.waitForSelector('.clip.kind-shape');
    await openTab(page, 'media');
    await addMedia(page, 0);
    await page.waitForFunction(() => document.querySelectorAll('.clip').length === 2);
    const cs = await clips(page);
    const green = cs.find((c) => c.kind === 'video');
    const solid = cs.find((c) => c.kind === 'shape');
    const p = await project(page);
    assert.ok(p.tracks.findIndex((t) => t.clips.some((c) => c.id === green.id)) < p.tracks.findIndex((t) => t.clips.some((c) => c.id === solid.id)), 'il video sta sopra lo sfondo');
    await page.locator('.clip.kind-video').click();
    await seek(page, 1);
    let [r, g, b] = await pixel(page, 0.1, 0.5);
    assert.ok(g > 200 && r < 40 && b < 40, `verde puro senza chroma: ${r},${g},${b}`);
    await inspectorTab(page, 'Regolazione');
    await page.locator('details.section', { hasText: 'Schermo verde' }).locator('summary').click();
    await page.locator('.ctl.toggle', { hasText: 'Attiva' }).locator('.switch').click();
    await seek(page, 1);
    [r, g, b] = await pixel(page, 0.1, 0.5);
    assert.ok(b > 200 && r < 60 && g < 160, `con chroma si vede lo sfondo blu: ${r},${g},${b}`);
    [r, g, b] = await pixel(page, 0.5, 0.5);
    assert.ok(r > 200 && g < 60 && b < 60, `il quadrato rosso resta: ${r},${g},${b}`);
  });
});

test('transizione «dissolvenza nel nero»: sovrapposizione reale e buio a metà', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm'), m.f('b.webm')]);
    await addMedia(page, 0);
    await page.evaluate(() => window.__ciak.player.seek(4.01));
    await addMedia(page, 1);
    await page.waitForFunction(() => document.querySelectorAll('.clip').length === 2);
    let cs = await clips(page);
    assert.equal(new Set(cs.map((c) => c.track)).size, 1, 'i due clip stanno sulla stessa traccia');
    const bClip = cs.find((c) => c.start > 1);
    await page.locator('.clip').filter({ hasText: 'b.webm' }).click();
    await openTab(page, 'transitions');
    await page.locator('[data-transition="dip-black"]').click();
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).some((c) => c.transition));
    cs = (await clips(page)).sort((a, b) => a.start - b.start);
    const [a, b] = cs;
    assert.ok(b.start < a.start + a.duration - 0.5, `sovrapposti: b.start=${b.start} a.end=${a.start + a.duration}`);
    near(b.transition.duration, 0.8, 1e-6);
    const mid = b.start + b.transition.duration / 2;
    await seek(page, mid);
    const [r, g, bl] = await pixel(page, 0.5, 0.5);
    assert.ok(r + g + bl < 12, `a metà della dissolvenza nel nero lo schermo è nero (${r},${g},${bl})`);
    await seek(page, b.start - 0.1);
    assert.ok(lum(await pixel(page, 0.5, 0.5)) > 20, 'prima della transizione si vede il primo clip');
    await seek(page, b.start + b.transition.duration + 0.3);
    assert.ok(lum(await pixel(page, 0.5, 0.5)) > 20, 'dopo la transizione si vede il secondo clip');
    // rimuovendo la transizione i clip tornano adiacenti
    await page.locator('[data-transition="none"]').click();
    await page.waitForFunction(() => !window.__ciak.store.project.tracks.flatMap((t) => t.clips).some((c) => c.transition));
    cs = (await clips(page)).sort((x, y) => x.start - y.start);
    near(cs[1].start, cs[0].start + cs[0].duration, 1e-6);
    assert.ok(bClip);
  });
});

test('velocità 2×: dimezza la durata e il video segue la sorgente alla velocità giusta', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm')]);
    await addMedia(page, 0);
    await page.locator('.clip').first().click();
    await inspectorTab(page, 'Velocità');
    await page.locator('.chip[data-speed="2"]').click();
    await page.waitForFunction(() => Math.abs(window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].speed - 2) < 1e-6);
    const c = (await clips(page))[0];
    near(c.duration, 2, 0.02);
    await waitText(page, '.clip .badge', /2/);
    await seek(page, 1);
    const cur = await page.evaluate(() => window.__ciak.pool.peek(window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].id).currentTime);
    near(cur, 2, 0.1, 'a t=1 della timeline la sorgente è a 2 s');
    // riproduzione a 2×: dopo ~1 s di timeline il video ha percorso ~2 s
    await seek(page, 0);
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__ciak.player.time > 0.8);
    const st = await page.evaluate(() => {
      const a = window.__ciak;
      const el = a.pool.peek(a.store.project.tracks.flatMap((t) => t.clips)[0].id);
      return { t: a.player.time, el: el.currentTime, rate: el.playbackRate };
    });
    await page.click('#btn-play');
    near(st.el, st.t * 2, 0.5, 'sorgente ≈ 2× timeline');
    assert.ok(st.rate > 1.7 && st.rate < 2.3, `playbackRate ${st.rate}`);
  });
});

test('cambio formato 9:16: il canvas dell\'anteprima cambia proporzioni', async () => {
  await withApp(async ({ page }) => {
    await page.locator('.aspect-btn[data-aspect="9:16"]').click();
    await page.waitForFunction(() => window.__ciak.store.project.settings.height === 1920);
    const d = await page.evaluate(() => {
      const c = window.__ciak.preview.canvas;
      const r = c.getBoundingClientRect();
      return { w: c.width, h: c.height, cssW: r.width, cssH: r.height };
    });
    near(d.w / d.h, 9 / 16, 0.01, 'proporzioni del canvas');
    near(d.cssW / d.cssH, 9 / 16, 0.02, 'proporzioni a schermo');
    await page.locator('.aspect-btn[data-aspect="1:1"]').click();
    await page.waitForFunction(() => window.__ciak.store.project.settings.width === 1080 && window.__ciak.store.project.settings.height === 1080);
  });
});

test('il primo video importato imposta il formato del progetto', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('portrait.webm')]);
    await page.waitForFunction(() => window.__ciak.store.project.settings.height > window.__ciak.store.project.settings.width);
    const s = (await project(page)).settings;
    assert.equal(s.width, 1080);
    assert.equal(s.height, 1920);
  });
});

test('maschera circolare: gli angoli diventano trasparenti', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('photo.png')]);
    await addMedia(page, 0);
    await page.locator('.clip').first().click();
    await seek(page, 1);
    assert.ok(lum(await pixel(page, 0.26, 0.1)) > 20, 'angolo visibile prima della maschera');
    await page.locator('details.section', { hasText: 'Maschera' }).locator('summary').click().catch(() => {});
    await page.locator('.ctl.select', { hasText: 'Forma' }).locator('select').selectOption('circle');
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].mask.shape === 'circle');
    await seek(page, 1);
    assert.ok(lum(await pixel(page, 0.26, 0.1)) < 4, 'angolo mascherato');
    assert.ok(lum(await pixel(page, 0.5, 0.5)) > 20, 'centro visibile');
  });
});

test('estrai audio e fotogramma fisso dal menu contestuale', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm')]);
    await addMedia(page, 0);
    await page.locator('.clip').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Estrai audio/ }).click();
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).some((c) => c.kind === 'audio'));
    let cs = await clips(page);
    const v = cs.find((c) => c.kind === 'video');
    const a = cs.find((c) => c.kind === 'audio');
    assert.equal(v.muted, true);
    near(a.duration, v.duration, 1e-6);
    near(a.in, v.in, 1e-6);
    assert.equal((await project(page)).tracks.find((t) => t.clips.some((c) => c.id === a.id)).type, 'audio');

    await seek(page, 1.5);
    await page.locator('.clip.kind-video').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Fotogramma fisso/ }).click();
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).some((c) => c.kind === 'image'));
    cs = (await clips(page)).filter((c) => c.kind !== 'audio').sort((x, y) => x.start - y.start);
    assert.equal(cs.length, 3);
    assert.equal(cs[1].kind, 'image');
    near(cs[1].duration, 2, 1e-6);
    near(cs[1].start, cs[0].start + cs[0].duration, 1e-6);
    near(cs[2].start, cs[1].start + 2, 1e-6);
    // il fermo immagine si vede sul canvas
    await seek(page, cs[1].start + 0.5);
    // il fermo immagine è un file appena creato: la sua decodifica può richiedere un attimo, quindi si riprova
    let bright = 0;
    for (let i = 0; i < 20 && bright <= 10; i++) {
      bright = lum(await pixel(page, 0.5, 0.5));
      if (bright <= 10) await page.waitForTimeout(150);
    }
    assert.ok(bright > 10, `il fermo immagine si vede (luminosità ${bright})`);
  });
});

test('marcatori e calamita da tastiera', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm')]);
    await addMedia(page, 0);
    await seek(page, 1.5);
    await page.locator('.tl-scroll').focus();
    await page.keyboard.press('m');
    await page.waitForSelector('.marker');
    near((await project(page)).markers[0].time, 1.5, 0.04);
    assert.equal(await page.locator('#btn-marker').count(), 1);
    const before = await page.locator('.tl-toolbar [aria-pressed]').first().getAttribute('aria-pressed');
    await page.keyboard.press('n');
    const after = await page.locator('.tl-toolbar [aria-pressed]').first().getAttribute('aria-pressed');
    assert.notEqual(before, after);
    await page.locator('.marker').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Elimina marcatore/ }).click();
    await page.waitForFunction(() => window.__ciak.store.project.markers.length === 0);
  });
});

test('cache dell\'aspetto statico: stesso risultato del percorso diretto e invalidata alle modifiche', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('photo.png')]);
    await addMedia(page, 0);
    const r = await page.evaluate(async () => {
      const a = window.__ciak;
      const find = () => a.store.project.tracks.flatMap((t) => t.clips)[0];
      a.store.commit('fx', (d) => {
        const c = d.tracks.flatMap((t) => t.clips)[0];
        c.filter = { id: 'cinema', intensity: 1 };
        c.adjust.blur = 10;
        c.effects.push({ id: 'p', type: 'pixelate', amount: 30 });
        c.effects.push({ id: 'r', type: 'rgb-split', amount: 40 });
      });
      const cv = document.createElement('canvas');
      cv.width = 640; cv.height = 360;
      const g = cv.getContext('2d', { willReadFrequently: true });
      const grab = () => { a.renderer.render(g, a.store.project, 1); return g.getImageData(0, 0, 640, 360).data.slice(); };
      const diff = (x, y) => { let s = 0; for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i]); return s / x.length; };
      a.renderer.lookHits = 0; a.renderer.lookBuilds = 0;
      const f1 = grab();          // 1° fotogramma: percorso diretto
      const f2 = grab();          // 2°: stabile → costruisce la cache
      const f3 = grab();          // 3°: cache
      const f4 = grab();
      const out = { d12: diff(f1, f2), d13: diff(f1, f3), d14: diff(f1, f4), hits: a.renderer.lookHits, builds: a.renderer.lookBuilds };
      // modifica del filtro: la cache deve essere invalidata (colore → grigio)
      a.store.commit('noir', (d) => { d.tracks.flatMap((t) => t.clips)[0].filter = { id: 'noir', intensity: 1 }; });
      grab(); grab();
      const f5 = grab();
      let maxChroma = 0;
      for (let i = 0; i < f5.length; i += 4) maxChroma = Math.max(maxChroma, Math.max(f5[i], f5[i + 1], f5[i + 2]) - Math.min(f5[i], f5[i + 1], f5[i + 2]));
      out.noirDiffFromBefore = diff(f1, f5);
      out.maxChromaAfterNoir = maxChroma;
      // modifica della scala: la cache deve seguire la nuova dimensione
      a.store.commit('scale', (d) => { d.tracks.flatMap((t) => t.clips)[0].transform.scale = 0.5; });
      grab(); grab();
      const f6 = grab();
      const corner = (f6[0] + f6[1] + f6[2]);
      out.cornerAfterScale = corner;
      void find;
      return out;
    });
    assert.ok(r.d12 < 0.8 && r.d13 < 0.8 && r.d14 < 0.8, `cache ≈ percorso diretto (differenza media ${r.d12.toFixed(3)}/${r.d13.toFixed(3)}/${r.d14.toFixed(3)})`);
    assert.ok(r.hits >= 2 && r.builds >= 1, `la cache è stata usata (hit ${r.hits}, build ${r.builds})`);
    assert.ok(r.noirDiffFromBefore > 5, 'cambiando filtro il risultato cambia (cache invalidata)');
    assert.ok(r.maxChromaAfterNoir <= 4, `dopo «Noir» tutto è grigio (croma massima ${r.maxChromaAfterNoir})`);
    assert.equal(r.cornerAfterScale, 0, 'dopo aver ridotto la scala l\'angolo è vuoto (nessun frame obsoleto)');
  });
});
