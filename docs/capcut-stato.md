# Catalogo CapCut → stato in Ciak Studio

Riferimento: `docs/capcut-catalogo-funzioni.txt` (numeri delle voci). Aggiornato a mano a ogni gruppo di funzioni.

## Fatto in questo giro
| Voci | Funzione | Dove |
| --- | --- | --- |
| 42-43 | Elimina la parte a sinistra / a destra della testina (tasti `Q` / `W`, pulsanti, menu) | `core/timeline.js` `trimToTime` · test unitari, fuzz, E2E |
| 152-157 | Esposizione, alte luci, ombre, nitidezza (pannello Regolazione → Tono) | `core/grade.js`, `engine/renderer.js` · unitari ed E2E sui pixel |
| 161-162 | HSL per colore (6 fasce: tinta, saturazione, luminosità) | idem |
| 163 | Curva (5 punti, interpolazione cubica monotona) | idem |
| 164 | Ruote colore (ombre, toni medi, luci: tinta e intensità) | idem |
| 165-166 | Importazione LUT 3D `.cube` (anche 65 punti, ridotte a 33) con intensità | `core/grade.js` `parseCube`, azione `importLut` |
| 170 | Stessa correzione anche sui livelli di regolazione (uniformare più clip) | `adjustment` usa lo stesso passaggio |
| 202-203 | Karaoke: colore di evidenza parola per parola (tempi del file o automatici, due modi) | `core/karaoke.js`, `engine/renderer.js` |
| 209-211 | Sottotitoli: importazione SRT, WebVTT, ASS/SSA (anche karaoke `\k`), LRC (anche esteso), TXT; esportazione SRT, VTT, TXT, LRC | `core/subtitles.js` |
| 197 | Sposta tutti i sottotitoli di ±N secondi (sincronizzazione) | azione `shiftSubtitles` |
| 206 | Modifica del video dalla trascrizione: «Taglia» toglie la frase da tutte le tracce e chiude il buco | `core/timeline.js` `cutRange` · fuzz esteso |
| 207, 253 | Rimozione di pause e silenzi dall'inviluppo audio, con anteprima del conteggio | `core/silence.js` |
| 183 | Modelli di testo pronti: da 8 a 23 (terzo inferiore, cinema, fumetto, citazione, pillola, neon, fuoco…) | `core/presets.js` |
| 187, 84 | Animazioni cicliche per tutto il clip (pulsa, battito, fluttua, dondola, ondeggia, trema, lampeggia, respira, gira) | `core/animations.js` |
| 231 | Altezza del suono (±12 semitoni) senza cambiare la velocità (vocoder di fase) | `core/audio-fx.js` |
| 234 | Normalizza il volume del clip a un livello (RMS con soglia, tetto sui picchi) | azione `normalizeClip` |
| 235, 236 | Riduzione del rumore di fondo (sottrazione spettrale) e «voce più chiara» | `core/audio-fx.js` |
| 238, 239 | Togli la voce da un brano stereo; isola la voce (approssimata) | idem |
| 240, 241 | Effetti voce: grave, acuta, scoiattolo, mostro, robot, telefono, megafono, eco, caverna | idem |
| 232, 233, 104, 248 | Rilevamento di tempo e battiti, marcatori «Battito», tagli a tempo di musica (ogni 1/2/4/8 battiti) | `core/beats.js` |
| 384, 386 | Esportazione di solo audio WAV (mixaggio a freddo: volume, keyframe, dissolvenze, crossfade, velocità) | `core/mixdown.js` |
| 385 | MP3 192 kbit/s nel browser e nel programma desktop (codificatore incluso) | `engine/audio-export.js` |
| 387 | FLAC (programma desktop, ffmpeg incluso) | `desktop/main.cjs` |
| 384 | M4A/AAC (programma desktop) | idem |
| 381 | MOV H.264/AAC (programma desktop) | idem |
| 394 | GIF animata (12 fps, lato corto fino a 480 px, fotogramma per fotogramma) | `engine/audio-export.js` |
| 242-243 | Voce da testo con le voci installate nel sistema (Windows, macOS, Linux), anteprima e clip audio | `desktop/tts.cjs` · prova nel programma desktop |
| 051, 100-101, 168, 257-258, 268 | Strumenti video con ffmpeg: al contrario, stabilizza (vidstab), meno disturbo, più nitido, anti-sfarfallio, ingrandisci 2×, più fluido, super rallentatore | `desktop/main.cjs` · prove con misure (PSNR, tremolio) |
| 376-382 | 4K, H.265, MKV, WebM VP9/AV1, bitrate personalizzato, «Comprimi/converti» di un file qualsiasi | `desktop/main.cjs` |
| 334-340 | Registrazione di schermo, finestra o webcam (anche insieme, webcam in un cerchio), con microfono e audio del computer (Windows), barra «Registrazione» e clip subito sulla timeline | `engine/screen-recorder.js` · prove nel browser e in Electron con schermo vero |
| 341-346 | Teleprompter (versione per computer): copione che scorre da solo a parole al minuto, specchio, finestra mobile e ridimensionabile, parte con la registrazione, appunti `//` | `core/teleprompter.js`, `ui/teleprompter.js` |
| 105-115, 144 | 41 transizioni in 8 gruppi: dissolvenza, sfocatura, scorrimento, spinta (anche il clip uscente si muove), zoom, tendine e divisione, maschere (rombo, stella, cuore, orologio…), grafiche (veneziane, scacchiera, mosaico, glitch) | `core/animations.js`, `core/reveal.js` · prove a pixel |
| 007-010, 359 | «I miei progetti»: salva con nome, aggiorna, apri, duplica, rinomina, elimina; miniatura; i file si condividono fra progetti | `engine/storage.js` (v2), `ui/projects-dialog.js` |
| 347-353, 356 | Modelli: 11 modelli pronti (verticali, quadrati, orizzontali), categorie e ricerca, anteprima animata, i tuoi video/foto/musica/testi al posto dei segnaposto (i tempi seguono i clip), si usano come un progetto normale | `core/templates.js`, `core/template-lib.js`, `engine/template-preview.js` |
| 354, 356 | Salva il tuo montaggio come modello; esporta e importa il file `.ciak-modello` per condividerlo | idem |
| 074, 311 | Sfondo dietro il clip: copia sfocata (o colore) al posto dei bordi neri, per un clip o per tutti | `engine/renderer.js` |
| 070-071 | Disposizioni schermo diviso (2, 3, 4 riquadri, 1+2) e PiP (4 angoli), con riempi/adatta | `core/layouts.js` |
| 090 | Movimenti di camera simulati: zoom lento, panoramiche, inclinazioni, Ken Burns, mano libera, zoom «alla Hitchcock» | `core/camera.js` |
| 095-097 | Curva di velocità (speed ramp): 7 curve pronte e editor grafico con punti trascinabili; il clip diventa una fila di pezzi a velocità costante, keyframe ricollocati | `core/speedramp.js`, `core/timeline.js` · fuzz |
| 080-081 | Curve di Bézier per i keyframe: 2 maniglie, 7 curve pronte (anche con rimbalzo/superamento) | `core/keyframes.js`, `ui/curve-editor.js` |
| 116-121 | Maschere con posizione, rotazione, sfumatura dei bordi e keyframe (dimensione, posizione, sfumatura) | `engine/renderer.js` |
| 159, 160 | Colore automatico: correzione automatica (livelli, bilanciamento del bianco, saturazione) e «uniforma ai colori di un altro clip»; si misura sui pixel | `core/autocolor.js`, `engine/frame-sampler.js` |
| 147, 269, 315, 428 | Look cartone/anime (cel shading), matita, poster, due colori, retino, vecchio schermo, onda, vortice, lenti, sfocatura a zoom: filtri sui pixel (non è un modello generativo) | `engine/pixel-fx.js` |
| 124, 140, 145 | Sovrapposizioni procedurali: neve, pioggia, coriandoli, scintille, bokeh, polvere, cuori, perdita di luce | `core/particles.js` |
| 193-195, 205 | **Sottotitoli automatici dal parlato**: rilevamento della voce, riconoscimento con Whisper (nel programma per computer in locale con onnxruntime; nel browser in WebAssembly), lingua a scelta (13), modello Veloce/Buona/Migliore, correzione del testo prima dell'inserimento, esportazione SRT | `core/vad.js`, `core/transcribe.js`, `engine/asr-engines.js`, `ui/captions-dialog.js`, `desktop/asr.cjs` |
| 197 | I tempi non si fidano di quelli del modello: si riallineano ogni parola con sillabe contate nell'audio e punti di minimo di energia | `core/wordtimes.js`, `core/align.js` · prove su voce vera (jfk.wav) e sintetica con tempi noti |
| 198-203 | Sottotitoli a lunghezza adatta (film, social 9:16, una riga, poche parole), a capo bilanciati, durate leggibili, nessuna sovrapposizione, karaoke parola per parola con i tempi veri | `core/captions.js` |
| 207 | Toglie le esitazioni («ehm», «uhm») dai sottotitoli | `core/captions.js` |
| 195 | «Ho già il testo»: il copione si mette a tempo con la voce senza riconoscimento (zero errori di trascrizione); «Solo i tempi»: righe vuote già a tempo da riempire | `core/align.js`, `core/transcribe.js` |
| 025, 216 | Effetti sonori: 27 suoni generati dal programma (whoosh, salita, impatto, clic, campanello, notifica, laser, pioggia, vento, applauso, battito…), con altezza, volume e varianti; anteprima e inserimento alla testina | `core/synth.js`, `ui/sounds-panel.js` · prove sul segnale (frequenze, durate, forma) |
| 024, 215, 245, 288, 405 | Musica generata da regole (non da un modello di IA): 7 stili, tempo, tonalità, scala e durata a scelta, «quanto il progetto»; il tempo è verificato con il nostro rilevatore di battiti | `core/synth.js` |
| 252 | Rilevamento delle scene: tagli netti (affinati al fotogramma) e dissolvenze; «Dividi per scene» | `core/scenes.js`, `engine/video-analysis.js` · prove su video veri con tagli noti |
| 250, 251 | «Momenti migliori»: i tratti più vivaci (movimento + volume), con marcatori o montaggio dei soli momenti scelti | `core/highlights.js`, `core/timeline.js` `keepOnly` |
| 087, 088, 131, 189 | Inseguimento di un punto (motion tracking): un testo, adesivo o immagine segue un oggetto del video, in avanti e indietro dalla testina; correlazione normalizzata, precisione sotto il pixel, tratti persi segnalati | `core/tracker.js`, `core/trackmap.js` · prova su una ripresa con camera mossa e percorso noto |
| 073, 255 | Inquadratura automatica (auto reframe): ingrandisce il video per riempire il formato (anche 16:9 → 9:16) e muove una camera virtuale che segue il soggetto in movimento (zona morta, velocità e accelerazione limitate) | `core/reframe.js` · prova con un quadrato in movimento |

