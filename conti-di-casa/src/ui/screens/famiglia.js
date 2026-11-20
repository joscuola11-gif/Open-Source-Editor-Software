// La famiglia: chi ne fa parte, quanto spende ciascuno e «chi deve a chi».

import { h } from '../dom.js';
import { card, chips, confirmBox, emojiPicker, emptyState, errorToast, field, fmt, currencySymbol, openSheet, pageHeader, periodBar, row, sectionTitle, switchRow, toast } from '../kit.js';
import { commit, currentPeriod, getState, today, undo } from '../store.js';
import { COLORS, alive, byId } from '../../core/model.js';
import { addMember, archiveMember, removeItem, removeMember, upsert } from '../../core/ops.js';
import { memberBalances, settlements } from '../../core/splits.js';
import { summarize } from '../../core/stats.js';
import { formatPlain, parseAmount } from '../../core/money.js';
import { formatDate, isValidISO } from '../../core/dates.js';

const KIDS = ['🙂', '👩', '👨', '👧', '👦', '👵', '👴', '🧒', '👶', '🐶'];

function openMemberForm(id = null) {
  const s = getState();
  const m = id ? byId(s.membri, id) : null;
  const f = { nome: m?.nome ?? '', emoji: m?.emoji ?? KIDS[alive(s.membri).length % KIDS.length], colore: m?.colore ?? COLORS[alive(s.membri).length % COLORS.length] };
  const name = h('input', { type: 'text', maxlength: 40, autocomplete: 'off', value: f.nome, placeholder: 'Per esempio: Maria', 'aria-label': 'Nome', onInput: () => { f.nome = name.value; } });
  const arch = switchRow({ label: 'Nascondi', hint: 'Non compare più nelle scelte, ma i suoi movimenti restano', checked: m?.archiviato ?? false, onChange: () => {} });
  const body = h('div', { class: 'form' }, field('Nome', name), h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Disegno'), emojiPicker({ value: f.emoji, onChange: (e) => { f.emoji = e; } })),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Colore'), chips({ items: COLORS.map((c) => ({ value: c, label: '', color: c })), value: f.colore, label: 'Colore', onChange: (v) => { f.colore = v; } })), m && arch);
  const save = () => {
    try {
      commit((st, now) => {
        if (m) {
          if (!f.nome.trim()) throw new Error('Scrivi il nome.');
          const wantArch = arch.querySelector('input').checked;
          upsert(st, 'membri', { id: m.id, nome: f.nome.trim(), emoji: f.emoji, colore: f.colore }, now);
          if (wantArch !== m.archiviato) archiveMember(st, m.id, wantArch, now);
        } else addMember(st, { nome: f.nome, emoji: f.emoji, colore: f.colore }, now);
      });
      sheet.close();
    } catch (e) { errorToast(e); }
  };
  const del = async () => {
    if (!(await confirmBox({ title: `Eliminare ${m.nome}?`, message: 'Si può eliminare solo chi non compare in nessun movimento: altrimenti si nasconde.', ok: 'Elimina', danger: true }))) return;
    try {
      commit((st, now) => removeMember(st, m.id, now));
      sheet.close();
      toast('Eliminato', { action: { label: 'Annulla', onClick: () => undo() } });
    } catch (e) { errorToast(e); }
  };
  const footer = [m && h('button', { class: 'btn danger-text', type: 'button', onClick: del }, 'Elimina'), h('button', { class: 'btn primary', type: 'button', onClick: save }, 'Salva')];
  const sheet = openSheet({ title: m ? 'Modifica familiare' : 'Nuovo familiare', content: body, footer });
  if (!m) setTimeout(() => name.focus(), 200);
}

