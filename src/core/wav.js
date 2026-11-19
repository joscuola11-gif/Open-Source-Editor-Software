// Scrittura e lettura di file WAV (PCM a 16 bit). Puro.

export function encodeWav(channels, sampleRate) {
  const nch = channels.length;
  const len = channels[0].length;
  const buf = new ArrayBuffer(44 + len * nch * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + len * nch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nch * 2, true);
  v.setUint16(32, nch * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, len * nch * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}

export function decodeWav(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (bytes.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Non è un file WAV');
  let o = 12;
  let fmt = null;
  while (o + 8 <= bytes.byteLength) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { format: v.getUint16(o + 8, true), channels: v.getUint16(o + 10, true), sampleRate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16) throw new Error('Solo WAV PCM a 16 bit');
      const n = Math.floor(Math.min(size, bytes.byteLength - o - 8) / (fmt.channels * 2));
      const channels = Array.from({ length: fmt.channels }, () => new Float32Array(n));
      let p = o + 8;
      for (let i = 0; i < n; i++) for (let c = 0; c < fmt.channels; c++) {
        channels[c][i] = v.getInt16(p, true) / 0x8000;
        p += 2;
      }
      return { channels, sampleRate: fmt.sampleRate };
    }
    o += 8 + size + (size % 2);
  }
  throw new Error('File WAV senza dati');
}
