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
      T = require('@huggingface/transformers');
      T.env.cacheDir = cacheDir;
      T.env.allowRemoteModels = allowRemote;
      if (localModelsDir) {
        T.env.allowLocalModels = true;
        T.env.localModelPath = localModelsDir.endsWith('/') || localModelsDir.endsWith('\\') ? localModelsDir : `${localModelsDir}/`;
      } else T.env.allowLocalModels = false;
      return T;
    } catch (e) {
      loadError = new Error(`Il motore di riconoscimento vocale non si avvia su questo computer (${e.message.split('\n')[0]}).`);
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
