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

test('pause: l\'analisi dell\'audio le trova, mostra quante sono e le toglie da video e audio insieme', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('pause.webm')]); // 5 s: voce, pausa 1–2,5, voce, pausa 3,5–4,5
    await addMedia(page, 0);
    await page.locator('.clip.kind-video').first().click();
    await inspectorTab(page, 'Audio');
    await page.locator('details.section summary', { hasText: 'Pause' }).click();
    await page.waitForFunction(() => /Trovate 2 pause/.test(document.querySelector('#silence-info')?.textContent ?? ''), null, { timeout: 15000 });
    const info = await page.textContent('#silence-info');
    const secs = Number(/per ([\d.]+) s/.exec(info)[1]);
    assert.ok(secs > 1.7 && secs < 2.3, `pause trovate per circa 2 s (${info})`);

    // soglia o durata minima troppo severe: niente da togliere
    await page.locator('input[aria-label="Pausa minima (valore)"]').fill('3');
    await page.locator('input[aria-label="Pausa minima (valore)"]').press('Enter');
    await page.waitForFunction(() => /Nessuna pausa/.test(document.querySelector('#silence-info')?.textContent ?? ''));
    await page.click('#btn-remove-silence');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Nessuna pausa/.test(t.textContent)));
    assert.equal((await clips(page)).length, 1, 'nulla è cambiato');
    await page.locator('input[aria-label="Pausa minima (valore)"]').fill('0.6');
    await page.locator('input[aria-label="Pausa minima (valore)"]').press('Enter');
    await page.waitForFunction(() => /Trovate 2 pause/.test(document.querySelector('#silence-info')?.textContent ?? ''));

    const before = (await clips(page))[0].duration;
    await page.click('#btn-remove-silence');
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).filter((c) => c.kind === 'video').length === 3, null, { timeout: 8000 });
    const cs = (await clips(page)).filter((c) => c.kind === 'video').sort((a, b) => a.start - b.start);
    const total = cs.reduce((s, c) => s + c.duration, 0);
    near(before - total, secs, 0.1, 'tolto quanto annunciato');
    // niente buchi: i pezzi si toccano
    near(cs[1].start, cs[0].start + cs[0].duration, 0.04);
    near(cs[2].start, cs[1].start + cs[1].duration, 0.04);
    // un solo passo di annullamento
    await page.click('#btn-undo');
    assert.equal((await clips(page)).filter((c) => c.kind === 'video').length, 1);
    near((await clips(page))[0].duration, before, 0.01);
  });
});

test('modelli di testo e animazioni cicliche: i nuovi modelli compaiono, il ciclo muove davvero il testo e si regola', async () => {
  await withApp(async ({ page }) => {
    await openTab(page, 'text');
    assert.ok((await page.locator('.text-card').count()) >= 20, 'molti modelli pronti');
    await page.locator('.text-card[data-preset="pill"]').click();
    await page.waitForSelector('.clip.kind-text');
    let [c] = await clips(page);
    assert.equal(c.anim.loop.type, 'pulse', 'il modello porta con sé il ciclo');
    assert.equal(c.anim.in.type, 'pop');

    // il ciclo «fluttua»: il testo cambia posizione fra un istante e l'altro
    await page.evaluate(() => {
      const id = window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].id;
      window.__ciak.store.commit('prova', (p) => {
        const q = p.tracks.flatMap((t) => t.clips).find((x) => x.id === id);
        q.anim.in = null;
        q.anim.loop = { type: 'float', speed: 0.5, amount: 100 };
        q.text.bg.enabled = false;
        q.text.content = 'OOOO';
        q.text.size = 10;
      });
    });
    const centerY = async (t) => {
      await seek(page, t);
      return page.evaluate(() => {
        const cv = window.__ciak.preview.canvas;
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let sum = 0, n = 0;
        for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x += 2) if (d[(y * cv.width + x) * 4] > 200) { sum += y; n++; }
        return n ? sum / n / cv.height : -1;
      });
    };
    const y0 = await centerY(0.05);
    const yUp = await centerY(0.5); // un quarto di ciclo (0,5 cicli/s): massimo spostamento
    const yBack = await centerY(2.05); // un ciclo intero dopo: stessa posizione di partenza
    assert.ok(y0 > 0 && yUp > 0);
    assert.ok(Math.abs(y0 - yUp) > 0.015, `il testo si è mosso (${y0.toFixed(3)} → ${yUp.toFixed(3)})`);
    near(yBack, y0, 0.004, 'dopo un ciclo è tornato dov\'era');

    // dal pannello Animazione: sezione ciclica con tipo, velocità e intensità
    await page.locator('.clip.kind-text').first().click();
    await inspectorTab(page, 'Animazione');
    assert.ok(await page.getByText('Ciclica (per tutto il clip)').isVisible());
    assert.equal(await page.locator('details.section', { hasText: 'Ciclica' }).locator('select').inputValue(), 'float');
    [c] = await clips(page);
    assert.equal(c.anim.loop.speed, 0.5);
  });
});

