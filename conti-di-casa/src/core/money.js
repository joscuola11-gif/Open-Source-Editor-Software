// Denaro: sempre in CENTESIMI (numeri interi), mai in euro con la virgola: niente errori di arrotondamento.

/**
 * Da testo scritto dall'utente a centesimi. Accetta «12,50», «12.50», «1.234,56», «1,234.56», «1.234», «€ 12», «12 €», «-5», «+5».
 * Con un solo separatore: seguito da 1-2 cifre è decimale («12,5», «12.50»); seguito da 3 cifre, dopo 1-3 cifre diverse da zero, è delle migliaia («1.234»).
 * Altro (lettere, più segni, più di 2 decimali) → null.
 */
export function parseAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  if (typeof input !== 'string') return null;
  let s = input.replace(/[\s\u00a0€$£]|eur|usd|gbp|chf/gi, '');
  if (!s) return null;
  let sign = 1;
  if (/^[-−–]/.test(s)) {
    sign = -1;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  let intPart;
  let decPart = '';
  const esc = (c) => (c === '.' ? '\\.' : c);
  const thousandsRe = (sep) => new RegExp(`^\\d{1,3}(?:${esc(sep)}\\d{3})+$`);
  if (dots && commas) {
    const dec = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    const thou = s[dec] === ',' ? '.' : ',';
    const left = s.slice(0, dec);
    if (left.includes(s[dec])) return null; // due separatori decimali
    if (!thousandsRe(thou).test(left)) return null;
    intPart = left.split(thou).join('');
    decPart = s.slice(dec + 1);
  } else if (dots || commas) {
    const sep = dots ? '.' : ',';
    const n = dots || commas;
    const parts = s.split(sep);
    const last = parts[parts.length - 1];
    if (n > 1) {
      // «1.234.567»: solo migliaia
      if (!thousandsRe(sep).test(s)) return null;
      intPart = parts.join('');
    } else if (last.length >= 1 && last.length <= 2) {
      intPart = parts[0] || '0';
      decPart = last;
    } else if (last.length === 3 && /^[1-9]\d{0,2}$/.test(parts[0])) {
      intPart = parts.join('');
    } else return null;
  } else intPart = s;
  if (decPart.length > 2 || !/^\d+$/.test(intPart) || (decPart && !/^\d+$/.test(decPart))) return null;
  const cents = Number(intPart) * 100 + Number((decPart || '0').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 9_999_999_999_99) return null;
  return sign * cents;
}

const SYMBOLS = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', PLN: 'zł', RON: 'lei', ALL: 'L', MAD: 'MAD', TRY: '₺' };

/**
 * Centesimi → «1.234,56 €» (all'italiana, con le migliaia sempre separate: le impostazioni internazionali di alcuni sistemi non le separano sotto 10.000).
 * `locale: 'en-US'` → «$1,234.56».
 */
export function formatAmount(cents, { currency = 'EUR', locale = 'it-IT', sign = false } = {}) {
  const c = Number.isFinite(cents) ? Math.round(cents) : 0;
  const abs = Math.abs(c);
  const en = /^en/i.test(locale);
  const group = en ? ',' : '.';
  const dec = en ? '.' : ',';
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const num = `${int}${dec}${String(abs % 100).padStart(2, '0')}`;
  const sym = SYMBOLS[currency] ?? currency;
  const body = en ? `${sym}${num}` : `${num}\u00a0${sym}`;
  if (c < 0) return `−${body}`;
  return sign && c > 0 ? `+${body}` : body;
}

/** Solo il numero, per i campi di testo: 123456 → «1234,56». */
export function formatPlain(cents) {
  const neg = cents < 0;
  const a = Math.abs(Math.round(cents));
  const s = `${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/** Divide `total` in `n` parti intere che sommano esattamente a `total` (il resto va alle prime). */
export function splitEvenly(total, n) {
  if (!Number.isInteger(total) || !Number.isInteger(n) || n < 1) throw new Error('Divisione non valida');
  const base = Math.trunc(total / n);
  let rest = total - base * n;
  return Array.from({ length: n }, () => {
    const extra = rest > 0 ? 1 : rest < 0 ? -1 : 0;
    rest -= extra;
    return base + extra;
  });
}

/** Divide `total` in proporzione ai `weights`, sempre con somma esatta (metodo del resto più grande). */
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) throw new Error('Quote non valide');
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map((r) => Math.floor(r));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k][1]]++;
  return out;
}

export const CURRENCIES = { EUR: 'Euro (€)', USD: 'Dollaro USA ($)', GBP: 'Sterlina (£)', CHF: 'Franco svizzero (CHF)', PLN: 'Zloty (zł)', RON: 'Leu rumeno (lei)', ALL: 'Lek albanese (L)', MAD: 'Dirham marocchino', TRY: 'Lira turca (₺)' };
