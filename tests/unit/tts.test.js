// Voce da testo: provata con il sintetizzatore vero del sistema (espeak-ng su Linux). Si salta se non c'è.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { decodeWav } from '../../src/core/wav.js';

const tts = createRequire(import.meta.url)('../../desktop/tts.cjs');
const have = process.platform === 'linux' ? spawnSync('which', ['espeak-ng']).status === 0 || spawnSync('which', ['espeak']).status === 0 : process.platform !== 'win32' || true;
const skip = have ? false : 'nessun sintetizzatore vocale installato';

test('voce da testo: elenco delle voci, un WAV valido e durata proporzionale al testo', { skip }, async () => {
  const voices = await tts.listVoices();
  assert.ok(voices.length > 0 && voices.every((v) => v.id && v.name && typeof v.lang === 'string'));
  const it = voices.find((v) => /^it/i.test(v.lang));
  const short = decodeWav(new Uint8Array(await tts.synthesize('Ciao.', { voice: it?.id })));
  const long = decodeWav(new Uint8Array(await tts.synthesize('Questa è una frase molto più lunga della precedente, con diverse parole.', { voice: it?.id })));
  const dur = (w) => w.channels[0].length / w.sampleRate;
  assert.ok(dur(short) > 0.2 && dur(short) < 3, `breve ${dur(short)}`);
  assert.ok(dur(long) > dur(short) * 3, `lunga ${dur(long)} contro ${dur(short)}`);
  assert.ok(Math.max(...long.channels[0].slice(0, 20000).map(Math.abs)) > 0.05, 'non è silenzio');
  // più veloce = più corto
  const fast = decodeWav(new Uint8Array(await tts.synthesize('Questa è una frase molto più lunga della precedente, con diverse parole.', { voice: it?.id, rate: 2 })));
  assert.ok(dur(fast) < dur(long) * 0.75, `velocità doppia: ${dur(fast)} contro ${dur(long)}`);
});

test('voce da testo: testo vuoto, troppo lungo o voce non valida sono rifiutati con messaggi chiari (e niente comandi eseguiti)', { skip }, async () => {
  await assert.rejects(() => tts.synthesize('   '), /Scrivi il testo/);
  await assert.rejects(() => tts.synthesize('a'.repeat(tts.MAX_CHARS + 1)), /troppo lungo/);
  await assert.rejects(() => tts.synthesize('ciao', { voice: '; touch /tmp/ciak-pwned #' }), /non disponibile/);
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync('/tmp/ciak-pwned'), false);
  // caratteri speciali nel testo non rompono nulla (arrivano da stdin)
  const w = decodeWav(new Uint8Array(await tts.synthesize('Prezzo: 5€ "citato" $(whoami) `ls` ; echo')));
  assert.ok(w.channels[0].length > 1000);
});
