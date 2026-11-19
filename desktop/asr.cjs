'use strict';
// Riconoscimento vocale locale (Whisper) per il programma per computer.
// Gira nel processo principale con onnxruntime-node (CPU): nessun server, nessun account. I modelli (open source, licenza Apache 2.0)
// si scaricano la prima volta da huggingface.co e restano in cache sul computer; poi funziona anche senza internet.
// Il modulo non dipende da Electron: si può provare con Node (vedi tests/integration/asr-node.test.js).

const MODELS = {
  tiny: { id: 'Xenova/whisper-tiny', label: 'Veloce (circa 40 MB)', mb: 40 },
  base: { id: 'Xenova/whisper-base', label: 'Buona (circa 75 MB)', mb: 75 },
  small: { id: 'Xenova/whisper-small', label: 'Migliore (circa 250 MB, più lenta)', mb: 250 },
};
const LANGS = { it: 'italian', en: 'english', es: 'spanish', fr: 'french', de: 'german', pt: 'portuguese', nl: 'dutch', pl: 'polish', ru: 'russian', ja: 'japanese', zh: 'chinese', ar: 'arabic', tr: 'turkish' };
const MAX_SECONDS = 40;

/**
 * transformers.js carica «sharp» (elaborazione di immagini) appena si apre, ma per la voce non serve a nulla e nel pacchetto per Windows
 * non c'è: lo si sostituisce con un segnaposto che si lamenta solo se qualcuno prova a usarlo.
 */
function withoutSharp(load) {
  const Module = require('module');
  const original = Module._load;
  const stub = () => {
    throw new Error('L\'elaborazione di immagini non è disponibile in questo programma.');
  };
  stub.default = stub;
  Module._load = function patched(request, ...rest) {
    return request === 'sharp' ? stub : original.call(this, request, ...rest);
  };
  try {
    return load();
  } finally {
    Module._load = original;
  }
}

/** Su Windows il motore ha bisogno delle librerie di Microsoft Visual C++: se mancano lo si dice in chiaro. */
function hint(e) {
  if (process.platform === 'win32' && /ERR_DLOPEN_FAILED|specified module could not be found|non è stato trovato|1114|126/i.test(`${e?.code} ${e?.message}`)) {
    return ' Su Windows serve «Microsoft Visual C++ Redistributable 2015-2022 (x64)», gratuito: si scarica dal sito di Microsoft (vc_redist.x64.exe).';
  }
  return '';
}

/**
 * @param {{cacheDir: string, localModelsDir?: string|null, allowRemote?: boolean, log?: (m: string) => void}} o
 */
function createAsr({ cacheDir, localModelsDir = null, allowRemote = true, log = () => {} }) {
  let T = null;
  let loadError = null;
  const pipes = new Map();
  let chain = Promise.resolve(); // un lavoro alla volta

  function load() {
    if (T) return T;
    if (loadError) throw loadError;
    try {
      T = withoutSharp(() => require('@huggingface/transformers'));
      T.env.cacheDir = cacheDir;
      T.env.allowRemoteModels = allowRemote;
      if (localModelsDir) {
        T.env.allowLocalModels = true;
        T.env.localModelPath = localModelsDir.endsWith('/') || localModelsDir.endsWith('\\') ? localModelsDir : `${localModelsDir}/`;
      } else T.env.allowLocalModels = false;
      return T;
    } catch (e) {
      loadError = new Error(`Il motore di riconoscimento vocale non si avvia su questo computer (${e.message.split('\n')[0]}).${hint(e)}`);
      loadError.cause = e;
      throw loadError;
    }
  }

  async function pipe(modelKey, onProgress) {
    const m = MODELS[modelKey];
    if (!m) throw new Error(`Modello sconosciuto: ${modelKey}`);
    if (pipes.has(modelKey)) return pipes.get(modelKey);
    const { pipeline } = load();
    const p = pipeline('automatic-speech-recognition', m.id, {
      dtype: 'q8',
      device: 'cpu',
      progress_callback: (e) => {
        if (!onProgress) return;
        if (e.status === 'progress' || e.status === 'download' || e.status === 'initiate' || e.status === 'done' || e.status === 'ready') onProgress({ status: e.status, file: e.file, progress: e.progress, loaded: e.loaded, total: e.total });
      },
    }).catch((e) => {
      pipes.delete(modelKey);
      const net = /fetch|network|ENOTFOUND|ECONN|getaddrinfo|Could not locate|404|offline/i.test(String(e?.message));
      throw new Error(net ? 'Non riesco a scaricare il modello di riconoscimento vocale: serve internet la prima volta.' : `Errore del modello: ${String(e?.message).split('\n')[0]}`);
    });
    pipes.set(modelKey, p);
    return p;
  }

  return {
    models: MODELS,
    languages: Object.keys(LANGS),
    /** Il motore parte? (non scarica nulla) */
    async available() {
      try {
        load();
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e.message };
      }
    },
    /**
     * @param {Float32Array} samples audio mono 16 kHz, al massimo 40 s
     * @param {{language?: string, model?: keyof typeof MODELS, onProgress?: Function}} o
     * @returns {Promise<{text: string, words: Array<{text: string, start: number, end: number}>}>}
     */
    transcribe(samples, { language = 'it', model = 'tiny', onProgress } = {}) {
      const run = async () => {
        if (!(samples instanceof Float32Array)) samples = new Float32Array(samples);
        if (!samples.length) return { text: '', words: [] };
        if (samples.length > 16000 * MAX_SECONDS) throw new Error(`Audio troppo lungo per un solo blocco (massimo ${MAX_SECONDS} s).`);
        if (!(language in LANGS)) throw new Error(`Lingua non supportata: ${language}`);
        const p = await pipe(model, onProgress);
        // la lingua va sempre indicata: senza, il modello parte dall'inglese (non sa riconoscerla da solo)
        const opts = { task: 'transcribe', return_timestamps: 'word', chunk_length_s: 30, language: LANGS[language] };
        const out = await p(samples, opts);
        const words = (out.chunks ?? []).map((c) => ({ text: String(c.text).trim(), start: c.timestamp?.[0] ?? 0, end: c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0 })).filter((w) => w.text);
        log(`riconosciuti ${words.length} parole`);
        return { text: String(out.text ?? '').trim(), words };
      };
      const result = chain.then(run, run);
      chain = result.catch(() => {});
      return result;
    },
  };
}

module.exports = { createAsr, MODELS, LANGS, MAX_SECONDS };
