// Legge l'audio di un file (anche di un video lunghissimo) come campioni: la base di sottotitoli, analisi ed effetti.
// Nel programma per computer lo fa ffmpeg, direttamente dal file su disco e solo per la parte richiesta: regge ore di video e qualsiasi codec.
// Nel browser (o se ffmpeg non riesce) si ricorre alla decodifica del browser, che carica tutto il file in memoria.

import { decodeAudio } from './media-import.js';

const MAX_BYTES_VIA_IPC = 400 * 1024 * 1024;

function split(samples, channels) {
  if (channels === 1) return [samples];
  const n = Math.floor(samples.length / channels);
  const out = Array.from({ length: channels }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) out[c][i] = samples[i * channels + c];
  return out;
}

/** Il file è davvero troppo grande per la decodifica del browser? (per dare un messaggio che dice cosa fare) */
const big = (blob) => blob.size > 600 * 1024 * 1024;

/**
 * @param {Blob|File} blob file audio o video
 * @param {{from?: number, to?: number|null, sampleRate?: number, channels?: 1|2, maxSeconds?: number}} o `from`/`to` in secondi del file
 * @returns {Promise<{channels: Float32Array[], sampleRate: number, via: 'ffmpeg'|'browser'}>}
 */
export async function loadAudio(blob, { from = 0, to = null, sampleRate = 44100, channels = 2, maxSeconds = 4 * 3600 } = {}) {
  const d = globalThis.ciakDesktop;
  let reason = '';
  if (d?.extractAudio) {
    try {
      const path = blob instanceof File ? d.pathForFile?.(blob) : '';
      let r = null;
      if (path) r = await d.extractAudio({ path }, { from, to, sampleRate, channels });
      else if (blob.size <= MAX_BYTES_VIA_IPC) r = await d.extractAudio({ bytes: new Uint8Array(await blob.arrayBuffer()) }, { from, to, sampleRate, channels });
      else reason = 'Il file è molto grande e non ne conosco il percorso sul disco: aggiungilo di nuovo al progetto dal pulsante «Importa».';
      if (r?.ok) {
        const out = split(r.samples, r.channels);
        if (out[0].length / r.sampleRate > maxSeconds) throw new Error(`L'audio dura ${Math.round(out[0].length / r.sampleRate / 60)} minuti: per questa funzione il limite è ${Math.round(maxSeconds / 60)}.`);
        return { channels: out, sampleRate: r.sampleRate, via: 'ffmpeg' };
      }
      if (r?.noAudio) throw new Error('Questo file non ha una traccia audio.');
      if (r?.error) reason = r.error;
    } catch (e) {
      if (/traccia audio|limite è/.test(e.message)) throw e;
      reason = e.message;
    }
  }
  // decodifica del browser (carica tutto il file in memoria)
  try {
    const all = await decodeAudio(blob, { maxSeconds: Infinity });
    const a = Math.max(0, Math.floor(from * all.sampleRate));
    const b = to == null ? all.channels[0].length : Math.min(all.channels[0].length, Math.ceil(to * all.sampleRate));
    if (b <= a) throw new Error('La parte di audio richiesta è vuota.');
    if ((b - a) / all.sampleRate > maxSeconds) throw new Error(`L'audio dura ${Math.round((b - a) / all.sampleRate / 60)} minuti: per questa funzione il limite è ${Math.round(maxSeconds / 60)}.`);
    return { channels: all.channels.map((c) => c.slice(a, b)), sampleRate: all.sampleRate, via: 'browser' };
  } catch (e) {
    if (/limite è|vuota/.test(e.message)) throw e;
    const mb = Math.round(blob.size / 1048576);
    const hint = d?.extractAudio ? ` (${reason || 'ffmpeg non è riuscito a leggerlo'})` : big(blob) ? ` Il file è molto grande (${mb} MB): il browser non riesce a leggerne l'audio. Il programma per computer di Ciak Studio sì.` : ' Il formato dell’audio potrebbe non essere supportato dal browser.';
    throw new Error(`Non riesco a leggere l’audio di questo file.${hint}`);
  }
}
