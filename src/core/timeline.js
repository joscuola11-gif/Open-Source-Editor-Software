// Operazioni di montaggio sul modello di progetto.
//
// Tutte le funzioni di modifica lavorano IN PLACE su una bozza (draft) del progetto e lanciano
// EditError se l'operazione è impossibile: lo Store scarta la bozza, quindi il progetto non
// resta mai in uno stato intermedio. `validateProject` è l'unica fonte di verità sugli invarianti.
//
// Invarianti di una traccia (clip ordinati per `start`):
//  1. due clip consecutivi possono sovrapporsi solo se il secondo ha una transizione e la
//     sovrapposizione non supera la durata della transizione;
//  2. un clip non può sovrapporsi contemporaneamente a due clip (clip[i-2] finisce prima di clip[i]).

import { EditError, TOL, clamp, isNum, uid } from './util.js';
import {
  allClips,
  clipFromMedia,
  createClip,
  createTrack,
  findClip,
  getTrack,
  isTimedKind,
  isVisualKind,
  maxSourceSpan,
  projectDuration,
  sanitizeProject,
  trackTypeFor,
} from './project.js';
import { MAX_SPEED, MIN_SPEED } from './presets.js';
import { scaleKeyframeTimes, shiftKeyframeTimes, splitKeyframes } from './keyframes.js';

export { allClips, findClip, getTrack, projectDuration };

export const minDur = (p) => 1 / p.settings.fps;
export const clipEnd = (c) => c.start + c.duration;
const byStart = (a, b) => a.start - b.start;
export const sortTrack = (track) => track.clips.sort(byStart);

// ---------------------------------------------------------------------------
// Validazione
// ---------------------------------------------------------------------------

export function trackProblems(track) {
  const out = [];
  const cs = track.clips;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (i > 0) {
      const a = cs[i - 1];
      if (c.start < a.start - TOL) out.push(`${track.name}: clip non ordinati (${a.id}, ${c.id})`);
      const ov = clipEnd(a) - c.start;
      if (ov > TOL) {
        const allowed = c.transition ? c.transition.duration : 0;
        if (ov > allowed + TOL) out.push(`${track.name}: sovrapposizione di ${ov.toFixed(3)}s tra ${a.id} e ${c.id}`);
      }
    }
    if (i > 1 && clipEnd(cs[i - 2]) > c.start + TOL) out.push(`${track.name}: tre clip sovrapposti (${cs[i - 2].id}, ${cs[i - 1].id}, ${c.id})`);
  }
  return out;
}

/** Restituisce l'elenco degli errori (vuoto = progetto valido). */
export function validateProject(p) {
  const errs = [];
  if (!p || typeof p !== 'object') return ['progetto assente'];
  const s = p.settings;
  if (!s || !(s.width > 0) || !(s.height > 0) || !(s.fps > 0)) errs.push('impostazioni non valide');
  if (!Array.isArray(p.tracks)) return [...errs, 'tracce assenti'];
  const clipIds = new Set();
  const trackIds = new Set();
  for (const track of p.tracks) {
    if (trackIds.has(track.id)) errs.push(`traccia duplicata ${track.id}`);
    trackIds.add(track.id);
    if (track.type !== 'video' && track.type !== 'audio') errs.push(`tipo traccia non valido ${track.type}`);
    for (const c of track.clips) {
      const where = `${track.name}/${c.id}`;
      if (clipIds.has(c.id)) errs.push(`clip duplicato ${c.id}`);
      clipIds.add(c.id);
      if (trackTypeFor(c.kind) !== track.type) errs.push(`${where}: tipo clip ${c.kind} su traccia ${track.type}`);
      if (!isNum(c.start) || c.start < -TOL) errs.push(`${where}: start non valido (${c.start})`);
      if (!isNum(c.duration) || c.duration <= 1e-3) errs.push(`${where}: durata non valida (${c.duration})`);
      if (!isNum(c.in) || c.in < -TOL) errs.push(`${where}: in non valido (${c.in})`);
      if (!isNum(c.speed) || c.speed < MIN_SPEED - 1e-9 || c.speed > MAX_SPEED + 1e-9) errs.push(`${where}: velocità non valida (${c.speed})`);
      if (!isNum(c.volume) || c.volume < 0) errs.push(`${where}: volume non valido`);
      if (!(c.fadeIn >= 0) || !(c.fadeOut >= 0) || c.fadeIn + c.fadeOut > c.duration + 1e-3) errs.push(`${where}: dissolvenze non valide`);
      if (c.mediaId) {
        const m = p.media[c.mediaId];
        if (!m) errs.push(`${where}: media ${c.mediaId} mancante`);
        else if (isTimedKind(c.kind) && c.duration * c.speed > maxSourceSpan(p, c) + 1e-3) errs.push(`${where}: oltre la fine del file sorgente`);
      } else if (c.kind === 'video' || c.kind === 'image' || c.kind === 'audio') errs.push(`${where}: manca mediaId`);
      if (c.transition && !(c.transition.duration > 0 && c.transition.duration <= c.duration + TOL)) errs.push(`${where}: durata transizione non valida`);
      for (const [prop, kfs] of Object.entries(c.keyframes ?? {})) {
        for (let i = 0; i < kfs.length; i++) {
          if (!isNum(kfs[i].t) || !isNum(kfs[i].v)) errs.push(`${where}: keyframe ${prop} non numerico`);
          if (i > 0 && kfs[i].t < kfs[i - 1].t) errs.push(`${where}: keyframe ${prop} non ordinati`);
        }
      }
    }
    errs.push(...trackProblems(track));
  }
  for (const m of p.markers ?? []) if (!isNum(m.time) || m.time < 0) errs.push(`marcatore non valido ${m.id}`);
  return errs;
}

