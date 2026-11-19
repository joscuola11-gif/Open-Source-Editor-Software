// Modello dati del progetto: creazione, valori predefiniti, normalizzazione dei file caricati.
//
// Convenzioni
//  - Tempi in secondi (timeline). `clip.in` è l'offset nel file sorgente, `clip.speed` la velocità.
//  - Durata sorgente consumata = clip.duration * clip.speed.
//  - tracks[0] è la traccia più in alto nella timeline (e la più in alto nel compositing).
//  - Le coordinate x/y sono frazioni della larghezza/altezza del canvas (0 = centro).
//    scale = 1 significa "contenuto adattato al canvas"; testo/forme/adesivi usano % dell'altezza.

import { clamp, isNum, mergeDeep, uid } from './util.js';
import { MAX_SPEED, MIN_SPEED } from './presets.js';
import { defaultGrade, sanitizeGrade, sanitizeLuts } from './grade.js';
import { defaultKaraoke, sanitizeKaraoke, sanitizeWords } from './karaoke.js';
import { sanitizeLoop } from './animations.js';

export const SCHEMA_VERSION = 1;

export const VISUAL_KINDS = ['video', 'image', 'text', 'shape', 'sticker', 'adjustment'];
export const MEDIA_KINDS = ['video', 'image', 'audio'];
/** Clip il cui contenuto è limitato dalla durata del file sorgente. */
export const TIMED_KINDS = ['video', 'audio'];
export const ALL_KINDS = [...VISUAL_KINDS, 'audio'];

export const isVisualKind = (k) => k !== 'audio';
export const hasMedia = (k) => MEDIA_KINDS.includes(k);
export const isTimedKind = (k) => TIMED_KINDS.includes(k);
export const trackTypeFor = (kind) => (kind === 'audio' ? 'audio' : 'video');

export const DEFAULT_IMAGE_DURATION = 5;
export const DEFAULT_TEXT_DURATION = 3;

export function createTrack(type, name) {
  return { id: uid('t'), type, name: name ?? (type === 'audio' ? 'Audio' : 'Video'), muted: false, hidden: false, locked: false, clips: [] };
}

export function createProject({ name = 'Nuovo progetto', width = 1920, height = 1080, fps = 30 } = {}) {
  const v2 = createTrack('video', 'Video 2');
  const v1 = createTrack('video', 'Video 1');
  const a1 = createTrack('audio', 'Audio 1');
  return {
    version: SCHEMA_VERSION,
    name,
    settings: { width, height, fps, background: '#000000' },
    media: {},
    tracks: [v2, v1, a1],
    markers: [],
    luts: {},
  };
}

export function defaultText() {
  return {
    content: 'Testo',
    font: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
    size: 8,
    weight: 700,
    italic: false,
    underline: false,
    uppercase: false,
    color: '#ffffff',
    align: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    boxWidth: 0.85,
    stroke: { width: 0, color: '#000000' },
    shadow: { blur: 0, x: 0, y: 0, color: '#000000', opacity: 0.5 },
    bg: { enabled: false, color: '#000000', opacity: 0.6, padding: 0.3, radius: 0.2 },
    karaoke: defaultKaraoke(),
    words: null,
  };
}

export function defaultShape() {
  return { type: 'rect', fill: '#ff3b5c', stroke: '#ffffff', strokeWidth: 0, w: 0.35, h: 0.35, full: false };
}

