import { createProject, createClip, clipFromMedia } from '../../src/core/project.js';
import { addClip, validateProject } from '../../src/core/timeline.js';

export function video(id, duration = 10, extra = {}) {
  return { id, name: `${id}.mp4`, kind: 'video', mime: 'video/mp4', size: 1000, duration, width: 1920, height: 1080, hasAudio: true, ...extra };
}
export function audio(id, duration = 10) {
  return { id, name: `${id}.mp3`, kind: 'audio', mime: 'audio/mpeg', size: 100, duration, width: 0, height: 0, hasAudio: true };
}
export function image(id) {
  return { id, name: `${id}.png`, kind: 'image', mime: 'image/png', size: 100, duration: 0, width: 800, height: 600, hasAudio: false };
}

/** Progetto con tre media e nessun clip. */
export function baseProject({ fps = 30 } = {}) {
  const p = createProject({ fps });
  p.media.v1 = video('v1', 10);
  p.media.v2 = video('v2', 6);
  p.media.a1 = audio('a1', 20);
  p.media.i1 = image('i1');
  return p;
}

export function videoTrackId(p, n = 1) {
  return p.tracks.filter((t) => t.type === 'video')[n - 1].id; // 1 = più in alto
}
export function audioTrackId(p) {
  return p.tracks.find((t) => t.type === 'audio').id;
}

/** Aggiunge un clip video sulla traccia indicata e lo restituisce. */
export function put(p, trackId, mediaId, start, props = {}) {
  const clip = clipFromMedia(p.media[mediaId], { start });
  Object.assign(clip, props);
  return addClip(p, trackId, clip, start);
}

export function mustBeValid(p) {
  const errs = validateProject(p);
  if (errs.length) throw new Error('Progetto non valido: ' + errs.join(' | '));
}
export { createClip };
