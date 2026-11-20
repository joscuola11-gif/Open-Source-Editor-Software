// Dati dell'app: un solo oggetto «stato», tutto in centesimi e date AAAA-MM-GG.
// Ogni elemento ha `id` e `u` (ultima modifica, in millisecondi); un elemento cancellato resta con `x: true` (serve a unire i dati di due telefoni).

import { parseISO, isValidISO } from './dates.js';

export const VERSION = 1;
export const TX_TYPES = ['spesa', 'entrata', 'giroconto'];
export const ACCOUNT_TYPES = {
  contanti: { label: 'Contanti', emoji: '💵' },
  corrente: { label: 'Conto corrente', emoji: '🏦' },
  carta: { label: 'Carta di credito', emoji: '💳' },
  prepagata: { label: 'Carta prepagata', emoji: '💳' },
  risparmio: { label: 'Risparmio', emoji: '🐷' },
  investimenti: { label: 'Investimenti', emoji: '📈' },
  altro: { label: 'Altro', emoji: '👛' },
};
export const COLORS = ['#e4572e', '#f3a712', '#a8c686', '#29a19c', '#1982c4', '#6a4c93', '#d1478b', '#8d6a4f', '#5c6b73', '#2f9e44'];
export const UNITS = ['giorni', 'settimane', 'mesi', 'anni'];
export const THEMES = ['auto', 'chiaro', 'scuro'];

