// Sottotitoli automatici: dal suono ai sottotitoli. Mette insieme rilevamento del parlato, un riconoscitore (qualunque:
// Whisper nel programma, un finto nelle prove), allineamento dei tempi e costruzione dei sottotitoli. Puro tranne
// il riconoscitore, che si passa da fuori e deve avere la forma:
//   engine.transcribe(Float32Array 16 kHz, {language, signal}) → Promise<{text: string, words?: [{text, start, end}]}>

import { buildCues } from './captions.js';
import { alignScript, tokenize } from './align.js';
import { biquad, filter, resample } from './dsp.js';
import { chunkSegments, detectSpeech } from './vad.js';
import { normalizeWords, repairWordTimes } from './wordtimes.js';

/** Audio a più canali → mono a 16 kHz (ingresso del riconoscimento vocale). */
export function toMono16k(channels, sr) {
  const n = channels[0].length;
  const mono = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) mono[i] += c[i] / channels.length;
  if (sr === 16000) return mono;
  // passa-basso prima di ridurre (due stadi), poi ricampionamento cubico
  let x = mono;
  if (sr > 16000) {
    const lp = biquad('lowpass', sr, 7200, Math.SQRT1_2);
    x = filter(filter(x, lp), lp);
  }
  return resample(x, sr / 16000);
}

// frasi che Whisper «inventa» quando sente silenzio o musica (nella lingua dei suoi dati di addestramento)
const HALLUCINATIONS = [
  /sottotitoli (creati|e revisione|a cura)/i, /amara\.org/i, /subtitles? by/i, /thanks? for watching/i, /^\s*(thank you|thanks)[.!]*\s*$/i,
  /grazie (a tutti )?(per la visione|per aver guardato)/i, /iscriviti al canale/i, /gracias por ver/i, /merci d'avoir regardé/i, /vielen dank fürs zuschauen/i,
  /^\s*\[?(musica|music|applausi|applause|silenzio|silence)\]?\s*$/i, /^\s*[♪♫\s.-]+$/,
];

/** Il testo è quasi certamente un'invenzione del modello (frasi note, o la stessa parola ripetuta molte volte)? */
export function isHallucination(text) {
  const t = String(text ?? '').trim();
  if (!t) return true;
  if (HALLUCINATIONS.some((re) => re.test(t))) return true;
  const toks = tokenize(t).map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
  if (toks.length >= 6) {
    // stessa parola (o stesso gruppetto di 2-3) ripetuta in loop
    for (const n of [1, 2, 3]) {
      let rep = 1;
      for (let i = n; i + n <= toks.length; i += n) {
        const same = toks.slice(i, i + n).join(' ') === toks.slice(i - n, i).join(' ');
        rep = same ? rep + 1 : 1;
        if (rep >= Math.ceil(10 / n)) return true;
      }
    }
  }
  return false;
}

/**
 * @param {{channels: Float32Array[], sampleRate: number, language?: string, engine: object,
 *          style?: string, captionOptions?: object, onProgress?: (p: {step: string, done: number, total: number}) => void, signal?: {aborted: boolean}}} o
 * @returns {Promise<{text: string, words: object[], cues: object[], speech: object[], duration: number}>}
 */
export async function transcribe({ channels, sampleRate, language, engine, style = 'standard', captionOptions = {}, onProgress = () => {}, signal }) {
  if (!channels?.length || !channels[0].length) throw new Error('Non c’è audio da trascrivere.');
  const audio = toMono16k(channels, sampleRate);
  const duration = audio.length / 16000;
  onProgress({ step: 'voce', done: 0, total: 1 });
  const vad = detectSpeech(audio, 16000);
  if (!vad.segments.length) return { text: '', words: [], cues: [], speech: [], duration };
  const chunks = chunkSegments(vad.segments, { maxLen: 28, pad: 0.25, total: duration });
  const words = [];
  const texts = [];
  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) throw new Error('Operazione annullata.');
    const c = chunks[i];
    onProgress({ step: 'riconoscimento', done: i, total: chunks.length });
    const a = Math.max(0, Math.floor(c.start * 16000));
    const b = Math.min(audio.length, Math.ceil(c.end * 16000));
    const slice = audio.slice(a, b);
    const r = await engine.transcribe(slice, { language, signal });
    const text = String(r?.text ?? '').trim();
    if (isHallucination(text)) continue;
    texts.push(text);
    // tempi: si riallinea il testo riconosciuto al suono di questo blocco (più affidabile dei tempi dati dal modello)
    const local = slice;
    const localVad = detectSpeech(local, 16000);
    let w;
    if (localVad.segments.length) w = alignScript(text, local, 16000, { vad: localVad });
    else if (r.words?.length) w = normalizeWords(r.words, { total: local.length / 16000 });
    else continue;
    if (!w.length) continue;
    // se il riconoscitore ha dato i suoi tempi e il riallineamento è andato fuori strada, si ripiega sulla correzione dei suoi
    for (const x of w) words.push({ text: x.text, start: x.start + c.start, end: x.end + c.start });
  }
  onProgress({ step: 'sottotitoli', done: chunks.length, total: chunks.length });
  const cues = buildCues(words, { style, ...captionOptions });
  return { text: texts.join(' '), words, cues, speech: vad.segments, duration };
}

/**
 * Allinea un testo scritto dall'utente all'audio (senza riconoscimento): sottotitoli sicuri e con i tempi giusti.
 */
export function captionsFromScript({ channels, sampleRate, script, style = 'standard', captionOptions = {} }) {
  if (!channels?.length || !channels[0].length) throw new Error('Non c’è audio.');
  const audio = toMono16k(channels, sampleRate);
  const words = alignScript(script, audio, 16000);
  return { words, cues: buildCues(words, { style, ...captionOptions }), duration: audio.length / 16000 };
}

/** Solo i tempi: una riga vuota per ogni frase parlata, da riempire a mano. */
export function emptyCuesFromSpeech({ channels, sampleRate, minGap = 0.5 }) {
  const audio = toMono16k(channels, sampleRate);
  const vad = detectSpeech(audio, 16000, { minSilence: minGap });
  return { cues: vad.segments.map((s) => ({ start: s.start, end: s.end, text: '', lines: [''], words: [] })), duration: audio.length / 16000 };
}

export { repairWordTimes };
