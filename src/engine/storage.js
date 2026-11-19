// Persistenza in IndexedDB: progetto corrente (JSON) e file multimediali (Blob).
// Se IndexedDB non è disponibile (navigazione privata, blocco) l'app funziona comunque, senza recupero.

const DB_NAME = 'ciak-studio';
const DB_VERSION = 2;

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
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects'); // «I miei progetti»: istantanee con nome
          if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates'); // modelli creati dall'utente
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

  // ---- I miei progetti (istantanee: il JSON del progetto; i file restano nell'archivio `media`, condivisi per id) ----
  /** Elenco senza il JSON completo (leggero), dal più recente. */
  async listProjects() {
    if (!this.available) return [];
    const all = (await this.#tx('projects', 'readonly', (s) => s.getAll())) ?? [];
    return all.map(({ project, ...rest }) => ({ ...rest, mediaIds: Object.keys(project?.media ?? {}) })).sort((a, b) => b.updated - a.updated);
  }
  async getProjectEntry(id) {
    if (!this.available) return null;
    return (await this.#tx('projects', 'readonly', (s) => s.get(id))) ?? null;
  }
  async putProjectEntry(entry) {
    if (!this.available) return false;
    await this.#tx('projects', 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(entry)), entry.id));
    return true;
  }
  async deleteProjectEntry(id) {
    if (!this.available) return;
    await this.#tx('projects', 'readwrite', (s) => s.delete(id));
  }

  // ---- Modelli dell'utente ----
  async listTemplates() {
    if (!this.available) return [];
    return ((await this.#tx('templates', 'readonly', (s) => s.getAll())) ?? []).sort((a, b) => b.updated - a.updated);
  }
  async putTemplate(t) {
    if (!this.available) return false;
    await this.#tx('templates', 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(t)), t.id));
    return true;
  }
  async deleteTemplate(id) {
    if (!this.available) return;
    await this.#tx('templates', 'readwrite', (s) => s.delete(id));
  }

  /** Elimina i media non referenziati dal progetto corrente (`keepIds`) né da alcun progetto salvato. */
  async gc(keepIds) {
    const keep = new Set(keepIds);
    if (this.available) for (const e of (await this.#tx('projects', 'readonly', (s) => s.getAll())) ?? []) for (const id of Object.keys(e.project?.media ?? {})) keep.add(id);
    for (const id of await this.mediaIds()) if (!keep.has(id)) await this.deleteMedia(id);
  }

  /** Dimenticare il progetto di lavoro (non quelli salvati nell'elenco). */
  async clearWorking() {
    if (!this.available) return;
    await this.#tx('meta', 'readwrite', (s) => s.clear());
  }

  /** Cancella tutto, elenco compreso (solo per le prove). */
  async clearAll() {
    if (!this.available) return;
    for (const st of ['meta', 'media', 'projects', 'templates']) await this.#tx(st, 'readwrite', (s) => s.clear());
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