function assertTrackValid(track) {
  const pr = trackProblems(track);
  if (pr.length) throw new EditError(`Operazione non consentita: ${pr[0]}`);
}

/**
 * Ripara una traccia spostando a destra i clip che violano gli invarianti
 * (usato dopo ripple e al caricamento di file non perfetti).
 */
export function repairTrack(track) {
  sortTrack(track);
  const cs = track.clips;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    let min = 0;
    if (i > 0) {
      const a = cs[i - 1];
      const allowed = c.transition ? Math.min(c.transition.duration, a.duration) : 0;
      min = Math.max(min, clipEnd(a) - allowed);
      min = Math.max(min, a.start);
    }
    if (i > 1) min = Math.max(min, clipEnd(cs[i - 2]));
    if (c.start < min - TOL) c.start = min;
  }
}

/** Sanifica un progetto grezzo (file/IndexedDB) e ripara le tracce. */
export function normalizeProject(raw) {
  const p = sanitizeProject(raw);
  for (const t of p.tracks) repairTrack(t);
  return p;
}

// ---------------------------------------------------------------------------
// Tracce
// ---------------------------------------------------------------------------

function requireTrack(p, id) {
  const t = getTrack(p, id);
  if (!t) throw new EditError('Traccia non trovata');
  return t;
}
function requireUnlocked(track) {
  if (track.locked) throw new EditError(`La traccia «${track.name}» è bloccata`);
}

export function addTrack(p, type, { index, name } = {}) {
  const n = p.tracks.filter((t) => t.type === type).length + 1;
  const track = createTrack(type, name ?? `${type === 'audio' ? 'Audio' : 'Video'} ${n}`);
  if (index === undefined) {
    if (type === 'video') p.tracks.unshift(track);
    else p.tracks.push(track);
  } else p.tracks.splice(clamp(index, 0, p.tracks.length), 0, track);
  return track;
}

export function removeTrack(p, id) {
  const t = requireTrack(p, id);
  requireUnlocked(t);
  p.tracks = p.tracks.filter((x) => x.id !== id);
}

/** Sposta una traccia su/giù scambiandola con la vicina dello stesso tipo. */
export function moveTrack(p, id, dir) {
  const i = p.tracks.findIndex((t) => t.id === id);
  if (i < 0) throw new EditError('Traccia non trovata');
  const j = i + (dir < 0 ? -1 : 1);
  if (j < 0 || j >= p.tracks.length || p.tracks[j].type !== p.tracks[i].type) return false;
  [p.tracks[i], p.tracks[j]] = [p.tracks[j], p.tracks[i]];
  return true;
}

// ---------------------------------------------------------------------------
// Posizionamento
// ---------------------------------------------------------------------------

/**
 * Inizio libero più vicino a `desired` per un clip lungo `duration` sulla traccia.
 * `ignore` = insieme di id da ignorare (clip che si stanno spostando).
 */
