// Stato di ogni voce del catalogo CapCut (docs/capcut-catalogo-funzioni.txt) in Ciak Studio.
// Da qui si genera la tabella del README (`node tools/catalog-status.mjs --write`); una prova controlla che ogni voce abbia uno stato.
//   ok   = c'è e funziona, provato      parz = c'è in parte o in forma più semplice (la nota dice cosa manca)
//   no   = non incluso (il motivo è un codice di REASONS o una frase)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const REASONS = {
  PAGA: 'Contenuti con licenza o a pagamento (stock, piano Pro): non si possono includere',
  GEN: 'IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer',
  IA: 'Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare',
  MOB: 'App per telefono: Ciak è per computer e browser',
  ACC: 'Account, cloud e lavoro in squadra: Ciak funziona senza account e senza server',
  SOC: 'Pubblicazione diretta su TikTok/YouTube: richiede accordi con le piattaforme',
  NA: 'Non serve in Ciak',
};

/** Voci pienamente fatte (intervalli e numeri). */
const OK = [
  [7, 11], [16, 21], [32, 50], [52, 56], [57, 72], [74, 74], [75, 88], [90, 90], [92, 99], [103, 104], [105, 115], [116, 130], [132, 134], [136, 142], [144, 145], [148, 148], [149, 167],
  [170, 170], [171, 188], [190, 190], [192, 203], [205, 207], [209, 211], [214, 214], [215, 236], [238, 241], [247, 248], [250, 250], [252, 254], [267, 267], [278, 278], [291, 298], [302, 302],
  [304, 305], [319, 319], [324, 324], [326, 326], [332, 337], [339, 340], [342, 344], [346, 353], [356, 356], [359, 359], [372, 382], [384, 389], [390, 390], [394, 394], [418, 423], [424, 426],
  [333, 333], [5, 5], [1, 1], [189, 189],
];

/** Note per voci «ok» che meritano una precisazione. */
const OK_NOTE = { 1: 'pacchetto zip portatile (non provato su un Windows vero)', 5: 'versione browser (provata solo su Chromium)' };

/** Voci fatte in parte: numero → cosa manca. */
const PARZ = {
  2: 'la configurazione c’è, ma non è provato né consegnato su macOS',
  12: 'ci sono gli strumenti locali (sottotitoli, sfondo, scene…), non quelli generativi',
  13: 'ci sono risorse gratuite generate dal programma, non librerie premium',
  23: 'adesivi emoji, forme e sfondi; niente archivi di immagini',
  24: 'musica generata dal programma (7 stili), non una libreria di brani',
  25: '27 effetti generati con la sintesi, non registrati',
  27: 'suoni e musica generati con regole, non con modelli generativi',
  51: 'solo nel programma per computer (ffmpeg)',
  73: 'segue ciò che si muove, non riconosce volti o persone',
  89: 'c’è il tracciamento di un punto (2D), non la ricostruzione della camera 3D',
  91: 'zoom e panoramica sulla foto (Ken Burns), senza vera profondità',
  100: 'solo nel programma per computer: interpolazione classica, non IA',
  101: 'solo nel programma per computer: interpolazione classica',
  102: 'solo nel programma per computer (ffmpeg)',
  147: 'filtro «cartone» e «matita» sui pixel, non un modello generativo',
  168: 'solo nel programma per computer (ffmpeg)',
  128: 'ritaglia le persone (MediaPipe), non altri soggetti',
  131: 'un testo o adesivo può seguire un punto; la maschera non si aggancia da sola',
  204: 'se incolli il testo della canzone lo mette a tempo; non lo riconosce da sola',
  212: 'solo verso l’inglese, con la funzione di traduzione di Whisper',
  213: 'inglese più originale; altre lingue no',
  237: 'riduzione del rumore sì; eco e riverbero no',
  242: 'nel programma per computer, con le voci installate nel sistema',
  243: 'le voci e lingue che ha il tuo sistema',
  244: 'effetti generati con regole, non da una descrizione',
  245: 'musica generata con regole, non da una descrizione',
  246: 'divide per scene, trova i momenti migliori e taglia a tempo; non monta da solo un video intero',
  249: 'i modelli ci sono; i «beat template» no',
  251: 'momenti migliori + inquadratura verticale, in due passi',
  255: 'vedi 073',
  257: 'solo nel programma per computer (vidstab)',
  258: 'solo nel programma per computer: meno disturbo e più nitidezza classici',
  260: 'sottotitoli tradotti in inglese; niente doppiaggio',
  268: 'solo nel programma per computer: ingrandimento 2× classico, non IA',
  269: 'look cartone sui pixel, non un modello generativo',
  287: 'sintesi vocale del sistema (programma per computer)',
  288: 'musica generata con regole',
  290: 'i modelli ci sono (11), ma non sono creati da un’IA',
  315: 'filtro cartone/matita, non un modello generativo',
  316: 'ritaglia l’intera persona, non solo il volto',
  320: 'zoom e panoramica sulla foto, senza vera profondità',
  322: 'si possono comporre locandine con testo, forme e foto; niente modelli di grafica',
  323: 'si può esportare un fotogramma come immagine',
  327: 'adesivi con animazioni di ingresso, uscita e cicliche',
  330: 'si compongono a mano con testo, forme e foto',
  331: 'testo su immagine a mano; niente modelli di meme',
  338: 'si registra schermo intero o una finestra, non un’area libera',
  354: 'si salva e si esporta un modello come file; niente galleria pubblica',
  357: 'modelli sì, generati da un’IA no',
  363: 'si condivide esportando il file del progetto o del modello',
  369: 'la musica e i suoni sono generati dal programma, i tuoi file restano tuoi',
  371: 'qualità dell’anteprima regolabile; niente proxy',
  383: 'si esporta un fotogramma come immagine',
  395: 'strumenti di ritocco manuali; niente guida con IA',
  401: 'solo nel programma per computer: strumenti classici',
  402: 'sottotitoli tradotti in inglese; niente doppiaggio',
  403: 'sintesi vocale del sistema (programma per computer)',
  404: 'effetti generati con regole',
  405: 'musica generata con regole',
  415: 'ritaglia le persone (MediaPipe)',
  416: 'ritaglia le persone (MediaPipe)',
  417: 'ritaglia la persona intera',
  427: 'testo su immagine a mano',
  428: 'look cartone sui pixel',
  429: 'solo nel programma per computer (interpolazione classica)',
  430: 'zoom e panoramica sulla foto',
};

