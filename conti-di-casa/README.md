# Conti di Casa

App per **Android** (e per il browser) per tenere i conti di famiglia: spese, entrate, budget, scadenze, obiettivi di risparmio, chi deve a chi.
Tutto in italiano, tutto **senza internet**: i dati restano sul telefono. Software libero, licenza MIT.

## Cosa fa

| Cosa | Dettagli |
| --- | --- |
| **Movimenti** | Spese, entrate e giroconti (soldi spostati fra conti). Importo con somma (`12,50+3`), categoria scelta da sola in base ai movimenti passati o alle tue regole, data, conto, chi l'ha speso, note ed etichette. Cerca e filtra. |
| **Conti** | Contanti, conto corrente, carte, risparmi, investimenti. Saldo di ognuno e patrimonio. «Correggi il saldo» aggiunge una rettifica che non falsa le statistiche. |
| **Famiglia** | Più persone. Si può **dividere una spesa** (parti uguali o importi diversi) e l'app dice **chi deve a chi**, con il minimo di pagamenti per pareggiare. |
| **Budget** | Limite mensile per categoria, barra di avanzamento, «quanto puoi spendere al giorno», avviso quando stai per superarlo (e quando lo superi). |
| **Scadenze** | Affitto, bollette, abbonamenti, stipendio: «Pagata» con un tocco, «Salta», oppure «registra da sola». Stima degli impegni fissi al mese. |
| **Obiettivi** | Il salvadanaio: vacanze, lavatrice, fondo emergenze. Quanto mettere da parte al mese per arrivarci in tempo. |
| **Statistiche** | Per categoria (ciambella), nel tempo (6 o 12 mesi), chi ha speso, da quale conto, spese più grandi, confronto col periodo prima, previsione a fine mese, patrimonio nel tempo. |
| **Mese su misura** | Se lo stipendio arriva il 27, i mesi possono andare dal 27 al 26. |
| **Dati** | Copia di sicurezza (file), ripristino, **unione con il telefono del coniuge** (senza doppioni), esportazione CSV per Excel, **importazione degli estratti conto** della banca (riconosce le colonne, salta i doppioni, indovina le categorie), riepilogo da mandare per messaggio. Una copia automatica al giorno come rete di sicurezza. |
| **Privacy** | PIN (salvato solo come impronta PBKDF2, mai in chiaro), sblocco con il blocco schermo del telefono (Android), importi nascondibili, schermate nascoste nelle app recenti quando c'è un blocco. |

## Installare l'app su Android

1. Copia `ContiDiCasa-1.0.0-Android.apk` sul telefono.
2. Aprilo dai file. Android chiede di consentire l'installazione «da questa fonte»: accetta.
3. Se Play Protect avvisa che l'app non è nota: è normale, la firma è quella di prova (vedi sotto). Scegli «Installa comunque».

Richiede Android 7.0 o più recente.

## Cosa NON fa (e cosa non è stato provato)

Siamo onesti, così non ti fai male:

- **Non è stata provata su un telefono vero.** Qui non c'è né un telefono né un emulatore. Provato: tutta la logica dei conti (34 prove, comprese 150 simulazioni a caso), l'interfaccia in un browser Chromium con schermo da telefono (27 prove) e il «ponte» con Android simulato (8 prove), la parte Java che non dipende da Android (39 prove), la struttura dell'APK (nessun permesso, firmato, allineato, contiene tutti i file). **Non provato**: l'apertura delle cartelle, lo sblocco con il blocco schermo e il selettore dei file *dentro Android*. Se qualcosa di questo non va, è lì che si guarda.
- **Nessun cloud, nessuna sincronizzazione automatica.** Per usarla in due telefoni: ognuno salva una copia, la manda all'altro, e la unisce (Altro → Dati e copie → Unisci). Si può ripetere quando si vuole.
- **Nessun collegamento alla banca.** L'app non ha il permesso INTERNET. I movimenti si inseriscono a mano o si importano da un file CSV scaricato dalla banca.
- **Nessuna notifica.** Le scadenze si vedono aprendo l'app (Home → «Da pagare»). Per le notifiche servirebbero permessi e un servizio in secondo piano.
- **Il blocco non è una cassaforte.** Il PIN tiene lontano chi prende il telefono sbloccato, ma i dati non sono cifrati nel telefono. Dopo 5 PIN sbagliati l'app fa aspettare, ma chi ha accesso ai file dell'app (telefono con root) potrebbe leggerli. Se dimentichi il PIN, per rientrare si cancellano tutti i dati e si ripristina una copia: **fai le copie di sicurezza.**
- **Lo sblocco con il telefono usa la schermata di Android** (PIN, sequenza o password del telefono; sull'impronta dipende dal modello). Non usa direttamente il sensore.
- **Nessun backup automatico di Google** (`allowBackup=false`): se cambi telefono, porta con te la copia di sicurezza.
- **Una valuta sola per famiglia**, niente conversioni.

## Costruire da soli

```bash
npm install                  # esbuild e playwright (solo per sviluppo e prove)
npm run build                # → dist/  (la versione per il browser)
npm start                    # la apre su http://localhost:5190/
npm test                     # prove della logica dei conti
npm run test:java            # prove della parte Java senza Android
npm run test:e2e             # prove nel browser con schermo da telefono (serve «npx playwright install chromium»)
npm run dist:apk             # → release/ContiDiCasa-1.0.0-Android.apk
```

Per l'APK servono (su Ubuntu/Debian): `sudo apt-get install -y aapt apksigner zipalign dalvik-exchange android-sdk-platform-23 default-jdk-headless`.
L'APK si costruisce **senza Gradle né Android Studio**: `aapt2` (risorse), `javac` + `dalvik-exchange` (programma), `zipalign` e `apksigner`.

### Firma di prova

L'APK è firmato con una chiave di prova (`android/debug.keystore`, password `android`, committata di proposito). Va bene per installare «da fonti sconosciute», **non per Google Play**. Gli aggiornamenti si installano sopra la versione vecchia solo se firmati con la stessa chiave: per distribuire l'app seriamente, crea una tua chiave e tienila al sicuro.

## Come è fatta

- `src/core/` — la logica, senza interfaccia: soldi in centesimi interi (mai decimali), date `AAAA-MM-GG`, saldi, budget, scadenze, divisioni, CSV, unione dei dati, PIN. Provata con `tests/unit/`.
- `src/ui/` — l'interfaccia, con un piccolo aiuto per costruire il DOM (`h()`), senza framework. Un solo stato, modificato con `commit()` (salva da solo e permette «Annulla»).
- `src/platform.js` — il ponte con Android (se c'è) o con il browser (download, condivisione).
- `android/` — il guscio Java: una WebView che serve i file dell'app da un indirizzo `https://appassets.androidplatform.net/` finto (le richieste non escono mai) e blocca qualunque altro indirizzo. Espone `ContiNativo` (salva file, condividi testo, sblocco, schermate nascoste).
- **I dati**: un solo oggetto JSON. Ogni elemento ha `id` e `u` (ultima modifica); cancellare lascia una «lapide» (`x: true`). Così l'unione fra due telefoni dà sempre lo stesso risultato, in qualunque ordine e anche ripetuta (verificato con prove a caso).
- **Sicurezza**: la pagina ha una politica CSP che vieta tutto tranne i propri file; le celle CSV che comincerebbero con `=`, `+`, `-`, `@` sono neutralizzate (niente formule nascoste aprendo il file in Excel); ogni file di copia viene ripulito (`sanitizeState`) prima di entrare.

## Licenza

MIT — vedi `LICENSE`. Nessuna libreria esterna entra nell'app: `esbuild` e `playwright` servono solo per costruirla e provarla.
