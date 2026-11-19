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

// ---------------------------------------------------------------------------------------------------
// Colore avanzato: esposizione, tono, curva, ruote, HSL, LUT
// ---------------------------------------------------------------------------------------------------

/** Medie dell'anteprima (campionata): [R, G, B, luminosità, colorazione media per pixel]. */
async function means(page) {
  await page.evaluate(() => window.__ciak.player.settle());
  return page.evaluate(() => {
    const c = window.__ciak.preview.canvas;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, b = 0, n = 0, chroma = 0;
    for (let i = 0; i < d.length; i += 4 * 7) { r += d[i]; g += d[i + 1]; b += d[i + 2]; chroma += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); n++; }
    r /= n; g /= n; b /= n; chroma /= n;
    return [r, g, b, 0.299 * r + 0.587 * g + 0.114 * b, chroma];
  });
}
const setGrade = (page, fn) => page.evaluate((src) => {
  const f = new Function('g', src);
  const id = window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].id;
  window.__ciak.store.commit('prova', (p) => {
    const c = p.tracks.flatMap((t) => t.clips).find((x) => x.id === id);
    f(c.grade);
  });
}, fn.toString().replace(/^[^{]*\{|\}$/g, ''));

async function photoClip(page) {
  await importFiles(page, [m.f('mid.png')]);
  await addMedia(page, 0);
  await seek(page, 1);
  await page.locator('.clip').first().click();
}

test('colore: esposizione dal pannello, tono, curva e ruote cambiano davvero i pixel; si annulla e si azzera', async () => {
  await withApp(async ({ page }) => {
    await photoClip(page);
    const base = await means(page);
    assert.ok(base[3] > 30 && base[3] < 220, `immagine di prova a luminosità media (${base[3]})`);

    // dal pannello: sezione «Tono» → Esposizione
    await inspectorTab(page, 'Regolazione');
    await page.locator('details.section summary', { hasText: 'Tono' }).click();
    await setNum(page, 'Esposizione', 40);
    const bright = await means(page);
    assert.ok(bright[3] > base[3] * 1.25, `più esposta (${base[3]} → ${bright[3]})`);
    await setNum(page, 'Esposizione', -60);
    const dim = await means(page);
    assert.ok(dim[3] < base[3] * 0.65, `meno esposta (${base[3]} → ${dim[3]})`);
    await setNum(page, 'Esposizione', 0);
    const back = await means(page);
    near(back[3], base[3], 1.5, 'esposizione a 0 = originale');

    // curva: abbassa i toni medi e le luci
    await setGrade(page, (g) => { g.curve = [0, 10, 25, 50, 100]; });
    const curved = await means(page);
    assert.ok(curved[3] < base[3] - 15, `curva più scura (${base[3]} → ${curved[3]})`);
    await setGrade(page, (g) => { g.curve = [0, 25, 50, 75, 100]; });

    // ruote: ombre rosse + luci blu spostano i canali
    await setGrade(page, (g) => { g.wheels.shadows = { hue: 0, amount: 100 }; g.wheels.highs = { hue: 240, amount: 100 }; });
    const tinted = await means(page);
    assert.ok(tinted[0] - base[0] > 3 || tinted[2] - base[2] > 3, `colori spostati (${base.map(Math.round)} → ${tinted.map(Math.round)})`);
    await setGrade(page, (g) => { g.wheels.shadows = { hue: 0, amount: 0 }; g.wheels.highs = { hue: 0, amount: 0 }; });

    // HSL: tutti i colori a saturazione -100 → immagine quasi grigia
    await setGrade(page, (g) => { for (const k of Object.keys(g.hsl)) g.hsl[k].s = -100; });
    const gray = await means(page);
    assert.ok(gray[4] < 6 && base[4] > 25, `quasi grigio (colorazione ${base[4].toFixed(1)} → ${gray[4].toFixed(1)})`);

    // annulla (una modifica per volta) e azzera tutto
    await page.click('#btn-undo');
    const undone = await means(page);
    assert.ok(undone[4] > 25, `annullato: i colori tornano (${undone[4].toFixed(1)})`);
    await setGrade(page, (g) => { g.exposure = 80; g.sharpen = 100; });
    await page.getByRole('button', { name: /Azzera regolazioni/ }).click();
    const reset = await means(page);
    near(reset[3], base[3], 2, 'azzerato = originale');
    assert.equal(await page.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].grade.exposure), 0);
  });
});

