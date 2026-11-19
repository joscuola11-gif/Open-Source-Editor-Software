// Disposizioni «schermo diviso» e «immagine nell'immagine»: sistemano più clip video/foto nei riquadri di una griglia.
// Pure: modificano un progetto (da usare dentro un commit dell'editor).

import { EditError, clamp } from './util.js';
import { findClip } from './project.js';
import { addTrack, trackWithRoom } from './timeline.js';

const m = 0.04; // margine dei riquadri piccoli (PiP)
const r = (x, y, w, h) => ({ x, y, w, h });

/** Riquadri in frazioni del canvas: x, y = angolo in alto a sinistra. */
export const LAYOUTS = [
  { id: 'split-2h', label: 'Due affiancati', min: 2, cells: [r(0, 0, 0.5, 1), r(0.5, 0, 0.5, 1)] },
  { id: 'split-2v', label: 'Due uno sopra l’altro', min: 2, cells: [r(0, 0, 1, 0.5), r(0, 0.5, 1, 0.5)] },
  { id: 'split-3h', label: 'Tre colonne', min: 3, cells: [r(0, 0, 1 / 3, 1), r(1 / 3, 0, 1 / 3, 1), r(2 / 3, 0, 1 / 3, 1)] },
  { id: 'split-3v', label: 'Tre righe', min: 3, cells: [r(0, 0, 1, 1 / 3), r(0, 1 / 3, 1, 1 / 3), r(0, 2 / 3, 1, 1 / 3)] },
  { id: 'big-left', label: 'Uno grande + due', min: 3, cells: [r(0, 0, 0.62, 1), r(0.62, 0, 0.38, 0.5), r(0.62, 0.5, 0.38, 0.5)] },
  { id: 'big-top', label: 'Uno sopra + due sotto', min: 3, cells: [r(0, 0, 1, 0.6), r(0, 0.6, 0.5, 0.4), r(0.5, 0.6, 0.5, 0.4)] },
  { id: 'grid-4', label: 'Griglia 2×2', min: 4, cells: [r(0, 0, 0.5, 0.5), r(0.5, 0, 0.5, 0.5), r(0, 0.5, 0.5, 0.5), r(0.5, 0.5, 0.5, 0.5)] },
  { id: 'pip-br', label: 'Piccolo in basso a destra', min: 2, cells: [r(0, 0, 1, 1), r(1 - 0.32 - m, 1 - 0.32 - m, 0.32, 0.32)], pip: true },
  { id: 'pip-bl', label: 'Piccolo in basso a sinistra', min: 2, cells: [r(0, 0, 1, 1), r(m, 1 - 0.32 - m, 0.32, 0.32)], pip: true },
  { id: 'pip-tr', label: 'Piccolo in alto a destra', min: 2, cells: [r(0, 0, 1, 1), r(1 - 0.32 - m, m, 0.32, 0.32)], pip: true },
  { id: 'pip-tl', label: 'Piccolo in alto a sinistra', min: 2, cells: [r(0, 0, 1, 1), r(m, m, 0.32, 0.32)], pip: true },
];

export const layoutById = (id) => LAYOUTS.find((l) => l.id === id) ?? null;

/** Trasformazione (posizione, scala, ritaglio) che porta un clip di dimensioni w×h a stare nel riquadro `cell`. */
export function placeInCell({ canvasW, canvasH, mediaW, mediaH, cell, fill = 'cover', gap = 0 }) {
  const fit = Math.min(canvasW / mediaW, canvasH / mediaH);
  const fw = mediaW * fit;
  const fh = mediaH * fit;
  const cw = Math.max(1, cell.w * canvasW - 2 * gap);
  const ch = Math.max(1, cell.h * canvasH - 2 * gap);
  const s = fill === 'cover' ? Math.max(cw / fw, ch / fh) : Math.min(cw / fw, ch / fh);
  const vx = clamp(cw / (fw * s), 0, 1);
  const vy = clamp(ch / (fh * s), 0, 1);
  return {
    x: cell.x + cell.w / 2 - 0.5,
    y: cell.y + cell.h / 2 - 0.5,
    scale: clamp(s, 0.05, 20),
    crop: { l: (1 - vx) / 2, r: (1 - vx) / 2, t: (1 - vy) / 2, b: (1 - vy) / 2 },
  };
}

/**
 * Applica una disposizione ai clip indicati (nell'ordine dato: il primo va nel primo riquadro, ecc.).
 * Con `stack` i clip che non si sovrappongono nel tempo vengono portati a iniziare insieme sul primo, ognuno su una traccia diversa.
 * @returns {number} quanti clip sono stati sistemati
 */
export function layoutClips(p, ids, layoutId, { fill = 'cover', stack = true, gap = 0 } = {}) {
  const lay = layoutById(layoutId);
  if (!lay) throw new EditError('Disposizione sconosciuta');
  const found = ids.map((id) => findClip(p, id)).filter((f) => f && (f.clip.kind === 'video' || f.clip.kind === 'image'));
  if (found.length < lay.min) throw new EditError(`Questa disposizione ha bisogno di almeno ${lay.min} clip selezionati`);
  const used = found.slice(0, lay.cells.length);
  const { width: W, height: H } = p.settings;

  if (stack) {
    const overlap = (a, b) => a.start < b.start + b.duration - 1e-6 && b.start < a.start + a.duration - 1e-6;
    const base = used[0].clip;
    for (const f of used.slice(1)) {
      if (used.every((o) => o === f || overlap(o.clip, f.clip))) continue; // già insieme a tutti gli altri
      const c = f.clip;
      f.track.clips = f.track.clips.filter((q) => q.id !== c.id);
      c.start = base.start;
      const tr = trackWithRoom(p, 'video', c.start, c.duration, { fromTop: true }) ?? addTrack(p, 'video');
      c.start = Math.max(0, c.start);
      tr.clips.push(c);
      tr.clips.sort((a, b) => a.start - b.start);
    }
  }

  if (lay.pip) {
    // il riquadro grande deve stare SOTTO i piccoli: se la sua traccia è più in alto, passa su una nuova traccia sotto
    const trackIndex = (id) => p.tracks.indexOf(findClip(p, id).track);
    const lowestSmall = Math.max(...used.slice(1).map((f) => trackIndex(f.clip.id)));
    if (trackIndex(used[0].clip.id) < lowestSmall) {
      const big = findClip(p, used[0].clip.id);
      big.track.clips = big.track.clips.filter((q) => q.id !== big.clip.id);
      const nt = addTrack(p, 'video', { index: lowestSmall + 1 });
      nt.clips.push(big.clip);
    }
  }

  used.forEach((f, i) => {
    const c = f.clip;
    const media = p.media[c.mediaId];
    const mediaW = media?.width || 16;
    const mediaH = media?.height || 9;
    const pl = placeInCell({ canvasW: W, canvasH: H, mediaW, mediaH, cell: lay.cells[i], fill, gap });
    c.transform.x = pl.x;
    c.transform.y = pl.y;
    c.transform.scale = pl.scale;
    c.transform.rotation = 0;
    c.crop = pl.crop;
    for (const k of ['x', 'y', 'scale', 'rotation']) delete c.keyframes[k];
  });
  return used.length;
}
