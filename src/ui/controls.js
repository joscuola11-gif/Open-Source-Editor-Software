// Controlli del pannello proprietà. Ogni controllo espone {el, sync(clip, local)} e non viene mai
// ricostruito durante un trascinamento: sync() aggiorna solo i valori (niente perdita del focus).

import { h } from './dom.js';
import { icon } from './icons.js';
import { findClip } from '../core/timeline.js';
import { hasKeyframes, keyframeIndexAt, toggleKeyframe } from '../core/keyframes.js';
import { clamp } from '../core/util.js';

const fmt = (v, decimals) => (Number.isFinite(v) ? Number(v.toFixed(decimals)).toString() : '');

/**
 * ctx = {store, clipId(): string, local(): number}  (local = secondi dall'inizio del clip)
 */
export function slider(ctx, { label, min, max, step = 1, unit = '', decimals = 0, get, set, setProject, def, kf = null, history = label }) {
  const range = h('input', { type: 'range', min, max, step, 'aria-label': label });
  const num = h('input', { type: 'number', class: 'num', min, max, step, 'aria-label': `${label} (valore)` });
  const diamond = kf
    ? h('button', { class: 'kf-btn', type: 'button', 'aria-label': `Keyframe ${label}`, title: 'Aggiungi/rimuovi keyframe alla posizione corrente', onClick: () => ctx.store.commit(`Keyframe ${label}`, (p) => {
        const c = findClip(p, ctx.clipId())?.clip;
        if (c) toggleKeyframe(c, kf, ctx.local());
      }) }, icon('diamond', 14))
    : null;
  const apply = (raw) => {
    const v = clamp(Number(raw), min, max);
    if (!Number.isFinite(v)) return;
    if (!ctx.store.inGesture) ctx.store.beginGesture(history);
    ctx.store.previewGesture((p) => {
      if (setProject) return setProject(p, ctx.clipId(), v, ctx.local());
      const c = findClip(p, ctx.clipId())?.clip;
      if (c) set(c, v, ctx.local());
    });
  };
  range.addEventListener('input', () => apply(range.value));
  range.addEventListener('change', () => ctx.store.commitGesture());
  num.addEventListener('change', () => {
    apply(num.value);
    ctx.store.commitGesture();
  });
  const wrap = h('div', { class: 'ctl slider' },
    h('label', { class: 'ctl-label', ondblclick: () => def !== undefined && (apply(def), ctx.store.commitGesture()), title: def !== undefined ? 'Doppio clic: ripristina' : null }, label),
    diamond,
    range,
    h('span', { class: 'num-wrap' }, num, unit ? h('span', { class: 'unit' }, unit) : null),
  );
  return {
    el: wrap,
    sync(clip, local) {
      const v = get(clip, local);
      if (document.activeElement !== range) range.value = String(v);
      if (document.activeElement !== num) num.value = fmt(v, decimals);
      if (diamond) {
        const on = keyframeIndexAt(clip, kf, local) >= 0;
        diamond.classList.toggle('on', on);
        diamond.classList.toggle('has', !on && hasKeyframes(clip, kf));
      }
    },
  };
}

export function colorPicker(ctx, { label, get, set, history = label }) {
  const input = h('input', { type: 'color', 'aria-label': label });
  input.addEventListener('input', () => {
    if (!ctx.store.inGesture) ctx.store.beginGesture(history);
    ctx.store.previewGesture((p) => {
      const c = findClip(p, ctx.clipId())?.clip;
      if (c) set(c, input.value);
    });
  });
  input.addEventListener('change', () => ctx.store.commitGesture());
  return {
    el: h('div', { class: 'ctl color' }, h('label', { class: 'ctl-label' }, label), input),
    sync(clip) {
      const v = get(clip);
      if (document.activeElement !== input && /^#[0-9a-f]{6}$/i.test(v)) input.value = v;
    },
  };
}

export function selectControl(ctx, { label, options, get, set, history = label }) {
  const sel = h('select', { 'aria-label': label }, options.map((o) => h('option', { value: o.id }, o.label)));
  sel.addEventListener('change', () =>
    ctx.store.commit(history, (p) => {
      const c = findClip(p, ctx.clipId())?.clip;
      if (c) set(c, sel.value);
    }),
  );
  return {
    el: h('div', { class: 'ctl select' }, h('label', { class: 'ctl-label' }, label), sel),
    sync(clip) {
      const v = get(clip);
      if (document.activeElement !== sel) sel.value = String(v);
    },
  };
}

export function toggleControl(ctx, { label, get, set, history = label }) {
  const input = h('input', { type: 'checkbox', 'aria-label': label });
  input.addEventListener('change', () =>
    ctx.store.commit(history, (p) => {
      const c = findClip(p, ctx.clipId())?.clip;
      if (c) set(c, input.checked);
    }),
  );
  return {
    el: h('label', { class: 'ctl toggle' }, input, h('span', { class: 'switch' }), h('span', { class: 'ctl-label' }, label)),
    sync(clip) {
      input.checked = !!get(clip);
    },
  };
}

export function textControl(ctx, { label, get, set, multiline = false, history = label, placeholder = '' }) {
  const el = multiline ? h('textarea', { rows: 3, 'aria-label': label, placeholder }) : h('input', { type: 'text', 'aria-label': label, placeholder });
  el.addEventListener('input', () =>
    ctx.store.commit(history, (p) => {
      const c = findClip(p, ctx.clipId())?.clip;
      if (c) set(c, el.value);
    }, { coalesce: `${history}:${ctx.clipId()}` }),
  );
  return {
    el: h('div', { class: 'ctl text' }, h('label', { class: 'ctl-label' }, label), el),
    sync(clip) {
      const v = get(clip);
      if (document.activeElement !== el) el.value = v;
    },
  };
}

/** Gruppo di pulsanti mutuamente esclusivi o a scelta (segmented). */
export function segmented(ctx, { label, options, get, set, history = label }) {
  const buttons = options.map((o) =>
    h('button', {
      type: 'button',
      class: 'seg-btn',
      'aria-label': o.title ?? o.label,
      title: o.title ?? o.label,
      'data-value': o.id,
      onClick: () =>
        ctx.store.commit(history, (p) => {
          const c = findClip(p, ctx.clipId())?.clip;
          if (c) set(c, o.id, get(c));
        }),
    }, o.icon ? icon(o.icon, 16) : o.label),
  );
  return {
    el: h('div', { class: 'ctl segmented' }, label ? h('label', { class: 'ctl-label' }, label) : null, h('div', { class: 'seg' }, buttons)),
    sync(clip) {
      const v = get(clip);
      for (const b of buttons) b.classList.toggle('on', b.dataset.value === String(v) || (Array.isArray(v) && v.includes(b.dataset.value)));
    },
  };
}

export function actionButton({ label, icon: ic, onClick, title, danger = false }) {
  return h('button', { class: `btn small${danger ? ' danger' : ''}`, type: 'button', title: title ?? label, onClick }, ic ? icon(ic, 14) : null, label);
}

export function section(title, children, { open = true } = {}) {
  const det = h('details', { class: 'section', open }, h('summary', {}, h('span', {}, title), icon('chevronDown', 14)), h('div', { class: 'section-body' }, children));
  return det;
}