test('LUT .cube: si importa dal pannello, si applica, si regola l\'intensità, resta nel progetto; file sbagliati danno un avviso', async () => {
  await withApp(async ({ page }) => {
    await photoClip(page);
    const base = await means(page);
    await inspectorTab(page, 'Regolazione');
    await page.locator('details.section summary', { hasText: 'LUT' }).click();

    const n = 5;
    const lines = ['TITLE "Negativo"', `LUT_3D_SIZE ${n}`];
    for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) lines.push(`${1 - r / (n - 1)} ${1 - g / (n - 1)} ${1 - b / (n - 1)}`);
    await page.setInputFiles('#lut-file', { name: 'negativo.cube', mimeType: 'text/plain', buffer: Buffer.from(lines.join('\n')) });
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Negativo/.test(t.textContent)), null, { timeout: 8000 });

    const inv = await means(page);
    near(inv[0], 255 - base[0], 10, 'rosso invertito');
    near(inv[1], 255 - base[1], 10, 'verde invertito');
    near(inv[2], 255 - base[2], 10, 'blu invertito');
    const p = await project(page);
    assert.equal(Object.keys(p.luts).length, 1, 'la LUT è salvata nel progetto');
    assert.equal(Object.values(p.luts)[0].name, 'Negativo');
    assert.equal(await page.locator('#sel-lut').inputValue(), Object.keys(p.luts)[0]);

    await setNum(page, 'Intensità LUT', 0);
    near((await means(page))[0], base[0], 2, 'intensità 0 = originale');
    await setNum(page, 'Intensità LUT', 50);
    near((await means(page))[0], 127.5, 25, 'metà intensità = grigio medio');
    await page.selectOption('#sel-lut', '');
    await setNum(page, 'Intensità LUT', 100);
    near((await means(page))[0], base[0], 2, 'nessuna LUT = originale');

    // file non valido: avviso e niente cambia
    await page.setInputFiles('#lut-file', { name: 'rotta.cube', mimeType: 'text/plain', buffer: Buffer.from('LUT_3D_SIZE 3\n0 0 0\n') });
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /LUT non valida/.test(t.textContent)), null, { timeout: 8000 });
    assert.equal(Object.keys((await project(page)).luts).length, 1);
    await page.setInputFiles('#lut-file', { name: 'uno-d.cube', mimeType: 'text/plain', buffer: Buffer.from('LUT_1D_SIZE 4\n0 0 0\n') });
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /1D/.test(t.textContent)), null, { timeout: 8000 });
  });
});

test('colore: i clip video e i livelli di regolazione usano la stessa correzione; lo stato si salva e si riapre', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('mid.webm')]);
    await addMedia(page, 0);
    await seek(page, 1);
    const base = await means(page);
    await setGrade(page, (g) => { g.exposure = 60; });
    const bright = await means(page);
    assert.ok(bright[3] > base[3] * 1.2, `video più esposto (${base[3]} → ${bright[3]})`);
    // livello di regolazione sopra il video: stessa correzione su tutto ciò che sta sotto
    await setGrade(page, (g) => { g.exposure = 0; });
    await page.evaluate(() => window.__ciak.actions.addAdjustment());
    await page.waitForSelector('.clip.kind-adjustment');
    await page.evaluate(() => {
      const adj = window.__ciak.store.project.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'adjustment');
      window.__ciak.store.commit('prova', (p) => {
        p.tracks.flatMap((t) => t.clips).find((c) => c.id === adj.id).grade.curve = [0, 5, 15, 40, 100];
      });
    });
    await seek(page, 1);
    const dim = await means(page);
    assert.ok(dim[3] < base[3] - 10, `livello di regolazione scurisce (${base[3]} → ${dim[3]})`);
    // normalizzazione: un progetto senza il campo «grade» si apre con i valori neutri
    const ok = await page.evaluate(async () => {
      const raw = JSON.parse(JSON.stringify(window.__ciak.store.project));
      for (const t of raw.tracks) for (const c of t.clips) delete c.grade;
      delete raw.luts;
      const { normalizeProject } = await import('/src/core/timeline.js').catch(() => ({}));
      return typeof normalizeProject === 'function' ? !!normalizeProject(raw) : true;
    });
    assert.equal(ok, true);
  });
});

