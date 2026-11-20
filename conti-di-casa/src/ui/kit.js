// Mattoncini dell'interfaccia: fogli a comparsa, avvisi, campi, pulsanti a scelta, barre di avanzamento.

import { h } from './dom.js';
import { formatAmount } from '../core/money.js';
import { currentPeriod, getState, refresh, view } from './store.js';
import { back } from './router.js';

// ---- importi ------------------------------------------------------------------------------------------------------

export const currency = () => getState()?.impostazioni.valuta ?? 'EUR';
export const currencySymbol = () => formatAmount(0, { currency: currency() }).replace(/[\d.,\s ]/g, '') || currency();
const hidden = () => Boolean(getState()?.impostazioni.nascondiImporti) && !view.reveal;

/** Un importo scritto bene («1.234,56 €»), o puntini se gli importi sono nascosti. */
export function fmt(cents, { sign = false, force = false } = {}) {
  if (hidden() && !force) return `•••• ${currencySymbol()}`;
  return formatAmount(cents, { currency: currency(), sign });
}

export const hiddenAmounts = hidden;

// ---- elementi piccoli ---------------------------------------------------------------------------------------------

export const card = (props, ...children) => h('section', { ...props, class: `card ${props?.class ?? ''}`.trim() }, ...children);

export function sectionTitle(text, action) {
  return h('div', { class: 'section-title' }, h('h2', null, text), action && h('button', { class: 'link', type: 'button', onClick: action.onClick }, action.label));
}

export function emptyState(emoji, title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-emoji', 'aria-hidden': 'true' }, emoji), h('h3', null, title), text && h('p', null, text),
    action && h('button', { class: 'btn primary', type: 'button', onClick: action.onClick }, action.label));
}

export function row({ icon, color, title, subtitle, right, rightSub, onClick, tone, badge }) {
  const content = [
    icon !== undefined && h('span', { class: 'row-icon', style: color ? { background: `${color}22`, color } : null, 'aria-hidden': 'true' }, icon),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title, badge && h('span', { class: `badge ${badge.tone ?? ''}` }, badge.text)), subtitle && h('span', { class: 'row-sub' }, subtitle)),
    (right !== undefined || rightSub) && h('span', { class: 'row-right' }, right !== undefined && h('span', { class: `row-amount ${tone ?? ''}` }, right), rightSub && h('span', { class: 'row-sub' }, rightSub)),
  ];
  return onClick ? h('button', { class: 'row', type: 'button', onClick }, content) : h('div', { class: 'row' }, content);
}

