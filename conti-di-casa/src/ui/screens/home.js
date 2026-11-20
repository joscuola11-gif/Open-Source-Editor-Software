// La pagina iniziale: a che punto siamo questo mese.

import { h } from '../dom.js';
import { card, emptyState, errorToast, fmt, periodBar, progress, row, sectionTitle, toast } from '../kit.js';
import { commit, currentPeriod, getState, today, undo, view, refresh } from '../store.js';
import { alive, byId } from '../../core/model.js';
import { netWorth } from '../../core/ledger.js';
import { sortedTransactions } from '../../core/ledger.js';
import { summarize, compare } from '../../core/stats.js';
import { budgetStatus } from '../../core/budgets.js';
import { upcoming, registerOccurrence } from '../../core/recurring.js';
import { memberBalances, settlements } from '../../core/splits.js';
import { goalProgress } from '../../core/goals.js';
import { formatDate, diffDays, relativeDay } from '../../core/dates.js';
import { periodProgress, shiftPeriod } from '../../core/periods.js';
import { donut } from '../charts.js';
import { go } from '../router.js';
import { txRow } from '../txrow.js';
import { openTxForm } from './txform.js';
import { pref } from '../../storage.js';

const pctText = (p) => `${String(Math.round(p)).replace('.', ',')}%`;

