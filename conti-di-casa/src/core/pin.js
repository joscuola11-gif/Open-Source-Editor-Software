// Blocco con PIN: si salva solo un'impronta (PBKDF2) del PIN, mai il PIN.

const ITER = 100_000;
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => new Uint8Array(h.match(/../g)?.map((x) => parseInt(x, 16)) ?? []);

export const isValidPin = (pin) => typeof pin === 'string' && /^\d{4,8}$/.test(pin);

export function makeSalt(getRandomValues = (a) => globalThis.crypto.getRandomValues(a)) {
  return toHex(getRandomValues(new Uint8Array(16)));
}

export async function hashPin(pin, saltHex, subtle = globalThis.crypto?.subtle) {
  if (!isValidPin(pin)) throw new Error('Il PIN deve avere da 4 a 8 cifre.');
  if (!subtle) throw new Error('Questo telefono non permette di proteggere il PIN.');
  const key = await subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: ITER }, key, 256);
  return toHex(bits);
}

export async function verifyPin(pin, saltHex, hashHex, subtle) {
  if (!isValidPin(pin) || !hashHex) return false;
  const h = await hashPin(pin, saltHex, subtle);
  // confronto a tempo costante
  let diff = h.length ^ hashHex.length;
  for (let i = 0; i < Math.max(h.length, hashHex.length); i++) diff |= (h.charCodeAt(i) || 0) ^ (hashHex.charCodeAt(i) || 0);
  return diff === 0;
}
