// Modelli pronti (nessun file incluso: si riempiono con le proprie foto, video e musica).
// Ogni modello è costruito con le stesse funzioni dell'editor, quindi vale tutto ciò che vale per un progetto normale.

import { TEXT_PRESETS } from './presets.js';
import { createClip, createProject } from './project.js';
import { addClip, addTrack, setTransition } from './timeline.js';
import { templateFromProject } from './templates.js';

const ASPECT = { vertical: { width: 1080, height: 1920 }, wide: { width: 1920, height: 1080 }, square: { width: 1080, height: 1080 } };

/** Piccola cassetta degli attrezzi per costruire i modelli. */
function builder(aspect) {
  const p = createProject({ ...ASPECT[aspect], name: 'Modello' });
  const [overlay, main, music] = p.tracks;
  const layers = [overlay]; // tracce per testi, forme e adesivi (dall'alto): se un livello è occupato in quel momento se ne crea un altro
  const place = (clip, start, track) => {
    if (track) return addClip(p, track.id, clip, start);
    const free = (t) => t.clips.every((c) => c.start + c.duration <= start + 1e-6 || c.start >= start + clip.duration - 1e-6);
    let t = layers.find(free);
    if (!t) {
      t = addTrack(p, 'video', { name: `Livello ${layers.length + 1}` });
      layers.push(t);
    }
    return addClip(p, t.id, clip, start);
  };
  const api = {
    p,
    overlay,
    main,
    music,
    /** Segnaposto video/foto: parte come immagine, diventa video se si sceglie un video. Movimento lento «Ken Burns» opzionale. */
    slot(track, start, duration, { ken = true, transform = {}, props = {} } = {}) {
      const c = createClip('image', { name: 'Segnaposto', duration, transform, ...props });
      if (ken) {
        const s = c.transform.scale || 1;
        c.keyframes.scale = [{ t: 0, v: s, e: 'ease-in-out' }, { t: duration, v: +(s * 1.12).toFixed(4), e: 'ease-in-out' }];
      }
      addClip(p, track.id, c, start);
      return c;
    },
    /** Transizione all'inizio del clip (si sovrappone al precedente). */
    transition(clip, type, duration = 0.5) {
      setTransition(p, clip.id, { type, duration });
    },
    music(duration, props = {}) {
      const c = createClip('audio', { name: 'Musica', duration, fadeIn: 0.5, fadeOut: 1.2, volume: 0.9, ...props });
      addClip(p, music.id, c, 0);
      return c;
    },
    /** Testo con lo stile di uno dei modelli di testo; `o` può cambiare posizione, dimensione, animazioni. */
    text(preset, content, start, duration, o = {}) {
      const pr = TEXT_PRESETS.find((x) => x.id === preset);
      if (!pr) throw new Error(`stile di testo sconosciuto: ${preset}`);
      const c = createClip('text', { name: o.name ?? pr.label, start, duration, text: { ...structuredClone(pr.text), content, ...(o.size ? { size: o.size } : {}), ...(o.color ? { color: o.color } : {}), ...(o.text ?? {}) }, transform: { y: o.y ?? pr.y ?? 0, x: o.x ?? 0 } });
      const animIn = o.animIn === undefined ? pr.animIn : o.animIn;
      if (animIn) c.anim.in = { type: animIn, duration: o.animInDur ?? 0.8 };
      if (o.animOut) c.anim.out = { type: o.animOut, duration: 0.5 };
      const loop = o.loop === undefined ? pr.loop : o.loop;
      if (loop) c.anim.loop = { ...loop };
      place(c, start, o.track);
      return c;
    },
    shape(track, start, duration, shape, transform = {}, props = {}) {
      const c = createClip('shape', { name: props.name ?? 'Forma', duration, shape: { type: 'rect', ...shape }, transform, ...props });
      place(c, start, track === overlay ? null : track);
      return c;
    },
    sticker(start, duration, emoji, size, transform = {}, o = {}) {
      const c = createClip('sticker', { name: 'Adesivo', duration, sticker: { emoji, size }, transform });
      if (o.animIn) c.anim.in = { type: o.animIn, duration: 0.6 };
      if (o.loop) c.anim.loop = { ...o.loop };
      place(c, start, o.track);
      return c;
    },
  };
  return api;
}

const finish = (b, info) => templateFromProject(b.p, { id: `base-${info.id}`, name: info.name, category: info.category, description: info.description, builtin: true, now: 0 });

