// Cataloghi dichiarativi: formati, filtri, effetti, fusioni, maschere, font, adesivi.
// Solo dati: nessuna dipendenza dal DOM.

export const ASPECTS = [
  { id: '16:9', label: '16:9 · YouTube', width: 1920, height: 1080 },
  { id: '9:16', label: '9:16 · TikTok / Reel / Short', width: 1080, height: 1920 },
  { id: '1:1', label: '1:1 · Quadrato', width: 1080, height: 1080 },
  { id: '4:5', label: '4:5 · Instagram feed', width: 1080, height: 1350 },
  { id: '4:3', label: '4:3 · Classico', width: 1440, height: 1080 },
  { id: '3:4', label: '3:4 · Verticale', width: 1080, height: 1440 },
  { id: '21:9', label: '21:9 · Cinema', width: 2560, height: 1080 },
];

export const FPS_OPTIONS = [24, 25, 30, 50, 60];
/** Lato corto dell'esportazione. */
export const EXPORT_SIZES = [480, 720, 1080, 1440, 2160];

/** Unità neutre dei filtri CSS: 1 = nessun effetto (0 per sepia/grayscale/invert/hue). */
export const FILTER_IDENTITY = { brightness: 1, contrast: 1, saturate: 1, sepia: 0, grayscale: 0, hue: 0, invert: 0 };

export const FILTERS = [
  { id: 'none', label: 'Nessuno', params: {} },
  { id: 'vivid', label: 'Vivido', params: { saturate: 1.45, contrast: 1.1 } },
  { id: 'cinema', label: 'Cinema', params: { contrast: 1.18, saturate: 0.85, sepia: 0.12, hue: -8, brightness: 0.96 } },
  { id: 'warm', label: 'Caldo', params: { sepia: 0.28, saturate: 1.25, brightness: 1.04 } },
  { id: 'cold', label: 'Freddo', params: { hue: 14, saturate: 1.1, brightness: 1.02, contrast: 1.05 } },
  { id: 'vintage', label: 'Vintage', params: { sepia: 0.5, contrast: 0.9, saturate: 1.2, brightness: 1.05, hue: -10 } },
  { id: 'noir', label: 'Noir', params: { grayscale: 1, contrast: 1.35, brightness: 0.92 } },
  { id: 'bw', label: 'Bianco e nero', params: { grayscale: 1 } },
  { id: 'fade', label: 'Sbiadito', params: { contrast: 0.82, brightness: 1.12, saturate: 0.78 } },
  { id: 'dramatic', label: 'Drammatico', params: { contrast: 1.4, saturate: 0.9, brightness: 0.88 } },
  { id: 'pastel', label: 'Pastello', params: { saturate: 0.7, brightness: 1.14, contrast: 0.9 } },
  { id: 'sunset', label: 'Tramonto', params: { sepia: 0.35, hue: -18, saturate: 1.5, contrast: 1.05 } },
  { id: 'mint', label: 'Menta', params: { hue: 60, saturate: 1.1, brightness: 1.05 } },
  { id: 'neon', label: 'Neon', params: { saturate: 1.9, contrast: 1.25, hue: 25, brightness: 0.95 } },
  { id: 'negative', label: 'Negativo', params: { invert: 1 } },
];

export const BLEND_MODES = [
  { id: 'normal', label: 'Normale', op: 'source-over' },
  { id: 'multiply', label: 'Moltiplica', op: 'multiply' },
  { id: 'screen', label: 'Scherma', op: 'screen' },
  { id: 'overlay', label: 'Sovrapponi', op: 'overlay' },
  { id: 'darken', label: 'Scurisci', op: 'darken' },
  { id: 'lighten', label: 'Schiarisci', op: 'lighten' },
  { id: 'color-dodge', label: 'Colore brucia-chiaro', op: 'color-dodge' },
  { id: 'soft-light', label: 'Luce soffusa', op: 'soft-light' },
  { id: 'hard-light', label: 'Luce intensa', op: 'hard-light' },
  { id: 'difference', label: 'Differenza', op: 'difference' },
  { id: 'add', label: 'Somma', op: 'lighter' },
];

