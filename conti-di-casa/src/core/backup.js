// Copia di sicurezza: un solo file JSON con tutti i dati. Serve per cambiare telefono o passare i dati a un altro membro della famiglia.

import { VERSION, alive, sanitizeState } from './model.js';

export const APP_ID = 'conti-di-casa';

export function makeBackup(state, now = new Date()) {
  return JSON.stringify({ app: APP_ID, versione: VERSION, esportato: now.toISOString(), dati: state });
}

/** @returns {{stato: object, info: {esportato: string|null, movimenti: number, conti: number, membri: number}}} oppure lancia un errore comprensibile */
export function readBackup(text) {
  let raw;
  try {
    raw = JSON.parse(String(text).replace(/^﻿/, ''));
  } catch {
    throw new Error('Il file non si legge: non sembra una copia di Conti di Casa.');
  }
  const looksOurs = raw && typeof raw === 'object' && (raw.app === APP_ID || (Array.isArray(raw.movimenti) && Array.isArray(raw.conti)));
  if (!looksOurs) throw new Error('Il file non è una copia di Conti di Casa.');
  if (raw.app === APP_ID && Number.isFinite(raw.versione) && raw.versione > VERSION) throw new Error('Questa copia è stata fatta con una versione più nuova dell’app: aggiorna l’app e riprova.');
  const stato = sanitizeState(raw.app === APP_ID ? raw.dati : raw);
  return { stato, info: { esportato: raw.esportato ?? null, movimenti: alive(stato.movimenti).length, conti: alive(stato.conti).length, membri: alive(stato.membri).length } };
}
