// Budget: quanto si può spendere al mese per ogni categoria.

import { h } from '../dom.js';
import { card, emptyState, errorToast, field, fmt, currencySymbol, openSheet, periodBar, progress, row, sectionTitle, toast } from '../kit.js';
import { commit, currentPeriod, getState, startDay, today, undo } from '../store.js';
import { alive, byId } from '../../core/model.js';
import { budgetStatus } from '../../core/budgets.js';
import { summarize } from '../../core/stats.js';
import { setBudget } from '../../core/ops.js';
import { formatPlain, parseAmount } from '../../core/money.js';
import { lastPeriods, periodOf, periodProgress } from '../../core/periods.js';
import { pickCategory } from './categorie.js';

const pct = (p) => `${String(Math.round(p)).replace('.', ',')}%`;
const STATE_TEXT = { ok: 'Tutto a posto', attenzione: 'Attenzione: quasi finito', superato: 'Budget superato' };

/** Quanto si spende di solito al mese in una categoria (media degli ultimi 3 periodi chiusi). */
function usualSpending(s, categoriaId) {
  const cur = periodOf(today(), startDay());
  const periods = lastPeriods(cur.from, 4, startDay()).slice(0, 3);
  const vals = periods.map((p) => summarize(s, p.from, p.to).perCategoria.find((c) => c.categoriaId === categoriaId)?.totale ?? 0);
  const nonZero = vals.filter((v) => v > 0);
  return nonZero.length ? Math.round(nonZero.reduce((a, b) => a + b, 0) / nonZero.length) : 0;
}

export function openBudgetForm(categoriaId) {
  const s = getState();
  const k = byId(s.categorie, categoriaId);
  if (!k) return;
  const cur = alive(s.budget).find((b) => b.categoriaId === categoriaId);
  const usual = usualSpending(s, categoriaId);
  let text = cur ? formatPlain(cur.importo) : '';
  const input = h('input', { class: 'amount-input small', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', value: text, 'aria-label': `Limite mensile per ${k.nome}`, onInput: () => { text = input.value; } });
  const body = h('div', { class: 'form' },
    h('p', { class: 'lead' }, `Quanto vuoi spendere al mese per ${k.emoji} ${k.nome}?`),
    h('div', { class: 'amount-wrap' }, input, h('span', { class: 'amount-cur', 'aria-hidden': 'true' }, currencySymbol())),
    usual > 0 && h('p', { class: 'field-hint' }, 'Di solito spendi circa ', h('button', { type: 'button', class: 'link', onClick: () => { input.value = formatPlain(Math.ceil(usual / 500) * 500); text = input.value; } }, fmt(usual, { force: true })), ' al mese. Tocca per usarlo (arrotondato).'));
  const save = () => {
    const v = parseAmount(text);
    if (text.trim() && (v === null || v < 0)) return errorToast(new Error('Scrivi un importo valido, per esempio 200.'));
    try {
      commit((st, now) => setBudget(st, categoriaId, v ?? 0, now));
      sheet.close();
      toast(v > 0 ? 'Limite salvato' : 'Limite tolto');
    } catch (e) { errorToast(e); }
  };
  const footer = [cur && h('button', { class: 'btn danger-text', type: 'button', onClick: () => { commit((st, now) => setBudget(st, categoriaId, 0, now)); sheet.close(); toast('Limite tolto', { action: { label: 'Annulla', onClick: () => undo() } }); } }, 'Togli il limite'), h('button', { class: 'btn primary', type: 'button', onClick: save }, 'Salva')];
  const sheet = openSheet({ title: cur ? 'Cambia il limite' : 'Nuovo limite', content: body, footer });
  setTimeout(() => input.focus(), 200);
}

async function addBudget() {
  const s = getState();
  const have = new Set(alive(s.budget).map((b) => b.categoriaId));
  const k = await pickCategory({ title: 'Per quale categoria?', tipo: 'spesa' });
  if (!k) return;
  if (have.has(k)) return openBudgetForm(k);
  openBudgetForm(k);
}

export function render() {
  const s = getState();
  const p = currentPeriod();
  const t = today();
  const b = budgetStatus(s, p, t);
  const prog = periodProgress(p, t);
  const root = h('div', { class: 'screen budget' }, h('header', { class: 'tab-head' }, h('h1', null, 'Budget'), h('button', { class: 'btn small primary', type: 'button', onClick: addBudget }, '＋ Limite')), periodBar());

  if (!b.righe.length) {
    root.append(card(null, emptyState('🎯', 'Metti un limite alle spese', 'Scegli quanto vuoi spendere al mese per Spesa alimentare, Svago, Ristoranti… e l’app ti avvisa quando stai per finirlo.', { label: '＋ Imposta il primo limite', onClick: addBudget })));
    return root;
  }
  root.append(card(null,
    h('div', { class: 'budget-total' }, h('span', null, 'In tutto'), h('strong', { class: b.totale.stato }, pct(b.totale.percento))),
    h('p', { class: 'big-line' }, fmt(b.totale.speso), h('small', null, ` su ${fmt(b.totale.limite)}`)),
    progress(b.totale.percento, b.totale.stato, 'Budget totale'),
    h('p', { class: 'muted' }, b.totale.rimanente >= 0 ? `Restano ${fmt(b.totale.rimanente)}${prog.remaining > 0 && t >= p.from && t <= p.to ? ` · ${prog.remaining} giorni alla fine` : ''}` : `Hai superato il totale di ${fmt(-b.totale.rimanente)}`)));

  const box = card({ class: 'flush' });
  const list = h('div', { class: 'list' });
  for (const r of b.righe) {
    const k = byId(s.categorie, r.categoriaId);
    list.append(h('div', { class: 'budget-row' },
      row({ icon: k.emoji, color: k.colore, title: k.nome, subtitle: STATE_TEXT[r.stato], right: `${fmt(r.speso)}`, rightSub: `su ${fmt(r.limite)}`, tone: r.stato === 'superato' ? 'neg' : '', onClick: () => openBudgetForm(r.categoriaId) }),
      h('div', { class: 'budget-bar' }, progress(r.percento, r.stato, `${k.nome} ${pct(r.percento)}`), h('p', { class: 'muted' }, r.rimanente >= 0 ? `Restano ${fmt(r.rimanente)}${r.alGiorno > 0 && t >= p.from && t <= p.to ? ` · circa ${fmt(r.alGiorno)} al giorno` : ''}` : `Oltre di ${fmt(-r.rimanente)}`))));
  }
  box.append(list);
  root.append(box);

  // spese senza limite
  const withBudget = new Set(b.righe.map((r) => r.categoriaId));
  const sum = summarize(s, p.from, p.to);
  const free = sum.perCategoria.filter((c) => c.categoriaId && !withBudget.has(c.categoriaId));
  if (free.length) {
    root.append(sectionTitle('Spese senza limite'), card({ class: 'flush' }, h('div', { class: 'list' }, free.slice(0, 8).map((c) => { const k = byId(s.categorie, c.categoriaId); return row({ icon: k?.emoji, color: k?.colore, title: k?.nome ?? '?', subtitle: 'Tocca per mettere un limite', right: fmt(c.totale), onClick: () => k && openBudgetForm(k.id) }); }))));
  }
  return root;
}
