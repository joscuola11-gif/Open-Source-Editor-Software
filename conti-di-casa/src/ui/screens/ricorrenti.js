// Pagamenti che si ripetono (affitto, bollette, abbonamenti, stipendio) e le loro scadenze.

import { h } from '../dom.js';
import { card, chips, confirmBox, emptyState, errorToast, field, fmt, currencySymbol, openSheet, pageHeader, row, sectionTitle, segmented, switchRow, toast } from '../kit.js';
import { commit, getState, today, undo } from '../store.js';
import { UNITS, alive, byId } from '../../core/model.js';
import { monthlyCommitment, registerOccurrence, skipOccurrence, upcoming } from '../../core/recurring.js';
import { removeItem, upsert } from '../../core/ops.js';
import { formatPlain, parseAmount } from '../../core/money.js';
import { formatDate, isValidISO, relativeDay } from '../../core/dates.js';
import { parseSum } from './txform.js';

const UNIT_ONE = { giorni: 'giorno', settimane: 'settimana', mesi: 'mese', anni: 'anno' };
export function everyText(r) {
  if (r.ogni === 1) return { giorni: 'Ogni giorno', settimane: 'Ogni settimana', mesi: 'Ogni mese', anni: 'Ogni anno' }[r.unita];
  return `Ogni ${r.ogni} ${r.unita}`;
}

