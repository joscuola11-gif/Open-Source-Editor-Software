# Squillo

Videochiamate **1 a 1** per computer e telefono: chiami una persona che ha Squillo digitando il suo **codice di 9 cifre**.
Puoi **mettere il muto**, **spegnere la camera** e **condividere lo schermo** con una qualità regolata per ciò che stai
mostrando. Niente account, niente abbonamento. Codice MIT.

## Come si usa

1. Apri Squillo: in alto vedi **«Il tuo codice»** (per esempio `482 915 037`). Dillo a chi vuoi che ti chiami.
2. Per chiamare, scrivi il codice dell'altra persona e premi **Videochiama** (o **Solo voce**).
3. Chi riceve vede il tuo nome e può **Rispondere**, rispondere **Solo voce** o **Rifiutare**.
4. Durante la chiamata, in basso:

| Pulsante | Cosa fa | Tasto |
| --- | --- | --- |
| Microfono | Muto / riattiva. L'altra persona vede l'icona e l'audio si interrompe davvero | `M` |
| Camera | Spegne **davvero** la camera (si spegne la spia) e la riaccende | `V` |
| Schermo | Condividi lo schermo, una finestra o (nel browser) una scheda | `S` |
| Gira | (telefono) camera frontale / posteriore | |
| Audio | Silenzia l'altra persona (solo per te) | |
| Info | Statistiche: velocità, risoluzione, fotogrammi, ritardo, perdite, percorso | `I` |
| Intero | Schermo intero | `F` |

Il tuo codice resta lo stesso fra un'apertura e l'altra. La cronologia, i nomi che dai alle persone e le impostazioni
restano **solo sul tuo dispositivo**.

## Condivisione dello schermo ottimizzata

Lo schermo viaggia su una **connessione dedicata**, separata da voce e camera: puoi accenderlo e spegnerlo senza interrompere
la chiamata e ha le sue impostazioni. Quando condividi scegli cosa stai mostrando:

| | **Testo e documenti** | **Video e movimento** |
| --- | --- | --- |
| Per | slide, codice, pagine web, fogli | filmati, giochi, animazioni |
| Priorità | **nitidezza** | **fluidità** |
| Se la rete cala | scende di fotogrammi, non di risoluzione | scende di risoluzione, non di fotogrammi |
| Da | 4 Mbit/s, 30 fps → fino a 250 kbit/s, 3 fps | 8 Mbit/s, 60 fps → fino a 450 kbit/s, 12 fps |

Cosa succede sotto il cofano:

- **Codec VP9** (il migliore per testo e interfacce), con ripiego su H.264 e VP8.
- Il browser riceve il suggerimento `contentHint` («detail» o «motion») e la `degradationPreference` corrispondente.
- **Regolazione automatica ogni secondo** dalle statistiche (banda disponibile, perdita di pacchetti, limite di CPU, ritardo):
  scende dopo due campioni cattivi di fila, risale solo con margine e dopo qualche secondo (per non ondeggiare).
- Cattura fino a **4K e 60 fps**, cursore sempre visibile, audio stereo del computer se richiesto (solo Windows e Chrome/Edge;
  usa le cuffie per non far sentire l'eco all'altra persona).
- Nel programma desktop c'è un **selettore con anteprima** di schermi e finestre; la finestra di Squillo stessa non è
  in elenco (condividerla creerebbe un tunnel infinito).
- Anche chi riceve può condividere il proprio schermo; con la miniatura si scambia fra schermo e camera.

## Installazione

### Computer (Windows, macOS, Linux)

Scarica dalla pagina **Releases** del repository:

- **Windows**: `Squillo-Installer-*-x64.exe` (menu Start e disinstallatore) oppure `Squillo-*-Windows-x64.zip` (portatile:
  estrai tutto in una cartella e avvia `Squillo.exe`). Windows può mostrare «Windows ha protetto il PC» perché il programma
  non è firmato con un certificato a pagamento: **Ulteriori informazioni → Esegui comunque**.
- **macOS**: zip non firmato (clic destro → Apri). **Linux**: AppImage.

Costruirli da soli: `npm ci && npm run dist:win` (o `dist:mac`, `dist:linux`).

### Android: l'APK

`Squillo-*-Android.apk` (nella pagina **Releases**, oppure `npm run dist:apk` per costruirlo da soli: serve Linux con
`aapt apksigner zipalign dalvik-exchange android-sdk-platform-23 default-jdk-headless`, niente Android Studio).

