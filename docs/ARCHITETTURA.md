# Architettura di Ciak Studio

JavaScript puro (moduli ES), nessuna dipendenza a runtime e nessun passaggio di build per lo sviluppo.
Tre livelli con dipendenze che vanno in una sola direzione: `ui → engine → core`.

```
src/
├─ core/     Logica pura: gira identica in Node (test) e nel browser. Nessun DOM.
├─ engine/   Rendering, audio, riproduzione, esportazione, storage (usa le API del browser).
└─ ui/       Interfaccia: DOM costruito con un piccolo helper `h()`, nessun framework.
```

## core — il modello e le sue regole

| Modulo | Compito |
| --- | --- |
| `project.js` | Struttura dati del progetto, valori predefiniti, `sanitizeProject` (ripara i file danneggiati) |
| `timeline.js` | Tutte le operazioni di montaggio + `validateProject` (unica fonte di verità sugli invarianti) |
| `store.js` | Cronologia undo/redo a istantanee, *gesture* (trascinamenti = una sola voce), selezione |
| `keyframes.js` | Interpolazione (lineare, accelera, rallenta, morbido, scatto) e divisione con continuità |
| `animations.js` | Registro unico di animazioni di ingresso/uscita e transizioni |
| `audio-math.js` | Guadagno di un clip: volume, keyframe, dissolvenze, crossfade a potenza costante |
| `srt.js`, `webm.js`, `zip.js` | Sottotitoli, correzione della durata WebM, pacchetto `.ciak` |

### Invarianti di una traccia
I clip sono ordinati per `start` e:

1. due clip consecutivi possono sovrapporsi **solo** se il secondo ha una transizione e la sovrapposizione non supera la sua durata;
2. un clip non può sovrapporsi a due clip contemporaneamente.

Ogni operazione lavora su una **bozza clonata** del progetto e lancia `EditError` se l'esito è impossibile;
`Store.commit` valida la bozza e, se non è valida, la scarta: il progetto non passa mai per uno stato
intermedio o corrotto. Per questo undo/redo sono esatti per costruzione.

### Transizioni = sovrapposizioni reali
`setTransition` sposta il clip (e quelli successivi della stessa traccia) a sinistra della durata della
transizione, così il clip precedente e quello nuovo condividono davvero l'intervallo: nessun trucco di
"fermo immagine". L'audio fa un crossfade a potenza costante nella stessa zona.

## engine — dal progetto ai pixel

- **`renderer.js`** compone un fotogramma `render(ctx, project, t)`: tracce dal basso verso l'alto →
  valori con keyframe e animazioni → sorgente → fase pixel (chroma key, mosaico, glitch…) → trasformazione,
  maschera, filtro → overlay. Tutte le misure sono relative al canvas, quindi **anteprima ed esportazione
  usano lo stesso codice** e producono la stessa immagine a qualsiasi risoluzione.
  Ottimizzazioni: strato offscreen solo se serve; cache dell'aspetto statico dei clip immagine (si attiva
  dopo due fotogrammi con parametri identici); glow a 1/4 di risoluzione; canvas di lavoro a crescita monotona.
- **`player.js`** è l'orologio. In pausa disegna solo dopo che i `<video>` hanno completato il seek; in
  riproduzione mantiene il fotogramma precedente se un video non è pronto (niente lampeggi neri), corregge la
  deriva con una lieve variazione della velocità e fa seek solo oltre soglia, pre-posiziona i clip in arrivo.
  In esportazione è pilotato da un timer (non da `requestAnimationFrame`): la cadenza non dipende dalla
  velocità di composizione della pagina.
- **`audio-engine.js`**: `elemento → GainNode del clip → bus → limiter → altoparlanti | registrazione`.
- **`exporter.js`**: registra il canvas a piena risoluzione + audio con `MediaRecorder`, un fotogramma per
  indice (`requestFrame`), poi ripara la durata del WebM. Riporta quanti fotogrammi sono stati davvero prodotti.
- **`storage.js`**: IndexedDB per progetto e file. **`media-pool.js`**: Blob, immagini decodificate e un
  elemento media per clip con limite di memoria.

## ui

`app.js` crea i servizi e implementa **tutte le azioni** (`app.actions`): pulsanti, menu contestuali e
scorciatoie chiamano le stesse funzioni. Nessun componente tiene copia dello stato: la timeline riconcilia
il DOM per chiave (`id` del clip) e l'inspector aggiorna i valori dei controlli senza ricostruirli, così non
si perde il focus durante un trascinamento.

### Disposizione della finestra

`workspace-layout.js` governa il pulsante «Layout». Non sposta mai nodi nel DOM (altrimenti il canvas e i media
si reinizializzerebbero): scrive **attributi `data-*`** su `.app` e `.workspace` (disposizione, pannelli visibili,
timeline) e variabili CSS (`--lib-w`, `--insp-w`); tutta la geometria sta in `styles.css` con `grid-template-areas`,
solo sopra i 900 px. L'anteprima libera è la stessa sezione con `position: fixed` (`.preview.floating`): la barra
del titolo e le maniglie sono sempre nel DOM e si mostrano solo in quella modalità. Stato e posizione stanno in
`prefs` (`workspace`), vengono ripuliti e riportati dentro la finestra a ogni lettura e a ogni ridimensionamento.

## Sottosistemi delle funzioni «intelligenti»

Tutti seguono la stessa regola: la **logica sta in `src/core` (pura, senza DOM, con prove su dati noti)** e `src/engine`/`src/ui`/`desktop` fanno solo
da collante con il browser o il sistema.

