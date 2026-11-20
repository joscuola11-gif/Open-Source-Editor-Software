// Conti: contanti, conto corrente, carte, risparmi… con il saldo di ciascuno.

import { h } from '../dom.js';
import { card, chips, confirmBox, emojiPicker, emptyState, errorToast, field, fmt, currencySymbol, openSheet, pageHeader, row, sectionTitle, switchRow, toast } from '../kit.js';
import { commit, getState, today, undo } from '../store.js';
import { ACCOUNT_TYPES, COLORS, alive, byId } from '../../core/model.js';
import { addAccount, archiveAccount, removeAccount, upsert } from '../../core/ops.js';
import { accountBalance, adjustBalance, balances, filterTransactions, netWorth } from '../../core/ledger.js';
import { formatPlain, parseAmount } from '../../core/money.js';
import { go } from '../router.js';
import { txRow } from '../txrow.js';
import { openTxForm } from './txform.js';

export function openAccountForm(id = null) {
  const s = getState();
  const c = id ? byId(s.conti, id) : null;
  const f = { nome: c?.nome ?? '', tipo: c?.tipo ?? 'corrente', saldo: c ? formatPlain(c.saldoIniziale) : '', emoji: c?.emoji ?? ACCOUNT_TYPES.corrente.emoji, colore: c?.colore ?? COLORS[s.conti.length % COLORS.length], nelTotale: c?.nelTotale ?? true, membroId: c?.membroId ?? '' };
  let emojiTouched = Boolean(c);
  const name = h('input', { type: 'text', maxlength: 50, autocomplete: 'off', value: f.nome, placeholder: 'Per esempio: Carta Maria', 'aria-label': 'Nome del conto', onInput: () => { f.nome = name.value; } });
  const bal = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: f.saldo, placeholder: '0,00', 'aria-label': 'Saldo di partenza', onInput: () => { f.saldo = bal.value; } });
  const emojiBox = h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Disegno'));
  const paintEmoji = () => { emojiBox.replaceChildren(h('span', { class: 'field-label' }, 'Disegno'), emojiPicker({ value: f.emoji, onChange: (e) => { f.emoji = e; emojiTouched = true; } })); };
  paintEmoji();
  const members = alive(s.membri).filter((m) => !m.archiviato);
  const body = h('div', { class: 'form' },
    field('Nome', name),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Che tipo di conto è'), chips({ items: Object.entries(ACCOUNT_TYPES).map(([k, v]) => ({ value: k, label: v.label, emoji: v.emoji })), value: f.tipo, label: 'Tipo di conto', onChange: (v) => { f.tipo = v; if (!emojiTouched) { f.emoji = ACCOUNT_TYPES[v].emoji; paintEmoji(); } } })),
    field(c ? 'Saldo di partenza' : 'Quanto c’è adesso', bal, c ? 'È il saldo prima di tutti i movimenti. Per correggere il saldo di oggi usa «Correggi il saldo».' : 'Scrivi quanto hai ora su questo conto (anche zero).'),
    emojiBox,
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Colore'), chips({ items: COLORS.map((x) => ({ value: x, label: '', color: x })), value: f.colore, label: 'Colore', onChange: (v) => { f.colore = v; } })),
    members.length > 1 && h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Di chi è'), chips({ items: [{ value: '', label: 'Di tutti' }, ...members.map((m) => ({ value: m.id, label: m.nome, emoji: m.emoji, color: m.colore }))], value: f.membroId, label: 'Proprietario', onChange: (v) => { f.membroId = v; } })),
    switchRow({ label: 'Conta nel patrimonio', hint: 'Disattivalo per conti che non vuoi sommare (per esempio un conto di un’associazione)', checked: f.nelTotale, onChange: (v) => { f.nelTotale = v; } }));
  const save = () => {
    try {
      const saldo = f.saldo.trim() ? parseAmount(f.saldo) : 0;
      if (saldo === null) throw new Error('Il saldo non è un importo valido, per esempio 1.250,00.');
      commit((st, now) => {
        if (c) {
          if (!f.nome.trim()) throw new Error('Scrivi il nome del conto.');
          if (alive(st.conti).some((x) => x.id !== c.id && x.nome.toLowerCase() === f.nome.trim().toLowerCase())) throw new Error('Esiste già un conto con questo nome.');
          upsert(st, 'conti', { id: c.id, nome: f.nome.trim(), tipo: f.tipo, saldoIniziale: saldo, emoji: f.emoji, colore: f.colore, nelTotale: f.nelTotale, membroId: f.membroId || null }, now);
        } else addAccount(st, { nome: f.nome, tipo: f.tipo, saldoIniziale: saldo, emoji: f.emoji, colore: f.colore, nelTotale: f.nelTotale, membroId: f.membroId || null }, now);
      });
      sheet.close();
    } catch (e) { errorToast(e); }
  };
  const del = async () => {
    if (!(await confirmBox({ title: `Eliminare «${c.nome}»?`, message: 'Si può eliminare solo un conto senza movimenti.', ok: 'Elimina', danger: true }))) return;
    try {
      commit((st, now) => removeAccount(st, c.id, now));
      sheet.close();
      go('conti');
      toast('Conto eliminato', { action: { label: 'Annulla', onClick: () => undo() } });
    } catch (e) {
      if (await confirmBox({ title: 'Non si può eliminare', message: `${e.message} Vuoi archiviarlo? Sparisce dalle scelte, ma i movimenti restano.`, ok: 'Archivia' })) { commit((st, now) => archiveAccount(st, c.id, true, now)); sheet.close(); go('conti'); toast('Conto archiviato'); }
    }
  };
  const footer = [c && h('button', { class: 'btn danger-text', type: 'button', onClick: del }, 'Elimina'), h('button', { class: 'btn primary', type: 'button', onClick: save }, 'Salva')];
  const sheet = openSheet({ title: c ? 'Modifica conto' : 'Nuovo conto', content: body, footer });
  if (!c) setTimeout(() => name.focus(), 200);
}