const LIBRARY = [
  {
    id: 'tre-momenti', name: 'Tre momenti', category: 'Social verticale', description: 'Tre clip in verticale con titolo e didascalie. Ideale per TikTok, Reel e Short.',
    build() {
      const b = builder('vertical');
      const clips = [0, 1, 2].map((i) => b.slot(b.main, i * 3, 3));
      clips.slice(1).forEach((c) => b.transition(c, 'push-up', 0.5));
      b.text('title', 'I MIEI MOMENTI', 0.2, 2.4, { y: -0.3, size: 9, animIn: 'pop' });
      ['Momento uno', 'Momento due', 'Momento tre'].forEach((t, i) => b.text('label', t, i * 2.5 + 0.5, 2, { y: 0.32, size: 6, animIn: 'slide-from-left' }));
      return b;
    },
  },
  {
    id: 'vlog-veloce', name: 'Vlog veloce', category: 'Social verticale', description: 'Cinque scatti rapidi con transizioni “whip”, etichetta VLOG e sottotitolo.',
    build() {
      const b = builder('vertical');
      const clips = [0, 1, 2, 3, 4].map((i) => b.slot(b.main, i * 1.8, 1.8));
      clips.slice(1).forEach((c, i) => b.transition(c, i % 2 ? 'whip-right' : 'whip-left', 0.3));
      b.text('pill', 'VLOG', 0, 7.4, { y: -0.4, size: 5.5, loop: { type: 'pulse', speed: 1.2, amount: 40 } });
      b.text('subtitle', 'Giorno 1', 0.3, 2.5, { y: 0.34, animIn: 'rise' });
      return b;
    },
  },
  {
    id: 'prima-e-dopo', name: 'Prima e dopo', category: 'Social verticale', description: 'Due clip a confronto con apertura dal centro e etichette PRIMA / DOPO.',
    build() {
      const b = builder('vertical');
      b.slot(b.main, 0, 3.5);
      const dopo = b.slot(b.main, 3.5, 3.5);
      b.transition(dopo, 'split-v', 0.8);
      b.text('pill', 'PRIMA', 0.2, 2.6, { y: -0.4, size: 6 });
      b.text('pill', 'DOPO', 3, 3.2, { y: -0.4, size: 6, text: { bg: { enabled: true, color: '#1faa59', opacity: 1, padding: 0.55, radius: 1 } } });
      return b;
    },
  },
  {
    id: 'top-3', name: 'Top 3', category: 'Social verticale', description: 'Classifica a tre posti con grandi numeri e nome per ogni clip.',
    build() {
      const b = builder('vertical');
      const clips = [0, 1, 2].map((i) => b.slot(b.main, i * 3, 3));
      clips.slice(1).forEach((c) => b.transition(c, 'whip-right', 0.4));
      [['3', 'Terzo posto'], ['2', 'Secondo posto'], ['1', 'Primo posto']].forEach(([n, label], i) => {
        const start = i * 2.6;
        b.text('countdown', n, start + 0.1, i === 2 ? 2.9 : 2.5, { x: -0.3, y: -0.34, size: 22, name: `Numero ${n}`, loop: null });
        b.text('label', label, start + 0.4, i === 2 ? 2.6 : 2.2, { y: 0.34, size: 6.5, animIn: 'slide-from-bottom' });
      });
      return b;
    },
  },
  {
    id: 'lancio-prodotto', name: 'Lancio prodotto', category: 'Social verticale', description: 'Due clip con etichetta NOVITÀ, bollino sconto e invito all’azione.',
    build() {
      const b = builder('vertical');
      b.slot(b.main, 0, 3.5);
      const second = b.slot(b.main, 3.5, 3.5);
      b.transition(second, 'push-left', 0.5);
      b.text('pill', 'NOVITÀ', 0.2, 3, { y: -0.4, size: 6 });
      b.shape(b.overlay, 3.5, 3, { type: 'star', fill: '#e63946', w: 0.34, h: 0.34 }, { x: 0.3, y: -0.3, rotation: -10 }, { name: 'Bollino', anim: { in: { type: 'pop', duration: 0.6 }, out: null, loop: { type: 'pulse', speed: 1, amount: 50 } } });
      b.text('comic', '-30%', 3.5, 3, { x: 0.3, y: -0.3, size: 7, animIn: 'pop', loop: null });
      b.text('label', 'Scopri di più', 4.2, 2.2, { y: 0.34, size: 6.5, animIn: 'zoom-out' });
      return b;
    },
  },
  {
    id: 'foto-ricordo', name: 'Foto ricordo', category: 'Foto e ricordi', description: 'Quattro foto quadrate con dissolvenze morbide, grana di pellicola, scritta a mano e musica.',
    build() {
      const b = builder('square');
      const clips = [0, 1, 2, 3].map((i) => b.slot(b.main, i * 3, 3, { props: { effects: [{ id: `fx${i}`, type: 'film-grain', amount: 45 }], adjust: { vignette: 35, warm: 0 } } }));
      clips.slice(1).forEach((c) => b.transition(c, 'cross-blur', 0.7));
      b.text('handwriting', 'Estate insieme', 6.9, 3, { y: 0.32, size: 9, animIn: 'wipe-from-left' });
      b.music(9.9);
      return b;
    },
  },
  {
    id: 'slideshow-musicale', name: 'Slideshow musicale', category: 'Foto e ricordi', description: 'Sei foto in sequenza con zoom attraverso, titolo e titoli di coda, sulla tua musica.',
    build() {
      const b = builder('wide');
      const clips = [0, 1, 2, 3, 4, 5].map((i) => b.slot(b.main, i * 2.5, 2.5));
      clips.slice(1).forEach((c) => b.transition(c, 'zoom-through', 0.6));
      b.text('cinema', 'I NOSTRI MOMENTI', 0.3, 2.2, { y: 0, size: 8 });
      b.text('minimal', 'Grazie per aver guardato', 9.6, 2.2, { y: 0.3, size: 6 });
      b.music(12);
      return b;
    },
  },
  {
    id: 'intro-titolo', name: 'Intro con titolo', category: 'Titoli e intro', description: 'Il tuo video di sfondo, scurito, con titolo e sottotitolo che entrano uno dopo l’altro.',
    build() {
      const b = builder('wide');
      b.slot(b.main, 0, 5);
      b.shape(b.overlay, 0, 5, { type: 'rect', fill: '#000000', full: true }, { opacity: 0.42 }, { name: 'Velo scuro' });
      b.text('cinema', 'IL TUO TITOLO', 0.6, 4.2, { y: -0.04, size: 11, animIn: 'zoom-out' });
      b.text('minimal', 'una breve descrizione', 1.4, 3.4, { y: 0.1, size: 5, animIn: 'rise' });
      return b;
    },
  },
  {
    id: 'notizia', name: 'Notizia', category: 'Titoli e intro', description: 'Un video con striscia “ULTIMA ORA” e terzo inferiore con nome e ruolo.',
    build() {
      const b = builder('wide');
      b.slot(b.main, 0, 8, { ken: false });
      b.text('news', 'ULTIMA ORA', 0.4, 7.4, { y: -0.4, size: 4.5 });
      b.text('lower-third', 'Nome Cognome', 1.2, 4.5, { y: 0.3, size: 5.5 });
      return b;
    },
  },
  {
    id: 'citazione', name: 'Citazione', category: 'Citazioni', description: 'Una frase che compare su fondo colorato (o su un tuo sfondo), con la firma sotto.',
    build() {
      const b = builder('square');
      b.slot(b.main, 0, 7, { ken: true });
      b.shape(b.overlay, 0, 7, { type: 'rect', fill: '#16213e', full: true }, { opacity: 0.8 }, { name: 'Sfondo colorato' });
      b.shape(b.overlay, 0.6, 6.4, { type: 'rect', fill: '#ffd45a', w: 0.18, h: 0.008 }, { y: 0.03 }, { name: 'Filetto', anim: { in: { type: 'wipe-from-left', duration: 0.8 }, out: null, loop: null } });
      b.text('quote', '«Scrivi qui la tua frase»', 0.4, 6.2, { y: -0.06, size: 6.5 });
      b.text('minimal', '— Il tuo nome', 1.8, 4.8, { y: 0.14, size: 4.5, animIn: 'fade' });
      return b;
    },
  },
  {
    id: 'griglia-4', name: 'Griglia 4 clip', category: 'Griglie', description: 'Quattro video insieme sullo schermo, ognuno nel suo riquadro, con titolo.',
    build() {
      const b = builder('wide');
      b.shape(b.main, 0, 6, { type: 'rect', fill: '#0f1020', full: true }, {}, { name: 'Sfondo' });
      const pos = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];
      pos.forEach(([x, y], i) => {
        const tr = addTrack(b.p, 'video', { name: `Riquadro ${i + 1}` });
        b.slot(tr, 0, 6, { ken: false, transform: { scale: 0.48, x, y } });
      });
      b.text('pill', '4 MOMENTI', 0.3, 5.4, { y: -0.02, size: 4.5, animIn: 'pop' });
      return b;
    },
  },
];

let cache = null;
/** Tutti i modelli pronti (costruiti una volta sola). */
export function builtinTemplates() {
  cache ??= LIBRARY.map((spec) => finish(spec.build(), spec));
  return cache;
}
export const TEMPLATE_CATEGORIES = ['Social verticale', 'Foto e ricordi', 'Titoli e intro', 'Citazioni', 'Griglie'];
