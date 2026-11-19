// Layout della finestra: disposizioni pronte, anteprima libera (trascina/ridimensiona/riaggancia),
// pannelli nascondibili, divisori e memoria delle scelte.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, importFiles, pixel, seek, addMedia } from '../helpers/browser.js';
import { makeMedia } from '../helpers/make-media.js';

let env;
let m;
before(async () => {
  m = makeMedia();
  env = await launch();
});
after(async () => env?.close());

async function withApp(fn, opts) {
  const s = await env.open(opts);
  try {
    await fn(s);
    assert.deepEqual(s.errors, [], 'nessun errore in console/pagina');
  } finally {
    await s.context.close();
  }
}

const box = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox();
  return b;
};
const visible = (page, sel) => page.locator(sel).first().isVisible();
const menuItem = (page, label) => page.locator('.ctx-menu .ctx-item', { hasText: new RegExp(`^\\s*${label}`) }).filter({ hasNotText: label === 'Timeline' ? 'grande' : '\u0000' });
async function choose(page, label) {
  await page.click('#btn-layout');
  await page.waitForSelector('.ctx-menu');
  await menuItem(page, label).first().click();
  await page.waitForFunction(() => !document.querySelector('.ctx-menu'));
}

/** Trascina con il mouse da un punto a un altro, con passaggi intermedi come farebbe una mano. */
async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

test('il pulsante Layout apre il menu con disposizioni, anteprima libera e pannelli', async () => {
  await withApp(async ({ page }) => {
    assert.ok(await visible(page, '#btn-layout'));
    await page.click('#btn-layout');
    const menu = page.locator('.ctx-menu');
    await menu.waitFor();
    const txt = await menu.innerText();
    for (const w of ['Classica', 'Anteprima a sinistra', 'Anteprima a destra', 'Anteprima grande', 'Solo anteprima', 'Timeline grande', 'Anteprima libera', 'Libreria', 'Proprietà', 'Timeline', 'Ripristina']) assert.ok(txt.includes(w), `manca «${w}»`);
    assert.equal(await page.locator('.ctx-menu .ctx-item:has-text("Classica") svg').count(), 1, 'la disposizione attuale è spuntata');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.ctx-menu'));
  });
});

test('disposizioni pronte: l\'anteprima passa a sinistra/destra e i pannelli cambiano posto', async () => {
  await withApp(async ({ page }) => {
    const pos = async () => ({ lib: await box(page, '.library'), prev: await box(page, '.preview'), insp: await box(page, '.inspector') });
    let p = await pos();
    assert.ok(p.lib.x < p.prev.x && p.prev.x < p.insp.x, 'classica: libreria · anteprima · proprietà');

    await choose(page, 'Anteprima a sinistra');
    p = await pos();
    assert.ok(p.prev.x < p.lib.x && p.lib.x < p.insp.x, 'anteprima a sinistra');
    assert.ok(p.prev.width > p.lib.width, 'l\'anteprima prende lo spazio libero');
    assert.ok(Math.abs(p.prev.x) < 2, 'anteprima a filo del bordo sinistro');

    await choose(page, 'Anteprima a destra');
    p = await pos();
    assert.ok(p.lib.x < p.insp.x && p.insp.x < p.prev.x, 'anteprima a destra');
    assert.ok(Math.abs(p.prev.x + p.prev.width - 1440) < 2, 'anteprima a filo del bordo destro');

    await choose(page, 'Classica');
    p = await pos();
    assert.ok(p.lib.x < p.prev.x && p.prev.x < p.insp.x);
  });
});