/** Voci non incluse: numero → codice di REASONS (o frase). */
const NO = {
  3: 'MOB', 4: 'MOB', 6: 'Ciak non ha account (per scelta)', 14: 'PAGA', 15: 'ACC', 22: 'PAGA', 26: 'PAGA', 28: 'IA', 29: 'IA', 30: 'IA', 31: 'ACC',
  135: 'IA', 143: 'IA', 146: 'IA', 169: 'IA', 191: 'GEN',
  208: 'IA', 256: 'IA', 259: 'IA', 261: 'GEN', 262: 'GEN', 263: 'GEN', 264: 'GEN', 265: 'GEN', 266: 'GEN',
  270: 'GEN', 271: 'GEN', 272: 'GEN', 273: 'GEN', 274: 'GEN', 275: 'GEN', 276: 'GEN', 277: 'GEN', 279: 'PAGA', 280: 'GEN', 281: 'GEN', 282: 'GEN', 283: 'GEN', 284: 'GEN', 285: 'GEN', 286: 'GEN', 289: 'GEN',
  299: 'IA', 300: 'IA', 301: 'IA', 303: 'IA', 306: 'GEN', 307: 'GEN', 308: 'GEN', 309: 'GEN', 310: 'GEN', 311: 'GEN', 312: 'GEN', 313: 'GEN', 314: 'GEN', 317: 'IA', 318: 'GEN',
  321: 'GEN', 325: 'GEN', 328: 'GEN', 329: 'GEN', 341: 'MOB', 345: 'MOB', 355: 'ACC', 358: 'PAGA', 360: 'ACC', 361: 'ACC', 362: 'ACC', 364: 'ACC', 365: 'ACC', 366: 'ACC', 367: 'ACC', 368: 'PAGA', 370: 'IA',
  391: 'SOC', 392: 'SOC', 393: 'SOC', 396: 'GEN', 397: 'GEN', 398: 'GEN', 399: 'IA', 400: 'GEN', 406: 'GEN', 407: 'GEN', 408: 'GEN', 409: 'GEN', 410: 'GEN', 411: 'GEN', 412: 'GEN', 413: 'GEN', 414: 'GEN', 431: 'MOB',
};

