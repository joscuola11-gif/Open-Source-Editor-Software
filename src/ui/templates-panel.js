// Scheda «Modelli» e finestra «Usa questo modello»: scegli un modello, guarda l'anteprima animata,
// metti i tuoi video, foto, musica e testi, e crea il progetto.

import { builtinTemplates, TEMPLATE_CATEGORIES } from '../core/template-lib.js';
import { parseTemplateFile, sanitizeTemplate } from '../core/templates.js';
import { ASPECTS } from '../core/presets.js';
import { formatDuration } from '../core/util.js';
import { probeMedia } from '../engine/media-import.js';
import { TemplatePreview } from '../engine/template-preview.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { confirmDialog, openDialog, promptDialog, toast } from './overlays.js';
import { prefs } from './prefs.js';

export const MINE = 'I miei modelli';

const aspectLabel = ({ width, height }) => ASPECTS.find((a) => Math.abs(a.width / a.height - width / height) < 0.02)?.id ?? `${width}:${height}`;

let thumbPreview = null;
let thumbQueue = Promise.resolve();

/** Disegna la miniatura di un modello su `canvas` (in coda, una alla volta). */
function queueThumb(template, canvas) {
  thumbQueue = thumbQueue.then(async () => {
    try {
      thumbPreview ??= new TemplatePreview();
      await thumbPreview.build(template);
      thumbPreview.render(canvas, Math.min(1.6, thumbPreview.duration * 0.25), 180);
    } catch (e) {
      console.warn('[modelli] miniatura', e);
    }
  });
}

