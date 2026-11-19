// Prove con due partecipanti veri (due finestre di Chromium con camera e microfono finti) e il vero centralino.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, sleep } from '../helpers/net.js';

let env;
before(async () => {
  env = await launch();
});
after(async () => env?.close());
afterEach(async () => env?.closeAll());

const A = '111111111';
const B = '222222222';
const C = '333333333';

async function pair(opts = {}) {
  const a = await env.person(A, { name: 'Anna', ...opts.a });
  const b = await env.person(B, { name: 'Bruno', ...opts.b });
  for (const p of [a, b]) await p.page.waitForFunction(() => window.__squillo.line.status === 'online', null, { timeout: 20000 });
  return { a, b };
}

async function connect(a, b, { camera = true } = {}) {
  await a.page.fill('#dial-input', '222 222 222');
  await a.page.click(camera ? '#btn-call' : '#btn-voice');
  await b.page.waitForSelector('#btn-answer', { timeout: 15000 });
  await b.page.click('#btn-answer');
  for (const p of [a, b]) await p.page.waitForFunction(() => window.__squillo.calls.state === 'active', null, { timeout: 25000 });
}

const state = (p) => p.page.evaluate(() => window.__squillo.calls.state);
const toastText = (p) => p.page.locator('.toast').allInnerTexts();
const waitToast = (p, re, ms = 15000) => p.page.waitForFunction((src) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(src, 'i').test(t.textContent)), re.source, { timeout: ms });

/** Statistiche in ingresso della connessione principale o dello schermo ricevuto. */
const inbound = (p, which = 'main') =>
  p.page.evaluate(async (w) => {
    const call = window.__squillo.calls.call;
    const pc = (w === 'screen' ? call.remoteScreenMc : call.mainMc)?.peerConnection;
    if (!pc) return null;
    const out = { frames: 0, audioEnergy: 0, w: 0, h: 0, bytes: 0, fps: 0 };
    for (const r of (await pc.getStats()).values()) {
      if (r.type === 'inbound-rtp' && r.kind === 'video') {
        out.frames += r.framesDecoded ?? 0;
        out.w = Math.max(out.w, r.frameWidth ?? 0);
        out.h = Math.max(out.h, r.frameHeight ?? 0);
        out.fps = r.framesPerSecond ?? out.fps;
        out.bytes += r.bytesReceived ?? 0;
      }
      if (r.type === 'inbound-rtp' && r.kind === 'audio') out.audioEnergy += r.totalAudioEnergy ?? 0;
    }
    return out;
  }, which);

const senderParams = (p, which = 'screen') =>
  p.page.evaluate((w) => {
    const call = window.__squillo.calls.call;
    const pc = (w === 'screen' ? call.screenMc : call.mainMc).peerConnection;
    const s = pc.getSenders().find((x) => x.track?.kind === 'video');
    const pr = s.getParameters();
    return { ...pr.encodings[0], degradationPreference: pr.degradationPreference, hint: s.track.contentHint };
  }, which);

test('avvio: il codice è mostrato a gruppi di tre, il tasto chiama si attiva solo con un codice giusto', async () => {
  const a = await env.person(A, { name: 'Anna' });
  await a.page.waitForFunction(() => window.__squillo.line.status === 'online', null, { timeout: 20000 });
  assert.equal(await a.page.textContent('#my-code'), '111 111 111');
  assert.match(await a.page.textContent('.status'), /Pronto a ricevere/);
  assert.equal(await a.page.locator('#btn-call').isDisabled(), true);
  await a.page.fill('#dial-input', '1234');
  assert.equal(await a.page.locator('#btn-call').isDisabled(), true);
  await a.page.fill('#dial-input', '222222222');
  assert.equal(await a.page.inputValue('#dial-input'), '222 222 222', 'il codice si formatta mentre si scrive');
  assert.equal(await a.page.locator('#btn-call').isDisabled(), false);
  await a.page.fill('#dial-input', '023 456 789');
  assert.equal(await a.page.locator('#btn-call').isDisabled(), true, 'un codice che inizia con 0 non è valido');
  assert.deepEqual(a.errors, []);
  await a.context.close();
});

