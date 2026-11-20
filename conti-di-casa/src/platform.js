// Il ponte con Android (se l'app è dentro l'APK) o con il browser. Tutto il resto dell'app non sa dove gira.
// In Android la classe Java espone `ContiNativo` (vedi android/.../MainActivity.java); le risposte tornano in `__nativeResult`.

const native = () => globalThis.ContiNativo ?? null;
let seq = 0;
let busyUntil = 0;

/** Quando si apre una schermata di sistema (scelta file, blocco del telefono) l'app va in pausa: al ritorno non va bloccata. */
export const markBusy = (ms = 600_000) => { busyUntil = Date.now() + ms; };
/** Vero (una sola volta) se si torna da una schermata di sistema aperta dall'app. */
export function consumeBusy() {
  const was = Date.now() < busyUntil;
  busyUntil = 0;
  return was;
}
const pending = new Map();

globalThis.__nativeResult = (id, ok, data) => {
  const p = pending.get(String(id));
  if (!p) return;
  markBusy(2000);
  pending.delete(String(id));
  if (ok) p.resolve(data);
  else p.reject(new Error(data || 'Operazione annullata.'));
};

function call(fn) {
  return new Promise((resolve, reject) => {
    const id = String(++seq);
    markBusy();
    pending.set(id, { resolve, reject });
    try {
      fn(id);
    } catch (e) {
      pending.delete(id);
      reject(e);
    }
  });
}

export const isNative = () => Boolean(native());
export const appVersion = typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__;

export function canDeviceUnlock() {
  try {
    return Boolean(native()?.canUnlock());
  } catch {
    return false;
  }
}

/** Chiede il blocco schermo del telefono (PIN, sequenza, impronta). Risolve a true se riuscito. */
export async function deviceUnlock() {
  if (!native()) throw new Error('Il blocco del telefono funziona solo nell’app Android.');
  await call((id) => native().unlock(id));
  return true;
}

/** Impedisce schermate e anteprima nelle app recenti (solo Android). */
export function setSecure(on) {
  try {
    native()?.setSecure(Boolean(on));
  } catch { /* non è grave */ }
}

/** Salva un file di testo: in Android si sceglie la cartella, nel browser parte il download. @returns {Promise<string>} come è andata */
export async function saveTextFile(name, mime, text) {
  if (native()) {
    await call((id) => native().saveFile(id, name, mime, text));
    return 'salvato';
  }
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'scaricato';
}

/** Manda un testo ad altre app (WhatsApp, e-mail…). */
export async function shareText(title, text) {
  if (native()) {
    await call((id) => native().shareText(id, title, text));
    return 'condiviso';
  }
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return 'condiviso';
    } catch (e) {
      if (e?.name === 'AbortError') throw new Error('Operazione annullata.');
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copiato';
  } catch {
    throw new Error('Non riesco a condividere: copia il testo a mano.');
  }
}

/** Fa scegliere un file di testo (copia, CSV). Risolve a {name, text} o a null se si annulla. */
export function pickTextFile(accept = '.json,.csv,.txt,text/*,application/json') {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept });
    input.style.display = 'none';
    markBusy();
    document.body.append(input);
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      markBusy(2000);
      input.remove();
      fn();
    };
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return finish(() => resolve(null));
      if (file.size > 25 * 1024 * 1024) return finish(() => reject(new Error('Il file è troppo grande (più di 25 MB).')));
      try {
        const text = await file.text();
        finish(() => resolve({ name: file.name, text }));
      } catch {
        finish(() => reject(new Error('Non riesco a leggere il file.')));
      }
    });
    input.addEventListener('cancel', () => finish(() => resolve(null)));
    input.click();
  });
}
