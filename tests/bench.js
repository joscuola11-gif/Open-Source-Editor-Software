// Benchmark: `npm run bench`. Stampa tempi (dipendono dall'hardware): non fa asserzioni.
import { performance } from 'node:perf_hooks';
import { Store } from '../src/core/store.js';
import { createProject, clipFromMedia } from '../src/core/project.js';
import { addClip, addTrack, moveClips, planMove, setTransition, splitClip, validateProject, allClips } from '../src/core/timeline.js';
import { launch, importFiles, addMedia } from './helpers/browser.js';
import { makeMedia } from './helpers/make-media.js';

const time = (label, fn, n = 20) => {
  const t = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fn(i);
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  console.log(`  ${label.padEnd(46)} p50 ${t[n >> 1].toFixed(2).padStart(7)} ms   p95 ${t[Math.floor(n * 0.95)].toFixed(2).padStart(7)} ms`);
};

console.log('\n■ Logica di montaggio (Node) — progetto con 2000 clip su 20 tracce');
const p = createProject({ fps: 30 });
p.media.v = { id: 'v', name: 'v', kind: 'video', mime: '', size: 1, duration: 600, width: 1920, height: 1080, hasAudio: true };
p.tracks = [];
for (let i = 0; i < 20; i++) addTrack(p, 'video');
p.tracks.forEach((t, ti) => {
  for (let k = 0; k < 100; k++) {
    const c = clipFromMedia(p.media.v, { start: k * 6 });
    c.duration = 5;
    addClip(p, t.id, c, k * 6);
  }
});
console.log(`  clip totali: ${allClips(p).length}`);
const store = new Store(p);
const mid = p.tracks[10].clips[50];
time('validateProject', () => validateProject(store.project));
time('store.commit (clone + validazione)', () => store.commit('x', (d) => { d.name = String(Math.random()); }));
time('planMove (1 clip, 100 vicini)', () => planMove(store.project, [mid.id], 1.3, 0));
time('commit moveClips', (i) => store.commit('m', (d) => moveClips(d, [mid.id], i % 2 ? -0.2 : 0.2, 0)));
time('commit splitClip', (i) => store.commit('s', (d) => splitClip(d, p.tracks[i % 20].clips[10].id, p.tracks[i % 20].clips[10].start + 2.5)), 15);
time('commit setTransition', (i) => store.commit('t', (d) => setTransition(d, p.tracks[i % 20].clips[20].id, { type: 'fade', duration: 0.5 })), 15);

console.log('\n■ Rendering e riproduzione (Chromium headless, rendering software: sulle GPU reali è più veloce)');
const m = makeMedia();
const env = await launch();
const { page } = await env.open();
await importFiles(page, [m.f('photo.png'), m.f('a.webm')]);
await addMedia(page, 1); // photo.png (ordinamento per nome? verifichiamo per tipo sotto)
await page.evaluate(async () => {
  const a = window.__ciak;
  const { createClip } = await import('/src/core/project.js');
  const { addClip, trackWithRoom } = await import('/src/core/timeline.js');
  const img = Object.values(a.store.project.media).find((x) => x.kind === 'image');
  a.store.commit('bench', (d) => {
    // 6 livelli immagine sovrapposti con filtro, vignetta, grana, bagliore, sfocatura, maschera
    for (let i = 0; i < 6; i++) {
      const c = createClip('image', { mediaId: img.id, name: `L${i}`, start: 0, duration: 4, transform: { scale: 0.6 + i * 0.05, x: (i - 3) * 0.05, rotation: i * 4, opacity: 0.85 } });
      c.filter = { id: ['vivid', 'noir', 'vintage', 'cold', 'warm', 'cinema'][i], intensity: 1 };
      c.adjust.vignette = 40; c.adjust.grain = 30; c.adjust.blur = i === 2 ? 20 : 0;
      c.effects.push({ id: `e${i}`, type: ['glow', 'rgb-split', 'film-grain', 'pixelate', 'vhs', 'glitch'][i], amount: 50 });
      c.mask = { shape: i % 2 ? 'rounded' : 'none', size: 0.9, roundness: 0.3, invert: false };
      const tr = trackWithRoom(d, 'video', 0, 4, { fromTop: true });
      addClip(d, tr.id, c, 0);
    }
    const t = createClip('text', { start: 0, duration: 4, text: { content: 'Benchmark di rendering', size: 9 } });
    addClip(d, trackWithRoom(d, 'video', 0, 4, { fromTop: true }).id, t, 0);
  });
});
for (const [label, w, h] of [['anteprima 1280×720', 1280, 720], ['esportazione 1920×1080', 1920, 1080]]) {
  const r = await page.evaluate(([w, h]) => {
    const a = window.__ciak;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const ts = [];
    for (let i = 0; i < 120; i++) {
      const t0 = performance.now();
      a.renderer.render(g, a.store.project, 0.5 + (i % 30) / 30);
      g.getImageData(0, 0, 1, 1); // forza il raster differito: altrimenti si misura solo la registrazione dei comandi
      ts.push(performance.now() - t0);
    }
    ts.sort((x, y) => x - y);
    return { p50: ts[60], p95: ts[114], max: ts.at(-1) };
  }, [w, h]);
  console.log(`  7 livelli con filtri/effetti/testo, ${label.padEnd(24)} p50 ${r.p50.toFixed(2).padStart(7)} ms   p95 ${r.p95.toFixed(2).padStart(7)} ms   (budget 30 fps = 33.3 ms)`);
}
// riproduzione reale con il video in primo piano
await page.evaluate(() => window.__ciak.player.seek(0));
await page.click('#btn-play');
await page.waitForTimeout(3200);
const st = await page.evaluate(() => ({ ...window.__ciak.player.stats, t: window.__ciak.player.time }));
await page.click('#btn-play');
console.log(`  riproduzione dal vivo: ${st.fps} fps misurati, ${st.ms.toFixed(1)} ms/frame, fotogrammi trattenuti ${st.dropped}`);
await env.close();
console.log('');