test('chiamata completa: squilla, si risponde, video e audio arrivano da entrambe le parti, si riaggancia', async () => {
  const { a, b } = await pair();
  await a.page.fill('#dial-input', '222 222 222');
  await a.page.click('#btn-call');
  await b.page.waitForSelector('#btn-answer', { timeout: 15000 });
  assert.equal(await b.page.textContent('#inc-name'), 'Anna', 'chi riceve vede il nome di chi chiama');
  await a.page.waitForFunction(() => /squillando/i.test(document.querySelector('#w-status')?.textContent ?? ''), null, { timeout: 10000 });
  await b.page.click('#btn-answer');
  for (const p of [a, b]) await p.page.waitForFunction(() => window.__squillo.calls.state === 'active', null, { timeout: 25000 });

  const a0 = await inbound(a);
  const b0 = await inbound(b);
  await sleep(2500);
  const a1 = await inbound(a);
  const b1 = await inbound(b);
  assert.ok(a1.frames - a0.frames > 10, `A riceve video (${a1.frames - a0.frames} fotogrammi)`);
  assert.ok(b1.frames - b0.frames > 10, `B riceve video (${b1.frames - b0.frames} fotogrammi)`);
  assert.ok(a1.audioEnergy > a0.audioEnergy && b1.audioEnergy > b0.audioEnergy, 'l\'audio arriva da entrambe le parti');
  for (const p of [a, b]) {
    const v = await p.page.evaluate(() => {
      const el = document.querySelector('.v-main');
      return { w: el.videoWidth, t: el.currentTime, paused: el.paused };
    });
    assert.ok(v.w > 0 && !v.paused, `il video dell'altro si vede (${JSON.stringify(v)})`);
  }
  assert.match(await a.page.textContent('#top-name'), /Bruno|222 222 222/);
  await a.page.waitForFunction(() => /^\d+:\d\d$/.test(document.querySelector('#timer')?.textContent ?? ''));

  await a.page.click('#c-hangup');
  await a.page.waitForSelector('.home:not([hidden])');
  await b.page.waitForSelector('.home:not([hidden])', { timeout: 10000 });
  await waitToast(b, /terminata/);
  assert.equal(await state(a), 'idle');
  assert.equal(await state(b), 'idle');
  // cronologia: chiamata in uscita per A, in entrata per B, con durata
  assert.match(await a.page.textContent('.recent'), /In uscita/);
  assert.match(await b.page.textContent('.recent'), /In entrata/);
  assert.deepEqual([...a.errors, ...b.errors], []);
  await a.context.close();
  await b.context.close();
});

test('muto: l\'altra persona lo vede e l\'audio si interrompe davvero; poi riprende', async () => {
  const { a, b } = await pair();
  await connect(a, b);
  const energy = async (p, ms) => {
    const e0 = (await inbound(p)).audioEnergy;
    await sleep(ms);
    return (await inbound(p)).audioEnergy - e0;
  };
  const live = await energy(b, 3500);
  assert.ok(live > 0, `prima del muto l'audio arriva (${live})`);

  await a.page.click('#c-mic');
  assert.equal(await a.page.getAttribute('#c-mic', 'aria-pressed'), 'true');
  await b.page.waitForSelector('#badge-mic', { timeout: 5000 });
  assert.match(await b.page.textContent('#badge-mic'), /Microfono spento/);
  await sleep(600);
  const muted = await energy(b, 3500);
  assert.ok(muted < live * 0.05, `con il muto l'audio sparisce (${muted} contro ${live})`);
  assert.equal(await a.page.evaluate(() => window.__squillo.calls.media.micTrack.enabled), false);

  await a.page.click('#c-mic');
  await b.page.waitForFunction(() => !document.querySelector('#badge-mic'), null, { timeout: 5000 });
  await sleep(600);
  assert.ok((await energy(b, 3500)) > live * 0.3, 'tolto il muto l\'audio ritorna');
  assert.deepEqual([...a.errors, ...b.errors], []);
  await a.context.close();
  await b.context.close();
});