export function findFreeStart(track, desired, duration, ignore) {
  const clips = track.clips.filter((c) => !ignore?.has(c.id)).sort(byStart);
  let best = Infinity;
  let bestDist = Infinity;
  const consider = (g0, g1) => {
    if (g1 - g0 < duration - TOL) return;
    const s = clamp(desired, g0, g1 - duration);
    const d = Math.abs(s - desired);
    if (d < bestDist - 1e-12) {
      bestDist = d;
      best = s;
    }
  };
  let cursor = 0;
  for (const c of clips) {
    consider(cursor, c.start);
    cursor = Math.max(cursor, clipEnd(c));
  }
  consider(cursor, Infinity);
  return Math.max(0, best);
}

/** Aggiunge un clip alla traccia nel punto libero più vicino a `desiredStart`. */
export function addClip(p, trackId, clip, desiredStart = clip.start) {
  const track = requireTrack(p, trackId);
  requireUnlocked(track);
  if (trackTypeFor(clip.kind) !== track.type) throw new EditError(`Un clip ${clip.kind} non può stare su una traccia ${track.type}`);
  clip.start = findFreeStart(track, Math.max(0, desiredStart), clip.duration);
  track.clips.push(clip);
  sortTrack(track);
  assertTrackValid(track);
  return clip;
}

/** Prima traccia sbloccata del tipo giusto con spazio libero in [start, start+duration]; altrimenti ne crea una. */
export function trackWithRoom(p, type, start, duration, { preferId } = {}) {
  const fits = (t) => !t.locked && t.type === type && t.clips.every((c) => clipEnd(c) <= start + TOL || c.start >= start + duration - TOL);
  const pref = preferId ? getTrack(p, preferId) : null;
  if (pref && fits(pref)) return pref;
  // tracce visive: scorre dal basso verso l'alto (la principale è quella più in basso fra le visive)
  const candidates = p.tracks.filter((t) => t.type === type);
  const ordered = type === 'video' ? [...candidates].reverse() : candidates;
  return ordered.find(fits) ?? addTrack(p, type);
}

/** Importa un file nel progetto sul posto giusto (crea il clip). */
export function addMediaClip(p, media, { start = 0, trackId } = {}) {
  const clip = clipFromMedia(media, { start });
  const type = trackTypeFor(clip.kind);
  const track = trackWithRoom(p, type, start, clip.duration, { preferId: trackId });
  return addClip(p, track.id, clip, start);
}

// ---------------------------------------------------------------------------
// Spostamento (anche multiplo e fra tracce)
// ---------------------------------------------------------------------------

function layoutAfterMove(p, idSet, delta, offset) {
  const moved = [];
  for (let i = 0; i < p.tracks.length; i++) {
    const src = p.tracks[i];
    for (const c of src.clips) {
      if (!idSet.has(c.id)) continue;
      const dst = i + offset;
      if (dst < 0 || dst >= p.tracks.length) return null;
      const dt = p.tracks[dst];
      if (dt.type !== src.type || dt.locked || src.locked) return null;
      const s = c.start + delta;
      if (s < -TOL) return null;
      moved.push({ dst, clip: { ...c, start: Math.max(0, s) } });
    }
  }
  const result = new Map();
  for (const di of new Set(moved.map((m) => m.dst))) {
    const list = p.tracks[di].clips.filter((c) => !idSet.has(c.id));
    for (const m of moved) if (m.dst === di) list.push(m.clip);
    list.sort(byStart);
    result.set(di, list);
  }
  return result;
}

function moveFeasible(p, idSet, delta, offset) {
  const layout = layoutAfterMove(p, idSet, delta, offset);
  if (!layout) return false;
  for (const [di, list] of layout) if (trackProblems({ name: p.tracks[di].name, clips: list }).length) return false;
  return true;
}

function candidateDeltas(p, idSet, desired, offset) {
  const set = new Set([desired]);
  if (offset === 0) set.add(0);
  const moving = [];
  for (let i = 0; i < p.tracks.length; i++) for (const c of p.tracks[i].clips) if (idSet.has(c.id)) moving.push({ c, i });
  let minStart = Infinity;
  for (const { c } of moving) minStart = Math.min(minStart, c.start);
  if (isFinite(minStart)) set.add(-minStart);
  let work = 0;
  for (const { i } of moving) work += p.tracks[i + offset]?.clips.length ?? 0;
  if (work <= 20000) {
    for (const { c, i } of moving) {
      const dt = p.tracks[i + offset];
      if (!dt) continue;
      for (const n of dt.clips) {
        if (idSet.has(n.id)) continue;
        set.add(clipEnd(n) - c.start);
        set.add(n.start - clipEnd(c));
      }
    }
  }
  return [...set].filter(isNum).sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired));
}

