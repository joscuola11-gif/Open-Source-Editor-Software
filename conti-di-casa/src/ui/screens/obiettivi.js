// Obiettivi di risparmio: il «salvadanaio» per le vacanze, la lavatrice nuova, l'emergenza.

import { h } from '../dom.js';
import { card, chips, confirmBox, emojiPicker, emptyState, errorToast, field, fmt, currencySymbol, openSheet, pageHeader, progress, row, sectionTitle, segmented, toast } from '../kit.js';
import { commit, getState, today, undo } from '../store.js';
import { alive, byId } from '../../core/model.js';
import { goalProgress } from '../../core/goals.js';
import { addContribution, removeContribution, removeItem, upsert } from '../../core/ops.js';
import { formatPlain, parseAmount } from '../../core/money.js';
import { formatDate, isValidISO } from '../../core/dates.js';

const pct = (p) => `${String(Math.round(p)).replace('.', ',')}%`;

function openGoalForm(id = null) {
  const s = getState();
  const g = id ? byId(s.obiettivi, id) : null;
  const f = { nome: g?.nome ?? '', emoji: g?.emoji ?? '🎯', importo: g ? formatPlain(g.importo) : '', scadenza: g?.scadenza ?? '' };
  const name = h('input', { type: 'text', maxlength: 60, autocomplete: 'off', value: f.nome, placeholder: 'Per esempio: Vacanze in Sardegna', 'aria-label': 'Nome', onInput: () => { f.nome = name.value; } });
  const amt = h('input', { class: 'amount-input small', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: f.importo, placeholder: '0,00', 'aria-label': 'Quanto vuoi mettere da parte', onInput: () => { f.importo = amt.value; } });
  const date = h('input', { type: 'date', value: f.scadenza, 'aria-label': 'Entro quando', onChange: () => { f.scadenza = date.value; } });
  const body = h('div', { class: 'form' }, field('Nome', name), h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Disegno'), emojiPicker({ value: f.emoji, onChange: (e) => { f.emoji = e; } })), h('p', { class: 'field-label' }, 'Quanto vuoi mettere da parte'), h('div', { class: 'amount-wrap' }, amt, h('span', { class: 'amount-cur', 'aria-hidden': 'true' }, currencySymbol())), field('Entro quando (facoltativo)', date, 'Con una data l’app calcola quanto mettere da parte ogni mese'));
  const save = () => {
    try {
      const v = parseAmount(f.importo);
      if (!f.nome.trim()) throw new Error('Scrivi il nome dell’obiettivo.');
      if (v === null || v <= 0) throw new Error('Scrivi quanto vuoi mettere da parte, per esempio 1.500.');
      if (f.scadenza && !isValidISO(f.scadenza)) throw new Error('La data non è valida.');
      commit((st, now) => upsert(st, 'obiettivi', { id: g?.id, nome: f.nome.trim(), emoji: f.emoji, importo: v, scadenza: f.scadenza || null, versamenti: g?.versamenti ?? [] }, now));
      sheet.close();
    } catch (e) { errorToast(e); }
  };
  const del = async () => {
    if (!(await confirmBox({ title: `Eliminare «${g.nome}»?`, message: 'Si perde anche lo storico dei versamenti.', ok: 'Elimina', danger: true }))) return;
    commit((st, now) => removeItem(st, 'obiettivi', g.id, now));
    sheet.close();
    toast('Obiettivo eliminato', { action: { label: 'Annulla', onClick: () => undo() } });
  };
  const sheet = openSheet({ title: g ? 'Modifica obiettivo' : 'Nuovo obiettivo', content: body, footer: [g && h('button', { class: 'btn danger-text', type: 'button', onClick: del }, 'Elimina'), h('button', { class: 'btn primary', type: 'button', onClick: save }, 'Salva')] });
  if (!g) setTimeout(() => name.focus(), 200);
}

function openContribution(goalId) {
  const s = getState();
  const g = byId(s.obiettivi, goalId);
  const gp = goalProgress(g, today());
  const members = alive(s.membri).filter((m) => !m.archiviato);
  const f = { modo: 'metti', importo: gp.alMese && gp.alMese > 0 ? formatPlain(gp.alMese) : '', data: today(), membroId: '' };
  const amt = h('input', { class: 'amount-input small', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: f.importo, placeholder: '0,00', 'aria-label': 'Importo', onInput: () => { f.importo = amt.value; } });
  const date = h('input', { type: 'date', value: f.data, 'aria-label': 'Data', onChange: () => { f.data = date.value; } });
  const body = h('div', { class: 'form' }, segmented({ items: [{ value: 'metti', label: 'Metto da parte' }, { value: 'preleva', label: 'Prelevo' }], value: f.modo, label: 'Cosa fai', onChange: (v) => { f.modo = v; } }),
    h('div', { class: 'amount-wrap' }, amt, h('span', { class: 'amount-cur', 'aria-hidden': 'true' }, currencySymbol())), field('Quando', date),
    members.length > 1 && h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Chi'), chips({ items: [{ value: '', label: 'Tutti' }, ...members.map((m) => ({ value: m.id, label: m.nome, emoji: m.emoji, color: m.colore }))], value: f.membroId, label: 'Chi', onChange: (v) => { f.membroId = v; } })),
    h('p', { class: 'muted' }, 'I soldi dell’obiettivo sono un promemoria: non escono dai tuoi conti. Se vuoi spostarli davvero, fai anche un giroconto verso il conto di risparmio.'));
  const save = () => {
    const v = parseAmount(f.importo);
    if (v === null || v <= 0) return errorToast(new Error('Scrivi un importo valido.'));
    if (!isValidISO(f.data)) return errorToast(new Error('La data non è valida.'));
    try {
      commit((st, now) => addContribution(st, goalId, { data: f.data, importo: f.modo === 'metti' ? v : -v, membroId: f.membroId || undefined }, now));
      sheet.close();
      toast(f.modo === 'metti' ? 'Messo da parte 🎉' : 'Prelievo registrato', { action: { label: 'Annulla', onClick: () => undo() } });
    } catch (e) { errorToast(e); }
  };
  const sheet = openSheet({ title: `${g.emoji} ${g.nome}`, content: body, footer: [h('button', { class: 'btn primary', type: 'button', onClick: save }, 'Salva')] });
  setTimeout(() => amt.focus(), 200);
}

function openHistory(goalId) {
  const s = getState();
  const g = byId(s.obiettivi, goalId);
  const list = [...g.versamenti].sort((a, b) => (a.data < b.data ? 1 : -1));
  const body = list.length ? h('div', { class: 'list' }, list.map((v) => row({ icon: v.importo > 0 ? '➕' : '➖', title: formatDate(v.data, 'long'), subtitle: v.membroId ? byId(s.membri, v.membroId)?.nome : '', right: fmt(v.importo, { sign: true }), tone: v.importo > 0 ? 'pos' : 'neg', onClick: async () => {
    if (await confirmBox({ title: 'Togliere questo versamento?', message: formatDate(v.data, 'long') + ' · ' + fmt(v.importo, { force: true }), ok: 'Togli', danger: true })) { commit((st, now) => removeContribution(st, goalId, v.id, now)); sheet.close(); toast('Versamento tolto', { action: { label: 'Annulla', onClick: () => undo() } }); }
  } }))) : h('p', { class: 'muted' }, 'Ancora nessun versamento.');
  const sheet = openSheet({ title: 'Versamenti', content: body });
}

export function render() {
  const s = getState();
  const t = today();
  const goals = alive(s.obiettivi);
  const root = h('div', { class: 'screen' }, pageHeader({ title: 'Obiettivi', actions: [h('button', { class: 'btn small primary', type: 'button', onClick: () => openGoalForm() }, '＋ Nuovo')] }));
  if (!goals.length) {
    root.append(card(null, emptyState('🎯', 'Metti da parte per qualcosa', 'Vacanze, la lavatrice nuova, un fondo per le emergenze: scegli una cifra e segui i progressi.', { label: '＋ Crea un obiettivo', onClick: () => openGoalForm() })));
    return root;
  }
  for (const g of goals) {
    const p = goalProgress(g, t);
    const line = p.stato === 'raggiunto' ? '🎉 Obiettivo raggiunto!' : p.stato === 'scaduto' ? `Scaduto ${Math.abs(p.giorniMancanti)} giorni fa · mancano ${fmt(p.mancante)}` : `Mancano ${fmt(p.mancante)}${g.scadenza ? ` · entro il ${formatDate(g.scadenza, 'long')}` : ''}`;
    root.append(card({ class: 'goal' }, h('div', { class: 'goal-head' }, h('span', { class: 'goal-emoji', 'aria-hidden': 'true' }, g.emoji), h('div', { class: 'goal-title' }, h('h3', null, g.nome), h('p', { class: 'muted' }, `${fmt(p.versato)} di ${fmt(g.importo)}`)), h('strong', null, pct(p.percento))),
      progress(p.percento, p.stato === 'raggiunto' ? 'ok' : p.stato === 'scaduto' ? 'superato' : 'ok', g.nome), h('p', { class: 'muted' }, line), p.alMese ? h('p', { class: 'hint-line' }, `Per arrivarci metti da parte circa ${fmt(p.alMese)} al mese.`) : null,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn small primary', type: 'button', onClick: () => openContribution(g.id) }, '＋ Metti da parte'), h('button', { class: 'btn small', type: 'button', onClick: () => openHistory(g.id) }, 'Storico'), h('button', { class: 'btn small', type: 'button', onClick: () => openGoalForm(g.id) }, 'Modifica'))));
  }
  return root;
}