export function createClip(kind, props = {}) {
  const base = {
    id: uid('c'),
    kind,
    mediaId: null,
    name: '',
    role: null,
    start: 0,
    duration: kind === 'image' ? DEFAULT_IMAGE_DURATION : DEFAULT_TEXT_DURATION,
    in: 0,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    muted: false,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipX: false, flipY: false },
    crop: { l: 0, t: 0, r: 0, b: 0 },
    blend: 'normal',
    mask: { shape: 'none', size: 0.6, roundness: 0.25, invert: false },
    adjust: { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0, vignette: 0, temperature: 0, tint: 0, grain: 0 },
    filter: { id: 'none', intensity: 1 },
    grade: defaultGrade(),
    effects: [],
    chroma: { enabled: false, color: '#00ff00', similarity: 0.4, smoothness: 0.1 },
    keyframes: {},
    transition: null,
    anim: { in: null, out: null, loop: null },
  };
  if (kind === 'text') base.text = defaultText();
  if (kind === 'shape') base.shape = defaultShape();
  if (kind === 'sticker') base.sticker = { emoji: '😀', size: 0.25 };
  return mergeDeep(base, props);
}

/** Crea un clip a partire da un file importato. */
export function clipFromMedia(media, { start = 0 } = {}) {
  const kind = media.kind;
  const duration = kind === 'image' ? DEFAULT_IMAGE_DURATION : Math.max(0.1, media.duration || 1);
  return createClip(kind, { mediaId: media.id, name: media.name, start, duration });
}

export function projectDuration(p) {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.duration);
  return end;
}

export function allClips(p) {
  return p.tracks.flatMap((t) => t.clips);
}

export function findClip(p, id) {
  for (const track of p.tracks) {
    const index = track.clips.findIndex((c) => c.id === id);
    if (index >= 0) return { track, clip: track.clips[index], index };
  }
  return null;
}

export const getTrack = (p, id) => p.tracks.find((t) => t.id === id) ?? null;

/** Tempo massimo (in secondi di sorgente) che il clip può consumare a partire da `clip.in`. */
export function maxSourceSpan(p, clip) {
  if (!isTimedKind(clip.kind)) return Infinity;
  const m = p.media[clip.mediaId];
  if (!m || !isNum(m.duration) || m.duration <= 0) return Infinity;
  return Math.max(0, m.duration - clip.in);
}

// ---------------------------------------------------------------------------
// Normalizzazione di progetti caricati (file/IndexedDB): ripara invece di fallire.
// ---------------------------------------------------------------------------

const num = (v, d, lo = -Infinity, hi = Infinity) => (isNum(v) ? clamp(v, lo, hi) : d);

export function sanitizeClip(raw, p) {
  if (!raw || typeof raw !== 'object' || !ALL_KINDS.includes(raw.kind)) return null;
  const clip = createClip(raw.kind, raw);
  clip.id = typeof raw.id === 'string' && raw.id ? raw.id : uid('c');
  clip.start = Math.max(0, num(raw.start, 0));
  clip.duration = num(raw.duration, 1);
  if (clip.duration <= 0) return null;
  clip.speed = num(raw.speed, 1, MIN_SPEED, MAX_SPEED);
  clip.in = Math.max(0, num(raw.in, 0));
  clip.volume = num(raw.volume, 1, 0, 4);
  clip.fadeIn = Math.max(0, num(raw.fadeIn, 0));
  clip.fadeOut = Math.max(0, num(raw.fadeOut, 0));
  if (clip.fadeIn + clip.fadeOut > clip.duration) {
    const k = clip.duration / (clip.fadeIn + clip.fadeOut);
    clip.fadeIn *= k;
    clip.fadeOut *= k;
  }
  if (hasMedia(clip.kind)) {
    const m = p.media[clip.mediaId];
    if (!m || m.kind !== clip.kind && !(clip.kind === 'audio' && m.kind === 'video')) return null;
    if (isTimedKind(clip.kind) && isNum(m.duration) && m.duration > 0) {
      clip.in = Math.min(clip.in, Math.max(0, m.duration - 0.01));
      const maxDur = (m.duration - clip.in) / clip.speed;
      if (clip.duration > maxDur) clip.duration = maxDur;
      if (clip.duration <= 0) return null;
    }
  }
  if (clip.transition) {
    clip.transition = { type: String(clip.transition.type), duration: clamp(num(clip.transition.duration, 0.5), 0, clip.duration) };
    if (clip.transition.duration <= 0) clip.transition = null;
  }
  for (const side of ['in', 'out']) {
    const a = clip.anim?.[side];
    if (a) {
      clip.anim[side] = { type: String(a.type), duration: clamp(num(a.duration, 0.5), 0, clip.duration) };
      if (clip.anim[side].duration <= 0) clip.anim[side] = null;
    }
  }
  clip.anim.loop = sanitizeLoop(clip.anim.loop);
  for (const [prop, kfs] of Object.entries(clip.keyframes ?? {})) {
    const clean = (Array.isArray(kfs) ? kfs : []).filter((k) => k && isNum(k.t) && isNum(k.v)).map((k) => ({ t: k.t, v: k.v, e: typeof k.e === 'string' ? k.e : 'linear' }));
    clean.sort((a, b) => a.t - b.t);
    if (clean.length) clip.keyframes[prop] = clean;
    else delete clip.keyframes[prop];
  }
  clip.grade = sanitizeGrade(raw.grade);
  if (clip.kind === 'text') {
    clip.text.karaoke = sanitizeKaraoke(raw.text?.karaoke);
    clip.text.words = sanitizeWords(raw.text?.words);
  }
  if (!Array.isArray(clip.effects)) clip.effects = [];
  clip.effects = clip.effects.filter((e) => e && typeof e.type === 'string').map((e) => ({ id: e.id ?? uid('e'), type: e.type, amount: num(e.amount, 50, 0, 100) }));
  return clip;
}

