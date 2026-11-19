// La «linea»: la connessione al centralino. Tiene il nostro codice registrato, si riconnette da sola
// e consegna le chiamate e i canali in arrivo.

import { Peer } from 'peerjs';
import { Emitter, sleep } from '../lib/util.js';
import { codeOf, newCode, peerIdOf } from './ids.js';
import { peerOptions } from './config.js';

export class Line extends Emitter {
  status = 'idle'; // idle | connecting | online | offline
  code;
  #server;
  #ice;
  #peer = null;
  #closed = false;
  #retries = 0;
  #idRetries = 0;

  constructor({ code, server, ice }) {
    super();
    this.code = code;
    this.#server = server;
    this.#ice = ice;
  }

  get peerId() {
    return peerIdOf(this.code);
  }

  start() {
    this.#closed = false;
    this.#open();
    return this;
  }

  #setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  #open() {
    if (this.#closed) return;
    this.#setStatus('connecting');
    let peer;
    try {
      peer = new Peer(this.peerId, peerOptions(this.#server, this.#ice));
    } catch (e) {
      this.#setStatus('offline');
      this.emit('error', e);
      this.#retryLater();
      return;
    }
    this.#peer = peer;
    peer.on('open', () => {
      this.#retries = 0;
      this.#idRetries = 0;
      this.#setStatus('online');
    });
    peer.on('connection', (dc) => this.emit('data', dc));
    peer.on('call', (mc) => this.emit('call', mc));
    peer.on('disconnected', () => {
      if (this.#closed || this.#peer !== peer) return;
      this.#setStatus('offline');
      this.#retryLater(() => {
        if (!peer.destroyed) peer.reconnect();
      });
    });
    peer.on('close', () => {
      if (this.#closed || this.#peer !== peer) return;
      this.#setStatus('offline');
      this.#retryLater();
    });
    peer.on('error', (err) => this.#onError(peer, err));
  }

  async #onError(peer, err) {
    if (this.#closed || this.#peer !== peer) return;
    const type = err?.type;
    if (type === 'unavailable-id') {
      // il codice risulta ancora occupato: di solito è la nostra sessione precedente che il centralino non ha ancora chiuso
      peer.destroy();
      this.#peer = null;
      this.#idRetries += 1;
      if (this.#idRetries > 4) {
        this.code = newCode();
        this.#idRetries = 0;
        this.emit('code-changed', this.code);
      }
      await sleep(900 * Math.min(this.#idRetries + 1, 4));
      this.#open();
    } else if (type === 'peer-unavailable') {
      const id = String(err.message ?? '').match(/(squillo-\d{9})/)?.[1];
      this.emit('unavailable', id ? codeOf(id) : null);
    } else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed' || type === 'disconnected') {
      this.#setStatus('offline');
      this.#retryLater(() => {
        if (peer.destroyed) this.#open();
        else peer.reconnect();
      });
    } else {
      this.emit('error', err);
    }
  }

  #timer = 0;
  #retryLater(fn = () => this.#open()) {
    clearTimeout(this.#timer);
    const wait = Math.min(1000 * 2 ** this.#retries, 15_000);
    this.#retries += 1;
    this.#timer = setTimeout(() => {
      if (!this.#closed) fn();
    }, wait);
  }

  /** Riprova subito (per esempio quando torna la rete). */
  retryNow() {
    if (this.#closed || this.status === 'online') return;
    clearTimeout(this.#timer);
    this.#retries = 0;
    if (!this.#peer || this.#peer.destroyed) this.#open();
    else this.#peer.reconnect();
  }

  /** Canale di controllo verso un'altra persona (testo JSON). */
  connectData(code, metadata) {
    return this.#peer.connect(peerIdOf(code), { reliable: true, serialization: 'json', metadata });
  }

  callMedia(code, stream, options) {
    return this.#peer.call(peerIdOf(code), stream, options);
  }

  /** Cambia centralino/codice: chiude e riapre. */
  restart({ code, server, ice } = {}) {
    if (code) this.code = code;
    if (server) this.#server = server;
    if (ice !== undefined) this.#ice = ice;
    this.stop();
    this.start();
  }

  stop() {
    this.#closed = true;
    clearTimeout(this.#timer);
    try {
      this.#peer?.destroy();
    } catch {
      /* già chiuso */
    }
    this.#peer = null;
    this.#setStatus('idle');
  }
}
