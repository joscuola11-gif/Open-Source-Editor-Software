// Registro unico di animazioni di ingresso/uscita e transizioni.
// `p` è la "presenza" del clip: 0 = assente, 1 = completamente presente.
// Le animazioni di uscita usano lo stesso registro con p che scende da 1 a 0.

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
const easeOutBounce = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};

const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Stato neutro: nessuna modifica. */
export function neutralState() {
  return { alpha: 1, dx: 0, dy: 0, scale: 1, sx: 1, sy: 1, rotation: 0, blur: 0, reveal: null, overlay: null, chars: 1 };
}

const mk = (label, fn, extra = {}) => ({ label, fn, ...extra });

export const ANIMATIONS = {
  fade: mk('Dissolvenza', (p, s) => {
    s.alpha = p;
  }),
  'slide-from-left': mk('Scorri da sinistra', (p, s) => {
    s.dx = -(1 - easeOutCubic(p));
    s.alpha = Math.min(1, p * 3);
  }),
  'slide-from-right': mk('Scorri da destra', (p, s) => {
    s.dx = 1 - easeOutCubic(p);
    s.alpha = Math.min(1, p * 3);
  }),
  'slide-from-top': mk('Scorri dall’alto', (p, s) => {
    s.dy = -(1 - easeOutCubic(p));
    s.alpha = Math.min(1, p * 3);
  }),
  'slide-from-bottom': mk('Scorri dal basso', (p, s) => {
    s.dy = 1 - easeOutCubic(p);
    s.alpha = Math.min(1, p * 3);
  }),
  'zoom-in': mk('Zoom avanti', (p, s) => {
    s.scale = 0.4 + 0.6 * easeOutCubic(p);
    s.alpha = p;
  }),
  'zoom-out': mk('Zoom indietro', (p, s) => {
    s.scale = 1.7 - 0.7 * easeOutCubic(p);
    s.alpha = p;
  }),
  pop: mk('Pop', (p, s) => {
    s.scale = Math.max(0, easeOutBack(p));
    s.alpha = Math.min(1, p * 4);
  }),
  spin: mk('Rotazione', (p, s) => {
    const e = easeOutCubic(p);
    s.rotation = (1 - e) * -360;
    s.scale = 0.2 + 0.8 * e;
    s.alpha = e;
  }),
  bounce: mk('Rimbalzo', (p, s) => {
    s.dy = -(1 - easeOutBounce(p)) * 0.5;
    s.alpha = Math.min(1, p * 5);
  }),
  blur: mk('Sfocatura', (p, s) => {
    s.blur = (1 - p) * 30;
    s.alpha = p;
  }),
  'wipe-from-left': mk('Tendina da sinistra', (p, s) => {
    s.reveal = { shape: 'rect', dir: 'left', p };
  }),
  'wipe-from-right': mk('Tendina da destra', (p, s) => {
    s.reveal = { shape: 'rect', dir: 'right', p };
  }),
  'wipe-from-top': mk('Tendina dall’alto', (p, s) => {
    s.reveal = { shape: 'rect', dir: 'top', p };
  }),
  'wipe-from-bottom': mk('Tendina dal basso', (p, s) => {
    s.reveal = { shape: 'rect', dir: 'bottom', p };
  }),
  iris: mk('Iride', (p, s) => {
    s.reveal = { shape: 'circle', dir: 'center', p };
  }),
  'flip-h': mk('Ribalta orizzontale', (p, s) => {
    s.sx = Math.max(0.0001, Math.sin((p * Math.PI) / 2));
    s.alpha = Math.min(1, p * 3);
  }),
  'flip-v': mk('Ribalta verticale', (p, s) => {
    s.sy = Math.max(0.0001, Math.sin((p * Math.PI) / 2));
    s.alpha = Math.min(1, p * 3);
  }),
  // Solo testo
  typewriter: mk(
    'Macchina da scrivere',
    (p, s) => {
      s.chars = p;
    },
    { textOnly: true },
  ),
  rise: mk(
    'Sale e appare',
    (p, s) => {
      s.dy = (1 - easeOutCubic(p)) * 0.12;
      s.alpha = p;
    },
    { textOnly: true },
  ),
  // Solo transizioni (dip: il nuovo clip compare a metà, sotto una sovrapposizione di colore)
  'dip-black': mk(
    'Dissolvenza nel nero',
    (p, s) => {
      s.alpha = p >= 0.5 ? 1 : 0;
      s.overlay = { color: '#000000', alpha: 1 - Math.abs(2 * p - 1) };
    },
    { transitionOnly: true },
  ),
  'dip-white': mk(
    'Flash bianco',
    (p, s) => {
      s.alpha = p >= 0.5 ? 1 : 0;
      s.overlay = { color: '#ffffff', alpha: 1 - Math.abs(2 * p - 1) };
    },
    { transitionOnly: true },
  ),
  // ---- transizioni con clip uscente ("partner"): il clip precedente si muove insieme a quello che entra ----
  'cross-blur': mk('Sfuma e sfoca', (p, s) => { s.blur = (1 - p) * 28; s.alpha = p; }, { transitionOnly: true, partner: (p, s) => { s.blur = p * 28; } }),
  'push-left': mk('Spingi a sinistra', (p, s) => { s.dx = 1 - easeInOut(p); }, { transitionOnly: true, partner: (p, s) => { s.dx = -easeInOut(p); } }),
  'push-right': mk('Spingi a destra', (p, s) => { s.dx = -(1 - easeInOut(p)); }, { transitionOnly: true, partner: (p, s) => { s.dx = easeInOut(p); } }),
  'push-up': mk('Spingi in alto', (p, s) => { s.dy = 1 - easeInOut(p); }, { transitionOnly: true, partner: (p, s) => { s.dy = -easeInOut(p); } }),
  'push-down': mk('Spingi in basso', (p, s) => { s.dy = -(1 - easeInOut(p)); }, { transitionOnly: true, partner: (p, s) => { s.dy = easeInOut(p); } }),
  'whip-left': mk('Scatto a sinistra', (p, s) => { s.dx = 1 - easeInOut(p); s.blur = Math.sin(Math.PI * p) * 30; }, { transitionOnly: true, partner: (p, s) => { s.dx = -easeInOut(p); s.blur = Math.sin(Math.PI * p) * 30; } }),
  'whip-right': mk('Scatto a destra', (p, s) => { s.dx = -(1 - easeInOut(p)); s.blur = Math.sin(Math.PI * p) * 30; }, { transitionOnly: true, partner: (p, s) => { s.dx = easeInOut(p); s.blur = Math.sin(Math.PI * p) * 30; } }),
  'zoom-through': mk('Zoom attraverso', (p, s) => { s.scale = 0.5 + 0.5 * easeInOut(p); s.alpha = p; }, { transitionOnly: true, partner: (p, s) => { s.scale = 1 + 1.4 * easeInOut(p); s.alpha = 1 - p; } }),
  'zoom-blur': mk('Zoom sfocato', (p, s) => { s.scale = 1.5 - 0.5 * easeInOut(p); s.blur = (1 - p) * 20; s.alpha = p; }, { transitionOnly: true, partner: (p, s) => { s.blur = p * 20; } }),
  'split-h': mk('Apertura dal centro (orizzontale)', (p, s) => { s.reveal = { shape: 'rect', dir: 'center-x', p: easeInOut(p) }; }, { transitionOnly: true }),
  'split-v': mk('Apertura dal centro (verticale)', (p, s) => { s.reveal = { shape: 'rect', dir: 'center-y', p: easeInOut(p) }; }, { transitionOnly: true }),
  'reveal-diamond': mk('Rombo', (p, s) => { s.reveal = { shape: 'diamond', p: easeInOut(p) }; }, { transitionOnly: true }),
  'reveal-star': mk('Stella', (p, s) => { s.reveal = { shape: 'star', p: easeInOut(p) }; }, { transitionOnly: true }),
  'reveal-heart': mk('Cuore', (p, s) => { s.reveal = { shape: 'heart', p: easeInOut(p) }; }, { transitionOnly: true }),
  'reveal-rounded': mk('Rettangolo arrotondato', (p, s) => { s.reveal = { shape: 'rounded', p: easeInOut(p) }; }, { transitionOnly: true }),
  clock: mk('Orologio', (p, s) => { s.reveal = { shape: 'clock', p }; }, { transitionOnly: true }),
  'blinds-h': mk('Veneziana orizzontale', (p, s) => { s.reveal = { shape: 'blinds', dir: 'h', n: 8, p: easeInOut(p) }; }, { transitionOnly: true }),
  'blinds-v': mk('Veneziana verticale', (p, s) => { s.reveal = { shape: 'blinds', dir: 'v', n: 10, p: easeInOut(p) }; }, { transitionOnly: true }),
  checker: mk('Scacchiera', (p, s) => { s.reveal = { shape: 'cells', mode: 'checker', n: 8, p }; }, { transitionOnly: true }),
  mosaic: mk('Mosaico casuale', (p, s) => { s.reveal = { shape: 'cells', mode: 'random', n: 12, p }; }, { transitionOnly: true }),
  glitch: mk(
    'Glitch',
    (p, s) => {
      const k = Math.floor(p * 14);
      s.dx = Math.sin(k * 12.9898) * 0.06 * (1 - p);
      s.alpha = p > 0.85 || k % 3 !== 1 ? 1 : 0.15;
      if (p < 0.85 && k % 4 === 2) s.overlay = { color: '#ff2d6f', alpha: 0.25 };
    },
    { transitionOnly: true, partner: (p, s) => { const k = Math.floor(p * 14); s.dx = -Math.sin(k * 7.233) * 0.05 * p; } },
  ),
};

