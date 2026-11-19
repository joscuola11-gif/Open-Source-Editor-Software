// Modelli: un progetto "vuoto" con segnaposto (clip senza file) da riempire con i propri video, foto, musica e testi.
// Tutto puro: costruire un modello da un progetto, riempirlo con i media scelti e ricollocare i tempi.
//
//   modello = { format, id, name, category, description, builtin, created, updated,
//               aspect:{width,height}, duration, slots:[{id,kind,label,duration,fit}], texts:[{id,label,content}], project }

import { EditError, clamp, isNum, uid } from './util.js';
import { allClips, findClip, projectDuration, sanitizeProject } from './project.js';

export const TEMPLATE_FORMAT = 'ciak-modello';
const MIN = 0.1;
const VISUAL = ['video', 'image'];
const clone = (x) => JSON.parse(JSON.stringify(x));

const fitFor = (clip) => (clip.transform.scale >= 0.9 && clip.mask.shape === 'none' && !clip.crop.l && !clip.crop.r && !clip.crop.t && !clip.crop.b ? 'cover' : 'contain');

/** Segnaposto di un progetto: i clip con un file (video, foto, audio), nell'ordine di comparsa. */
export function slotsOf(p) {
  const found = [];
  p.tracks.forEach((t, ti) => t.clips.forEach((c) => { if (['video', 'image', 'audio'].includes(c.kind)) found.push({ c, ti }); }));
  found.sort((a, b) => a.c.start - b.c.start || a.ti - b.ti);
  let n = 0;
  let m = 0;
  return found.map(({ c }) => ({
    id: c.id,
    kind: c.kind,
    label: c.kind === 'audio' ? (++m > 1 ? `Musica ${m}` : 'Musica') : `Clip ${++n}`,
    duration: c.duration,
    fit: c.kind === 'audio' ? 'contain' : fitFor(c),
  }));
}

/** Testi modificabili di un progetto. */
export function textsOf(p) {
  return allClips(p).filter((c) => c.kind === 'text').sort((a, b) => a.start - b.start).map((c) => ({ id: c.id, label: (c.text.content || 'Testo').replace(/\s+/g, ' ').slice(0, 28), content: c.text.content }));
}

/** Trasforma un progetto in modello: toglie i file (restano i segnaposto), conserva tempi, effetti, testi, transizioni. */
export function templateFromProject(project, { id = uid('tpl'), name, category = 'I miei modelli', description = '', builtin = false, now = Date.now() } = {}) {
  const p = clone(project);
  const slots = slotsOf(p);
  const labelOf = new Map(slots.map((s) => [s.id, s.label]));
  for (const c of allClips(p)) {
    if (c.mediaId || labelOf.has(c.id)) {
      c.mediaId = null;
      c.name = labelOf.get(c.id) ?? c.name;
    }
  }
  p.media = {};
  p.name = (name ?? project.name ?? 'Modello').slice(0, 100);
  return {
    format: TEMPLATE_FORMAT,
    id,
    name: p.name,
    category: String(category).slice(0, 40),
    description: String(description).slice(0, 300),
    builtin,
    created: now,
    updated: now,
    aspect: { width: p.settings.width, height: p.settings.height },
    duration: projectDuration(p),
    slots,
    texts: textsOf(p),
    project: p,
  };
}

