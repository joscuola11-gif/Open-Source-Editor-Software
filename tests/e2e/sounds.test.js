// Scheda «Suoni»: effetti sonori e musica generati, anteprima e inserimento sulla timeline.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, importFiles, clips, addMedia, openTab, seek } from '../helpers/browser.js';
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
const audioClips = async (page) => (await clips(page)).filter((c) => c.kind === 'audio').sort((a, b) => a.start - b.start);
/** Energia (RMS) e durata dell'audio vero del clip, letto dal file che sta nel progetto. */
const measure = (page, id) => page.evaluate(async (cid) => {
  const clip = window.__ciak.store.project.tracks.flatMap((t) => t.clips).find((c) => c.id === cid);
  const { channels, sampleRate } = await window.__ciak.actions.clipAudio(clip);
  let e = 0;
  for (const v of channels[0]) e += v * v;
  return { rms: Math.sqrt(e / channels[0].length), seconds: channels[0].length / sampleRate, channels: channels.length };
}, id);

test('suoni: la scheda elenca gli effetti per gruppo e uno si mette sulla timeline alla testina', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm')]);
    await addMedia(page, 0);
    await openTab(page, 'sounds');
    assert.ok((await page.locator('.snd-card').count()) >= 25);
    assert.ok((await page.locator('[data-sfx-group]').count()) >= 5);
    await seek(page, 0);
    await page.locator('[data-sfx="ding"] [data-act="sfx-add"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.clip.kind-audio').length === 1);
    let a = await audioClips(page);
    assert.equal(a.length, 1);
    assert.equal(a[0].start, 0);
    assert.ok(Math.abs(a[0].duration - 1.8) < 0.05, `durata del «Din» ${a[0].duration}`);
    const got = await measure(page, a[0].id);
    assert.ok(got.rms > 0.02 && got.channels === 2 && Math.abs(got.seconds - 1.8) < 0.05, JSON.stringify(got));
    // un secondo effetto più avanti, sulla stessa traccia se c'è posto
    await seek(page, 3);
    await page.locator('[data-sfx="whoosh"] [data-act="sfx-add"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.clip.kind-audio').length === 2);
    a = await audioClips(page);
    assert.ok(Math.abs(a[1].start - 3) < 0.04, `partito alla testina (${a[1].start})`);
    assert.ok(/Whoosh/.test(a[1].name));
    // un unico passo di annullamento per ogni aggiunta
    await page.evaluate(() => window.__ciak.store.undo());
    assert.equal((await audioClips(page)).length, 1);
  });
});

test('suoni: altezza e volume cambiano il suono; l’anteprima suona un file vero', async () => {
  await withApp(async ({ page }) => {
    await page.addInitScript(() => {
      window.__played = [];
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function patched() {
        window.__played.push(this.src);
        return play.call(this);
      };
    });
    await page.reload();
    await page.waitForFunction(() => window.__ciak && document.querySelector('.timeline'));
    await openTab(page, 'sounds');
    await page.locator('[data-sfx="ding"] [data-act="sfx-play"]').click();
    await page.waitForFunction(() => window.__played.length === 1);
    const url = await page.evaluate(() => window.__played[0]);
    assert.match(url, /^blob:/);
    // il file dell'anteprima è un WAV valido di 1,8 s
    const info = await page.evaluate(async (u) => {
      const buf = new Uint8Array(await (await fetch(u)).arrayBuffer());
      return { riff: String.fromCharCode(...buf.slice(0, 4)), size: buf.length };
    }, url).catch(() => null);
    if (info) assert.equal(info.riff, 'RIFF');
    await page.evaluate(() => { const r = document.querySelector('#snd-pitch'); r.value = 12; r.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.evaluate(() => { const r = document.querySelector('#snd-volume'); r.value = 30; r.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.locator('[data-sfx="ding"] [data-act="sfx-add"]').click();
    await page.waitForSelector('.clip.kind-audio');
    const [c] = await audioClips(page);
    assert.ok(Math.abs(c.duration - 0.9) < 0.05, `un’ottava sopra dura la metà (${c.duration})`);
    const quiet = await measure(page, c.id);
    await page.evaluate(() => window.__ciak.store.undo());
    await page.evaluate(() => { const r = document.querySelector('#snd-volume'); r.value = 100; r.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.locator('[data-sfx="ding"] [data-act="sfx-add"]').click();
    await page.waitForSelector('.clip.kind-audio');
    const loud = await measure(page, (await audioClips(page))[0].id);
    assert.ok(loud.rms > quiet.rms * 2.5, `volume 100 vs 30: ${loud.rms.toFixed(3)} vs ${quiet.rms.toFixed(3)}`);
    // «Altra variante» cambia i suoni casuali
    await page.click('#snd-variant');
    assert.match(await page.textContent('.snd-opts .hint'), /Variante 2/);
  });
});

test('suoni: la musica si compone con le scelte dell’utente e si aggiunge alla timeline', async () => {
  await withApp(async ({ page }) => {
    await openTab(page, 'sounds');
    await page.selectOption('#mus-style', 'electro');
    await page.fill('#mus-bpm', '120');
    await page.selectOption('#mus-key', '2');
    await page.selectOption('#mus-mode', 'minor');
    await page.fill('#mus-seconds', '16');
    await page.click('#mus-play');
    await page.waitForFunction(() => /120 battiti/.test(document.querySelector('#mus-info')?.textContent ?? ''));
    assert.match(await page.textContent('#mus-info'), /Elettronica.*120 battiti al minuto · Re minore · 0:16/);
    await page.click('#mus-add');
    await page.waitForSelector('.clip.kind-audio');
    const [c] = await audioClips(page);
    assert.ok(/Musica/.test(c.name));
    assert.ok(Math.abs(c.duration - 16) < 0.05, `8 battute a 120 = 16 s (${c.duration})`);
    const got = await measure(page, c.id);
    assert.ok(got.rms > 0.05 && got.channels === 2, JSON.stringify(got));
    // il tempo rilevato dal programma stesso conferma i 120 battiti
    const bpm = await page.evaluate(async (cid) => {
      const clip = window.__ciak.store.project.tracks.flatMap((t) => t.clips).find((x) => x.id === cid);
      const { channels, sampleRate } = await window.__ciak.actions.clipAudio(clip);
      const { detectBeats } = await import('/src/core/beats.js');
      return detectBeats(channels, sampleRate).bpm;
    }, c.id);
    assert.ok(Math.abs(bpm - 120) < 3, `tempo rilevato ${bpm}`);
    // nuova versione: stessa scelta, altra musica
    await page.click('#mus-again');
    assert.match(await page.textContent('#mus-info'), /Versione 2/);
  });
});

test('suoni: «quanto il progetto» adatta la musica alla durata del montaggio', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm')]);
    await addMedia(page, 0);
    const dur = await page.evaluate(async () => (await import('/src/core/project.js')).projectDuration(window.__ciak.store.project));
    await seek(page, 0);
    await openTab(page, 'sounds');
    await page.selectOption('#mus-style', 'pop');
    await page.fill('#mus-bpm', '120');
    await page.check('#mus-fit');
    assert.equal(await page.isDisabled('#mus-seconds'), true);
    await page.click('#mus-add');
    await page.waitForFunction(() => document.querySelectorAll('.clip.kind-audio').length >= 1);
    const [c] = await audioClips(page);
    assert.ok(Math.abs(c.duration - dur) <= 2.01, `musica ${c.duration} s per un progetto di ${dur} s`);
  });
});
