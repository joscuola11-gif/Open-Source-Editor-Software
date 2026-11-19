// Utilità senza dipendenze dal browser (usate anche dai test).

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Emitter {
  #map = new Map();
  on(type, fn) {
    if (!this.#map.has(type)) this.#map.set(type, new Set());
    this.#map.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    this.#map.get(type)?.delete(fn);
  }
  emit(type, ...args) {
    for (const fn of [...(this.#map.get(type) ?? [])]) {
      try {
        fn(...args);
      } catch (e) {
        console.error(`[${type}]`, e);
      }
    }
  }
}

/** 0:07 · 12:03 · 1:02:03 */
export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 1 234 567 → «1,2 Mbit/s» */
export function formatBitrate(bps) {
  if (!Number.isFinite(bps) || bps < 0) return '–';
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1).replace('.', ',')} Mbit/s`;
  return `${Math.round(bps / 1e3)} kbit/s`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