/** Barra di avanzamento: stato = 'ok' | 'attenzione' | 'superato' */
export function progress(percent, stato = 'ok', label = '') {
  const p = Math.max(0, Math.min(100, percent));
  return h('div', { class: `progress ${stato}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(percent), 'aria-label': label || undefined }, h('div', { class: 'progress-bar', style: { width: `${p}%` } }));
}

// ---- campi --------------------------------------------------------------------------------------------------------

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint && h('span', { class: 'field-hint' }, hint));
}

export function textInput(props) {
  return h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'sentences', ...props });
}

/**
 * Scelta fra più voci come «bottoncini».
 * items: [{value, label, emoji?, color?}]; value: valore (o lista, se multi)
 */
export function chips({ items, value, onChange, multi = false, label }) {
  const cur = multi ? new Set(value ?? []) : new Set([value]);
  const wrap = h('div', { class: 'chips', role: multi ? 'group' : 'radiogroup', 'aria-label': label });
  const buttons = new Map();
  const paint = () => {
    for (const [v, b] of buttons) {
      const on = cur.has(v);
      b.classList.toggle('on', on);
      b.setAttribute(multi ? 'aria-pressed' : 'aria-checked', String(on));
    }
  };
  for (const it of items) {
    const b = h('button', {
      type: 'button', class: `chip${!it.label && !it.emoji ? ' swatch' : ''}`, role: multi ? undefined : 'radio', 'aria-label': it.label || it.color || undefined, dataset: { value: String(it.value) },
      style: it.color ? { '--chip': it.color } : null,
      onClick: () => {
        if (multi) {
          if (cur.has(it.value)) cur.delete(it.value);
          else cur.add(it.value);
          onChange?.([...cur]);
        } else {
          cur.clear();
          cur.add(it.value);
          onChange?.(it.value);
        }
        paint();
      },
    }, it.emoji && h('span', { class: 'chip-emoji', 'aria-hidden': 'true' }, it.emoji), it.label);
    buttons.set(it.value, b);
    wrap.append(b);
  }
  paint();
  wrap.set = (v) => {
    cur.clear();
    for (const x of multi ? v ?? [] : [v]) cur.add(x);
    paint();
  };
  return wrap;
}

/** Scelta fra poche voci in una barra (Spesa | Entrata | Giroconto). */
export function segmented({ items, value, onChange, label }) {
  const wrap = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  const buttons = new Map();
  const paint = (v) => {
    for (const [k, b] of buttons) {
      b.classList.toggle('on', k === v);
      b.setAttribute('aria-checked', String(k === v));
    }
  };
  for (const it of items) {
    const b = h('button', { type: 'button', role: 'radio', class: `seg ${it.tone ?? ''}`, dataset: { value: String(it.value) }, onClick: () => { paint(it.value); onChange?.(it.value); } }, it.label);
    buttons.set(it.value, b);
    wrap.append(b);
  }
  paint(value);
  wrap.set = paint;
  return wrap;
}

export function switchRow({ label, hint, checked, onChange }) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked: Boolean(checked), onChange: () => onChange?.(input.checked) });
  return h('label', { class: 'switch-row' }, h('span', { class: 'switch-text' }, h('span', { class: 'switch-label' }, label), hint && h('span', { class: 'field-hint' }, hint)), input, h('span', { class: 'switch', 'aria-hidden': 'true' }));
}

// ---- fogli a comparsa ---------------------------------------------------------------------------------------------

const sheets = [];

function lockBody(on) {
  document.documentElement.classList.toggle('sheet-open', on);
}

/**
 * Apre un foglio dal basso.
 * @returns {{close: Function, el: HTMLElement, body: HTMLElement}}
 */
export function openSheet({ title, content, footer, onClose, wide = false, label }) {
  const opener = document.activeElement;
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Chiudi', onClick: () => close() }, '✕');
  const body = h('div', { class: 'sheet-body' }, content);
  const panel = h('div', { class: `sheet ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': label ?? title, tabindex: -1 },
    h('header', { class: 'sheet-head' }, h('h2', null, title), closeBtn), body, footer && h('footer', { class: 'sheet-foot' }, footer));
  const backdrop = h('div', { class: 'backdrop', onClick: (e) => { if (e.target === backdrop) close(); } }, panel);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    const i = sheets.indexOf(entry);
    if (i >= 0) sheets.splice(i, 1);
    backdrop.classList.add('leaving');
    setTimeout(() => backdrop.remove(), 160);
    lockBody(sheets.length > 0);
    try { opener?.focus?.({ preventScroll: true }); } catch { /* niente */ }
    onClose?.();
  }
  const entry = { close, el: backdrop };
  sheets.push(entry);
  document.body.append(backdrop);
  lockBody(true);
  requestAnimationFrame(() => backdrop.classList.add('shown'));
  panel.focus({ preventScroll: true });
  return { close, el: panel, body };
}

export const hasOpenSheet = () => sheets.length > 0;
export function closeTopSheet() {
  const top = sheets[sheets.length - 1];
  if (!top) return false;
  top.close();
  return true;
}
export function closeAllSheets() {
  for (const s of [...sheets].reverse()) s.close();
}

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && closeTopSheet()) e.preventDefault();
});

