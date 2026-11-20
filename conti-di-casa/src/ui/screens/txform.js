// Il foglio per aggiungere o modificare un movimento (spesa, entrata, giroconto): la schermata più usata.

import { h } from '../dom.js';
import { chips, confirmBox, errorToast, field, fmt, currencySymbol, openSheet, segmented, switchRow, toast } from '../kit.js';
import { commit, getState, today, undo } from '../store.js';
import { alive, byId } from '../../core/model.js';
import { parseAmount, formatPlain } from '../../core/money.js';
import { addDays, isValidISO } from '../../core/dates.js';
import { addTransaction, duplicateTransaction, removeTransaction, updateTransaction } from '../../core/ledger.js';
import { equalSplit } from '../../core/splits.js';
import { suggestCategory, normalize } from '../../core/rules.js';
import { upsert } from '../../core/ops.js';
import { budgetStatus } from '../../core/budgets.js';
import { periodOf } from '../../core/periods.js';
import { UNITS } from '../../core/model.js';
import { pref } from '../../storage.js';
import { openCategoryForm } from './categorie.js';

/** «12,50+3» → 1550. Si possono sommare più importi. null se qualcosa non è un importo. */
export function parseSum(text) {
  const parts = String(text ?? '').split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  let total = 0;
  for (const p of parts) {
    const v = parseAmount(p);
    if (v === null) return null;
    total += v;
  }
  return total;
}

const TIPI = [{ value: 'spesa', label: 'Spesa', tone: 'expense' }, { value: 'entrata', label: 'Entrata', tone: 'income' }, { value: 'giroconto', label: 'Giroconto', tone: 'transfer' }];
const UNIT_LABEL = { giorni: 'giorni', settimane: 'settimane', mesi: 'mesi', anni: 'anni' };

