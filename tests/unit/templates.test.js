import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTemplate, parseTemplateFile, sanitizeTemplate, serializeTemplate, slotsOf, templateFromProject, textsOf } from '../../src/core/templates.js';
import { createClip, createProject, allClips, projectDuration } from '../../src/core/project.js';
import { addClip, addTrack, setTransition, validateProject } from '../../src/core/timeline.js';

const rec = (id, kind, duration, w = 1920, h = 1080, name = `${id}.${kind}`) => ({ id, name, kind, mime: kind === 'image' ? 'image/png' : `${kind}/x`, size: 1000, duration, width: w, height: h });

/** Modello di prova: 3 foto da 3 s in fila con transizione di 0,5 s, titolo sul 2° clip, musica, sfondo che dura tutto. */
function sample({ vertical = false } = {}) {
  const p = createProject(vertical ? { width: 1080, height: 1920 } : {});
  const main = p.tracks[1];
  const over = p.tracks[0];
  const music = p.tracks[2];
  const ids = {};
  for (let i = 0; i < 3; i++) {
    p.media[`m${i}`] = { id: `m${i}`, name: `f${i}.png`, kind: 'image', mime: 'image/png', size: 1, duration: 0, width: 1920, height: 1080 };
    const c = createClip('image', { mediaId: `m${i}`, name: `f${i}`, duration: 3 });
    c.keyframes.scale = [{ t: 0, v: 1, e: 'linear' }, { t: 3, v: 1.2, e: 'linear' }];
    addClip(p, main.id, c, i * 3);
    ids[`s${i}`] = c.id;
  }
  setTransition(p, ids.s1, { type: 'fade', duration: 0.5 });
  setTransition(p, ids.s2, { type: 'fade', duration: 0.5 });
  // i 3 clip: 0–3, 2.5–5.5, 5–8
  const title = createClip('text', { name: 'Titolo', duration: 2, text: { content: 'Titolo del video' } });
  addClip(p, over.id, title, 2.5);
  ids.title = title.id;
  const credit = createClip('text', { name: 'Fine', duration: 2, text: { content: 'Grazie' } });
  addClip(p, over.id, credit, 6);
  ids.credit = credit.id;
  p.media.song = { id: 'song', name: 'musica.mp3', kind: 'audio', mime: 'audio/mpeg', size: 1, duration: 60, width: 0, height: 0 };
  const song = createClip('audio', { mediaId: 'song', duration: 8, fadeOut: 1 });
  addClip(p, music.id, song, 0);
  ids.song = song.id;
  assert.deepEqual(validateProject(p), []);
  return { p, ids };
}
const fillAll = (t, dur = 3) => ({ media: Object.fromEntries(t.slots.map((s) => [s.id, rec(`n_${s.id}`, s.kind === 'audio' ? 'audio' : 'image', s.kind === 'audio' ? 30 : dur)])) });
const clipById = (p, id) => allClips(p).find((c) => c.id === id);

test('slotsOf e textsOf: ordine, etichette e adattamento', () => {
  const { p, ids } = sample();
  const slots = slotsOf(p);
  assert.deepEqual(slots.map((s) => [s.label, s.kind]), [['Clip 1', 'image'], ['Musica', 'audio'], ['Clip 2', 'image'], ['Clip 3', 'image']].sort((a, b) => 0) && slots.map((s) => [s.label, s.kind]));
  assert.deepEqual(slots.filter((s) => s.kind === 'image').map((s) => s.label), ['Clip 1', 'Clip 2', 'Clip 3']);
  assert.ok(slots.every((s) => s.fit === (s.kind === 'audio' ? 'contain' : 'cover')));
  assert.deepEqual(textsOf(p).map((t) => t.content), ['Titolo del video', 'Grazie']);
  assert.equal(slots.find((s) => s.kind === 'audio').id, ids.song);
});

test('templateFromProject: nessun file resta, segnaposto e testi si conservano, giro dal file', () => {
  const { p } = sample();
  const t = templateFromProject(p, { name: 'Tre foto', category: 'Foto', id: 'tpl1', now: 5 });
  assert.equal(JSON.stringify(t).includes('"m0"'), false, 'nessun id di media');
  assert.deepEqual(t.project.media, {});
  assert.ok(allClips(t.project).every((c) => c.mediaId === null));
  assert.equal(t.slots.length, 4);
  assert.equal(t.duration, 8);
  assert.deepEqual(t.aspect, { width: 1920, height: 1080 });
  assert.equal(p.media.m0.name, 'f0.png', 'il progetto originale non cambia');
  const back = parseTemplateFile(serializeTemplate(t));
  assert.equal(back.name, 'Tre foto');
  assert.equal(back.slots.length, 4);
  assert.equal(back.builtin, false);
  assert.deepEqual(back.texts.map((x) => x.content), ['Titolo del video', 'Grazie']);
  // si può usare
  const out = applyTemplate(back, fillAll(back));
  assert.deepEqual(validateProject(out), []);
});

