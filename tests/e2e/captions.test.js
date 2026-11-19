// Sottotitoli automatici: finestra, metodi (riconoscimento con motore finto, testo da allineare, solo tempi), correzione e inserimento in timeline.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, importFiles, clips, addMedia, openTab, selectClipByIndex } from '../helpers/browser.js';

const JFK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'jfk.wav');
const TEXT = 'And so my fellow Americans ask not what your country can do for you, ask what you can do for your country.';

let env;
before(async () => {
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

/** Motore finto: restituisce il testo (senza tempi buoni) la prima volta e vuoto dopo, e conta le chiamate. */
const fakeEngine = (text) => {
  window.__ciakAsr = {
    calls: [],
    engine: {
      kind: 'fake',
      available: async () => ({ ok: true }),
      transcribe: async (samples, o) => {
        window.__ciakAsr.calls.push({ n: samples.length, language: o.language });
        return { text: window.__ciakAsr.calls.length === 1 ? text : '', words: [] };
      },
      dispose() {},
    },
  };
};

async function setup(page) {
  await importFiles(page, [JFK]);
  await addMedia(page, 0);
}
const subs = async (page) => (await clips(page)).filter((c) => c.role === 'subtitle').sort((a, b) => a.start - b.start);
const openCaptions = async (page) => {
  await openTab(page, 'subtitles');
  await page.click('#btn-auto-captions');
  await page.waitForSelector('#captions-dialog');
};
const rows = (page) => page.locator('#cap-list .cap-text').evaluateAll((els) => els.map((e) => e.value));

test('sottotitoli automatici: riconoscimento → elenco da correggere → clip a tempo sulla traccia Sottotitoli', async () => {
  await withApp(async ({ page }) => {
    await page.evaluate(fakeEngine, TEXT);
    await setup(page);
    await selectClipByIndex(page, 0);
    await openCaptions(page);
    assert.equal(await page.inputValue('#cap-source'), 'clip', 'con un clip selezionato parte da quello');
    assert.equal(await page.inputValue('#cap-lang'), 'it');
    await page.selectOption('#cap-lang', 'en');
    await page.click('#cap-run');
    await page.waitForSelector('#cap-list .cap-text');
    const texts = await rows(page);
    assert.ok(texts.length >= 2, `più sottotitoli, non uno solo (${texts.length})`);
    assert.match(texts.join(' '), /fellow Americans/);
    assert.match(texts.join(' '), /your country/);
    const calls = await page.evaluate(() => window.__ciakAsr.calls);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].language, 'en');
    assert.ok(Math.abs(calls[0].n / 16000 - 11) < 3, 'al motore arriva l’audio a 16 kHz');
    assert.match(await page.textContent('#cap-status'), /sottotitoli pronti/);
    // si corregge una riga a mano
    await page.locator('#cap-list .cap-text').first().fill('Così, miei cari americani');
    await page.click('#cap-add');
    await page.waitForSelector('#captions-dialog', { state: 'detached' });
    const s = await subs(page);
    assert.equal(s.length, texts.length);
    assert.equal(s[0].text.content, 'Così, miei cari americani');
    assert.equal(s[0].text.words, null, 'testo corretto a mano: niente tempi delle parole vecchie');
    // tempi: dentro l'audio, in ordine, senza sovrapposizioni; il primo parte quando inizia la voce (circa 0,7 s)
    assert.ok(s[0].start > 0.15 && s[0].start < 0.5, `inizia quando inizia la voce (0,25 s), non a zero né dopo: ${s[0].start}`);
    for (let i = 0; i < s.length; i++) {
      assert.ok(s[i].duration >= 0.5, `durata leggibile ${s[i].duration}`);
      assert.ok(s[i].start + s[i].duration <= 11.6);
      if (i) assert.ok(s[i].start >= s[i - 1].start + s[i - 1].duration - 1e-6, 'nessuna sovrapposizione');
    }
    const track = await page.evaluate(() => window.__ciak.store.project.tracks.find((t) => t.clips.some((c) => c.role === 'subtitle')).name);
    assert.equal(track, 'Sottotitoli');
    // l'annullamento toglie tutto in un passo solo
    await page.evaluate(() => window.__ciak.store.undo());
    assert.equal((await subs(page)).length, 0);
  });
});

test('sottotitoli automatici: karaoke porta i tempi delle parole e «sostituisci» rimpiazza i precedenti', async () => {
  await withApp(async ({ page }) => {
    await page.evaluate(fakeEngine, TEXT);
    await setup(page);
    await page.evaluate(() => window.__ciak.selection.clear());
    await openCaptions(page);
    assert.equal(await page.inputValue('#cap-source'), 'project', 'senza selezione: tutto il progetto');
    await page.selectOption('#cap-lang', 'en');
    await page.selectOption('#cap-style', 'short');
    await page.selectOption('#cap-look', 'karaoke');
    await page.click('#cap-run');
    await page.waitForSelector('#cap-list .cap-text');
    const n1 = (await rows(page)).length;
    assert.ok(n1 >= 4, `stile «corti»: più sottotitoli (${n1})`);
    await page.click('#cap-add');
    await page.waitForSelector('#captions-dialog', { state: 'detached' });
    const first = await subs(page);
    assert.equal(first.length, n1);
    assert.ok(first.every((c) => c.text.karaoke?.enabled), 'aspetto karaoke attivo');
    const withWords = first.filter((c) => c.text.words);
    assert.ok(withWords.length >= 3, 'le parole hanno i tempi');
    for (const c of withWords) {
      assert.equal(c.text.words[0].t, 0);
      assert.ok(c.text.words.every((w, i, a) => !i || w.t >= a[i - 1].t && w.t <= c.duration + 0.5));
    }
    // seconda esecuzione, «sostituisci» è attivo di base: non si duplicano
    await openCaptions(page);
    assert.equal(await page.isChecked('#cap-replace'), true);
    await page.selectOption('#cap-lang', 'en');
    await page.evaluate(fakeEngine, TEXT);
    await page.click('#cap-run');
    await page.waitForSelector('#cap-list .cap-text');
    const n2 = (await rows(page)).length;
    assert.notEqual(n2, n1, 'stile diverso, numero diverso: così si vede che i vecchi sono stati tolti');
    await page.click('#cap-add');
    await page.waitForSelector('#captions-dialog', { state: 'detached' });
    assert.equal((await subs(page)).length, n2, 'rimpiazzati, non aggiunti ai precedenti');
  });
});

