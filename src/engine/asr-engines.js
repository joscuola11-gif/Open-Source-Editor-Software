// Motori di riconoscimento vocale per i sottotitoli automatici.
// - programma per computer: Whisper locale nel processo principale (desktop/asr.cjs) tramite il ponte `ciakDesktop`;
// - browser: Whisper con transformers.js (WebAssembly), scaricato una sola volta da una rete di distribuzione fissata a una versione
//   precisa; i modelli si scaricano da huggingface.co e restano nella cache del browser.
// Entrambi espongono la stessa forma: `transcribe(Float32Array a 16 kHz, {language, signal}) → {text, words}`.

export const ASR_MODELS = {
  tiny: { label: 'Veloce (circa 40 MB)', mb: 40 },
  base: { label: 'Buona (circa 75 MB)', mb: 75 },
  small: { label: 'Migliore (circa 250 MB, più lenta)', mb: 250 },
};
export const ASR_LANGUAGES = { it: 'Italiano', en: 'Inglese', es: 'Spagnolo', fr: 'Francese', de: 'Tedesco', pt: 'Portoghese', nl: 'Olandese', pl: 'Polacco', ru: 'Russo', ja: 'Giapponese', zh: 'Cinese', ar: 'Arabo', tr: 'Turco' };

const WEB_MODELS = { tiny: 'Xenova/whisper-tiny', base: 'Xenova/whisper-base', small: 'Xenova/whisper-small' };
export const TRANSFORMERS_VERSION = '4.3.2';
const DEFAULT_URL = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/dist/transformers.min.js`;

/** Motore del programma per computer (Whisper locale). `null` se il ponte non c'è. */
export function desktopEngine(bridge = globalThis.ciakDesktop, { model = 'tiny', performance = 'light', onModelProgress = () => {} } = {}) {
  if (!bridge?.asrTranscribe) return null;
  const off = bridge.onAsrProgress?.((p) => onModelProgress(p));
  return {
    kind: 'desktop',
    model,
    async available() {
      const r = await bridge.asrAvailable();
      return { ok: Boolean(r?.ok), reason: r?.reason ?? '', models: r?.models ?? ASR_MODELS, languages: ASR_LANGUAGES };
    },
    async transcribe(samples, { language = 'it', signal, task = 'transcribe' } = {}) {
      if (signal?.aborted) throw new Error('Operazione annullata.');
      const r = await bridge.asrTranscribe(samples, { language, model, task, performance });
      if (!r?.ok) throw new Error(r?.error || 'Riconoscimento non riuscito.');
      return { text: r.text, words: r.words };
    },
    dispose() {
      off?.();
    },
  };
}

let webModule = null;

/**
 * Motore per il browser (transformers.js + WebAssembly).
 * `overrides` serve alle prove: `{transformersUrl, localModelPath, wasmPaths, allowRemote}`; in uso normale si legge da `window.__ciakAsr`.
 */
export function webEngine({ model = 'tiny', onModelProgress = () => {}, overrides = globalThis.__ciakAsr ?? {} } = {}) {
  let pipePromise = null;
  async function load() {
    if (!webModule) {
      try {
        webModule = await import(/* @vite-ignore */ overrides.transformersUrl || DEFAULT_URL);
      } catch (e) {
        throw new Error(`Non riesco a caricare il motore di riconoscimento vocale (serve internet la prima volta): ${String(e?.message ?? e).split('\n')[0]}`);
      }
    }
    const T = webModule;
    if (overrides.localModelPath) {
      T.env.allowLocalModels = true;
      T.env.localModelPath = overrides.localModelPath;
    } else T.env.allowLocalModels = false;
    T.env.allowRemoteModels = overrides.allowRemote ?? !overrides.localModelPath;
    if (overrides.wasmPaths && T.env.backends?.onnx?.wasm) T.env.backends.onnx.wasm.wasmPaths = overrides.wasmPaths;
    if (T.env.backends?.onnx?.wasm) {
      T.env.backends.onnx.wasm.numThreads = 1;
      T.env.backends.onnx.wasm.proxy = overrides.proxy ?? true;
    }
    return T;
  }
  function pipe() {
    if (!pipePromise) {
      pipePromise = (async () => {
        const T = await load();
        try {
          return await T.pipeline('automatic-speech-recognition', WEB_MODELS[model], {
            dtype: 'q8',
            device: 'wasm',
            progress_callback: (e) => {
              if (['progress', 'download', 'initiate', 'done', 'ready'].includes(e.status)) onModelProgress({ status: e.status, file: e.file, progress: e.progress });
            },
          });
        } catch (e) {
          const net = /fetch|network|Failed to|Could not locate|404|offline/i.test(String(e?.message));
          throw new Error(net ? 'Non riesco a scaricare il modello di riconoscimento vocale: serve internet la prima volta.' : `Errore del modello: ${String(e?.message).split('\n')[0]}`);
        }
      })();
      pipePromise.catch(() => {
        pipePromise = null;
      });
    }
    return pipePromise;
  }
  return {
    kind: 'web',
    model,
    async available() {
      if (!WEB_MODELS[model]) return { ok: false, reason: 'Modello sconosciuto.', models: ASR_MODELS, languages: ASR_LANGUAGES };
      if (typeof WebAssembly !== 'object') return { ok: false, reason: 'Questo browser non supporta WebAssembly.', models: ASR_MODELS, languages: ASR_LANGUAGES };
      return { ok: true, reason: '', models: ASR_MODELS, languages: ASR_LANGUAGES };
    },
    async transcribe(samples, { language = 'it', signal, task = 'transcribe' } = {}) {
      if (!ASR_LANGUAGES[language]) throw new Error(`Lingua non supportata: ${language}`);
      if (signal?.aborted) throw new Error('Operazione annullata.');
      const p = await pipe();
      // lascia respirare l'interfaccia prima di un calcolo lungo
      await new Promise((r) => setTimeout(r));
      const out = await p(samples, { language, task, return_timestamps: task === 'translate' ? false : 'word', chunk_length_s: 30, stride_length_s: 5 });
      const words = (out.chunks ?? []).filter((c) => c.text?.trim() && Array.isArray(c.timestamp) && Number.isFinite(c.timestamp[0])).map((c) => ({
        text: c.text.trim(),
        start: c.timestamp[0],
        end: Number.isFinite(c.timestamp[1]) ? c.timestamp[1] : c.timestamp[0] + 0.3,
      }));
      return { text: String(out.text ?? '').trim(), words };
    },
    dispose() {},
  };
}

/** Il motore migliore disponibile: quello locale del programma per computer, altrimenti quello del browser. */
export function createAsrEngine(options = {}) {
  // per le prove: un motore finto fornito dalla pagina (`window.__ciakAsr.engine`)
  const fake = globalThis.__ciakAsr?.engine;
  if (fake) return typeof fake === 'function' ? fake(options) : fake;
  return desktopEngine(globalThis.ciakDesktop, options) ?? webEngine(options);
}
