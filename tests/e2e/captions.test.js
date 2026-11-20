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
    assert.equal(await page.isVisible('#cap-performance'), false, 'nel browser non c’è la scelta dell’uso del computer (solo nel programma per computer)');
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

test('sottotitoli automatici: «traduci in inglese» (anche bilingue) mantiene i tempi e usa la funzione di traduzione del riconoscitore', async () => {
  await withApp(async ({ page }) => {
    await page.evaluate(() => {
      window.__ciakAsr = {
        calls: [],
        engine: {
          available: async () => ({ ok: true }),
          transcribe: async (samples, o) => {
            window.__ciakAsr.calls.push({ task: o.task ?? 'transcribe', language: o.language });
            return o.task === 'translate' ? { text: 'English version of this sentence' } : { text: 'Questa è la frase originale in italiano, detta con calma e chiarezza.' };
          },
          dispose() {},
        },
      };
    });
    await setup(page);
    await page.evaluate(() => window.__ciak.selection.clear());
    await openCaptions(page);
    assert.equal(await page.isVisible('#cap-translate'), true);
    await page.selectOption('#cap-lang', 'en');
    assert.equal(await page.isVisible('#cap-translate'), false, 'in inglese non c’è nulla da tradurre');
    await page.selectOption('#cap-lang', 'it');
    await page.selectOption('#cap-translate', 'en');
    assert.equal(await page.isVisible('#cap-bilingual'), true);
    await page.check('#cap-bilingual');
    await page.click('#cap-run');
    await page.waitForSelector('#cap-list .cap-text');
    const texts = await rows(page);
    assert.ok(texts.every((t) => /English version/.test(t)), texts.join(' | '));
    const all = texts.join(' ').replace(/\s+/g, ' ');
    assert.ok(/Questa è la frase/.test(all) && /originale in italiano/.test(all) && /detta con calma/.test(all), 'in bilingue sotto resta l’originale');
    const calls = await page.evaluate(() => window.__ciakAsr.calls);
    assert.equal(calls[0].task, 'transcribe');
    assert.ok(calls.slice(1).every((c) => c.task === 'translate' && c.language === 'it'));
    assert.equal(calls.length - 1, texts.length, 'una chiamata di traduzione per sottotitolo');
    await page.click('#cap-add');
    await page.waitForSelector('#captions-dialog', { state: 'detached' });
    const s = await subs(page);
    assert.equal(s.length, texts.length);
    assert.ok(s[0].start > 0.15 && s[0].start < 0.5, 'i tempi sono quelli del parlato');
  });
});

// ---- audio di video lunghi o illeggibili dal browser -----------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { decodeWav } from '../../src/core/wav.js';

const JFK_SAMPLES = (() => {
  const w = decodeWav(new Uint8Array(readFileSync(JFK)));
  return { rate: w.sampleRate, data: Array.from(w.channels[0]) };
})();

/** Simula il caso dell'utente: il browser non riesce a decodificare l'audio del file (video pesante), ma il programma per computer sì (ffmpeg). */
const desktopBridge = (mode) => ({ jfk, mode }) => {
  window.__bridgeCalls = [];
  const orig = OfflineAudioContext.prototype.decodeAudioData;
  OfflineAudioContext.prototype.decodeAudioData = () => Promise.reject(new DOMException('Unable to decode audio data', 'EncodingError'));
  window.__origDecode = orig;
  window.ciakDesktop = {
    pathForFile: () => 'C:\\Video\\VID_20261116_112119.mp4',
    extractAudio: async (input, opts) => {
      window.__bridgeCalls.push({ path: input.path ?? null, bytes: input.bytes ? input.bytes.length : 0, ...opts });
      if (mode === 'noaudio') return { ok: false, noAudio: true, error: 'Questo file non ha una traccia audio.' };
      if (mode === 'fail') return { ok: false, error: 'ffmpeg non è riuscito a leggere l’audio: file danneggiato' };
      const s = Float32Array.from(jfk.data);
      return { ok: true, sampleRate: jfk.rate, channels: 1, samples: s };
    },
  };
};

test('sottotitoli automatici: se il browser non legge l’audio (video lungo e pesante) lo estrae ffmpeg dal file su disco, solo la parte usata', async () => {
  await withApp(async ({ page }) => {
    await page.evaluate(fakeEngine, TEXT);
    await setup(page);
    await page.evaluate(desktopBridge('ok'), { jfk: JFK_SAMPLES, mode: 'ok' });
    await selectClipByIndex(page, 0);
    await openCaptions(page);
    await page.selectOption('#cap-lang', 'en');
    await page.click('#cap-run');
    await page.waitForSelector('#cap-list .cap-text', { timeout: 30000 });
    const calls = await page.evaluate(() => window.__bridgeCalls);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, 'C:\\Video\\VID_20261116_112119.mp4', 'ffmpeg legge dal percorso del file, non dalla memoria');
    assert.equal(calls[0].bytes, 0);
    assert.equal(calls[0].sampleRate, 16000);
    assert.equal(calls[0].channels, 1);
    assert.equal(calls[0].from, 0);
    assert.ok(Math.abs(calls[0].to - 11) < 0.5, `solo la parte usata dal clip: fino a ${calls[0].to} s`);
    assert.match((await rows(page)).join(' '), /fellow Americans/);
  });
});

test('sottotitoli automatici: video senza traccia audio e ffmpeg che fallisce dicono la cosa giusta', async () => {
  await withApp(async ({ page }) => {
    await page.evaluate(fakeEngine, TEXT);
    await setup(page);
    await page.evaluate(desktopBridge('noaudio'), { jfk: JFK_SAMPLES, mode: 'noaudio' });
    await selectClipByIndex(page, 0);
    await openCaptions(page);
    await page.click('#cap-run');
    await page.waitForFunction(() => document.querySelector('#cap-status')?.dataset.state === 'error');
    assert.match(await page.textContent('#cap-status'), /non ha una traccia audio/);
    // ffmpeg non riesce e anche il browser no: il messaggio dice perché
    await page.evaluate(desktopBridge('fail'), { jfk: JFK_SAMPLES, mode: 'fail' });
    await page.click('#cap-run');
    await page.waitForFunction(() => /file danneggiato/.test(document.querySelector('#cap-status')?.textContent ?? ''));
    assert.match(await page.textContent('#cap-status'), /Non riesco a leggere l’audio di questo file/);
  });
});

test('sottotitoli automatici: nel browser, se l’audio non si decodifica, il messaggio spiega cosa fare', async () => {
  await withApp(async ({ page }) => {
    await page.evaluate(fakeEngine, TEXT);
    await setup(page);
    await page.evaluate(() => { OfflineAudioContext.prototype.decodeAudioData = () => Promise.reject(new DOMException('x', 'EncodingError')); });
    await selectClipByIndex(page, 0);
    await openCaptions(page);
    await page.click('#cap-run');
    await page.waitForFunction(() => document.querySelector('#cap-status')?.dataset.state === 'error');
    assert.match(await page.textContent('#cap-status'), /Non riesco a leggere l’audio di questo file.*formato dell’audio potrebbe non essere supportato/);
  });
});
