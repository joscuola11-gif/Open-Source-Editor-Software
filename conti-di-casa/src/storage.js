// Dove si salvano i dati sul telefono: IndexedDB (con ripiego su localStorage). Niente va su internet.

const DB_NAME = 'conti-di-casa';
const STORE = 'kv';
const KEY = 'stato';
const AUTO_KEY = 'copia-automatica';
const LS_KEY = 'conti-di-casa:stato';

let dbPromise = null;
function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB non disponibile'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database bloccato'));
  });
}
const db = () => (dbPromise ??= openDb().catch((e) => {
  dbPromise = null;
  throw e;
}));

async function idbGet(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result ?? null);
    r.onerror = () => reject(r.error);
  });
}
async function idbPut(key, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** I dati salvati, o null se è la prima volta. */
export async function loadState() {
  try {
    const v = await idbGet(KEY);
    if (v) return v;
  } catch { /* si prova l'altro posto */ }
  try {
    const t = localStorage.getItem(LS_KEY);
    if (t) return JSON.parse(t);
  } catch { /* niente */ }
  return null;
}

/** @returns {Promise<boolean>} true se salvato */
export async function saveState(state) {
  try {
    await idbPut(KEY, state);
    return true;
  } catch { /* ripiego */ }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Una copia automatica al giorno (rete di sicurezza contro errori e sbagli). */
export async function dailyCopy(state, today) {
  try {
    const old = await idbGet(AUTO_KEY);
    if (old?.giorno === today) return false;
    await idbPut(AUTO_KEY, { giorno: today, stato: state });
    return true;
  } catch {
    return false;
  }
}

export async function loadAutoCopy() {
  try {
    return await idbGet(AUTO_KEY);
  } catch {
    return null;
  }
}

export async function wipeAll() {
  try {
    const d = await db();
    await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* niente */ }
  try {
    localStorage.removeItem(LS_KEY);
  } catch { /* niente */ }
}

/** Piccole preferenze di comodo (ultimo conto usato, data dell'ultima copia): non sono dati importanti. */
export const pref = {
  get(k, d = null) {
    try {
      const v = localStorage.getItem(`cdc:${k}`);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`cdc:${k}`, JSON.stringify(v));
    } catch { /* niente */ }
  },
};
