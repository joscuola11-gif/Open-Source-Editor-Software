// Profili di qualità della condivisione dello schermo e regolatore automatico.
//
// Due modi, perché testo e movimento vogliono cose opposte:
//  - «detail» (documenti, codice, slide): nitidezza sopra a tutto, pochi fotogrammi al secondo vanno bene.
//    Se la rete peggiora si scende di fotogrammi, non di risoluzione.
//  - «motion» (video, giochi, animazioni): fluidità sopra a tutto; se serve si abbassa la risoluzione.
//
// Ogni scala va dal livello 0 (migliore) al peggiore. Il regolatore è una funzione pura: riceve lo
// stato e un campione delle statistiche e restituisce il nuovo stato, così si prova senza rete.

export const SCREEN_LADDER = {
  detail: [
    { bitrate: 4_000_000, fps: 30, scale: 1 },
    { bitrate: 2_500_000, fps: 20, scale: 1 },
    { bitrate: 1_500_000, fps: 15, scale: 1 },
    { bitrate: 900_000, fps: 10, scale: 1.34 },
    { bitrate: 500_000, fps: 6, scale: 1.5 },
    { bitrate: 250_000, fps: 3, scale: 2 },
  ],
  motion: [
    { bitrate: 8_000_000, fps: 60, scale: 1 },
    { bitrate: 5_000_000, fps: 30, scale: 1 },
    { bitrate: 3_000_000, fps: 30, scale: 1.34 },
    { bitrate: 1_800_000, fps: 24, scale: 1.5 },
    { bitrate: 900_000, fps: 15, scale: 2 },
    { bitrate: 450_000, fps: 12, scale: 2.67 },
  ],
};

export const CAMERA_LADDER = {
  auto: [
    { bitrate: 1_800_000, fps: 30, scale: 1 },
    { bitrate: 1_000_000, fps: 30, scale: 1.34 },
    { bitrate: 600_000, fps: 24, scale: 1.5 },
    { bitrate: 300_000, fps: 15, scale: 2 },
    { bitrate: 150_000, fps: 12, scale: 2.67 },
  ],
  saver: [
    { bitrate: 700_000, fps: 24, scale: 1 },
    { bitrate: 400_000, fps: 20, scale: 1.34 },
    { bitrate: 200_000, fps: 15, scale: 1.5 },
    { bitrate: 100_000, fps: 10, scale: 2 },
  ],
};

export const AUDIO_BITRATE = { voice: 40_000, screen: 128_000 };

/** Suggerimenti per il codificatore: come comportarsi quando la rete non basta. */
export const DEGRADATION = { detail: 'maintain-resolution', motion: 'maintain-framerate', camera: 'balanced' };
export const CONTENT_HINT = { detail: 'detail', motion: 'motion' };

export const initialState = (level = 0) => ({ level, up: 0, down: 0 });

/**
 * @param state  { level, up, down }
 * @param sample { limitation: 'none'|'cpu'|'bandwidth'|'other', available: bit/s|null, loss: 0..1, rtt: s|null }
 * @param ladder scala di livelli
 * @param opts   { downAfter: campioni «cattivi» di fila prima di scendere, upAfter: campioni buoni prima di salire }
 */
export function nextState(state, sample, ladder, { downAfter = 2, upAfter = 6 } = {}) {
  const max = ladder.length - 1;
  const cur = ladder[state.level];
  const limited = sample.limitation === 'cpu' || sample.limitation === 'bandwidth';
  const starved = Number.isFinite(sample.available) && sample.available < cur.bitrate * 0.75;
  const lossy = (sample.loss ?? 0) > 0.08;
  if (limited || starved || lossy) {
    const down = state.down + 1;
    if (down >= downAfter && state.level < max) return { level: state.level + 1, up: 0, down: 0 };
    return { level: state.level, up: 0, down };
  }
  // buono: si risale solo se la rete ha margine per il livello migliore
  const better = ladder[state.level - 1];
  const headroom = better && (!Number.isFinite(sample.available) || sample.available > better.bitrate * 1.25) && (sample.rtt ?? 0) < 0.4;
  if (!headroom) return { level: state.level, up: 0, down: 0 };
  const up = state.up + 1;
  if (up >= upAfter) return { level: state.level - 1, up: 0, down: 0 };
  return { level: state.level, up, down: 0 };
}
