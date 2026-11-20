// Elenco dei movimenti con ricerca e filtri.

import { h } from '../dom.js';
import { card, chips, emptyState, fmt, openSheet, periodBar, segmented, field } from '../kit.js';
import { currentPeriod, getState, refresh, view } from '../store.js';
import { alive } from '../../core/model.js';
import { filterTransactions } from '../../core/ledger.js';
import { relativeDay } from '../../core/dates.js';
import { today } from '../store.js';
import { txRow } from '../txrow.js';
import { openTxForm } from './txform.js';
import { parseAmount } from '../../core/money.js';

// i filtri restano mentre si cambia pagina
export const filters = { q: '', tipo: '', categorie: [], conti: [], membri: [], tutto: false, min: '', max: '' };
let shown = 80;

export const activeFilterCount = () => (filters.tipo ? 1 : 0) + (filters.categorie.length ? 1 : 0) + (filters.conti.length ? 1 : 0) + (filters.membri.length ? 1 : 0) + (filters.min || filters.max ? 1 : 0);
export function clearFilters() {
  Object.assign(filters, { q: '', tipo: '', categorie: [], conti: [], membri: [], tutto: false, min: '', max: '' });
  shown = 80;
}
/** Per aprire l'elenco già filtrato (per esempio da una categoria nelle statistiche). */
export function setFilters(patch) {
  clearFilters();
  Object.assign(filters, patch);
}

function query(s) {
  const p = currentPeriod();
  const min = filters.min ? parseAmount(filters.min) : null;
  const max = filters.max ? parseAmount(filters.max) : null;
  return filterTransactions(s, { q: filters.q, tipo: filters.tipo || undefined, categorie: filters.categorie, conti: filters.conti, membri: filters.membri, ...(filters.tutto ? {} : { from: p.from, to: p.to }), min: min ?? undefined, max: max ?? undefined });
}

