// Il menu «Altro»: tutte le pagine che non stanno nella barra in basso.

import { h } from '../dom.js';
import { card, fmt, row } from '../kit.js';
import { getState, today } from '../store.js';
import { alive } from '../../core/model.js';
import { netWorth } from '../../core/ledger.js';
import { upcoming } from '../../core/recurring.js';
import { go } from '../router.js';

export function render() {
  const s = getState();
  const due = upcoming(s, today(), 7).length;
  const items = [
    ['📊', 'Statistiche', 'Grafici e confronti', 'statistiche'],
    ['🏦', 'Conti', `${alive(s.conti).filter((c) => !c.archiviato).length} conti · ${fmt(netWorth(s))}`, 'conti'],
    ['👨‍👩‍👧', 'Famiglia', 'Chi spende cosa e chi deve a chi', 'famiglia'],
    ['🔁', 'Scadenze', due ? `${due} in arrivo questa settimana` : 'Affitto, bollette, abbonamenti', 'ricorrenti'],
    ['🎯', 'Obiettivi', `${alive(s.obiettivi).length || 'Nessun'} obiettiv${alive(s.obiettivi).length === 1 ? 'o' : 'i'} di risparmio`, 'obiettivi'],
    ['🏷️', 'Categorie', 'Spese ed entrate, regole automatiche', 'categorie'],
    ['💾', 'Dati e copie', 'Copia di sicurezza, Excel, importa dalla banca', 'dati'],
    ['⚙️', 'Impostazioni', 'Valuta, tema, PIN e blocco', 'impostazioni'],
  ];
  return h('div', { class: 'screen' }, h('header', { class: 'tab-head' }, h('h1', null, 'Altro')), card({ class: 'flush' }, h('div', { class: 'list' }, items.map(([icon, title, sub, to]) => row({ icon, title, subtitle: sub, right: '›', onClick: () => go(to) })))));
}