/** Domanda con due risposte. @returns {Promise<boolean>} */
export function confirmBox({ title, message, ok = 'Conferma', cancel = 'Annulla', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v) => {
      answered = true;
      sheet.close();
      resolve(v);
    };
    const sheet = openSheet({
      title, content: h('p', { class: 'dialog-text' }, message),
      footer: [h('button', { class: 'btn', type: 'button', onClick: () => answer(false) }, cancel), h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onClick: () => answer(true) }, ok)],
      onClose: () => { if (!answered) resolve(false); },
    });
    sheet.el.classList.add('dialog');
  });
}

// ---- avvisi -------------------------------------------------------------------------------------------------------

let toastTimer = null;
export function toast(message, { action, ms = 4500, tone = '' } = {}) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = h('div', { id: 'toasts', 'aria-live': 'polite', role: 'status' });
    document.body.append(box);
  }
  box.replaceChildren();
  clearTimeout(toastTimer);
  const t = h('div', { class: `toast ${tone}` }, h('span', null, message), action && h('button', { class: 'toast-action', type: 'button', onClick: () => { box.replaceChildren(); action.onClick(); } }, action.label));
  box.append(t);
  toastTimer = setTimeout(() => box.replaceChildren(), ms);
}

export function errorToast(e) {
  toast(String(e?.message ?? e), { tone: 'error', ms: 6000 });
}

// ---- intestazioni e periodo -------------------------------------------------------------------------------------

/** Titolo della pagina con freccia indietro (per le pagine che non sono le quattro principali). */
export function pageHeader({ title, fallback = 'altro', actions = [] }) {
  return h('header', { class: 'page-head' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Indietro', onClick: () => back(fallback) }, '←'),
    h('h1', null, title),
    h('div', { class: 'page-actions' }, actions));
}

/** Barra «‹ Novembre 2026 ›» per cambiare periodo (condivisa fra le pagine). */
export function periodBar() {
  const p = currentPeriod();
  const move = (n) => { view.offset += n; refresh(); };
  return h('div', { class: 'period-bar' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Periodo precedente', onClick: () => move(-1) }, '‹'),
    h('button', { class: 'period-label', type: 'button', 'aria-label': `${p.label}. Tocca per tornare a oggi`, onClick: () => { view.offset = 0; refresh(); } }, p.label, view.offset !== 0 && h('small', null, 'tocca per tornare a oggi')),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Periodo successivo', onClick: () => move(1) }, '›'));
}

export const EMOJIS = ['🏠', '🛒', '💡', '🚗', '⛽', '💊', '🎒', '🎬', '🍽️', '👕', '🎁', '🐶', '✈️', '🏛️', '🛡️', '📺', '🧾', '💼', '💰', '🧒', '🎓', '⚽', '🎮', '📱', '💻', '🧴', '🧹', '🔧', '🛠️', '🌳', '☕', '🍕', '🍼', '🚌', '🚲', '🏥', '🦷', '👓', '📚', '🎵', '🏖️', '🎂', '💍', '🐱', '🌱', '🔥', '💧', '📦', '🧾', '🎯', '🏦', '💳', '🐷', '📈', '👛', '🙂', '👩', '👨', '👧', '👦', '👵', '👴'];

/** Scelta di un'emoji da una griglia, con possibilità di scriverne una. */
export function emojiPicker({ value, onChange }) {
  const wrap = h('div', { class: 'emoji-picker' });
  const custom = h('input', { type: 'text', maxlength: 8, value: EMOJIS.includes(value) ? '' : value ?? '', placeholder: 'Altra…', 'aria-label': 'Scrivi un’emoji', onInput: () => { if (custom.value.trim()) { paint(null); onChange(custom.value.trim()); } } });
  const buttons = new Map();
  const paint = (v) => { for (const [e, b] of buttons) { b.classList.toggle('on', e === v); b.setAttribute('aria-pressed', String(e === v)); } };
  for (const e of EMOJIS) {
    const b = h('button', { type: 'button', class: 'emoji', onClick: () => { custom.value = ''; paint(e); onChange(e); } }, e);
    buttons.set(e, b);
    wrap.append(b);
  }
  wrap.append(custom);
  paint(value);
  return wrap;
}
