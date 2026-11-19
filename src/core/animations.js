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
};

export const ANIMATION_IDS = Object.keys(ANIMATIONS);
export const TRANSITION_IDS = ANIMATION_IDS.filter((id) => !ANIMATIONS[id].textOnly);
export const ENTER_EXIT_IDS = ANIMATION_IDS.filter((id) => !ANIMATIONS[id].transitionOnly);

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
export function clipAnimationState(clip, local) {
  const s = neutralState();
  const d = clip.duration;
  const tr = clip.transition;
  if (tr && tr.duration > 0 && local < tr.duration) animationState(tr.type, local / tr.duration, s);
  const ai = clip.anim?.in;
  if (ai && ai.duration > 0 && local < ai.duration) combine(s, animationState(ai.type, local / ai.duration));
  const ao = clip.anim?.out;
  if (ao && ao.duration > 0 && local > d - ao.duration) combine(s, animationState(ao.type, (d - local) / ao.duration));
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