function expand(ranges) {
  const s = new Set();
  for (const [a, b] of ranges) for (let i = a; i <= b; i++) s.add(i);
  return s;
}

/** Stato di ogni voce 1..431: {n, status, note, section}. */
export function catalog() {
  const text = readFileSync(path.join(ROOT, 'docs', 'capcut-catalogo-funzioni.txt'), 'utf8');
  const sections = [];
  const items = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const sec = /^(\d\d)\. (.+?) \((\d+) voci\)\s*$/.exec(line);
    if (sec) {
      cur = { id: sec[1], title: sec[2].replace(/\s+\(CATALOGO ESTESO\)/, ''), count: Number(sec[3]), items: [] };
      sections.push(cur);
      continue;
    }
    const it = /^(\d{3})\. (.+)$/.exec(line);
    if (it && cur) {
      const n = Number(it[1]);
      const item = { n, title: it[2], section: cur.id };
      cur.items.push(item);
      items.push(item);
    }
  }
  const ok = expand(OK);
  for (const it of items) {
    const n = it.n;
    if (Object.hasOwn(NO, n)) it.status = 'no';
    else if (Object.hasOwn(PARZ, n)) it.status = 'parz';
    else if (ok.has(n)) it.status = 'ok';
    else it.status = null;
    it.note = it.status === 'no' ? REASONS[NO[n]] ?? NO[n] : it.status === 'parz' ? PARZ[n] : OK_NOTE[n] ?? '';
  }
  return { sections, items };
}

const stripTitle = (t) => t.replace(/ \(.*\)$/, '').toLowerCase().replace(/\bai\b/g, 'IA').replace(/^./, (c) => c.toUpperCase());

/** Il blocco di Markdown per il README. */
export function renderTable() {
  const { sections, items } = catalog();
  const count = (st) => items.filter((i) => i.status === st).length;
  const lines = [];
  lines.push(`Il catalogo (\`docs/capcut-catalogo-funzioni.txt\`) elenca **${items.length} funzioni** di CapCut e dei suoi strumenti web. In Ciak Studio:`);
  lines.push('');
  lines.push(`- ✅ **${count('ok')}** fatte e provate`);
  lines.push(`- 🟡 **${count('parz')}** fatte in parte o in forma più semplice (sotto, con la nota di cosa manca)`);
  lines.push(`- ❌ **${count('no')}** non incluse (sotto, con il motivo)`);
  lines.push('');
  lines.push('| Sezione | ✅ | 🟡 | ❌ |');
  lines.push('| --- | ---: | ---: | ---: |');
  for (const s of sections) {
    const c = (st) => s.items.filter((i) => i.status === st).length;
    lines.push(`| ${s.id}. ${stripTitle(s.title)} | ${c('ok')} | ${c('parz')} | ${c('no')} |`);
  }
  lines.push('');
  lines.push('<details><summary><b>🟡 Fatte in parte</b> — cosa c\'è e cosa manca</summary>');
  lines.push('');
  lines.push('| Voce | Funzione | Nota |');
  lines.push('| ---: | --- | --- |');
  for (const i of items.filter((x) => x.status === 'parz')) lines.push(`| ${i.n} | ${i.title} | ${i.note} |`);
  lines.push('');
  lines.push('</details>');
  lines.push('');
  lines.push('<details><summary><b>❌ Non incluse</b> — e perché</summary>');
  lines.push('');
  lines.push('| Voce | Funzione | Motivo |');
  lines.push('| ---: | --- | --- |');
  for (const i of items.filter((x) => x.status === 'no')) lines.push(`| ${i.n} | ${i.title} | ${i.note} |`);
  lines.push('');
  lines.push('</details>');
  return lines.join('\n');
}

const START = '<!-- catalogo:inizio -->';
const END = '<!-- catalogo:fine -->';

export function readmeWithTable(readme) {
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a < 0 || b < 0) throw new Error('Mancano i segnaposto del catalogo nel README');
  return `${readme.slice(0, a + START.length)}\n${renderTable()}\n${readme.slice(b)}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--write')) {
  const p = path.join(ROOT, 'README.md');
  writeFileSync(p, readmeWithTable(readFileSync(p, 'utf8')));
  console.log('README aggiornato');
}