test('camera: si spegne davvero (la spia) e si riaccende senza interrompere la chiamata', async () => {
  const { a, b } = await pair();
  await connect(a, b);
  const camTrack = await a.page.evaluate(() => (window.__squillo.calls.media.camTrack.readyState));
  assert.equal(camTrack, 'live');

  await a.page.click('#c-cam');
  await b.page.waitForSelector('#badge-cam', { timeout: 5000 });
  assert.equal(await a.page.evaluate(() => window.__squillo.calls.media.camTrack), null, 'la camera vera è stata fermata');
  const f0 = (await inbound(b)).frames;
  await sleep(2500);
  assert.ok((await inbound(b)).frames > f0, 'la chiamata va avanti (arriva il fotogramma «camera spenta»)');
  assert.equal(await state(b), 'active');

  await a.page.click('#c-cam');
  await b.page.waitForFunction(() => !document.querySelector('#badge-cam'), null, { timeout: 8000 });
  assert.equal(await a.page.evaluate(() => window.__squillo.calls.media.camTrack?.readyState), 'live');
  const f1 = (await inbound(b)).frames;
  await sleep(2500);
  assert.ok((await inbound(b)).frames > f1, 'video di nuovo in arrivo');
  assert.deepEqual([...a.errors, ...b.errors], []);
  await a.context.close();
  await b.context.close();
});

test('«silenzia l\'altra persona» ferma solo l\'audio che ricevo io', async () => {
  const { a, b } = await pair();
  await connect(a, b);
  assert.equal(await b.page.evaluate(() => document.querySelector('audio').muted), false);
  await b.page.click('#c-speaker');
  assert.equal(await b.page.evaluate(() => document.querySelector('audio').muted), true);
  assert.equal(await b.page.getAttribute('#c-speaker', 'aria-pressed'), 'true');
  // l'altra persona non è toccata
  assert.equal(await a.page.evaluate(() => document.querySelector('audio').muted), false);
  await b.page.click('#c-speaker');
  assert.equal(await b.page.evaluate(() => document.querySelector('audio').muted), false);
  await a.context.close();
  await b.context.close();
});

test('rifiuto, chiamata annullata, occupato, codice inesistente', async () => {
  const { a, b } = await pair();
  const c = await env.person(C, { name: 'Carla' });
  await c.page.waitForFunction(() => window.__squillo.line.status === 'online', null, { timeout: 20000 });

  // rifiuto
  await a.page.fill('#dial-input', B);
  await a.page.click('#btn-call');
  await b.page.waitForSelector('#btn-decline', { timeout: 15000 });
  await b.page.click('#btn-decline');
  await waitToast(a, /rifiutata/);
  await a.page.waitForSelector('.home:not([hidden])');
  await b.page.waitForSelector('.home:not([hidden])');
  assert.equal(await state(a), 'idle');

  // annullata da chi chiama: l'altra persona vede una chiamata persa
  await a.page.fill('#dial-input', B);
  await a.page.click('#btn-call');
  await b.page.waitForSelector('#btn-answer', { timeout: 15000 });
  await a.page.click('#c-hangup');
  await b.page.waitForSelector('.incoming', { state: 'hidden', timeout: 8000 });
  assert.match(await b.page.textContent('.recent'), /Persa/);

  // occupato: B è in chiamata con A, C prova a chiamarlo
  await connect(a, b);
  await c.page.fill('#dial-input', B);
  await c.page.click('#btn-call');
  await waitToast(c, /già in chiamata/);
  await c.page.waitForSelector('.home:not([hidden])');
  assert.equal(await state(a), 'active', 'la chiamata in corso non è disturbata');
  assert.equal(await state(b), 'active');

  // codice che non esiste
  await a.page.click('#c-hangup');
  await a.page.waitForSelector('.home:not([hidden])');
  await a.page.fill('#dial-input', '999 999 999');
  await a.page.click('#btn-call');
  await waitToast(a, /Non risponde/, 20000);
  await a.page.waitForSelector('.home:not([hidden])');

  // chiamare il proprio codice
  await a.page.fill('#dial-input', A);
  await a.page.click('#btn-call');
  await waitToast(a, /tuo codice/);
  assert.deepEqual([...a.errors, ...b.errors, ...c.errors], []);
  for (const p of [a, b, c]) await p.context.close();
});