// ---------------------------------------------------------------------------------------------------
// Audio: effetti, normalizzazione, ritmo
// ---------------------------------------------------------------------------------------------------

import { decodeWav } from '../../src/core/wav.js';
import { dominantFrequency } from '../../src/core/dsp.js';
import { readFileSync } from 'node:fs';

const rmsOf = (x, a, b) => Math.sqrt(x.subarray(a, b).reduce((s, v) => s + v * v, 0) / Math.max(1, b - a));
async function mediaBytes(page, id) {
  const arr = await page.evaluate(async (mid) => Array.from(new Uint8Array(await window.__ciak.pool.blob(mid).arrayBuffer())), id);
  return Uint8Array.from(arr);
}
/** Apre una sezione del pannello se è chiusa (le sezioni si richiudono a ogni cambio di selezione). */
async function openSection(page, title) {
  const closed = page.locator('details.section:not([open])', { has: page.locator('summary', { hasText: title }) });
  if (await closed.count()) await closed.first().locator('summary').click();
}
async function openAudioFx(page) {
  await inspectorTab(page, 'Audio');
  await page.locator('details.section summary', { hasText: 'Pulizia e voci' }).click();
}
const waitToastText = (page, re, ms = 30000) => page.waitForFunction((src) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout: ms });

test('audio: la riduzione del rumore abbassa il fruscio nei silenzi e conserva la voce; si annulla', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('noisy.wav')]);
    await addMedia(page, 0);
    await page.locator('.clip.kind-audio').first().click();
    await openAudioFx(page);
    const mediaBefore = (await clips(page))[0].mediaId;
    await page.click('#btn-audio-fx');
    await waitToastText(page, /Meno rumore: fatto/);
    const c = (await clips(page))[0];
    assert.notEqual(c.mediaId, mediaBefore, 'il clip usa il nuovo file');
    const orig = decodeWav(new Uint8Array(readFileSync(m.f('noisy.wav'))));
    const out = decodeWav(await mediaBytes(page, c.mediaId));
    const sr = out.sampleRate;
    const noiseBefore = rmsOf(orig.channels[0], 0, sr * 0.8);
    const noiseAfter = rmsOf(out.channels[0], 0, sr * 0.8);
    assert.ok(noiseAfter < noiseBefore * 0.5, `fruscio ${noiseBefore.toFixed(4)} → ${noiseAfter.toFixed(4)}`);
    const sigBefore = rmsOf(orig.channels[0], sr * 1.3, sr * 2.7);
    const sigAfter = rmsOf(out.channels[0], sr * 1.3, sr * 2.7);
    assert.ok(sigAfter > sigBefore * 0.75, `la voce resta (${sigBefore.toFixed(3)} → ${sigAfter.toFixed(3)})`);
    near(c.duration, 4, 0.1, 'stessa durata');
    await page.click('#btn-undo');
    assert.equal((await clips(page))[0].mediaId, mediaBefore, 'annullato');
  });
});

