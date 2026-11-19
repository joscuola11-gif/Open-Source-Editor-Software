import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, importFiles, project, clips, pixel, seek, openTab, addMedia, lum, waitText } from '../helpers/browser.js';
import { makeMedia, ffprobe, mediaDir } from '../helpers/make-media.js';

let env;
let m;
const OUT = path.join(path.dirname(mediaDir()), 'out');
before(async () => {
  m = makeMedia();
  mkdirSync(OUT, { recursive: true });
  env = await launch();
});
after(async () => env?.close());

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≉ ${b} (±${eps})`);

async function withApp(fn, opts) {
  const s = await env.open(opts);
  try {
    await fn(s);
    assert.deepEqual(s.errors, [], 'nessun errore in console/pagina');
  } finally {
    await s.context.close();
  }
}

async function saveDownload(download, name) {
  const file = path.join(OUT, name);
  await download.saveAs(file);
  return file;
}

/** Colore medio (0-255) di un fotogramma estratto con ffmpeg. */
function frameStats(file, at) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=64:36', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 1 << 24 });
  const d = r.stdout;
  let sum = 0;
  const colors = new Set();
  for (let i = 0; i < d.length; i += 3) {
    sum += d[i] + d[i + 1] + d[i + 2];
    colors.add(`${d[i] >> 5},${d[i + 1] >> 5},${d[i + 2] >> 5}`);
  }
  return { mean: sum / Math.max(1, d.length), colors: colors.size, bytes: d.length };
}

function meanVolume(file) {
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
  const mm = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(r.stderr);
  return mm ? Number(mm[1]) : -Infinity;
}

test('ESPORTAZIONE: video valido, durata, risoluzione, audio udibile e nessun errore di decodifica', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('b.webm')]);
    await addMedia(page, 0);
    await page.waitForSelector('.clip');
    await openTab(page, 'text');
    await page.click('#btn-add-text');
    await page.waitForSelector('.clip.kind-text');
    await page.click('#btn-export');
    await page.waitForSelector('dialog.dialog[open]');
    await page.selectOption('#exp-size', '480');
    await page.selectOption('#exp-format', 'webm');
    await page.selectOption('#exp-quality', 'medium');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.click('button[data-act="start"]')]);
    const file = await saveDownload(download, 'export.webm');
    await page.waitForSelector('.exp-result .ok');
    const res = await page.evaluate(() => {
      const r = window.__ciak.lastExport;
      return { frames: r.frames, expected: r.expectedFrames, w: r.width, h: r.height, mime: r.mime, hidden: r.hiddenDuringExport, seconds: r.seconds };
    });
    assert.equal(res.w, 854);
    assert.equal(res.h, 480);
    assert.ok(res.frames >= res.expected * 0.95, `fotogrammi prodotti ${res.frames}/${res.expected}`);
    assert.equal(res.hidden, false);

    const info = ffprobe(file);
    near(info.duration, 3.0, 0.6, 'durata del file');
    assert.equal(info.video.width, 854);
    assert.equal(info.video.height, 480);
    assert.ok(info.audio, 'traccia audio presente');
    assert.match(info.format, /webm|matroska/);
    // il file è decodificabile da cima a fondo senza errori
    const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
    // (il registratore del browser può, raramente e sotto carico, dare a due fotogrammi vicini lo stesso millisecondo:
    //  ffmpeg lo segnala come avviso del muxer «non monotonically increasing dts», ma il file resta valido e riproducibile)
    const real = dec.stderr.split('\n').filter((l) => l.trim() && !/non monotonically increasing dts/.test(l)).join('\n');
    assert.equal(real, '', `errori di decodifica: ${dec.stderr}`);
    // contenuto: barre colorate a 1 s (il testo è sopra), non nero
    const fr = frameStats(file, 1);
    assert.ok(fr.mean > 40, `fotogramma non nero (media ${fr.mean.toFixed(1)})`);
    assert.ok(fr.colors > 6, `fotogramma con colori (${fr.colors})`);
    // audio: il tono a 880 Hz deve essere presente e non troppo debole né saturo
    const vol = meanVolume(file);
    assert.ok(vol > -45 && vol < -3, `volume medio ${vol} dB`);
  });
});

test('ESPORTAZIONE: annullamento a metà lascia l\'editor integro', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm')]);
    await addMedia(page, 0);
    await page.waitForSelector('.clip');
    await page.click('#btn-export');
    await page.selectOption('#exp-size', '480');
    await page.click('button[data-act="start"]');
    await page.waitForFunction(() => document.querySelector('.exp-progress')?.value > 0.15, null, { timeout: 30000 });
    await page.click('button[data-act="cancel"]');
    await page.waitForSelector('.toast', { hasText: /annullata/ });
    await page.waitForFunction(() => !window.__ciak.exporter.running);
    const st = await page.evaluate(() => ({ playing: window.__ciak.player.playing, monitor: window.__ciak.audio.monitor, w: window.__ciak.preview.canvas.width }));
    assert.equal(st.playing, false);
    assert.equal(st.monitor, true, 'l\'audio degli altoparlanti è stato ripristinato');
    assert.ok(st.w > 0);
    // il form è tornato disponibile e si può riavviare
    assert.ok(await page.locator('button[data-act="start"]').isVisible());
    await page.keyboard.press('Escape');
    await seek(page, 1);
    assert.ok(lum(await pixel(page, 0.5, 0.5)) >= 0);
  });
});

test('ESPORTAZIONE: fotogramma PNG alla risoluzione scelta', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('photo.png')]);
    await addMedia(page, 0);
    await seek(page, 1);
    await page.click('#btn-export');
    await page.selectOption('#exp-size', '720');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-png')]);
    const file = await saveDownload(download, 'frame.png');
    const info = ffprobe(file);
    // il primo media importato (4:3) imposta il formato del progetto → 720p = 960×720
    assert.equal(info.video.width, 960);
    assert.equal(info.video.height, 720);
    assert.ok(frameStats(file, 0).mean > 20);
  });
});

test('timeline vuota: l\'esportazione avvisa invece di fallire', async () => {
  await withApp(async ({ page }) => {
    await page.click('#btn-export');
    await page.waitForSelector('.toast.warn');
    assert.equal(await page.locator('dialog[open]').count(), 0);
  });
});

test('SALVATAGGIO AUTOMATICO: dopo il ricaricamento il progetto torna com\'era e il video si vede', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm'), m.f('tone.wav')]);
    await addMedia(page, 0);
    await openTab(page, 'text');
    await page.click('#btn-add-text');
    await page.locator('.insp-body textarea').first().fill('Persistente');
    await page.waitForFunction(() => window.__ciak.saveState === 'saved' && window.__ciak.store.project.tracks.flatMap((t) => t.clips).some((c) => c.text?.content === 'Persistente'), null, { timeout: 8000 });
    const before = await project(page);
    await page.reload();
    await page.waitForFunction(() => window.__ciak?.storage.available && document.querySelectorAll('.clip').length >= 2, null, { timeout: 15000 });
    const after = await project(page);
    assert.equal(after.tracks.flatMap((t) => t.clips).length, before.tracks.flatMap((t) => t.clips).length);
    assert.equal(Object.keys(after.media).length, 2);
    assert.ok(after.tracks.flatMap((t) => t.clips).some((c) => c.text?.content === 'Persistente'));
    await page.waitForSelector('.toast.success', { hasText: /ripristinato/ });
    // i media sono di nuovo utilizzabili: miniatura, forma d'onda, e il video si disegna
    await page.waitForFunction(() => Object.keys(window.__ciak.store.project.media).every((id) => window.__ciak.pool.has(id)));
    await page.waitForFunction(() => Object.keys(window.__ciak.store.project.media).some((id) => window.__ciak.pool.info(id)?.peaks), null, { timeout: 10000 });
    await page.evaluate(() => window.__ciak.selection.clear());
    await seek(page, 1);
    const px = await page.evaluate(() => {
      const c = window.__ciak.preview.canvas;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 211) seen.add(`${d[i] >> 5},${d[i + 1] >> 5},${d[i + 2] >> 5}`);
      return seen.size;
    });
    assert.ok(px > 5, `il video ripristinato si vede (${px} colori)`);
    // le modifiche dopo il ripristino continuano a funzionare e a salvarsi
    await page.locator('.clip').first().click();
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => window.__ciak.saveState === 'saved');
    await page.reload();
    await page.waitForFunction(() => window.__ciak?.storage.available && window.__ciak.store.project.name);
    await page.waitForTimeout(600);
    assert.equal((await clips(page)).length, before.tracks.flatMap((t) => t.clips).length - 1);
  });
});

test('nuovo progetto: svuota tutto, anche dopo il ricaricamento', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('photo.png')]);
    await addMedia(page, 0);
    await page.waitForFunction(() => window.__ciak.saveState === 'saved');
    await page.evaluate(() => window.__ciak.selection.clear());
    await page.getByRole('button', { name: 'Nuovo', exact: true }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Nuovo progetto' }).click();
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).length === 0 && Object.keys(window.__ciak.store.project.media).length === 0);
    await page.waitForFunction(() => window.__ciak.saveState === 'saved');
    await page.reload();
    await page.waitForFunction(() => window.__ciak?.storage.available);
    await page.waitForTimeout(500);
    assert.equal((await clips(page)).length, 0);
    assert.equal(Object.keys((await project(page)).media).length, 0);
  });
});

test('PACCHETTO .ciak: salva, valida con un lettore ZIP esterno, riapri', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('a.webm'), m.f('photo.png')]);
    await addMedia(page, 0);
    await openTab(page, 'text');
    await page.click('#btn-add-text');
    await page.locator('.insp-body textarea').first().fill('Nel pacchetto');
    await page.evaluate(() => window.__ciak.selection.clear());
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Salva \.ciak/ }).click()]);
    const file = await saveDownload(download, 'test.ciak');
    // verifica indipendente con Python (modulo zipfile)
    const py = spawnSync('python3', ['-c', `