/** Rende sicuro un modello letto da un file o dall'archivio: ricalcola segnaposto e testi dal progetto. Lancia EditError se non è un modello. */
export function sanitizeTemplate(raw) {
  if (!raw || typeof raw !== 'object' || raw.format !== TEMPLATE_FORMAT) throw new EditError('Non è un modello di Ciak Studio');
  const pr = raw.project;
  if (!pr || typeof pr !== 'object' || !Array.isArray(pr.tracks) || pr.tracks.length > 40) throw new EditError('Il modello è danneggiato');
  const clips = pr.tracks.reduce((n, t) => n + (Array.isArray(t?.clips) ? t.clips.length : 0), 0);
  if (clips > 2000) throw new EditError('Il modello è troppo grande');
  // i clip con file hanno mediaId nullo: la normalizzazione li scarterebbe, quindi si ripara a mano solo la struttura
  const p = clone(pr);
  p.media = {};
  const base = sanitizeProject({ ...p, tracks: [] });
  base.tracks = p.tracks.map((t) => ({
    id: typeof t?.id === 'string' ? t.id : uid('t'),
    type: t?.type === 'audio' ? 'audio' : 'video',
    name: String(t?.name ?? 'Traccia').slice(0, 60),
    muted: !!t?.muted, hidden: !!t?.hidden, locked: false,
    clips: (Array.isArray(t?.clips) ? t.clips : []).map((c) => c).filter((c) => c && typeof c === 'object' && typeof c.id === 'string' && isNum(c.start) && isNum(c.duration) && c.duration > 0 && typeof c.kind === 'string'),
  }));
  const t = {
    format: TEMPLATE_FORMAT,
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 60) : uid('tpl'),
    name: String(raw.name ?? base.name).slice(0, 100) || 'Modello',
    category: String(raw.category ?? 'I miei modelli').slice(0, 40),
    description: String(raw.description ?? '').slice(0, 300),
    builtin: false,
    created: isNum(raw.created) ? raw.created : Date.now(),
    updated: isNum(raw.updated) ? raw.updated : Date.now(),
    project: base,
  };
  // il progetto contiene i clip grezzi: ricostruiscili con valori validi (sanitizeClip scarta quelli senza file, quindi li passiamo con un file finto)
  const fake = {};
  for (const tr of base.tracks) for (const c of tr.clips) if (['video', 'image', 'audio'].includes(c.kind)) fake[c.id] = c.kind;
  const withFake = clone(base);
  withFake.media = {};
  for (const [cid, kind] of Object.entries(fake)) withFake.media[`__${cid}`] = { id: `__${cid}`, name: 'x', kind, mime: '', size: 0, duration: 0, width: 0, height: 0, hasAudio: true };
  for (const tr of withFake.tracks) for (const c of tr.clips) if (fake[c.id]) c.mediaId = `__${c.id}`;
  const clean = sanitizeProject(withFake);
  for (const tr of clean.tracks) for (const c of tr.clips) if (fake[c.id]) c.mediaId = null;
  clean.media = {};
  t.project = clean;
  t.aspect = { width: clean.settings.width, height: clean.settings.height };
  t.duration = projectDuration(clean);
  t.slots = slotsOf(clean);
  t.texts = textsOf(clean);
  return t;
}

export const serializeTemplate = (t) => JSON.stringify({ ...t, builtin: false }, null, 1);
export function parseTemplateFile(text) {
  if (text.length > 4_000_000) throw new EditError('Il file è troppo grande per essere un modello');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new EditError('Il file non è un modello valido');
  }
  return sanitizeTemplate(raw);
}

function checkRecord(slot, rec) {
  if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string' || !['video', 'image', 'audio'].includes(rec.kind)) throw new EditError(`File non valido per «${slot.label}»`);
  if (slot.kind === 'audio' && rec.kind !== 'audio') throw new EditError(`«${slot.label}» vuole un file audio`);
  if (slot.kind !== 'audio' && rec.kind === 'audio') throw new EditError(`«${slot.label}» vuole un video o una foto`);
}

/**
 * Riempie il modello. `fills.media`: {idSegnaposto: record di media} (con `id`, `kind`, `duration`, `width`, `height`…),
 * `fills.texts`: {idTesto: testo}. I segnaposto video/foto non riempiti vengono saltati (il tempo si chiude);
 * quello audio non riempito viene tolto. Se un video è più corto del segnaposto, il segmento si accorcia e tutto il resto
 * (testi, forme, adesivi) segue il suo clip. Restituisce un progetto normale.
 */