export const MASKS = [
  { id: 'none', label: 'Nessuna' },
  { id: 'circle', label: 'Cerchio' },
  { id: 'rect', label: 'Rettangolo' },
  { id: 'rounded', label: 'Arrotondato' },
  { id: 'heart', label: 'Cuore' },
  { id: 'star', label: 'Stella' },
  { id: 'triangle', label: 'Triangolo' },
];

/**
 * Effetti per clip. `stage` indica dove agiscono nella pipeline di rendering:
 *  transform = modificano la trasformazione; filter = filtro CSS; pixel = elaborano i pixel;
 *  overlay = disegnano sopra il clip.
 */
export const EFFECTS = [
  { id: 'shake', label: 'Tremore', stage: 'transform', amount: 40 },
  { id: 'pulse', label: 'Pulsazione', stage: 'transform', amount: 40 },
  { id: 'blur', label: 'Sfocatura', stage: 'filter', amount: 40 },
  { id: 'glow', label: 'Bagliore', stage: 'overlay', amount: 50 },
  { id: 'pixelate', label: 'Mosaico', stage: 'pixel', amount: 40 },
  { id: 'rgb-split', label: 'Separazione RGB', stage: 'pixel', amount: 40 },
  { id: 'glitch', label: 'Glitch', stage: 'pixel', amount: 50 },
  { id: 'mirror', label: 'Specchio', stage: 'pixel', amount: 100 },
  { id: 'vhs', label: 'VHS', stage: 'pixel', amount: 60 },
  { id: 'film-grain', label: 'Grana pellicola', stage: 'overlay', amount: 50 },
  { id: 'strobe', label: 'Stroboscopio', stage: 'overlay', amount: 60 },
];

