// Impostazioni, cronologia e contatti: solo su questo dispositivo (localStorage), tolleranti agli errori.
const KEY = 'squillo:v1';
let cache = null;

function load() {
  if (cache) return cache;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    cache = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    cache = {};
  }
  return cache;
}

export const prefs = {
  get(k, d) {
    const v = load()[k];
    return v === undefined ? d : v;
  },
  set(k, v) {
    load()[k] = v;
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      /* spazio non disponibile (navigazione privata): vale per questa sessione */
    }
  },
  /** Solo per i test. */
  reset() {
    cache = null;
  },
};

export const MAX_RECENTS = 40;

/** Aggiunge una voce alla cronologia (la più recente in cima) e restituisce la lista nuova. */
export function addRecent(list, entry, max = MAX_RECENTS) {
  const clean = { code: String(entry.code), name: entry.name ? String(entry.name).slice(0, 40) : '', dir: entry.dir, ts: entry.ts ?? Date.now(), dur: Math.max(0, Math.round(entry.dur ?? 0)) };
  return [clean, ...(Array.isArray(list) ? list : [])].slice(0, max);
}

/** Nome da mostrare: quello che ho dato io, altrimenti quello dichiarato dall'altro, altrimenti il codice. */
export function displayName(code, contacts, recents, fmt) {
  const mine = contacts?.[code];
  if (mine) return mine;
  const seen = (recents ?? []).find((r) => r.code === code && r.name)?.name;
  return seen || fmt(code);
}
