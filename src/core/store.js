// Store del progetto con undo/redo a snapshot e "gesture" (modifiche continue come trascinamenti
// e slider che producono UNA sola voce di cronologia).
//
// Il progetto è trattato come immutabile: ogni modifica lavora su un clone e, se la bozza non è
// valida o l'operazione lancia, la bozza viene scartata e lo stato precedente resta intatto.

import { EditError, Emitter, deepClone } from './util.js';
import { validateProject } from './timeline.js';

const MAX_HISTORY = 100;

export class Store extends Emitter {
  #project;
  #undo = [];
  #redo = [];
  #gesture = null;
  #coalesce = { key: null, at: 0 };
  /** Contatore incrementato a ogni cambiamento (utile per autosave e indicatori). */
  revision = 0;
  /** Revisione dell'ultimo salvataggio avvenuto con successo. */
  savedRevision = 0;

  constructor(project) {
    super();
    this.#project = project;
  }

  get project() {
    return this.#project;
  }
  get canUndo() {
    return this.#undo.length > 0;
  }
  get canRedo() {
    return this.#redo.length > 0;
  }
  get dirty() {
    return this.revision !== this.savedRevision;
  }
  get undoLabel() {
    return this.#undo.at(-1)?.label ?? null;
  }
  get redoLabel() {
    return this.#redo.at(-1)?.label ?? null;
  }
  get inGesture() {
    return this.#gesture !== null;
  }

  /** Sostituisce il progetto (apri/nuovo) azzerando la cronologia. */
  replace(project, { markSaved = true } = {}) {
    this.#gesture = null;
    this.#project = project;
    this.#undo = [];
    this.#redo = [];
    this.#coalesce = { key: null, at: 0 };
    this.revision++;
    if (markSaved) this.savedRevision = this.revision;
    this.emit('change', { kind: 'replace' });
  }

  markSaved(rev = this.revision) {
    this.savedRevision = rev;
  }

  #run(fn) {
    const draft = deepClone(this.#project);
    const result = fn(draft);
    const errs = validateProject(draft);
    if (errs.length) throw new EditError(`Stato non valido: ${errs[0]}`);
    return { draft, result };
  }

  /**
   * Applica una modifica atomica. `fn(draft)` può lanciare EditError per annullare.
   * Restituisce {ok, result, error}.
   * `coalesce` = chiave: modifiche consecutive con la stessa chiave entro 800 ms si fondono.
   */
  commit(label, fn, { coalesce } = {}) {
    if (this.#gesture) this.cancelGesture();
    let out;
    try {
      out = this.#run(fn);
    } catch (e) {
      if (e instanceof EditError) return { ok: false, error: e.message };
      throw e;
    }
    const now = Date.now();
    const merge = coalesce && this.#coalesce.key === coalesce && now - this.#coalesce.at < 800 && this.#undo.length > 0;
    if (!merge) {
      this.#undo.push({ label, project: this.#project });
      if (this.#undo.length > MAX_HISTORY) this.#undo.shift();
    }
    this.#coalesce = { key: coalesce ?? null, at: now };
    this.#redo = [];
    this.#project = out.draft;
    this.revision++;
    this.emit('change', { kind: 'commit', label });
    return { ok: true, result: out.result };
  }

  undo() {
    if (this.#gesture) this.cancelGesture();
    const prev = this.#undo.pop();
    if (!prev) return false;
    this.#redo.push({ label: prev.label, project: this.#project });
    this.#project = prev.project;
    this.#coalesce = { key: null, at: 0 };
    this.revision++;
    this.emit('change', { kind: 'undo', label: prev.label });
    return true;
  }

  redo() {
    if (this.#gesture) this.cancelGesture();
    const next = this.#redo.pop();
    if (!next) return false;
    this.#undo.push({ label: next.label, project: this.#project });
    this.#project = next.project;
    this.#coalesce = { key: null, at: 0 };
    this.revision++;
    this.emit('change', { kind: 'redo', label: next.label });
    return true;
  }

  /**
   * Inizia un gesto: ogni `preview(fn)` riparte dal progetto di partenza, quindi il risultato è
   * funzione pura del movimento del puntatore. `commitGesture()` crea una sola voce di cronologia.
   */
  beginGesture(label) {
    if (this.#gesture) this.cancelGesture();
    this.#gesture = { label, base: this.#project, changed: false };
  }

  /** Aggiorna l'anteprima del gesto. Restituisce {ok,error}; se non valida mantiene l'ultimo stato buono. */
  previewGesture(fn) {
    const g = this.#gesture;
    if (!g) return { ok: false, error: 'nessun gesto attivo' };
    let out;
    try {
      const draft = deepClone(g.base);
      const result = fn(draft);
      const errs = validateProject(draft);
      if (errs.length) throw new EditError(errs[0]);
      out = { draft, result };
    } catch (e) {
      if (e instanceof EditError) return { ok: false, error: e.message };
      throw e;
    }
    g.changed = true;
    this.#project = out.draft;
    this.revision++;
    this.emit('change', { kind: 'gesture', label: g.label });
    return { ok: true, result: out.result };
  }

  commitGesture() {
    const g = this.#gesture;
    if (!g) return false;
    this.#gesture = null;
    if (!g.changed) return false;
    this.#undo.push({ label: g.label, project: g.base });
    if (this.#undo.length > MAX_HISTORY) this.#undo.shift();
    this.#redo = [];
    this.#coalesce = { key: null, at: 0 };
    this.emit('change', { kind: 'commit', label: g.label });
    return true;
  }

  cancelGesture() {
    const g = this.#gesture;
    if (!g) return;
    this.#gesture = null;
    if (g.changed) {
      this.#project = g.base;
      this.revision++;
      this.emit('change', { kind: 'cancel' });
    }
  }
}

/** Selezione di clip, fuori dalla cronologia. */
export class Selection extends Emitter {
  #ids = [];
  get ids() {
    return this.#ids;
  }
  get size() {
    return this.#ids.length;
  }
  get primary() {
    return this.#ids.at(-1) ?? null;
  }
  has(id) {
    return this.#ids.includes(id);
  }
  set(ids) {
    const next = [...new Set(ids)];
    if (next.length === this.#ids.length && next.every((v, i) => v === this.#ids[i])) return;
    this.#ids = next;
    this.emit('change');
  }
  clear() {
    this.set([]);
  }
  toggle(id) {
    this.set(this.has(id) ? this.#ids.filter((x) => x !== id) : [...this.#ids, id]);
  }
  add(id) {
    if (!this.has(id)) this.set([...this.#ids, id]);
  }
  /** Rimuove gli id che non esistono più nel progetto. */
  sanitize(project) {
    const alive = new Set();
    for (const t of project.tracks) for (const c of t.clips) alive.add(c.id);
    this.set(this.#ids.filter((id) => alive.has(id)));
  }
}
