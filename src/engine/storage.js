// Persistenza in IndexedDB: progetto corrente (JSON) e file multimediali (Blob).
// Se IndexedDB non è disponibile (navigazione privata, blocco) l'app funziona comunque, senza recupero.

const DB_NAME = 'ciak-studio';
const DB_VERSION = 1;

export class Storage {
  #db = null;
  available = false;

  async open() {
    if (typeof indexedDB === 'undefined') return false;
    try {
      this.#db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
          if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('database bloccato'));
      });
      this.#db.onversionchange = () => this.#db?.close();
      this.available = true;
    } catch (e) {
      console.warn('[storage] IndexedDB non disponibile', e);
      this.available = false;
    }
    return this.available;
  }

  #tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction(store, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('transazione annullata'));
      const r = fn(tx.objectStore(store));
      if (r) r.onsuccess = () => (result = r.result);
    });
  }

  async saveProject(project) {
    if (!this.available) return false;
    await this.#tx('meta', 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(project)), 'project'));
    return true;
  }
  async loadProject() {
    if (!this.available) return null;
    return (await this.#tx('meta', 'readonly', (s) => s.get('project'))) ?? null;
  }

  async putMedia(id, blob) {
    if (!this.available) return false;
    await this.#tx('media', 'readwrite', (s) => s.put(blob, id));
    return true;
  }
  async getMedia(id) {
    if (!this.available) return null;
    return (await this.#tx('media', 'readonly', (s) => s.get(id))) ?? null;
  }
  async deleteMedia(id) {
    if (!this.available) return;
    await this.#tx('media', 'readwrite', (s) => s.delete(id));
  }
  async mediaIds() {
    if (!this.available) return [];
    return (await this.#tx('media', 'readonly', (s) => s.getAllKeys())) ?? [];
  }

  /** Elimina i media non più referenziati (da chiamare a cronologia vuota). */
  async gc(keepIds) {
    const keep = new Set(keepIds);
    for (const id of await this.mediaIds()) if (!keep.has(id)) await this.deleteMedia(id);
  }

  async clearAll() {
    if (!this.available) return;
    await this.#tx('meta', 'readwrite', (s) => s.clear());
    await this.#tx('media', 'readwrite', (s) => s.clear());
  }

  async estimate() {
    try {
      const e = await navigator.storage?.estimate?.();
      return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
    } catch {
      return null;
    }
  }

  /** Chiede al browser di non cancellare i dati sotto pressione di spazio. */
  async persist() {
    try {
      return (await navigator.storage?.persist?.()) ?? false;
    } catch {
      return false;
    }
  }
}