| Funzione | Nucleo puro | Collante | Come è provata |
| --- | --- | --- | --- |
| Sottotitoli automatici | `vad.js` (voce/silenzio), `wordtimes.js` e `align.js` (tempi delle parole con sillabe contate), `captions.js` (spezzare, a capo, durate, karaoke), `transcribe.js` (pipeline con riconoscitore intercambiabile, traduzione) | `engine/asr-engines.js` (Whisper nel programma per computer via IPC, nel browser con WebAssembly), `desktop/asr.cjs`, `ui/captions-dialog.js` | voce umana vera (jfk.wav, pubblico dominio), voce sintetica con tempi noti, **modello Whisper tiny vero** in Node, nel browser, in Electron e nel pacchetto |
| Suoni e musica | `synth.js` (oscillatori, filtri, riverbero; 27 effetti; musica a regole con scala/accordi/ritmo) | `ui/sounds-panel.js` | misure sul segnale: frequenze, tempo (con `beats.js`), tonalità, durata, livello |
| Analisi del video | `scenes.js`, `highlights.js`, `timeline.js` (`splitClipAtTimes`, `keepOnly`, nel fuzzer) | `engine/video-analysis.js` (fotogrammi piccoli con `<video>`) | video con tagli, movimento e volume noti |
| Inseguimento | `tracker.js` (correlazione normalizzata, sotto il pixel), `trackmap.js` (coordinate canvas ↔ video) | azione `trackObject`, modalità «scegli il punto» in `preview-view.js` | ripresa con camera mossa e percorso noto |
| Inquadratura automatica | `reframe.js` (soggetto, camera virtuale, keyframe) | azione `autoReframe` | quadrato in movimento 16:9 → 9:16 |
| Rimuovi sfondo | `cutout.js` (rifinitura, fluidità, dati del clip) | `engine/cutout.js` (MediaPipe + archivio maschere), `renderer.js` (`destination-in`) | foto vera (astronauta NASA), video, Electron e pacchetto |

La rete: la versione browser carica da jsDelivr/Hugging Face solo ciò che serve a queste funzioni (la CSP di `index.html` elenca gli host);
il programma per computer **blocca ogni richiesta di rete della pagina** (`hardenSession`) e fa lui i download (Whisper, nel processo principale) o serve i file
inclusi con un protocollo interno (`ciak-asset://`, solo per nome di file, da una cartella fissa).

## desktop — il programma per Windows/macOS/Linux

`desktop/main.cjs` mostra `dist/ciak-studio.html` in una finestra Electron. La pagina è la stessa della versione
browser; il guscio aggiunge solo ciò che un browser non può fare.

- **Sicurezza**: `contextIsolation` e `sandbox` attivi, nessun accesso a Node dalla pagina, navigazione esterna e
  `window.open` bloccati, permessi concessi solo alla nostra pagina (microfono per il voice-over, schermo intero),
  ogni richiesta di rete della pagina bloccata dal processo principale (anche se la Content-Security-Policy della versione browser ne
  ammette alcune), strumenti sviluppatore (F12) solo da sviluppo.
- **Ponte minimo** (`preload.cjs`): espone `window.ciakDesktop` con poche funzioni (conversioni ffmpeg, strumenti video, voce da testo,
  riconoscimento vocale, scelta dello schermo da registrare). Ogni chiamata IPC verifica che il mittente sia la nostra pagina.
- **Riconoscimento vocale** (`asr.cjs`): Whisper con onnxruntime-node nel processo principale; il modello si scarica la prima volta in `%APPDATA%/…/modelli`.
  Il pacchetto contiene solo i file di Windows x64 (senza DirectML né `sharp`); `package.json` (`build.win.files`, `asarUnpack`) e una prova ne controllano il contenuto.
- **MP4**: il registratore del browser produce WebM VP9; `ffmpeg` (incluso in `resources/ffmpeg`) lo converte in H.264
  `yuv420p` a gamma limitata BT.709 con frequenza costante e `faststart`. Il file è scritto come `.part` e rinominato
  solo a conversione riuscita; la destinazione la sceglie l'utente con la finestra di sistema.
- **Robustezza**: istanza singola, memoria di posizione/dimensione, conferma se si chiude durante un'esportazione,
  recupero da crash del processo di rendering (il progetto è salvato in automatico).
- **Build**: `npm run dist:win` (electron-builder). Da Linux si ottiene lo zip portatile; l'installer NSIS richiede
  Windows o wine, perciò c'è un workflow GitHub Actions (`.github/workflows/desktop.yml`).

## Test

| Livello | Dove | Cosa dimostra |
| --- | --- | --- |
| Unitari | `tests/unit` | Operazioni di timeline, keyframe, formati, pixel, audio, sottotitoli, sintesi, analisi, catalogo, pacchetto |
| Integrazione | `tests/integration` | Il modello Whisper vero in Node (voce vera e sintetica) |
| Fuzzing | `tests/unit/fuzz.test.js` | Sequenze casuali di operazioni: progetto sempre valido, undo/redo esatti |
| E2E | `tests/e2e` | Chromium reale: import, disposizione della finestra, riproduzione sincronizzata, interazione col mouse, pixel dell'anteprima, esportazione verificata con ffprobe/ffmpeg, ripristino, pacchetto `.ciak` verificato con un lettore ZIP esterno |
| Desktop | `tests/desktop` | Electron reale (e impacchettato) in schermo virtuale: sicurezza, MP4 verificato con ffprobe e colori, persistenza |
| Prestazioni | `tests/bench.js` | Tempi di logica e rendering (non asserisce: dipende dall'hardware) |

Per aggiungere una funzione: modifica il modello in `core` con il suo test; se tocca la timeline, il fuzzer la
esercita automaticamente (aggiungi l'operazione a `ops` in `fuzz.test.js`); poi `engine`/`ui`.
