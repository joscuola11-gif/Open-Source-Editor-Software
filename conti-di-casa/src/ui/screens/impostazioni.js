// Impostazioni: nome, valuta, mese, aspetto, privacy e blocco.

import { h } from '../dom.js';
import { card, confirmBox, errorToast, field, openSheet, pageHeader, sectionTitle, segmented, switchRow, toast, row } from '../kit.js';
import { commit, getState, refresh } from '../store.js';
import { CURRENCIES } from '../../core/money.js';
import { hashPin, isValidPin, makeSalt, verifyPin } from '../../core/pin.js';
import { appVersion, canDeviceUnlock, deviceUnlock, isNative, setSecure } from '../../platform.js';
import { applyTheme } from '../theme.js';

const setSetting = (patch) => commit((s, now) => { Object.assign(s.impostazioni, patch); s.impostazioni.u = now; }, { undoable: false });
const AUTO = [[0, 'Subito'], [30, 'Dopo 30 secondi'], [60, 'Dopo 1 minuto'], [300, 'Dopo 5 minuti'], [900, 'Dopo 15 minuti']];

function openPinForm({ change = false } = {}) {
  const s = getState();
  const f = { old: '', a: '', b: '' };
  const mk = (label, key, ph) => { const i = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 8, autocomplete: 'off', placeholder: ph, 'aria-label': label, onInput: () => { f[key] = i.value.replace(/\D/g, ''); i.value = f[key]; } }); return field(label, i); };
  const body = h('div', { class: 'form' }, change && mk('PIN attuale', 'old', '••••'), mk(change ? 'Nuovo PIN (da 4 a 8 cifre)' : 'Scegli un PIN (da 4 a 8 cifre)', 'a', '••••'), mk('Scrivilo ancora', 'b', '••••'),
    h('p', { class: 'muted' }, 'Il PIN tiene lontano chi prende il tuo telefono sbloccato. Non cifra i dati e, se lo dimentichi, per rientrare devi cancellare tutto e ripristinare una copia: tieni sempre una copia di sicurezza.'));
  const save = async () => {
    try {
      if (change && !(await verifyPin(f.old, s.impostazioni.pinSalt, s.impostazioni.pinHash))) throw new Error('Il PIN attuale non è giusto.');
      if (!isValidPin(f.a)) throw new Error('Il PIN deve avere da 4 a 8 cifre.');
      if (f.a !== f.b) throw new Error('I due PIN non sono uguali.');
      const salt = makeSalt();
      const hash = await hashPin(f.a, salt);
      setSetting({ pinHash: hash, pinSalt: salt });
      setSecure(true);
      sheet.close();
      toast(change ? 'PIN cambiato ✓' : 'PIN attivato ✓');
    } catch (e) { errorToast(e); }
  };
  const sheet = openSheet({ title: change ? 'Cambia PIN' : 'Attiva il PIN', content: body, footer: [h('button', { class: 'btn primary', type: 'button', onClick: save }, 'Salva')] });
}

function openRemovePin() {
  const s = getState();
  let pin = '';
  const i = h('input', { type: 'password', inputmode: 'numeric', maxlength: 8, autocomplete: 'off', placeholder: '••••', 'aria-label': 'PIN attuale', onInput: () => { pin = i.value.replace(/\D/g, ''); i.value = pin; } });
  const save = async () => {
    if (!(await verifyPin(pin, s.impostazioni.pinSalt, s.impostazioni.pinHash))) return errorToast(new Error('Il PIN non è giusto.'));
    setSetting({ pinHash: '', pinSalt: '', ...(s.impostazioni.bloccoTelefono ? {} : {}) });
    if (!getState().impostazioni.bloccoTelefono) setSecure(false);
    sheet.close();
    toast('PIN tolto');
  };
  const sheet = openSheet({ title: 'Togli il PIN', content: h('div', { class: 'form' }, field('Scrivi il PIN attuale', i)), footer: [h('button', { class: 'btn danger', type: 'button', onClick: save }, 'Togli il PIN')] });
}