test('condivisione dello schermo: nitida per il testo, fluida per il movimento, con i parametri giusti', async () => {
  const { a, b } = await pair();
  await connect(a, b);
  await a.page.click('#c-screen');
  await a.page.waitForSelector('.screen-menu');
  assert.ok((await a.page.textContent('.screen-menu')).includes('Testo e documenti'));
  await a.page.click('#btn-share-go');
  await b.page.waitForSelector('#badge-screen', { timeout: 20000 });
  assert.equal(await b.page.evaluate(() => document.querySelector('.v-main').classList.contains('is-screen')), true, 'lo schermo è il video principale');
  await b.page.waitForFunction(() => document.querySelector('.v-main').videoWidth > 0, null, { timeout: 15000 });

  // come è stato chiesto lo schermo al sistema
  const req = await a.page.evaluate(() => window.__displayRequest);
  assert.equal(req.video.cursor, 'always');
  assert.equal(req.video.frameRate.ideal, 30);
  assert.equal(req.selfBrowserSurface, 'exclude', 'non condivide la finestra della chiamata stessa');
  assert.equal(req.audio, false);

  // parametri del mittente: «testo»
  await a.page.waitForFunction(async () => {
    const pc = window.__squillo.calls.call.screenMc?.peerConnection;
    const s = pc?.getSenders().find((x) => x.track?.kind === 'video');
    return s?.getParameters().encodings?.[0]?.maxBitrate === 4_000_000;
  }, null, { timeout: 15000 });
  let p = await senderParams(a);
  assert.equal(p.hint, 'detail');
  assert.equal(p.degradationPreference, 'maintain-resolution', 'se la rete cala scende di fotogrammi, non di nitidezza');
  assert.equal(p.maxFramerate, 30);
  assert.equal(p.scaleResolutionDownBy, 1);

  // la barra «stai condividendo» e la ricezione
  await a.page.waitForSelector('.share-bar');
  await sleep(4000);
  const rx = await inbound(b, 'screen');
  assert.ok(rx.frames > 20, `B riceve lo schermo (${rx.frames} fotogrammi)`);
  assert.ok(rx.w >= 960, `risoluzione ricevuta ${rx.w}×${rx.h}`);
  const codec = await a.page.evaluate(() => window.__squillo.calls.call.stats.screen?.codecOut);
  assert.equal(codec, 'VP9', 'si usa VP9, il migliore per testo e interfacce');
  // la camera continua a funzionare mentre si condivide
  const m0 = (await inbound(b)).frames;
  await sleep(1500);
  assert.ok((await inbound(b)).frames > m0, 'la camera non si interrompe');

  // «movimento»
  await a.page.click('.share-bar .seg button[data-mode="motion"]');
  await a.page.waitForFunction(async () => {
    const pc = window.__squillo.calls.call.screenMc?.peerConnection;
    const s = pc?.getSenders().find((x) => x.track?.kind === 'video');
    return s?.getParameters().encodings?.[0]?.maxBitrate === 8_000_000;
  }, null, { timeout: 8000 });
  p = await senderParams(a);
  assert.equal(p.hint, 'motion');
  assert.equal(p.degradationPreference, 'maintain-framerate');
  assert.equal(p.maxFramerate, 60);

  // si ferma: l'altra persona torna a vedere la camera
  await a.page.click('#btn-stop-share');
  await b.page.waitForFunction(() => !document.querySelector('#badge-screen') && !document.querySelector('.v-main').classList.contains('is-screen'), null, { timeout: 8000 });
  assert.equal(await a.page.evaluate(() => window.__squillo.calls.call.screenMc), null);
  assert.equal(await state(a), 'active');

  // si può ricominciare
  await a.page.click('#c-screen');
  await a.page.click('#btn-share-go');
  await b.page.waitForSelector('#badge-screen', { timeout: 20000 });
  assert.deepEqual([...a.errors, ...b.errors], []);
  await a.context.close();
  await b.context.close();
});

test('condivisione: anche chi riceve può condividere, e la miniatura scambia schermo e camera', async () => {
  const { a, b } = await pair();
  await connect(a, b);
  await b.page.click('#c-screen');
  await b.page.click('#btn-share-go');
  await a.page.waitForSelector('#badge-screen', { timeout: 20000 });
  await a.page.waitForSelector('.tile-remote:not([hidden])');
  await a.page.click('.tile-remote');
  assert.equal(await a.page.evaluate(() => document.querySelector('.v-main').classList.contains('is-screen')), false, 'ora in grande c\'è la camera');
  await a.page.click('.tile-remote');
  assert.equal(await a.page.evaluate(() => document.querySelector('.v-main').classList.contains('is-screen')), true);
  // chiudendo la chiamata si ferma tutto
  await b.page.click('#c-hangup');
  await a.page.waitForSelector('.home:not([hidden])', { timeout: 10000 });
  assert.equal(await b.page.evaluate(() => window.__squillo.calls.call), null);
  await a.context.close();
  await b.context.close();
});