// ---- gruppi di transizioni (per le schede dell'interfaccia) ----
const GROUP_OF = {
  fade: 'Dissolvenza', 'dip-black': 'Dissolvenza', 'dip-white': 'Dissolvenza',
  blur: 'Sfocatura', 'cross-blur': 'Sfocatura',
  'slide-from-left': 'Scorrimento', 'slide-from-right': 'Scorrimento', 'slide-from-top': 'Scorrimento', 'slide-from-bottom': 'Scorrimento',
  'push-left': 'Spinta', 'push-right': 'Spinta', 'push-up': 'Spinta', 'push-down': 'Spinta', 'whip-left': 'Spinta', 'whip-right': 'Spinta',
  'zoom-in': 'Zoom', 'zoom-out': 'Zoom', 'zoom-through': 'Zoom', 'zoom-blur': 'Zoom',
  'wipe-from-left': 'Tendine e divisione', 'wipe-from-right': 'Tendine e divisione', 'wipe-from-top': 'Tendine e divisione', 'wipe-from-bottom': 'Tendine e divisione', 'split-h': 'Tendine e divisione', 'split-v': 'Tendine e divisione',
  iris: 'Maschera', 'reveal-diamond': 'Maschera', 'reveal-star': 'Maschera', 'reveal-heart': 'Maschera', 'reveal-rounded': 'Maschera', clock: 'Maschera',
  'blinds-h': 'Grafiche', 'blinds-v': 'Grafiche', checker: 'Grafiche', mosaic: 'Grafiche', glitch: 'Grafiche',
};
for (const [id, a] of Object.entries(ANIMATIONS)) a.group = a.textOnly ? 'Testo' : GROUP_OF[id] ?? 'Altre';
export const TRANSITION_GROUP_ORDER = ['Dissolvenza', 'Sfocatura', 'Scorrimento', 'Spinta', 'Zoom', 'Tendine e divisione', 'Maschera', 'Grafiche', 'Altre'];