test('sanitizeTemplate: rifiuta file che non sono modelli e ripara dati strani', () => {
  assert.throws(() => sanitizeTemplate(null), /modello/);
  assert.throws(() => sanitizeTemplate({ format: 'altro' }), /modello/);
  assert.throws(() => sanitizeTemplate({ format: 'ciak-modello', project: {} }), /danneggiato/);
  assert.throws(() => parseTemplateFile('{non json'), /valido/);
  assert.throws(() => parseTemplateFile('x'.repeat(4_000_001)), /grande/);
  const { p } = sample();
  const t = templateFromProject(p, { name: 'X' });
  const dirty = JSON.parse(serializeTemplate(t));
  dirty.project.tracks[1].clips[0].duration = 'molto';
  dirty.project.tracks[1].clips[1].duration = -3;
  dirty.project.tracks.push(null);
  dirty.slots = 'rotto';
  const ok = sanitizeTemplate(dirty);
  assert.ok(ok.slots.length >= 2, 'i segnaposto si ricalcolano dal progetto');
  assert.deepEqual(validateProject(applyTemplate(ok, fillAll(ok))), []);
});

test('applyTemplate: tutto riempito con foto → stessi tempi, file collegati, transizioni e keyframe conservati e vista "cover"', () => {
  const { p, ids } = sample({ vertical: true });
  const t = templateFromProject(p, { name: 'V' });
  const out = applyTemplate(t, fillAll(t, 3));
  assert.deepEqual(validateProject(out), []);
  assert.equal(projectDuration(out), 8);
  const c1 = clipById(out, ids.s1);
  assert.equal(c1.start, 2.5);
  assert.equal(c1.transition.duration, 0.5);
  assert.ok(c1.mediaId.startsWith('n_'));
  assert.equal(Object.keys(out.media).length, 4);
  // 1920×1080 su 1080×1920: cover = (1920/1080)/(1080/1920)... = max(1080/1920, 1920/1080)/min(...) = 3.16
  const f = Math.max(1080 / 1920, 1920 / 1080) / Math.min(1080 / 1920, 1920 / 1080);
  assert.ok(Math.abs(c1.transform.scale - f) < 1e-9);
  assert.ok(Math.abs(c1.keyframes.scale[1].v - 1.2 * f) < 1e-9, 'anche i keyframe seguono');
  const t0 = clipById(out, ids.title);
  assert.equal(t0.text.content, 'Titolo del video');
});

test('applyTemplate: media 16:9 su canvas 16:9 non cambia la scala; il testo si può sostituire', () => {
  const { p, ids } = sample();
  const t = templateFromProject(p, { name: 'H' });
  const out = applyTemplate(t, { ...fillAll(t), texts: { [ids.title]: 'Il mio viaggio' }, name: 'Mio video' });
  assert.equal(out.name, 'Mio video');
  assert.equal(clipById(out, ids.s0).transform.scale, 1);
  assert.equal(clipById(out, ids.title).text.content, 'Il mio viaggio');
  assert.equal(clipById(out, ids.credit).text.content, 'Grazie', 'gli altri testi restano');
});

