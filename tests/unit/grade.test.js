import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultGrade, gradeIsIdentity, sanitizeGrade, applyGrade, curveTable, parseCube, encodeLut, decodeLut, sanitizeLuts, sharpen, HSL_BANDS,
} from '../../src/core/grade.js';
import { createClip, sanitizeProject, createProject } from '../../src/core/project.js';

const px = (r, g, b, a = 255) => new Uint8ClampedArray([r, g, b, a]);
const grade = (patch) => ({ ...defaultGrade(), ...patch });
const near = (a, b, eps = 1, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≉ ${b} (±${eps})`);

test('grade predefinito: neutro, non cambia i pixel e un clip nuovo lo contiene', () => {
  assert.equal(gradeIsIdentity(defaultGrade()), true);
  assert.equal(gradeIsIdentity(null), true);
  const d = px(10, 120, 250, 77);
  const before = [...d];
  applyGrade(d, 1, 1, defaultGrade());
  assert.deepEqual([...d], before);
  assert.equal(gradeIsIdentity(createClip('video').grade), true);
  assert.equal(gradeIsIdentity(grade({ exposure: 1 })), false);
  assert.equal(gradeIsIdentity(grade({ curve: [0, 25, 50, 75, 99] })), false);
  assert.equal(gradeIsIdentity(grade({ lut: { id: 'x', intensity: 100 } })), false);
  assert.equal(gradeIsIdentity(grade({ lut: { id: 'x', intensity: 0 } })), true, 'LUT a intensità zero = nessun effetto');
});

test('esposizione: +50 raddoppia la luce, -50 la dimezza, il bianco non sfonda; alfa intatto', () => {
  const d = px(100, 50, 200, 123);
  applyGrade(d, 1, 1, grade({ exposure: 50 }));
  assert.deepEqual([...d], [200, 100, 255, 123]);
  const e = px(100, 50, 200, 9);
  applyGrade(e, 1, 1, grade({ exposure: -50 }));
  assert.deepEqual([...e], [50, 25, 100, 9]);
});

test('curva: l\'identità non cambia nulla, una curva a S aumenta il contrasto e resta monotona', () => {
  const id = curveTable([0, 25, 50, 75, 100]);
  for (let i = 0; i < 256; i++) near(id[i] * 255, i, 1, `identità a ${i}`);
  const s = curveTable([0, 12, 50, 88, 100]);
  near(s[64] * 255, 0.12 * 255 * 1, 8, 'ombre scurite');
  assert.ok(s[64] < 64 / 255 && s[192] > 192 / 255, 'S: scuro più scuro, chiaro più chiaro');
  // proprietà: con punti crescenti la curva non decresce mai
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let n = 0; n < 200; n++) {
    const pts = [rnd() * 100, rnd() * 100, rnd() * 100, rnd() * 100, rnd() * 100].sort((a, b) => a - b);
    const t = curveTable(pts);
    for (let i = 1; i < 256; i++) assert.ok(t[i] >= t[i - 1] - 1e-6, `curva monotona ${pts}`);
    for (let i = 0; i < 256; i++) assert.ok(t[i] >= 0 && t[i] <= 1);
  }
  // la curva si applica ai pixel
  const d = px(64, 64, 64);
  applyGrade(d, 1, 1, grade({ curve: [0, 10, 50, 90, 100] }));
  assert.ok(d[0] < 64);
  assert.equal(d[0], d[1]);
  assert.equal(d[1], d[2]);
});

test('ombre e alte luci: agiscono solo sulla zona giusta', () => {
  const dark = px(30, 30, 30);
  const bright = px(230, 230, 230);
  const white = px(255, 255, 255);
  const black = px(0, 0, 0);
  applyGrade(dark, 1, 1, grade({ shadows: 100 }));
  applyGrade(bright, 1, 1, grade({ shadows: 100 }));
  applyGrade(white, 1, 1, grade({ shadows: 100 }));
  assert.ok(dark[0] > 30 + 30, `ombre schiarite (${dark[0]})`);
  assert.ok(bright[0] - 230 < 6, `luci quasi intatte (${bright[0]})`);
  assert.equal(white[0], 255);
  const dark2 = px(30, 30, 30);
  const bright2 = px(230, 230, 230);
  applyGrade(dark2, 1, 1, grade({ highlights: -100 }));
  applyGrade(bright2, 1, 1, grade({ highlights: -100 }));
  applyGrade(black, 1, 1, grade({ highlights: -100 }));
  assert.ok(230 - bright2[0] > 25, `luci recuperate (${bright2[0]})`);
  assert.ok(30 - dark2[0] < 2, 'ombre intatte');
  assert.equal(black[0], 0);
});

test('ruote colore: la tinta si ferma nella zona di luminosità scelta', () => {
  const dark = px(40, 40, 40);
  const mid = px(128, 128, 128);
  const light = px(220, 220, 220);
  const red = grade({ wheels: { ...defaultGrade().wheels, shadows: { hue: 0, amount: 100 } } });
  applyGrade(dark, 1, 1, red);
  applyGrade(mid, 1, 1, red);
  applyGrade(light, 1, 1, red);
  assert.ok(dark[0] > dark[1] + 15 && dark[0] > dark[2] + 15, `ombre rosse (${[...dark]})`);
  assert.ok(mid[0] - mid[1] < dark[0] - dark[1], 'toni medi meno colorati');
  assert.ok(light[0] - light[1] < 8, 'luci quasi neutre');
  // la luminosità complessiva resta circa la stessa (la tinta non schiarisce)
  const before = 40;
  near((dark[0] + dark[1] + dark[2]) / 3, before, 6, 'luminosità conservata');
  const blueHigh = grade({ wheels: { ...defaultGrade().wheels, highs: { hue: 240, amount: 100 } } });
  const l2 = px(220, 220, 220);
  applyGrade(l2, 1, 1, blueHigh);
  assert.ok(l2[2] > l2[0] + 15, `luci blu (${[...l2]})`);
});

test('HSL: ogni fascia agisce sul suo colore e non sugli altri', () => {
  const green = px(40, 200, 40);
  const red = px(200, 40, 40);
  const gray = px(120, 120, 120);
  const desatGreen = grade({ hsl: { ...defaultGrade().hsl, green: { h: 0, s: -100, l: 0 } } });
  applyGrade(green, 1, 1, desatGreen);
  applyGrade(red, 1, 1, desatGreen);
  applyGrade(gray, 1, 1, desatGreen);
  assert.ok(Math.max(green[0], green[1], green[2]) - Math.min(green[0], green[1], green[2]) < 6, `verde desaturato (${[...green]})`);
  assert.deepEqual([...red].slice(0, 3), [200, 40, 40], 'il rosso non cambia');
  assert.deepEqual([...gray].slice(0, 3), [120, 120, 120], 'il grigio non cambia');
  // spostare i rossi verso il giallo/arancio fa salire il verde
  const r2 = px(200, 40, 40);
  applyGrade(r2, 1, 1, grade({ hsl: { ...defaultGrade().hsl, red: { h: 100, s: 0, l: 0 } } }));
  assert.ok(r2[1] > 70, `rosso → arancio (${[...r2]})`);
  // saturazione e luminosità dei blu
  const b1 = px(40, 40, 200);
  applyGrade(b1, 1, 1, grade({ hsl: { ...defaultGrade().hsl, blue: { h: 0, s: 0, l: 100 } } }));
  assert.ok(b1[2] > 200 || b1[0] > 40, `blu più chiaro (${[...b1]})`);
  assert.equal(HSL_BANDS.length, 6);
});

const identityCube = (n) => {
  const lines = [`TITLE "prova"`, `LUT_3D_SIZE ${n}`];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) lines.push(`${r / (n - 1)} ${g / (n - 1)} ${b / (n - 1)}`);
  return lines.join('\n');
};
const invertCube = (n) => {
  const lines = [`LUT_3D_SIZE ${n}`];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) lines.push(`${1 - r / (n - 1)} ${1 - g / (n - 1)} ${1 - b / (n - 1)}`);
  return lines.join('\n');
};

test('LUT .cube: lettura, identità, inversione, intensità e riduzione a 33', () => {
  const idl = parseCube(identityCube(17));
  assert.equal(idl.size, 17);
  assert.equal(idl.name, 'prova');
  const d = px(10, 130, 250);
  applyGrade(d, 1, 1, grade({ lut: { id: 'a', intensity: 100 } }), idl);
  for (const [k, v] of [[0, 10], [1, 130], [2, 250]]) near(d[k], v, 2, 'LUT identità');
  const inv = parseCube(invertCube(9));
  const e = px(0, 100, 255);
  applyGrade(e, 1, 1, grade({ lut: { id: 'a', intensity: 100 } }), inv);
  for (const [k, v] of [[0, 255], [1, 155], [2, 0]]) near(e[k], v, 3, 'LUT inversa');
  const f = px(0, 0, 0);
  applyGrade(f, 1, 1, grade({ lut: { id: 'a', intensity: 50 } }), inv);
  near(f[0], 128, 2, 'metà intensità');
  // senza la LUT caricata non succede nulla (invece di rompersi)
  const g = px(1, 2, 3);
  applyGrade(g, 1, 1, grade({ lut: { id: 'mancante', intensity: 100 } }), null);
  assert.deepEqual([...g].slice(0, 3), [1, 2, 3]);
  // 65 → 33
  const big = parseCube(identityCube(65));
  assert.equal(big.size, 33);
  assert.equal(big.data.length, 33 ** 3 * 3);
  near(big.data[(1 * 33 * 33 + 0 * 33 + 0) * 3 + 2], 255 / 32, 1, 'campioni coerenti dopo la riduzione');
  // DOMAIN diverso da 0..1
  const dom = parseCube(['DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 2 2 2', 'LUT_3D_SIZE 2', '0 0 0', '2 0 0', '0 2 0', '2 2 0', '0 0 2', '2 0 2', '0 2 2', '2 2 2'].join('\n'));
  assert.equal(dom.data[3], 255, 'il dominio viene normalizzato');
});

test('LUT .cube: file sbagliati danno un messaggio chiaro', () => {
  assert.throws(() => parseCube(''), /vuoto/);
  assert.throws(() => parseCube('LUT_1D_SIZE 16\n0 0 0'), /1D/);
  assert.throws(() => parseCube('1 2 3'), /dimensione/);
  assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n1 1 1'), /8 righe/);
  assert.throws(() => parseCube('LUT_3D_SIZE 2\n' + Array(8).fill('0 0 x').join('\n')), /non è valida/);
  assert.throws(() => parseCube('LUT_3D_SIZE 1000\n0 0 0'), /troppo grande/);
  assert.throws(() => parseCube(undefined), /vuoto/);
});

test('LUT: salvataggio nel progetto (codifica) e lettura di dati rovinati', () => {
  const lut = parseCube(invertCube(5));
  const entry = encodeLut(lut);
  assert.equal(typeof entry.data, 'string');
  const back = decodeLut(entry);
  assert.deepEqual([...back.data], [...lut.data]);
  assert.equal(back.size, 5);
  assert.equal(decodeLut({ ...entry, data: entry.data.slice(10) }), null, 'dati accorciati');
  assert.equal(decodeLut({ ...entry, size: 99 }), null);
  assert.equal(decodeLut(null), null);
  assert.equal(decodeLut({ name: 'x', size: 2, data: '!!!' }), null);
  const clean = sanitizeLuts({ ok: entry, rotta: { name: 'x', size: 2, data: 'AAAA' }, nulla: null });
  assert.deepEqual(Object.keys(clean), ['ok']);
  assert.deepEqual(sanitizeLuts('boh'), {});
});

test('nitidezza: lascia piatte le zone uniformi, accentua i bordi, non tocca l\'alfa né i margini', () => {
  const w = 5;
  const h = 5;
  const flat = new Uint8ClampedArray(w * h * 4).fill(100);
  for (let i = 3; i < flat.length; i += 4) flat[i] = 200;
  sharpen(flat, w, h, 1);
  assert.ok(flat.every((v, i) => (i % 4 === 3 ? v === 200 : v === 100)), 'piatto resta piatto');
  const edge = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) edge.set([x < 2 ? 80 : 160, x < 2 ? 80 : 160, x < 2 ? 80 : 160, 255], (y * w + x) * 4);
  const dark = edge[(2 * w + 1) * 4];
  const light = edge[(2 * w + 2) * 4];
  sharpen(edge, w, h, 1);
  assert.ok(edge[(2 * w + 1) * 4] < dark, 'il lato scuro del bordo si scurisce');
  assert.ok(edge[(2 * w + 2) * 4] > light, 'il lato chiaro si schiarisce');
  assert.equal(edge[0], 80, 'il margine non cambia');
  assert.equal(edge[3], 255);
  // immagini minuscole non fanno errori
  for (const [a, b] of [[1, 1], [2, 2], [3, 1]]) applyGrade(new Uint8ClampedArray(a * b * 4).fill(50), a, b, grade({ sharpen: 100 }));
});

test('sanitizeGrade e progetti vecchi: valori assurdi riportati nei limiti, campi mancanti riempiti', () => {
  const g = sanitizeGrade({ exposure: 999, highlights: 'x', shadows: NaN, sharpen: -5, wheels: { shadows: { hue: 720, amount: 500 }, mids: 4 }, hsl: { red: { h: 'a', s: 1000, l: -1000 } }, curve: [1, 2, 3], lut: { id: 5, intensity: 'x' } });
  assert.equal(g.exposure, 100);
  assert.equal(g.highlights, 0);
  assert.equal(g.shadows, 0);
  assert.equal(g.sharpen, 0);
  assert.equal(g.wheels.shadows.hue, 360);
  assert.equal(g.wheels.shadows.amount, 100);
  assert.deepEqual(g.wheels.mids, { hue: 0, amount: 0 });
  assert.deepEqual(g.hsl.red, { h: 0, s: 100, l: -100 });
  assert.deepEqual(g.curve, [0, 25, 50, 75, 100], 'curva con il numero sbagliato di punti → identità');
  assert.deepEqual(g.lut, { id: null, intensity: 100 });
  assert.deepEqual(sanitizeGrade(undefined), defaultGrade());
  assert.deepEqual(sanitizeGrade('x'), defaultGrade());
  // un progetto salvato prima di questa funzione (senza grade né luts) si apre con i valori neutri
  const p = createProject();
  p.media.v = { id: 'v', name: 'v', kind: 'video', mime: 'video/mp4', size: 1, duration: 5, width: 10, height: 10, hasAudio: true };
  const c = createClip('video', { mediaId: 'v', duration: 2 });
  delete c.grade;
  p.tracks[1].clips.push(c);
  delete p.luts;
  const back = sanitizeProject(JSON.parse(JSON.stringify(p)));
  assert.equal(gradeIsIdentity(back.tracks[1].clips[0].grade), true);
  assert.deepEqual(back.luts, {});
});