## Già presenti prima (verificate nel codice)
Ribalta orizzontale e verticale (64-65), ritaglio con cursori (61), colore dello sfondo del canvas, estrai audio (218-219),
fotogramma fisso (50/103), velocità costante (92-94), transizioni, keyframe, maschere, chroma key, filtri, effetti, testo
con contorno/ombra/sfondo/allineamento/spaziatura (171-182), animazioni di ingresso e uscita del testo (185-186).

## Non fattibile (servizi esterni, account, licenze, app mobili)
Vedi il README, sezione «Catalogo CapCut».

## Limiti dichiarati dei sottotitoli automatici
- **Non provato su un vero Windows/macOS**: il motore Whisper è provato con il modello vero (Whisper tiny, voce umana vera) su Linux, in Node,
  nel browser (WebAssembly) e dentro il pacchetto Electron per Linux. Il pacchetto Windows contiene i file giusti (verificato nel contenuto),
  ma non l'ho potuto avviare su Windows. Serve «Microsoft Visual C++ Redistributable 2015-2022 (x64)» (gratuito, di solito già presente):
  non lo includo perché la licenza di Microsoft lo permette solo a chi ha Visual Studio.
- I modelli si scaricano da huggingface.co la prima volta (licenze Apache 2.0 e MIT): in questo ambiente il sito è bloccato, perciò
  «Buona» e «Migliore» non sono stati provati; la logica è la stessa del modello provato.
- Il riconoscimento non distingue i parlanti (voce 208) e non riconosce da solo la lingua: va scelta.
- I tempi delle parole sono ottimi sulle frasi chiare, meno sul parlato sovrapposto a musica forte.

## Limiti dichiarati delle analisi e dei suoni
- **Suoni e musica non sono stati ascoltati**: li ho verificati solo con misure sul segnale (altezza delle note, tempo, tonalità, durata, livello). La musica è semplice e a regole: non è paragonabile a un brano composto da una persona o da un modello di IA.
- **Inseguimento**: segue l'aspetto di un punto (non ingrandimenti né rotazioni dell'oggetto); se l'oggetto esce dal quadro o viene coperto lo segna «perso» e l'elemento resta fermo finché non lo ritrova.
- **Inquadratura automatica**: il soggetto è «ciò che si muove» (o, se tutto è fermo, ciò che spicca per colore); non riconosce volti o persone. Con più cose che si muovono segue la loro media.
- **Scene**: tagli netti e dissolvenze lente; non vede i cambi di scena dentro un'unica ripresa con animazioni, né le dissolvenze più brevi di circa mezzo secondo (le tratta come tagli).