test('anteprima grande e solo anteprima: i pannelli si nascondono e l\'anteprima si allarga', async () => {
  await withApp(async ({ page }) => {
    const classic = await box(page, '.preview');
    const tl0 = await box(page, '.timeline');

    await choose(page, 'Anteprima grande');
    assert.equal(await visible(page, '.library'), false);
    assert.equal(await visible(page, '.inspector'), false);
    assert.ok(await visible(page, '.timeline'));
    const big = await box(page, '.preview');
    assert.ok(big.width > classic.width + 400, `anteprima più larga (${classic.width} → ${big.width})`);
    near(big.x, 0, 2);
    near(big.x + big.width, 1440, 2);
    // il canvas segue: riempie la nuova area mantenendo le proporzioni 16:9
    const cv = await box(page, '.preview-canvas');
    near(cv.width / cv.height, 16 / 9, 0.02);
    assert.ok(cv.width > 700);

    await choose(page, 'Solo anteprima');
    assert.equal(await visible(page, '.timeline'), false);
    const cine = await box(page, '.preview');
    assert.ok(cine.height > big.height + 250, `anteprima più alta (${big.height} → ${cine.height})`);

    await choose(page, 'Classica');
    assert.ok(await visible(page, '.library') && await visible(page, '.inspector') && await visible(page, '.timeline'));
    const tl1 = await box(page, '.timeline');
    near(tl1.height, tl0.height, 2);
    // la timeline ha ripreso a misurarsi e a disegnarsi dopo essere stata nascosta
    assert.ok(await page.evaluate(() => window.__ciak.timeline.scroll.clientWidth > 300), 'area della timeline misurata');
  });
});