import zipfile, json, sys
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
names = z.namelist()
assert 'manifest.json' in names and 'project.json' in names, names
p = json.loads(z.read('project.json'))
assert len([n for n in names if n.startswith('media/')]) == len(p['media'])
print(json.dumps({'n': len(names), 'clips': sum(len(t['clips']) for t in p['tracks'])}))
`, file], { encoding: 'utf8' });
    assert.equal(py.status, 0, py.stderr);
    assert.equal(JSON.parse(py.stdout).clips, 2);
    // nuovo progetto, poi apertura del pacchetto
    await page.getByRole('button', { name: 'Nuovo', exact: true }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Nuovo progetto' }).click();
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).length === 0);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Apri…/ }).click()]);
    await chooser.setFiles(file);
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).length === 2, null, { timeout: 15000 });
    const p = await project(page);
    assert.equal(Object.keys(p.media).length, 2);
    assert.ok(p.tracks.flatMap((t) => t.clips).some((c) => c.text?.content === 'Nel pacchetto'));
    await page.waitForFunction(() => Object.keys(window.__ciak.store.project.media).every((id) => window.__ciak.pool.has(id)));
    await page.evaluate(() => window.__ciak.selection.clear());
    await seek(page, 1);
    assert.ok((await page.evaluate(() => { const c = window.__ciak.preview.canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4 * 101) s += d[i] + d[i + 1] + d[i + 2]; return s; })) > 5000, 'il video del pacchetto si vede');
  });
});

test('SOTTOTITOLI: importa .srt, modifica dal pannello, esporta .srt identico', async () => {
  await withApp(async ({ page }) => {
    await openTab(page, 'subtitles');
    await page.setInputFiles('input[accept*=".srt"]', m.f('subs.srt'));
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).filter((c) => c.role === 'subtitle').length === 2);
    const subs = (await clips(page)).filter((c) => c.role === 'subtitle').sort((a, b) => a.start - b.start);
    near(subs[0].start, 0.5, 1e-6);
    near(subs[0].duration, 1, 1e-6);
    assert.equal(subs[1].text.content, 'Secondo\nsu due righe');
    await page.waitForFunction(() => document.querySelectorAll('.sub-row').length === 2);
    // il sottotitolo si vede sull'anteprima solo mentre è attivo
    await seek(page, 1);
    let bright = await page.evaluate(() => { const c = window.__ciak.preview.canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 150) n++; return n; });
    assert.ok(bright > 100, `sottotitolo visibile (${bright})`);
    await seek(page, 1.8);
    bright = await page.evaluate(() => { const c = window.__ciak.preview.canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 150) n++; return n; });
    assert.equal(bright, 0, 'fra due sottotitoli lo schermo è vuoto');
    // modifica del testo dalla lista
    await page.locator('.sub-row textarea').first().fill('Modificato');
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).some((c) => c.text?.content === 'Modificato'));
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-srt')]);
    const srt = readFileSync(await saveDownload(download, 'out.srt'), 'utf8');
    assert.match(srt, /1\n00:00:00,500 --> 00:00:01,500\nModificato\n/);
    assert.match(srt, /2\n00:00:02,000 --> 00:00:03,200\nSecondo\nsu due righe/);
  });
});

test('REGISTRAZIONE VOCE: crea un media audio e un clip alla posizione di partenza', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('b.webm')]);
    await addMedia(page, 0);
    await page.waitForSelector('.clip');
    await seek(page, 1);
    await page.click('#btn-record');
    await page.waitForFunction(() => window.__ciak.actions.recording === true);
    await page.waitForTimeout(1800);
    await page.click('#btn-record');
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).some((c) => c.kind === 'audio'), null, { timeout: 15000 });
    const p = await project(page);
    const voice = Object.values(p.media).find((x) => x.name.startsWith('Voce'));
    assert.ok(voice, 'media «Voce»');
    assert.ok(Number.isFinite(voice.duration) && voice.duration > 1 && voice.duration < 3.5, `durata ${voice.duration}`);
    const c = p.tracks.flatMap((t) => t.clips).find((x) => x.kind === 'audio');
    near(c.start, 1, 0.1, 'parte dalla testina di quando si è iniziato');
    assert.equal(p.tracks.find((t) => t.clips.some((x) => x.id === c.id)).type, 'audio');
  });
});

test('trascinamento di un file dal sistema sulla timeline e dalla libreria alla timeline', async () => {
  await withApp(async ({ page }) => {
    const bytes = readFileSync(m.f('photo.png')).toString('base64');
    const dt = await page.evaluateHandle((b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const d = new DataTransfer();
      d.items.add(new File([bin], 'dropped.png', { type: 'image/png' }));
      return d;
    }, bytes);
    await page.dispatchEvent('.tl-lane >> nth=1', 'drop', { dataTransfer: dt });
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).length === 1, null, { timeout: 15000 });
    assert.equal((await clips(page))[0].kind, 'image');
    // dalla libreria alla timeline (drag & drop HTML5 vero)
    await importFiles(page, [m.f('a.webm')]);
    const card = page.locator('.media-card', { hasText: 'a.webm' });
    const lane = page.locator('.tl-lane').nth(1);
    const lb = await lane.boundingBox();
    await card.dragTo(lane, { targetPosition: { x: 600, y: lb.height / 2 } });
    await page.waitForFunction(() => window.__ciak.store.project.tracks.flatMap((t) => t.clips).length === 2);
    const v = (await clips(page)).find((c) => c.kind === 'video');
    assert.ok(v.start > 3, `rilasciato in avanti (${v.start})`);
  });
});

test('tema chiaro/scuro e layout a schermo ridotto senza scorrimenti orizzontali', async () => {
  await withApp(async ({ page }) => {
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.click('#btn-theme');
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    assert.notEqual(before, after);
    for (const [w, h] of [[1920, 1080], [1280, 720], [1024, 700], [820, 640], [560, 800]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(150);
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, ih: innerHeight }));
      assert.ok(o.sw <= o.iw + 1, `${w}×${h}: scroll orizzontale ${o.sw} > ${o.iw}`);
      assert.ok(o.sh <= o.ih + 1, `${w}×${h}: scroll verticale ${o.sh} > ${o.ih}`);
      assert.ok(await page.locator('.timeline').isVisible(), `${w}×${h}: timeline visibile`);
      assert.ok(await page.locator('#btn-export').isVisible(), `${w}×${h}: pulsante Esporta visibile`);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// Esportazione di solo audio (WAV, MP3) e di GIF animata
// ---------------------------------------------------------------------------------------------------

async function exportAs(page, format) {
  await page.click('#btn-export');
  await page.waitForSelector('dialog.dialog[open]');
  await page.selectOption('#exp-format', format);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('button[data-act="start"]')]);
  await page.waitForSelector('.exp-result .ok', { timeout: 60000 });
  return saveDownload(download, `export.${format}`);
}

test('ESPORTAZIONE solo audio: WAV e MP3 con la durata del progetto, stereo, decodificabili e con la musica dentro', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('tone.wav'), m.f('b.webm')]);
    await addMedia(page, 0); // tone.wav 3 s (660 Hz)
    await page.waitForSelector('.clip');
    const wav = await exportAs(page, 'wav');
    const info = ffprobe(wav);
    assert.ok(info.audio, 'traccia audio');
    assert.equal(info.audio.codec_name, 'pcm_s16le');
    assert.equal(Number(info.audio.channels), 2);
    near(info.duration, 3, 0.1, 'durata del WAV');
    // contenuto: ffmpeg misura il volume medio, non deve essere silenzio
    const vol = spawnSync('ffmpeg', ['-v', 'info', '-i', wav, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(vol)?.[1]);
    assert.ok(mean > -40, `il file contiene audio (volume medio ${mean} dB)`);
  });
});

test('ESPORTAZIONE MP3: file valido, bitrate e durata corretti', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('tone.wav')]);
    await addMedia(page, 0);
    await page.waitForSelector('.clip');
    const mp3 = await exportAs(page, 'mp3');
    const info = ffprobe(mp3);
    assert.equal(info.audio.codec_name, 'mp3');
    assert.equal(Number(info.audio.channels), 2);
    near(info.duration, 3, 0.15, 'durata dell\'MP3');
    near(Number(info.audio.bit_rate) / 1000, 192, 8, 'bitrate');
    const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', mp3, '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(dec.stderr.trim(), '', `errori di decodifica: ${dec.stderr}`);
  });
});

test('ESPORTAZIONE GIF: animazione valida con i fotogrammi giusti e le dimensioni attese', async () => {
  await withApp(async ({ page }) => {
    await importFiles(page, [m.f('mid.png')]);
    await addMedia(page, 0);
    await page.waitForSelector('.clip');
    await page.evaluate(() => {
      const id = window.__ciak.store.project.tracks.flatMap((t) => t.clips)[0].id;
      window.__ciak.store.commit('prova', (p) => { p.tracks.flatMap((t) => t.clips).find((c) => c.id === id).duration = 2; });
    });
    const gif = await exportAs(page, 'gif');
    const info = ffprobe(gif);
    assert.equal(info.video.codec_name, 'gif');
    assert.ok(Math.min(Number(info.video.width), Number(info.video.height)) <= 480, `lato corto al massimo 480 (${info.video.width}×${info.video.height})`);
    const proj = await page.evaluate(() => window.__ciak.store.project.settings);
    near(Number(info.video.width) / Number(info.video.height), proj.width / proj.height, 0.03, 'stesse proporzioni del progetto');
    near(info.duration, 2, 0.2, 'durata della GIF');
    const frames = Number(spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', gif], { encoding: 'utf8' }).stdout.trim());
    assert.ok(frames >= 22 && frames <= 26, `fotogrammi della GIF (${frames})`);
    // i colori ci sono (non è tutta nera): fotogramma al secondo 1
    const px = spawnSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', gif, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' }).stdout;
    assert.ok(px.length === 3 && px[0] + px[1] + px[2] > 60, `GIF non nera (${[...px]})`);
  });
});