/**
 * Trova lo spostamento valido più vicino a quello desiderato.
 * Restituisce {delta, offset} oppure null se non è possibile alcun posizionamento.
 */
export function planMove(p, ids, desiredDelta, desiredOffset = 0) {
  const idSet = new Set(ids);
  const offsets = desiredOffset === 0 ? [0] : [desiredOffset, 0];
  for (const off of offsets) {
    for (const d of candidateDeltas(p, idSet, desiredDelta, off)) if (moveFeasible(p, idSet, d, off)) return { delta: d, offset: off };
  }
  return null;
}

/** Sposta i clip di `delta` secondi e di `offset` tracce. Lancia se il risultato non è valido. */
export function moveClips(p, ids, delta, offset = 0) {
  const idSet = new Set(ids);
  if (!moveFeasible(p, idSet, delta, offset)) throw new EditError('Spostamento non valido: si sovrapporrebbe ad altri clip');
  const moved = [];
  for (let i = 0; i < p.tracks.length; i++) {
    const src = p.tracks[i];
    const keep = [];
    for (const c of src.clips) {
      if (idSet.has(c.id)) moved.push({ c, dst: i + offset });
      else keep.push(c);
    }
    src.clips = keep;
  }
  for (const { c, dst } of moved) {
    c.start = Math.max(0, c.start + delta);
    p.tracks[dst].clips.push(c);
  }
  for (const t of p.tracks) sortTrack(t);
  for (const t of p.tracks) assertTrackValid(t);
}

// ---------------------------------------------------------------------------
// Ritaglio (trim)
// ---------------------------------------------------------------------------

function requireClip(p, id) {
  const f = findClip(p, id);
  if (!f) throw new EditError('Clip non trovato');
  return f;
}

/** Limiti validi {min, max} per il bordo `side` ('start' | 'end') del clip, in tempo di timeline. */
export function trimBounds(p, id, side) {
  const { track, clip, index } = requireClip(p, id);
  const cs = track.clips;
  const md = minDur(p);
  const prev = cs[index - 1] ?? null;
  const next = cs[index + 1] ?? null;
  if (side === 'end') {
    const ovPrev = prev ? Math.max(0, clipEnd(prev) - clip.start) : 0;
    let max = Infinity;
    const span = maxSourceSpan(p, clip);
    if (isFinite(span)) max = clip.start + span / clip.speed;
    if (next) max = Math.min(max, next.start + (next.transition?.duration ?? 0));
    if (cs[index + 2]) max = Math.min(max, cs[index + 2].start);
    return { min: clip.start + Math.max(md, ovPrev), max };
  }
  let min = 0;
  if (prev) min = Math.max(min, clipEnd(prev) - (clip.transition?.duration ?? 0), prev.start);
  if (cs[index - 2]) min = Math.max(min, clipEnd(cs[index - 2]));
  if (isTimedKind(clip.kind)) min = Math.max(min, clip.start - clip.in / clip.speed);
  // il bordo sinistro non può superare l'inizio del clip successivo (invertirebbe l'ordine nella traccia)
  return { min, max: Math.min(clipEnd(clip) - md, next ? next.start : Infinity) };
}

/** Sposta un bordo del clip rispettando sorgente e vicini. Restituisce il bordo applicato. */
export function trimClip(p, id, side, edge) {
  const { track, clip } = requireClip(p, id);
  requireUnlocked(track);
  if (!isNum(edge)) throw new EditError('Valore non valido');
  const { min, max } = trimBounds(p, id, side);
  if (max < min - TOL) return side === 'end' ? clipEnd(clip) : clip.start;
  const e = clamp(edge, min, max);
  if (side === 'end') {
    clip.duration = e - clip.start;
  } else {
    const delta = e - clip.start;
    const end = clipEnd(clip);
    if (isTimedKind(clip.kind)) clip.in = Math.max(0, clip.in + delta * clip.speed);
    clip.start = e;
    clip.duration = end - e;
    shiftKeyframeTimes(clip, -delta);
  }
  clampClipDurations(p, track, clip);
  sortTrack(track);
  assertTrackValid(track);
  return e;
}

