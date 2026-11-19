import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, importFiles, project, clips, pixel, seek, openTab, addMedia, lum } from '../helpers/browser.js';
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

/** Stato di un clip: rotazione, scala e ingombro (bounding box) in px del canvas del progetto. */
const state = (page, index = 0) =>
  page.evaluate((i) => {
    const a = window.__ciak;
    const p = a.store.project;
    const c = p.tracks.flatMap((t) => t.clips).filter((x) => x.kind !== 'audio')[i];
    const { width: W, height: H } = p.settings;
    const g = a.renderer.geometry(p, c, a.player.time, W, H);
    const r = (Math.abs(c.transform.rotation) * Math.PI) / 180;
    const bw = g.w * Math.abs(Math.cos(r)) + g.h * Math.abs(Math.sin(r));
    const bh = g.w * Math.abs(Math.sin(r)) + g.h * Math.abs(Math.cos(r));
    return { id: c.id, rot: c.transform.rotation, scale: c.transform.scale, flipX: c.transform.flipX, cx: g.cx, cy: g.cy, bw, bh, left: g.cx - bw / 2, right: g.cx + bw / 2, top: g.cy - bh / 2, bottom: g.cy + bh / 2, W, H };
  }, index);

async function openLayout(page) {
  await page.click('#btn-layout');
  await page.waitForSelector('#layout-panel:not([hidden])');
}
const setRange = (page, v) =>
  page.evaluate((val) => {
    const el = document.querySelector('#layout-range');
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, v);
const waitRot = (page, v) => page.waitForFunction((x) => Math.abs(window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].transform.rotation - x) < 1e-6, v);

test('Layout: il pulsante apre e chiude il pannello (clic, tasto Y, Esc) senza perdere la selezione', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm')]);
    await addMedia(page, 0);
    await page.locator('.clip').first().click();
    assert.equal(await page.locator('#layout-panel').isHidden(), true);
    await openLayout(page);
    assert.equal(await page.locator('#btn-layout').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#layout-target').innerText(), /a\.webm/);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#layout-panel', { state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__ciak.selection.size), 1, 'Esc chiude il pannello ma non deseleziona');
    await page.keyboard.press('y');
    await page.waitForSelector('#layout-panel:not([hidden])');
    await page.click('#btn-layout');
    await page.waitForSelector('#layout-panel', { state: 'hidden' });
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__ciak.selection.size), 0, 'senza pannello Esc deseleziona');
  });
});

test('Layout: si aggancia alla colonna delle proprietà e NON copre l\'anteprima né la timeline', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm')]);
    await addMedia(page, 0);
    await page.locator('.clip').first().click();
    await openLayout(page);
    const boxes = await page.evaluate(() => {
      const r = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
      const panel = r('#layout-panel');
      return { panel, canvas: r('.preview-canvas'), timeline: r('.timeline'), docked: document.querySelector('#layout-panel').classList.contains('docked'), insideInspector: !!document.querySelector('.inspector #layout-panel'), vh: innerHeight, vw: innerWidth };
    });
    assert.equal(boxes.docked, true);
    assert.equal(boxes.insideInspector, true);
    const overlap = (a, b) => a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;
    assert.equal(overlap(boxes.panel, boxes.canvas), false, 'il pannello non copre il video');
    assert.equal(overlap(boxes.panel, boxes.timeline), false, 'il pannello non copre la timeline');
    // si vede per intero (anche le disposizioni in fondo) scorrendo il solo pannello
    await page.locator('#layout-preset-pip').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('#layout-preset-pip').isVisible());
    // chiudendo tornano le proprietà normali
    await page.click('#btn-layout');
    await page.waitForSelector('#layout-panel', { state: 'hidden' });
    assert.ok(await page.locator('.insp-tabs').isVisible());
    // a schermo stretto (colonna delle proprietà nascosta) diventa una finestra mobile e funziona comunque
    await page.setViewportSize({ width: 560, height: 800 });
    await page.waitForTimeout(200);
    await page.click('#btn-layout');
    await page.waitForSelector('#layout-panel:not([hidden])');
    assert.equal(await page.evaluate(() => document.querySelector('#layout-panel').classList.contains('docked')), false);
    await page.click('#layout-rot-cw');
    await waitRot(page, 90);
  });
});

