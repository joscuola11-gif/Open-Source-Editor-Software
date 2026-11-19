import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCode, formatCode, parseCode, peerIdOf, codeOf } from '../../src/net/ids.js';
import { SCREEN_LADDER, CAMERA_LADDER, initialState, nextState } from '../../src/call/profiles.js';
import { preferCodecs, tuneOpus, startBitrate } from '../../src/call/sdp.js';
import { summarize, quality } from '../../src/call/stats.js';
import { formatClock, formatBitrate } from '../../src/lib/util.js';

test('codici: 9 cifre, mai con 0 iniziale, formattati a gruppi di tre', () => {
  for (let i = 0; i < 200; i++) assert.match(newCode(), /^[1-9]\d{8}$/);
  assert.equal(formatCode('123456789'), '123 456 789');
  assert.equal(formatCode('1234'), '123 4');
  assert.equal(formatCode('12345678999999'), '123 456 789', 'oltre 9 cifre si tronca');
  assert.equal(formatCode(null), '');
});

test('codici: si accettano spazi, trattini e testo incollato; il resto è rifiutato', () => {
  assert.equal(parseCode('123 456 789'), '123456789');
  assert.equal(parseCode('123-456-789'), '123456789');
  assert.equal(parseCode('  123.456.789  '), '123456789');
  assert.equal(parseCode('squillo-123456789'), '123456789');
  assert.equal(parseCode('12345678'), null);
  assert.equal(parseCode('1234567890'), null);
  assert.equal(parseCode('023456789'), null, 'non può iniziare con 0');
  assert.equal(parseCode(''), null);
  assert.equal(parseCode(undefined), null);
  assert.equal(codeOf(peerIdOf('123456789')), '123456789');
  assert.equal(codeOf('altra-app-1'), null);
});

test('il generatore dei codici usa tutta la sua casualità (nessuna cifra fissa)', () => {
  const seen = Array.from({ length: 9 }, () => new Set());
  for (let i = 0; i < 400; i++) [...newCode()].forEach((d, k) => seen[k].add(d));
  assert.ok(seen.slice(1).every((s) => s.size >= 9), 'le cifre dalla seconda in poi variano su tutto 0-9');
  assert.ok(seen[0].size >= 8 && !seen[0].has('0'));
});

test('le scale di qualità sono ordinate dal migliore al peggiore', () => {
  for (const ladder of [...Object.values(SCREEN_LADDER), ...Object.values(CAMERA_LADDER)]) {
    for (let i = 1; i < ladder.length; i++) {
      assert.ok(ladder[i].bitrate < ladder[i - 1].bitrate, 'bitrate in calo');
      assert.ok(ladder[i].fps <= ladder[i - 1].fps, 'fps non in aumento');
      assert.ok(ladder[i].scale >= ladder[i - 1].scale, 'riduzione non in calo');
    }
  }
  assert.ok(SCREEN_LADDER.detail.every((l) => l.scale <= 2), 'il testo non si rimpicciolisce oltre il dimezzamento');
  assert.ok(SCREEN_LADDER.detail[0].fps < SCREEN_LADDER.motion[0].fps);
});

test('regolatore: scende dopo due campioni cattivi, risale solo con margine e dopo un po\'', () => {
  const L = SCREEN_LADDER.detail;
  let s = initialState(0);
  const good = { limitation: 'none', available: 9_000_000, loss: 0, rtt: 0.05 };
  const bw = { limitation: 'bandwidth', available: 1_000_000, loss: 0, rtt: 0.1 };
  s = nextState(s, bw, L);
  assert.equal(s.level, 0, 'un solo campione cattivo non basta');
  s = nextState(s, bw, L);
  assert.equal(s.level, 1);
  // un campione buono in mezzo azzera il conteggio dei cattivi
  s = nextState(s, bw, L);
  s = nextState(s, good, L);
  s = nextState(s, bw, L);
  assert.equal(s.level, 1, 'i cattivi non consecutivi non fanno scendere');
  // risale dopo 6 campioni buoni con margine
  for (let i = 0; i < 5; i++) s = nextState(s, good, L);
  assert.equal(s.level, 1);
  s = nextState(s, good, L);
  assert.equal(s.level, 0, 'risale');
  assert.equal(nextState(s, good, L).level, 0, 'non va sotto lo zero');
});

