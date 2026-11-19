// Codici delle persone: 9 cifre («123 456 789»). Sul centralino diventano «squillo-123456789»,
// così non si scontrano con gli identificativi di altre app che usano lo stesso servizio pubblico.

export const PREFIX = 'squillo-';
export const CODE_LENGTH = 9;

/** Codice casuale di 9 cifre (la prima non è 0). Usa il generatore sicuro del sistema. */
export function newCode(random = (n) => crypto.getRandomValues(new Uint32Array(n))) {
  const r = random(CODE_LENGTH);
  let out = String(1 + (r[0] % 9));
  for (let i = 1; i < CODE_LENGTH; i++) out += String(r[i] % 10);
  return out;
}

/** «123456789» → «123 456 789» (anche se scritto in parte). */
export function formatCode(code) {
  const d = String(code ?? '').replace(/\D/g, '').slice(0, CODE_LENGTH);
  return d.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
}

/** Estrae le 9 cifre da ciò che scrive l'utente (spazi, trattini, incollato con testo). Null se non valido. */
export function parseCode(input) {
  const text = String(input ?? '');
  const fromId = text.match(/squillo-(\d{9})\b/i);
  if (fromId) return fromId[1];
  const d = text.replace(/\D/g, '');
  return d.length === CODE_LENGTH && d[0] !== '0' ? d : null;
}

export const peerIdOf = (code) => `${PREFIX}${code}`;
export const codeOf = (peerId) => (typeof peerId === 'string' && peerId.startsWith(PREFIX) ? peerId.slice(PREFIX.length) : null);