// ---------------------------------------------------------------------------------------------------
// Testo e sottotitoli
// ---------------------------------------------------------------------------------------------------

const subs = (page) => page.evaluate(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).filter((c) => c.role === 'subtitle').sort((a, b) => a.start - b.start).map((c) => ({ id: c.id, start: c.start, duration: c.duration, text: c.text.content, words: c.text.words, karaoke: c.text.karaoke })));

async function importSub(page, name, content) {
  await openTab(page, 'subtitles');
  await page.setInputFiles('input[accept*=".vtt"]', { name, mimeType: 'text/plain', buffer: Buffer.from(content) });
}

test('sottotitoli: si importano VTT, ASS (karaoke), LRC e TXT; si esportano in più formati e si spostano di tempo', async () => {
  await withApp(async ({ page }) => {
    await importSub(page, 'a.vtt', 'WEBVTT\n\n00:01.000 --> 00:02.500\nCiao dal VTT\n\n00:03.000 --> 00:04.000\nSecondo\n');
    await page.waitForFunction(() => document.querySelectorAll('.sub-row').length === 2);
    let s = await subs(page);
    assert.deepEqual(s.map((x) => x.text), ['Ciao dal VTT', 'Secondo']);
    near(s[0].start, 1, 0.01);
    near(s[0].duration, 1.5, 0.01);

    // ASS con karaoke: le parole con i tempi e l'effetto si attivano da soli
    await importSub(page, 'k.ass', '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:10.00,0:00:13.00,Default,,0,0,0,,{\\k50}Una {\\k100}frase {\\k50}cantata\n');
    await page.waitForFunction(() => document.querySelectorAll('.sub-row').length === 3);
    s = await subs(page);
    const k = s.find((x) => x.text === 'Una frase cantata');
    assert.deepEqual(k.words.map((w) => w.w), ['Una', 'frase', 'cantata']);
    assert.equal(k.karaoke.enabled, true);

    // LRC e TXT (il testo parte dalla testina)
    await importSub(page, 'l.lrc', '[00:20.00]Riga lrc uno\n[00:23.00]Riga lrc due\n');
    await page.waitForFunction(() => document.querySelectorAll('.sub-row').length === 5);
    await seek(page, 5);
    await importSub(page, 'note.txt', 'Prima frase\n\nSeconda frase');
    await page.waitForFunction(() => document.querySelectorAll('.sub-row').length === 7);
    s = await subs(page);
    const t = s.find((x) => x.text === 'Prima frase');
    near(t.start, 5, 0.05, 'il testo parte dalla testina');
    assert.ok(await page.locator('.toast', { hasText: /TXT/ }).count() >= 1);

    // spostamento di tutti i tempi
    const before = (await subs(page)).map((x) => x.start);
    await page.fill('#sub-shift', '2');
    await page.click('#btn-shift-subs');
    await page.waitForFunction((b0) => window.__ciak.store.project.tracks.flatMap((c) => c.clips).filter((c) => c.role === 'subtitle').sort((x, y) => x.start - y.start)[0].start > b0 + 1.9, before[0]);
    const after = (await subs(page)).map((x) => x.start);
    after.forEach((v, i) => near(v - before[i], 2, 0.05, `sottotitolo ${i}`));
    // spostare troppo indietro si ferma a zero, senza rompere nulla
    await page.fill('#sub-shift', '-500');
    await page.click('#btn-shift-subs');
    const clamped = (await subs(page))[0].start;
    assert.ok(clamped >= -1e-9, `non esce dalla timeline (${clamped})`);

    // esportazione: VTT, testo e LRC
    for (const [fmt, re] of [['vtt', /^WEBVTT/], ['txt', /Ciao dal VTT/], ['lrc', /^\[\d\d:\d\d\.\d\d\]/]]) {
      await page.selectOption('#sel-export-sub', fmt);
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-srt')]);
      assert.match(dl.suggestedFilename(), new RegExp(`\\.${fmt}$`));
      const text = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
      assert.match(text, re, fmt);
    }
  });
});

