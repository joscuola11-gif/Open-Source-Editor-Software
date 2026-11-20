// Schermata di blocco: PIN con tastierino, oppure il blocco del telefono (solo Android).

import { h } from '../dom.js';
import { confirmBox, errorToast } from '../kit.js';
import { getState, resetAll } from '../store.js';
import { verifyPin } from '../../core/pin.js';
import { canDeviceUnlock, deviceUnlock, isNative } from '../../platform.js';
import { wipeAll } from '../../storage.js';

let fails = 0;
let lockedUntil = 0;

export function renderLock({ onUnlock }) {
  const st = getState().impostazioni;
  const hasPin = Boolean(st.pinHash);
  const phone = st.bloccoTelefono && isNative() && canDeviceUnlock();
  let pin = '';
  let busy = false;
  const dots = h('div', { class: 'pin-dots', 'aria-hidden': 'true' });
  const msg = h('p', { class: 'pin-msg', role: 'status', 'aria-live': 'polite' });
  const paint = () => {
    dots.replaceChildren(...Array.from({ length: Math.max(4, pin.length) }, (_, i) => h('span', { class: `pin-dot ${i < pin.length ? 'on' : ''}` })));
  };

  async function submit() {
    if (busy || !pin) return;
    const wait = Math.ceil((lockedUntil - Date.now()) / 1000);
    if (wait > 0) { msg.textContent = `Troppi tentativi. Riprova fra ${wait} secondi.`; return; }
    busy = true;
    let ok = false;
    try { ok = await verifyPin(pin, st.pinSalt, st.pinHash); } catch { ok = false; }
    busy = false;
    if (ok) { fails = 0; onUnlock(); return; }
    fails += 1;
    pin = '';
    paint();
    if (fails >= 5) { lockedUntil = Date.now() + Math.min(300, 15 * 2 ** (fails - 5)) * 1000; msg.textContent = 'PIN sbagliato. Hai fatto troppi tentativi: aspetta un po’.'; } else msg.textContent = `PIN sbagliato (${fails}/5)`;
    navigator.vibrate?.(60);
  }
  const press = (d) => { if (pin.length < 8) { pin += d; msg.textContent = ''; paint(); } };
  const key = (label, fn, aria) => h('button', { class: 'key', type: 'button', 'aria-label': aria ?? label, onClick: fn }, label);
  const pad = h('div', { class: 'keypad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, () => press(d))),
    key('⌫', () => { pin = pin.slice(0, -1); paint(); }, 'Cancella'), key('0', () => press('0')), key('✓', submit, 'Conferma'));

  async function phoneUnlock() {
    try { await deviceUnlock(); onUnlock(); } catch (e) { if (!/annullat/i.test(e.message)) errorToast(e); }
  }
  async function forgot() {
    if (!(await confirmBox({ title: 'PIN dimenticato?', message: 'Per entrare senza PIN bisogna cancellare tutti i dati di questo telefono. Poi potrai ripristinare una copia di sicurezza (se ne hai una). Vuoi cancellare tutto?', ok: 'Cancella tutto', danger: true }))) return;
    await wipeAll();
    resetAll();
    location.hash = '#/home';
    location.reload();
  }
  const root = h('div', { class: 'lock', role: 'main' },
    h('div', { class: 'lock-card' }, h('div', { class: 'lock-logo', 'aria-hidden': 'true' }, '🏠'), h('h1', null, 'Conti di Casa'), h('p', { class: 'muted' }, hasPin ? 'Scrivi il tuo PIN' : 'Sblocca per entrare'),
      hasPin ? [dots, msg, pad] : null,
      phone ? h('button', { class: 'btn primary block', type: 'button', onClick: phoneUnlock }, '🔓 Sblocca con il telefono') : null,
      hasPin ? h('button', { class: 'link small', type: 'button', onClick: forgot }, 'PIN dimenticato?') : null));
  paint();
  addEventListener('keydown', function onKey(e) {
    if (!root.isConnected) return removeEventListener('keydown', onKey);
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') { pin = pin.slice(0, -1); paint(); } else if (e.key === 'Enter') submit();
  });
  if (phone && !hasPin) setTimeout(phoneUnlock, 300);
  return root;
}
