// Dove si trova il «centralino» (il servizio che mette in contatto due telefoni/computer).
// Per impostazione predefinita è il servizio pubblico gratuito di PeerJS: non serve alcun account.
// L'audio e il video NON passano di lì: viaggiano direttamente fra le due persone (cifrati),
// oppure, se la rete lo impedisce, attraverso un server di appoggio (TURN) che vede solo dati cifrati.

export const DEFAULT_SERVER = Object.freeze({ host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs' });

/** Normalizza ciò che l'utente scrive nelle impostazioni; se non è valido torna al servizio predefinito. */
export function cleanServer(input) {
  if (!input || typeof input !== 'object') return { ...DEFAULT_SERVER };
  const host = String(input.host ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(host)) return { ...DEFAULT_SERVER };
  const port = Number(input.port);
  const secure = input.secure !== false;
  let path = String(input.path ?? '/').trim() || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  return {
    host,
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : secure ? 443 : 80,
    path: path.replace(/[^\w\-./]/g, ''),
    secure,
    key: String(input.key ?? 'peerjs').trim() || 'peerjs',
  };
}

export const isDefaultServer = (s) => s.host === DEFAULT_SERVER.host && s.port === DEFAULT_SERVER.port && s.path === DEFAULT_SERVER.path;

/** Opzioni per `new Peer(...)`. Senza `ice` restano i server di rete predefiniti di PeerJS (STUN + TURN). */
export function peerOptions(server, ice) {
  const s = cleanServer(server);
  const opts = { host: s.host, port: s.port, path: s.path, secure: s.secure, key: s.key, debug: 0, pingInterval: 4000 };
  if (Array.isArray(ice) && ice.length) opts.config = { iceServers: ice, sdpSemantics: 'unified-plan' };
  return opts;
}