let idGen = null;
/** Per le prove: id prevedibili. */
export function setIdGenerator(fn) {
  idGen = fn;
}
let counter = 0;
export function newId(prefix = 'x') {
  if (idGen) return idGen(prefix);
  counter = (counter + 1) % 1679616;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36).padStart(4, '0')}${Math.floor(Math.random() * 46656).toString(36).padStart(3, '0')}`;
}

export const DEFAULT_CATEGORIES = [
  ['spesa', '🏠', 'Casa'], ['spesa', '🛒', 'Spesa alimentare'], ['spesa', '💡', 'Bollette'], ['spesa', '🚗', 'Trasporti'], ['spesa', '⛽', 'Carburante'],
  ['spesa', '💊', 'Salute'], ['spesa', '🎒', 'Scuola e figli'], ['spesa', '🎬', 'Svago'], ['spesa', '🍽️', 'Ristoranti e bar'], ['spesa', '👕', 'Abbigliamento'],
  ['spesa', '🎁', 'Regali'], ['spesa', '🐶', 'Animali'], ['spesa', '✈️', 'Viaggi'], ['spesa', '🏛️', 'Tasse'], ['spesa', '🛡️', 'Assicurazioni'],
  ['spesa', '📺', 'Abbonamenti'], ['spesa', '🧾', 'Altro'],
  ['entrata', '💼', 'Stipendio'], ['entrata', '🧒', 'Assegni e bonus'], ['entrata', '↩️', 'Rimborsi'], ['entrata', '🏘️', 'Affitti incassati'], ['entrata', '🎀', 'Regali ricevuti'], ['entrata', '💰', 'Altro'],
];

const num = (v, d, lo = -Infinity, hi = Infinity) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const int = (v, d, lo = -Infinity, hi = Infinity) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
const str = (v, d = '', max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : d);
const color = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : COLORS[0]);
const stamp = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const base = (r) => ({ id: str(r?.id, '', 60) || newId('i'), u: stamp(r?.u), ...(r?.x === true ? { x: true } : {}) });

export function createState({ nome = 'La mia famiglia', membro = 'Io', now = Date.now() } = {}) {
  const t = now;
  const membri = [{ id: newId('m'), nome: membro, colore: COLORS[0], emoji: '🙂', archiviato: false, u: t }];
  const conti = [
    { id: newId('c'), nome: 'Contanti', tipo: 'contanti', saldoIniziale: 0, emoji: ACCOUNT_TYPES.contanti.emoji, colore: COLORS[2], archiviato: false, nelTotale: true, membroId: null, u: t },
    { id: newId('c'), nome: 'Conto corrente', tipo: 'corrente', saldoIniziale: 0, emoji: ACCOUNT_TYPES.corrente.emoji, colore: COLORS[4], archiviato: false, nelTotale: true, membroId: null, u: t },
  ];
  const categorie = DEFAULT_CATEGORIES.map(([tipo, emoji, n], i) => ({ id: newId('k'), nome: n, tipo, emoji, colore: COLORS[i % COLORS.length], archiviata: false, u: t }));
  return {
    versione: VERSION,
    famiglia: { nome, u: t },
    membri,
    conti,
    categorie,
    movimenti: [],
    budget: [],
    ricorrenze: [],
    obiettivi: [],
    regolamenti: [],
    regole: [],
    impostazioni: { valuta: 'EUR', inizioMese: 1, tema: 'auto', nascondiImporti: false, pinHash: '', pinSalt: '', bloccoTelefono: false, bloccoAuto: 60, u: t },
  };
}

function sanitizeTx(r) {
  if (!r || typeof r !== 'object' || !TX_TYPES.includes(r.tipo)) return null;
  const importo = int(r.importo, 0);
  if (!isValidISO(r.data) || importo <= 0 || typeof r.contoId !== 'string' || !r.contoId) return null;
  const tx = { ...base(r), tipo: r.tipo, data: r.data, importo, contoId: r.contoId, descrizione: str(r.descrizione, '', 120), note: str(r.note, '', 500) };
  if (r.tipo === 'giroconto') {
    if (typeof r.contoA !== 'string' || !r.contoA || r.contoA === r.contoId) return null;
    tx.contoA = r.contoA;
  } else {
    if (typeof r.categoriaId === 'string' && r.categoriaId) tx.categoriaId = r.categoriaId;
  }
  if (typeof r.membroId === 'string' && r.membroId) tx.membroId = r.membroId;
  if (Array.isArray(r.tag)) tx.tag = r.tag.map((t) => str(t, '', 30)).filter(Boolean).slice(0, 8);
  if (typeof r.ricorrenteId === 'string' && r.ricorrenteId) tx.ricorrenteId = r.ricorrenteId;
  if (r.rettifica === true) tx.rettifica = true;
  const d = r.divisione;
  if (d && r.tipo === 'spesa' && typeof d.pagatoDa === 'string' && Array.isArray(d.quote)) {
    const quote = d.quote.filter((q) => q && typeof q.membroId === 'string' && Number.isInteger(q.importo) && q.importo >= 0);
    // le quote devono sommare esattamente l'importo, altrimenti la divisione si scarta (meglio nessuna divisione che una sbagliata)
    if (quote.length && quote.reduce((s, q) => s + q.importo, 0) === importo) tx.divisione = { pagatoDa: d.pagatoDa, quote: quote.map((q) => ({ membroId: q.membroId, importo: q.importo })) };
  }
  return tx;
}

function list(raw, fn) {
  return Array.isArray(raw) ? raw.map(fn).filter(Boolean) : [];
}

/** Rende valido qualunque cosa arrivi da un file o da una versione vecchia: scarta il marcio, corregge il resto, non lancia mai. */
export function sanitizeState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const s = createState({ now: 0 });
  const out = {
    versione: VERSION,
    famiglia: { nome: str(r.famiglia?.nome, s.famiglia.nome, 60) || s.famiglia.nome, u: stamp(r.famiglia?.u) },
    membri: list(r.membri, (m) => (m && typeof m === 'object' ? { ...base(m), nome: str(m.nome, 'Membro', 40) || 'Membro', colore: color(m.colore), emoji: str(m.emoji, '🙂', 8), archiviato: m.archiviato === true } : null)),
    conti: list(r.conti, (c) => (c && typeof c === 'object' ? {
      ...base(c), nome: str(c.nome, 'Conto', 50) || 'Conto', tipo: ACCOUNT_TYPES[c.tipo] ? c.tipo : 'altro', saldoIniziale: int(c.saldoIniziale, 0, -9e11, 9e11), emoji: str(c.emoji, '👛', 8),
      colore: color(c.colore), archiviato: c.archiviato === true, nelTotale: c.nelTotale !== false, membroId: typeof c.membroId === 'string' && c.membroId ? c.membroId : null,
    } : null)),
    categorie: list(r.categorie, (k) => (k && typeof k === 'object' && (k.tipo === 'spesa' || k.tipo === 'entrata') ? { ...base(k), nome: str(k.nome, 'Categoria', 40) || 'Categoria', tipo: k.tipo, emoji: str(k.emoji, '🧾', 8), colore: color(k.colore), archiviata: k.archiviata === true } : null)),
    movimenti: list(r.movimenti, sanitizeTx),
    budget: list(r.budget, (b) => (b && typeof b === 'object' && typeof b.categoriaId === 'string' && int(b.importo, 0) > 0 ? { ...base(b), categoriaId: b.categoriaId, importo: int(b.importo, 0) } : null)),
    ricorrenze: list(r.ricorrenze, (c) => {
      if (!c || typeof c !== 'object' || !TX_TYPES.includes(c.tipo) || !isValidISO(c.inizio) || int(c.importo, 0) <= 0 || typeof c.contoId !== 'string' || !c.contoId) return null;
      if (c.tipo === 'giroconto' && (typeof c.contoA !== 'string' || !c.contoA || c.contoA === c.contoId)) return null;
      return {
        ...base(c), nome: str(c.nome, 'Ricorrente', 60) || 'Ricorrente', tipo: c.tipo, importo: int(c.importo, 0), contoId: c.contoId, ...(c.tipo === 'giroconto' ? { contoA: c.contoA } : {}),
        ...(typeof c.categoriaId === 'string' && c.categoriaId ? { categoriaId: c.categoriaId } : {}), ...(typeof c.membroId === 'string' && c.membroId ? { membroId: c.membroId } : {}),
        ogni: int(c.ogni, 1, 1, 365), unita: UNITS.includes(c.unita) ? c.unita : 'mesi', inizio: c.inizio, fine: isValidISO(c.fine) ? c.fine : null, ultima: isValidISO(c.ultima) ? c.ultima : null,
        autoRegistra: c.autoRegistra === true, avvisoGiorni: int(c.avvisoGiorni, 3, 0, 60), attiva: c.attiva !== false,
      };
    }),
    obiettivi: list(r.obiettivi, (g) => (g && typeof g === 'object' && int(g.importo, 0) > 0 ? {
      ...base(g), nome: str(g.nome, 'Obiettivo', 60) || 'Obiettivo', emoji: str(g.emoji, '🎯', 8), importo: int(g.importo, 0), scadenza: isValidISO(g.scadenza) ? g.scadenza : null,
      versamenti: list(g.versamenti, (v) => (v && isValidISO(v.data) && Number.isInteger(v.importo) && v.importo !== 0 ? { id: str(v.id, '', 60) || newId('v'), data: v.data, importo: v.importo, ...(typeof v.membroId === 'string' && v.membroId ? { membroId: v.membroId } : {}) } : null)),
    } : null)),
    regolamenti: list(r.regolamenti, (g) => (g && isValidISO(g.data) && typeof g.da === 'string' && typeof g.a === 'string' && g.da !== g.a && int(g.importo, 0) > 0 ? { ...base(g), data: g.data, da: g.da, a: g.a, importo: int(g.importo, 0), nota: str(g.nota, '', 120) } : null)),
    regole: list(r.regole, (g) => (g && typeof g.contiene === 'string' && g.contiene.trim() && typeof g.categoriaId === 'string' ? { ...base(g), contiene: str(g.contiene, '', 60).toLowerCase(), categoriaId: g.categoriaId } : null)),
    impostazioni: {
      valuta: typeof r.impostazioni?.valuta === 'string' && /^[A-Z]{3}$/.test(r.impostazioni.valuta) ? r.impostazioni.valuta : 'EUR',
      inizioMese: int(r.impostazioni?.inizioMese, 1, 1, 28),
      tema: THEMES.includes(r.impostazioni?.tema) ? r.impostazioni.tema : 'auto',
      nascondiImporti: r.impostazioni?.nascondiImporti === true,
      pinHash: typeof r.impostazioni?.pinHash === 'string' && /^[0-9a-f]{0,128}$/.test(r.impostazioni.pinHash) ? r.impostazioni.pinHash : '',
      pinSalt: typeof r.impostazioni?.pinSalt === 'string' && /^[0-9a-f]{0,64}$/.test(r.impostazioni.pinSalt) ? r.impostazioni.pinSalt : '',
      bloccoTelefono: r.impostazioni?.bloccoTelefono === true,
      bloccoAuto: int(r.impostazioni?.bloccoAuto, 60, 0, 3600),
      u: stamp(r.impostazioni?.u),
    },
  };
  // identificativi doppi: resta il più recente
  for (const key of ['membri', 'conti', 'categorie', 'movimenti', 'budget', 'ricorrenze', 'obiettivi', 'regolamenti', 'regole']) {
    const byId = new Map();
    for (const it of out[key]) {
      const old = byId.get(it.id);
      if (!old || it.u >= old.u) byId.set(it.id, it);
    }
    out[key] = [...byId.values()];
  }
  if (!out.membri.some((m) => !m.x)) out.membri.push(createState({ now: 0 }).membri[0]);
  return out;
}

export const alive = (items) => items.filter((i) => !i.x);
export const byId = (items, id) => items.find((i) => i.id === id && !i.x) ?? null;

/** Aggiorna il «timbro» di modifica: serve a decidere chi vince quando si uniscono due telefoni. */
export function touch(rec, now = Date.now()) {
  rec.u = Math.max(now, (rec.u ?? 0) + 0);
  return rec;
}

export { parseISO };