test('Layout: ruota di 90° adattando al quadro, torna indietro, ingrandisce e riduce', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm')]);
    await addMedia(page, 0);
    await page.locator('.clip').first().click();
    await seek(page, 1);
    await openLayout(page);

    let s = await state(page);
    near(s.scale, 1, 1e-9);
    near(s.bw, 1920, 1);

    await page.click('#layout-rot-cw');
    await waitRot(page, 90);
    s = await state(page);
    near(s.scale, 0.5625, 1e-6, 'un 16:9 ruotato di 90° si rimpicciolisce per restare nel quadro');
    near(s.bh, 1080, 1, 'ingombro alto quanto il quadro');
    assert.ok(s.bw < 700 && s.left >= -1 && s.right <= 1921, `entra nel quadro: ${s.left}..${s.right}`);
    // sul canvas il video è ora verticale: bordi neri a sinistra e a destra, contenuto al centro
    assert.ok(lum(await pixel(page, 0.15, 0.5)) < 4, 'bordo sinistro nero');
    assert.ok(lum(await pixel(page, 0.85, 0.5)) < 4, 'bordo destro nero');
    assert.ok((await pixel(page, 0.5, 0.5)).slice(0, 3).some((v) => v > 20), 'centro visibile');
    assert.equal(await page.locator('#layout-rot').innerText(), '90°');

    await page.click('#layout-rot-cw');
    await waitRot(page, 180);
    near((await state(page)).scale, 1, 1e-6, 'a 180° il clip torna adattato');
    await page.click('#layout-rot-ccw');
    await page.click('#layout-rot-ccw');
    await waitRot(page, 0);
    near((await state(page)).scale, 1, 1e-6);

    await page.click('#layout-plus');
    near((await state(page)).scale, 1.1, 1e-6);
    await page.click('#layout-minus');
    near((await state(page)).scale, 1, 1e-6);

    await setRange(page, 200);
    near((await state(page)).scale, 2, 1e-6, 'cursore di ingrandimento');
    await page.waitForFunction(() => document.querySelector('#layout-scale').textContent === '200%'); // l'etichetta si aggiorna al frame successivo
    await page.keyboard.press('Control+z');
    near((await state(page)).scale, 1, 1e-6, 'un solo annulla per l\'intero trascinamento del cursore');
  });
});

