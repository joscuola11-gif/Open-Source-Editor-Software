// Statistiche: dove vanno i soldi, come cambiano nel tempo, chi spende cosa.

import { h } from '../dom.js';
import { card, chips, emptyState, fmt, pageHeader, periodBar, progress, row, sectionTitle, segmented } from '../kit.js';
import { currentPeriod, getState, startDay, today, view } from '../store.js';
import { alive, byId } from '../../core/model.js';
import { summarize, compareWithPrevious, periodSeries, projection, topExpenses, dailyAverage, netWorthSeries } from '../../core/stats.js';
import { netWorth } from '../../core/ledger.js';
import { periodProgress, shiftPeriod, periodOf } from '../../core/periods.js';
import { MONTHS_SHORT, parseISO, formatDate } from '../../core/dates.js';
import { barPairs, donut, lineChart } from '../charts.js';
import { go } from '../router.js';
import { setFilters } from './movimenti.js';
import { openTxForm } from './txform.js';
import { txTitle } from '../txrow.js';

const ui = { modo: 'spesa', n: 6, sel: -1 };
const pct = (p) => `${String(Math.round(p * 10) / 10).replace('.', ',')}%`;

export function render() {
  const s = getState();
  const p = currentPeriod();
  const t = today();
  const sum = summarize(s, p.from, p.to);
  const root = h('div', { class: 'screen stats' }, pageHeader({ title: 'Statistiche' }), periodBar());
  if (!sum.movimenti && !alive(s.movimenti).length) return root.append(card(null, emptyState('📊', 'Ancora niente da mostrare', 'Appena inserisci qualche movimento qui vedrai i grafici.'))) || root;

  // riepilogo e confronto
  const cmp = compareWithPrevious(s, p.from, startDay());
  const prog = periodProgress(p, t);
  const running = t >= p.from && t <= p.to;
  const sub = [];
  if (cmp.uscite.percento !== null && cmp.precedente.uscite > 0) sub.push(`Spese ${cmp.uscite.delta >= 0 ? '+' : '−'}${pct(Math.abs(cmp.uscite.percento))} rispetto al periodo prima`);
  const avg = dailyAverage(s, p.from, p.to, t);
  if (avg > 0) sub.push(`In media ${fmt(avg)} al giorno`);
  if (running && prog.elapsed > 0 && sum.uscite > 0 && prog.remaining > 0) sub.push(`Di questo passo a fine periodo avrai speso circa ${fmt(projection(sum.uscite, prog.elapsed, prog.total))}`);
  root.append(card(null,
    h('div', { class: 'hero-grid flat' },
      h('div', null, h('span', { class: 'hero-sub' }, 'Entrate'), h('strong', { class: 'pos' }, fmt(sum.entrate))),
      h('div', null, h('span', { class: 'hero-sub' }, 'Uscite'), h('strong', { class: 'neg' }, fmt(sum.uscite))),
      h('div', null, h('span', { class: 'hero-sub' }, 'Risparmio'), h('strong', { class: sum.saldo < 0 ? 'neg' : 'pos' }, fmt(sum.saldo, { sign: true })))),
    sub.length > 0 && h('ul', { class: 'notes' }, sub.map((x) => h('li', null, x)))));

  // categorie
  const list = ui.modo === 'spesa' ? sum.perCategoria : sum.perCategoriaEntrate;
  const total = ui.modo === 'spesa' ? sum.uscite : sum.entrate;
  const catBox = card(null, sectionTitle('Per categoria'), segmented({ items: [{ value: 'spesa', label: 'Spese' }, { value: 'entrata', label: 'Entrate' }], value: ui.modo, label: 'Spese o entrate', onChange: (v) => { ui.modo = v; import('../store.js').then((m) => m.refresh()); } }));
  if (!list.length) catBox.append(h('p', { class: 'muted pad-top' }, 'Niente in questo periodo.'));
  else {
    const slices = list.slice(0, 8).map((c) => ({ valore: c.totale, colore: byId(s.categorie, c.categoriaId)?.colore ?? '#8d99a0' }));
    const rest = list.slice(8).reduce((a, c) => a + c.totale, 0);
    if (rest) slices.push({ valore: rest, colore: '#c3cbd0' });
    catBox.append(h('div', { class: 'donut-wrap' }, donut(slices, { size: 170, thickness: 24, centerTop: fmt(total), centerBottom: ui.modo === 'spesa' ? 'spesi' : 'incassati', label: `${ui.modo === 'spesa' ? 'Spese' : 'Entrate'} per categoria` })));
    const ul = h('div', { class: 'list' });
    for (const c of list) {
      const k = byId(s.categorie, c.categoriaId);
      ul.append(row({ icon: k?.emoji ?? '🧾', color: k?.colore, title: k?.nome ?? 'Senza categoria', subtitle: pct(c.percento), right: fmt(c.totale), onClick: () => { setFilters({ categorie: [c.categoriaId ?? ''], tipo: ui.modo }); go('movimenti'); } }));
    }
    catBox.append(ul);
  }
  root.append(catBox);

  // andamento nel tempo
  const series = periodSeries(s, p.from, ui.n, startDay());
  const sel = ui.sel >= 0 && ui.sel < series.length ? ui.sel : series.length - 1;
  const caption = h('p', { class: 'chart-caption', 'aria-live': 'polite' });
  const paintCaption = (i) => { const x = series[i]; caption.replaceChildren(h('strong', null, x.periodo.label.split(' (')[0]), ` · entrate ${fmt(x.entrate)} · uscite ${fmt(x.uscite)} · `, h('strong', { class: x.saldo < 0 ? 'neg' : 'pos' }, fmt(x.saldo, { sign: true }))); };
  const chartWrap = h('div', { class: 'chart-wrap' });
  const paintChart = (i) => { chartWrap.replaceChildren(barPairs(series.map((x) => ({ etichetta: MONTHS_SHORT[parseISO(x.periodo.to).m - 1], a: x.entrate, b: x.uscite, aria: `${x.periodo.label}: entrate ${fmt(x.entrate)}, uscite ${fmt(x.uscite)}` })), { selected: i, label: 'Entrate e uscite per periodo', onSelect: (j) => { ui.sel = j; paintChart(j); paintCaption(j); } })); };
  paintChart(sel);
  paintCaption(sel);
  root.append(card(null, sectionTitle('Nel tempo'), segmented({ items: [{ value: 6, label: '6 mesi' }, { value: 12, label: '12 mesi' }], value: ui.n, label: 'Quanti mesi', onChange: (v) => { ui.n = v; ui.sel = -1; import('../store.js').then((m) => m.refresh()); } }),
    chartWrap, h('div', { class: 'legend inline' }, h('span', null, h('i', { class: 'dot income' }), ' Entrate'), h('span', null, h('i', { class: 'dot expense' }), ' Uscite')), caption));

  // per persona
  const members = alive(s.membri).filter((m) => !m.archiviato || sum.perMembro.some((x) => x.membroId === m.id));
  if (members.length > 1 && sum.perMembro.length) {
    const box = card(null, sectionTitle('Chi ha speso'));
    for (const m of sum.perMembro) {
      const mem = byId(s.membri, m.membroId);
      box.append(h('div', { class: 'bar-row' }, row({ icon: mem?.emoji ?? '❔', color: mem?.colore, title: mem?.nome ?? 'Non indicato', subtitle: pct(m.percento), right: fmt(m.totale) }), progress(m.percento, 'ok', mem?.nome ?? '')));
    }
    root.append(box);
  }

  // per conto
  if (sum.perConto.length > 1) {
    const box = card(null, sectionTitle('Da quale conto'));
    for (const c of sum.perConto) {
      const a = byId(s.conti, c.contoId);
      box.append(h('div', { class: 'bar-row' }, row({ icon: a?.emoji, color: a?.colore, title: a?.nome ?? '?', subtitle: pct(c.percento), right: fmt(c.totale) }), progress(c.percento, 'ok', a?.nome ?? '')));
    }
    root.append(box);
  }

  // spese più grandi
  const top = topExpenses(s, p.from, p.to, 5);
  if (top.length) root.append(card({ class: 'flush' }, h('div', { class: 'pad' }, sectionTitle('Le spese più grandi')), h('div', { class: 'list' }, top.map((x) => { const k = byId(s.categorie, x.categoriaId); return row({ icon: k?.emoji ?? '🧾', color: k?.colore, title: txTitle(s, x), subtitle: formatDate(x.data, 'short', t), right: fmt(-x.importo), tone: 'neg', onClick: () => openTxForm({ id: x.id }) }); }))));

  // patrimonio
  const nw = netWorthSeries(s, p.to, ui.n, startDay(), (st, upTo) => netWorth(st, { upTo }));
  if (nw.length > 1 && alive(s.movimenti).length) root.append(card(null, sectionTitle('Patrimonio nel tempo'), lineChart(nw.map((x) => x.valore), nw.map((x) => MONTHS_SHORT[parseISO(x.periodo.to).m - 1]), { label: `Patrimonio: da ${fmt(nw[0].valore, { force: true })} a ${fmt(nw[nw.length - 1].valore, { force: true })}` }),
    h('p', { class: 'muted' }, `Oggi: ${fmt(netWorth(s))}`)));
  return root;
}