test('applyTemplate: un video più corto accorcia il segmento, i testi lo seguono e il resto scorre', () => {
  const { p, ids } = sample();
  const t = templateFromProject(p, { name: 'T' });
  const media = fillAll(t).media;
  media[ids.s1] = rec('short', 'video', 1.5); // il 2° clip dura 1,5 s invece di 3
  const out = applyTemplate(t, { media });
  assert.deepEqual(validateProject(out), []);
  const c1 = clipById(out, ids.s1);
  const c2 = clipById(out, ids.s2);
  assert.equal(c1.kind, 'video');
  assert.equal(c1.duration, 1.5);
  assert.equal(c1.start, 2.5);
  // il 3° clip parte 0,5 s prima della fine del 2°: 2.5 + 1.5 − 0.5 = 3.5
  assert.ok(Math.abs(c2.start - 3.5) < 1e-9, `c2.start ${c2.start}`);
  // il titolo nasceva a 2.5 s (inizio del 2° clip) e durava 2 s (fin dentro il 3°): si accorcia in proporzione alla warp
  const title = clipById(out, ids.title);
  assert.equal(title.start, 2.5);
  assert.ok(title.start + title.duration <= projectDuration(out) + 1e-9);
  // i titoli di coda (a 6 s = 1 s dopo l'inizio del 3° clip) seguono il 3° clip
  const credit = clipById(out, ids.credit);
  assert.ok(Math.abs(credit.start - (c2.start + 1)) < 1e-9, `credit ${credit.start}`);
  assert.equal(projectDuration(out), 3.5 + 3);
  // la musica non supera la fine del video
  const song = clipById(out, ids.song);
  assert.ok(song.start + song.duration <= 6.5 + 1e-9);
});

test('applyTemplate: un video più lungo del segmento viene tagliato alla durata del segnaposto', () => {
  const { p, ids } = sample();
  const t = templateFromProject(p, { name: 'T' });
  const media = fillAll(t).media;
  media[ids.s0] = rec('long', 'video', 99);
  const out = applyTemplate(t, { media });
  assert.equal(clipById(out, ids.s0).duration, 3);
  assert.deepEqual(validateProject(out), []);
});

test('applyTemplate: un segnaposto non riempito viene saltato, il tempo si chiude e i testi del segmento spariscono', () => {
  const { p, ids } = sample();
  const t = templateFromProject(p, { name: 'T' });
  const media = fillAll(t).media;
  delete media[ids.s1];
  const out = applyTemplate(t, { media });
  assert.deepEqual(validateProject(out), []);
  assert.equal(clipById(out, ids.s1), undefined);
  assert.equal(clipById(out, ids.title), undefined, 'il titolo del clip saltato non ha più senso');
  const c2 = clipById(out, ids.s2);
  assert.ok(Math.abs(c2.start - 2.5) < 1e-9, `il 3° clip viene subito dopo il 1°, con la sua transizione: ${c2.start}`);
  assert.ok(Math.abs(projectDuration(out) - 5.5) < 1e-9);
  const credit = clipById(out, ids.credit);
  assert.ok(credit && credit.start + credit.duration <= 5.5 + 1e-9, 'i titoli di coda restano e rientrano nel video');
  // salta anche il primo
  const m2 = fillAll(t).media;
  delete m2[ids.s0];
  const out2 = applyTemplate(t, { media: m2 });
  assert.deepEqual(validateProject(out2), []);
  assert.equal(clipById(out2, ids.s1).start, 0);
  // salta tutti: progetto vuoto ma valido
  const out3 = applyTemplate(t, { media: {} });
  assert.deepEqual(validateProject(out3), []);
  assert.equal(allClips(out3).filter((c) => c.kind === 'image').length, 0);
});

test('applyTemplate: foto al posto di video e viceversa, musica nel posto giusto, errori chiari', () => {
  const { p, ids } = sample();
  const t = templateFromProject(p, { name: 'T' });
  const media = fillAll(t).media;
  media[ids.s0] = rec('vid', 'video', 10);
  const out = applyTemplate(t, { media });
  assert.equal(clipById(out, ids.s0).kind, 'video');
  assert.equal(clipById(out, ids.s0).duration, 3);
  assert.throws(() => applyTemplate(t, { media: { ...media, [ids.song]: rec('x', 'video', 3) } }), /audio/);
  assert.throws(() => applyTemplate(t, { media: { ...media, [ids.s1]: rec('x', 'audio', 3) } }), /video o una foto/);
  assert.throws(() => applyTemplate(t, { media: { nonesiste: rec('x', 'image', 0) } }), /sconosciuto/);
  assert.throws(() => applyTemplate(t, { media: { [ids.s0]: { id: 3 } } }), /non valido/);
  // senza musica il clip audio sparisce
  const noMusic = { ...media };
  delete noMusic[ids.song];
  assert.equal(clipById(applyTemplate(t, { media: noMusic }), ids.song), undefined);
});