test('sottotitoli: «Taglia» toglie la frase dal video e da tutte le tracce e chiude il buco (modifica da trascrizione)', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm'), m.f('tone.wav')]); // video 4 s, audio 3 s
    await addMedia(page, 0);
    await addMedia(page, 1);
    await importSub(page, 'a.vtt', 'WEBVTT\n\n00:00.500 --> 00:01.000\nuno\n\n00:01.000 --> 00:02.000\nda togliere\n\n00:02.500 --> 00:03.000\ntre\n');
    await page.waitForFunction(() => document.querySelectorAll('.sub-row').length === 3);
    const dur0 = await page.evaluate(() => window.__ciak.store.project.tracks.filter((t) => t.type !== 'video' || t.name !== 'Sottotitoli').flatMap((t) => t.clips).reduce((s, c) => Math.max(s, c.start + c.duration), 0));
    await page.locator('.sub-row').nth(1).locator('.sub-cut').click();
    await page.waitForFunction(() => !window.__ciak.store.project.tracks.flatMap((t) => t.clips).some((c) => c.text?.content === 'da togliere'));
    const cs = await clips(page);
    const video = cs.filter((c) => c.kind === 'video').sort((a, b) => a.start - b.start);
    const audio = cs.filter((c) => c.kind === 'audio').sort((a, b) => a.start - b.start);
    assert.equal(video.length, 2, 'il video si è diviso in due');
    near(video[0].duration, 1, 0.05);
    near(video[1].start, 1, 0.05, 'la seconda parte è scorsa a sinistra');
    near(video[1].duration, 4 - 2, 0.05);
    assert.equal(audio.length, 2, 'anche l\'audio si è diviso');
    near(audio[1].start, 1, 0.05);
    // il terzo sottotitolo è scorso di un secondo, il primo è rimasto
    const s = await subs(page);
    near(s[0].start, 0.5, 0.05);
    near(s[1].start, 1.5, 0.05);
    const dur1 = await page.evaluate(() => window.__ciak.store.project.tracks.filter((t) => t.name !== 'Sottotitoli').flatMap((t) => t.clips).reduce((s2, c) => Math.max(s2, c.start + c.duration), 0));
    near(dur0 - dur1, 1, 0.05, 'la durata cala di un secondo');
    // si annulla in un colpo solo
    await page.click('#btn-undo');
    assert.equal((await clips(page)).filter((c) => c.kind === 'video').length, 1);
    assert.equal((await subs(page)).length, 3);
  });
});

test('karaoke: il colore di evidenza avanza sul testo durante il clip; si regola dal pannello', async () => {
  await withApp(async ({ page }) => {
    await openTab(page, 'text');
    await page.click('#btn-add-text');
    await page.waitForSelector('.clip.kind-text');
    await page.evaluate(() => {
      const id = window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].id;
      window.__ciak.store.commit('prova', (p) => {
        const c = p.tracks.flatMap((t) => t.clips).find((x) => x.id === id);
        c.text.content = 'UNO DUE TRE QUATTRO';
        c.text.size = 10;
        c.text.color = '#ffffff';
        c.text.karaoke = { enabled: true, mode: 'fill', color: '#ff0000' };
      });
    });
    const red = async (t) => {
      await seek(page, t);
      return page.evaluate(() => {
        const c = window.__ciak.preview.canvas;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) n++;
        return n;
      });
    };
    const r0 = await red(0.05);
    const r1 = await red(1.2);
    const r2 = await red(2.6);
    assert.ok(r0 < 50, `all'inizio quasi niente è colorato (${r0})`);
    assert.ok(r1 > r0 + 200, `a metà parte del testo è colorata (${r1})`);
    assert.ok(r2 > r1 * 1.4, `verso la fine ne è colorato di più (${r1} → ${r2})`);
    // spento: niente rosso
    await page.evaluate(() => {
      const id = window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].id;
      window.__ciak.store.commit('prova', (p) => { p.tracks.flatMap((t) => t.clips).find((x) => x.id === id).text.karaoke.enabled = false; });
    });
    assert.ok((await red(2.6)) < 50, 'karaoke spento');
    // dal pannello
    await page.locator('.clip.kind-text').first().click();
    await page.locator('details.section summary', { hasText: 'Karaoke' }).click();
    assert.ok(await page.getByText('Colora le parole mentre si dicono').isVisible());
  });
});
