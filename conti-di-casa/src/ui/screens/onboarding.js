// Primo avvio: due domande e si parte.

import { h } from '../dom.js';
import { chips, currencySymbol, errorToast, field } from '../kit.js';
import { adopt, setup } from '../store.js';
import { CURRENCIES, parseAmount } from '../../core/money.js';
import { readBackup } from '../../core/backup.js';
import { pickTextFile } from '../../platform.js';

export function renderOnboarding() {
  const f = { famiglia: '', membro: '', valuta: 'EUR', contanti: '', corrente: '' };
  const inp = (key, props) => { const i = h('input', { type: 'text', autocomplete: 'off', ...props, onInput: () => { f[key] = i.value; } }); return i; };
  const cur = h('select', { 'aria-label': 'Valuta', onChange: () => { f.valuta = cur.value; } }, Object.entries(CURRENCIES).map(([k, v]) => h('option', { value: k, selected: k === f.valuta }, v)));
  const start = () => {
    try {
      const c = f.contanti.trim() ? parseAmount(f.contanti) : 0;
      const b = f.corrente.trim() ? parseAmount(f.corrente) : 0;
      if (c === null || b === null) throw new Error('Una delle cifre non è valida. Scrivi per esempio 120,50 (o lascia vuoto).');
      setup({ famiglia: f.famiglia.trim() || 'La mia famiglia', membro: f.membro.trim() || 'Io', valuta: f.valuta, conti: [{ nome: 'Contanti', saldoIniziale: c }, { nome: 'Conto corrente', saldoIniziale: b }] });
    } catch (e) { errorToast(e); }
  };
  const restore = async () => {
    try {
      const file = await pickTextFile('.json,application/json,text/plain');
      if (!file) return;
      adopt(readBackup(file.text).stato);
    } catch (e) { errorToast(e); }
  };
  return h('div', { class: 'onboarding' },
    h('div', { class: 'onb-hero' }, h('div', { class: 'lock-logo', 'aria-hidden': 'true' }, '🏠'), h('h1', null, 'Conti di Casa'), h('p', null, 'Le spese e i conti di famiglia, in modo semplice. I dati restano sul tuo telefono.')),
    h('div', { class: 'form card' },
      field('Come si chiama la famiglia?', inp('famiglia', { placeholder: 'Per esempio: Famiglia Rossi', maxlength: 60 })),
      field('Il tuo nome', inp('membro', { placeholder: 'Per esempio: Maria', maxlength: 40 })),
      field('Valuta', cur),
      h('p', { class: 'field-label' }, 'Quanto c’è adesso? (puoi lasciare vuoto)'),
      field('💵 Contanti', inp('contanti', { inputmode: 'decimal', placeholder: '0,00' })),
      field('🏦 Conto corrente', inp('corrente', { inputmode: 'decimal', placeholder: '0,00' })),
      h('button', { class: 'btn primary block big', type: 'button', onClick: start }, 'Cominciamo'),
      h('button', { class: 'btn block', type: 'button', onClick: restore }, 'Ho già una copia di sicurezza')),
    h('p', { class: 'muted center' }, 'Potrai aggiungere altri conti e altri familiari in qualsiasi momento.'));
}