/** Riporta dissolvenze, animazioni e transizione entro la nuova durata del clip. */
function clampClipDurations(p, track, clip) {
  const d = clip.duration;
  if (clip.fadeIn + clip.fadeOut > d) {
    const k = d / (clip.fadeIn + clip.fadeOut);
    clip.fadeIn *= k;
    clip.fadeOut *= k;
  }
  for (const side of ['in', 'out']) if (clip.anim?.[side]) clip.anim[side].duration = Math.min(clip.anim[side].duration, d);
  if (clip.transition) {
    const idx = track.clips.indexOf(clip);
    const prev = track.clips[idx - 1];
    const ovPrev = prev ? Math.max(0, clipEnd(prev) - clip.start) : 0;
    clip.transition.duration = clamp(clip.transition.duration, Math.min(ovPrev > 0 ? ovPrev : 0.05, d), d);
  }
}

// ---------------------------------------------------------------------------
// Taglio, eliminazione, duplicazione
// ---------------------------------------------------------------------------

export function splitClip(p, id, t) {
  const { track, clip } = requireClip(p, id);
  requireUnlocked(track);
  const md = minDur(p);
  const local = t - clip.start;
  if (local < md - TOL || local > clip.duration - md + TOL) throw new EditError('Il punto di taglio è troppo vicino al bordo del clip');
  const idx = track.clips.indexOf(clip);
  const prev = track.clips[idx - 1];
  const ovPrev = prev ? Math.max(0, clipEnd(prev) - clip.start) : 0;
  if (local < ovPrev - TOL) throw new EditError('Non puoi dividere dentro una transizione');

  const right = structuredClone(clip);
  right.id = uid('c');
  const { left: lk, right: rk } = splitKeyframes(clip, local);
  const oldDuration = clip.duration;
  clip.duration = local;
  clip.keyframes = lk;
  right.keyframes = rk;
  right.start = clip.start + local;
  right.duration = oldDuration - local;
  if (isTimedKind(clip.kind)) right.in = clip.in + local * clip.speed;
  right.transition = null;
  clip.fadeOut = 0;
  right.fadeIn = 0;
  if (clip.anim) clip.anim.out = null;
  if (right.anim) right.anim.in = null;
  clampClipDurations(p, track, clip);
  clampClipDurations(p, track, right);
  track.clips.splice(idx + 1, 0, right);
  sortTrack(track);
  assertTrackValid(track);
  return right;
}

export function deleteClips(p, ids) {
  const idSet = new Set(ids);
  let n = 0;
  for (const track of p.tracks) {
    if (!track.clips.some((c) => idSet.has(c.id))) continue;
    requireUnlocked(track);
    const before = track.clips.length;
    track.clips = track.clips.filter((c) => !idSet.has(c.id));
    n += before - track.clips.length;
  }
  return n;
}

/** Elimina i clip e chiude il buco spostando a sinistra i clip successivi della stessa traccia. */
export function rippleDelete(p, ids) {
  const idSet = new Set(ids);
  let n = 0;
  for (const track of p.tracks) {
    const doomed = track.clips.filter((c) => idSet.has(c.id)).sort((a, b) => b.start - a.start);
    if (!doomed.length) continue;
    requireUnlocked(track);
    for (const b of doomed) {
      const i = track.clips.indexOf(b);
      const prev = track.clips[i - 1];
      const ovPrev = prev ? Math.max(0, clipEnd(prev) - b.start) : 0;
      const delta = Math.max(0, b.duration - ovPrev);
      track.clips.splice(i, 1);
      for (let k = i; k < track.clips.length; k++) track.clips[k].start = Math.max(0, track.clips[k].start - delta);
      n++;
    }
    repairTrack(track);
  }
  return n;
}

export function duplicateClips(p, ids) {
  const created = [];
  const list = ids.map((id) => requireClip(p, id)).sort((a, b) => a.clip.start - b.clip.start);
  for (const { track, clip } of list) {
    requireUnlocked(track);
    const copy = structuredClone(clip);
    copy.id = uid('c');
    copy.transition = null;
    copy.start = findFreeStart(track, clipEnd(clip), copy.duration);
    track.clips.push(copy);
    sortTrack(track);
    created.push(copy.id);
  }
  for (const t of p.tracks) assertTrackValid(t);
  return created;
}