export function render() {
  const s = getState();
  const p = currentPeriod();
  const t = today();
  const sum = summarize(s, p.from, p.to);
  const hidden = s.impostazioni.nascondiImporti;
  const eye = h('button', { class: 'icon-btn', type: 'button', 'aria-label': view.reveal ? 'Nascondi gli importi' : 'Mostra gli importi', 'aria-pressed': String(!hidden || view.reveal), onClick: () => { view.reveal = !view.reveal; refresh(); } }, view.reveal || !hidden ? '👁️' : '🙈');
  const root = h('div', { class: 'screen home' },
    h('header', { class: 'home-head' }, h('div', null, h('p', { class: 'hello' }, 'Ciao 👋'), h('h1', null, s.famiglia.nome)), eye),
    periodBar());

  // patrimonio e riepilogo
  const worth = netWorth(s, view.offset < 0 ? { upTo: p.to } : {});
  const hero = card({ class: 'hero' },
    h('p', { class: 'hero-label' }, view.offset < 0 ? 'Patrimonio a fine periodo' : 'Quanto abbiamo adesso'),
    h('p', { class: 'hero-amount' }, fmt(worth)),
    h('div', { class: 'hero-grid' },
      h('div', null, h('span', { class: 'hero-sub' }, 'Entrate'), h('strong', { class: 'pos' }, fmt(sum.entrate))),
      h('div', null, h('span', { class: 'hero-sub' }, 'Uscite'), h('strong', { class: 'neg' }, fmt(sum.uscite))),
      h('div', null, h('span', { class: 'hero-sub' }, 'Risparmio'), h('strong', { class: sum.saldo < 0 ? 'neg' : 'pos' }, fmt(sum.saldo, { sign: true })))));
  const prev = summarize(s, shiftPeriod(p, -1, s.impostazioni.inizioMese).from, shiftPeriod(p, -1, s.impostazioni.inizioMese).to);
  if (prev.uscite > 0 && sum.uscite > 0) {
    const c = compare(sum.uscite, prev.uscite);
    if (c.percento !== null) hero.append(h('p', { class: 'hero-note' }, c.delta > 0 ? `↑ Hai speso il ${pctText(Math.abs(c.percento))} in più del periodo scorso` : c.delta < 0 ? `↓ Hai speso il ${pctText(Math.abs(c.percento))} in meno del periodo scorso` : 'Hai speso come il periodo scorso'));
  }
  root.append(hero);

  if (!alive(s.movimenti).length) {
    root.append(card(null, emptyState('📝', 'Cominciamo!', 'Scrivi la prima spesa o la prima entrata: ci vogliono pochi secondi.', { label: '＋ Aggiungi un movimento', onClick: () => openTxForm() })));
    return root;
  }

  // scadenze
  const due = upcoming(s, t, 14).filter((u) => u.giorni <= Math.max(u.ricorrenza.avvisoGiorni ?? 3, 0) || u.stato !== 'presto');
  if (due.length) {
    const box = card(null, sectionTitle('Da pagare', { label: 'Tutte', onClick: () => go('ricorrenti') }));
    for (const u of due.slice(0, 4)) {
      const r = u.ricorrenza;
      const k = byId(s.categorie, r.categoriaId);
      box.append(row({
        icon: k?.emoji ?? '🔁', color: k?.colore, title: r.nome,
        subtitle: u.stato === 'scaduta' ? `Scaduta ${Math.abs(u.giorni) === 1 ? 'ieri' : `${Math.abs(u.giorni)} giorni fa`}` : u.stato === 'oggi' ? 'Scade oggi' : `${relativeDay(u.data, t)}`, tone: u.stato === 'scaduta' ? 'neg' : '',
        right: fmt(r.tipo === 'entrata' ? r.importo : -r.importo), rightSub: h('button', { class: 'btn small primary', type: 'button', onClick: (e) => { e.stopPropagation(); pay(r.id, u.data, r.tipo); } }, r.tipo === 'entrata' ? 'Incassata' : 'Pagata'),
      }));
    }
    root.append(box);
  }

  // budget
  const b = budgetStatus(s, p, t);
  if (b.righe.length) {
    const prog = periodProgress(p, t);
    const box = card({ class: 'tappable' }, sectionTitle('Budget', { label: 'Vedi', onClick: () => go('budget') }),
      h('div', { class: 'budget-total' }, h('span', null, `Speso ${fmt(b.totale.speso)} su ${fmt(b.totale.limite)}`), h('strong', { class: b.totale.stato }, pctText(b.totale.percento))),
      progress(b.totale.percento, b.totale.stato, 'Budget totale'),
      h('p', { class: 'muted' }, b.totale.rimanente >= 0 ? `Restano ${fmt(b.totale.rimanente)}${prog.remaining > 0 && view.offset === 0 ? ` per ${prog.remaining} giorni` : ''}` : `Sei oltre di ${fmt(-b.totale.rimanente)}`));
    for (const r of b.righe.filter((x) => x.stato !== 'ok').slice(0, 3)) {
      const k = byId(s.categorie, r.categoriaId);
      box.append(row({ icon: k?.emoji, color: k?.colore, title: k?.nome, subtitle: r.stato === 'superato' ? 'Budget superato' : 'Quasi finito', right: pctText(r.percento), tone: r.stato === 'superato' ? 'neg' : 'warn' }));
    }
    root.append(box);
  }

  // dove vanno i soldi
  if (sum.perCategoria.length) {
    const top = sum.perCategoria.slice(0, 5);
    const rest = sum.perCategoria.slice(5).reduce((a, c) => a + c.totale, 0);
    const slices = top.map((c) => ({ valore: c.totale, colore: byId(s.categorie, c.categoriaId)?.colore ?? '#8d99a0' }));
    if (rest) slices.push({ valore: rest, colore: '#c3cbd0' });
    root.append(card(null, sectionTitle('Dove vanno i soldi', { label: 'Statistiche', onClick: () => go('statistiche') }),
      h('div', { class: 'cat-mini' },
        donut(slices, { size: 132, thickness: 20, centerTop: fmt(sum.uscite), centerBottom: 'spesi', label: `Spese per categoria: ${top.map((c) => `${byId(s.categorie, c.categoriaId)?.nome ?? 'Senza categoria'} ${pctText(c.percento)}`).join(', ')}` }),
        h('ul', { class: 'legend' }, top.map((c) => { const k = byId(s.categorie, c.categoriaId); return h('li', null, h('span', { class: 'dot', style: { background: k?.colore ?? '#8d99a0' } }), h('span', { class: 'legend-name' }, `${k?.emoji ?? '🧾'} ${k?.nome ?? 'Senza categoria'}`), h('strong', null, fmt(c.totale))); })))));
  }

  // debiti in famiglia
  const sett = settlements(memberBalances(s));
  if (sett.length) {
    const x = sett[0];
    root.append(card({ class: 'tappable' }, sectionTitle('In famiglia', { label: 'Dettagli', onClick: () => go('famiglia') }),
      h('p', null, `${byId(s.membri, x.da)?.nome ?? '?'} deve ${fmt(x.importo)} a ${byId(s.membri, x.a)?.nome ?? '?'}${sett.length > 1 ? ` (e altri ${sett.length - 1} pagament${sett.length > 2 ? 'i' : 'o'})` : ''}`)));
  }

  // obiettivi
  const goals = alive(s.obiettivi).map((g) => ({ g, p: goalProgress(g, t) })).filter((x) => x.p.stato !== 'raggiunto').slice(0, 2);
  if (goals.length) {
    root.append(card(null, sectionTitle('Obiettivi', { label: 'Vedi', onClick: () => go('obiettivi') }),
      goals.map(({ g, p: gp }) => h('div', { class: 'goal-mini' }, row({ icon: g.emoji, title: g.nome, subtitle: `${fmt(gp.versato)} di ${fmt(g.importo)}`, right: pctText(gp.percento), onClick: () => go('obiettivi') }), progress(gp.percento, 'ok', g.nome)))));
  }

  // ultimi movimenti
  const last = sortedTransactions(s).slice(0, 6);
  root.append(card({ class: 'flush' }, h('div', { class: 'pad' }, sectionTitle('Ultimi movimenti', { label: 'Tutti', onClick: () => go('movimenti') })), h('div', { class: 'list' }, last.map((x) => txRow(s, x, { onClick: () => openTxForm({ id: x.id }) })))));

  // promemoria copia di sicurezza
  const lastBackup = pref.get('ultimaCopia');
  if (alive(s.movimenti).length >= 15 && (!lastBackup || diffDays(t, lastBackup) > 30)) {
    root.append(card({ class: 'notice' }, h('p', null, h('strong', null, '💾 Fai una copia di sicurezza'), h('br'), lastBackup ? `L’ultima è del ${formatDate(lastBackup, 'long')}.` : 'Non ne hai ancora fatta nessuna.', ' Se perdi il telefono, senza copia perdi i conti.'),
      h('button', { class: 'btn small', type: 'button', onClick: () => go('dati') }, 'Fai la copia')));
  }
  return root;
}

function pay(recId, date, tipo) {
  try {
    commit((s, now) => registerOccurrence(s, recId, date, now));
    toast(tipo === 'entrata' ? 'Entrata registrata' : 'Pagamento registrato', { action: { label: 'Annulla', onClick: () => undo() } });
  } catch (e) {
    errorToast(e);
  }
}
