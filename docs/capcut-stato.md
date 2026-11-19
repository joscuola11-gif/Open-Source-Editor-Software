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

## Già presenti prima (verificate nel codice)
Ribalta orizzontale e verticale (64-65), ritaglio con cursori (61), colore dello sfondo del canvas, estrai audio (218-219),
fotogramma fisso (50/103), velocità costante (92-94), transizioni, keyframe, maschere, chroma key, filtri, effetti, testo
con contorno/ombra/sfondo/allineamento/spaziatura (171-182), animazioni di ingresso e uscita del testo (185-186).

## Non fattibile (servizi esterni, account, licenze, app mobili)
Vedi il README, sezione «Catalogo CapCut».