test('regolatore: non risale se la rete non ha margine, non scende oltre il fondo, CPU e perdite contano', () => {
  const L = CAMERA_LADDER.auto;
  let s = initialState(2);
  const tight = { limitation: 'none', available: L[1].bitrate * 1.1, loss: 0, rtt: 0.05 };
  for (let i = 0; i < 30; i++) s = nextState(s, tight, L);
  assert.equal(s.level, 2, 'senza margine resta dov\'è');
  s = initialState(0);
  const cpu = { limitation: 'cpu', available: 9e6, loss: 0, rtt: 0.05 };
  for (let i = 0; i < 40; i++) s = nextState(s, cpu, L);
  assert.equal(s.level, L.length - 1, 'si ferma all\'ultimo livello');
  s = initialState(0);
  const lossy = { limitation: 'none', available: 9e6, loss: 0.2, rtt: 0.1 };
  s = nextState(nextState(s, lossy, L), lossy, L);
  assert.equal(s.level, 1, 'le perdite abbassano la qualità');
  // statistiche mancanti (alcuni browser non danno la banda disponibile) non bloccano il risalire
  s = initialState(1);
  const unknown = { limitation: 'none', available: null, loss: 0, rtt: null };
  for (let i = 0; i < 6; i++) s = nextState(s, unknown, L);
  assert.equal(s.level, 0);
});

const SDP = [
  'v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
  'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=0', 'a=rtpmap:63 red/48000/2',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 100 101',
  'a=rtpmap:96 VP8/90000', 'a=rtpmap:97 rtx/90000', 'a=fmtp:97 apt=96',
  'a=rtpmap:98 VP9/90000', 'a=fmtp:98 profile-id=0', 'a=rtpmap:99 rtx/90000', 'a=fmtp:99 apt=98',
  'a=rtpmap:100 H264/90000', 'a=fmtp:100 profile-level-id=42e01f', 'a=rtpmap:101 rtx/90000', 'a=fmtp:101 apt=100', '',
].join('\r\n');

test('SDP: i codec preferiti passano davanti con i loro RTX, gli altri restano', () => {
  const out = preferCodecs(SDP, 'video', ['VP9', 'H264']);
  const mline = out.split('\r\n').find((l) => l.startsWith('m=video'));
  assert.equal(mline, 'm=video 9 UDP/TLS/RTP/SAVPF 98 99 100 101 96 97');
  assert.ok(out.includes('m=audio 9 UDP/TLS/RTP/SAVPF 111 63'), 'l\'audio non cambia');
  assert.equal(out.split('\r\n').length, SDP.split('\r\n').length, 'nessuna riga persa');
  assert.equal(preferCodecs(SDP, 'video', ['AV1']), SDP, 'un codec assente non cambia nulla');
  assert.equal(preferCodecs('', 'video', ['VP9']), '');
  assert.equal(preferCodecs(undefined, 'video', ['VP9']), undefined);
});

test('SDP: Opus con correzione errori e, se serve, stereo ad alto bitrate', () => {
  const voice = tuneOpus(SDP, { maxBitrate: 40000 });
  assert.match(voice, /a=fmtp:111 [^\r\n]*useinbandfec=1/);
  assert.match(voice, /maxaveragebitrate=40000/);
  assert.doesNotMatch(voice, /stereo=1/);
  assert.match(voice, /minptime=10/, 'i parametri esistenti restano');
  const screen = tuneOpus(SDP, { stereo: true, maxBitrate: 128000 });
  assert.match(screen, /stereo=1/);
  assert.match(screen, /sprop-stereo=1/);
  assert.match(screen, /maxaveragebitrate=128000/);
});