export function applyTemplate(template, fills = {}) {
  const p = clone(template.project);
  const media = fills.media ?? {};
  p.name = fills.name ? String(fills.name).slice(0, 100) : template.name;
  p.media = {};
  const slotById = new Map(template.slots.map((s) => [s.id, s]));
  const W = p.settings.width;
  const H = p.settings.height;

  for (const [sid, rec] of Object.entries(media)) {
    const slot = slotById.get(sid);
    if (!slot) throw new EditError('Segnaposto sconosciuto');
    checkRecord(slot, rec);
  }
  for (const c of allClips(p)) if (c.kind === 'text' && typeof fills.texts?.[c.id] === 'string') c.text.content = fills.texts[c.id].slice(0, 2000);

  const where = (id) => findClip(p, id);
  const fitDur = (clip, rec) => (rec.kind === 'video' && isNum(rec.duration) && rec.duration > 0 ? Math.max(MIN, Math.min(clip.duration, rec.duration / (clip.speed || 1))) : clip.duration);
  const visual = template.slots.filter((s) => VISUAL.includes(s.kind)).map((slot) => ({ slot, ...where(slot.id) })).filter((x) => x.clip);
  const audio = template.slots.filter((s) => s.kind === 'audio').map((slot) => ({ slot, ...where(slot.id) })).filter((x) => x.clip);

  // traccia principale = quella con più segnaposto visivi
  const count = new Map();
  for (const x of visual) count.set(x.track.id, (count.get(x.track.id) ?? 0) + 1);
  let mainId = null;
  for (const t of p.tracks) if (count.has(t.id) && (mainId === null || count.get(t.id) > count.get(mainId))) mainId = t.id;
  const main = visual.filter((x) => x.track.id === mainId).sort((a, b) => a.clip.start - b.clip.start);
  const others = visual.filter((x) => x.track.id !== mainId);
  const slotClipIds = new Set([...visual, ...audio].map((x) => x.clip.id));

  const take = (x, rec) => {
    const c = x.clip;
    c.mediaId = rec.id;
    c.name = rec.name ?? c.name;
    c.kind = rec.kind;
    c.in = 0;
    if (rec.kind === 'image') c.speed = 1;
    p.media[rec.id] = { id: rec.id, name: String(rec.name ?? 'media'), kind: rec.kind, mime: String(rec.mime ?? ''), size: isNum(rec.size) ? rec.size : 0, duration: isNum(rec.duration) ? rec.duration : 0, width: isNum(rec.width) ? rec.width : 0, height: isNum(rec.height) ? rec.height : 0, hasAudio: rec.hasAudio !== false };
    if (x.slot.fit === 'cover' && rec.width > 0 && rec.height > 0) {
      const a = W / rec.width;
      const b = H / rec.height;
      const f = Math.max(a, b) / Math.min(a, b);
      c.transform.scale *= f;
      if (c.keyframes?.scale) for (const k of c.keyframes.scale) k.v *= f;
    }
  };

  // --- traccia principale: nuovi tempi in sequenza, conservando sovrapposizioni delle transizioni
  const old = main.map((x) => ({ s: x.clip.start, e: x.clip.start + x.clip.duration }));
  const plan = [];
  let prev = null;
  let lastEnd = old.length ? old[0].s : 0;
  main.forEach((x, i) => {
    const rec = media[x.slot.id];
    // uno sfondo che dura quasi tutto il modello, se non riempito, si toglie senza accorciare il resto
    const ghost = !rec && x.slot.duration >= 0.9 * (template.duration || Infinity);
    if (!rec && !ghost) {
      plan.push({ x, removed: true, col: lastEnd });
      return;
    }
    const dur = rec ? fitDur(x.clip, rec) : x.clip.duration;
    let start;
    if (!prev) start = old[0].s;
    else {
      // con una transizione il clip si sovrappone al precedente (anche se il precedente originale è stato saltato);
      // senza transizione si mantiene l'eventuale pausa del modello
      let gap = x.clip.transition ? -x.clip.transition.duration : main[i - 1] && media[main[i - 1].slot.id] ? Math.max(0, old[i].s - old[i - 1].e) : 0;
      if (gap < -1e-9) {
        const ov = Math.max(0.05, Math.min(-gap, dur * 0.45, prev.dur * 0.45)); // 45%: con tre clip in fila non si sovrappongono mai tutti e tre
        x.clip.transition.duration = ov;
        gap = -ov;
      }
      start = prev.end + gap;
    }
    const entry = { x, rec, start, dur, end: start + dur, removed: false, ghost };
    plan.push(entry);
    prev = entry;
    lastEnd = entry.end;
  });
  const warp = (t) => {
    let j = -1;
    for (let i = 0; i < old.length; i++) if (old[i].s <= t + 1e-9) j = i;
    if (j < 0) return t;
    const a = old[j];
    const pl = plan[j];
    if (pl.removed) return pl.col + Math.max(0, t - a.e);
    if (t <= a.e) return Math.min(pl.start + (t - a.s), pl.end);
    return pl.end + (t - a.e);
  };

  // clip diversi da segnaposto e dalla traccia principale: seguono il loro segmento
  const remove = new Set();
  for (const pl of plan) {
    if (pl.removed || pl.ghost) remove.add(pl.x.clip.id);
    else {
      take(pl.x, pl.rec);
      pl.x.clip.start = pl.start;
      pl.x.clip.duration = pl.dur;
    }
  }
  for (const t of p.tracks) {
    for (const c of t.clips) {
      if (slotClipIds.has(c.id)) continue; // gli altri segnaposto si trattano sotto
      const s = warp(c.start);
      const e = warp(c.start + c.duration);
      if (e - s < MIN - 1e-9) remove.add(c.id);
      else {
        c.start = s;
        c.duration = e - s;
      }
    }
  }
  for (const x of others) {
    const rec = media[x.slot.id];
    if (!rec) {
      remove.add(x.clip.id);
      continue;
    }
    x.clip.start = warp(x.clip.start);
    x.clip.duration = fitDur(x.clip, rec);
    take(x, rec);
  }
  const visualEnd = () => {
    let end = 0;
    for (const t of p.tracks) for (const c of t.clips) if (!remove.has(c.id) && c.kind !== 'audio') end = Math.max(end, c.start + c.duration);
    return end;
  };
  const total = visualEnd();
  for (const x of audio) {
    const rec = media[x.slot.id];
    if (!rec) {
      remove.add(x.clip.id);
      continue;
    }
    const c = x.clip;
    c.start = warp(c.start);
    const left = total - c.start;
    if (left < MIN) {
      remove.add(c.id);
      delete p.media[rec.id];
      continue;
    }
    take(x, rec);
    c.duration = Math.max(MIN, Math.min(rec.duration > 0 ? rec.duration / (c.speed || 1) : c.duration, left));
    if (c.fadeIn + c.fadeOut > c.duration) c.fadeOut = Math.max(0, c.duration - c.fadeIn);
  }
  for (const t of p.tracks) t.clips = t.clips.filter((c) => !remove.has(c.id));

  // niente sovrapposizioni non volute sulle tracce (clip rimasti vicini dopo l'accorciamento)
  for (const t of p.tracks) {
    t.clips.sort((a, b) => a.start - b.start);
    for (let i = 1; i < t.clips.length; i++) {
      const prevC = t.clips[i - 1];
      const c = t.clips[i];
      const allowed = c.transition ? c.transition.duration : 0;
      const prevEnd = prevC.start + prevC.duration;
      if (c.start < prevEnd - allowed - 1e-6) {
        const room = c.start + allowed - prevC.start;
        if (room >= MIN) prevC.duration = room;
        else c.start = prevEnd - allowed;
      }
    }
  }
  // a segmenti tolti una transizione senza clip precedente resta come semplice ingresso: va bene; ma non deve superare la durata
  for (const t of p.tracks) for (const c of t.clips) if (c.transition) c.transition.duration = clamp(c.transition.duration, 0, c.duration);
  for (const c of allClips(p)) {
    for (const side of ['in', 'out']) if (c.anim?.[side]) c.anim[side].duration = clamp(c.anim[side].duration, 0, c.duration);
    for (const k of Object.keys(c.keyframes ?? {})) c.keyframes[k] = c.keyframes[k].filter((kf) => kf.t <= c.duration + 1e-6);
  }
  p.markers = (p.markers ?? []).map((m) => ({ ...m, time: warp(m.time) }));
  return sanitizeProject(p);
}
