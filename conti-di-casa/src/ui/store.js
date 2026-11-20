// Lo «stato» vivo dell'app: un oggetto solo, modificato con commit() (che salva e permette di annullare).

import { alive, createState, sanitizeState } from '../core/model.js';
import { todayISO } from '../core/dates.js';
import { periodOf, shiftPeriod } from '../core/periods.js';
import { dueDates, generateDue } from '../core/recurring.js';
import { dailyCopy, loadState, saveState } from '../storage.js';

let state = null;
let storageOk = true;
const listeners = new Set();
const undoStack = [];
const MAX_UNDO = 5;
let saveTimer = null;
let dirty = false;

/** Cosa si sta guardando (non si salva): di quanti periodi si è lontani da oggi, e se gli importi sono scoperti. */
export const view = { offset: 0, reveal: false };

export const getState = () => state;
export const hasState = () => state !== null;
export const storageWorks = () => storageOk;
export const today = () => todayISO();
export const settings = () => state.impostazioni;
export const startDay = () => state.impostazioni.inizioMese;

/** Il periodo (mese contabile) che si sta guardando. */
export function currentPeriod() {
  const base = periodOf(today(), startDay());
  return view.offset === 0 ? base : shiftPeriod(base, view.offset, startDay());
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => {
  for (const fn of [...listeners]) fn(state);
};

async function persist() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!dirty || !state) return;
  dirty = false;
  storageOk = await saveState(state);
  if (!storageOk) notify();
}
function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 120);
}
export const flush = persist;

/** Legge i dati salvati. Se non c'è nulla, `hasState()` resta falso e va fatta la prima configurazione. */
export async function init() {
  const raw = await loadState();
  if (raw) {
    state = sanitizeState(raw);
    dailyCopy(state, today());
  }
  return hasState();
}

/** Prima configurazione. */
export function setup({ famiglia, membro, valuta = 'EUR', conti = [] }) {
  const s = createState({ nome: famiglia || 'La mia famiglia', membro: membro || 'Io' });
  s.impostazioni.valuta = valuta;
  for (const c of s.conti) {
    const v = conti.find((x) => x.nome === c.nome);
    if (v?.saldoIniziale) c.saldoIniziale = v.saldoIniziale;
  }
  state = s;
  scheduleSave();
  void persist();
  notify();
}

/**
 * Cambia i dati: `fn(state, now)` modifica lo stato. Se lancia un errore, non cambia nulla.
 * @returns {*} quello che restituisce fn
 */
export function commit(fn, { undoable = true } = {}) {
  const before = structuredClone(state);
  let result;
  try {
    result = fn(state, Date.now());
  } catch (e) {
    state = before;
    throw e;
  }
  if (undoable) {
    undoStack.push(before);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }
  scheduleSave();
  notify();
  return result;
}

export const canUndo = () => undoStack.length > 0;
export function undo() {
  const prev = undoStack.pop();
  if (!prev) return false;
  state = prev;
  scheduleSave();
  notify();
  return true;
}

/** Primo avvio con una copia di sicurezza: prende quei dati così come sono. */
export function adopt(next) {
  state = sanitizeState(next);
  undoStack.length = 0;
  scheduleSave();
  void persist();
  notify();
}

/** Sostituisce tutti i dati (ripristino da copia). */
export function replaceState(next, { keepSecurity = true } = {}) {
  const clean = sanitizeState(next);
  if (keepSecurity && state?.impostazioni.pinHash) {
    const { pinHash, pinSalt, bloccoTelefono, bloccoAuto } = state.impostazioni;
    Object.assign(clean.impostazioni, { pinHash, pinSalt, bloccoTelefono, bloccoAuto });
  }
  undoStack.push(structuredClone(state));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  state = clean;
  scheduleSave();
  notify();
}

export function resetAll() {
  state = null;
  undoStack.length = 0;
  dirty = false;
  clearTimeout(saveTimer);
}

/** Registra le ricorrenze «da sole» arrivate a scadenza. @returns {number} quante */
export function runRecurring() {
  if (!state || !alive(state.ricorrenze).some((r) => r.autoRegistra && dueDates(state, r, today()).length)) return 0;
  let n = 0;
  commit((s, now) => {
    n = generateDue(s, today(), now).length;
  }, { undoable: false });
  // se non è cambiato nulla, commit ha comunque notificato: poco male (la schermata si ridisegna una volta)
  return n;
}

addEventListener?.('pagehide', () => void persist());
document?.addEventListener?.('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void persist();
});

/** Ridisegna senza cambiare i dati (per esempio dopo aver cambiato mese). */
export const refresh = notify;
