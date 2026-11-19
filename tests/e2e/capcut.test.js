// Funzioni aggiunte dal catalogo CapCut (docs/capcut-stato.md). Ogni gruppo ha le sue prove nel browser vero.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, importFiles, project, clips, pixel, seek, openTab, inspectorTab, setNum, addMedia } from '../helpers/browser.js';
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

test('Q e W eliminano la parte a sinistra e a destra della testina, anche da pulsante e menu; si annulla', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm')]); // 4 s
    await addMedia(page, 0);
    let [c] = await clips(page);
    near(c.duration, 4, 0.05);

    await seek(page, 1);
    await page.keyboard.press('q');
    [c] = await clips(page);
    near(c.start, 1, 0.04, 'inizio dopo Q');
    near(c.duration, 3, 0.05);
    near(c.in, 1, 0.05, 'la sorgente avanza: il contenuto non scorre');

    await seek(page, 3);
    await page.keyboard.press('w');
    [c] = await clips(page);
    near(c.start, 1, 0.04);
    near(c.duration, 2, 0.05, 'durata dopo W');

    // pulsanti della barra
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    [c] = await clips(page);
    near(c.start, 0, 0.01, 'annullati entrambi i tagli');
    near(c.duration, 4, 0.05);
    await seek(page, 2);
    await page.click('#btn-trim-right');
    [c] = await clips(page);
    near(c.duration, 2, 0.05);
    await seek(page, 1);
    await page.click('#btn-trim-left');
    [c] = await clips(page);
    near(c.start, 1, 0.04);
    near(c.duration, 1, 0.05);

    // fuori dal clip: avviso, niente cambia
    await seek(page, 3.5);
    await page.keyboard.press('q');
    [c] = await clips(page);
    near(c.start, 1, 0.04);
    assert.ok((await page.locator('.toast').allInnerTexts()).some((t) => /testina/i.test(t)), 'avviso comprensibile');
  });
});
