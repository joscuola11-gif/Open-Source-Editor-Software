// Unire i dati di due telefoni (marito e moglie): ogni elemento ha un `id` e un'ultima modifica `u`; vince la modifica più recente,
// una cancellazione più recente vince su una modifica più vecchia. L'unione è «sicura»: l'ordine non conta e rifarla non cambia nulla.

import { sanitizeState } from './model.js';

const KEYS = ['membri', 'conti', 'categorie', 'movimenti', 'budget', 'ricorrenze', 'obiettivi', 'regolamenti', 'regole'];

const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

/** Fra due versioni dello stesso elemento: la più recente; a parità, una scelta fissa (così A+B = B+A). */
function pick(a, b) {
  if (a.u !== b.u) return a.u > b.u ? a : b;
  return stable(a) >= stable(b) ? a : b;
}

/**
 * @param {object} local stato di questo telefono
 * @param {object} remote stato arrivato da un altro telefono
 * @param {{keepLocalSettings?: boolean}} o di base il PIN e il blocco restano quelli di questo telefono
 * @returns {{stato: object, riepilogo: {aggiunti: number, aggiornati: number, cancellati: number, ripristinati: number}}}
 */
export function mergeStates(local, remote, { keepLocalSettings = true } = {}) {
  const a = sanitizeState(local);
  const b = sanitizeState(remote);
  const out = { ...a };
  const riepilogo = { aggiunti: 0, aggiornati: 0, cancellati: 0, ripristinati: 0 };
  for (const key of KEYS) {
    const map = new Map(a[key].map((x) => [x.id, x]));
    for (const r of b[key]) {
      const l = map.get(r.id);
      if (!l) {
        map.set(r.id, r);
        if (!r.x) riepilogo.aggiunti++;
        continue;
      }
      const w = pick(l, r);
      if (w === r && stable(l) !== stable(r)) {
        if (r.x && !l.x) riepilogo.cancellati++;
        else if (!r.x && l.x) riepilogo.ripristinati++;
        else riepilogo.aggiornati++;
      }
      map.set(r.id, w);
    }
    out[key] = [...map.values()].sort((x, y) => (x.id < y.id ? -1 : 1));
  }
  const fam = pick({ ...a.famiglia }, { ...b.famiglia });
  out.famiglia = fam;
  const settings = keepLocalSettings ? { ...a.impostazioni } : pick(a.impostazioni, b.impostazioni);
  // tema e valuta seguono il più recente, la sicurezza (PIN, blocco) resta locale
  if (keepLocalSettings && b.impostazioni.u > a.impostazioni.u) Object.assign(settings, { valuta: b.impostazioni.valuta, inizioMese: b.impostazioni.inizioMese });
  out.impostazioni = settings;
  return { stato: sanitizeState(out), riepilogo };
}

/** Forma canonica per confrontare due stati (elenchi ordinati per id). */
export function canonical(state) {
  const s = sanitizeState(state);
  for (const k of KEYS) s[k] = [...s[k]].sort((x, y) => (x.id < y.id ? -1 : 1));
  return s;
}