export function sanitizeProject(raw) {
  const base = createProject();
  const p = {
    version: SCHEMA_VERSION,
    name: typeof raw?.name === 'string' ? raw.name.slice(0, 120) : base.name,
    settings: { ...base.settings },
    media: {},
    tracks: [],
    markers: [],
    luts: sanitizeLuts(raw?.luts),
  };
  const s = raw?.settings ?? {};
  p.settings.width = Math.round(num(s.width, 1920, 16, 8192));
  p.settings.height = Math.round(num(s.height, 1080, 16, 8192));
  p.settings.fps = Math.round(num(s.fps, 30, 1, 120));
  p.settings.background = /^#[0-9a-f]{6}$/i.test(s.background) ? s.background : '#000000';
  for (const [id, m] of Object.entries(raw?.media ?? {})) {
    if (!m || !MEDIA_KINDS.includes(m.kind)) continue;
    p.media[id] = {
      id,
      name: String(m.name ?? 'media'),
      kind: m.kind,
      mime: String(m.mime ?? ''),
      size: num(m.size, 0, 0),
      duration: num(m.duration, 0, 0),
      width: num(m.width, 0, 0),
      height: num(m.height, 0, 0),
      hasAudio: m.hasAudio !== false,
    };
  }
  const seen = new Set();
  for (const rt of Array.isArray(raw?.tracks) ? raw.tracks : []) {
    const type = rt?.type === 'audio' ? 'audio' : 'video';
    const track = { ...createTrack(type, typeof rt?.name === 'string' ? rt.name : undefined), id: typeof rt?.id === 'string' && rt.id ? rt.id : uid('t') };
    track.muted = !!rt?.muted;
    track.hidden = !!rt?.hidden;
    track.locked = !!rt?.locked;
    for (const rc of Array.isArray(rt?.clips) ? rt.clips : []) {
      const clip = sanitizeClip(rc, p);
      if (!clip || seen.has(clip.id)) continue;
      if (trackTypeFor(clip.kind) !== type) continue;
      seen.add(clip.id);
      track.clips.push(clip);
    }
    track.clips.sort((a, b) => a.start - b.start);
    p.tracks.push(track);
  }
  if (p.tracks.length === 0) p.tracks = createProject().tracks;
  for (const m of Array.isArray(raw?.markers) ? raw.markers : []) {
    if (m && isNum(m.time) && m.time >= 0) p.markers.push({ id: m.id ?? uid('m'), time: m.time, label: String(m.label ?? '') });
  }
  return p;
}