export function openRecurringForm(id = null) {
  const s = getState();
  const r = id ? byId(s.ricorrenze, id) : null;
  const accounts = alive(s.conti).filter((c) => !c.archiviato || c.id === r?.contoId);
  const members = alive(s.membri).filter((m) => !m.archiviato);
  const f = {
    nome: r?.nome ?? '', tipo: r?.tipo ?? 'spesa', importo: r ? formatPlain(r.importo) : '', contoId: r?.contoId ?? accounts[0]?.id ?? '', contoA: r?.contoA ?? accounts[1]?.id ?? '', categoriaId: r?.categoriaId ?? '', membroId: r?.membroId ?? '',
    ogni: r?.ogni ?? 1, unita: r?.unita ?? 'mesi', inizio: r?.inizio ?? today(), fine: r?.fine ?? '', autoRegistra: r?.autoRegistra ?? false, avvisoGiorni: r?.avvisoGiorni ?? 3, attiva: r?.attiva ?? true,
  };
  const name = h('input', { type: 'text', maxlength: 60, autocomplete: 'off', value: f.nome, placeholder: 'Per esempio: Affitto', 'aria-label': 'Nome', onInput: () => { f.nome = name.value; } });
  const amt = h('input', { class: 'amount-input small', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: f.importo, placeholder: '0,00', 'aria-label': 'Importo', onInput: () => { f.importo = amt.value; } });
  const catBox = h('div', { class: 'field' });
  const accToBox = h('div', { class: 'field' });
  const paintType = () => {
    typeSeg.set(f.tipo);
    catBox.hidden = f.tipo === 'giroconto';
    accToBox.hidden = f.tipo !== 'giroconto';
    if (f.tipo !== 'giroconto') {
      const list = alive(getState().categorie).filter((k) => k.tipo === f.tipo && !k.archiviata);
      catBox.replaceChildren(h('span', { class: 'field-label' }, 'Categoria'), chips({ items: list.map((k) => ({ value: k.id, label: k.nome, emoji: k.emoji, color: k.colore })), value: f.categoriaId, label: 'Categoria', onChange: (v) => { f.categoriaId = v; } }));
    }
  };
  const typeSeg = segmented({ items: [{ value: 'spesa', label: 'Spesa', tone: 'expense' }, { value: 'entrata', label: 'Entrata', tone: 'income' }, { value: 'giroconto', label: 'Giroconto', tone: 'transfer' }], value: f.tipo, label: 'Tipo', onChange: (v) => { f.tipo = v; f.categoriaId = ''; paintType(); } });
  const accItems = accounts.map((c) => ({ value: c.id, label: c.nome, emoji: c.emoji, color: c.colore }));
  accToBox.append(h('span', { class: 'field-label' }, 'Verso il conto'), chips({ items: accItems, value: f.contoA, label: 'Conto di arrivo', onChange: (v) => { f.contoA = v; } }));
  const n = h('input', { type: 'number', min: 1, max: 365, value: f.ogni, inputmode: 'numeric', 'aria-label': 'Ogni quante', onInput: () => { f.ogni = Math.max(1, Math.min(365, parseInt(n.value, 10) || 1)); } });
  const u = h('select', { 'aria-label': 'Unità', onChange: () => { f.unita = u.value; } }, UNITS.map((x) => h('option', { value: x, selected: x === f.unita }, x)));
  const start = h('input', { type: 'date', value: f.inizio, 'aria-label': 'Prima scadenza', onChange: () => { f.inizio = start.value; } });
  const end = h('input', { type: 'date', value: f.fine, 'aria-label': 'Ultima scadenza', onChange: () => { f.fine = end.value; } });
  const warn = h('select', { 'aria-label': 'Avviso', onChange: () => { f.avvisoGiorni = Number(warn.value); } }, [[0, 'Il giorno stesso'], [1, '1 giorno prima'], [3, '3 giorni prima'], [7, '7 giorni prima'], [14, '14 giorni prima']].map(([v, l]) => h('option', { value: v, selected: v === f.avvisoGiorni }, l)));
  const body = h('div', { class: 'form' }, typeSeg, field('Nome', name), h('div', { class: 'amount-wrap' }, amt, h('span', { class: 'amount-cur', 'aria-hidden': 'true' }, currencySymbol())),
    catBox, h('div', { class: 'field' }, h('span', { class: 'field-label' }, f.tipo === 'giroconto' ? 'Dal conto' : 'Conto'), chips({ items: accItems, value: f.contoId, label: 'Conto', onChange: (v) => { f.contoId = v; } })), accToBox,
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Quando si ripete'), h('div', { class: 'repeat-row' }, h('span', null, 'Ogni'), n, u)),
    field('Prima scadenza', start), field('Ultima scadenza (facoltativa)', end, 'Lascia vuoto se non finisce mai'), field('Avvisami', warn),
    switchRow({ label: 'Registra da sola', hint: 'Alla scadenza il movimento si aggiunge senza chiederti niente (utile per gli addebiti automatici)', checked: f.autoRegistra, onChange: (v) => { f.autoRegistra = v; } }),
    r && switchRow({ label: 'Attiva', hint: 'Se la spegni non scade più', checked: f.attiva, onChange: (v) => { f.attiva = v; } }));
  paintType();
  const save = () => {
    try {
      const importo = parseSum(f.importo);
      if (importo === null || importo <= 0) throw new Error('Scrivi un importo valido, per esempio 650,00.');
      if (!f.nome.trim()) throw new Error('Scrivi il nome, per esempio «Affitto».');
      if (!isValidISO(f.inizio)) throw new Error('Scegli la prima scadenza.');
      if (f.fine && (!isValidISO(f.fine) || f.fine < f.inizio)) throw new Error('L’ultima scadenza deve essere dopo la prima.');
      if (!f.contoId) throw new Error('Scegli il conto.');
      if (f.tipo === 'giroconto' && (!f.contoA || f.contoA === f.contoId)) throw new Error('Scegli due conti diversi.');
      commit((st, now) => upsert(st, 'ricorrenze', {
        id: r?.id, nome: f.nome.trim(), tipo: f.tipo, importo, contoId: f.contoId, contoA: f.tipo === 'giroconto' ? f.contoA : undefined, categoriaId: f.tipo === 'giroconto' ? undefined : f.categoriaId || undefined, membroId: undefined,
        ogni: f.ogni, unita: f.unita, inizio: f.inizio, fine: f.fine || null, ultima: r?.ultima ?? null, autoRegistra: f.autoRegistra, avvisoGiorni: f.avvisoGiorni, attiva: f.attiva,
      }, now));
      sheet.close();
    } catch (e) { errorToast(e); }
  };
  const del = async () => {
    if (!(await confirmBox({ title: `Eliminare «${r.nome}»?`, message: 'I movimenti già registrati restano.', ok: 'Elimina', danger: true }))) return;
    commit((st, now) => removeItem(st, 'ricorrenze', r.id, now));
    sheet.close();
    toast('Eliminata', { action: { label: 'Annulla', onClick: () => undo() } });
  };
  const sheet = openSheet({ title: r ? 'Modifica scadenza' : 'Nuovo pagamento ricorrente', content: body, footer: [r && h('button', { class: 'btn danger-text', type: 'button', onClick: del }, 'Elimina'), h('button', { class: 'btn primary', type: 'button', onClick: save }, 'Salva')] });
  if (!r) setTimeout(() => name.focus(), 200);
}

