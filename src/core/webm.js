// MediaRecorder produce WebM senza l'elemento Duration: molti lettori mostrano durata "infinita"
// e non permettono di spostarsi nel video. Questo modulo inserisce (o corregge) Duration.

const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_CLUSTER = 0x1f43b675;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;

function readId(buf, pos) {
  const b = buf[pos];
  let len = 1;
  let mask = 0x80;
  while (len <= 4 && !(b & mask)) {
    len++;
    mask >>= 1;
  }
  if (len > 4 || pos + len > buf.length) throw new Error('WebM: ID non valido');
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf[pos + i];
  return { id, len };
}

function readSize(buf, pos) {
  const b = buf[pos];
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && !(b & mask)) {
    len++;
    mask >>= 1;
  }
  if (len > 8 || pos + len > buf.length) throw new Error('WebM: dimensione non valida');
  let val = b & (mask - 1);
  let allOnes = val === mask - 1;
  for (let i = 1; i < len; i++) {
    val = val * 256 + buf[pos + i];
    if (buf[pos + i] !== 0xff) allOnes = false;
  }
  return { size: allOnes ? -1 : val, len };
}

function minimalSizeLen(value) {
  for (let len = 1; len <= 8; len++) if (value < 2 ** (7 * len) - 1) return len;
  throw new Error('WebM: dimensione troppo grande');
}

function encodeSize(value, len) {
  const out = new Uint8Array(len);
  let v = value;
  for (let i = len - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (len - 1);
  return out;
}

/** Legge la durata (ms) di un WebM; null se assente. Utile ai test. */
export function readWebmDuration(input) {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const info = locateInfo(buf);
  if (!info) return null;
  const { scale, durationPos, durationLen } = parseInfoChildren(buf, info);
  if (durationPos < 0) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset + durationPos, durationLen);
  const v = durationLen === 4 ? dv.getFloat32(0) : dv.getFloat64(0);
  return (v * scale) / 1e6;
}

function locateInfo(buf) {
  let pos = 0;
  // intestazione EBML
  const h = readId(buf, pos);
  const hs = readSize(buf, pos + h.len);
  pos += h.len + hs.len + Math.max(0, hs.size);
  const seg = readId(buf, pos);
  if (seg.id !== ID_SEGMENT) return null;
  const segSize = readSize(buf, pos + seg.len);
  const segSizePos = pos + seg.len;
  let p = segSizePos + segSize.len;
  const segEnd = segSize.size < 0 ? buf.length : Math.min(buf.length, p + segSize.size);
  while (p < segEnd) {
    const id = readId(buf, p);
    const sz = readSize(buf, p + id.len);
    if (id.id === ID_CLUSTER) return null;
    const dataStart = p + id.len + sz.len;
    if (id.id === ID_INFO) {
      return { segSizePos, segSizeLen: segSize.len, segSize: segSize.size, infoSizePos: p + id.len, infoSizeLen: sz.len, dataStart, dataEnd: dataStart + sz.size };
    }
    if (sz.size < 0) return null;
    p = dataStart + sz.size;
  }
  return null;
}

function parseInfoChildren(buf, info) {
  let scale = 1e6;
  let durationPos = -1;
  let durationLen = 0;
  let p = info.dataStart;
  while (p < info.dataEnd) {
    const id = readId(buf, p);
    const sz = readSize(buf, p + id.len);
    const ds = p + id.len + sz.len;
    if (id.id === ID_TIMECODE_SCALE) {
      scale = 0;
      for (let i = 0; i < sz.size; i++) scale = scale * 256 + buf[ds + i];
    } else if (id.id === ID_DURATION && (sz.size === 4 || sz.size === 8)) {
      durationPos = ds;
      durationLen = sz.size;
    }
    p = ds + sz.size;
  }
  return { scale, durationPos, durationLen };
}

/**
 * Restituisce un nuovo Uint8Array con l'elemento Duration impostato a `durationMs`.
 * Se la struttura non è riconosciuta restituisce i dati invariati (mai un file corrotto).
 */
export function fixWebmDuration(input, durationMs) {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  try {
    const info = locateInfo(buf);
    if (!info || info.dataEnd > buf.length) return buf;
    const { scale, durationPos, durationLen } = parseInfoChildren(buf, info);
    const value = (durationMs * 1e6) / scale;
    if (durationPos >= 0) {
      const out = buf.slice();
      const dv = new DataView(out.buffer, durationPos, durationLen);
      if (durationLen === 4) dv.setFloat32(0, value);
      else dv.setFloat64(0, value);
      return out;
    }
    const infoSize = info.dataEnd - info.dataStart;
    const durEl = new Uint8Array(11);
    durEl[0] = 0x44;
    durEl[1] = 0x89;
    durEl[2] = 0x88;
    new DataView(durEl.buffer).setFloat64(3, value);
    const newInfoSize = infoSize + durEl.length;
    const newInfoSizeLen = Math.max(info.infoSizeLen, minimalSizeLen(newInfoSize));
    const grow = durEl.length + (newInfoSizeLen - info.infoSizeLen);
    const out = new Uint8Array(buf.length + grow);
    out.set(buf.subarray(0, info.infoSizePos), 0);
    out.set(encodeSize(newInfoSize, newInfoSizeLen), info.infoSizePos);
    let w = info.infoSizePos + newInfoSizeLen;
    out.set(buf.subarray(info.dataStart, info.dataEnd), w);
    w += infoSize;
    out.set(durEl, w);
    w += durEl.length;
    out.set(buf.subarray(info.dataEnd), w);
    if (info.segSize >= 0) {
      const newSeg = info.segSize + grow;
      if (minimalSizeLen(newSeg) > info.segSizeLen) return buf;
      out.set(encodeSize(newSeg, info.segSizeLen), info.segSizePos);
    }
    return out;
  } catch {
    return buf;
  }
}
