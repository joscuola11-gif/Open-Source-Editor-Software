# 🎬 Ciak Studio

**Editor video non lineare open source.** Un vero programma per **Windows** (e una versione che gira nel
browser), con esportazione **MP4 H.264/AAC**. Funziona offline: i tuoi file non lasciano mai il computer.

Ispirato alla semplicità di CapCut, costruito su un nucleo di montaggio verificato da test automatici.

![Ciak Studio](docs/schermata.png)

## Installazione su Windows

1. Scarica **`Ciak-Studio-1.1.2-Windows-x64.zip`**.
2. **Estrai tutto** in una cartella a tua scelta (non avviarlo dall'interno dello zip), ad esempio `C:\Programmi\Ciak Studio` o sul Desktop.
3. Fai doppio clic su **`Ciak Studio.exe`**.

Non serve installare altro. Internet serve solo la prima volta che usi i sottotitoli automatici (per scaricare il modello).

> **Avviso di Windows (SmartScreen).** Il programma non è firmato con un certificato a pagamento, quindi la
> prima volta Windows può mostrare «Windows ha protetto il PC». Clicca **Ulteriori informazioni → Esegui comunque**.
> Succede con tutti i programmi gratuiti non firmati.

I progetti si salvano da soli (in `%APPDATA%\Ciak Studio`). Per portare il lavoro su un altro computer usa
**Salva .ciak** nelle impostazioni del progetto. Si disinstalla cancellando la cartella.

**Installer `.exe` con menu Start e disinstallatore:** si costruisce su un computer Windows con
`npm install && npm run dist:win`, oppure senza installare nulla, dal sito di GitHub: scheda **Actions →
«Programma desktop» → Run workflow** (compila anche macOS e Linux; gli installer compaiono negli *Artifacts*).
Questa è la via consigliata per l'installer perché su Windows vengono applicati anche icona e metadati dell'`.exe`.

## Versione browser (alternativa)

```bash
npm install
npm run build        # crea dist/ciak-studio.html (≈ 700 KB, tutto incluso)
```

Apri `dist/ciak-studio.html` con doppio clic in Chrome o Edge: funziona offline. Per lo sviluppo: `npm start`
(→ http://localhost:5173). Nel browser l'esportazione produce **WebM**; l'MP4 vero richiede il programma desktop.

Serve un browser recente con `MediaRecorder` e WebAudio. **Testato solo su Chromium (Chrome/Edge)**: con
Firefox e Safari non l'ho provato. Il codice prevede dei fallback (ad esempio un filtro colore software per i
browser senza `ctx.filter`), ma non sono verificati su quei browser.

## Cosa sa fare

**Montaggio**
- Tracce video e audio illimitate: blocca, nascondi, silenzia, rinomina, riordina; taglia, elimina (anche chiudendo lo spazio),
  duplica, copia/incolla, selezione multipla, calamita, marcatori, annulla/ripeti a 100 livelli
- **Velocità** costante 0,1×–8× e **curve di velocità** (speed ramp, 7 curve pronte + editor grafico), fotogramma fisso;
  nel programma per computer anche **al contrario**, stabilizzazione, meno disturbo, più nitidezza, ingrandimento 2×, più fluido, super rallentatore
- **Analisi del video**: divide per **scene** (tagli e dissolvenze), trova i **momenti migliori** (movimento + volume) e ne fa il montaggio

**Inquadratura e composizione**
- Formati 16:9 · 9:16 · 1:1 · 4:5 · 4:3 · 3:4 · 21:9, da 24 a 60 fps; ritaglio con maniglie e rapporti fissi
- **Inquadratura automatica** (16:9 → 9:16 con una camera virtuale che segue ciò che si muove)
- **Schermo diviso**, **PiP**, sfondo sfocato dietro il clip, movimenti di camera simulati (zoom, panoramiche, Ken Burns, mano libera)
- **Maschere** con sfumatura e keyframe, 11 metodi di fusione, **chroma key**, livelli di regolazione
- **Rimuovi sfondo (persona)** su video e foto (MediaPipe), con sfondo sostituibile
- **Inseguimento**: un testo, adesivo o immagine segue un oggetto del video

**Transizioni, animazioni, keyframe**
- **41 transizioni** in 8 gruppi (dissolvenze, scorrimenti, spinta, zoom, tendine, maschere, grafiche); animazioni di ingresso, uscita e cicliche
- **Keyframe** su posizione, scala, rotazione, opacità, volume e maschera, con **curve di Bézier** modificabili

**Colore ed effetti**
- Luminosità, contrasto, saturazione, esposizione, luci, ombre, nitidezza, temperatura, tinta, vignettatura, grana; **HSL**, **curva**,
  **ruote colore**, **LUT .cube**; **colore automatico** e «uniforma ai colori di un altro clip»
- 14 filtri e decine di effetti (cartone, matita, poster, retino, vecchio schermo, onda, vortice…) e **sovrapposizioni** (neve, pioggia, coriandoli, scintille, bokeh…)

**Testo e sottotitoli**
- Testo con modelli pronti, font tuoi, contorno, ombra, sfondo, animazioni e karaoke
- **Sottotitoli automatici dal parlato** con Whisper (nel programma per computer in locale, nel browser in WebAssembly): 13 lingue,
  tempi corretti parola per parola, stili per film/social/karaoke, correzione prima dell'inserimento, traduzione in inglese (anche bilingue),
  testo già pronto da mettere a tempo, solo i tempi; importa/esporta SRT, VTT, ASS, LRC, TXT; modifica il video **dalla trascrizione**; toglie pause ed esitazioni

**Audio, suoni e musica**
- Volume, dissolvenze, forma d'onda, **voce fuori campo**, **riduzione del rumore**, voce più chiara, normalizza, **altezza del suono**, effetti voce,
  togli/isola la voce, **battiti** e tagli a tempo di musica
- **27 effetti sonori** e **7 stili di musica** generati dal programma (nessun brano di altri, nessun diritto da rispettare)
- **Voce da testo** con le voci del sistema (programma per computer)

**Registrazione e modelli**
- Registra **schermo, finestra, webcam** (anche insieme) con microfono e audio del computer; **teleprompter**
- «I miei progetti» (salva, riapri, duplica), **11 modelli** pronti con anteprima, salva il tuo montaggio come modello

**Esportazione**
- **MP4 H.264/AAC** (programma per computer), MOV, MKV, WebM, H.265, AV1, fino a 4K e 60 fps, bitrate a scelta, solo audio **WAV/MP3/FLAC/M4A**, **GIF**,
  «Comprimi/converti» di un file qualsiasi; fotogramma PNG; pacchetto **`.ciak`** (progetto + media)

## Scorciatoie

`Spazio` riproduci · `←/→` fotogramma (con `Maiusc` 1 s) · `↑/↓` taglio precedente/successivo · `S` dividi ·
`Canc` elimina (`Maiusc+Canc` chiude lo spazio) · `Ctrl+Z / Maiusc+Z` annulla/ripeti · `Ctrl+C/X/V/D` copia/taglia/incolla/duplica ·
`M` marcatore · `N` calamita · `+/−` zoom · `\` adatta · `F` schermo intero · `Ctrl+E` esporta · `?` guida completa

## Cosa NON c'è (e perché)

Meglio dirlo chiaramente. Il dettaglio voce per voce è nel catalogo qui sotto.

- **IA generativa** (video, immagini, avatar, doppiaggio, rimozione di oggetti, ricostruzione di immagini): servono modelli enormi, quasi sempre a pagamento,
  che non girano sul tuo computer. Non ci sono pulsanti finti.
- **Contenuti con licenza e piani a pagamento di CapCut** (Pro, Ultra, crediti, librerie stock, modelli premium) e **cloud/squadra**: non sono replicabili.
  Suoni e musica sono generati dal programma, quindi liberi.
- **App per telefono** e **pubblicazione diretta** su TikTok/YouTube.
- **Le IA incluse hanno limiti**: il riconoscimento vocale vuole che tu scelga la lingua; l'inquadratura automatica segue ciò che si muove (non riconosce volti); la
  rimozione dello sfondo riconosce **persone**; la musica generata è semplice. Vedi `docs/capcut-stato.md`.
- **Il pacchetto Windows non è stato provato su un Windows vero** (qui non ne ho uno). È costruito dallo stesso codice del pacchetto Linux che invece è provato
  in Electron reale. Per il riconoscimento vocale serve «Microsoft Visual C++ Redistributable» (gratuito, di solito già presente).
- **Il riconoscimento vocale scarica un modello la prima volta** (da 40 MB, da huggingface.co): serve internet una volta, poi funziona anche offline.
  Nel browser, il motore di ritaglio e il riconoscimento si scaricano da jsDelivr/Hugging Face (non provati da qui, dove quei siti sono bloccati; provati con gli stessi file in locale).
- **L'esportazione è in tempo reale**: un video da 1 minuto richiede circa 1 minuto e la scheda deve restare visibile. È il prezzo di avere esattamente ciò
  che vedi in anteprima, con le API standard del browser.
- **Codec**: nel programma desktop l'MP4 si ottiene registrando l'anteprima e convertendola con ffmpeg (incluso). Quali file si possono **importare** dipende
  dal browser integrato: i formati più comuni (MP4 H.264, WebM, MP3, WAV, PNG, JPG) sì; codec insoliti (HEVC, ProRes, AVI antichi) possono non aprirsi.
- I **font caricati** valgono per la sessione (non sono salvati nel progetto).
- Non è un sostituto di DaVinci Resolve o Premiere: niente multicam né proxy per 4K+.

## Catalogo CapCut → stato

<!-- catalogo:inizio -->
Il catalogo (`docs/capcut-catalogo-funzioni.txt`) elenca **431 funzioni** di CapCut e dei suoi strumenti web. In Ciak Studio:

- ✅ **273** fatte e provate
- 🟡 **66** fatte in parte o in forma più semplice (sotto, con la nota di cosa manca)
- ❌ **92** non incluse (sotto, con il motivo)

| Sezione | ✅ | 🟡 | ❌ |
| --- | ---: | ---: | ---: |
| 01. Piattaforme, account e avvio | 7 | 3 | 5 |
| 02. Importazione e gestione media | 6 | 4 | 6 |
| 03. Timeline e montaggio di base | 24 | 1 | 0 |
| 04. Inquadratura, formato e trasformazioni | 17 | 1 | 0 |
| 05. Animazioni, keyframe e movimento | 15 | 2 | 0 |
| 06. Velocità, fluidità e riproduzione | 10 | 3 | 0 |
| 07. Transizioni | 11 | 0 | 0 |
| 08. Maschere, sfondi e compositing | 14 | 2 | 0 |
| 09. Filtri, effetti video e stili | 13 | 1 | 3 |
| 10. Regolazione video e color grading | 20 | 1 | 1 |
| 11. Testo e titolazione | 20 | 0 | 1 |
| 12. Sottotitoli, trascrizione e lingue | 19 | 3 | 1 |
| 13. Audio: montaggio e mix | 26 | 5 | 0 |
| 14. Strumenti IA per montaggio automatico | 7 | 9 | 8 |
| 15. IA generativa video, story e personaggi | 1 | 3 | 17 |
| 16. Fotografia e modifica immagini | 12 | 3 | 15 |
| 17. Design grafico, grafiche e asset | 4 | 5 | 4 |
| 18. Registrazione video e prompter | 10 | 1 | 2 |
| 19. Modelli e automazioni creative | 8 | 2 | 2 |
| 20. Progetti, cloud, team e risorse | 1 | 3 | 9 |
| 21. Esportazione, conversione e distribuzione | 19 | 1 | 3 |
| 22. Funzioni IA e strumenti web specializzati | 9 | 13 | 15 |

<details><summary><b>🟡 Fatte in parte</b> — cosa c'è e cosa manca</summary>

| Voce | Funzione | Nota |
| ---: | --- | --- |
| 2 | Usare CapCut su macOS (Desktop) | la configurazione c’è, ma non è provato né consegnato su macOS |
| 12 | Accedere agli strumenti AI dalla home o dall'editor | ci sono gli strumenti locali (sottotitoli, sfondo, scene…), non quelli generativi |
| 13 | Consultare le risorse gratuite e premium | ci sono risorse gratuite generate dal programma, non librerie premium |
| 23 | Utilizzare immagini o elementi stock disponibili | adesivi emoji, forme e sfondi; niente archivi di immagini |
| 24 | Utilizzare musica della libreria | musica generata dal programma (7 stili), non una libreria di brani |
| 25 | Utilizzare effetti sonori della libreria | 27 effetti generati con la sintesi, non registrati |
| 27 | Utilizzare asset ed elementi generati dall'AI | suoni e musica generati con regole, non con modelli generativi |
| 51 | Invertire il verso di riproduzione (reverse) | solo nel programma per computer (ffmpeg) |
| 73 | Auto Reframe AI per mantenere il soggetto nell'inquadratura (disponibilità variabile) | segue ciò che si muove, non riconosce volti o persone |
| 89 | Applicare camera tracking (funzione avanzata, spesso Pro) | c’è il tracciamento di un punto (2D), non la ricostruzione della camera 3D |
| 91 | Applicare effetti tipo 3D Zoom su fotografie (ove disponibili) | zoom e panoramica sulla foto (Ken Burns), senza vera profondità |
| 100 | Applicare Super Slow Motion AI (quando disponibile) | solo nel programma per computer: interpolazione classica, non IA |
| 101 | Usare strumenti di fluidificazione/interpolazione del movimento dove previsti | solo nel programma per computer: interpolazione classica |
| 102 | Invertire la riproduzione del video | solo nel programma per computer (ffmpeg) |
| 128 | Ritagliare/isolare automaticamente persone e altri soggetti (Auto Cutout) | ritaglia le persone (MediaPipe), non altri soggetti |
| 131 | Seguire un volto/oggetto con una maschera, dove supportato | un testo o adesivo può seguire un punto; la maschera non si aggancia da sola |
| 147 | Convertire contenuti in stile anime/cartoon tramite strumenti dedicati | filtro «cartone» e «matita» sui pixel, non un modello generativo |
| 168 | Rimuovere sfarfallio/flicker video (quando disponibile) | solo nel programma per computer (ffmpeg) |
| 204 | Generare/riconoscere testi musicali (Auto Lyrics, dove supportato) | se incolli il testo della canzone lo mette a tempo; non lo riconosce da sola |
| 212 | Tradurre sottotitoli con AI nei linguaggi supportati | solo verso l’inglese, con la funzione di traduzione di Whisper |
| 213 | Generare sottotitoli bilingui o localizzati dove previsto | inglese più originale; altre lingue no |
| 237 | Ridurre eco e difetti vocali negli strumenti previsti | riduzione del rumore sì; eco e riverbero no |
| 242 | Generare voce da testo (Text-to-Speech) | nel programma per computer, con le voci installate nel sistema |
| 243 | Selezionare voci sintetiche e lingue disponibili | le voci e lingue che ha il tuo sistema |
| 244 | Creare sound effects con AI dai prompt/contenuti, se abilitato | effetti generati con regole, non da una descrizione |
| 245 | Generare musica AI dai prompt, se abilitato | musica generata con regole, non da una descrizione |
| 246 | AutoCut: montaggio automatico da clip grezze | divide per scene, trova i momenti migliori e taglia a tempo; non monta da solo un video intero |
| 249 | AutoCut: montaggio da modelli e beat template | i modelli ci sono; i «beat template» no |
| 251 | Long Video to Shorts: ricavare clip brevi da video lunghi | momenti migliori + inquadratura verticale, in due passi |
| 255 | AI Auto Reframe per formati diversi | vedi 073 |
| 257 | AI Stabilization: ridurre tremolii | solo nel programma per computer (vidstab) |
| 258 | AI Enhance/Video Enhancer: migliorare chiarezza e definizione | solo nel programma per computer: meno disturbo e più nitidezza classici |
| 260 | AI Video Translator: tradurre video | sottotitoli tradotti in inglese; niente doppiaggio |
| 268 | AI video upscaling: migliorare risoluzione/dettaglio in strumenti dedicati | solo nel programma per computer: ingrandimento 2× classico, non IA |
| 269 | AI Video to Anime: conversione stilistica con strumenti dedicati | look cartone sui pixel, non un modello generativo |
| 287 | Generare voiceover sintetici da uno script | sintesi vocale del sistema (programma per computer) |
| 288 | Generare musica/soundtrack con AI negli strumenti abilitati | musica generata con regole |
| 290 | Usare template AI per produrre montaggi da materiali inseriti | i modelli ci sono (11), ma non sono creati da un’IA |
| 315 | Applicare look cartoon/illustrazione/3D con strumenti AI | filtro cartone/matita, non un modello generativo |
| 316 | Creare ritagli di volti (Face Cutout) | ritaglia l’intera persona, non solo il volto |
| 320 | Creare effetti 3D Zoom su foto | zoom e panoramica sulla foto, senza vera profondità |
| 322 | Creare locandine/poster mediante tool dedicati | si possono comporre locandine con testo, forme e foto; niente modelli di grafica |
| 323 | Creare miniature/thumbnail per video | si può esportare un fotogramma come immagine |
| 327 | Usare stickers animati | adesivi con animazioni di ingresso, uscita e cicliche |
| 330 | Progettare grafiche per pubblicità e contenuti social | si compongono a mano con testo, forme e foto |
| 331 | Creare meme tramite strumenti dedicati | testo su immagine a mano; niente modelli di meme |
| 338 | Registrare un'area dello schermo tramite Screen Recorder | si registra schermo intero o una finestra, non un’area libera |
| 354 | Creare un modello riutilizzabile come creator idoneo | si salva e si esporta un modello come file; niente galleria pubblica |
| 357 | Usare AI templates per montaggio/generazione automatizzati | modelli sì, generati da un’IA no |
| 363 | Condividere contenuti/progetti secondo le opzioni disponibili | si condivide esportando il file del progetto o del modello |
| 369 | Consultare condizioni di licenza di musica e media | la musica e i suoni sono generati dal programma, i tuoi file restano tuoi |
| 371 | Regolare impostazioni di performance/proxy in Desktop dove previste | qualità dell’anteprima regolabile; niente proxy |
| 383 | Modificare/copertina/thumbnail del video ove previsto | si esporta un fotogramma come immagine |
| 395 | AI Photo Editor (ritocco e modifiche guidate) | strumenti di ritocco manuali; niente guida con IA |
| 401 | AI Video Enhancer (miglioramento video) | solo nel programma per computer: strumenti classici |
| 402 | AI Video Translator (traduzione contenuto video) | sottotitoli tradotti in inglese; niente doppiaggio |
| 403 | AI Voice Generator (sintesi vocale) | sintesi vocale del sistema (programma per computer) |
| 404 | AI Sound Effects Generator (effetti audio) | effetti generati con regole |
| 405 | AI Music Generator (musica generata) | musica generata con regole |
| 415 | Image Background Remover | ritaglia le persone (MediaPipe) |
| 416 | Video Background Remover | ritaglia le persone (MediaPipe) |
| 417 | Face Cutout | ritaglia la persona intera |
| 427 | Meme Maker | testo su immagine a mano |
| 428 | Video to Anime | look cartone sui pixel |
| 429 | Super Slow Motion | solo nel programma per computer (interpolazione classica) |
| 430 | 3D Zoom / Photo Animation | zoom e panoramica sulla foto |

</details>

<details><summary><b>❌ Non incluse</b> — e perché</summary>

| Voce | Funzione | Motivo |
| ---: | --- | --- |
| 3 | Usare CapCut su Android (Mobile) | App per telefono: Ciak è per computer e browser |
| 4 | Usare CapCut su iOS/iPadOS (Mobile; interfaccia variabile) | App per telefono: Ciak è per computer e browser |
| 6 | Accedere o registrare un account | Ciak non ha account (per scelta) |
| 14 | Gestire abbonamento e funzioni Pro | Contenuti con licenza o a pagamento (stock, piano Pro): non si possono includere |
| 15 | Usare CapCut Space per i contenuti e i progetti supportati | Account, cloud e lavoro in squadra: Ciak funziona senza account e senza server |
| 22 | Utilizzare video stock dalla libreria CapCut | Contenuti con licenza o a pagamento (stock, piano Pro): non si possono includere |
| 26 | Utilizzare materiali con green screen predefiniti | Contenuti con licenza o a pagamento (stock, piano Pro): non si possono includere |
| 28 | Cercare media mediante ricerca intelligente per oggetti (nelle versioni supportate) | Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare |
| 29 | Cercare media mediante dialoghi/parlato (nelle versioni supportate) | Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare |
| 30 | Cercare media mediante persone (nelle versioni supportate) | Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare |
| 31 | Caricare o richiamare contenuti dallo spazio cloud supportato | Account, cloud e lavoro in squadra: Ciak funziona senza account e senza server |
| 135 | Applicare effetti sul corpo/volto ove disponibili | Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare |
| 143 | Usare effetti 3D e profondità disponibili | Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare |
| 146 | Applicare stili automatici AI (Auto Styles, disponibilità variabile) | Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare |
| 169 | Correggere/ottimizzare illuminazione con strumenti AI (Relight) | Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare |
| 191 | Creare testo con font/stili AI, ove disponibili | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 208 | Rilevare/differenziare parlanti nei sottotitoli se previsto dalla versione/regione | Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare |
| 256 | AI Eye Contact per orientare lo sguardo verso la camera (dove disponibile) | Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare |
| 259 | AI Relight: compensare illuminazione problematica | Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare |
| 261 | AI dubbing: localizzare voce/parlato dove disponibile | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 262 | AI Lip Sync: sincronizzare movimenti della bocca e audio | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 263 | AI Remove: cancellare elementi indesiderati in video/immagini | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 264 | AI Text Remover: rimuovere testo da immagini/video secondo strumento | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 265 | AI People Remover: rimuovere persone da fotografie quando previsto | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 266 | AI Inpainting: ricostruire zone modificate | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 270 | Generare video da prompt testuale (Text-to-Video) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 271 | Generare video a partire da una o più immagini (Image-to-Video) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 272 | Generare un video a partire da un argomento/idea (AI Story Maker) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 273 | Generare/espandere una sceneggiatura con AI Writer | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 274 | Script-to-Video: trasformare uno script in sequenza di scene | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 275 | Usare un AI storyboard come base di progettazione | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 276 | Generare o selezionare visual per ogni scena | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 277 | Applicare stili visivi ai filmati generati | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 279 | Usare modelli Seedance integrati nelle interfacce che li espongono | Contenuti con licenza o a pagamento (stock, piano Pro): non si possono includere |
| 280 | Utilizzare un AI Avatar come presentatore | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 281 | Selezionare avatar dal catalogo disponibile | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 282 | Sincronizzare voce/audio e avatar | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 283 | Creare personaggi parlanti a partire da fotografie (Talking Photo) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 284 | Applicare AI Dialogue Scene per scene di conversazione | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 285 | Applicare Mimic Motion per trasferire/imitare movimenti (dove supportato) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 286 | Personalizzare voce e testo degli avatar | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 289 | Generare una scena e rifinirla con tagli, effetti, musica e titoli | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 299 | Ritoccare ritratti mediante strumenti disponibili | Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare |
| 300 | Applicare smoothing/levigatura pelle quando previsto | Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare |
| 301 | Applicare trucco virtuale/Makeup quando previsto | Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare |
| 303 | Aumentare definizione e risoluzione con AI Image Upscaler | Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare |
| 306 | Generare uno sfondo fotografico da prompt | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 307 | Rimuovere oggetti indesiderati con AI Remove | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 308 | Rimuovere testo da una foto con AI Text Remover | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 309 | Rimuovere persone indesiderate dove supportato | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 310 | Utilizzare AI Inpainting per ricostruire aree | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 311 | Espandere i bordi della foto con AI Outpainting | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 312 | Fare trasformazioni image-to-image/trasferimento di stile | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 313 | Generare immagini da testo (Text-to-Image) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 314 | Generare immagini con immagini di riferimento quando supportato | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 317 | Creare foto prodotto con sfondi costruiti/AI | Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare |
| 318 | Cambiare l'abbigliamento in un'immagine tramite AI dove previsto | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 321 | Creare materiali grafici nei tool AI Design/Design Studio (se disponibili) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 325 | Generare adesivi tramite prompt AI | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 328 | Generare illustrazioni e artwork AI | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 329 | Generare un'immagine/logo tramite AI Logo Generator | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 341 | Usare il teleprompter integrato nell'app Mobile | App per telefono: Ciak è per computer e browser |
| 345 | Usare camera anteriore o posteriore in modalità teleprompter Mobile | App per telefono: Ciak è per computer e browser |
| 355 | Pubblicare un template nella galleria pubblica se creator autorizzato | Account, cloud e lavoro in squadra: Ciak funziona senza account e senza server |
| 358 | Accedere a modelli premium con piano idoneo | Contenuti con licenza o a pagamento (stock, piano Pro): non si possono includere |
| 360 | Usare CapCut Space/cloud storage, secondo piano | Account, cloud e lavoro in squadra: Ciak funziona senza account e senza server |
| 361 | Sincronizzare progetti e file tra dispositivi dove supportato | Account, cloud e lavoro in squadra: Ciak funziona senza account e senza server |
| 362 | Aprire un progetto cloud da Desktop/Web/Mobile compatibili | Account, cloud e lavoro in squadra: Ciak funziona senza account e senza server |
| 364 | Usare funzioni di collaborazione per team nei piani compatibili | Account, cloud e lavoro in squadra: Ciak funziona senza account e senza server |
| 365 | Usare modelli/template condivisi dal team dove supportato | Account, cloud e lavoro in squadra: Ciak funziona senza account e senza server |
| 366 | Usare librerie di brand o risorse del marchio nei piani compatibili | Account, cloud e lavoro in squadra: Ciak funziona senza account e senza server |
| 367 | Usare funzioni di revisione/collaborazione dove supportate | Account, cloud e lavoro in squadra: Ciak funziona senza account e senza server |
| 368 | Consultare disponibilità o restrizioni degli asset premium | Contenuti con licenza o a pagamento (stock, piano Pro): non si possono includere |
| 370 | Eseguire verifiche di copyright supportate prima dell'export | Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare |
| 391 | Condividere/pubblicare tramite scorciatoie TikTok dove presenti | Pubblicazione diretta su TikTok/YouTube: richiede accordi con le piattaforme |
| 392 | Condividere/pubblicare tramite scorciatoie YouTube dove presenti | Pubblicazione diretta su TikTok/YouTube: richiede accordi con le piattaforme |
| 393 | Selezionare parametri di pubblicazione supportati nella condivisione diretta | Pubblicazione diretta su TikTok/YouTube: richiede accordi con le piattaforme |
| 396 | AI Image Generator (da prompt) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 397 | AI Image-to-Image Generator (variazione/trasferimento stile) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 398 | AI Image Expander (outpainting) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 399 | AI Image Upscaler (miglioramento risoluzione foto) | Funzione di IA non inclusa: non c’è un modello libero adatto che abbia potuto provare |
| 400 | AI Video Generator (text-to-video/image-to-video) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 406 | AI Story Generator (generazione storie/script) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 407 | AI Design Studio (design da prompt) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 408 | AI Dialogue Scene (scene dialogate generate) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 409 | AI Avatar Generator (presentatori digitali) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 410 | AI Lip Sync (allineamento labiale) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 411 | AI Remove (rimozione di elementi) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 412 | AI Text Remover (rimozione testo) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 413 | AI People Remover (rimozione persone) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 414 | AI Inpainting (ricostruzione elementi) | IA generativa: servono modelli enormi a pagamento o non eseguibili sul tuo computer |
| 431 | Teleprompter Mobile | App per telefono: Ciak è per computer e browser |

</details>
<!-- catalogo:fine -->

La tabella si rigenera con `node tools/catalog-status.mjs --write` e una prova controlla che ogni voce abbia uno stato e che questa pagina sia aggiornata.

## Affidabilità: cosa è stato verificato

«Senza bug» non si può dimostrare; si può testare molto. Cosa viene eseguito davvero:

- **Fuzzing del montaggio**: centinaia di migliaia di operazioni casuali (aggiungi, sposta, ritaglia, dividi,
  velocità, transizioni, ripple, incolla, fotogramma fisso, blocco tracce…). Dopo ognuna il progetto deve restare
  valido e undo/redo devono riportare **esattamente** allo stato precedente. Ha già scovato bug reali.
- **Test nel browser vero (Chromium)** con media generati da ffmpeg: importazione, riproduzione con
  sincronizzazione A/V misurata, mouse e tastiera, **lettura dei pixel dell'anteprima** (filtri, chroma key,
  transizioni, keyframe, maschere), ripristino dopo il ricaricamento, drag & drop, tema, layout da 560 a 1920 px.
- **L'esportazione viene verificata con strumenti esterni**: `ffprobe` (durata, risoluzione, tracce),
  `ffmpeg` (decodifica senza errori, volume audio, contenuto del fotogramma); il pacchetto `.ciak` con `zipfile` di Python.
- **Programma desktop**: provato in Electron reale (finestra, niente accesso a Node dalla pagina, navigazione esterna e rete
  bloccate, microfono, esportazione, persistenza fra riavvii, istanza singola) e **nella versione impacchettata**
  (`app.asar` + ffmpeg incluso). L'MP4 è controllato con ffprobe: codec, gamma colore, frequenza costante, indice
  all'inizio e **colori delle barre di prova corretti**.
- Ogni test E2E fallisce se compare un errore in console.

**Cosa NON ho potuto provare:** l'`.exe` su un Windows reale (qui non ne ho uno): il pacchetto Windows è costruito
dallo stesso codice e dalla stessa struttura del pacchetto Linux testato, ma non è stato eseguito su Windows.

```bash
npm test             # unitari + fuzzing (secondi)
npm run test:e2e     # Chromium reale + ffmpeg (alcuni minuti; serve ffmpeg e il Chromium di Playwright)
npm run test:desktop # programma Electron reale in uno schermo virtuale (Linux: serve xvfb)
npm run bench        # prestazioni sulla tua macchina
FUZZ_SEEDS=800 FUZZ_STEPS=300 npm test    # campagna di fuzzing estesa
```

## Prestazioni

Misure su Chromium *headless con rendering software* (nessuna GPU): su un computer reale con GPU sono migliori.

| Caso | Misura |
| --- | --- |
| Operazione di montaggio con 2000 clip su 20 tracce | ≈ 12 ms (sotto 1 ms nei progetti normali) |
| Un livello immagine con filtro/effetti statici, 720p | ≈ 0,4 ms (cache dell'aspetto) |
| Chroma key su immagine, 720p | 12 ms → 0,4 ms con la cache |
| Caso estremo: 7 livelli con grana, vignetta, glitch, VHS… impilati | ≈ 73 ms a 720p (peggiore scenario) |
| Esportazione 480p/30 fps di 3 s | 89 fotogrammi su 90 |

Le ottimizzazioni principali: strato offscreen solo se serve, cache dell'aspetto statico dei clip immagine,
glow a risoluzione ridotta, riconciliazione del DOM della timeline per chiave, esportazione pilotata da un
timer invece che dal refresh della pagina.

## Struttura

Vedi [`docs/ARCHITETTURA.md`](docs/ARCHITETTURA.md). In breve: `src/core` (logica pura e testabile),
`src/engine` (rendering, audio, riproduzione, esportazione), `src/ui` (interfaccia senza framework).

## Contribuire

Le modifiche al modello partono da `src/core` con il loro test; se toccano la timeline, aggiungi l'operazione
al fuzzer. Segnala bug riproducibili con il file `.ciak` del progetto, se possibile.

## Licenza

Il codice di Ciak Studio è **MIT** — vedi [`LICENSE`](LICENSE).

Ciak Studio usa solo software libero che permette l'uso anche commerciale, a condizione di conservare gli avvisi di licenza. L'elenco completo, con i testi,
è in [`docs/LICENZE-TERZE.txt`](docs/LICENZE-TERZE.txt) (e viaggia nel pacchetto, accanto al programma). In breve:

| Cosa | Licenza | A cosa serve |
| --- | --- | --- |
| Electron / Chromium | MIT / BSD | la finestra del programma |
| ffmpeg (build di [eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)) | GPLv3 | conversioni e MP4; è eseguito come programma separato, sorgenti su ffmpeg.org |
| Whisper (OpenAI) e transformers.js, onnxruntime | MIT / Apache-2.0 | sottotitoli automatici (il modello si scarica la prima volta) |
| MediaPipe (Google) | Apache-2.0 | rimuovi sfondo |
| lamejs | LGPL-3.0 | codificatore MP3, incorporato nella pagina: si costruisce dai sorgenti con `npm run build` e si può sostituire |
| gifenc | MIT | codificatore GIF |

I suoni, la musica e i sottotitoli che crei con Ciak Studio sono tuoi. I **file che importi** (video, musica, foto) restano soggetti ai diritti di chi li ha creati: questo è il rischio vero
nei video pubblicati, non il programma. L'uso dei codec H.264/AAC può essere soggetto a licenze di brevetto in alcuni paesi per la distribuzione commerciale: per l'uso personale non cambia nulla.
Questo non è un parere legale.
