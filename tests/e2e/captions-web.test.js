// Sottotitoli automatici con il motore del BROWSER (Whisper «tiny» in WebAssembly) e voce umana vera (jfk.wav).
// Il modello e il motore vengono dai pacchetti npm di sviluppo, serviti dal server locale: nessuna rete. Se il modello manca la prova si salta.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, importFiles, clips, addMedia, openTab } from '../helpers/browser.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const JFK = path.join(ROOT, 'tests', 'fixtures', 'jfk.wav');
const have = existsSync(path.join(ROOT, 'node_modules', 'sts-whisper-tiny', 'models', 'Xenova', 'whisper-tiny', 'onnx', 'encoder_model_quantized.onnx'))
  && existsSync(path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist', 'ort-wasm-simd-threaded.jsep.wasm'));
const skip = have ? false : 'modello o motore WebAssembly non installati (npm i)';

let env;
before(async () => {
  if (!skip) env = await launch();
});
after(async () => env?.close());

test('sottotitoli automatici nel browser: Whisper vero in WebAssembly, interfaccia sempre reattiva', { skip, timeout: 240000 }, async () => {
  const s = await env.open();
  try {
    const { page } = s;
    await page.evaluate(() => {
      window.__ciakAsr = {
        transformersUrl: '/node_modules/@huggingface/transformers/dist/transformers.min.js',
        localModelPath: '/node_modules/sts-whisper-tiny/models/',
        wasmPaths: '/node_modules/onnxruntime-web/dist/',
      };
      // misura i «blocchi» della pagina mentre il riconoscimento lavora
      window.__maxGap = 0;
      let last = performance.now();
      setInterval(() => {
        const now = performance.now();
        window.__maxGap = Math.max(window.__maxGap, now - last);
        last = now;
      }, 50);
    });
    await importFiles(page, [JFK]);
    await addMedia(page, 0);
    await openTab(page, 'subtitles');
    await page.click('#btn-auto-captions');
    await page.selectOption('#cap-lang', 'en');
    assert.equal(await page.inputValue('#cap-model'), 'tiny');
    await page.click('#cap-run');
    await page.waitForSelector('#cap-list .cap-text', { timeout: 200000 });
    const texts = await page.locator('#cap-list .cap-text').evaluateAll((els) => els.map((e) => e.value));
    const all = texts.join(' ').toLowerCase();
    for (const w of ['fellow americans', 'ask not', 'your country', 'do for you']) assert.ok(all.includes(w), `manca «${w}» in «${all}»`);
    assert.ok(texts.length >= 2 && texts.length <= 6, `sottotitoli leggibili (${texts.length})`);
    const gap = await page.evaluate(() => window.__maxGap);
    assert.ok(gap < 2500, `la pagina non si è bloccata a lungo (${Math.round(gap)} ms)`);
    await page.click('#cap-add');
    await page.waitForSelector('#captions-dialog', { state: 'detached' });
    const subs = (await clips(page)).filter((c) => c.role === 'subtitle').sort((a, b) => a.start - b.start);
    assert.equal(subs.length, texts.length);
    assert.ok(subs[0].start > 0.1 && subs[0].start < 0.6, `parte quando inizia la voce: ${subs[0].start}`);
    for (let i = 1; i < subs.length; i++) assert.ok(subs[i].start >= subs[i - 1].start + subs[i - 1].duration - 1e-6, 'nessuna sovrapposizione');
    assert.ok(subs.at(-1).start + subs.at(-1).duration <= 11.6);
    assert.deepEqual(s.errors, []);
  } finally {
    await s.context.close();
  }
});
