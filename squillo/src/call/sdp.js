// Ritocchi all'SDP (l'accordo fra i due programmi su come scambiarsi audio e video).
// Funzioni pure: lavorano su testo, così si provano senza browser.

const EOL = /\r?\n/;

function sections(sdp) {
  const lines = sdp.split(EOL);
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (line.startsWith('m=')) {
      cur = { header: line, lines: [] };
      out.push(cur);
    } else if (cur) cur.lines.push(line);
    else out.push({ header: null, lines: [line] });
  }
  return out;
}
const join = (secs) => secs.flatMap((s) => (s.header === null ? s.lines : [s.header, ...s.lines])).join('\r\n');

/** Mette per primi i codec preferiti nella sezione `kind` (video/audio), con i loro RTX. Gli altri restano dopo. */
export function preferCodecs(sdp, kind, order) {
  if (typeof sdp !== 'string' || !sdp) return sdp;
  const secs = sections(sdp);
  for (const s of secs) {
    if (!s.header?.startsWith(`m=${kind} `)) continue;
    const parts = s.header.split(' ');
    const pts = parts.slice(3);
    const name = new Map();
    const rtxOf = new Map();
    for (const l of s.lines) {
      const m = l.match(/^a=rtpmap:(\d+) ([^/\s]+)/);
      if (m) name.set(m[1], m[2].toUpperCase());
      const f = l.match(/^a=fmtp:(\d+) .*apt=(\d+)/);
      if (f) rtxOf.set(f[2], f[1]);
    }
    const used = new Set();
    const result = [];
    const take = (pt) => {
      if (used.has(pt) || !pts.includes(pt)) return;
      used.add(pt);
      result.push(pt);
      const rtx = rtxOf.get(pt);
      if (rtx && !used.has(rtx) && pts.includes(rtx)) {
        used.add(rtx);
        result.push(rtx);
      }
    };
    for (const codec of order) for (const pt of pts) if (name.get(pt) === codec.toUpperCase()) take(pt);
    for (const pt of pts) take(pt);
    s.header = [...parts.slice(0, 3), ...result].join(' ');
  }
  return join(secs);
}

/** Opus: correzione errori in banda, e per l'audio dello schermo stereo ad alto bitrate. */
export function tuneOpus(sdp, { stereo = false, maxBitrate = 40_000, dtx = false } = {}) {
  if (typeof sdp !== 'string' || !sdp) return sdp;
  const secs = sections(sdp);
  for (const s of secs) {
    if (!s.header?.startsWith('m=audio ')) continue;
    const opus = s.lines.map((l) => l.match(/^a=rtpmap:(\d+) opus\/48000/i)).find(Boolean)?.[1];
    if (!opus) continue;
    s.lines = s.lines.map((l) => {
      if (!l.startsWith(`a=fmtp:${opus} `)) return l;
      const params = new Map(l.slice(`a=fmtp:${opus} `.length).split(';').map((p) => p.trim()).filter(Boolean).map((p) => p.split('=')));
      params.set('useinbandfec', '1');
      params.set('maxaveragebitrate', String(maxBitrate));
      params.set('usedtx', dtx ? '1' : '0');
      if (stereo) {
        params.set('stereo', '1');
        params.set('sprop-stereo', '1');
      }
      return `a=fmtp:${opus} ${[...params].map(([k, v]) => (v === undefined ? k : `${k}=${v}`)).join(';')}`;
    });
  }
  return join(secs);
}

/** Bitrate di partenza più alto per il video (senza, il browser parte da ~300 kbit/s e ci mette secondi a nitidire). */
export function startBitrate(sdp, kbps) {
  if (typeof sdp !== 'string' || !sdp) return sdp;
  const secs = sections(sdp);
  for (const s of secs) {
    if (!s.header?.startsWith('m=video ')) continue;
    s.lines = s.lines.map((l) => {
      const m = l.match(/^a=fmtp:(\d+) (.*)$/);
      if (!m || /apt=/.test(m[2]) || /x-google-start-bitrate/.test(m[2])) return l;
      return `a=fmtp:${m[1]} ${m[2]};x-google-start-bitrate=${kbps}`;
    });
  }
  return join(secs);
}
