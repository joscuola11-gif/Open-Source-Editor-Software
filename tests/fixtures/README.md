# Fixture di prova

- `jfk.wav` — 11 s di parlato reale (16 kHz, mono): estratto del discorso di insediamento di J. F. Kennedy (1961),
  opera del governo degli Stati Uniti, di pubblico dominio. È lo stesso campione usato dai progetti Whisper e whisper.cpp.
  Serve a provare il riconoscimento vocale e i tempi dei sottotitoli con voce umana vera.
- `jfk.words.json` — le parole con i tempi restituite dal modello Whisper «tiny» su `jfk.wav`: permette di provare la
  costruzione dei sottotitoli e la correzione dei tempi senza avere il modello a disposizione.