function openAdjust(c) {
  const cur = accountBalance(getState(), c.id);
  let text = formatPlain(cur);
  const inp = h('input', { class: 'amount-input small', type: 'text', inputmode: 'decimal', value: text, 'aria-label': 'Saldo vero', onInput: () => { text = inp.value; } });
  const body = h('div', { class: 'form' }, h('p', { class: 'lead' }, 'Scrivi quanto c’è davvero su questo conto adesso. L’app aggiunge una correzione per far tornare il saldo, senza falsare le statistiche.'),
    h('div', { class: 'amount-wrap' }, inp, h('span', { class: 'amount-cur', 'aria-hidden': 'true' }, currencySymbol())), h('p', { class: 'muted' }, `Adesso l’app dice: ${fmt(cur, { force: true })}`));
  const save = () => {
    const v = parseAmount(text);
    if (v === null) return errorToast(new Error('Scrivi un importo valido, per esempio 1.250,00.'));
    try {
      const made = commit((st, now) => adjustBalance(st, c.id, v, { data: today(), now }));
      sheet.close();
      toast(made ? 'Saldo corretto' : 'Il saldo era già giusto', made ? { action: { label: 'Annulla', onClick: () => undo() } } : {});
    } catch (e) { errorToast(e); }
  };
  const sheet = openSheet({ title: `Correggi il saldo di ${c.nome}`, content: body, footer: [h('button', { class: 'btn primary', type: 'button', onClick: save }, 'Correggi')] });
  setTimeout(() => { inp.focus(); inp.select(); }, 200);
}