1. Scarica il file sul telefono e aprilo. Android chiede di consentire l'installazione **da questa fonte**: consenti.
2. Se compare l'avviso di Play Protect («app non verificata»): **Installa comunque**. È normale: l'app non è su Google Play
   e la firma è di prova (`android/debug.keystore`, password `android`). Gli aggiornamenti si installano sopra solo se firmati
   con la stessa chiave.
3. Alla prima chiamata Android chiede il permesso per **camera e microfono**: consenti.

L'APK contiene la stessa app web (nessun sito da aprire, funziona dall'icona) dentro una finestra Android (WebView). Richiede
Android 7 o successivo. **Non è stato provato su un telefono vero**: l'ho costruito e controllato (struttura, permessi,
firma, allineamento) ma qui non c'è un telefono o un emulatore. Da Android **non si può condividere lo schermo** (la WebView non lo
permette): si può invece vedere lo schermo condiviso da un computer.

### Telefono (Android e iPhone) come web-app

Su telefono Squillo è una **web-app installabile**: la stessa app, aperta da un indirizzo web, con la sua icona nella Home.
Camera e microfono richiedono **HTTPS**, quindi la cartella `dist/` va pubblicata su un indirizzo `https://`. Il modo più
semplice e gratuito è **GitHub Pages**:

1. `npm run build` crea la cartella `dist/` (è l'app completa).
2. Pubblicala su GitHub Pages (nel repository: *Settings → Pages → Source: GitHub Actions*, poi avvia il flusso
   «Squillo» con l'opzione *deploy_web*) oppure su qualunque hosting statico con HTTPS.
3. Sul telefono apri l'indirizzo e scegli **Aggiungi a schermata Home** (iPhone: Safari → Condividi) o **Installa app** (Android).

## Il centralino (come si trovano le persone)

Per far squillare l'altra persona serve un «centralino» che mette in contatto i due programmi. Di default Squillo usa il servizio
pubblico gratuito di **PeerJS** (nessun account). **Audio e video non passano di lì**: viaggiano direttamente fra le due persone,
cifrati; se la rete lo impedisce passano da un server di appoggio (TURN) che vede solo dati cifrati.

Il servizio pubblico non ha garanzie di disponibilità. Per averne uno tuo basta questo (serve Node 18+):

```bash
cd squillo && npm ci && npm run centralino      # porta 9000; PORT=8080 per cambiarla
```

Poi in Squillo → **Impostazioni → Centralino** inserisci indirizzo e porta (con HTTPS se è su Internet: per esempio su Render,
Fly.io o un tuo server). In *Avanzate* puoi indicare i tuoi server TURN, utili con reti aziendali molto chiuse.

## Limiti — da sapere prima

- **Solo 1 a 1**, niente chiamate di gruppo, niente chat.
- **L'altra persona deve avere Squillo aperto** per ricevere la chiamata (non esistono notifiche a app chiusa: richiederebbero
  un servizio di notifiche push).
- **Dal telefono non si può condividere lo schermo**: i browser dei telefoni (Chrome per Android, Safari per iPhone) non lo
  permettono. Il telefono può però **vedere** lo schermo condiviso da un computer. Per condividere dal telefono servirebbe un'app
  nativa con servizio di cattura (non c'è; per iPhone non si può costruire né provare senza un Mac e un account Apple a pagamento).
- Il servizio pubblico gratuito e i suoi server di appoggio sono «al meglio delle possibilità».
- Provato con **Chromium ed Electron su Linux** con camera/microfono finti. **Non provato**: Windows e macOS veri, iPhone e
  Android veri, Safari, Firefox, reti reali con perdite di pacchetti (il regolatore è però provato con dati simulati).

## Per chi sviluppa

```bash
cd squillo
npm ci
npm run build          # dist/ (app completa) — serve per desktop e per il web
npm run serve          # http://localhost:5180
npm test               # unitari: codici, profili e regolatore, SDP, statistiche
npm run test:e2e       # due partecipanti in Chromium + centralino vero (serve Chromium di Playwright)
npm run test:desktop   # Electron vero in schermo virtuale (Linux: serve xvfb)
```

Struttura: `src/net` (codici e collegamento al centralino) · `src/call` (la chiamata: `session.js`, qualità `profiles.js`,
accordi `sdp.js`, statistiche `stats.js`, camera/microfono/schermo `media.js`) · `src/ui` (interfaccia) · `server/centralino.js` ·
`desktop/` (guscio Electron sicuro: sandbox, nessun accesso a Node dalla pagina, selettore dello schermo).

Come è fatta una chiamata: un **canale di controllo** (squillo, risposta, muto, riaggancio), una connessione per **voce e camera**
e, solo mentre condividi, una per lo **schermo**. La camera spenta è sostituita da un fotogramma «camera spenta» così si riaccende
senza rinegoziare la connessione.
