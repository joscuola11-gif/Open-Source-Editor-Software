// Finestra «Momenti migliori»: trova i tratti più vivaci (movimento e volume) di un video, per riassunti e clip brevi.

import { loudnessSeries, pickHighlights } from '../core/highlights.js';
import { motionSeries } from '../core/scenes.js';
import { clipEnd, keepOnly, addMarker } from '../core/timeline.js';
import { findClip } from '../core/project.js';
import { formatDuration } from '../core/util.js';
import { loadAudio } from '../engine/audio-source.js';
import { sampleVideoFrames } from '../engine/video-analysis.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { openDialog, toast } from './overlays.js';

const FPS = 2;

export function openHighlightsDialog(app) {
  const a = app.actions;
  const clip = app.selection.ids.map((id) => findClip(app.store.project, id)?.clip).find((c) => c && c.kind === 'video');
  if (!clip) {
    toast('Seleziona prima un clip video da analizzare.', { type: 'warn' });
    return null;
  }
  const clipId = clip.id;
  const state = { length: Math.min(15, Math.max(5, Math.round(clip.duration / 4))), count: 3, items: [], running: false, signal: null };
  const num = (id, label, min, max, value, on) => {
    const el = h('input', { type: 'number', id, class: 'num', min, max, step: 1, value });
    el.addEventListener('input', () => on(Number(el.value)));
    return h('label', { class: 'cap-field' }, h('span', { class: 'field-label' }, label), el);
  };
  const progress = h('progress', { class: 'exp-progress', id: 'hl-progress', max: 1, value: 0, hidden: true });
  const status = h('div', { class: 'exp-status', id: 'hl-status', role: 'status' });
  const list = h('div', { class: 'cap-list', id: 'hl-list', role: 'list' });
  const result = h('div', { class: 'cap-result', hidden: true });

  const live = () => findClip(app.store.project, clipId)?.clip;
  const toTimeline = (c, t) => c.start + t / c.speed;

  function render() {
    result.hidden = !state.items.length;
    const c = live();
    list.replaceChildren(...state.items.map((it, i) => h('div', { class: 'cap-row-item hl-item', role: 'listitem', 'data-i': i },
      h('button', { class: 'sub-time', type: 'button', title: 'Vai a questo punto', onClick: () => c && app.player.seek(toTimeline(c, it.start)) }, c ? `${formatDuration(toTimeline(c, it.start), 1)} → ${formatDuration(toTimeline(c, it.end), 1)}` : '—'),
      h('div', { class: 'hl-bar', title: 'Quanto è vivace' }, h('span', { style: { width: `${Math.round(Math.min(1, it.score) * 100)}%` } })),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Togli questo momento', title: 'Togli', onClick: () => { state.items.splice(i, 1); render(); } }, icon('trash', 14)))));
  }

  async function run() {
    if (state.running) return;
    const c = live();
    if (!c) return;
    state.running = true;
    state.signal = { aborted: false };
    runBtn.disabled = true;
    stopBtn.hidden = false;
    progress.hidden = false;
    progress.value = 0;
    status.className = 'exp-status';
    status.textContent = 'Guardo il video…';
    try {
      const blob = app.pool.blob(c.mediaId);
      if (!blob) throw new Error('File non disponibile.');
      const from = c.in;
      const to = c.in + c.duration * c.speed;
      const frames = await sampleVideoFrames(blob, { from, to, fps: FPS, signal: state.signal, onProgress: (v) => { progress.value = v * 0.85; } });
      const motion = motionSeries(frames);
      status.textContent = 'Ascolto l’audio…';
      let loud = null;
      if (c.hasAudio !== false && !c.muted) {
        try {
          const { channels, sampleRate } = await loadAudio(blob, { from, to, sampleRate: 8000, channels: 1 });
          loud = loudnessSeries(channels, sampleRate, FPS, frames.length);
        } catch {
          loud = null; // video senza audio: si usa solo il movimento
        }
      }
      const found = pickHighlights({ motion, loudness: loud, fps: FPS, length: Math.min(state.length, Math.max(1, c.duration * c.speed)), count: state.count, minGap: 1 });
      state.items = found.map((f) => ({ ...f, start: f.start, end: f.end }));
      progress.value = 1;
      status.textContent = found.length ? `${found.length} momenti trovati. Togli quelli che non ti piacciono, poi creane il montaggio.` : 'Non ho trovato momenti più vivaci degli altri.';
      render();
    } catch (e) {
      status.className = 'exp-status error';
      status.dataset.state = 'error';
      status.textContent = e.message === 'Operazione annullata.' ? e.message : `Non è riuscito: ${e.message}`;
    } finally {
      state.running = false;
      runBtn.disabled = false;
      stopBtn.hidden = true;
    }
  }

  function markers() {
    const c = live();
    if (!c || !state.items.length) return;
    const r = app.commit('Marcatori dei momenti migliori', (d) => state.items.forEach((it, i) => addMarker(d, toTimeline(c, it.start), `Momento ${i + 1}`)));
    if (r.ok) toast(`${state.items.length} marcatori aggiunti`, { type: 'success' });
  }
  function montage() {
    const c = live();
    if (!c || !state.items.length) return;
    const ranges = state.items.map((it) => ({ start: toTimeline(c, it.start), end: toTimeline(c, it.end) }));
    if (c.start > 0.01) ranges.unshift({ start: 0, end: c.start });
    const r = app.commit('Montaggio dei momenti migliori', (d) => keepOnly(d, ranges, { end: clipEnd(findClip(d, clipId).clip) }));
    if (r.ok) {
      toast(`Tenuti ${state.items.length} momenti: il resto è stato tolto (puoi annullare).`, { type: 'success' });
      ctl.close('ok');
    }
  }

  const runBtn = h('button', { class: 'btn primary', type: 'button', id: 'hl-run', onClick: run }, icon('sparkles', 16), 'Trova i momenti migliori');
  const stopBtn = h('button', { class: 'btn', type: 'button', id: 'hl-stop', hidden: true, onClick: () => { if (state.signal) state.signal.aborted = true; } }, 'Annulla');
  result.append(list, h('div', { class: 'cap-actions' },
    h('button', { class: 'btn primary', type: 'button', id: 'hl-montage', onClick: montage }, icon('scissors', 16), 'Tieni solo questi momenti'),
    h('button', { class: 'btn', type: 'button', id: 'hl-markers', onClick: markers }, icon('flag', 16), 'Metti i marcatori')));
  const content = h('div', { class: 'cap-dialog' },
    h('p', { class: 'hint' }, 'Cerca nel clip selezionato i tratti con più movimento e più volume. Serve per ricavare un riassunto o i pezzi migliori di un video lungo.'),
    h('div', { class: 'cap-row' },
      num('hl-length', 'Durata di ogni momento (secondi)', 2, 120, state.length, (v) => { state.length = Math.min(120, Math.max(2, v || 15)); }),
      num('hl-count', 'Quanti momenti', 1, 20, state.count, (v) => { state.count = Math.min(20, Math.max(1, Math.round(v) || 3)); })),
    h('div', { class: 'cap-run' }, runBtn, stopBtn),
    progress, status, result);
  const ctl = openDialog({ title: 'Momenti migliori', content, wide: true, id: 'highlights-dialog', actions: [{ label: 'Chiudi', id: 'hl-close', onClick: () => { if (state.signal) state.signal.aborted = true; } }] });
  void a;
  return ctl;
}