// ---------------------------------------------------------------------------
// Appunti (copia/incolla)
// ---------------------------------------------------------------------------

export function copyClips(p, ids) {
  const items = ids.map((id) => requireClip(p, id));
  if (!items.length) return null;
  const minStart = Math.min(...items.map((i) => i.clip.start));
  return {
    items: items.map(({ track, clip }) => ({ trackId: track.id, trackType: track.type, offset: clip.start - minStart, clip: structuredClone(clip) })),
  };
}

export function pasteClips(p, clipboard, at) {
  const ids = [];
  for (const item of clipboard?.items ?? []) {
    const clip = structuredClone(item.clip);
    if (clip.mediaId && !p.media[clip.mediaId]) continue;
    clip.id = uid('c');
    clip.transition = null;
    const start = Math.max(0, at + item.offset);
    const track = trackWithRoom(p, item.trackType, start, clip.duration, { preferId: item.trackId });
    clip.start = findFreeStart(track, start, clip.duration);
    track.clips.push(clip);
    sortTrack(track);
    ids.push(clip.id);
  }
  for (const t of p.tracks) assertTrackValid(t);
  return ids;
}

// ---------------------------------------------------------------------------
// Velocità, transizioni, inserimento con ripple
// ---------------------------------------------------------------------------

export function setSpeed(p, id, speed) {
  const { track, clip, index } = requireClip(p, id);
  requireUnlocked(track);
  if (!isTimedKind(clip.kind)) throw new EditError('La velocità si applica solo a video e audio');
  if (!isNum(speed)) throw new EditError('Velocità non valida');
  const prev = track.clips[index - 1];
  const ovPrev = prev ? Math.max(0, clipEnd(prev) - clip.start) : 0;
  const span = clip.duration * clip.speed;
  const minDuration = Math.max(minDur(p), ovPrev);
  const maxAllowed = Math.min(MAX_SPEED, span / minDuration);
  if (maxAllowed < MIN_SPEED) throw new EditError('Velocità non modificabile: il clip è troppo corto per la transizione');
  const newSpeed = clamp(speed, MIN_SPEED, maxAllowed);
  const newDuration = span / newSpeed;
  const delta = newDuration - clip.duration;
  scaleKeyframeTimes(clip, newDuration / clip.duration);
  clip.speed = newSpeed;
  clip.duration = newDuration;
  if (delta > 0) for (let k = index + 1; k < track.clips.length; k++) track.clips[k].start += delta;
  clampClipDurations(p, track, clip);
  assertTrackValid(track);
  return newSpeed;
}

function shiftFrom(track, index, delta) {
  for (let k = index; k < track.clips.length; k++) track.clips[k].start += delta;
}

/**
 * Imposta (o rimuove, se `spec` è null) la transizione di ingresso di un clip.
 * Se il clip precedente è adiacente la transizione diventa una vera sovrapposizione (cross-dissolve):
 * il clip e quelli successivi della traccia si spostano a sinistra della durata della transizione.
 */
export function setTransition(p, clipId, spec) {
  const { track, clip, index } = requireClip(p, clipId);
  requireUnlocked(track);
  if (!isVisualKind(clip.kind)) throw new EditError('Le transizioni valgono solo per i clip visivi');
  const cs = track.clips;
  const prev = cs[index - 1] ?? null;
  const prev2 = cs[index - 2] ?? null;
  const next = cs[index + 1] ?? null;
  const ovPrev = prev ? Math.max(0, clipEnd(prev) - clip.start) : 0;
  const ovNext = next ? Math.max(0, clipEnd(clip) - next.start) : 0;

  if (!spec || !(spec.duration > 0)) {
    clip.transition = null;
    shiftFrom(track, index, ovPrev);
    assertTrackValid(track);
    return null;
  }
  const adjacent = !!prev && (ovPrev > 0 || Math.abs(clip.start - clipEnd(prev)) <= TOL);
  let d = Math.min(spec.duration, clip.duration - ovNext);
  // lascia almeno un fotogramma del clip precedente scoperto: niente clip con lo stesso inizio
  if (adjacent) d = Math.min(d, prev.duration - minDur(p) - (prev2 ? Math.max(0, clipEnd(prev2) - prev.start) : 0));
  if (!(d >= 0.05)) throw new EditError('Spazio insufficiente per la transizione');
  const desiredOverlap = adjacent ? d : 0;
  shiftFrom(track, index, ovPrev - desiredOverlap);
  clip.transition = { type: spec.type, duration: d };
  assertTrackValid(track);
  return clip.transition;
}

