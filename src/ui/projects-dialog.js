// Finestra «I miei progetti»: salva con nome, riapri, duplica, rinomina, elimina (tutto nel browser).

import { whenLabel } from '../core/projects.js';
import { formatBytes, formatDuration } from '../core/util.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { confirmDialog, openDialog, promptDialog, toast } from './overlays.js';

export function openProjectsDialog(app) {
  const a = app.actions;
  const list = h('div', { class: 'proj-list', id: 'proj-list', role: 'list' });
  const nameInput = h('input', { class: 'text-input', id: 'proj-name', type: 'text', maxlength: 100, value: app.store.project.name, 'aria-label': 'Nome del progetto da salvare' });
  const hint = h('p', { class: 'hint' });
  let ctl = null;

  const card = (e) => {
    const current = app.savedMark?.id === e.id;
    return h('div', { class: `proj-card${current ? ' current' : ''}`, role: 'listitem', 'data-id': e.id },
      e.thumb ? h('img', { class: 'proj-thumb', src: e.thumb, alt: '' }) : h('div', { class: 'proj-thumb empty' }, icon('video', 28)),
      h('div', { class: 'proj-info' },
        h('div', { class: 'proj-title' }, h('strong', {}, e.name), current ? h('span', { class: 'badge' }, 'aperto') : null),
        h('div', { class: 'proj-meta' }, `${formatDuration(e.duration)} · ${e.width}×${e.height} · ${e.clips} clip · ${e.mediaCount} file${e.mediaBytes ? ` (${formatBytes(e.mediaBytes)})` : ''}`),
        h('div', { class: 'proj-meta dim' }, `Modificato ${whenLabel(e.updated)}`)),
      h('div', { class: 'proj-actions' },
        h('button', { class: 'btn small primary proj-open', type: 'button', onClick: async () => { if (await a.openSaved(e.id)) ctl.close(); } }, icon('folder', 14), 'Apri'),
        h('button', { class: 'btn small proj-dup', type: 'button', onClick: async () => { await a.duplicateSaved(e.id); refresh(); } }, icon('copy', 14), 'Duplica'),
        h('button', { class: 'btn small proj-rename', type: 'button', onClick: async () => {
          const n = await promptDialog('Rinomina il progetto', e.name, { label: 'Nome' });
          if (n) { await a.renameSaved(e.id, n); refresh(); }
        } }, 'Rinomina'),
        h('button', { class: 'btn small danger proj-del', type: 'button', onClick: async () => {
          if (await confirmDialog(`«${e.name}» verrà eliminato dal browser. I file non usati da altri progetti vengono rimossi.`, { confirmLabel: 'Elimina', danger: true, title: 'Eliminare il progetto?' })) { await a.deleteSaved(e.id); refresh(); }
        } }, icon('trash', 14), 'Elimina')));
  };

  async function refresh() {
    const items = await app.storage.listProjects();
    list.replaceChildren(...(items.length ? items.map(card) : [h('p', { class: 'hint empty', id: 'proj-empty' }, 'Nessun progetto salvato. Scrivi un nome qui sopra e premi «Salva qui».')]));
    hint.textContent = app.storage.available ? `${items.length} progetti salvati in questo browser.` : 'Il salvataggio nel browser non è disponibile (navigazione privata?).';
  }

  const content = h('div', { class: 'proj-dialog' },
    h('div', { class: 'proj-save' },
      nameInput,
      h('button', { class: 'btn primary', type: 'button', id: 'proj-save', onClick: async () => { if (await a.saveToList({ name: nameInput.value })) refresh(); } }, icon('download', 14), app.savedMark ? 'Aggiorna' : 'Salva qui'),
      h('button', { class: 'btn', type: 'button', id: 'proj-save-new', title: 'Crea una nuova voce, senza toccare quella aperta', onClick: async () => { if (await a.saveToList({ name: nameInput.value, asNew: true })) refresh(); } }, 'Salva come nuovo')),
    hint,
    list);
  ctl = openDialog({ title: 'I miei progetti', content, wide: true, id: 'projects-dialog', actions: [{ label: 'Chiudi', id: 'proj-close' }] });
  refresh().catch((e) => toast(`Elenco non disponibile: ${e.message}`, { type: 'error' }));
  return ctl;
}
