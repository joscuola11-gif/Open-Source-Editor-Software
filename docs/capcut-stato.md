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

## Già presenti prima (verificate nel codice)
Ribalta orizzontale e verticale (64-65), ritaglio con cursori (61), colore dello sfondo del canvas, estrai audio (218-219),
fotogramma fisso (50/103), velocità costante (92-94), transizioni, keyframe, maschere, chroma key, filtri, effetti, testo, sottotitoli SRT.

## Non fattibile (servizi esterni, account, licenze, app mobili)
Vedi il README, sezione «Catalogo CapCut».
