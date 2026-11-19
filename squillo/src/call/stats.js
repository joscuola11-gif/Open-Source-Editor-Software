// Legge le statistiche WebRTC (getStats) e le riduce a pochi numeri comprensibili.
// `report` è una lista di oggetti-statistica (Array.from(await pc.getStats()).map(([, v]) => v)).

/**
 * @param report lista di statistiche
 * @param prev   riepilogo precedente (serve per trasformare i byte in bit al secondo)
 */
export function summarize(report, prev = null) {
  const by = (type) => report.filter((r) => r.type === type);
  const out = by('outbound-rtp').filter((r) => r.kind === 'video' && !r.isRemote);
  const inn = by('inbound-rtp').filter((r) => r.kind === 'video');
  const outAudio = by('outbound-rtp').filter((r) => r.kind === 'audio');
  const inAudio = by('inbound-rtp').filter((r) => r.kind === 'audio');
  const pair = by('candidate-pair').find((p) => p.nominated && p.state === 'succeeded') ?? by('candidate-pair').find((p) => p.state === 'succeeded');
  const remoteIn = by('remote-inbound-rtp').filter((r) => r.kind === 'video');

  const now = report.reduce((t, r) => Math.max(t, r.timestamp ?? 0), 0);
  const sum = (arr, k) => arr.reduce((a, r) => a + (r[k] ?? 0), 0);
  const bytesOut = sum(out, 'bytesSent') + sum(outAudio, 'bytesSent');
  const bytesIn = sum(inn, 'bytesReceived') + sum(inAudio, 'bytesReceived');
  const dt = prev && now > prev.timestamp ? (now - prev.timestamp) / 1000 : null;
  const rate = (cur, before) => (dt && before !== undefined && cur >= before ? ((cur - before) * 8) / dt : null);

  const top = (arr) => arr.slice().sort((a, b) => (b.frameWidth ?? 0) - (a.frameWidth ?? 0))[0];
  const o = top(out);
  const i = top(inn);
  const limitation = out.some((r) => r.qualityLimitationReason === 'cpu') ? 'cpu' : out.some((r) => r.qualityLimitationReason === 'bandwidth') ? 'bandwidth' : out.some((r) => r.qualityLimitationReason === 'other') ? 'other' : 'none';
  const lossFraction = remoteIn.length ? Math.max(...remoteIn.map((r) => r.fractionLost ?? 0)) : null;
  const packetsLost = sum(inn, 'packetsLost');
  const packetsRecv = sum(inn, 'packetsReceived');

  return {
    timestamp: now,
    bytesOut,
    bytesIn,
    outBitrate: rate(bytesOut, prev?.bytesOut),
    inBitrate: rate(bytesIn, prev?.bytesIn),
    outFps: o?.framesPerSecond ?? null,
    outSize: o?.frameWidth ? { w: o.frameWidth, h: o.frameHeight } : null,
    inFps: i?.framesPerSecond ?? null,
    inSize: i?.frameWidth ? { w: i.frameWidth, h: i.frameHeight } : null,
    framesDecoded: sum(inn, 'framesDecoded'),
    framesSent: sum(out, 'framesSent'),
    audioEnergyIn: sum(inAudio, 'totalAudioEnergy'),
    audioEnergyOut: sum(by('media-source').filter((r) => r.kind === 'audio'), 'totalAudioEnergy'),
    audioLevelIn: inAudio.length ? Math.max(...inAudio.map((r) => r.audioLevel ?? 0)) : null,
    rtt: pair?.currentRoundTripTime ?? (remoteIn[0]?.roundTripTime ?? null),
    available: Number.isFinite(pair?.availableOutgoingBitrate) ? pair.availableOutgoingBitrate : null,
    loss: lossFraction ?? (packetsRecv + packetsLost > 0 ? packetsLost / (packetsRecv + packetsLost) : 0),
    limitation,
    codecOut: codecName(report, o),
    codecIn: codecName(report, i),
    relay: pair ? by('local-candidate').find((c) => c.id === pair.localCandidateId)?.candidateType === 'relay' : null,
  };
}

function codecName(report, rtp) {
  if (!rtp?.codecId) return null;
  const c = report.find((r) => r.id === rtp.codecId);
  return c?.mimeType?.split('/')[1] ?? null;
}

/** Qualità percepita in tre parole, per la spia in alto durante la chiamata. */
export function quality(sample) {
  if (!sample) return 'good';
  const rtt = sample.rtt ?? 0;
  const loss = sample.loss ?? 0;
  if (rtt > 0.6 || loss > 0.15) return 'bad';
  if (rtt > 0.25 || loss > 0.05 || sample.limitation === 'bandwidth') return 'fair';
  return 'good';
}