export const FONTS = [
  { id: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', label: 'Sistema' },
  { id: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { id: '"Helvetica Neue", Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { id: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { id: '"Trebuchet MS", sans-serif', label: 'Trebuchet' },
  { id: 'Impact, "Arial Black", sans-serif', label: 'Impact' },
  { id: 'Georgia, serif', label: 'Georgia' },
  { id: '"Times New Roman", Times, serif', label: 'Times' },
  { id: '"Courier New", Courier, monospace', label: 'Courier' },
  { id: '"Comic Sans MS", "Comic Neue", cursive', label: 'Comic' },
  { id: 'serif', label: 'Serif generico' },
  { id: 'monospace', label: 'Monospazio generico' },
];

/** Stili di testo pronti (come nelle gallerie di CapCut). */
export const TEXT_PRESETS = [
  { id: 'title', label: 'Titolo', text: { content: 'Il tuo titolo', size: 11, weight: 800, color: '#ffffff', shadow: { blur: 12, x: 0, y: 4, color: '#000000', opacity: 0.55 } } },
  { id: 'subtitle', label: 'Sottotitolo', text: { content: 'Sottotitolo', size: 6, weight: 600, color: '#ffffff', bg: { enabled: true, color: '#000000', opacity: 0.55, padding: 0.35, radius: 0.25 } }, y: 0.32 },
  { id: 'outline', label: 'Contorno', text: { content: 'CONTORNO', size: 12, weight: 900, color: '#ffffff', stroke: { width: 0.14, color: '#111111' }, uppercase: true } },
  { id: 'neon', label: 'Neon', text: { content: 'Neon', size: 12, weight: 700, color: '#ff4fd8', shadow: { blur: 28, x: 0, y: 0, color: '#ff4fd8', opacity: 1 } } },
  { id: 'gold', label: 'Oro', text: { content: 'Premium', size: 11, weight: 800, color: '#ffd45a', stroke: { width: 0.06, color: '#7a4b00' }, shadow: { blur: 8, x: 0, y: 3, color: '#000000', opacity: 0.5 } } },
  { id: 'label', label: 'Etichetta', text: { content: 'Etichetta', size: 6.5, weight: 700, color: '#111111', bg: { enabled: true, color: '#ffe14d', opacity: 1, padding: 0.4, radius: 0.15 } } },
  { id: 'retro', label: 'Retrò', text: { content: 'Retro', size: 12, weight: 800, italic: true, color: '#ff9a3c', stroke: { width: 0.1, color: '#5a1a00' }, shadow: { blur: 0, x: 6, y: 6, color: '#2b0a3d', opacity: 1 }, font: 'Georgia, serif' } },
  { id: 'typewriter', label: 'Macchina da scrivere', text: { content: 'Scrivo…', size: 7, weight: 500, color: '#f4f4f4', font: '"Courier New", Courier, monospace' }, animIn: 'typewriter' },
  { id: 'lower-third', label: 'Terzo inferiore', text: { content: 'Nome Cognome', size: 6, weight: 700, color: '#ffffff', align: 'left', boxWidth: 0.6, bg: { enabled: true, color: '#0f1d3a', opacity: 0.85, padding: 0.5, radius: 0.1 } }, y: 0.3, animIn: 'slide-from-left' },
  { id: 'cinema', label: 'Cinema', text: { content: 'CAPITOLO UNO', size: 7, weight: 300, color: '#f0f0f0', uppercase: true, letterSpacing: 0.35, shadow: { blur: 10, x: 0, y: 2, color: '#000000', opacity: 0.6 } }, animIn: 'fade' },
  { id: 'comic', label: 'Fumetto', text: { content: 'BOOM!', size: 14, weight: 900, italic: true, color: '#ffe14d', uppercase: true, font: 'Impact, "Arial Black", sans-serif', stroke: { width: 0.12, color: '#1a1a1a' }, shadow: { blur: 0, x: 6, y: 6, color: '#000000', opacity: 1 } }, animIn: 'pop' },
  { id: 'minimal', label: 'Minimale', text: { content: 'Minimal', size: 9, weight: 300, color: '#ffffff', letterSpacing: 0.08 } },
  { id: 'quote', label: 'Citazione', text: { content: '«Una frase da ricordare»', size: 7, weight: 400, italic: true, color: '#fafafa', font: 'Georgia, serif', lineHeight: 1.35, bg: { enabled: true, color: '#000000', opacity: 0.45, padding: 0.6, radius: 0.15 } }, animIn: 'rise' },
  { id: 'pill', label: 'Pillola', text: { content: 'NUOVO', size: 5.5, weight: 800, color: '#ffffff', uppercase: true, letterSpacing: 0.12, bg: { enabled: true, color: '#e63946', opacity: 1, padding: 0.55, radius: 1 } }, animIn: 'pop', loop: { type: 'pulse', speed: 1.2, amount: 40 } },
  { id: 'ice', label: 'Ghiaccio', text: { content: 'Ghiaccio', size: 12, weight: 800, color: '#dff6ff', stroke: { width: 0.05, color: '#3aa0d8' }, shadow: { blur: 22, x: 0, y: 0, color: '#6fd0ff', opacity: 0.9 } } },
  { id: 'fire', label: 'Fuoco', text: { content: 'FUOCO', size: 13, weight: 900, color: '#ffb02e', uppercase: true, stroke: { width: 0.06, color: '#8a1c00' }, shadow: { blur: 26, x: 0, y: 0, color: '#ff4d00', opacity: 1 } }, loop: { type: 'wiggle', speed: 3, amount: 25 } },
  { id: 'glitch-title', label: 'Titolo digitale', text: { content: 'SYSTEM_ON', size: 9, weight: 700, color: '#6dffb3', uppercase: true, font: '"Courier New", Courier, monospace', shadow: { blur: 10, x: 0, y: 0, color: '#00ff88', opacity: 0.9 } }, animIn: 'typewriter', loop: { type: 'blink', speed: 0.8, amount: 30 } },
  { id: 'handwriting', label: 'A mano', text: { content: 'Scritto a mano', size: 9, weight: 400, color: '#ffffff', font: '"Brush Script MT", "Segoe Script", cursive', shadow: { blur: 6, x: 0, y: 2, color: '#000000', opacity: 0.5 } }, animIn: 'wipe-from-left' },
  { id: 'bubble', label: 'Fumetto parlato', text: { content: 'Ciao!', size: 8, weight: 700, color: '#222222', bg: { enabled: true, color: '#ffffff', opacity: 1, padding: 0.7, radius: 0.6 } }, animIn: 'pop', loop: { type: 'float', speed: 0.6, amount: 50 } },
  { id: 'stamp', label: 'Timbro', text: { content: 'APPROVATO', size: 8, weight: 900, color: '#d62828', uppercase: true, letterSpacing: 0.1, stroke: { width: 0.04, color: '#d62828' }, bg: { enabled: false, color: '#000000', opacity: 0, padding: 0.3, radius: 0.1 } }, animIn: 'zoom-out' },
  { id: 'countdown', label: 'Conto alla rovescia', text: { content: '3', size: 30, weight: 900, color: '#ffffff', stroke: { width: 0.05, color: '#111111' } }, animIn: 'zoom-out', loop: { type: 'heartbeat', speed: 1, amount: 70 } },
  { id: 'news', label: 'Notizia', text: { content: 'ULTIMA ORA', size: 5.5, weight: 800, color: '#ffffff', uppercase: true, align: 'left', boxWidth: 0.7, bg: { enabled: true, color: '#c1121f', opacity: 1, padding: 0.5, radius: 0.05 } }, y: -0.38, animIn: 'wipe-from-left' },
];

export const SHAPES = [
  { id: 'rect', label: 'Rettangolo' },
  { id: 'rounded', label: 'Rettangolo arrotondato' },
  { id: 'circle', label: 'Cerchio' },
  { id: 'triangle', label: 'Triangolo' },
  { id: 'star', label: 'Stella' },
  { id: 'heart', label: 'Cuore' },
  { id: 'arrow', label: 'Freccia' },
  { id: 'line', label: 'Linea' },
];

export const EMOJI_GROUPS = [
  { id: 'faces', label: 'Facce', items: '😀 😁 😂 🤣 😊 😍 😘 😎 🤩 🥳 😭 😡 🤯 😱 🤔 🙄 😴 🤗 😇 🥺'.split(' ') },
  { id: 'gestures', label: 'Gesti', items: '👍 👎 👏 🙌 🙏 💪 ✌️ 🤞 👌 👋 🤝 ✋ 👀 🫶 ☝️ 👉'.split(' ') },
  { id: 'symbols', label: 'Simboli', items: '❤️ 🧡 💛 💚 💙 💜 🖤 💔 ✨ ⭐ 🔥 💥 💯 ✅ ❌ ❗ ❓ ⚡ 🎯 🚀'.split(' ') },
  { id: 'party', label: 'Festa', items: '🎉 🎊 🎁 🎂 🎈 🥂 🍾 🏆 🥇 🎵 🎶 🎬 📸 🎤 🎧 🪩'.split(' ') },
  { id: 'nature', label: 'Natura', items: '☀️ 🌙 ⭐ 🌈 ☁️ ⚡ ❄️ 🌊 🌸 🌻 🌴 🍀 🔥 🌍 🐶 🐱'.split(' ') },
  { id: 'food', label: 'Cibo', items: '🍕 🍔 🍟 🌮 🍣 🍝 🍩 🍪 🍫 🍦 ☕ 🍺 🍷 🍎 🍌 🍓'.split(' ') },
  { id: 'arrows', label: 'Frecce', items: '⬆️ ⬇️ ⬅️ ➡️ ↗️ ↘️ 🔄 🔁 ▶️ ⏸️ ⏩ ⏪ ➕ ➖ ✔️ 💬'.split(' ') },
];

export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 8;