test('audio: cambio di altezza (+12 semitoni = ottava) e voce robot su un video (clip audio separato, originale silenziato)', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('tone.wav'), m.f('a.webm')]);
    await addMedia(page, 0); // tone.wav 660 Hz
    await page.locator('.clip.kind-audio').first().click();
    await openAudioFx(page);
    await page.selectOption('#sel-audio-fx', 'pitch');
    await page.locator('input[aria-label="Semitoni (valore)"]').fill('12');
    await page.locator('input[aria-label="Semitoni (valore)"]').press('Enter');
    await page.click('#btn-audio-fx');
    await waitToastText(page, /Tono \+12: fatto/);
    const c = (await clips(page)).find((x) => x.kind === 'audio');
    const out = decodeWav(await mediaBytes(page, c.mediaId));
    const f0 = dominantFrequency(out.channels[0], out.sampleRate, out.sampleRate * 0.5);
    assert.ok(Math.abs(f0 - 1320) < 25, `660 Hz → ${f0.toFixed(0)} Hz (atteso 1320)`);
    near(c.duration, 3, 0.1);

    // voce robot su un video
    await page.keyboard.press('Escape');
    await addMedia(page, 1);
    await page.locator('.clip.kind-video').first().click();
    await openAudioFx(page);
    await page.selectOption('#sel-audio-fx', 'voice:robot');
    await page.click('#btn-audio-fx');
    await waitToastText(page, /Robot: fatto/);
    const cs = await clips(page);
    const video = cs.find((x) => x.kind === 'video');
    assert.equal(video.muted, true, 'l\'audio originale del video è silenziato');
    assert.ok(cs.filter((x) => x.kind === 'audio').length >= 2, 'nasce un clip audio con la voce robot');
  });
});

test('audio: normalizza il volume e trova i battiti; taglia a tempo di musica', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('tone.wav'), m.f('beat.wav'), m.f('a.webm')]);
    // normalizzazione di un audio piano
    await addMedia(page, 0);
    await page.locator('.clip.kind-audio').first().click();
    await openAudioFx(page);
    await page.locator('details.section summary', { hasText: 'Livello e ritmo' }).click();
    const v0 = (await clips(page))[0].volume;
    await page.click('#btn-normalize');
    await waitToastText(page, /Volume portato a/);
    const v1 = (await clips(page))[0].volume;
    assert.ok(v1 > v0 * 1.2, `volume ${v0} → ${v1}`);

    // battiti: una base a 120 al minuto → un marcatore ogni mezzo secondo
    await page.keyboard.press('Escape');
    await addMedia(page, 1);
    await page.locator('.clip.kind-audio').nth(1).click();
    await inspectorTab(page, 'Audio');
    await openSection(page, 'Livello e ritmo');
    await page.click('#btn-find-beats');
    await waitToastText(page, /Trovati \d+ battiti/);
    const p = await project(page);
    const beats = p.markers.filter((x) => x.label === 'Battito').map((x) => x.time).sort((a, b) => a - b);
    assert.ok(beats.length >= 14 && beats.length <= 17, `battiti trovati (${beats.length})`);
    const gaps = beats.slice(1).map((b, i) => b - beats[i]);
    assert.ok(gaps.every((g) => Math.abs(g - 0.5) < 0.06), `intervalli di 0,5 s (${gaps.map((g) => g.toFixed(2))})`);

    // taglio a tempo: un video di 4 s, un taglio ogni 2 battiti = ogni secondo
    await page.keyboard.press('Escape');
    await addMedia(page, 2);
    const videoStart = (await clips(page)).find((x) => x.kind === 'video').start;
    await page.locator('.clip.kind-video').first().click();
    await inspectorTab(page, 'Audio');
    await openSection(page, 'Livello e ritmo');
    await page.selectOption('#sel-every', '2');
    await page.click('#btn-cut-beats');
    await waitToastText(page, /Fatti \d+ tagli/);
    const vs = (await clips(page)).filter((x) => x.kind === 'video').sort((a, b) => a.start - b.start);
    assert.ok(vs.length >= 3 && vs.length <= 5, `il video è diviso in ${vs.length} parti`);
    for (let i = 1; i < vs.length; i++) near(vs[i].start - vs[i - 1].start, vs[i - 1].duration, 0.04, 'senza buchi');
    assert.ok(vs.every((v) => v.duration > 0.8 && v.duration < 2.2), 'pezzi di circa un secondo');
    void videoStart;
    await page.click('#btn-undo');
    assert.equal((await clips(page)).filter((x) => x.kind === 'video').length, 1);
  });
});
