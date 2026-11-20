// Crea docs/LICENZE-TERZE.txt: l'elenco del software di terzi usato da Ciak Studio, con licenza, origine e testo completo (dove il pacchetto lo contiene).
// Si rigenera con `node tools/collect-licenses.mjs --write`; una prova controlla che il file sia aggiornato e completo.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'LICENZE-TERZE.txt');

/** Software di terzi: a cosa serve in Ciak Studio, dove sta il suo sito, come è usato. */
export const PACKAGES = [
  { name: '@huggingface/transformers', role: 'Fa girare Whisper (sottotitoli automatici)', url: 'https://github.com/huggingface/transformers.js', how: 'incluso nel programma per computer; nel browser caricato dalla rete al primo uso' },
  { name: '@huggingface/tokenizers', role: 'Prepara il testo per Whisper', url: 'https://github.com/huggingface/tokenizers', how: 'incluso nel programma per computer' },
  { name: '@huggingface/jinja', role: 'Modelli di testo di Whisper', url: 'https://github.com/huggingface/huggingface.js', how: 'incluso nel programma per computer' },
  { name: 'onnxruntime-node', role: 'Motore di calcolo di Whisper (programma per computer)', url: 'https://github.com/microsoft/onnxruntime', how: 'incluso nel programma per computer (solo Windows x64 nel pacchetto Windows)' },
  { name: 'onnxruntime-common', role: 'Parte comune del motore di calcolo', url: 'https://github.com/microsoft/onnxruntime', how: 'incluso nel programma per computer' },
  { name: '@mediapipe/selfie_segmentation', role: 'Rimuovi sfondo (riconoscimento della persona)', url: 'https://github.com/google/mediapipe', how: 'incluso nel programma per computer (resources/mediapipe); nel browser caricato dalla rete al primo uso' },
  { name: '@breezystack/lamejs', role: 'Codificatore MP3', url: 'https://github.com/breezystack/lamejs', how: 'incorporato nella pagina dell\'editor (si costruisce con `npm run build` dai sorgenti: puoi sostituirlo con una tua versione e ricostruire)' },
  { name: 'gifenc', role: 'Codificatore GIF', url: 'https://github.com/mattdesl/gifenc', how: 'incorporato nella pagina dell\'editor' },
];

/** Software che viaggia con il pacchetto e porta con sé il proprio testo di licenza. */
export const BUNDLED = [
  { name: 'Whisper (modello di OpenAI) e le sue conversioni ONNX «Xenova/whisper-*»', license: 'MIT', url: 'https://github.com/openai/whisper', how: 'NON incluso: si scarica dal sito Hugging Face la prima volta che si usa. La licenza è indicata sulla pagina di ciascun modello: controllala prima di distribuire.' },
  { name: 'Electron', license: 'MIT', url: 'https://www.electronjs.org', how: 'programma per computer; testo in LICENSE.electron.txt (accanto a «Ciak Studio.exe»)' },
  { name: 'Chromium (dentro Electron)', license: 'BSD-3-Clause e licenze di sue parti', url: 'https://www.chromium.org', how: 'programma per computer; elenco completo in LICENSES.chromium.html (accanto a «Ciak Studio.exe»)' },
  { name: 'ffmpeg', license: 'GPL-3.0 (build di eugeneware/ffmpeg-static)', url: 'https://github.com/eugeneware/ffmpeg-static', how: 'programma per computer, eseguito come programma separato; testo in resources/ffmpeg/LICENSE.txt, sorgenti su https://ffmpeg.org' },
];

function readLicense(name) {
  const dir = path.join(ROOT, 'node_modules', ...name.split('/'));
  const file = readdirSync(dir).find((f) => /^licen[cs]e(\.md|\.txt)?$/i.test(f));
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  return { version: pkg.version, license: typeof pkg.license === 'string' ? pkg.license : 'vedi il pacchetto', text: file ? readFileSync(path.join(dir, file), 'utf8').trim() : '' };
}

export function build() {
  const lines = [];
  lines.push('CIAK STUDIO — SOFTWARE DI TERZI');
  lines.push('================================');
  lines.push('');
  lines.push('Il codice di Ciak Studio è MIT (vedi LICENSE). Ciak Studio usa i programmi liberi elencati qui sotto, ognuno con la propria licenza.');
  lines.push('Tutti permettono l\'uso, anche commerciale, a condizione di conservare gli avvisi di copyright e di licenza: questo file serve a questo.');
  lines.push('I suoni, la musica e i sottotitoli che crei sono tuoi. I file che importi (video, musica, foto) restano soggetti ai diritti di chi li ha creati.');
  lines.push('Le licenze Apache-2.0 e MIT valgono anche per i pacchetti che non portano un proprio file: i testi completi sono nella sezione 3 (Apache-2.0 sotto transformers.js, MIT sotto jinja).');
  lines.push('Non è un parere legale.');
  lines.push('');
  lines.push('1. LIBRERIE');
  lines.push('-----------');
  for (const p of PACKAGES) {
    const l = readLicense(p.name);
    lines.push('');
    lines.push(`${p.name} ${l.version} — ${l.license}`);
    lines.push(`  A cosa serve: ${p.role}`);
    lines.push(`  Origine: ${p.url}`);
    lines.push(`  Come è usata: ${p.how}`);
  }
  lines.push('');
  lines.push('2. PROGRAMMI E MODELLI CHE VIAGGIANO COL PACCHETTO O SI SCARICANO');
  lines.push('------------------------------------------------------------------');
  for (const b of BUNDLED) {
    lines.push('');
    lines.push(`${b.name} — ${b.license}`);
    lines.push(`  Origine: ${b.url}`);
    lines.push(`  Note: ${b.how}`);
  }
  lines.push('');
  lines.push('3. TESTI DELLE LICENZE DELLE LIBRERIE');
  lines.push('-------------------------------------');
  for (const p of PACKAGES) {
    const l = readLicense(p.name);
    lines.push('');
    lines.push(`===== ${p.name} ${l.version} (${l.license}) =====`);
    lines.push(l.text || `(il pacchetto non include un file di licenza: la licenza dichiarata è ${l.license}; vedi ${p.url})`);
  }
  lines.push('');
  lines.push('===== LAME (alla base di lamejs) — riconoscimento richiesto dal progetto LAME =====');
  lines.push('Il codificatore MP3 è LAME (https://lame.sourceforge.net), portato in JavaScript da lamejs. Ciak Studio lo usa sotto i termini della LGPL; se modifichi LAME,');
  lines.push('le modifiche vanno restituite al progetto LAME sotto la stessa licenza.');
  lines.push('');
  lines.push('===== GNU Lesser General Public License v3.0 (testo completo, per lamejs/LAME) =====');
  lines.push(readFileSync(path.join(ROOT, 'docs', 'licenze', 'LGPL-3.0.txt'), 'utf8').trim());
  lines.push('');
  lines.push('===== Apache License 2.0 (testo completo, per transformers.js, tokenizers, MediaPipe) =====');
  lines.push(readFileSync(path.join(ROOT, 'docs', 'licenze', 'Apache-2.0.txt'), 'utf8').trim());
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--write')) {
  writeFileSync(OUT, build());
  console.log(`scritto ${path.relative(ROOT, OUT)}`);
}
export { OUT, existsSync };