test('Layout: sposta dove vuoi (griglia, frecce, Maiusc), adatta/riempi, specchio e ripristina', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm')]);
    await addMedia(page, 0);
    await page.locator('.clip').first().click();
    await seek(page, 1);
    await openLayout(page);
    await setRange(page, 50);
    let s = await state(page);
    near(s.bw, 960, 1);

    await page.click('.pos-btn[data-ax="-1"][data-ay="-1"]');
    s = await state(page);
    near(s.left, 0, 1, 'tocca il bordo sinistro');
    near(s.top, 0, 1, 'tocca il bordo alto');
    await page.click('.pos-btn[data-ax="1"][data-ay="1"]');
    s = await state(page);
    near(s.right, s.W, 1, 'tocca il bordo destro');
    near(s.bottom, s.H, 1, 'tocca il bordo basso');
    await page.click('.pos-btn[data-ax="0"][data-ay="0"]');
    s = await state(page);
    near(s.cx, s.W / 2, 1);
    near(s.cy, s.H / 2, 1);
    // il video si vede davvero nell'angolo dopo lo spostamento
    await page.click('.pos-btn[data-ax="-1"][data-ay="-1"]');
    await seek(page, 1);
    assert.ok((await pixel(page, 0.1, 0.1)).slice(0, 3).some((v) => v > 20), 'contenuto nell\'angolo in alto a sinistra');
    assert.ok(lum(await pixel(page, 0.9, 0.9)) < 4, 'angolo opposto vuoto');

    await page.click('.pos-btn[data-ax="0"][data-ay="0"]');
    const before = await state(page);
    await page.click('#layout-right');
    near((await state(page)).cx - before.cx, 19.2, 0.6, 'freccia = 1% della larghezza');
    await page.click('#layout-down', { modifiers: ['Shift'] });
    near((await state(page)).cy - before.cy, 108, 1, 'Maiusc + freccia = 10% dell\'altezza');

    // riempi con il clip ruotato: deve coprire tutto il quadro
    await page.click('#layout-rot-cw');
    await waitRot(page, 90);
    await page.click('#layout-fill');
    s = await state(page);
    assert.ok(s.bw >= s.W - 1 && s.bh >= s.H - 1, `riempie il quadro (${s.bw}×${s.bh})`);
    near(s.cx, s.W / 2, 1);
    await page.click('#layout-fit');
    s = await state(page);
    assert.ok(s.bw <= s.W + 1 && s.bh <= s.H + 1, 'adatta: entra nel quadro');
    assert.ok(Math.abs(s.bh - s.H) < 1 || Math.abs(s.bw - s.W) < 1, 'adatta: tocca il quadro su un asse');

    await page.click('#layout-flip-x');
    assert.equal((await state(page)).flipX, true);
    await page.click('#layout-reset');
    s = await state(page);
    assert.equal(s.rot, 0);
    assert.equal(s.flipX, false);
    near(s.scale, 1, 1e-6);
    near(s.cx, s.W / 2, 1);
    near(s.cy, s.H / 2, 1);
  });
});

test('Layout: disposizioni con due clip (affiancati, sopra/sotto, picture-in-picture) e avviso con un clip solo', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm'), m.f('b.webm')]);
    await addMedia(page, 0);
    await addMedia(page, 1);
    await page.waitForFunction(() => document.querySelectorAll('.clip').length === 2);
    await seek(page, 1);
    const clipA = page.locator('.clip', { hasText: 'a.webm' });
    const clipB = page.locator('.clip', { hasText: 'b.webm' });
    await clipA.click();
    await openLayout(page);

    // un solo clip selezionato: «Affiancati» avvisa e non cambia nulla
    const projBefore = JSON.stringify((await project(page)).tracks);
    await page.click('#layout-preset-split-h');
    await page.waitForSelector('.toast.warn');
    assert.equal(JSON.stringify((await project(page)).tracks), projBefore, 'nessuna modifica con un solo clip');

    // due clip, il primo cliccato è «a»
    await clipB.click({ modifiers: ['Control'] });
    assert.equal(await page.evaluate(() => window.__ciak.selection.size), 2);
    const idxOf = async (name) => {
      const list = await clips(page);
      return list.filter((c) => c.kind !== 'audio');
    };
    const order = await idxOf();
    assert.equal(order.length, 2);
    const stateByName = async (name) => {
      const id = (await clips(page)).find((c) => c.name === name).id;
      return page.evaluate((cid) => {
        const a = window.__ciak;
        const p = a.store.project;
        const c = p.tracks.flatMap((t) => t.clips).find((x) => x.id === cid);
        const g = a.renderer.geometry(p, c, a.player.time, p.settings.width, p.settings.height);
        return { cx: g.cx, cy: g.cy, w: g.w, h: g.h, W: p.settings.width, H: p.settings.height, scale: c.transform.scale };
      }, id);
    };

    await page.click('#layout-preset-split-h');
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).some((c) => c.transform.scale < 0.6));
    let a = await stateByName('a.webm');
    let b = await stateByName('b.webm');
    near(a.cx, a.W * 0.25, 1, 'a nella metà sinistra');
    near(b.cx, b.W * 0.75, 1, 'b nella metà destra');
    assert.ok(a.w <= a.W / 2 + 1 && b.w <= b.W / 2 + 1, 'ciascuno entro la propria metà');
    near(a.cy, a.H / 2, 1);
    // sul canvas si vedono entrambi
    assert.ok((await pixel(page, 0.25, 0.5)).slice(0, 3).some((v) => v > 20), 'a visibile a sinistra');
    assert.ok((await pixel(page, 0.75, 0.5)).slice(0, 3).some((v) => v > 20), 'b visibile a destra');

    await page.click('#layout-preset-split-v');
    await page.waitForFunction(() => Math.abs(window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].transform.y) > 0.1);
    a = await stateByName('a.webm');
    b = await stateByName('b.webm');
    near(a.cy, a.H * 0.25, 1, 'a sopra');
    near(b.cy, b.H * 0.75, 1, 'b sotto');
    near(a.cx, a.W / 2, 1);

    await page.click('#layout-preset-pip');
    await page.waitForFunction(() => Math.abs(window.__ciak.store.project.tracks.flatMap((t) => t.clips).find((c) => c.name === 'b.webm').transform.scale - 1) > 0.1 || true);
    a = await stateByName('a.webm');
    b = await stateByName('b.webm');
    near(a.scale, 1, 1e-6, 'lo sfondo è a tutto schermo');
    near(a.cx, a.W / 2, 1);
    assert.ok(b.w <= a.W * 0.33 + 1 && b.cx > a.W * 0.64 && b.cy > a.H * 0.62, `b piccolo in basso a destra (${b.cx.toFixed(0)},${b.cy.toFixed(0)} ${b.w.toFixed(0)}px)`);

    // annulla: torna alla disposizione precedente (sopra/sotto)
    await page.keyboard.press('Control+z');
    const back = await stateByName('b.webm');
    near(back.cy, back.H * 0.75, 1, 'undo ripristina la disposizione precedente');

    // «Schermo intero» vale per tutti i clip selezionati
    await page.click('#layout-preset-full');
    a = await stateByName('a.webm');
    b = await stateByName('b.webm');
    for (const c of [a, b]) {
      near(c.cx, c.W / 2, 1);
      near(c.cy, c.H / 2, 1);
      near(c.scale, 1, 1e-6);
    }
  });
});