export function buildTemplatesTab(app) {
  let filter = prefs.get('tplFilter', 'Tutti');
  let query = '';
  let user = [];
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Categoria' });
  const grid = h('div', { class: 'tpl-grid', id: 'tpl-grid', role: 'list' });
  const count = h('p', { class: 'hint', id: 'tpl-count' });
  const search = h('input', { class: 'text-input', id: 'tpl-search', type: 'search', placeholder: 'Cerca un modello…', 'aria-label': 'Cerca un modello' });
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    renderGrid();
  });
  const file = h('input', { type: 'file', accept: '.ciak-modello,.json,application/json', hidden: true, id: 'tpl-import-input', 'aria-label': 'Importa un modello' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (f && (await app.actions.importTemplate(f))) await refresh();
  });

  const all = () => [...builtinTemplates(), ...user.map((t) => ({ ...t, mine: true }))];
  async function loadUser() {
    try {
      user = (await app.storage.listTemplates()).flatMap((t) => {
        try {
          return [sanitizeTemplate(t)];
        } catch {
          return [];
        }
      });
    } catch {
      user = [];
    }
  }
  function renderChips() {
    const names = ['Tutti', ...TEMPLATE_CATEGORIES, MINE];
    chips.replaceChildren(...names.map((n) => h('button', { class: `chip${filter === n ? ' on' : ''}`, type: 'button', 'data-cat': n, onClick: () => { filter = n; prefs.set('tplFilter', n); renderChips(); renderGrid(); } }, n === MINE ? `${n} (${user.length})` : n)));
  }
  function renderGrid() {
    const list = all().filter((t) => (filter === 'Tutti' || (filter === MINE ? t.mine : t.category === filter && !t.mine)) && (!query || `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(query)));
    count.textContent = list.length ? `${list.length} ${list.length === 1 ? 'modello' : 'modelli'}` : filter === MINE ? 'Non hai ancora modelli: apri un progetto e usa «Salva come modello» (scheda Progetto), oppure importa un file .ciak-modello.' : 'Nessun modello corrisponde alla ricerca.';
    grid.replaceChildren(...list.map((t) => {
      const canvas = h('canvas', { class: 'tpl-thumb', width: 180, height: Math.round((180 * t.aspect.height) / t.aspect.width), 'aria-hidden': 'true' });
      queueThumb(t, canvas);
      return h('button', { class: 'tpl-card', type: 'button', role: 'listitem', 'data-id': t.id, 'data-cat': t.category, title: t.description, onClick: () => openTemplateDialog(app, t, { onChange: refresh }) },
        h('div', { class: 'tpl-thumb-wrap' }, canvas, t.mine ? h('span', { class: 'badge' }, 'mio') : null),
        h('span', { class: 'tpl-name' }, t.name),
        h('span', { class: 'tpl-meta' }, `${aspectLabel(t.aspect)} · ${formatDuration(t.duration)} · ${t.slots.filter((s) => s.kind !== 'audio').length} clip`));
    }));
  }
  async function refresh() {
    await loadUser();
    renderChips();
    renderGrid();
  }
  const root = h('div', { class: 'lib-pane tpl-pane' },
    h('p', { class: 'hint' }, 'Scegli un modello, metti i tuoi video e le tue foto e ottieni un montaggio già pronto, con animazioni e transizioni. Si modifica come qualsiasi progetto.'),
    search,
    chips,
    h('div', { class: 'lib-actions wrap' },
      h('button', { class: 'btn small', type: 'button', id: 'tpl-import', onClick: () => file.click() }, icon('upload', 14), 'Importa modello'),
      file),
    count,
    grid);
  renderChips();
  renderGrid();
  refresh();
  return root;
}

/** Finestra del modello: anteprima animata, scelta dei file e dei testi, «Usa questo modello». */
export function openTemplateDialog(app, template, { onChange } = {}) {
  const pv = new TemplatePreview();
  const picks = {};
  const texts = {};
  let name = template.name;
  let closed = false;
  let playing = true;
  let t0 = performance.now();
  let frozen = 0;
  let raf = 0;
  let ctl = null;

  const canvas = h('canvas', { class: 'tpl-canvas', id: 'tpl-canvas', width: 360, height: Math.round((360 * template.aspect.height) / template.aspect.width), 'aria-label': `Anteprima del modello ${template.name}` });
  const clock = h('span', { class: 'tpl-clock', id: 'tpl-clock' }, '0:00');
  const playBtn = h('button', { class: 'btn small', type: 'button', id: 'tpl-play', onClick: () => toggle() }, icon('pause', 14), 'Pausa');
  function toggle() {
    if (playing) frozen = ((performance.now() - t0) / 1000) % Math.max(0.1, pv.duration);
    else t0 = performance.now() - frozen * 1000;
    playing = !playing;
    playBtn.replaceChildren(icon(playing ? 'pause' : 'play', 14), playing ? 'Pausa' : 'Anteprima');
  }
  const tick = () => {
    if (closed) return;
    if (pv.project) {
      const dur = Math.max(0.1, pv.duration);
      const t = playing ? ((performance.now() - t0) / 1000) % dur : frozen;
      pv.render(canvas, t, 360);
      clock.textContent = `${formatDuration(t)} / ${formatDuration(dur)}`;
    }
    raf = requestAnimationFrame(tick);
  };

  let chain = Promise.resolve();
  const rebuild = () => {
    chain = chain.then(() => (closed ? null : pv.build(template, { picks, texts, name }))).catch((e) => console.warn('[modelli] anteprima', e));
    return chain;
  };

  const visual = template.slots.filter((s) => s.kind !== 'audio');
  const audio = template.slots.filter((s) => s.kind === 'audio');
  const slotRow = (s) => {
    const input = h('input', { type: 'file', hidden: true, accept: s.kind === 'audio' ? 'audio/*,.mp3,.wav,.m4a,.ogg,.flac' : 'video/*,image/*,.mp4,.mov,.webm,.mkv,.png,.jpg,.jpeg,.webp', 'aria-label': `Scegli il file per ${s.label}` });
    const state = h('span', { class: 'tpl-slot-state' }, s.kind === 'audio' ? 'Nessuna musica' : 'Esempio');
    const row = h('div', { class: 'tpl-slot', 'data-slot': s.id, 'data-kind': s.kind },
      h('div', { class: 'tpl-slot-head' }, h('strong', {}, s.label), h('span', { class: 'dim' }, ` ${s.kind === 'audio' ? 'musica' : 'foto o video'} · ${s.duration.toFixed(1)} s`)),
      state,
      h('button', { class: 'btn small tpl-pick', type: 'button', onClick: () => input.click() }, icon('upload', 14), 'Scegli file'),
      h('button', { class: 'btn small tpl-skip', type: 'button', title: s.kind === 'audio' ? 'Senza musica' : 'Salta questo clip: il resto si accorcia', onClick: () => {
        delete picks[s.id];
        if (s.kind !== 'audio') picks[s.id] = 'skip';
        state.textContent = s.kind === 'audio' ? 'Nessuna musica' : 'Saltato';
        row.dataset.state = 'skip';
        rebuild();
      } }, s.kind === 'audio' ? 'Senza musica' : 'Salta'),
      input);
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.value = '';
      if (!f) return;
      try {
        const meta = await probeMedia(f);
        if (s.kind === 'audio' && meta.kind !== 'audio') throw new Error('serve un file audio');
        if (s.kind !== 'audio' && meta.kind === 'audio') throw new Error('serve un video o una foto');
        picks[s.id] = { file: f, meta };
        state.textContent = f.name;
        row.dataset.state = 'picked';
        rebuild();
      } catch (e) {
        toast(`«${f.name}»: ${e.message}`, { type: 'warn' });
      }
    });
    return row;
  };
  const textRow = (x) => {
    const input = h('input', { class: 'text-input', type: 'text', maxlength: 200, value: x.content, 'data-text': x.id, 'aria-label': `Testo: ${x.label}` });
    input.addEventListener('input', () => {
      texts[x.id] = input.value;
      rebuild();
    });
    return h('label', { class: 'tpl-text' }, h('span', { class: 'dim' }, x.label), input);
  };
  const nameInput = h('input', { class: 'text-input', id: 'tpl-name', type: 'text', maxlength: 100, value: name, 'aria-label': 'Nome del progetto' });
  nameInput.addEventListener('input', () => {
    name = nameInput.value;
  });

  const content = h('div', { class: 'tpl-dialog' },
    h('div', { class: 'tpl-left' }, h('div', { class: 'tpl-canvas-wrap' }, canvas), h('div', { class: 'tpl-controls' }, playBtn, clock), h('p', { class: 'hint' }, 'L’anteprima usa immagini fisse al posto dei tuoi video; nel progetto finale si muovono.')),
    h('div', { class: 'tpl-right' },
      h('p', { class: 'tpl-desc' }, template.description || ''),
      h('p', { class: 'dim' }, `${aspectLabel(template.aspect)} · ${formatDuration(template.duration)} · ${visual.length} clip${audio.length ? ' + musica' : ''}`),
      h('label', { class: 'tpl-text' }, h('span', { class: 'dim' }, 'Nome del progetto'), nameInput),
      visual.length || audio.length ? h('h4', { class: 'lib-h' }, 'I tuoi file') : null,
      ...visual.map(slotRow),
      ...audio.map(slotRow),
      template.texts.length ? h('h4', { class: 'lib-h' }, 'Testi') : null,
      ...template.texts.map(textRow)));

  const needsMedia = visual.some((s) => s.duration < 0.9 * template.duration);
  const actions = [
    { label: 'Annulla', id: 'tpl-cancel' },
    { label: 'Usa questo modello', primary: true, id: 'tpl-use', onClick: async () => {
      const chosen = visual.filter((s) => picks[s.id] && picks[s.id] !== 'skip');
      if (needsMedia && !chosen.length) {
        toast('Scegli almeno un video o una foto per cominciare.', { type: 'warn' });
        return false;
      }
      return (await app.actions.useTemplate(template, { picks: Object.fromEntries(Object.entries(picks).filter(([, v]) => v !== 'skip')), texts, name: nameInput.value })) !== false;
    } },
  ];
  if (template.mine) {
    actions.unshift(
      { label: 'Elimina', id: 'tpl-delete', danger: true, onClick: async () => {
        if (!(await confirmDialog(`Il modello «${template.name}» verrà eliminato dal browser.`, { confirmLabel: 'Elimina', danger: true, title: 'Eliminare il modello?' }))) return false;
        await app.actions.deleteTemplate(template.id);
        onChange?.();
      } },
      { label: 'Esporta file', id: 'tpl-export', onClick: () => { app.actions.exportTemplate(template); return false; } },
    );
  }
  ctl = openDialog({ title: template.name, content, wide: true, id: 'template-dialog', actions, onClose: () => {
    closed = true;
    cancelAnimationFrame(raf);
    pv.pool.clear();
  } });
  rebuild().then(() => { t0 = performance.now(); });
  raf = requestAnimationFrame(tick);
  return ctl;
}

/** «Salva come modello»: chiede il nome e conserva il progetto aperto come modello riutilizzabile. */
export async function saveCurrentAsTemplate(app) {
  const name = await promptDialog('Salva come modello', app.store.project.name, { label: 'Nome del modello' });
  if (!name) return null;
  return app.actions.saveAsTemplate(name);
}

export { parseTemplateFile };