test('se uno dei due chiude la pagina, l\'altro lo scopre e torna alla schermata iniziale', async () => {
  const { a, b } = await pair();
  await connect(a, b);
  await b.page.close();
  await a.page.waitForSelector('.home:not([hidden])', { timeout: 25000 });
  await waitToast(a, /persa|terminata/);
  assert.equal(await state(a), 'idle');
  await a.context.close();
  await b.context.close();
});

test('chi ricarica la pagina ritrova subito lo stesso codice e può ricevere chiamate', async () => {
  const { a, b } = await pair();
  await b.page.reload();
  await b.page.waitForFunction(() => window.__squillo?.line.status === 'online', null, { timeout: 30000 });
  assert.equal(await b.page.textContent('#my-code'), '222 222 222');
  await connect(a, b);
  await a.context.close();
  await b.context.close();
});

test('chiamata di sola voce: parte con la camera spenta e la si può accendere dopo', async () => {
  const { a, b } = await pair();
  await connect(a, b, { camera: false });
  assert.equal(await a.page.evaluate(() => window.__squillo.calls.media.camOn), false);
  assert.equal(await a.page.evaluate(() => window.__squillo.calls.media.camTrack), null, 'la camera vera non è mai stata accesa');
  await b.page.waitForSelector('#badge-cam', { timeout: 8000 });
  await a.page.click('#c-cam');
  await b.page.waitForFunction(() => !document.querySelector('#badge-cam'), null, { timeout: 8000 });
  assert.equal(await a.page.evaluate(() => window.__squillo.calls.media.camTrack?.readyState), 'live');
  assert.deepEqual([...a.errors, ...b.errors], []);
});

test('chiamate simultanee fra le stesse due persone: ne nasce una sola', async () => {
  const { a, b } = await pair();
  await Promise.all([
    (async () => {
      await a.page.fill('#dial-input', B);
      await a.page.click('#btn-call');
    })(),
    (async () => {
      await b.page.fill('#dial-input', A);
      await b.page.click('#btn-call');
    })(),
  ]);
  for (const p of [a, b]) await p.page.waitForFunction(() => window.__squillo.calls.state === 'active', null, { timeout: 30000 });
  const ids = await Promise.all([a, b].map((p) => p.page.evaluate(() => window.__squillo.calls.call.id)));
  assert.equal(ids[0], ids[1], 'è la stessa chiamata');
  await sleep(1500);
  assert.deepEqual([...a.errors, ...b.errors], []);
  await a.context.close();
  await b.context.close();
});

test('su una rete buona la qualità non peggiora da sola e la camera migliora col tempo', async () => {
  const { a, b } = await pair();
  await connect(a, b);
  await sleep(11000);
  const lv = await b.page.evaluate(() => window.__squillo.lastStats?.camLevel);
  assert.equal(lv, 0, 'il regolatore resta al livello migliore');
  const { w } = await inbound(a);
  assert.ok(w >= 320, `la risoluzione ricevuta sale (${w})`);
  assert.deepEqual([...a.errors, ...b.errors], []);
});