function near(a, b, eps) {
  assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b} (±${eps})`);
}

test('timeline grande: più spazio per i clip', async () => {
  await withApp(async ({ page }) => {
    const t0 = await box(page, '.timeline');
    await choose(page, 'Timeline grande');
    const t1 = await box(page, '.timeline');
    assert.ok(t1.height > t0.height + 100, `timeline più alta (${t0.height} → ${t1.height})`);
    const prev = await box(page, '.preview');
    assert.ok(prev.height > 200, 'l\'anteprima resta usabile');
    await choose(page, 'Classica');
  });
});

test('pannelli singoli: Libreria, Proprietà e Timeline si nascondono e ricompaiono', async () => {
  await withApp(async ({ page }) => {
    await choose(page, 'Libreria');
    assert.equal(await visible(page, '.library'), false);
    assert.ok(await visible(page, '.inspector'));
    await choose(page, 'Proprietà');
    assert.equal(await visible(page, '.inspector'), false);
    await choose(page, 'Timeline');
    assert.equal(await visible(page, '.timeline'), false);
    for (const l of ['Libreria', 'Proprietà', 'Timeline']) await choose(page, l);
    for (const sel of ['.library', '.inspector', '.timeline']) assert.ok(await visible(page, sel), sel);
  });
});

test('anteprima libera: si trascina dalla barra, si ridimensiona dall\'angolo e si riaggancia', async () => {
  await withApp(async ({ page }) => {
    assert.equal(await visible(page, '.float-bar'), false, 'la barra c\'è solo quando l\'anteprima è libera');
    const docked = await box(page, '.preview');

    await choose(page, 'Anteprima libera');
    assert.equal(await page.locator('.preview').evaluate((el) => getComputedStyle(el).position), 'fixed');
    assert.ok(await visible(page, '.float-bar'));
    const f0 = await box(page, '.preview');
    assert.ok(f0.width >= 340 && f0.height >= 260);
    // sopra la libreria/proprietà non finisce nulla di rotto: la finestrella sta nella pagina
    assert.ok(f0.x >= 0 && f0.y >= 0 && f0.x + f0.width <= 1440 + 1 && f0.y + f0.height <= 860 + 1);

    // sposta: trascina la barra di 180 px a sinistra e 90 in basso
    const bar = await box(page, '.float-bar');
    await drag(page, { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 }, { x: bar.x + bar.width / 2 - 180, y: bar.y + bar.height / 2 + 90 });
    const f1 = await box(page, '.preview');
    near(f1.x, f0.x - 180, 3);
    near(f1.y, f0.y + 90, 3);
    near(f1.width, f0.width, 1);

    // ingrandisce dall'angolo in basso a destra
    const se = await box(page, '.float-handle.h-se');
    await drag(page, center(se), { x: center(se).x + 60, y: center(se).y - 20 });
    const f2 = await box(page, '.preview');
    near(f2.width, f1.width + 60, 4);
    near(f2.height, f1.height - 20, 4);
    near(f2.x, f1.x, 1);
    // l'immagine si adatta alla nuova dimensione, sempre 16:9
    const cv = await box(page, '.preview-canvas');
    near(cv.width / cv.height, 16 / 9, 0.02);
    assert.ok(cv.width <= f2.width && cv.height <= f2.height);

    // non scende sotto il minimo
    const se2 = await box(page, '.float-handle.h-se');
    await drag(page, center(se2), { x: center(se2).x - 900, y: center(se2).y - 700 });
    const f3 = await box(page, '.preview');
    assert.ok(f3.width >= 339 && f3.height >= 259, `minimo rispettato (${f3.width}×${f3.height})`);

    // riaggancia con il pulsante
    await page.click('#btn-dock');
    assert.equal(await page.locator('.preview').evaluate((el) => getComputedStyle(el).position), 'static');
    assert.equal(await visible(page, '.float-bar'), false);
    const back = await box(page, '.preview');
    near(back.x, docked.x, 2);
    near(back.width, docked.width, 2);
    near(back.height, docked.height, 2);
  });
});

test('anteprima libera: doppio clic sulla barra riaggancia; non esce mai dalla finestra', async () => {
  await withApp(async ({ page }) => {
    await choose(page, 'Anteprima libera');
    const bar = await box(page, '.float-bar');
    // trascinata molto oltre i bordi: la barra resta raggiungibile
    await drag(page, center(bar), { x: 1430, y: 850 });
    let f = await box(page, '.preview');
    assert.ok(f.x < 1440 - 100, `almeno 120 px dentro a destra (x=${f.x})`);
    assert.ok(f.y <= 860 - 30, `la barra è visibile in basso (y=${f.y})`);
    const bar2 = await box(page, '.float-bar');
    assert.ok(bar2.y + bar2.height <= 860 + 1);
    await drag(page, center(bar2), { x: 3, y: 2 });
    f = await box(page, '.preview');
    assert.ok(f.y >= 0, 'non esce in alto');
    assert.ok(f.x + f.width >= 100, 'resta raggiungibile a sinistra');

    const bar3 = await box(page, '.float-bar');
    await page.mouse.dblclick(bar3.x + bar3.width / 2, bar3.y + bar3.height / 2);
    assert.equal(await page.locator('.preview').evaluate((el) => getComputedStyle(el).position), 'static');
  });
});

test('anteprima libera da tastiera: frecce sulla barra', async () => {
  await withApp(async ({ page }) => {
    await choose(page, 'Anteprima libera');
    const f0 = await box(page, '.preview');
    await page.locator('.float-bar').focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowDown');
    const f1 = await box(page, '.preview');
    near(f1.x, f0.x - 20, 2);
    near(f1.y, f0.y + 20, 2);
  });
});

test('la riproduzione e il disegno funzionano anche con l\'anteprima libera', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm')]);
    await addMedia(page, 0);
    await choose(page, 'Anteprima libera');
    await seek(page, 1);
    const px = await pixel(page);
    assert.ok(px[3] === 255 && px[0] + px[1] + px[2] > 10, `il fotogramma si vede (${px})`);
    await page.evaluate(() => window.__ciak.player.play());
    await page.waitForTimeout(700);
    const t = await page.evaluate(() => window.__ciak.player.time);
    assert.ok(t > 1.3, `il tempo avanza (${t})`);
    await page.evaluate(() => window.__ciak.player.pause());
    // lo spostamento durante la riproduzione non interrompe nulla
    const bar = await box(page, '.float-bar');
    await drag(page, center(bar), { x: center(bar).x - 100, y: center(bar).y + 40 });
    assert.ok((await pixel(page))[3] === 255);
    // clic sull'anteprima libera: seleziona il clip, come da agganciata
    await page.evaluate(() => window.__ciak.selection.clear());
    const cv = await box(page, '.preview-canvas');
    await page.mouse.click(cv.x + cv.width / 2, cv.y + cv.height / 2);
    assert.equal(await page.evaluate(() => window.__ciak.selection.size), 1);
  });
});

test('divisori: si allarga la libreria e le proprietà, doppio clic ripristina', async () => {
  await withApp(async ({ page }) => {
    const lib0 = await box(page, '.library');
    const grip = await box(page, '.library .col-grip');
    await drag(page, center(grip), { x: center(grip).x + 70, y: center(grip).y });
    const lib1 = await box(page, '.library');
    near(lib1.width, lib0.width + 70, 4);

    const insp0 = await box(page, '.inspector');
    const ig = await box(page, '.inspector .col-grip');
    await drag(page, center(ig), { x: center(ig).x - 60, y: center(ig).y });
    const insp1 = await box(page, '.inspector');
    near(insp1.width, insp0.width + 60, 4);

    // limiti: non si schiaccia e non si allarga troppo
    const g2 = await box(page, '.library .col-grip');
    await drag(page, center(g2), { x: center(g2).x - 900, y: center(g2).y });
    assert.ok((await box(page, '.library')).width >= 239);
    const g3 = await box(page, '.library .col-grip');
    await drag(page, center(g3), { x: center(g3).x + 900, y: center(g3).y });
    assert.ok((await box(page, '.library')).width <= 561);
    assert.ok((await box(page, '.preview')).width > 200, 'l\'anteprima resta usabile');

    await page.locator('.library .col-grip').dblclick();
    near((await box(page, '.library')).width, lib0.width, 2);
  });
});

test('divisori coerenti anche con l\'anteprima a sinistra', async () => {
  await withApp(async ({ page }) => {
    await choose(page, 'Anteprima a sinistra');
    const lib0 = await box(page, '.library');
    const g = await box(page, '.library .col-grip');
    near(center(g).x, lib0.x, 4); // sul bordo rivolto verso l'anteprima
    await drag(page, center(g), { x: center(g).x - 50, y: center(g).y });
    near((await box(page, '.library')).width, lib0.width + 50, 4);
  });
});

test('le scelte restano dopo aver riaperto il programma', async () => {
  await withApp(async ({ page }) => {
    await choose(page, 'Anteprima a destra');
    await choose(page, 'Libreria');
    await choose(page, 'Anteprima libera');
    const bar = await box(page, '.float-bar');
    await drag(page, center(bar), { x: center(bar).x - 120, y: center(bar).y + 50 });
    const se = await box(page, '.float-handle.h-se');
    await drag(page, center(se), { x: center(se).x + 40, y: center(se).y + 30 });
    const before = await box(page, '.preview');

    await page.reload();
    await page.waitForFunction(() => window.__ciak && document.querySelector('.timeline'));
    assert.equal(await page.locator('.preview').evaluate((el) => getComputedStyle(el).position), 'fixed');
    const after = await box(page, '.preview');
    near(after.x, before.x, 2);
    near(after.y, before.y, 2);
    near(after.width, before.width, 2);
    near(after.height, before.height, 2);
    assert.equal(await visible(page, '.library'), false, 'la libreria è rimasta nascosta');
    assert.equal(await page.locator('.workspace').getAttribute('data-arrange'), 'prev-right');

    // «Ripristina il layout» rimette tutto com'era
    await choose(page, 'Ripristina');
    for (const sel of ['.library', '.inspector', '.timeline']) assert.ok(await visible(page, sel), sel);
    assert.equal(await page.locator('.preview').evaluate((el) => getComputedStyle(el).position), 'static');
    const p = { lib: await box(page, '.library'), prev: await box(page, '.preview'), insp: await box(page, '.inspector') };
    assert.ok(p.lib.x < p.prev.x && p.prev.x < p.insp.x);
  });
});

test('dati salvati rovinati o assurdi non rompono l\'avvio', async () => {
  const ws = (v) => JSON.stringify({ workspace: v });
  const cases = [
    ws({ arrange: 'zzz', float: { on: true, x: 'a', y: null, w: -5, h: 1e9 }, libW: 99999, inspW: -3 }),
    ws('stringa'),
    ws([]),
    ws(null),
    ws({ float: { on: true, x: -99999, y: 99999, w: 600, h: 400 } }),
    ws({ float: { on: true, x: 100, y: 100, w: 'x', h: {} }, lib: 'no', timeline: 0 }),
    'non json',
  ];
  for (const raw of cases) {
    const context = await env.browser.newContext({ viewport: { width: 1440, height: 860 }, colorScheme: 'dark' });
    await context.addInitScript((r) => {
      try {
        localStorage.setItem('ciak-studio:prefs', r);
      } catch {}
    }, raw);
    const s = await env.open({ context });
    try {
      assert.ok(await visible(s.page, '.timeline'), raw);
      const f = await box(s.page, '.preview');
      assert.ok(f && f.width > 100 && f.height > 100, `anteprima visibile (${raw})`);
      assert.ok(f.x < 1440 - 50 && f.y < 860 - 20 && f.y >= 0, `dentro la finestra (${f.x},${f.y}) per ${raw}`);
      assert.deepEqual(s.errors, [], raw);
    } finally {
      await context.close();
    }
  }
});

test('schermi stretti: la disposizione resta quella a colonne e il menu lo dice', async () => {
  await withApp(async ({ page }) => {
    await page.click('#btn-layout');
    await page.waitForSelector('.ctx-menu');
    assert.equal(await menuItem(page, 'Anteprima a sinistra').first().isDisabled(), false);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 820, height: 800 });
    await page.waitForTimeout(150);
    await page.click('#btn-layout');
    await page.waitForSelector('.ctx-menu');
    assert.equal(await menuItem(page, 'Anteprima a sinistra').first().isDisabled(), true);
    assert.equal(await menuItem(page, 'Anteprima libera').first().isDisabled(), true);
    assert.ok((await page.locator('.ctx-menu').innerText()).toLowerCase().includes('900 px'));
    await page.keyboard.press('Escape');
    // l'anteprima occupa tutta la prima riga, come prima
    const prev = await box(page, '.preview');
    assert.ok(prev.width > 780);
  });
});

test('se la finestra si restringe con l\'anteprima libera, si riaggancia da sola e poi torna libera', async () => {
  await withApp(async ({ page }) => {
    await choose(page, 'Anteprima libera');
    await page.setViewportSize({ width: 820, height: 800 });
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.preview').evaluate((el) => getComputedStyle(el).position), 'static');
    assert.equal(await visible(page, '.float-bar'), false);
    await page.setViewportSize({ width: 1440, height: 860 });
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.preview').evaluate((el) => getComputedStyle(el).position), 'fixed');
    const f = await box(page, '.preview');
    assert.ok(f.x + f.width > 120 && f.x < 1440 - 100);
  });
});

test('la guida spiega il pulsante Layout e si apre sopra la finestrella', async () => {
  await withApp(async ({ page }) => {
    await choose(page, 'Anteprima libera');
    await page.click('#btn-help');
    const dlg = page.locator('dialog[open], [role="dialog"]').first();
    await dlg.waitFor();
    assert.ok((await dlg.innerText()).includes('Layout'), 'la guida cita il pulsante Layout');
    await page.keyboard.press('Escape');
  });
});