test('sottotitoli automatici: «ho già il testo» mette a tempo il copione senza riconoscimento', async () => {
  await withApp(async ({ page }) => {
    await page.evaluate(fakeEngine, TEXT);
    await setup(page);
    await openCaptions(page);
    await page.selectOption('#cap-method', 'script');
    assert.equal(await page.isVisible('#cap-script'), true);
    assert.equal(await page.isVisible('#cap-model'), false);
    await page.click('#cap-run');
    assert.match(await page.textContent('#cap-status'), /Scrivi o incolla il testo/);
    await page.fill('#cap-script', 'And so, my fellow Americans: ask not what your country can do for you. Ask what you can do for your country.');
    await page.click('#cap-run');
    await page.waitForSelector('#cap-list .cap-text');
    const texts = await rows(page);
    assert.match(texts.join(' '), /ask not what your country/i);
    assert.equal(await page.evaluate(() => window.__ciakAsr.calls.length), 0, 'nessun riconoscimento: il testo è quello dell’utente');
    await page.click('#cap-add');
    await page.waitForSelector('#captions-dialog', { state: 'detached' });
    const s = await subs(page);
    assert.ok(s.length >= 2);
    assert.ok(s[0].start > 0.15 && s[0].start < 0.5, `il testo parte con la voce (0,25 s) (${s[0].start})`);
  });
});

test('sottotitoli automatici: «solo i tempi» crea righe vuote da riempire', async () => {
  await withApp(async ({ page }) => {
    await page.evaluate(fakeEngine, TEXT);
    await setup(page);
    await openCaptions(page);
    await page.selectOption('#cap-method', 'timing');
    assert.equal(await page.isVisible('#cap-lang'), false);
    await page.click('#cap-run');
    await page.waitForSelector('#cap-list .cap-text');
    const texts = await rows(page);
    assert.ok(texts.length >= 1 && texts.every((t) => t === ''));
    // con le righe vuote non si aggiunge nulla
    await page.click('#cap-add');
    assert.equal((await subs(page)).length, 0);
    assert.equal(await page.isVisible('#captions-dialog'), true, 'la finestra resta aperta');
    await page.locator('#cap-list .cap-text').first().fill('Prima frase');
    await page.click('#cap-add');
    await page.waitForSelector('#captions-dialog', { state: 'detached' });
    const s = await subs(page);
    assert.equal(s.length, 1);
    assert.equal(s[0].text.content, 'Prima frase');
  });
});

test('sottotitoli automatici: i tempi seguono il clip (spostato più avanti) e l’errore del motore si mostra senza rompere nulla', async () => {
  await withApp(async ({ page }) => {
    await page.evaluate(fakeEngine, TEXT);
    await setup(page);
    await page.evaluate(() => window.__ciak.commit('Sposta', (d) => { d.tracks.flatMap((t) => t.clips)[0].start = 3; }));
    await selectClipByIndex(page, 0);
    await openCaptions(page);
    await page.selectOption('#cap-lang', 'en');
    await page.click('#cap-run');
    await page.waitForSelector('#cap-list .cap-text');
    await page.click('#cap-add');
    await page.waitForSelector('#captions-dialog', { state: 'detached' });
    const s = await subs(page);
    assert.ok(s[0].start > 3.15 && s[0].start < 3.5, `parte con la voce dentro il clip spostato (${s[0].start})`);
    // motore che fallisce
    await page.evaluate(() => {
      window.__ciakAsr = { engine: { available: async () => ({ ok: true }), transcribe: async () => { throw new Error('Non riesco a scaricare il modello di riconoscimento vocale: serve internet la prima volta.'); }, dispose() {} } };
    });
    await openCaptions(page);
    await page.click('#cap-run');
    await page.waitForFunction(() => document.querySelector('#cap-status')?.dataset.state === 'error');
    assert.match(await page.textContent('#cap-status'), /serve internet/);
    assert.equal(await page.isDisabled('#cap-run'), false, 'si può riprovare');
    // il motore non c'è proprio
    await page.evaluate(() => {
      window.__ciakAsr = { engine: { available: async () => ({ ok: false, reason: 'Il motore non si avvia su questo computer.' }), transcribe: async () => ({}), dispose() {} } };
    });
    await page.click('#cap-run');
    await page.waitForFunction(() => /non si avvia/.test(document.querySelector('#cap-status')?.textContent ?? ''));
  });
});

test('sottotitoli automatici: esporta SRT con i tempi della timeline', async () => {
  await withApp(async ({ page }) => {
    await page.evaluate(fakeEngine, TEXT);
    await setup(page);
    await openCaptions(page);
    await page.selectOption('#cap-lang', 'en');
    await page.click('#cap-run');
    await page.waitForSelector('#cap-list .cap-text');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#cap-srt')]);
    assert.match(dl.suggestedFilename(), /\.srt$/);
    const text = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
    assert.match(text, /^1\n00:00:0\d,\d{3} --> 00:00:\d\d,\d{3}\n/);
    assert.match(text, /Americans/);
  });
});
