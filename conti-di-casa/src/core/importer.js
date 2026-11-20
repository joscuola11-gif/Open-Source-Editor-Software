// Importazione di estratti conto CSV: riconosce le colonne, capisce spese ed entrate, evita i doppioni e propone le categorie.

import { parseDateAny, todayISO } from './dates.js';
import { parseAmount } from './money.js';
import { suggestCategory, normalize } from './rules.js';
import { newId } from './model.js';

const NAMES = {
  data: ['data', 'date', 'data operazione', 'data contabile', 'data valuta', 'valuta', 'giorno', 'data movimento'],
  descrizione: ['descrizione', 'causale', 'dettagli', 'descrizione operazione', 'movimento', 'operazione', 'beneficiario', 'description', 'memo', 'nome', 'esercente', 'descrizione estesa'],
  importo: ['importo', 'amount', 'valore', 'importo eur', 'importo euro', 'cifra', 'totale'],
  entrate: ['entrate', 'avere', 'accrediti', 'accredito', 'credit', 'incoming', 'dare/avere avere'],
  uscite: ['uscite', 'dare', 'addebiti', 'addebito', 'debit', 'outgoing', 'spese'],
  categoria: ['categoria', 'category'],
  tipo: ['tipo', 'segno', 'type'],
  note: ['note', 'notes', 'nota'],
  conto: ['conto', 'account'],
  membro: ['membro', 'chi', 'persona'],
};

const clean = (s) => normalize(s);

/** Indovina quale colonna è quale guardando l'intestazione. @returns {Record<string, number>} nome → indice colonna (solo quelle trovate) */
export function detectMapping(header) {
  const map = {};
  const h = header.map(clean);
  for (const [field, names] of Object.entries(NAMES)) {
    const exact = h.findIndex((c, i) => names.map(clean).includes(c) && !Object.values(map).includes(i));
    if (exact >= 0) { map[field] = exact; continue; }
    const part = h.findIndex((c, i) => c && names.some((n) => clean(n).length >= 4 && c.includes(clean(n))) && !Object.values(map).includes(i));
    if (part >= 0) map[field] = part;
  }
  return map;
}

/** La prima riga è un'intestazione? (nessuna cella è una data o un importo) */
export function hasHeader(rows) {
  const first = rows[0] ?? [];
  const isNumber = (c) => /^[-+−]?[\d.,]+\s*(€|eur)?$/i.test(c.trim()) && parseAmount(c) !== null;
  return first.length > 0 && !first.some((c) => parseDateAny(c) || isNumber(c));
}

function sameDescription(a, b) {
  const x = clean(a);
  const y = clean(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

/**
 * Trasforma le righe in movimenti pronti.
 * @param {string[][]} rows righe di dati (senza intestazione)
 * @param {Record<string, number>} mapping colonne (data, descrizione, importo | entrate+uscite, categoria?, tipo?, note?)
 * @param {{state: object, contoId: string, membroId?: string, invertSign?: boolean, today?: string}} o
 * @returns {{voci: Array<{riga:number, tx:object, doppione:boolean, categoriaSuggerita:object|null}>, errori: Array<{riga:number, motivo:string}>}}
 */
export function buildTransactions(rows, mapping, { state, contoId, membroId = null, invertSign = false, today = todayISO() }) {
  const voci = [];
  const errori = [];
  const existing = state.movimenti.filter((t) => !t.x && (t.contoId === contoId || t.contoA === contoId));
  const catByName = new Map(state.categorie.filter((k) => !k.x).map((k) => [`${k.tipo}:${clean(k.nome)}`, k]));
  rows.forEach((r, i) => {
    const riga = i + 1;
    const get = (f) => (mapping[f] != null ? (r[mapping[f]] ?? '').trim() : '');
    const data = parseDateAny(get('data'), { today });
    if (!data) return void errori.push({ riga, motivo: `Data non valida: «${get('data')}»` });
    let cents = null;
    if (mapping.importo != null) cents = parseAmount(get('importo'));
    if (cents === null && (mapping.entrate != null || mapping.uscite != null)) {
      const e = parseAmount(get('entrate'));
      const u = parseAmount(get('uscite'));
      if (e) cents = Math.abs(e);
      else if (u) cents = -Math.abs(u);
    }
    if (cents === null || cents === 0) return void errori.push({ riga, motivo: `Importo non valido: «${get('importo') || get('entrate') || get('uscite')}»` });
    if (invertSign) cents = -cents;
    const tipoCol = clean(get('tipo'));
    let tipo = cents < 0 ? 'spesa' : 'entrata';
    if (/^(entrata|accredito|avere|credit|income)/.test(tipoCol)) tipo = 'entrata';
    else if (/^(spesa|uscita|addebito|dare|debit|expense)/.test(tipoCol)) tipo = 'spesa';
    const importo = Math.abs(cents);
    const descrizione = get('descrizione').slice(0, 120);
    let cat = catByName.get(`${tipo}:${clean(get('categoria'))}`) ?? null;
    let suggerita = null;
    if (!cat) {
      const s = suggestCategory(state, descrizione, tipo);
      if (s) suggerita = s;
    }
    const tx = { id: newId('t'), tipo, data, importo, contoId, descrizione, note: get('note').slice(0, 500), ...(cat ? { categoriaId: cat.id } : suggerita ? { categoriaId: suggerita.categoriaId } : {}), ...(membroId ? { membroId } : {}) };
    // doppione = c'è già nel libro (importato due volte lo stesso estratto); due righe uguali nello stesso file sono due acquisti diversi
    const doppione = existing.some((t) => t.tipo === tipo && t.data === data && t.importo === importo && sameDescription(t.descrizione, descrizione));
    voci.push({ riga, tx, doppione, categoriaSuggerita: suggerita });
  });
  return { voci, errori };
}