test('Layout: senza clip avvisa, con un testo ruota senza deformarlo e rispetta le tracce bloccate', async () => {
  await withApp(async ({ page }) => {
    await openLayout(page);
    assert.match(await page.locator('#layout-target').innerText(), /Seleziona un clip/);
    await page.click('#layout-rot-cw');
    await page.waitForSelector('.toast.warn');
    assert.deepEqual((await clips(page)), []);

    await page.click('#btn-layout'); // chiudi
    await openTab(page, 'text');
    await page.click('#btn-add-text');
    await page.waitForSelector('.clip.kind-text');
    await seek(page, 1);
    await openLayout(page);
    await page.click('#layout-rot-cw');
    await waitRot(page, 90);
    const s = await state(page);
    near(s.scale, 1, 1e-6, 'un testo piccolo ruotato non viene ridimensionato');
    assert.ok(s.right <= s.W && s.left >= 0);
    // blocca la traccia: la modifica viene rifiutata con un avviso, senza errori
    await page.evaluate(() => window.__ciak.store.commit('lock', (d) => { d.tracks.find((t) => t.clips.length).locked = true; }));
    await page.click('#layout-rot-cw');
    await page.waitForSelector('.toast.warn:has-text("bloccata")');
    await page.waitForFunction(() => document.querySelector('#layout-target').textContent.includes('bloccata'));
    assert.equal((await state(page)).rot, 90, 'il clip su una traccia bloccata non cambia');
    // nemmeno con la scala (cursore) né con una disposizione
    await setRange(page, 300);
    await page.click('#layout-preset-full');
    near((await state(page)).scale, 1, 1e-6);
    // sbloccata, funziona di nuovo
    await page.evaluate(() => window.__ciak.store.commit('unlock', (d) => { d.tracks.forEach((t) => (t.locked = false)); }));
    await page.click('#layout-rot-cw');
    await waitRot(page, 180);
  });
});