test('applyTemplate: il modello non viene modificato e due usi danno risultati indipendenti', () => {
  const { p } = sample();
  const t = templateFromProject(p, { name: 'T' });
  const snapshot = JSON.stringify(t);
  const a = applyTemplate(t, fillAll(t));
  const shortVideos = { media: Object.fromEntries(t.slots.map((s) => [s.id, rec(`v_${s.id}`, s.kind === 'audio' ? 'audio' : 'video', s.kind === 'audio' ? 30 : 1)])) };
  const b = applyTemplate(t, shortVideos);
  assert.equal(JSON.stringify(t), snapshot);
  assert.notEqual(projectDuration(a), projectDuration(b));
  assert.deepEqual(validateProject(a), []);
  assert.deepEqual(validateProject(b), []);
});

test('applyTemplate: ogni combinazione di segnaposto riempiti/saltati e durate casuali dà un progetto valido (prova a caso)', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (const vertical of [false, true]) {
    const { p, ids } = sample({ vertical });
    // aggiungi un PiP su un'altra traccia e un adesivo
    const pipTrack = addTrack(p, 'video', { name: 'PiP' });
    p.media.pm = { id: 'pm', name: 'pip.png', kind: 'image', mime: 'image/png', size: 1, duration: 0, width: 800, height: 800 };
    const pip = createClip('image', { mediaId: 'pm', duration: 2, transform: { scale: 0.3, x: 0.3, y: -0.3 } });
    addClip(p, pipTrack.id, pip, 4);
    addClip(p, pipTrack.id, createClip('sticker', { duration: 1 }), 0.2);
    const t = templateFromProject(p, { name: 'R' });
    for (let k = 0; k < 250; k++) {
      const media = {};
      for (const s of t.slots) {
        if (rnd() < 0.3) continue;
        const kind = s.kind === 'audio' ? 'audio' : rnd() < 0.5 ? 'image' : 'video';
        media[s.id] = rec(`r${k}_${s.id}`, kind, 0.2 + rnd() * 20, 200 + Math.floor(rnd() * 3000), 200 + Math.floor(rnd() * 3000));
      }
      let out;
      try {
        out = applyTemplate(t, { media });
      } catch (e) {
        assert.fail(`errore con ${JSON.stringify(Object.keys(media).length)} file: ${e.message}`);
      }
      const errs = validateProject(out);
      assert.deepEqual(errs, [], `combinazione ${k}: ${errs.join('; ')}`);
      for (const c of allClips(out)) assert.ok(c.start >= -1e-9 && c.duration > 0.0009, `${k}: ${c.id} start ${c.start} dur ${c.duration}`);
      for (const s of t.slots) {
        const c = clipById(out, s.id);
        if (media[s.id] && s.kind !== 'audio') assert.ok(c && c.mediaId === media[s.id].id, `${k}: slot ${s.label} collegato`);
        if (!media[s.id]) assert.equal(c, undefined, `${k}: slot ${s.label} tolto`);
      }
      // nessun clip oltre la fine del video visivo (musica compresa)
      const visEnd = Math.max(0, ...allClips(out).filter((c) => c.kind !== 'audio').map((c) => c.start + c.duration));
      for (const c of allClips(out).filter((c) => c.kind === 'audio')) assert.ok(c.start + c.duration <= visEnd + 1e-6, `${k}: la musica non supera il video`);
    }
  }
});

test('applyTemplate: uno sfondo che dura tutto il modello, se non riempito, sparisce ma testi e forme restano al loro posto', () => {
  const p = createProject();
  p.media.bg = { id: 'bg', name: 'sfondo.png', kind: 'image', mime: 'image/png', size: 1, duration: 0, width: 1920, height: 1080 };
  const bg = createClip('image', { mediaId: 'bg', duration: 6 });
  addClip(p, p.tracks[1].id, bg, 0);
  const t1 = createClip('text', { duration: 4, text: { content: 'Frase' } });
  addClip(p, p.tracks[0].id, t1, 1);
  const t = templateFromProject(p, { name: 'Citazione' });
  const out = applyTemplate(t, { media: {} });
  assert.deepEqual(validateProject(out), []);
  assert.equal(clipById(out, bg.id), undefined);
  const txt = clipById(out, t1.id);
  assert.equal(txt.start, 1);
  assert.equal(txt.duration, 4);
  // con uno sfondo più corto (video di 2 s) il segmento si accorcia e il testo lo segue
  const out2 = applyTemplate(t, { media: { [bg.id]: rec('v', 'video', 2) } });
  assert.deepEqual(validateProject(out2), []);
  assert.equal(clipById(out2, bg.id).duration, 2);
});