export function render() {
  const s = getState();
  const bal = balances(s);
  const list = alive(s.conti);
  const active = list.filter((c) => !c.archiviato);
  const arch = list.filter((c) => c.archiviato);
  const root = h('div', { class: 'screen' }, pageHeader({ title: 'Conti', actions: [h('button', { class: 'btn small primary', type: 'button', onClick: () => openAccountForm() }, '＋ Nuovo')] }));
  root.append(card({ class: 'hero small' }, h('p', { class: 'hero-label' }, 'Patrimonio'), h('p', { class: 'hero-amount' }, fmt(netWorth(s)))));
  if (!active.length) root.append(card(null, emptyState('🏦', 'Nessun conto', 'Aggiungi i tuoi conti: contanti, conto corrente, carte…', { label: '＋ Aggiungi un conto', onClick: () => openAccountForm() })));
  else root.append(card({ class: 'flush' }, h('div', { class: 'list' }, active.map((c) => row({ icon: c.emoji, color: c.colore, title: c.nome, subtitle: `${ACCOUNT_TYPES[c.tipo]?.label ?? ''}${c.membroId ? ` · ${byId(s.membri, c.membroId)?.nome ?? ''}` : ''}${c.nelTotale ? '' : ' · fuori dal patrimonio'}`, right: fmt(bal.get(c.id) ?? 0), tone: (bal.get(c.id) ?? 0) < 0 ? 'neg' : '', onClick: () => go(`conto/${c.id}`) })))));
  if (arch.length) root.append(sectionTitle('Archiviati'), card({ class: 'flush' }, h('div', { class: 'list' }, arch.map((c) => row({ icon: c.emoji, color: c.colore, title: c.nome, subtitle: 'Archiviato', right: fmt(bal.get(c.id) ?? 0), onClick: () => go(`conto/${c.id}`) })))));
  return root;
}

let shownTx = 60;
export function renderDetail(id) {
  const s = getState();
  const c = byId(s.conti, id);
  if (!c) return h('div', { class: 'screen' }, pageHeader({ title: 'Conto', fallback: 'conti' }), card(null, emptyState('🤷', 'Conto non trovato', 'Forse è stato eliminato.', { label: 'Torna ai conti', onClick: () => go('conti') })));
  const txs = filterTransactions(s, { conti: [c.id] });
  const root = h('div', { class: 'screen' }, pageHeader({ title: c.nome, fallback: 'conti', actions: [h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Modifica il conto', onClick: () => openAccountForm(c.id) }, '✎')] }));
  root.append(card({ class: 'hero small' }, h('p', { class: 'hero-label' }, `${c.emoji} ${ACCOUNT_TYPES[c.tipo]?.label ?? ''}${c.archiviato ? ' · archiviato' : ''}`), h('p', { class: 'hero-amount' }, fmt(accountBalance(s, c.id))),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn small', type: 'button', onClick: () => openAdjust(c) }, '⚖️ Correggi il saldo'), h('button', { class: 'btn small', type: 'button', onClick: () => openTxForm({ preset: { tipo: 'giroconto', contoId: c.id } }) }, '⇄ Giroconto'), h('button', { class: 'btn small', type: 'button', onClick: () => openTxForm({ preset: { contoId: c.id } }) }, '＋ Movimento'))));
  if (c.archiviato) root.append(card({ class: 'notice' }, h('p', null, 'Questo conto è archiviato: non compare nelle scelte.'), h('button', { class: 'btn small', type: 'button', onClick: () => { commit((st, now) => archiveAccount(st, c.id, false, now)); toast('Conto di nuovo attivo'); } }, 'Riattiva')));
  else root.append(h('div', { class: 'screen-links' }, h('button', { class: 'btn small', type: 'button', onClick: () => { commit((st, now) => archiveAccount(st, c.id, true, now)); toast('Conto archiviato', { action: { label: 'Annulla', onClick: () => undo() } }); go('conti'); } }, '🗄 Archivia')));
  root.append(sectionTitle(`Movimenti (${txs.length})`));
  if (!txs.length) root.append(card(null, emptyState('📝', 'Nessun movimento', 'Quando usi questo conto compariranno qui.')));
  else {
    root.append(card({ class: 'flush' }, h('div', { class: 'list' }, txs.slice(0, shownTx).map((t) => txRow(s, t, { contoId: c.id, showAccount: false, onClick: () => openTxForm({ id: t.id }) })))));
    if (txs.length > shownTx) root.append(h('button', { class: 'btn block', type: 'button', onClick: () => { shownTx += 60; import('../store.js').then((m) => m.refresh()); } }, `Mostra altri (${txs.length - shownTx})`));
  }
  return root;
}