function openSettle(da, a, importo) {
  const s = getState();
  const f = { importo: formatPlain(importo), data: today(), nota: '' };
  const amt = h('input', { class: 'amount-input small', type: 'text', inputmode: 'decimal', value: f.importo, 'aria-label': 'Importo pagato', onInput: () => { f.importo = amt.value; } });
  const date = h('input', { type: 'date', value: f.data, 'aria-label': 'Data', onChange: () => { f.data = date.value; } });
  const body = h('div', { class: 'form' }, h('p', { class: 'lead' }, `${byId(s.membri, da)?.nome} dà ${byId(s.membri, a)?.nome}:`), h('div', { class: 'amount-wrap' }, amt, h('span', { class: 'amount-cur', 'aria-hidden': 'true' }, currencySymbol())),
    h('p', { class: 'muted' }, 'Non sposta soldi tra i tuoi conti: serve solo a pareggiare il conto fra voi. Se vuoi registrare anche il movimento di denaro, aggiungi un giroconto o una spesa a parte.'), field('Quando', date));
  const save = () => {
    const v = parseAmount(f.importo);
    if (v === null || v <= 0) return errorToast(new Error('Scrivi un importo valido.'));
    if (!isValidISO(f.data)) return errorToast(new Error('La data non è valida.'));
    commit((st, now) => upsert(st, 'regolamenti', { data: f.data, da, a, importo: v, nota: f.nota }, now));
    sheet.close();
    toast('Pagamento segnato', { action: { label: 'Annulla', onClick: () => undo() } });
  };
  const sheet = openSheet({ title: 'Segna come pagato', content: body, footer: [h('button', { class: 'btn primary', type: 'button', onClick: save }, 'Segna come pagato')] });
}

export function render() {
  const s = getState();
  const p = currentPeriod();
  const sum = summarize(s, p.from, p.to);
  const members = alive(s.membri);
  const root = h('div', { class: 'screen' }, pageHeader({ title: 'Famiglia', actions: [h('button', { class: 'btn small primary', type: 'button', onClick: () => openMemberForm() }, '＋ Aggiungi')] }));
  root.append(periodBar());
  root.append(card({ class: 'flush' }, h('div', { class: 'list' }, members.map((m) => {
    const sp = sum.perMembro.find((x) => x.membroId === m.id)?.totale ?? 0;
    return row({ icon: m.emoji, color: m.colore, title: m.nome, subtitle: m.archiviato ? 'Nascosto' : `Ha speso nel periodo`, right: fmt(sp), onClick: () => openMemberForm(m.id) });
  }))));

  if (members.filter((m) => !m.archiviato).length < 2) {
    root.append(card(null, emptyState('👨‍👩‍👧', 'Aggiungi gli altri della famiglia', 'Con due o più persone puoi dividere le spese e vedere chi deve a chi.', { label: '＋ Aggiungi un familiare', onClick: () => openMemberForm() })));
    return root;
  }
  const net = memberBalances(s);
  const sett = settlements(net);
  const box = card(null, sectionTitle('Chi deve a chi'));
  if (!sett.length) box.append(h('p', { class: 'muted' }, net.size ? '✅ Siete pari: nessuno deve niente a nessuno.' : 'Quando aggiungi una spesa, attiva «Dividi con la famiglia»: qui vedrai i conti fra voi.'));
  else {
    for (const x of sett) {
      box.append(row({ icon: '➡️', title: `${byId(s.membri, x.da)?.nome ?? '?'} deve ${fmt(x.importo)} a ${byId(s.membri, x.a)?.nome ?? '?'}`, rightSub: h('button', { class: 'btn small', type: 'button', onClick: () => openSettle(x.da, x.a, x.importo) }, 'Pagato') }));
    }
  }
  root.append(box);
  if (net.size) root.append(card({ class: 'flush' }, h('div', { class: 'pad' }, sectionTitle('Saldo di ognuno')), h('div', { class: 'list' }, [...net.entries()].filter(([id]) => byId(s.membri, id)).map(([id, v]) => { const m = byId(s.membri, id); return row({ icon: m.emoji, color: m.colore, title: m.nome, subtitle: v > 0 ? 'Deve ricevere' : v < 0 ? 'Deve dare' : 'In pari', right: fmt(v, { sign: true }), tone: v > 0 ? 'pos' : v < 0 ? 'neg' : '' }); }))));
  const done = alive(s.regolamenti).sort((a, b) => (a.data < b.data ? 1 : -1)).slice(0, 10);
  if (done.length) root.append(sectionTitle('Pagamenti già fatti'), card({ class: 'flush' }, h('div', { class: 'list' }, done.map((g) => row({ icon: '✅', title: `${byId(s.membri, g.da)?.nome ?? '?'} → ${byId(s.membri, g.a)?.nome ?? '?'}`, subtitle: formatDate(g.data, 'long'), right: fmt(g.importo), onClick: async () => { if (await confirmBox({ title: 'Togliere questo pagamento?', message: 'Il debito tornerà come prima.', ok: 'Togli', danger: true })) { commit((st, now) => removeItem(st, 'regolamenti', g.id, now)); toast('Pagamento tolto', { action: { label: 'Annulla', onClick: () => undo() } }); } } })))));
  return root;
}
