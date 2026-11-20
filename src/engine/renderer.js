// Compositore: disegna un fotogramma del progetto su un canvas 2D.
//
// Pipeline per clip:
//   1. valori animati (keyframe + animazioni di ingresso/uscita/transizione + effetti di trasformazione)
//   2. sorgente (video/immagine/testo/forma/adesivo/livello di regolazione) e riquadro (ritaglio)
//   3. fase pixel opzionale (chroma key, mosaico, glitch, RGB…) su un canvas di lavoro
//   4. disegno con trasformazione, maschera, filtro CSS; overlay (vignetta, grana, bagliore…)
// Lo strato offscreen (layer) è usato SOLO quando serve (overlay o opacità su contenuti procedurali).
//
// Tutte le dimensioni sono relative al canvas di destinazione (W×H): lo stesso progetto produce
// la stessa immagine a qualsiasi risoluzione (anteprima = esportazione).

import { clamp, hexToRgb } from '../core/util.js';
import { valueAt } from '../core/keyframes.js';
import { clipAnimationState } from '../core/animations.js';
import { revealShapes } from '../core/reveal.js';
import { particleField } from '../core/particles.js';
import { BLEND_MODES, FILTERS } from '../core/presets.js';
import { isActiveAt } from '../core/timeline.js';
import { applyGrade, decodeLut, gradeIsIdentity } from '../core/grade.js';
import { karaokeFraction, prefixLength } from '../core/karaoke.js';
import { IDENTITY_PARAMS, applyFilterParams, bulge, cartoon, chromaKey, duotone, fillNoise, filterCss, glitchSlices, halftone, isIdentityParams, posterize, rgbSplit, scanlines, sketch, swirl, wave, zoomBlur } from './pixel-fx.js';

/** Effetti che elaborano i pixel (fase «pixel» del clip). */
const PIXEL_FX = new Set(['pixelate', 'rgb-split', 'glitch', 'mirror', 'vhs', 'cartoon', 'sketch', 'poster', 'duotone', 'duotone-teal', 'halftone', 'crt', 'wave', 'swirl', 'bulge', 'pinch', 'zoom-blur']);
const DUOTONE = { duotone: [[28, 12, 90], [255, 170, 60]], 'duotone-teal': [[8, 24, 70], [150, 255, 225]] };
const hashString = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; };

const BLEND_OP = Object.fromEntries(BLEND_MODES.map((b) => [b.id, b.op]));
const FILTER_BY_ID = Object.fromEntries(FILTERS.map((f) => [f.id, f]));
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const PIXEL_CAP = 1280;
const TAU = Math.PI * 2;

function makeCanvas(w = 1, h = 1) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const rgba = (hex, a) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
};