export function render() {
  const s = getState();
  const root = h('div', { class: 'screen movimenti' });
  const list = h('div', { class: 'tx-list' });
  const summary = h('p', { class: 'muted summary-line', 'aria-live': 'polite' });
  const search = h('input', { type: 'search', class: 'search', placeholder: 'Cerca (nome, importo, categoria…)', value: filters.q, 'aria-label': 'Cerca', autocomplete: 'off', enterkeyhint: 'search', onInput: () => { filters.q = search.value; shown = 80; paintList(); } });
  const n = activeFilterCount();
  const filterBtn = h('button', { class: `btn small ${n ? 'primary' : ''}`, type: 'button', onClick: () => openFilters() }, `⚙ Filtri${n ? ` (${n})` : ''}`);

  function paintList() {
    const all = query(s);
    const ent = all.filter((t) => t.tipo === 'entrata' && !t.rettifica).reduce((a, t) => a + t.importo, 0);
    const usc = all.filter((t) => t.tipo === 'spesa' && !t.rettifica).reduce((a, t) => a + t.importo, 0);
    summary.textContent = all.length ? `${all.length} moviment${all.length === 1 ? 'o' : 'i'} · entrate ${fmt(ent)} · uscite ${fmt(usc)}` : '';
    list.replaceChildren();
    if (!all.length) {
      const any = alive(s.movimenti).length > 0;
      list.append(card(null, any ? emptyState('🔍', 'Nessun movimento', filters.q || activeFilterCount() ? 'Prova a cambiare la ricerca o i filtri.' : 'In questo periodo non c’è niente.', filters.q || activeFilterCount() || filters.tutto === false ? { label: filters.q || activeFilterCount() ? 'Togli i filtri' : 'Mostra tutto', onClick: () => { if (filters.q || activeFilterCount()) clearFilters(); else filters.tutto = true; refresh(); } } : null)
        : emptyState('📝', 'Ancora nessun movimento', 'Tocca il pulsante + per scrivere il primo.', { label: '＋ Aggiungi', onClick: () => openTxForm() })));
      return;
    }
    const t0 = today();
    let day = null;
    let box = null;
    let dayTotal = null;
    const slice = all.slice(0, shown);
    const totals = new Map();
    for (const t of all) if (!t.rettifica && t.tipo !== 'giroconto') totals.set(t.data, (totals.get(t.data) ?? 0) + (t.tipo === 'entrata' ? t.importo : -t.importo));
    for (const t of slice) {
      if (t.data !== day) {
        day = t.data;
        const tot = totals.get(day);
        dayTotal = h('span', { class: `day-total ${tot > 0 ? 'pos' : ''}` }, tot ? fmt(tot, { sign: true }) : '');
        box = h('div', { class: 'list' });
        list.append(h('div', { class: 'day-group' }, h('div', { class: 'day-head' }, h('span', null, relativeDay(day, t0)), dayTotal), card({ class: 'flush' }, box)));
      }
      box.append(txRow(s, t, { onClick: () => openTxForm({ id: t.id }) }));
    }
    if (all.length > shown) list.append(h('button', { class: 'btn block', type: 'button', onClick: () => { shown += 80; paintList(); } }, `Mostra altri (${all.length - shown})`));
  }

  function openFilters() {
    const f = { ...filters, categorie: [...filters.categorie], conti: [...filters.conti], membri: [...filters.membri] };
    const cats = alive(s.categorie).map((k) => ({ value: k.id, label: k.nome, emoji: k.emoji, color: k.colore }));
    const min = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'Da', value: f.min, 'aria-label': 'Importo minimo', onInput: () => { f.min = min.value; } });
    const max = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'A', value: f.max, 'aria-label': 'Importo massimo', onInput: () => { f.max = max.value; } });
    const body = h('div', { class: 'form' },
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Periodo'), segmented({ items: [{ value: 'periodo', label: currentPeriod().label.split(' (')[0] }, { value: 'tutto', label: 'Tutto' }], value: f.tutto ? 'tutto' : 'periodo', label: 'Periodo', onChange: (v) => { f.tutto = v === 'tutto'; } })),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Tipo'), chips({ items: [{ value: '', label: 'Tutti' }, { value: 'spesa', label: 'Spese' }, { value: 'entrata', label: 'Entrate' }, { value: 'giroconto', label: 'Giroconti' }], value: f.tipo, label: 'Tipo', onChange: (v) => { f.tipo = v; } })),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Categorie'), chips({ items: [...cats, { value: '', label: 'Senza categoria', emoji: '∅' }], value: f.categorie, multi: true, label: 'Categorie', onChange: (v) => { f.categorie = v; } })),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Conti'), chips({ items: alive(s.conti).map((c) => ({ value: c.id, label: c.nome, emoji: c.emoji, color: c.colore })), value: f.conti, multi: true, label: 'Conti', onChange: (v) => { f.conti = v; } })),
      alive(s.membri).length > 1 && h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Chi'), chips({ items: alive(s.membri).map((m) => ({ value: m.id, label: m.nome, emoji: m.emoji, color: m.colore })), value: f.membri, multi: true, label: 'Familiari', onChange: (v) => { f.membri = v; } })),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Importo'), h('div', { class: 'range-row' }, min, h('span', null, '–'), max)),
    );
    const apply = () => { Object.assign(filters, f, { q: filters.q }); shown = 80; sheet.close(); refresh(); };
    const sheet = openSheet({ title: 'Filtri', content: body, footer: [h('button', { class: 'btn', type: 'button', onClick: () => { const q = filters.q; clearFilters(); filters.q = q; sheet.close(); refresh(); } }, 'Azzera'), h('button', { class: 'btn primary', type: 'button', onClick: apply }, 'Applica')] });
  }

  root.append(h('header', { class: 'tab-head' }, h('h1', null, 'Movimenti'), filterBtn),
    filters.tutto ? h('div', { class: 'period-bar' }, h('div', { class: 'period-label static' }, 'Tutti i periodi'), h('button', { class: 'btn small', type: 'button', onClick: () => { filters.tutto = false; refresh(); } }, 'Solo questo mese')) : periodBar(),
    search, summary, list);
  paintList();
  return root;
}