export function openTxForm({ id = null, preset = {}, onDone } = {}) {
  const s0 = getState();
  const existing = id ? s0.movimenti.find((m) => m.id === id && !m.x) : null;
  if (id && !existing) return null;
  const members = alive(s0.membri).filter((m) => !m.archiviato || m.id === existing?.membroId);
  const accounts = alive(s0.conti).filter((c) => !c.archiviato || c.id === existing?.contoId || c.id === existing?.contoA);
  const lastAcc = pref.get('ultimoConto');
  const lastMem = pref.get('ultimoMembro');
  const firstAcc = accounts.find((c) => c.id === lastAcc) ?? accounts[0];
  const d = existing?.divisione;

  const f = {
    tipo: existing?.tipo ?? preset.tipo ?? 'spesa',
    importo: existing ? formatPlain(existing.importo) : preset.importo ? formatPlain(preset.importo) : '',
    data: existing?.data ?? preset.data ?? today(),
    contoId: existing?.contoId ?? preset.contoId ?? firstAcc?.id ?? '',
    contoA: existing?.contoA ?? accounts.find((c) => c.id !== (existing?.contoId ?? firstAcc?.id))?.id ?? '',
    categoriaId: existing?.categoriaId ?? preset.categoriaId ?? '',
    membroId: existing?.membroId ?? (members.find((m) => m.id === lastMem) ?? members[0])?.id ?? '',
    descrizione: existing?.descrizione ?? preset.descrizione ?? '',
    note: existing?.note ?? '',
    tag: (existing?.tag ?? []).join(' '),
    dividi: Boolean(d),
    pagatoDa: d?.pagatoDa ?? existing?.membroId ?? (members.find((m) => m.id === lastMem) ?? members[0])?.id ?? '',
    partecipanti: new Set(d ? d.quote.map((q) => q.membroId) : members.map((m) => m.id)),
    modo: 'uguali',
    quote: {},
    ripeti: false,
    ogni: 1,
    unita: 'mesi',
  };
  if (d) {
    const even = equalSplit(existing.importo, d.quote.map((q) => q.membroId), d.pagatoDa).quote;
    const same = even.every((q) => d.quote.find((x) => x.membroId === q.membroId)?.importo === q.importo);
    f.modo = same ? 'uguali' : 'importi';
    for (const q of d.quote) f.quote[q.membroId] = formatPlain(q.importo);
  }
  let catManual = Boolean(existing?.categoriaId || preset.categoriaId);

  // ---- campi -----------------------------------------------------------------------------------------------------
  const amountInput = h('input', {
    class: 'amount-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'next', placeholder: '0,00', value: f.importo, 'aria-label': 'Importo',
    onInput: () => { f.importo = amountInput.value; paintAmount(); if (f.modo === 'importi') paintSplit(); },
  });
  const amountNote = h('div', { class: 'amount-note', 'aria-live': 'polite' });
  function paintAmount() {
    const v = parseSum(f.importo);
    amountNote.className = `amount-note ${f.importo.trim() && (v === null || v <= 0) ? 'bad' : ''}`;
    amountNote.textContent = !f.importo.trim() ? 'Puoi scrivere anche una somma, per esempio 12,50+3' : v === null || v <= 0 ? 'Scrivi un importo valido, per esempio 12,50' : f.importo.includes('+') ? `Totale: ${fmt(v, { force: true })}` : '';
  }

  const typeSeg = segmented({ items: TIPI, value: f.tipo, label: 'Tipo di movimento', onChange: (v) => { f.tipo = v; if (!catManual || !catValid()) { f.categoriaId = ''; catManual = false; } paintType(); } });

  const descInput = h('input', {
    type: 'text', autocomplete: 'off', autocapitalize: 'sentences', maxlength: 120, placeholder: 'Per esempio: Esselunga', value: f.descrizione, 'aria-label': 'Descrizione',
    onInput: () => { f.descrizione = descInput.value; paintHints(); suggest(); },
  });
  const hints = h('div', { class: 'hints' });
  let hintTimer = null;
  function paintHints() {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      const q = normalize(f.descrizione);
      hints.replaceChildren();
      if (q.length < 2 || existing) return;
      const seen = new Set();
      for (const t of getState().movimenti.slice().reverse()) {
        if (t.x || t.rettifica || !t.descrizione || t.tipo !== f.tipo) continue;
        const n = normalize(t.descrizione);
        if (n === q || !n.includes(q) || seen.has(n)) continue;
        seen.add(n);
        hints.append(h('button', { type: 'button', class: 'chip small', onClick: () => { f.descrizione = t.descrizione; descInput.value = t.descrizione; hints.replaceChildren(); suggest(true); } }, t.descrizione));
        if (seen.size >= 4) break;
      }
    }, 120);
  }
  const catHint = h('span', { class: 'field-hint ok' });
  function suggest(force = false) {
    if (f.tipo === 'giroconto' || (catManual && !force)) return;
    if (force) catManual = false;
    const s = suggestCategory(getState(), f.descrizione, f.tipo);
    if (s && s.categoriaId !== f.categoriaId) {
      f.categoriaId = s.categoriaId;
      paintCategories();
      catHint.textContent = s.fonte === 'regola' ? '✓ Scelta da una tua regola' : '✓ Scelta in base ai movimenti passati';
    }
  }
  const catValid = () => Boolean(f.categoriaId && byId(getState().categorie, f.categoriaId)?.tipo === f.tipo);

  const catBox = h('div', { class: 'cat-box' });
  function paintCategories() {
    const list = alive(getState().categorie).filter((k) => k.tipo === f.tipo && (!k.archiviata || k.id === f.categoriaId));
    catBox.replaceChildren(
      chips({ items: list.map((k) => ({ value: k.id, label: k.nome, emoji: k.emoji, color: k.colore })), value: f.categoriaId, label: 'Categoria', onChange: (v) => { f.categoriaId = v; catManual = true; catHint.textContent = ''; } }),
      h('button', { type: 'button', class: 'chip add', onClick: () => openCategoryForm({ tipo: f.tipo, onDone: (k) => { f.categoriaId = k.id; catManual = true; paintCategories(); } }) }, '＋ Nuova'),
    );
  }

  const dateInput = h('input', { type: 'date', value: f.data, min: '1990-01-01', max: '2100-12-31', 'aria-label': 'Data', onChange: () => { if (isValidISO(dateInput.value)) f.data = dateInput.value; paintDateChips(); } });
  const dateChips = chips({ items: [{ value: 'oggi', label: 'Oggi' }, { value: 'ieri', label: 'Ieri' }, { value: 'altro', label: 'Altra data' }], value: 'altro', label: 'Giorno', onChange: (v) => {
    if (v === 'oggi') f.data = today();
    else if (v === 'ieri') f.data = addDays(today(), -1);
    if (v !== 'altro') dateInput.value = f.data;
    else dateInput.showPicker?.();
    paintDateChips();
  } });
  function paintDateChips() { dateChips.set(f.data === today() ? 'oggi' : f.data === addDays(today(), -1) ? 'ieri' : 'altro'); }

  const accItems = accounts.map((c) => ({ value: c.id, label: c.nome, emoji: c.emoji, color: c.colore }));
  const accFrom = chips({ items: accItems, value: f.contoId, label: 'Conto', onChange: (v) => { f.contoId = v; if (f.contoA === v) { f.contoA = accounts.find((c) => c.id !== v)?.id ?? ''; accTo.set(f.contoA); } } });
  const accTo = chips({ items: accItems, value: f.contoA, label: 'Conto di arrivo', onChange: (v) => { f.contoA = v; } });
  const accLabel = h('span', { class: 'field-label' }, 'Conto');
  const accToWrap = h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Verso il conto'), accTo);

  const memLabel = h('span', { class: 'field-label' }, 'Chi');
  const memChips = chips({ items: members.map((m) => ({ value: m.id, label: m.nome, emoji: m.emoji, color: m.colore })), value: f.membroId, label: 'Familiare', onChange: (v) => { f.membroId = v; if (!f.dividi) f.pagatoDa = v; } });
  const memWrap = h('div', { class: 'field' }, memLabel, memChips);

  // ---- divisione ------------------------------------------------------------------------------------------------
  const splitBox = h('div', { class: 'split-box' });
  function paintSplit() {
    splitBox.replaceChildren();
    if (members.length < 2 || f.tipo !== 'spesa') return;
    splitBox.append(switchRow({ label: 'Dividi con la famiglia', hint: 'Per sapere poi chi deve soldi a chi', checked: f.dividi, onChange: (v) => { f.dividi = v; paintSplit(); } }));
    if (!f.dividi) return;
    const total = parseSum(f.importo) ?? 0;
    const inner = h('div', { class: 'split-inner' });
    inner.append(
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Chi ha pagato'), chips({ items: members.map((m) => ({ value: m.id, label: m.nome, emoji: m.emoji, color: m.colore })), value: f.pagatoDa, label: 'Chi ha pagato', onChange: (v) => { f.pagatoDa = v; } })),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Per chi è la spesa'), chips({ items: members.map((m) => ({ value: m.id, label: m.nome, emoji: m.emoji, color: m.colore })), value: [...f.partecipanti], multi: true, label: 'Per chi', onChange: (v) => { f.partecipanti = new Set(v); paintSplit(); } })),
      segmented({ items: [{ value: 'uguali', label: 'Parti uguali' }, { value: 'importi', label: 'Importi diversi' }], value: f.modo, label: 'Come dividere', onChange: (v) => { f.modo = v; paintSplit(); } }),
    );
    const chosen = members.filter((m) => f.partecipanti.has(m.id));
    if (f.modo === 'uguali') {
      if (chosen.length && total > 0) {
        const parts = equalSplit(total, chosen.map((m) => m.id), f.pagatoDa).quote;
        inner.append(h('ul', { class: 'split-list' }, parts.map((q) => h('li', null, h('span', null, byId(getState().membri, q.membroId)?.nome), h('strong', null, fmt(q.importo, { force: true }))))));
      }
    } else {
      const left = h('div', { class: 'split-left' });
      const upd = () => {
        const sum = chosen.reduce((a, m) => a + (parseSum(f.quote[m.id] ?? '') ?? 0), 0);
        const diff = total - sum;
        left.className = `split-left ${diff === 0 && total > 0 ? 'ok' : 'bad'}`;
        left.textContent = diff === 0 ? (total > 0 ? '✓ Il totale torna' : '') : diff > 0 ? `Mancano ${fmt(diff, { force: true })}` : `Ce ne sono ${fmt(-diff, { force: true })} in più`;
      };
      for (const m of chosen) {
        const inp = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00', value: f.quote[m.id] ?? '', 'aria-label': `Quota di ${m.nome}`, onInput: () => { f.quote[m.id] = inp.value; upd(); } });
        inner.append(h('label', { class: 'split-row' }, h('span', null, `${m.emoji} ${m.nome}`), inp));
      }
      inner.append(left);
      upd();
    }
    splitBox.append(inner);
  }

  // ---- note, etichette, ripetizione -------------------------------------------------------------------------------
  const noteInput = h('textarea', { rows: 2, maxlength: 500, placeholder: 'Note (facoltative)', 'aria-label': 'Note', onInput: () => { f.note = noteInput.value; } }, f.note);
  const tagInput = h('input', { type: 'text', maxlength: 120, placeholder: 'Etichette separate da spazio (facoltative)', value: f.tag, autocomplete: 'off', 'aria-label': 'Etichette', onInput: () => { f.tag = tagInput.value; } });
  const more = h('details', { class: 'more' }, h('summary', null, 'Note ed etichette'), noteInput, tagInput);
  if (f.note || f.tag) more.open = true;

  const repeatBox = h('div', { class: 'repeat-box' });
  function paintRepeat() {
    repeatBox.replaceChildren();
    if (existing) return;
    repeatBox.append(switchRow({ label: 'Ripeti nel tempo', hint: 'Affitto, abbonamenti, stipendio… ti avvisiamo alla scadenza', checked: f.ripeti, onChange: (v) => { f.ripeti = v; paintRepeat(); } }));
    if (!f.ripeti) return;
    const n = h('input', { type: 'number', min: 1, max: 365, value: f.ogni, inputmode: 'numeric', 'aria-label': 'Ogni quante volte', onInput: () => { f.ogni = Math.max(1, Math.min(365, parseInt(n.value, 10) || 1)); } });
    const u = h('select', { 'aria-label': 'Unità', onChange: () => { f.unita = u.value; } }, UNITS.map((x) => h('option', { value: x, selected: x === f.unita }, UNIT_LABEL[x])));
    repeatBox.append(h('div', { class: 'repeat-row' }, h('span', null, 'Ogni'), n, u));
  }

  // ---- pezzi che dipendono dal tipo ---------------------------------------------------------------------------------
  const catField = h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Categoria ', catHint), catBox);
  function paintType() {
    typeSeg.set(f.tipo);
    const t = f.tipo;
    catField.hidden = t === 'giroconto';
    accToWrap.hidden = t !== 'giroconto';
    memWrap.hidden = t === 'giroconto' || members.length < 2;
    memLabel.textContent = t === 'entrata' ? 'Chi l’ha incassato' : 'Chi l’ha speso';
    accLabel.textContent = t === 'giroconto' ? 'Dal conto' : t === 'entrata' ? 'Su quale conto' : 'Da quale conto';
    if (t !== 'giroconto') paintCategories();
    if (t !== 'spesa') f.dividi = false;
    paintSplit();
    paintRepeat();
  }

  // ---- salvataggio ---------------------------------------------------------------------------------------------------
  function build() {
    const importo = parseSum(f.importo);
    if (importo === null || importo <= 0) throw new Error('Scrivi un importo valido, per esempio 12,50.');
    if (!isValidISO(f.data)) throw new Error('La data non è valida.');
    if (!f.contoId) throw new Error('Scegli il conto.');
    const tx = { tipo: f.tipo, data: f.data, importo, contoId: f.contoId, descrizione: f.descrizione.trim(), note: f.note.trim() };
    const tags = f.tag.split(/[\s,]+/).map((x) => x.replace(/^#/, '').trim()).filter(Boolean).slice(0, 8);
    tx.tag = tags.length ? tags : null;
    if (f.tipo === 'giroconto') {
      if (!f.contoA) throw new Error('Scegli il conto di arrivo.');
      tx.contoA = f.contoA;
      tx.categoriaId = null;
      tx.membroId = null;
      tx.divisione = null;
    } else {
      tx.contoA = null;
      tx.categoriaId = f.categoriaId || null;
      tx.membroId = f.membroId || null;
      tx.divisione = null;
      if (f.tipo === 'spesa' && f.dividi && members.length > 1) {
        const chosen = members.filter((m) => f.partecipanti.has(m.id)).map((m) => m.id);
        if (!chosen.length) throw new Error('Scegli per chi è la spesa.');
        if (!f.pagatoDa) throw new Error('Scegli chi ha pagato.');
        if (f.modo === 'uguali') tx.divisione = equalSplit(importo, chosen, f.pagatoDa);
        else {
          const quote = chosen.map((m) => ({ membroId: m, importo: parseSum(f.quote[m] ?? '') ?? 0 }));
          const sum = quote.reduce((a, q) => a + q.importo, 0);
          if (sum !== importo) throw new Error(`Le quote devono dare in tutto ${fmt(importo, { force: true })}: adesso sono ${fmt(sum, { force: true })}.`);
          tx.divisione = { pagatoDa: f.pagatoDa, quote };
        }
      }
    }
    return tx;
  }

  function save({ again = false } = {}) {
    let tx;
    try {
      tx = build();
    } catch (e) {
      return errorToast(e);
    }
    let created;
    try {
      commit((s, now) => {
        if (existing) {
          created = updateTransaction(s, existing.id, tx, now);
        } else {
          let rec = null;
          if (f.ripeti && f.ogni >= 1) {
            const k = tx.categoriaId ? byId(s.categorie, tx.categoriaId) : null;
            rec = upsert(s, 'ricorrenze', {
              nome: tx.descrizione || k?.nome || (tx.tipo === 'entrata' ? 'Entrata ricorrente' : tx.tipo === 'giroconto' ? 'Giroconto ricorrente' : 'Spesa ricorrente'), tipo: tx.tipo, importo: tx.importo, contoId: tx.contoId,
              ...(tx.contoA ? { contoA: tx.contoA } : {}), ...(tx.categoriaId ? { categoriaId: tx.categoriaId } : {}), ...(tx.membroId ? { membroId: tx.membroId } : {}),
              ogni: f.ogni, unita: f.unita, inizio: tx.data, fine: null, ultima: tx.data, autoRegistra: false, avvisoGiorni: 3, attiva: true,
            }, now);
          }
          created = addTransaction(s, { ...tx, ...(rec ? { ricorrenteId: rec.id } : {}) }, now);
        }
      });
    } catch (e) {
      return errorToast(e);
    }
    pref.set('ultimoConto', created.contoId);
    if (created.membroId) pref.set('ultimoMembro', created.membroId);
    const warn = budgetWarning(created);
    const label = existing ? 'Modifiche salvate' : created.tipo === 'spesa' ? 'Spesa registrata' : created.tipo === 'entrata' ? 'Entrata registrata' : 'Giroconto registrato';
    toast(warn ?? label, { action: { label: 'Annulla', onClick: () => undo() }, tone: warn ? 'warn' : '' });
    if (again && !existing) {
      f.importo = '';
      f.descrizione = '';
      f.note = '';
      f.tag = '';
      f.dividi = false;
      amountInput.value = '';
      descInput.value = '';
      noteInput.value = '';
      tagInput.value = '';
      catManual = false;
      f.categoriaId = '';
      paintCategories();
      paintAmount();
      paintSplit();
      amountInput.focus();
      return;
    }
    sheet.close();
    onDone?.(created);
  }

  function budgetWarning(tx) {
    if (tx.tipo !== 'spesa' || !tx.categoriaId) return null;
    const s = getState();
    const p = periodOf(tx.data, s.impostazioni.inizioMese);
    const r = budgetStatus(s, p, today() < p.to && today() >= p.from ? today() : p.to).righe.find((x) => x.categoriaId === tx.categoriaId);
    const k = byId(s.categorie, tx.categoriaId);
    if (!r || !k) return null;
    if (r.stato === 'superato') return `Spesa registrata. Attenzione: hai superato il budget di ${k.nome} (${fmt(r.speso)} su ${fmt(r.limite)}).`;
    if (r.stato === 'attenzione') return `Spesa registrata. Hai già usato il ${Math.round(r.percento)}% del budget di ${k.nome}.`;
    return null;
  }

  // ---- montaggio ----------------------------------------------------------------------------------------------------
  const body = h('div', { class: 'form tx-form' },
    typeSeg,
    h('div', { class: 'amount-wrap' }, amountInput, h('span', { class: 'amount-cur', 'aria-hidden': 'true' }, currencySymbol())),
    amountNote,
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Descrizione'), descInput, hints),
    catField,
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Quando'), dateChips, dateInput),
    h('div', { class: 'field' }, accLabel, accFrom),
    accToWrap,
    memWrap,
    splitBox,
    more,
    repeatBox,
  );
  if (existing) {
    body.append(h('div', { class: 'form-extra' },
      h('button', { type: 'button', class: 'btn small', onClick: () => { try { commit((s, now) => duplicateTransaction(s, existing.id, { data: today(), now })); sheet.close(); toast('Duplicato con la data di oggi', { action: { label: 'Annulla', onClick: () => undo() } }); } catch (e) { errorToast(e); } } }, '⎘ Duplica a oggi'),
      h('button', { type: 'button', class: 'btn small danger-text', onClick: async () => {
        if (!(await confirmBox({ title: 'Eliminare il movimento?', message: 'Puoi annullare subito dopo con «Annulla».', ok: 'Elimina', danger: true }))) return;
        commit((s, now) => removeTransaction(s, existing.id, now));
        sheet.close();
        toast('Movimento eliminato', { action: { label: 'Annulla', onClick: () => undo() } });
      } }, '🗑 Elimina'),
    ));
  }
  const footer = existing
    ? [h('button', { class: 'btn', type: 'button', onClick: () => sheet.close() }, 'Chiudi'), h('button', { class: 'btn primary', type: 'button', onClick: () => save() }, 'Salva')]
    : [h('button', { class: 'btn', type: 'button', onClick: () => save({ again: true }) }, 'Salva e aggiungi'), h('button', { class: 'btn primary', type: 'button', onClick: () => save() }, 'Salva')];
  const sheet = openSheet({ title: existing ? 'Modifica movimento' : 'Nuovo movimento', content: body, footer });
  paintType();
  paintAmount();
  paintDateChips();
  if (!existing) setTimeout(() => amountInput.focus(), 220);
  return sheet;
}