// ---- animazioni cicliche: durano per tutto il clip e si ripetono (`speed` = cicli al secondo, `amount` = intensità 0..100) ----
const TAU = Math.PI * 2;
export const LOOPS = {
  pulse: { label: 'Pulsa', fn: (ph, a, s) => { s.scale = 1 + 0.07 * a * Math.sin(ph * TAU); } },
  heartbeat: { label: 'Battito', fn: (ph, a, s) => { const x = ph % 1; s.scale = 1 + 0.1 * a * (Math.exp(-((x - 0.1) ** 2) / 0.003) + 0.7 * Math.exp(-((x - 0.3) ** 2) / 0.004)); } },
  float: { label: 'Fluttua', fn: (ph, a, s) => { s.dy = -0.025 * a * Math.sin(ph * TAU); } },
  swing: { label: 'Dondola', fn: (ph, a, s) => { s.rotation = 6 * a * Math.sin(ph * TAU); } },
  wiggle: { label: 'Ondeggia', fn: (ph, a, s) => { s.dx = 0.02 * a * Math.sin(ph * TAU); s.rotation = 3 * a * Math.sin(ph * TAU * 2); } },
  shake: { label: 'Trema', fn: (ph, a, s) => { s.dx = 0.008 * a * Math.sin(ph * TAU * 7); s.dy = 0.008 * a * Math.cos(ph * TAU * 9); } },
  blink: { label: 'Lampeggia', fn: (ph, a, s) => { s.alpha = 1 - 0.85 * a * (Math.sin(ph * TAU) > 0 ? 0 : 1); } },
  breathe: { label: 'Respira', fn: (ph, a, s) => { s.alpha = 1 - 0.45 * a * (0.5 - 0.5 * Math.cos(ph * TAU)); } },
  'spin-loop': { label: 'Gira', fn: (ph, a, s) => { s.rotation = (ph % 1) * 360 * (a > 0 ? 1 : 0); } },
};
export const LOOP_IDS = Object.keys(LOOPS);