/** Inserisce un clip alla posizione `at` spostando a destra tutto ciò che segue sulla stessa traccia. */
export function insertRipple(p, trackId, clip, at) {
  const track = requireTrack(p, trackId);
  requireUnlocked(track);
  for (const c of track.clips) if (c.start >= at - TOL) c.start += clip.duration;
  clip.start = at;
  track.clips.push(clip);
  sortTrack(track);
  assertTrackValid(track);
  return clip;
}

/**
 * Fotogramma fisso: divide il clip a `t` e inserisce un'immagine (già registrata come media)
 * di durata `hold` fra le due metà, spostando il resto della traccia.
 */
export function insertFreezeFrame(p, clipId, t, imageMediaId, hold = 2) {
  const { track, clip } = requireClip(p, clipId);
  requireUnlocked(track);
  const md = minDur(p);
  const local = t - clip.start;
  let right = null;
  if (local > md - TOL && local < clip.duration - md + TOL) right = splitClip(p, clipId, t);
  const insertAt = right ? right.start : local <= md ? clip.start : clipEnd(clip);
  const freeze = createClip('image', {
    mediaId: imageMediaId,
    name: 'Fotogramma fisso',
    duration: hold,
    transform: structuredClone(clip.transform),
    crop: structuredClone(clip.crop),
    filter: structuredClone(clip.filter),
    adjust: structuredClone(clip.adjust),
  });
  insertRipple(p, track.id, freeze, insertAt);
  return freeze;
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

/** Punti di aggancio ordinati e senza duplicati. */
export function snapPoints(p, { exclude, playhead } = {}) {
  const pts = [0];
  if (isNum(playhead)) pts.push(playhead);
  for (const m of p.markers ?? []) pts.push(m.time);
  for (const t of p.tracks)
    for (const c of t.clips) {
      if (exclude?.has(c.id)) continue;
      pts.push(c.start, clipEnd(c));
    }
  pts.sort((a, b) => a - b);
  const out = [];
  for (const v of pts) if (!out.length || v - out[out.length - 1] > 1e-6) out.push(v);
  return out;
}

/** Aggancia `t` al punto più vicino entro `threshold` secondi. */
export function snapValue(points, t, threshold) {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  let best = null;
  for (const i of [lo - 1, lo]) {
    if (i < 0 || i >= points.length) continue;
    const d = Math.abs(points[i] - t);
    if (d <= threshold && (best === null || d < best.d)) best = { d, v: points[i] };
  }
  return best ? { time: best.v, snapped: true } : { time: t, snapped: false };
}

// ---------------------------------------------------------------------------
// Marcatori
// ---------------------------------------------------------------------------

export function addMarker(p, time, label = '') {
  const m = { id: uid('m'), time: Math.max(0, time), label };
  p.markers.push(m);
  p.markers.sort((a, b) => a.time - b.time);
  return m;
}
export function removeMarker(p, id) {
  p.markers = p.markers.filter((m) => m.id !== id);
}

// ---------------------------------------------------------------------------
// Interrogazioni
// ---------------------------------------------------------------------------

const ACTIVE_EPS = 1e-6;
export const isActiveAt = (c, t) => t >= c.start - ACTIVE_EPS && t < clipEnd(c) - ACTIVE_EPS;

/** Clip attivi al tempo t: per ogni traccia nell'ordine della lista. */
export function clipsAt(p, t, filter) {
  const out = [];
  for (const track of p.tracks) for (const c of track.clips) if (isActiveAt(c, t) && (!filter || filter(c, track))) out.push({ clip: c, track });
  return out;
}

/** Rimuove dal progetto un media e tutti i clip che lo usano. Restituisce il numero di clip rimossi. */
export function removeMedia(p, mediaId) {
  let n = 0;
  for (const t of p.tracks) {
    const before = t.clips.length;
    t.clips = t.clips.filter((c) => c.mediaId !== mediaId);
    n += before - t.clips.length;
  }
  delete p.media[mediaId];
  return n;
}