test('impostazioni: si apre, il centralino non valido è ripulito, il server di appoggio sbagliato è rifiutato', async () => {
  const a = await env.person(A, { name: 'Anna' });
  await a.page.waitForFunction(() => window.__squillo.line.status === 'online', null, { timeout: 20000 });
  await a.page.click('#btn-settings');
  await a.page.waitForSelector('dialog.settings[open]');
  assert.ok((await a.page.textContent('dialog.settings')).includes('Centralino'));
  assert.equal(await a.page.inputValue('#s-host'), '127.0.0.1');
  // elenco dei dispositivi: ci sono la camera e il microfono finti
  assert.ok((await a.page.locator('#s-mic option').count()) >= 2);
  assert.ok((await a.page.locator('#s-cam option').count()) >= 2);
  // JSON dei server di appoggio sbagliato: non si salva e si spiega (sta nelle «Avanzate», chiuse di default)
  assert.equal(await a.page.locator('#s-ice').isVisible(), false);
  await a.page.click('dialog.settings summary');
  await a.page.fill('#s-ice', 'questo non è json');
  await a.page.click('#s-save');
  await waitToast(a, /lista JSON valida/);
  assert.equal(await a.page.locator('dialog.settings[open]').count(), 1, 'il dialogo resta aperto');
  // «servizio predefinito» riporta i valori pubblici
  await a.page.click('#s-reset');
  assert.equal(await a.page.inputValue('#s-host'), '0.peerjs.com');
  assert.equal(await a.page.inputValue('#s-port'), '443');
  assert.equal(await a.page.isChecked('#s-secure'), true);
  // salvare un centralino nostro: si ricollega e torna online
  await a.page.fill('#s-host', '127.0.0.1');
  await a.page.fill('#s-port', String(env.centralino.port));
  await a.page.fill('#s-path', '/');
  await a.page.uncheck('#s-secure');
  await a.page.fill('#s-ice', '');
  await a.page.click('#s-save');
  await a.page.waitForSelector('dialog.settings', { state: 'hidden' });
  await a.page.waitForFunction(() => window.__squillo.line.status === 'online', null, { timeout: 25000 });
  const saved = await a.page.evaluate(() => JSON.parse(localStorage.getItem('squillo:v1')).server);
  assert.equal(saved.host, '127.0.0.1');
  assert.equal(saved.secure, false);
  // il nome si ricorda
  await a.page.fill('#my-name', 'Anna Rossi');
  await a.page.reload();
  await a.page.waitForFunction(() => window.__squillo?.line.status === 'online', null, { timeout: 30000 });
  assert.equal(await a.page.inputValue('#my-name'), 'Anna Rossi');
  assert.deepEqual(a.errors, []);
});

test('telefono: nessuno scorrimento orizzontale, controlli tutti raggiungibili, pulsante «gira camera»', async () => {
  const ctx = await env.browser.newContext({
    viewport: { width: 360, height: 700 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    permissions: ['camera', 'microphone'],
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  });
  await ctx.addInitScript(([s]) => {
    try {
      if (!localStorage.getItem('squillo:v1')) localStorage.setItem('squillo:v1', JSON.stringify(s));
    } catch {}
  }, [{ code: '444444444', name: 'Telefono', server: { host: '127.0.0.1', port: env.centralino.port, path: '/', secure: false, key: 'peerjs' }, ice: JSON.stringify([{ urls: 'stun:127.0.0.1:3478' }]) }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(env.url);
  await page.waitForFunction(() => window.__squillo?.line.status === 'online', null, { timeout: 20000 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.equal(await overflow(), 0, 'home senza scorrimento orizzontale');
  const b = await env.person(B, { name: 'Bruno' });
  await b.page.waitForFunction(() => window.__squillo.line.status === 'online', null, { timeout: 20000 });
  await page.fill('#dial-input', B);
  await page.click('#btn-call');
  await b.page.waitForSelector('#btn-answer', { timeout: 15000 });
  await b.page.click('#btn-answer');
  await page.waitForFunction(() => window.__squillo.calls.state === 'active', null, { timeout: 25000 });
  assert.equal(await overflow(), 0, 'chiamata senza scorrimento orizzontale');
  assert.ok(await page.locator('#c-flip').isVisible(), 'sul telefono si può girare la camera');
  const vp = page.viewportSize();
  for (const id of ['mic', 'cam', 'screen', 'flip', 'speaker', 'stats', 'full', 'hangup']) {
    const box = await page.locator(`#c-${id}`).boundingBox();
    if (!box) continue; // il pulsante può essere nascosto dove non serve
    assert.ok(box.x >= 0 && box.x + box.width <= vp.width && box.y >= 0 && box.y + box.height <= vp.height, `#c-${id} dentro lo schermo (${JSON.stringify(box)})`);
    assert.ok(box.width >= 44 && box.height >= 44, `#c-${id} abbastanza grande per un dito`);
  }
  // l'incoming sul telefono è tutto visibile
  await page.click('#c-hangup');
  await page.waitForSelector('.home:not([hidden])');
  await b.page.fill('#dial-input', '444 444 444');
  await b.page.click('#btn-call');
  await page.waitForSelector('#btn-answer', { timeout: 15000 });
  for (const id of ['btn-decline', 'btn-answer-voice', 'btn-answer']) {
    const box = await page.locator(`#${id}`).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= vp.width, `#${id} dentro lo schermo`);
  }
  await page.click('#btn-decline');
  assert.deepEqual(errors, []);
  await ctx.close();
});