export function sanitizeLoop(raw) {
  if (!raw || typeof raw !== 'object' || !LOOPS[raw.type]) return null;
  const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return { type: raw.type, speed: num(raw.speed, 1, 0.1, 8), amount: num(raw.amount, 60, 0, 100) };
}

/** Stato di una animazione ciclica a `local` secondi dall'inizio del clip. */
export function loopState(loop, local, out = neutralState()) {
  const l = LOOPS[loop?.type];
  if (!l || !(local >= 0)) return out;
  l.fn(local * (loop.speed ?? 1), (loop.amount ?? 60) / 100, out);
  return out;
}

export const ANIMATION_IDS = Object.keys(ANIMATIONS);
export const TRANSITION_IDS = ANIMATION_IDS.filter((id) => !ANIMATIONS[id].textOnly);
export const ENTER_EXIT_IDS = ANIMATION_IDS.filter((id) => !ANIMATIONS[id].transitionOnly);

/** Transizioni divise per gruppo, nell'ordine in cui si mostrano: [{label, ids}] */
export function transitionGroups() {
  return TRANSITION_GROUP_ORDER.map((label) => ({ label, ids: TRANSITION_IDS.filter((id) => ANIMATIONS[id].group === label) })).filter((g) => g.ids.length);
}

/** Calcola lo stato di animazione per presenza `p` (0..1). Scrive in `out` se fornito. */
export function animationState(type, p, out = neutralState()) {
  const a = ANIMATIONS[type];
  if (!a) return out;
  a.fn(p < 0 ? 0 : p > 1 ? 1 : p, out);
  return out;
}

/**
 * Stato combinato di ingresso/uscita/transizione di un clip al tempo locale `local`.
 * Restituisce neutralState() quando nessuna animazione è attiva.
 */
export function clipAnimationState(clip, local, next = null) {
  const s = neutralState();
  const d = clip.duration;
  const tr = clip.transition;
  if (tr && tr.duration > 0 && local < tr.duration) animationState(tr.type, local / tr.duration, s);
  const ai = clip.anim?.in;
  if (ai && ai.duration > 0 && local < ai.duration) combine(s, animationState(ai.type, local / ai.duration));
  const ao = clip.anim?.out;
  if (ao && ao.duration > 0 && local > d - ao.duration) combine(s, animationState(ao.type, (d - local) / ao.duration));
  if (clip.anim?.loop) combine(s, loopState(clip.anim.loop, local));
  // il clip che segue ha una transizione che si sovrappone alla mia coda: alcune transizioni muovono anche me
  const nt = next?.transition;
  if (nt && nt.duration > 0) {
    const q = (clip.start + local - next.start) / nt.duration;
    const partner = ANIMATIONS[nt.type]?.partner;
    if (partner && q >= 0 && q < 1) {
      const ps = neutralState();
      partner(q, ps);
      combine(s, ps);
    }
  }
  return s;
}

function combine(a, b) {
  a.alpha *= b.alpha;
  a.dx += b.dx;
  a.dy += b.dy;
  a.scale *= b.scale;
  a.sx *= b.sx;
  a.sy *= b.sy;
  a.rotation += b.rotation;
  a.blur = Math.max(a.blur, b.blur);
  a.chars = Math.min(a.chars, b.chars);
  if (b.reveal) a.reveal = b.reveal;
  if (b.overlay) a.overlay = b.overlay;
}