/** Path centrato sull'origine che occupa un riquadro w×h. */
export function shapePath(type, w, h, roundness = 0.25) {
  const p = new Path2D();
  const hw = w / 2;
  const hh = h / 2;
  switch (type) {
    case 'circle':
      p.ellipse(0, 0, hw, hh, 0, 0, TAU);
      break;
    case 'rounded':
      if (p.roundRect) p.roundRect(-hw, -hh, w, h, Math.min(w, h) * 0.5 * clamp(roundness, 0, 1));
      else p.rect(-hw, -hh, w, h);
      break;
    case 'triangle':
      p.moveTo(0, -hh);
      p.lineTo(hw, hh);
      p.lineTo(-hw, hh);
      p.closePath();
      break;
    case 'star': {
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 1 : 0.42;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const x = Math.cos(a) * r * hw;
        const y = Math.sin(a) * r * hh;
        if (i === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      p.closePath();
      break;
    }
    case 'heart':
      p.moveTo(0, hh);
      p.bezierCurveTo(-hw * 1.15, hh * 0.1, -hw * 0.95, -hh * 1.0, 0, -hh * 0.45);
      p.bezierCurveTo(hw * 0.95, -hh * 1.0, hw * 1.15, hh * 0.1, 0, hh);
      p.closePath();
      break;
    case 'arrow': {
      const sh = hh * 0.38;
      p.moveTo(-hw, -sh);
      p.lineTo(hw * 0.25, -sh);
      p.lineTo(hw * 0.25, -hh);
      p.lineTo(hw, 0);
      p.lineTo(hw * 0.25, hh);
      p.lineTo(hw * 0.25, sh);
      p.lineTo(-hw, sh);
      p.closePath();
      break;
    }
    default:
      p.rect(-hw, -hh, w, h);
  }
  return p;
}

/** Parametri filtro combinati (preset con intensità + regolazioni manuali). */
export function filterParamsFor(clip, H) {
  const out = { ...IDENTITY_PARAMS };
  const preset = FILTER_BY_ID[clip.filter?.id];
  if (preset && preset.id !== 'none') {
    const k = clamp(clip.filter.intensity ?? 1, 0, 1);
    for (const key of Object.keys(preset.params)) {
      const id = IDENTITY_PARAMS[key];
      out[key] = id + (preset.params[key] - id) * k;
    }
  }
  const a = clip.adjust;
  out.brightness *= 1 + a.brightness / 100;
  out.contrast *= 1 + a.contrast / 100;
  out.saturate *= 1 + a.saturation / 100;
  out.hue += a.hue;
  out.blur = (a.blur / 100) * H * 0.03;
  for (const fx of clip.effects) if (fx.type === 'blur') out.blur += (fx.amount / 100) * H * 0.03;
  return out;
}

export class Renderer {
  #measure;
  #layer = null;
  /** Provider delle maschere «rimuovi sfondo»: (clip, tempoNelFile) → canvas con la maschera nel canale alfa, o null. */
  cutoutFor = null;
  #backdropCtx = null;
  #scratchA = null;
  #scratchB = null;
  #snap = null;
  #noise = null;
  #textCache = new Map();
  #warned = new Set();
  #lookKeys = new Map(); // clipId → chiave dell'ultimo fotogramma (per rilevare i parametri stabili)
  #looks = new Map(); // clipId → {key, canvas}: aspetto statico già elaborato (LRU)
  #glow = null;
  #luts = {};
  #lutCache = new Map();
  lookHits = 0; // contatori per test/diagnostica
  lookBuilds = 0;
  supportsFilter;
  supportsLetterSpacing;

  constructor(pool) {
    this.pool = pool;
    this.#measure = makeCanvas(1, 1).getContext('2d');
    this.supportsFilter = 'filter' in this.#measure;
    this.supportsLetterSpacing = 'letterSpacing' in this.#measure;
  }

  // ---------------------------------------------------------------------------
  // API pubblica
  // ---------------------------------------------------------------------------

  /** Elementi video visibili che non hanno ancora il fotogramma giusto (seek o buffering in corso). */
  notReady(p, t) {
    const bad = [];
    for (const track of p.tracks) {
      if (track.type !== 'video' || track.hidden) continue;
      for (const clip of track.clips) {
        if (clip.kind !== 'video' || !isActiveAt(clip, t)) continue;
        const el = this.pool.peek(clip.id);
        if (el && (el.readyState < 2 || el.seeking)) bad.push(el);
      }
    }
    return bad;
  }

  /** LUT del progetto, decodificate una sola volta (la chiave è il testo salvato: cambia solo se cambia la LUT). */
  #lutFor(id) {
    const entry = this.#luts?.[id];
    if (!entry) return null;
    const cached = this.#lutCache.get(id);
    if (cached?.src === entry.data) return cached.lut;
    const lut = decodeLut(entry);
    this.#lutCache.set(id, { src: entry.data, lut });
    return lut;
  }

  render(ctx, p, t) {
    this.#luts = p.luts ?? {};
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = p.settings.background;
    ctx.fillRect(0, 0, W, H);
    for (let ti = p.tracks.length - 1; ti >= 0; ti--) {
      const track = p.tracks[ti];
      if (track.type !== 'video' || track.hidden) continue;
      for (let ci = 0; ci < track.clips.length; ci++) {
        const clip = track.clips[ci];
        if (!isActiveAt(clip, t)) continue;
        try {
          this.#drawClip(ctx, p, clip, t, W, H, track.clips[ci + 1] ?? null);
        } catch (e) {
          if (!this.#warned.has(clip.id)) {
            this.#warned.add(clip.id);
            console.error('[renderer] errore nel disegno del clip', clip.id, e);
          }
        }
      }
    }
    ctx.restore();
  }

  /**
   * Riquadro del clip in coordinate canvas (per le maniglie dell'anteprima):
   * {cx, cy, w, h, rotation} con (cx,cy) = centro del contenuto, w/h già scalati.
   */
  geometry(p, clip, t, W, H) {
    const local = t - clip.start;
    const content = this.#contentBox(p, clip, W, H);
    if (!content) return null;
    const scale = valueAt(clip, 'scale', local);
    const rot = valueAt(clip, 'rotation', local);
    const x = valueAt(clip, 'x', local);
    const y = valueAt(clip, 'y', local);
    const r = (rot * Math.PI) / 180;
    const sx = content.ox * scale * (clip.transform.flipX ? -1 : 1);
    const sy = content.oy * scale * (clip.transform.flipY ? -1 : 1);
    return {
      cx: W / 2 + x * W + sx * Math.cos(r) - sy * Math.sin(r),
      cy: H / 2 + y * H + sx * Math.sin(r) + sy * Math.cos(r),
      w: content.w * scale,
      h: content.h * scale,
      rotation: rot,
    };
  }

  // ---------------------------------------------------------------------------
  // Riquadro del contenuto (coordinate locali non scalate)
  // ---------------------------------------------------------------------------

  #contentBox(p, clip, W, H) {
    switch (clip.kind) {
      case 'video':
      case 'image': {
        const m = p.media[clip.mediaId];
        let sw = m?.width || 0;
        let sh = m?.height || 0;
        const bmp = clip.kind === 'image' ? this.pool.image(clip.mediaId) : this.pool.peek(clip.id);
        if (bmp) {
          sw = bmp.videoWidth || bmp.width || sw;
          sh = bmp.videoHeight || bmp.height || sh;
        }
        if (!sw || !sh) {
          sw = 16;
          sh = 9;
        }
        const fit = Math.min(W / sw, H / sh);
        const fw = sw * fit;
        const fh = sh * fit;
        const { l, t, r, b } = clip.crop;
        return { w: Math.max(1, fw * (1 - l - r)), h: Math.max(1, fh * (1 - t - b)), ox: ((l - r) / 2) * fw, oy: ((t - b) / 2) * fh, sw, sh, fw, fh };
      }
      case 'adjustment':
        return { w: W, h: H, ox: 0, oy: 0, sw: W, sh: H, fw: W, fh: H };
      case 'text': {
        const L = this.#layoutText(clip.text, H, W);
        return { w: L.w, h: L.h, ox: 0, oy: 0, layout: L };
      }
      case 'shape': {
        const s = clip.shape;
        if (s.full) return { w: W, h: H, ox: 0, oy: 0 };
        const h = s.type === 'line' ? Math.max(2, s.strokeWidth * H || 0.012 * H) : s.h * H;
        return { w: s.w * H, h, ox: 0, oy: 0 };
      }
      case 'sticker': {
        const s = clip.sticker.size * H;
        return { w: s * 1.2, h: s * 1.2, ox: 0, oy: 0 };
      }
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Disegno di un clip
  // ---------------------------------------------------------------------------

  #drawClip(ctx, p, clip, t, W, H, next = null) {
    const local = t - clip.start;
    const an = clipAnimationState(clip, local, next);
    const fps = p.settings.fps;
    const frame = Math.floor(t * fps + 1e-6);
    const tf = clip.transform;

    let x = valueAt(clip, 'x', local) + an.dx;
    let y = valueAt(clip, 'y', local) + an.dy;
    let scale = valueAt(clip, 'scale', local) * an.scale;
    let rot = valueAt(clip, 'rotation', local) + an.rotation;
    const opacity = clamp(valueAt(clip, 'opacity', local), 0, 1) * an.alpha;

    // Effetti di trasformazione (deterministici nel tempo)
    for (const fx of clip.effects) {
      const k = fx.amount / 100;
      if (fx.type === 'shake') {
        const amp = k * 0.025;
        x += amp * (Math.sin(t * 53) + 0.5 * Math.sin(t * 91.7));
        y += amp * (Math.sin(t * 47 + 1.3) + 0.5 * Math.sin(t * 83.1 + 2));
        rot += k * 1.6 * Math.sin(t * 61);
      } else if (fx.type === 'pulse') scale *= 1 + k * 0.1 * Math.sin(t * TAU * 2);
    }

    const drawOverlayOnly = () => this.#drawCanvasOverlay(ctx, an, W, H);
    if (opacity < 0.0005 || scale < 1e-4) return drawOverlayOnly();

    const box = this.#contentBox(p, clip, W, H);
    if (!box) return;

    // --- sorgente -------------------------------------------------------------
    let bitmap = null; // {img, sx, sy, sw, sh}
    let procedural = null; // (c) => void, disegna il contenuto centrato sull'origine
    if (clip.kind === 'video') {
      const el = this.pool.peek(clip.id) ?? this.pool.element(clip);
      if (el && el.readyState >= 2 && el.videoWidth > 0) bitmap = { img: el, sw: el.videoWidth, sh: el.videoHeight };
      else if (!el) procedural = (c) => this.#drawPlaceholder(c, box.w, box.h);
      else return drawOverlayOnly();
    } else if (clip.kind === 'image') {
      const img = this.pool.image(clip.mediaId);
      if (img) bitmap = { img, sw: img.width, sh: img.height };
      else if (!this.pool.has(clip.mediaId)) procedural = (c) => this.#drawPlaceholder(c, box.w, box.h);
      else {
        this.pool.loadImage(clip.mediaId);
        return drawOverlayOnly();
      }
    } else if (clip.kind === 'adjustment') {
      const snap = this.#snapshot(ctx, W, H);
      bitmap = { img: snap, sw: W, sh: H };
    } else if (clip.kind === 'text') procedural = (c) => this.#drawText(c, clip, box.layout, an.chars, scale, H, clip.text.karaoke?.enabled ? karaokeFraction(clip.text, t - clip.start, clip.duration) : 0);
    else if (clip.kind === 'shape') procedural = (c) => this.#drawShape(c, clip, box, W, H);
    else if (clip.kind === 'sticker') procedural = (c) => this.#drawSticker(c, clip, H);

    // Ritaglio sul sorgente
    if (bitmap) {
      const { l, t: ct, r, b } = clip.crop;
      bitmap.sx = bitmap.sw * l;
      bitmap.sy = bitmap.sh * ct;
      bitmap.cw = Math.max(1, bitmap.sw * (1 - l - r));
      bitmap.ch = Math.max(1, bitmap.sh * (1 - ct - b));
    }

    // sfondo dietro il clip (sfocato come il clip stesso, o a colore), solo dove il clip non copre già tutto lo schermo
    if (bitmap && clip.backdrop && clip.backdrop.mode !== 'none' && !(Math.abs(rot) < 0.01 && Math.abs(x * W + box.ox * scale) <= (box.w * scale - W) / 2 + 0.5 && Math.abs(y * H + box.oy * scale) <= (box.h * scale - H) / 2 + 0.5)) this.#drawBackdrop(ctx, clip.backdrop, bitmap, W, H, opacity);

    // --- parametri di stile -----------------------------------------------------
    const fp = filterParamsFor(clip, H);
    const hasColor = !isIdentityParams(fp);
    const css = this.supportsFilter ? filterCss(fp) : '';
    const needSoftFilter = !this.supportsFilter && (hasColor || fp.blur > 0.05);
    const pixelFx = bitmap ? clip.effects.filter((f) => PIXEL_FX.has(f.type)) : [];
    const chroma = bitmap && clip.chroma.enabled ? clip.chroma : null;
    const overlays = this.#overlaysFor(clip, t, fps);
    const gradeOn = !!bitmap && !gradeIsIdentity(clip.grade);
    const glow = clip.effects.find((f) => f.type === 'glow');
    // maschera: valori animabili (dimensione, posizione, sfumatura); con sfumatura si lavora in uno strato a parte
    const maskOn = clip.mask.shape !== 'none';
    const mask = maskOn ? { ...clip.mask, size: valueAt(clip, 'maskSize', local), x: valueAt(clip, 'maskX', local), y: valueAt(clip, 'maskY', local), feather: valueAt(clip, 'maskFeather', local) } : clip.mask;
    const feather = maskOn && mask.feather > 0.004 && this.supportsFilter;
    // «rimuovi sfondo»: la maschera della persona (calcolata a parte) toglie il resto del contenuto
    const cutMask = bitmap && clip.cutout?.enabled && this.cutoutFor ? this.cutoutFor(clip, clip.kind === 'image' ? 0 : clip.in + local * clip.speed) : null;
    const needLayer = overlays.length > 0 || (!!procedural && opacity < 0.999 && clip.kind !== 'sticker') || !!glow || feather || !!cutMask;

    // --- contenuto pronto (eventuale fase pixel) ----------------------------------
    let drawImage = null; // (c, dx, dy, dw, dh) disegna il bitmap (già elaborato) nel riquadro
    if (bitmap) {
      if (chroma || pixelFx.length || needSoftFilter || gradeOn) {
        // la fase pixel è pigra: se la cache dell'aspetto statico è valida non viene mai eseguita
        let staged = null;
        drawImage = (c, dx, dy, dw, dh) => {
          staged ??= this.#pixelStage(bitmap, box, scale, clip, chroma, pixelFx, needSoftFilter ? fp : null, t, fps, frame, gradeOn ? clip.grade : null);
          c.drawImage(staged.canvas, 0, 0, staged.w, staged.h, dx, dy, dw, dh);
        };
      } else drawImage = (c, dx, dy, dw, dh) => c.drawImage(bitmap.img, bitmap.sx, bitmap.sy, bitmap.cw, bitmap.ch, dx, dy, dw, dh);
    }

    // Cache dell'aspetto statico (solo immagini): filtro/effetti/chroma sono costosi e il risultato non
    // cambia da un fotogramma all'altro. Si attiva quando i parametri restano identici per 2 fotogrammi.
    let cssNow = css;
    if (bitmap && clip.kind === 'image' && (css || chroma || needSoftFilter || pixelFx.length || gradeOn) && !pixelFx.some((f) => f.type === 'glitch' || f.type === 'vhs' || f.type === 'wave')) {
      const cw = Math.min(2048, Math.max(2, Math.round(box.w * scale)));
      const ch = Math.min(2048, Math.max(2, Math.round((cw * box.h) / box.w)));
      const key = [clip.mediaId, cw, ch, css, clip.crop.l, clip.crop.t, clip.crop.r, clip.crop.b, chroma ? `${chroma.color}${chroma.similarity}${chroma.smoothness}` : '', pixelFx.map((f) => `${f.type}${f.amount}`).join(','), needSoftFilter ? JSON.stringify(fp) : '', gradeOn ? `${JSON.stringify(clip.grade)}${this.#luts?.[clip.grade.lut.id]?.data?.length ?? ''}` : ''].join('|');
      const stable = this.#lookKeys.get(clip.id) === key;
      this.#lookKeys.set(clip.id, key);
      if (stable) {
        let look = this.#looks.get(clip.id);
        if (look?.key === key) {
          this.lookHits++;
          this.#looks.delete(clip.id);
          this.#looks.set(clip.id, look); // LRU: più recente in coda
        } else {
          look = this.#buildLook(clip.id, key, cw, ch, drawImage, css);
          this.lookBuilds++;
        }
        const cache = look.canvas;
        drawImage = (c, dx, dy, dw, dh) => c.drawImage(cache, 0, 0, cw, ch, dx, dy, dw, dh);
        cssNow = '';
      }
    }

    const target = needLayer ? this.#layerCtx(W, H) : ctx;
    target.save();
    if (!needLayer) {
      target.globalAlpha = opacity;
      target.globalCompositeOperation = BLEND_OP[clip.blend] ?? 'source-over';
    }
    target.translate(W / 2 + x * W, H / 2 + y * H);
    target.rotate((rot * Math.PI) / 180);
    target.scale(scale * (tf.flipX ? -1 : 1) * an.sx, scale * (tf.flipY ? -1 : 1) * an.sy);

    if (an.reveal) this.#clipReveal(target, an.reveal, box);
    if (maskOn && !feather) this.#clipMask(target, mask, box);

    const bx = box.ox - box.w / 2;
    const by = box.oy - box.h / 2;
    if (cssNow) target.filter = cssNow;
    if (drawImage) drawImage(target, bx, by, box.w, box.h);
    else if (procedural) procedural(target);
    if (cssNow) target.filter = 'none';

    // overlay (solo nello strato isolato, con 'source-atop': agiscono dove c'è contenuto)
    if (needLayer) {
      if (glow && drawImage && this.supportsFilter) this.#paintGlow(target, glow, drawImage, box, scale, H, bx, by);
      this.#paintOverlays(target, overlays, box, bx, by);
    }
    if (cutMask) {
      // la maschera copre tutto il fotogramma originale: del ritaglio si usa solo la parte mostrata
      const cr = clip.crop;
      target.save();
      target.globalCompositeOperation = 'destination-in';
      target.imageSmoothingEnabled = true;
      target.imageSmoothingQuality = 'high';
      target.drawImage(cutMask, cr.l * cutMask.width, cr.t * cutMask.height, (1 - cr.l - cr.r) * cutMask.width, (1 - cr.t - cr.b) * cutMask.height, bx, by, box.w, box.h);
      target.restore();
    }
    if (feather) this.#featherMask(target, mask, box, scale);
    target.restore();

    if (needLayer) {
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = BLEND_OP[clip.blend] ?? 'source-over';
      ctx.drawImage(this.#layer.canvas, 0, 0);
      ctx.restore();
    }
    drawOverlayOnly();
  }

  /** Sfondo dietro il clip: copia sfocata che riempie lo schermo (si disegna piccola e si ingrandisce: costa poco) o tinta unita. */
  #drawBackdrop(ctx, bd, bitmap, W, H, opacity) {
    ctx.save();
    ctx.globalAlpha = clamp(opacity, 0, 1);
    ctx.globalCompositeOperation = 'source-over';
    if (bd.mode === 'color') {
      ctx.fillStyle = bd.color;
      ctx.fillRect(0, 0, W, H);
    } else if (bd.mode === 'blur') {
      const sw = Math.max(24, Math.round(W / 8));
      const sh = Math.max(24, Math.round(H / 8));
      this.#backdropCtx ??= makeCanvas(sw, sh).getContext('2d');
      const s = this.#backdropCtx;
      if (s.canvas.width !== sw || s.canvas.height !== sh) {
        s.canvas.width = sw;
        s.canvas.height = sh;
      }
      const k = Math.max(sw / bitmap.cw, sh / bitmap.ch);
      const dw = bitmap.cw * k;
      const dh = bitmap.ch * k;
      s.clearRect(0, 0, sw, sh);
      if (this.supportsFilter) s.filter = `blur(${(1 + (bd.amount / 100) * sw * 0.05).toFixed(2)}px)`;
      s.drawImage(bitmap.img, bitmap.sx, bitmap.sy, bitmap.cw, bitmap.ch, (sw - dw) / 2, (sh - dh) / 2, dw, dh);
      if (this.supportsFilter) s.filter = 'none';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(s.canvas, 0, 0, sw, sh, 0, 0, W, H);
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; // un velo leggero stacca il primo piano dallo sfondo
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  /** Elabora una volta l'aspetto statico del clip in un canvas della dimensione a schermo. */
  #buildLook(id, key, cw, ch, drawImage, css) {
    let look = this.#looks.get(id);
    if (!look) {
      look = { key, canvas: makeCanvas(cw, ch) };
      this.#looks.set(id, look);
      if (this.#looks.size > 10) this.#looks.delete(this.#looks.keys().next().value); // LRU
    } else {
      this.#looks.delete(id);
      this.#looks.set(id, look);
    }
    look.key = key;
    if (look.canvas.width !== cw || look.canvas.height !== ch) {
      look.canvas.width = cw;
      look.canvas.height = ch;
    }
    const g = look.canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, cw, ch);
    if (css) g.filter = css;
    drawImage(g, 0, 0, cw, ch);
    g.filter = 'none';
    return look;
  }

  /** Bagliore: la sfocatura è molto più economica a 1/4 della risoluzione e visivamente equivalente. */
  #paintGlow(target, glow, drawImage, box, scale, H, bx, by) {
    const K = 4;
    const sw = Math.max(2, Math.round((box.w * scale) / K));
    const sh = Math.max(2, Math.round((box.h * scale) / K));
    if (!this.#glow || this.#glow.canvas.width < sw || this.#glow.canvas.height < sh) {
      const canvas = makeCanvas(Math.max(sw, this.#glow?.canvas.width ?? 0), Math.max(sh, this.#glow?.canvas.height ?? 0));
      this.#glow = { canvas, ctx: canvas.getContext('2d') };
    }
    const g = this.#glow.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, sw, sh);
    g.filter = `blur(${(((glow.amount / 100) * H * 0.02 + 1) / K).toFixed(2)}px) brightness(1.25)`;
    drawImage(g, 0, 0, sw, sh);
    g.filter = 'none';
    target.save();
    target.globalAlpha = (glow.amount / 100) * 0.7;
    target.globalCompositeOperation = 'lighter';
    target.imageSmoothingEnabled = true;
    target.drawImage(this.#glow.canvas, 0, 0, sw, sh, bx, by, box.w, box.h);
    target.restore();
  }

  /** Sovrapposizione a tutto canvas (dissolvenza nel nero/bianco delle transizioni). */
  #drawCanvasOverlay(ctx, an, W, H) {
    if (!an.overlay || an.overlay.alpha < 0.002) return;
    ctx.save();
    ctx.globalAlpha = clamp(an.overlay.alpha, 0, 1);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = an.overlay.color;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  #overlaysFor(clip, t, fps) {
    const out = [];
    const a = clip.adjust;
    if (a.vignette > 0) out.push({ type: 'vignette', v: a.vignette / 100 });
    if (a.temperature) out.push({ type: 'wash', color: a.temperature > 0 ? '#ff9628' : '#3c8cff', a: (Math.abs(a.temperature) / 100) * 0.3 });
    if (a.tint) out.push({ type: 'wash', color: a.tint > 0 ? '#ff3cc8' : '#3cff64', a: (Math.abs(a.tint) / 100) * 0.24 });
    let grain = a.grain / 100;
    for (const fx of clip.effects) {
      if (fx.type === 'film-grain') grain = Math.max(grain, fx.amount / 100);
      if (fx.type === 'strobe') {
        const ph = (t * 3) % 1;
        if (ph < 0.12) out.push({ type: 'wash', color: '#ffffff', a: (fx.amount / 100) * 0.9 * (1 - ph / 0.12) });
      }
    }
    if (grain > 0) out.push({ type: 'grain', a: grain * 0.45, seed: Math.floor(t * fps) });
    for (const fx of clip.effects) if (fx.type.startsWith('p-')) out.push({ type: 'particles', id: fx.type.slice(2), t: t - clip.start, amount: fx.amount, seed: hashString(clip.id) });
    return out;
  }

  #paintOverlays(c, overlays, box, bx, by) {
    if (!overlays.length) return;
    c.save();
    c.globalCompositeOperation = 'source-atop';
    for (const o of overlays) {
      if (o.type === 'wash') {
        c.fillStyle = rgba(o.color, o.a);
        c.fillRect(bx, by, box.w, box.h);
      } else if (o.type === 'vignette') {
        const r1 = Math.hypot(box.w, box.h) / 2;
        const g = c.createRadialGradient(box.ox, box.oy, r1 * (1 - o.v) * 0.55, box.ox, box.oy, r1);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, `rgba(0,0,0,${(0.35 + o.v * 0.6).toFixed(3)})`);
        c.fillStyle = g;
        c.fillRect(bx, by, box.w, box.h);
      } else if (o.type === 'particles') {
        this.#paintParticles(c, o, box, bx, by);
      } else if (o.type === 'grain') {
        const tile = this.#noiseTile();
        const pat = c.createPattern(tile, 'repeat');
        if (pat) {
          c.save();
          c.globalAlpha = o.a;
          // sposta la tessera in modo diverso a ogni fotogramma (deterministico)
          c.translate(((o.seed * 37) % 128) - 64, ((o.seed * 71) % 128) - 64);
          c.fillStyle = pat;
          c.fillRect(bx - 128, by - 128, box.w + 256, box.h + 256);
          c.restore();
        }
      }
    }
    c.restore();
  }

  /** Disegna le forme di un campo di particelle dentro il riquadro del clip. */
  #paintParticles(c, o, box, bx, by) {
    const H = box.h;
    const X = (x) => bx + x * box.w;
    const Y = (y) => by + y * H;
    c.save();
    for (const p of particleField(o.id, o.t, { amount: o.amount, seed: o.seed })) {
      c.globalAlpha = Math.max(0, Math.min(1, p.a));
      if (p.k === 'circle') {
        const r = p.r * H;
        if (p.r > 0.02) {
          // cerchio grande = luce sfocata: bordo morbido
          const g = c.createRadialGradient(X(p.x), Y(p.y), r * 0.2, X(p.x), Y(p.y), r);
          g.addColorStop(0, p.color);
          g.addColorStop(1, 'rgba(255,255,255,0)');
          c.fillStyle = g;
        } else c.fillStyle = p.color;
        c.beginPath();
        c.arc(X(p.x), Y(p.y), r, 0, TAU);
        c.fill();
      } else if (p.k === 'line') {
        c.strokeStyle = p.color;
        c.lineWidth = Math.max(1, p.w * H);
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(X(p.x1), Y(p.y1));
        c.lineTo(X(p.x2), Y(p.y2));
        c.stroke();
      } else if (p.k === 'rect') {
        c.save();
        c.translate(X(p.x), Y(p.y));
        c.rotate(p.rot);
        c.fillStyle = p.color;
        c.fillRect((-p.w * H) / 2, (-p.h * H) / 2, p.w * H, p.h * H);
        c.restore();
      } else if (p.k === 'star') {
        c.save();
        c.translate(X(p.x), Y(p.y));
        c.rotate(p.rot);
        c.fillStyle = p.color;
        c.beginPath();
        const R = p.r * H;
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          const rr = i % 2 === 0 ? R : R * 0.22;
          if (i === 0) c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          else c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        c.closePath();
        c.fill();
        c.restore();
      } else if (p.k === 'heart') {
        c.save();
        c.translate(X(p.x), Y(p.y));
        c.fillStyle = p.color;
        c.fill(shapePath('heart', p.size * H, p.size * H));
        c.restore();
      } else if (p.k === 'grad') {
        const g = c.createLinearGradient(X(p.x0), Y(p.y0), X(p.x1), Y(p.y1));
        for (const [pos, col] of p.stops) g.addColorStop(pos, col);
        c.fillStyle = g;
        c.fillRect(bx, by, box.w, box.h);
      }
    }
    c.restore();
  }

  #noiseTile() {
    if (this.#noise) return this.#noise;
    const c = makeCanvas(128, 128);
    const cx = c.getContext('2d');
    const id = cx.createImageData(128, 128);
    fillNoise(id.data, 1234);
    cx.putImageData(id, 0, 0);
    this.#noise = c;
    return c;
  }

  // ---------------------------------------------------------------------------
  // Maschere
  // ---------------------------------------------------------------------------

  #clipReveal(c, rv, box) {
    if (rv.p >= 0.999) return; // tutto scoperto: nessun ritaglio
    const path = new Path2D();
    for (const sh of revealShapes(rv, box.w, box.h)) {
      if (sh.k === 'rect') path.rect(box.ox + sh.x, box.oy + sh.y, sh.w, sh.h);
      else if (sh.k === 'circle') {
        path.moveTo(box.ox + sh.cx + sh.r, box.oy + sh.cy);
        path.arc(box.ox + sh.cx, box.oy + sh.cy, sh.r, 0, TAU);
      } else if (sh.k === 'rrect') {
        if (path.roundRect) path.roundRect(box.ox + sh.x, box.oy + sh.y, sh.w, sh.h, sh.r);
        else path.rect(box.ox + sh.x, box.oy + sh.y, sh.w, sh.h);
      } else {
        sh.pts.forEach(([x, y], k) => (k === 0 ? path.moveTo(box.ox + x, box.oy + y) : path.lineTo(box.ox + x, box.oy + y)));
        path.closePath();
      }
    }
    c.clip(path); // senza forme (p = 0) il ritaglio è vuoto: il clip non si vede ancora
  }

  /** Percorso della maschera (con posizione e rotazione) nel sistema del riquadro del clip. */
  #maskPath(mask, box) {
    const m = Math.min(box.w, box.h);
    const s = Math.max(0.02, mask.size);
    let path;
    if (mask.shape === 'rect' || mask.shape === 'rounded') path = shapePath(mask.shape, box.w * s, box.h * s, mask.roundness);
    else path = shapePath(mask.shape, m * s, m * s);
    const full = new Path2D();
    if (mask.invert) {
      const big = Math.max(box.w, box.h) * 4;
      full.rect(-big, -big, big * 2, big * 2);
    }
    const rot = ((mask.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    full.addPath(path, new DOMMatrix([cos, sin, -sin, cos, box.ox + (mask.x ?? 0) * box.w, box.oy + (mask.y ?? 0) * box.h]));
    return full;
  }

  #clipMask(c, mask, box) {
    c.clip(this.#maskPath(mask, box), mask.invert ? 'evenodd' : 'nonzero');
  }

  /** Maschera con bordi sfumati: tiene del contenuto già disegnato solo ciò che sta dentro la forma sfocata. */
  #featherMask(c, mask, box, scale) {
    c.save();
    c.globalCompositeOperation = 'destination-in';
    c.fillStyle = '#000';
    c.filter = `blur(${Math.max(0.5, mask.feather * Math.min(box.w, box.h) * scale * 0.25).toFixed(2)}px)`;
    c.fill(this.#maskPath(mask, box), mask.invert ? 'evenodd' : 'nonzero');
    c.restore();
  }

  // ---------------------------------------------------------------------------
  // Fase pixel (chroma key, mosaico, glitch…) su canvas di lavoro a crescita monotona
  // ---------------------------------------------------------------------------

  #work(which, w, h) {
    const key = which === 'A' ? '#scratchA' : '#scratchB';
    let s = which === 'A' ? this.#scratchA : this.#scratchB;
    if (!s || s.canvas.width < w || s.canvas.height < h) {
      const nw = Math.max(w, s?.canvas.width ?? 0);
      const nh = Math.max(h, s?.canvas.height ?? 0);
      const canvas = makeCanvas(nw, nh);
      s = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }), key };
      if (which === 'A') this.#scratchA = s;
      else this.#scratchB = s;
    }
    return s;
  }

  #pixelStage(bitmap, box, scale, clip, chroma, fxList, softFilter, t, fps, frame, grade = null) {
    const long = Math.max(box.w, box.h) * scale;
    const k = Math.min(1, PIXEL_CAP / Math.max(1, long), bitmap.cw / Math.max(1, box.w * scale));
    const pw = Math.max(8, Math.round(box.w * scale * Math.min(1, k) || 8));
    const ph = Math.max(8, Math.round((pw * box.h) / box.w));
    const A = this.#work('A', pw, ph);
    const B = this.#work('B', pw, ph);
    const a = A.ctx;
    a.save();
    a.setTransform(1, 0, 0, 1, 0, 0);
    a.globalCompositeOperation = 'source-over';
    a.globalAlpha = 1;
    a.imageSmoothingEnabled = true;
    a.clearRect(0, 0, pw, ph);
    a.drawImage(bitmap.img, bitmap.sx, bitmap.sy, bitmap.cw, bitmap.ch, 0, 0, pw, ph);
    a.restore();

    if (chroma) {
      const id = a.getImageData(0, 0, pw, ph);
      chromaKey(id.data, hexToRgb(chroma.color), { similarity: chroma.similarity, smoothness: chroma.smoothness });
      a.putImageData(id, 0, 0);
    }
    for (const fx of fxList) this.#applyPixelFx(A, B, fx, pw, ph, frame);
    if (softFilter) {
      if (!isIdentityParams(softFilter)) {
        const id = a.getImageData(0, 0, pw, ph);
        applyFilterParams(id.data, softFilter);
        a.putImageData(id, 0, 0);
      }
      if (softFilter.blur > 0.5) this.#softBlur(A, B, pw, ph, softFilter.blur * (pw / Math.max(1, box.w * scale)));
    }
    if (grade) {
      const id = a.getImageData(0, 0, pw, ph);
      applyGrade(id.data, pw, ph, grade, grade.lut.id ? this.#lutFor(grade.lut.id) : null);
      a.putImageData(id, 0, 0);
    }
    return { canvas: A.canvas, w: pw, h: ph };
  }

  #applyPixelFx(A, B, fx, pw, ph, frame) {
    const a = A.ctx;
    const b = B.ctx;
    const k = fx.amount / 100;
    const copyToB = () => {
      b.save();
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.globalCompositeOperation = 'copy';
      b.drawImage(A.canvas, 0, 0, pw, ph, 0, 0, pw, ph);
      b.restore();
    };
    const split = (shift) => {
      const src = a.getImageData(0, 0, pw, ph);
      const dst = a.createImageData(pw, ph);
      rgbSplit(src.data, dst.data, pw, ph, shift);
      a.putImageData(dst, 0, 0);
    };
    switch (fx.type) {
      case 'pixelate': {
        const block = Math.max(2, Math.round(3 + k * Math.min(pw, ph) * 0.08));
        const sw = Math.max(1, Math.round(pw / block));
        const sh = Math.max(1, Math.round(ph / block));
        b.save();
        b.setTransform(1, 0, 0, 1, 0, 0);
        b.globalCompositeOperation = 'copy';
        b.imageSmoothingEnabled = true;
        b.drawImage(A.canvas, 0, 0, pw, ph, 0, 0, sw, sh);
        b.restore();
        a.save();
        a.setTransform(1, 0, 0, 1, 0, 0);
        a.globalCompositeOperation = 'copy';
        a.imageSmoothingEnabled = false;
        a.drawImage(B.canvas, 0, 0, sw, sh, 0, 0, pw, ph);
        a.restore();
        break;
      }
      case 'mirror':
        copyToB();
        a.save();
        a.setTransform(1, 0, 0, 1, 0, 0);
        a.translate(pw, 0);
        a.scale(-1, 1);
        a.drawImage(B.canvas, 0, 0, pw / 2, ph, 0, 0, pw / 2, ph);
        a.restore();
        break;
      case 'rgb-split':
        split(Math.max(1, k * pw * 0.012));
        break;
      case 'glitch': {
        const slices = glitchSlices(ph, fx.amount, frame);
        if (slices.length) {
          copyToB();
          a.save();
          a.setTransform(1, 0, 0, 1, 0, 0);
          for (const s of slices) {
            const dx = Math.round(s.dx * pw);
            a.clearRect(0, s.y, pw, s.h);
            a.drawImage(B.canvas, 0, s.y, pw, s.h, dx, s.y, pw, s.h);
          }
          a.restore();
          split(Math.max(1, k * pw * 0.015));
        }
        break;
      }
      case 'vhs': {
        split(Math.max(1, k * pw * 0.006));
        a.save();
        a.setTransform(1, 0, 0, 1, 0, 0);
        a.globalCompositeOperation = 'source-atop';
        a.fillStyle = `rgba(0,0,0,${(0.12 + 0.2 * k).toFixed(3)})`;
        const step = Math.max(2, Math.round(ph / 180));
        for (let y = 0; y < ph; y += step * 2) a.fillRect(0, y, pw, step);
        // banda di disturbo che scorre
        const band = ((frame * 3) % (ph + 40)) - 20;
        a.fillStyle = `rgba(255,255,255,${(0.05 * k).toFixed(3)})`;
        a.fillRect(0, band, pw, Math.max(2, ph * 0.04));
        a.restore();
        break;
      }
      case 'cartoon':
      case 'sketch':
      case 'halftone':
      case 'wave':
      case 'swirl':
      case 'bulge':
      case 'pinch':
      case 'zoom-blur': {
        const src = a.getImageData(0, 0, pw, ph);
        const dst = a.createImageData(pw, ph);
        if (fx.type === 'cartoon') cartoon(src.data, dst.data, pw, ph, fx.amount);
        else if (fx.type === 'sketch') sketch(src.data, dst.data, pw, ph, fx.amount);
        else if (fx.type === 'halftone') halftone(src.data, dst.data, pw, ph, 3 + k * 8);
        else if (fx.type === 'wave') wave(src.data, dst.data, pw, ph, k * ph * 0.05, 3, frame * 0.18);
        else if (fx.type === 'swirl') swirl(src.data, dst.data, pw, ph, k * 4);
        else if (fx.type === 'bulge') bulge(src.data, dst.data, pw, ph, k * 0.9);
        else if (fx.type === 'pinch') bulge(src.data, dst.data, pw, ph, -k * 0.9);
        else zoomBlur(src.data, dst.data, pw, ph, k);
        a.putImageData(dst, 0, 0);
        break;
      }
      case 'poster':
      case 'duotone':
      case 'duotone-teal':
      case 'crt': {
        const id = a.getImageData(0, 0, pw, ph);
        if (fx.type === 'poster') posterize(id.data, 7 - k * 5);
        else if (fx.type === 'crt') scanlines(id.data, pw, ph, k, Math.max(1, Math.round(ph / 220)));
        else duotone(id.data, DUOTONE[fx.type][0], DUOTONE[fx.type][1], k);
        a.putImageData(id, 0, 0);
        break;
      }
      default:
    }
  }

  /** Sfocatura approssimata per browser senza ctx.filter: riduce e riallarga. */
  #softBlur(A, B, pw, ph, px) {
    const f = Math.max(1, Math.min(16, Math.round(px / 1.5)));
    if (f <= 1) return;
    const sw = Math.max(1, Math.round(pw / f));
    const sh = Math.max(1, Math.round(ph / f));
    const b = B.ctx;
    const a = A.ctx;
    b.save();
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'copy';
    b.imageSmoothingEnabled = true;
    b.drawImage(A.canvas, 0, 0, pw, ph, 0, 0, sw, sh);
    b.restore();
    a.save();
    a.setTransform(1, 0, 0, 1, 0, 0);
    a.globalCompositeOperation = 'copy';
    a.imageSmoothingEnabled = true;
    a.drawImage(B.canvas, 0, 0, sw, sh, 0, 0, pw, ph);
    a.restore();
  }

  // ---------------------------------------------------------------------------
  // Strati di supporto
  // ---------------------------------------------------------------------------

  #layerCtx(W, H) {
    if (!this.#layer || this.#layer.canvas.width !== W || this.#layer.canvas.height !== H) {
      const canvas = makeCanvas(W, H);
      this.#layer = { canvas, ctx: canvas.getContext('2d') };
    }
    const c = this.#layer.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, W, H);
    return c;
  }

  #snapshot(ctx, W, H) {
    if (!this.#snap || this.#snap.canvas.width !== W || this.#snap.canvas.height !== H) {
      const canvas = makeCanvas(W, H);
      this.#snap = { canvas, ctx: canvas.getContext('2d') };
    }
    const c = this.#snap.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'copy';
    c.drawImage(ctx.canvas, 0, 0);
    return this.#snap.canvas;
  }

  // ---------------------------------------------------------------------------
  // Contenuti procedurali
  // ---------------------------------------------------------------------------

  #drawPlaceholder(c, w, h) {
    c.fillStyle = '#2b2f3a';
    c.fillRect(-w / 2, -h / 2, w, h);
    c.strokeStyle = '#ef4444';
    c.lineWidth = Math.max(2, Math.min(w, h) * 0.01);
    c.strokeRect(-w / 2, -h / 2, w, h);
    c.beginPath();
    c.moveTo(-w / 2, -h / 2);
    c.lineTo(w / 2, h / 2);
    c.moveTo(w / 2, -h / 2);
    c.lineTo(-w / 2, h / 2);
    c.stroke();
    c.fillStyle = '#e5e7eb';
    c.font = `600 ${Math.max(12, Math.min(w, h) * 0.07)}px sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('Media mancante', 0, 0);
  }

  #drawShape(c, clip, box, W, H) {
    const s = clip.shape;
    let w = box.w;
    let h = box.h;
    if (s.type === 'line') {
      c.fillStyle = s.fill;
      c.fillRect(-w / 2, -h / 2, w, h);
      return;
    }
    const path = shapePath(s.full ? 'rect' : s.type, w, h, 0.25);
    c.fillStyle = s.fill;
    c.fill(path);
    if (s.strokeWidth > 0) {
      c.lineWidth = s.strokeWidth * H;
      c.strokeStyle = s.stroke;
      c.lineJoin = 'round';
      c.stroke(path);
    }
  }

  #drawSticker(c, clip, H) {
    const size = clip.sticker.size * H;
    c.font = `${size}px ${EMOJI_FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#000';
    c.fillText(clip.sticker.emoji, 0, size * 0.05);
  }

  // ---- testo ------------------------------------------------------------------

  #fontOf(tx, fs) {
    return `${tx.italic ? 'italic ' : ''}${tx.weight} ${fs}px ${tx.font}`;
  }

  #layoutText(tx, H, W) {
    const key = [W, H, tx.content, tx.font, tx.size, tx.weight, tx.italic, tx.uppercase, tx.boxWidth, tx.letterSpacing, tx.lineHeight, tx.bg.enabled ? tx.bg.padding : 0].join('|');
    const hit = this.#textCache.get(key);
    if (hit) return hit;
    const m = this.#measure;
    const fs = (tx.size / 100) * H;
    m.font = this.#fontOf(tx, fs);
    if (this.supportsLetterSpacing) m.letterSpacing = `${tx.letterSpacing * fs}px`;
    const content = tx.uppercase ? tx.content.toUpperCase() : tx.content;
    const maxW = Math.max(fs, tx.boxWidth * W);
    const lines = [];
    for (const para of content.split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push('');
        continue;
      }
      let cur = '';
      for (let word of words) {
        // parole più larghe della scatola: spezzate per caratteri
        while (m.measureText(word).width > maxW && word.length > 1) {
          let n = word.length - 1;
          while (n > 1 && m.measureText(word.slice(0, n)).width > maxW) n--;
          if (cur) {
            lines.push(cur);
            cur = '';
          }
          lines.push(word.slice(0, n));
          word = word.slice(n);
        }
        const test = cur ? `${cur} ${word}` : word;
        if (m.measureText(test).width <= maxW || !cur) cur = test;
        else {
          lines.push(cur);
          cur = word;
        }
      }
      lines.push(cur);
    }
    const widths = lines.map((l) => m.measureText(l).width);
    const lineH = fs * tx.lineHeight;
    const textW = Math.max(fs * 0.5, ...widths);
    const textH = Math.max(1, lines.length) * lineH;
    const pad = tx.bg.enabled ? tx.bg.padding * fs : 0;
    const layout = { lines, widths, fs, lineH, textW, textH, pad, w: textW + pad * 2, h: textH + pad * 2, font: this.#fontOf(tx, fs) };
    if (this.#textCache.size > 200) this.#textCache.clear();
    this.#textCache.set(key, layout);
    return layout;
  }

  #drawText(c, clip, L, chars, scale, H, karaoke = 0) {
    const tx = clip.text;
    if (tx.bg.enabled) {
      c.fillStyle = rgba(tx.bg.color, tx.bg.opacity);
      const r = tx.bg.radius * L.fs;
      c.beginPath();
      if (c.roundRect) c.roundRect(-L.w / 2, -L.h / 2, L.w, L.h, r);
      else c.rect(-L.w / 2, -L.h / 2, L.w, L.h);
      c.fill();
    }
    c.font = L.font;
    if (this.supportsLetterSpacing) c.letterSpacing = `${tx.letterSpacing * L.fs}px`;
    c.textBaseline = 'middle';
    c.textAlign = tx.align === 'left' ? 'left' : tx.align === 'right' ? 'right' : 'center';
    const ax = tx.align === 'left' ? -L.textW / 2 : tx.align === 'right' ? L.textW / 2 : 0;
    const total = L.lines.reduce((s, l) => s + l.length, 0);
    let budget = chars >= 1 ? Infinity : Math.floor(chars * total + 1e-6);
    const kTotal = karaoke > 0 ? L.lines.reduce((s, l) => s + l.replace(/\s+/g, '').length, 0) : 0;
    let kLeft = Math.floor(karaoke * kTotal + 1e-6);
    const sw = tx.stroke.width * L.fs;
    const unit = H / 1080;
    for (let i = 0; i < L.lines.length; i++) {
      let line = L.lines[i];
      if (budget <= 0) break;
      if (line.length > budget) line = line.slice(0, budget);
      budget -= line.length;
      const y = -L.textH / 2 + L.lineH * (i + 0.5);
      if (sw > 0) {
        c.lineWidth = sw;
        c.lineJoin = 'round';
        c.miterLimit = 2;
        c.strokeStyle = tx.stroke.color;
        c.strokeText(line, ax, y);
      }
      if (tx.shadow.opacity > 0 && (tx.shadow.blur > 0 || tx.shadow.x || tx.shadow.y)) {
        c.shadowColor = rgba(tx.shadow.color, tx.shadow.opacity);
        c.shadowBlur = tx.shadow.blur * unit * scale;
        c.shadowOffsetX = tx.shadow.x * unit * scale;
        c.shadowOffsetY = tx.shadow.y * unit * scale;
      }
      c.fillStyle = tx.color;
      c.fillText(line, ax, y);
      // karaoke: le lettere già «cantate» si ridisegnano nel colore di evidenza, partendo dall'inizio della riga
      if (kLeft > 0) {
        const lw = L.widths[i];
        const inLine = Math.min(kLeft, line.replace(/\s+/g, '').length);
        kLeft -= inLine;
        const part = line.slice(0, prefixLength(line, inLine));
        if (part) {
          const x0 = tx.align === 'left' ? ax : tx.align === 'right' ? ax - lw : ax - lw / 2;
          c.textAlign = 'left';
          c.fillStyle = tx.karaoke.color;
          c.fillText(part, x0, y);
          c.textAlign = tx.align === 'left' ? 'left' : tx.align === 'right' ? 'right' : 'center';
        }
      }
      c.shadowColor = 'transparent';
      c.shadowBlur = 0;
      c.shadowOffsetX = 0;
      c.shadowOffsetY = 0;
      if (tx.underline) {
        const lw = L.widths[i];
        const x0 = tx.align === 'left' ? ax : tx.align === 'right' ? ax - lw : ax - lw / 2;
        c.fillStyle = tx.color;
        c.fillRect(x0, y + L.fs * 0.42, lw, Math.max(1, L.fs * 0.06));
      }
    }
  }
}