function pay(recId, date, tipo) {
  try {
    commit((s, now) => registerOccurrence(s, recId, date, now));
    toast(tipo === 'entrata' ? 'Entrata registrata' : 'Pagamento registrato', { action: { label: 'Annulla', onClick: () => undo() } });
  } catch (e) { errorToast(e); }
}
function skip(recId, date) {
  commit((s, now) => skipOccurrence(s, recId, date, now));
  toast('Scadenza saltata', { action: { label: 'Annulla', onClick: () => undo() } });
}

export function render() {
  const s = getState();
  const t = today();
  const all0 = upcoming(s, t, 60);
  // scadute e di oggi si vedono tutte; delle future solo la prossima, e solo se quel pagamento non ha già una scadenza da saldare
  const busy = new Set(all0.filter((u) => u.stato !== 'presto').map((u) => u.ricorrenza.id));
  const seen = new Set();
  const up = all0.filter((u) => {
    if (u.stato !== 'presto') return true;
    if (busy.has(u.ricorrenza.id) || seen.has(u.ricorrenza.id)) return false;
    seen.add(u.ricorrenza.id);
    return true;
  });
  const all = alive(s.ricorrenze);
  const root = h('div', { class: 'screen' }, pageHeader({ title: 'Scadenze', actions: [h('button', { class: 'btn small primary', type: 'button', onClick: () => openRecurringForm() }, '＋ Nuova')] }));
  if (!all.length) {
    root.append(card(null, emptyState('🔁', 'Niente scadenze', 'Aggiungi affitto, bollette, abbonamenti o lo stipendio: ti avvisiamo quando scadono e li registri con un tocco.', { label: '＋ Aggiungi la prima', onClick: () => openRecurringForm() })));
    return root;
  }
  const commit_ = monthlyCommitment(s);
  if (commit_ > 0) root.append(card({ class: 'hero small' }, h('p', { class: 'hero-label' }, 'Impegni fissi al mese (stima)'), h('p', { class: 'hero-amount' }, fmt(commit_))));
  if (up.length) {
    const box = card({ class: 'flush' }, h('div', { class: 'pad' }, sectionTitle('In arrivo')));
    const list = h('div', { class: 'list' });
    for (const u of up) {
      const r = u.ricorrenza;
      const k = byId(s.categorie, r.categoriaId);
      list.append(h('div', { class: 'due-row' }, row({
        icon: k?.emoji ?? (r.tipo === 'giroconto' ? '⇄' : '🔁'), color: k?.colore, title: r.nome,
        subtitle: `${u.stato === 'scaduta' ? `⚠️ Scaduta il ${formatDate(u.data, 'short', t)}` : relativeDay(u.data, t)}${r.autoRegistra ? ' · si registra da sola' : ''}`,
        right: fmt(r.tipo === 'entrata' ? r.importo : r.tipo === 'spesa' ? -r.importo : r.importo), tone: r.tipo === 'entrata' ? 'pos' : r.tipo === 'spesa' ? 'neg' : 'transfer', onClick: () => openRecurringForm(r.id),
      }), h('div', { class: 'due-actions' }, h('button', { class: 'btn small primary', type: 'button', onClick: () => pay(r.id, u.data, r.tipo) }, r.tipo === 'entrata' ? 'Incassata' : r.tipo === 'giroconto' ? 'Fatto' : 'Pagata'), h('button', { class: 'btn small', type: 'button', onClick: () => skip(r.id, u.data) }, 'Salta'))));
    }
    box.append(list);
    root.append(box);
  }
  root.append(sectionTitle('Tutte'), card({ class: 'flush' }, h('div', { class: 'list' }, all.map((r) => {
    const k = byId(s.categorie, r.categoriaId);
    const nxt = all0.find((x) => x.ricorrenza.id === r.id && x.stato === 'presto') ?? all0.find((x) => x.ricorrenza.id === r.id);
    return row({ icon: k?.emoji ?? '🔁', color: k?.colore, title: r.nome, subtitle: `${everyText(r)}${nxt ? ` · prossima ${formatDate(nxt.data, 'short', t)}` : ''}${r.attiva ? '' : ' · spenta'}`, right: fmt(r.tipo === 'entrata' ? r.importo : r.tipo === 'spesa' ? -r.importo : r.importo), tone: r.tipo === 'entrata' ? 'pos' : r.tipo === 'spesa' ? 'neg' : '', onClick: () => openRecurringForm(r.id) });
  }))));
  return root;
}
