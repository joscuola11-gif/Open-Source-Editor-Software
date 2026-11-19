// Preferenze dell'interfaccia (tema, zoom, ecc.) in localStorage, tollerante agli errori.
const KEY = 'ciak-studio:prefs';
let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
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
      /* storage non disponibile: la preferenza vale per la sessione */
    }
  },
};