export function render() {
  const s = getState();
  const st = s.impostazioni;
  const hasPin = Boolean(st.pinHash);
  const name = h('input', { type: 'text', maxlength: 60, value: s.famiglia.nome, autocomplete: 'off', 'aria-label': 'Nome della famiglia', onChange: () => { const v = name.value.trim(); if (v) commit((x, now) => { x.famiglia.nome = v.slice(0, 60); x.famiglia.u = now; }, { undoable: false }); } });
  const cur = h('select', { 'aria-label': 'Valuta', onChange: () => setSetting({ valuta: cur.value }) }, Object.entries(CURRENCIES).map(([k, v]) => h('option', { value: k, selected: k === st.valuta }, v)));
  const day = h('select', { 'aria-label': 'Giorno di inizio del mese', onChange: () => setSetting({ inizioMese: Number(day.value) }) }, Array.from({ length: 28 }, (_, i) => h('option', { value: i + 1, selected: i + 1 === st.inizioMese }, i === 0 ? '1 (mese normale)' : String(i + 1))));
  const auto = h('select', { 'aria-label': 'Blocca dopo', onChange: () => setSetting({ bloccoAuto: Number(auto.value) }) }, AUTO.map(([v, l]) => h('option', { value: v, selected: v === st.bloccoAuto }, l)));
  const root = h('div', { class: 'screen' }, pageHeader({ title: 'Impostazioni' }));
  root.append(card(null, sectionTitle('Generali'), field('Nome della famiglia', name), field('Valuta', cur), field('Il mese comincia il giorno', day, 'Se lo stipendio arriva il 27, scegli 27: i mesi andranno dal 27 al 26.')));
  root.append(card(null, sectionTitle('Aspetto'), h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Tema'), segmented({ items: [{ value: 'auto', label: 'Come il telefono' }, { value: 'chiaro', label: 'Chiaro' }, { value: 'scuro', label: 'Scuro' }], value: st.tema, label: 'Tema', onChange: (v) => { setSetting({ tema: v }); applyTheme(); } })),
    switchRow({ label: 'Nascondi gli importi', hint: 'Al posto delle cifre compaiono dei puntini; tocca l’occhio nella Home per vederle', checked: st.nascondiImporti, onChange: (v) => setSetting({ nascondiImporti: v }) })));
  const sec = card(null, sectionTitle('Sicurezza'));
  sec.append(row({ icon: hasPin ? '🔒' : '🔓', title: hasPin ? 'PIN attivo' : 'PIN non attivo', subtitle: hasPin ? 'Ti viene chiesto quando apri l’app' : 'Chiunque apra l’app vede i conti', onClick: hasPin ? null : () => openPinForm() }));
  if (hasPin) sec.append(h('div', { class: 'btn-row pad' }, h('button', { class: 'btn small', type: 'button', onClick: () => openPinForm({ change: true }) }, 'Cambia PIN'), h('button', { class: 'btn small danger-text', type: 'button', onClick: openRemovePin }, 'Togli PIN')));
  else sec.append(h('div', { class: 'pad' }, h('button', { class: 'btn small primary', type: 'button', onClick: () => openPinForm() }, 'Attiva il PIN')));
  if (isNative() && canDeviceUnlock()) {
    sec.append(switchRow({ label: 'Sblocca con il blocco del telefono', hint: 'Impronta, volto, sequenza o PIN del telefono', checked: st.bloccoTelefono, onChange: async (v) => {
      if (v) {
        try { await deviceUnlock(); } catch (e) { errorToast(e); return refresh(); }
      } else if (!(await confirmBox({ title: 'Togliere il blocco del telefono?', message: hasPin ? 'Resterà solo il PIN dell’app.' : 'L’app non sarà più protetta.', ok: 'Togli' }))) return refresh();
      setSetting({ bloccoTelefono: v });
      setSecure(v || hasPin);
      toast(v ? 'Blocco del telefono attivato ✓' : 'Blocco del telefono tolto');
    } }));
  } else if (isNative()) sec.append(h('p', { class: 'field-hint pad' }, 'Per usare il blocco del telefono, attivane uno nelle impostazioni di Android (PIN, sequenza o impronta).'));
  if (hasPin || st.bloccoTelefono) sec.append(field('Blocca l’app', auto, 'Quando esci dall’app e torni dopo questo tempo, serve di nuovo lo sblocco.'));
  root.append(sec);
  root.append(card(null, sectionTitle('Informazioni'), h('p', null, h('strong', null, 'Conti di Casa'), ` · versione ${appVersion}`),
    h('p', { class: 'muted' }, 'I tuoi dati stanno solo su questo telefono: l’app non usa internet e non manda niente a nessuno. Per non perderli, fai ogni tanto una copia di sicurezza (Altro → Dati e copie).'),
    h('p', { class: 'muted' }, 'Software libero con licenza MIT. Il blocco con PIN protegge dall’occhio curioso, non cifra i dati.')));
  return root;
}