test('SDP: bitrate di partenza solo sui codec video veri, non sugli RTX', () => {
  const out = startBitrate(SDP, 2500);
  assert.match(out, /a=fmtp:98 profile-id=0;x-google-start-bitrate=2500/);
  assert.match(out, /a=fmtp:100 profile-level-id=42e01f;x-google-start-bitrate=2500/);
  assert.doesNotMatch(out, /a=fmtp:97 [^\r\n]*start-bitrate/);
  assert.equal(startBitrate(out, 2500), out, 'è idempotente');
});

test('statistiche: bit al secondo dai byte, limite, risoluzione, tipo di percorso', () => {
  const mk = (t, bytesV, bytesA) => [
    { type: 'outbound-rtp', kind: 'video', id: 'ov', timestamp: t, bytesSent: bytesV, framesPerSecond: 29, frameWidth: 1920, frameHeight: 1080, qualityLimitationReason: 'bandwidth', codecId: 'c1', framesSent: 100 },
    { type: 'outbound-rtp', kind: 'audio', id: 'oa', timestamp: t, bytesSent: bytesA },
    { type: 'inbound-rtp', kind: 'video', id: 'iv', timestamp: t, bytesReceived: bytesV * 2, framesPerSecond: 30, frameWidth: 1280, frameHeight: 720, packetsLost: 5, packetsReceived: 95, framesDecoded: 60, codecId: 'c2' },
    { type: 'codec', id: 'c1', mimeType: 'video/VP9' },
    { type: 'codec', id: 'c2', mimeType: 'video/H264' },
    { type: 'remote-inbound-rtp', kind: 'video', id: 'r', timestamp: t, fractionLost: 0.02, roundTripTime: 0.08 },
    { type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.05, availableOutgoingBitrate: 3_000_000, localCandidateId: 'l1' },
    { type: 'local-candidate', id: 'l1', candidateType: 'relay' },
    { type: 'media-source', kind: 'audio', totalAudioEnergy: 0.5 },
  ];
  const a = summarize(mk(1000, 0, 0));
  assert.equal(a.outBitrate, null, 'senza campione precedente non c\'è velocità');
  const b = summarize(mk(2000, 500_000, 12_500), a);
  assert.equal(Math.round(b.outBitrate), 4_100_000, '(500000+12500) byte in 1 s = 4,1 Mbit/s');
  assert.deepEqual(b.outSize, { w: 1920, h: 1080 });
  assert.deepEqual(b.inSize, { w: 1280, h: 720 });
  assert.equal(b.limitation, 'bandwidth');
  assert.equal(b.available, 3_000_000);
  assert.equal(b.rtt, 0.05);
  assert.equal(b.loss, 0.02);
  assert.equal(b.codecOut, 'VP9');
  assert.equal(b.codecIn, 'H264');
  assert.equal(b.relay, true);
  assert.equal(b.audioEnergyOut, 0.5);
  assert.equal(summarize([]).limitation, 'none', 'rapporto vuoto non rompe');
  assert.equal(quality(b), 'fair');
  assert.equal(quality({ rtt: 0.9, loss: 0 }), 'bad');
  assert.equal(quality({ rtt: 0.05, loss: 0, limitation: 'none' }), 'good');
  assert.equal(quality(null), 'good');
});

test('formati: orologio e velocità', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(7.9), '0:07');
  assert.equal(formatClock(723), '12:03');
  assert.equal(formatClock(3723), '1:02:03');
  assert.equal(formatClock(-4), '0:00');
  assert.equal(formatBitrate(4_100_000), '4,1 Mbit/s');
  assert.equal(formatBitrate(250_400), '250 kbit/s');
  assert.equal(formatBitrate(NaN), '–');
});
