// Pannello sinistro: libreria di media, testo, elementi, filtri, effetti, transizioni, sottotitoli.

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { prefs } from './prefs.js';
import { formatDuration, debounce } from '../core/util.js';
import { findClip, allClips } from '../core/timeline.js';
import { EFFECTS, EMOJI_GROUPS, FILTERS, SHAPES, TEXT_PRESETS } from '../core/presets.js';
import { ANIMATIONS, transitionGroups } from '../core/animations.js';
import { filterParamsFor } from '../engine/renderer.js';
import { applyFilterParams, filterCss } from '../engine/pixel-fx.js';
import { ACCEPT } from '../engine/media-import.js';
import { createClip } from '../core/project.js';

const TABS = [
  { id: 'media', label: 'Media', icon: 'folder' },
  { id: 'text', label: 'Testo', icon: 'type' },
  { id: 'elements', label: 'Elementi', icon: 'smile' },
  { id: 'filters', label: 'Filtri', icon: 'sliders' },
  { id: 'effects', label: 'Effetti', icon: 'sparkles' },
  { id: 'transitions', label: 'Transizioni', icon: 'transition' },
  { id: 'subtitles', label: 'Sottotitoli', icon: 'captions' },
];

const SWATCHES = ['#000000', '#ffffff', '#ff3b5c', '#ff9f1c', '#ffd60a', '#34c759', '#0a84ff', '#bf5af2', '#1c1c1e', '#8e8e93'];

function shapeIcon(type) {
  const svg = (inner) => {
    const span = document.createElement('span');
    span.className = 'shape-ico';
    span.innerHTML = `<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">${inner}</svg>`;
    return span;
  };
  const star = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? 4.8 : 11;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return `${(12 + Math.cos(a) * r).toFixed(2)},${(12 + Math.sin(a) * r).toFixed(2)}`;
  }).join(' ');
  return svg(
    {
      rect: '<rect x="3" y="5" width="18" height="14"/>',
      rounded: '<rect x="3" y="5" width="18" height="14" rx="5"/>',
      circle: '<circle cx="12" cy="12" r="9"/>',
      triangle: '<polygon points="12 3 22 21 2 21"/>',
      star: `<polygon points="${star}"/>`,
      heart: '<path d="M12 21C5 15.5 2 12 2 8.2 2 5.3 4.2 3.5 6.6 3.5c2 0 3.7 1.1 5.4 3.4 1.7-2.3 3.4-3.4 5.4-3.4C19.8 3.5 22 5.3 22 8.2 22 12 19 15.5 12 21z"/>',
      arrow: '<polygon points="2 9 14 9 14 4 22 12 14 20 14 15 2 15"/>',
      line: '<rect x="2" y="10.5" width="20" height="3" rx="1.5"/>',
    }[type] ?? '',
  );
}

export class Library {
  #tab = 'media';
  #filter = 'all';
  #mediaSig = '';
  #filterThumbs = [];

  constructor(app) {
    this.app = app;
    this.body = h('div', { class: 'lib-body', role: 'tabpanel' });
    this.rail = h('div', { class: 'lib-rail', role: 'tablist', 'aria-label': 'Libreria', 'aria-orientation': 'vertical' },
      TABS.map((t) => h('button', { class: 'rail-btn', type: 'button', role: 'tab', id: `tab-${t.id}`, 'data-tab': t.id, title: t.label, onClick: () => this.show(t.id) }, icon(t.icon, 20), h('span', {}, t.label))));
    this.el = h('aside', { class: 'library', 'aria-label': 'Libreria' }, this.rail, this.body);
    this.show(prefs.get('libTab', 'media'));

    const refresh = debounce(() => this.#onProject(), 60);
    app.store.on('change', refresh);
    app.pool.on('info', refresh);
    app.selection.on('change', () => this.#onSelection());
    const thumbs = debounce(() => this.#paintFilterThumbs(), 180);
    app.player.on('frame', () => this.#tab === 'filters' && thumbs());
    // trascinare file dal sistema sulla libreria = importa
    this.el.addEventListener('dragover', (e) => {
      if ([...(e.dataTransfer?.types ?? [])].includes('Files')) {
        e.preventDefault();
        this.el.classList.add('drop');
      }
    });
    this.el.addEventListener('dragleave', () => this.el.classList.remove('drop'));
    this.el.addEventListener('drop', (e) => {
      this.el.classList.remove('drop');
      if (e.dataTransfer?.files?.length) {
        e.preventDefault();
        app.actions.importFiles([...e.dataTransfer.files]);
        this.show('media');
      }
    });
  }

  show(id) {
    if (!TABS.some((t) => t.id === id)) id = 'media';
    this.#tab = id;
    prefs.set('libTab', id);
    for (const b of this.rail.children) {
      const on = b.dataset.tab === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    this.body.setAttribute('aria-labelledby', `tab-${id}`);
    clear(this.body);
    this.#mediaSig = '';
    this.#filterThumbs = [];
    const build = { media: () => this.#mediaTab(), text: () => this.#textTab(), elements: () => this.#elementsTab(), filters: () => this.#filtersTab(), effects: () => this.#effectsTab(), transitions: () => this.#transitionsTab(), subtitles: () => this.#subtitlesTab() }[id];
    this.body.append(build());
    this.#onSelection();
    if (id === 'filters') this.#paintFilterThumbs();
  }

  #onProject() {
    if (this.#tab === 'media') this.#renderMediaGrid();
    else if (this.#tab === 'subtitles') this.#renderSubtitleList();
    this.#onSelection();
  }

  #selectedClip() {
    const { store, selection } = this.app;
    return selection.size ? findClip(store.project, selection.primary)?.clip ?? null : null;
  }

  #onSelection() {
    const clip = this.#selectedClip();
    if (this.#tab === 'filters') for (const c of this.body.querySelectorAll('[data-filter]')) c.classList.toggle('on', !!clip && (clip.filter?.id ?? 'none') === c.dataset.filter);
    if (this.#tab === 'effects') for (const c of this.body.querySelectorAll('[data-effect]')) c.classList.toggle('on', !!clip && clip.effects.some((e) => e.type === c.dataset.effect));
    if (this.#tab === 'transitions') for (const c of this.body.querySelectorAll('[data-transition]')) c.classList.toggle('on', !!clip && (clip.transition?.type ?? 'none') === c.dataset.transition);
  }

  // ---------------------------------------------------------------------------
  // Media
  // ---------------------------------------------------------------------------

  #mediaTab() {
    const a = this.app;
    const file = h('input', { type: 'file', multiple: true, accept: ACCEPT, hidden: true, id: 'file-input', 'aria-label': 'Seleziona file da importare' });
    file.addEventListener('change', () => {
      if (file.files?.length) a.actions.importFiles([...file.files]);
      file.value = '';
    });
    this.recBtn = h('button', { class: 'btn', type: 'button', id: 'btn-record', onClick: () => a.actions.toggleVoiceRecording() }, icon('mic', 16), 'Registra voce');
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtra per tipo' },
      [['all', 'Tutti'], ['video', 'Video'], ['audio', 'Audio'], ['image', 'Immagini']].map(([id, label]) =>
        h('button', { class: `chip${this.#filter === id ? ' on' : ''}`, type: 'button', 'data-f': id, onClick: () => { this.#filter = id; for (const c of chips.children) c.classList.toggle('on', c.dataset.f === id); this.#mediaSig = ''; this.#renderMediaGrid(); } }, label)));
    this.mediaGrid = h('div', { class: 'media-grid', role: 'list' });
    const root = h('div', { class: 'lib-pane media-pane' },
      h('div', { class: 'lib-actions wrap' },
        h('button', { class: 'btn primary', type: 'button', id: 'btn-import', onClick: () => file.click() }, icon('upload', 16), 'Importa'),
        this.recBtn,
        h('button', { class: 'btn', type: 'button', id: 'btn-record-screen', title: 'Registra lo schermo, la webcam o entrambi', onClick: () => a.actions.openRecorder() }, icon('camera', 16), 'Registra schermo/webcam'),
        h('button', { class: 'btn', type: 'button', id: 'btn-teleprompter', title: 'Copione che scorre da solo mentre registri', onClick: () => a.actions.toggleTeleprompter() }, icon('captions', 16), 'Teleprompter'),
        globalThis.ciakDesktop?.transcodeFile ? h('button', { class: 'btn', type: 'button', id: 'btn-transcode', title: 'Comprimi o converti un video qualsiasi', onClick: () => a.actions.openTranscode() }, icon('download', 16), 'Comprimi/converti') : null,
        globalThis.ciakDesktop?.ttsVoices ? h('button', { class: 'btn', type: 'button', id: 'btn-tts', title: 'Trasforma un testo in voce (sintetizzatore del computer)', onClick: () => a.actions.openSpeech() }, icon('type', 16), 'Voce da testo') : null,
        file),
      chips,
      this.mediaGrid,
      h('p', { class: 'hint' }, 'Trascina i file qui, oppure trascina un media sulla timeline. I file restano sul tuo computer.'),
    );
    this.#renderMediaGrid();
    this.#syncRecButton();
    a.events.on('voice', () => this.#syncRecButton());
    return root;
  }

  #syncRecButton() {
    if (!this.recBtn?.isConnected && !this.recBtn) return;
    const rec = this.app.actions.recording;
    this.recBtn.classList.toggle('recording', rec);
    this.recBtn.replaceChildren(icon(rec ? 'stop' : 'mic', 16), rec ? 'Ferma registrazione' : 'Registra voce');
  }

  #renderMediaGrid() {
    if (!this.mediaGrid) return;
    const p = this.app.store.project;
    const used = new Map();
    for (const c of allClips(p)) if (c.mediaId) used.set(c.mediaId, (used.get(c.mediaId) ?? 0) + 1);
    const items = Object.values(p.media).filter((m) => this.#filter === 'all' || m.kind === this.#filter);
    const sig = items.map((m) => `${m.id}:${m.name}:${!!this.app.pool.info(m.id)?.thumb}:${this.app.pool.has(m.id)}:${used.get(m.id) ?? 0}`).join('|');
    if (sig === this.#mediaSig) return;
    this.#mediaSig = sig;
    clear(this.mediaGrid);
    if (!items.length) {
      this.mediaGrid.append(h('div', { class: 'empty-state' }, icon('folder', 28), h('p', {}, this.#filter === 'all' ? 'Nessun media importato' : 'Nessun elemento di questo tipo'), h('small', {}, 'Video, audio e immagini: MP4, WebM, MOV, MP3, WAV, PNG, JPG…')));
      return;
    }
    for (const m of items) {
      const info = this.app.pool.info(m.id);
      const missing = !this.app.pool.has(m.id);
      const card = h('div', {
        class: `media-card kind-${m.kind}${missing ? ' missing' : ''}`, role: 'listitem', tabindex: '0', draggable: missing ? 'false' : 'true', 'data-id': m.id,
        'aria-label': `${m.name}, ${m.kind === 'image' ? 'immagine' : formatDuration(m.duration)}${missing ? ', file mancante' : ''}`,
        onDragstart: (e) => {
          e.dataTransfer.setData('application/x-ciak-media', m.id);
          e.dataTransfer.effectAllowed = 'copy';
        },
        onDblclick: () => this.app.actions.addMediaClip(m.id),
        onKeydown: (e) => {
          if (e.key === 'Enter') this.app.actions.addMediaClip(m.id);
        },
      },
      h('div', { class: 'thumb', style: info?.thumb ? { backgroundImage: `url(${info.thumb})` } : {} },
        !info?.thumb ? icon(m.kind === 'audio' ? 'music' : m.kind === 'image' ? 'image' : 'video', 28) : null,
        m.kind !== 'image' ? h('span', { class: 'dur' }, formatDuration(m.duration)) : null,
        used.get(m.id) ? h('span', { class: 'used', title: `Usato ${used.get(m.id)} volte` }, icon('check', 11)) : null,
        h('div', { class: 'card-actions' },
          h('button', { class: 'icon-btn small add', type: 'button', title: 'Aggiungi alla timeline', 'aria-label': `Aggiungi ${m.name} alla timeline`, disabled: missing, onClick: (e) => { e.stopPropagation(); this.app.actions.addMediaClip(m.id); } }, icon('plus', 16)),
          h('button', { class: 'icon-btn small del', type: 'button', title: 'Rimuovi dal progetto', 'aria-label': `Rimuovi ${m.name}`, onClick: (e) => { e.stopPropagation(); this.app.actions.removeMedia(m.id); } }, icon('trash', 14)),
        ),
      ),
      h('div', { class: 'name', title: m.name }, m.name));
      this.mediaGrid.append(card);
    }
  }

  // ---------------------------------------------------------------------------
  // Testo
  // ---------------------------------------------------------------------------

  #textTab() {
    const a = this.app;
    const font = h('input', { type: 'file', accept: '.ttf,.otf,.woff,.woff2', hidden: true, 'aria-label': 'Carica un font' });
    font.addEventListener('change', () => {
      if (font.files?.[0]) a.actions.loadFont(font.files[0]);
      font.value = '';
    });
    return h('div', { class: 'lib-pane' },
      h('div', { class: 'lib-actions' },
        h('button', { class: 'btn primary', type: 'button', id: 'btn-add-text', onClick: () => a.actions.addText() }, icon('type', 16), 'Aggiungi testo'),
        h('button', { class: 'btn', type: 'button', onClick: () => font.click(), title: 'Carica un font TTF/OTF/WOFF' }, icon('upload', 16), 'Carica font'), font),
      h('div', { class: 'card-grid cols-2' }, TEXT_PRESETS.map((pr) => {
        const t = pr.text;
        const style = {
          fontWeight: t.weight, fontStyle: t.italic ? 'italic' : 'normal', color: t.color, fontFamily: t.font ?? 'inherit',
          background: t.bg?.enabled ? t.bg.color : 'transparent', padding: t.bg?.enabled ? '2px 8px' : '0', borderRadius: '4px',
          textShadow: t.shadow ? `${t.shadow.x ?? 0}px ${t.shadow.y ?? 0}px ${Math.min(14, t.shadow.blur ?? 0)}px ${t.shadow.color}` : 'none',
          webkitTextStroke: t.stroke ? `${Math.max(1, t.stroke.width * 14)}px ${t.stroke.color}` : '0',
          textTransform: t.uppercase ? 'uppercase' : 'none',
        };
        return h('button', { class: 'card text-card', type: 'button', 'data-preset': pr.id, title: pr.label, onClick: () => a.actions.addText(pr.id) },
          h('span', { class: 'text-sample', style }, t.content), h('span', { class: 'card-label' }, pr.label));
      })),
    );
  }

  // ---------------------------------------------------------------------------
  // Elementi: adesivi, forme, sfondi, livello di regolazione
  // ---------------------------------------------------------------------------

  #elementsTab() {
    const a = this.app;
    const color = h('input', { type: 'color', value: '#ff3b5c', 'aria-label': 'Colore personalizzato' });
    return h('div', { class: 'lib-pane' },
      h('h3', { class: 'lib-h' }, 'Sfondi colorati'),
      h('div', { class: 'swatches' },
        SWATCHES.map((c) => h('button', { class: 'swatch', type: 'button', style: { background: c }, title: c, 'aria-label': `Sfondo ${c}`, onClick: () => a.actions.addSolid(c) })),
        h('label', { class: 'swatch custom', title: 'Colore personalizzato' }, color, icon('plus', 14))),
      h('button', { class: 'btn small', type: 'button', onClick: () => a.actions.addSolid(color.value) }, 'Aggiungi sfondo personalizzato'),
      h('h3', { class: 'lib-h' }, 'Forme'),
      h('div', { class: 'card-grid cols-4' }, SHAPES.map((s) => h('button', { class: 'card icon-card', type: 'button', title: s.label, 'aria-label': `Aggiungi ${s.label}`, onClick: () => a.actions.addShape(s.id) }, shapeIcon(s.id)))),
      h('h3', { class: 'lib-h' }, 'Adesivi'),
      EMOJI_GROUPS.map((g) => h('div', { class: 'emoji-group' }, h('h4', {}, g.label), h('div', { class: 'emoji-grid' }, g.items.map((e) => h('button', { class: 'emoji', type: 'button', 'aria-label': `Adesivo ${e}`, onClick: () => a.actions.addSticker(e) }, e))))),
      h('h3', { class: 'lib-h' }, 'Livelli'),
      h('button', { class: 'btn', type: 'button', id: 'btn-add-adjustment', onClick: () => a.actions.addAdjustment(), title: 'Applica filtri ed effetti a tutto ciò che sta sotto' }, icon('layers', 16), 'Livello di regolazione'),
      h('p', { class: 'hint' }, 'Un livello di regolazione applica filtri ed effetti a tutte le tracce sottostanti per la sua durata.'),
    );
  }

  // ---------------------------------------------------------------------------
  // Filtri (con anteprima dal vivo del fotogramma corrente)
  // ---------------------------------------------------------------------------

  #filtersTab() {
    const a = this.app;
    this.#filterThumbs = [];
    const grid = h('div', { class: 'card-grid cols-3' }, FILTERS.map((f) => {
      const cv = h('canvas', { width: 112, height: 63, class: 'filter-thumb' });
      this.#filterThumbs.push({ canvas: cv, filter: f });
      return h('button', { class: 'card filter-card', type: 'button', 'data-filter': f.id, title: f.label, onClick: () => a.actions.applyFilter(f.id) }, cv, h('span', { class: 'card-label' }, f.label));
    }));
    return h('div', { class: 'lib-pane' }, h('p', { class: 'hint' }, 'Seleziona un clip e scegli un filtro. L’intensità si regola nelle proprietà.'), grid);
  }

  #paintFilterThumbs() {
    if (this.#tab !== 'filters') return;
    const src = this.app.player.canvas;
    if (!src) return;
    const soft = !this.app.renderer.supportsFilter;
    for (const { canvas, filter } of this.#filterThumbs) {
      const g = canvas.getContext('2d', { willReadFrequently: soft });
      const fake = createClip('image');
      fake.filter = { id: filter.id, intensity: 1 };
      const fp = filterParamsFor(fake, 1);
      g.save();
      g.clearRect(0, 0, canvas.width, canvas.height);
      if (!soft) {
        g.filter = filterCss(fp, 0) || 'none';
        g.drawImage(src, 0, 0, canvas.width, canvas.height);
      } else {
        g.drawImage(src, 0, 0, canvas.width, canvas.height);
        const id = g.getImageData(0, 0, canvas.width, canvas.height);
        applyFilterParams(id.data, fp);
        g.putImageData(id, 0, 0);
      }
      g.restore();
    }
  }

  // ---------------------------------------------------------------------------
  // Effetti
  // ---------------------------------------------------------------------------

  #effectsTab() {
    const a = this.app;
    return h('div', { class: 'lib-pane' },
      h('p', { class: 'hint' }, 'Clic su un effetto per applicarlo (o rimuoverlo) al clip selezionato. Regola l’intensità nelle proprietà.'),
      h('div', { class: 'card-grid cols-3' }, EFFECTS.map((e) => h('button', { class: 'card fx-card', type: 'button', 'data-effect': e.id, title: e.label, onClick: () => a.actions.toggleEffect(e.id) }, icon('sparkles', 24), h('span', { class: 'card-label' }, e.label)))),
      h('button', { class: 'btn small', type: 'button', onClick: () => a.actions.addAdjustment() }, icon('layers', 14), 'Applica a tutto: livello di regolazione'),
    );
  }

  // ---------------------------------------------------------------------------
  // Transizioni
  // ---------------------------------------------------------------------------

  #transitionsTab() {
    const a = this.app;
    const dur = h('input', { type: 'range', min: '0.2', max: '3', step: '0.1', value: String(prefs.get('transDur', 0.8)), 'aria-label': 'Durata transizione' });
    const out = h('span', { class: 'num-wrap' }, `${(+dur.value).toFixed(1)} s`);
    dur.addEventListener('input', () => {
      out.textContent = `${(+dur.value).toFixed(1)} s`;
      prefs.set('transDur', +dur.value);
    });
    const card = (c) => h('button', { class: 'card tr-card', type: 'button', 'data-transition': c.id, title: c.label, onClick: () => a.actions.applyTransition(c.id, +dur.value) }, icon(c.id === 'none' ? 'x' : 'transition', 24), h('span', { class: 'card-label' }, c.label));
    return h('div', { class: 'lib-pane' },
      h('p', { class: 'hint' }, 'Seleziona un clip: la transizione si applica al suo inizio. Se segue un altro clip si crea una sovrapposizione reale (dissolvenza incrociata, spinta, tendina…).'),
      h('div', { class: 'ctl slider' }, h('label', { class: 'ctl-label' }, 'Durata'), dur, out),
      h('div', { class: 'card-grid cols-3' }, card({ id: 'none', label: 'Nessuna' })),
      transitionGroups().map((g) => [
        h('h4', { class: 'lib-h', 'data-group': g.label }, g.label),
        h('div', { class: 'card-grid cols-3' }, g.ids.map((id) => card({ id, label: ANIMATIONS[id].label }))),
      ]),
    );
  }

  // ---------------------------------------------------------------------------
  // Sottotitoli
  // ---------------------------------------------------------------------------

  #subtitlesTab() {
    const a = this.app;
    const file = h('input', { type: 'file', accept: '.srt,.vtt,.ass,.ssa,.lrc,.txt,text/plain', hidden: true, 'aria-label': 'Importa sottotitoli (SRT, VTT, ASS, LRC, TXT)' });
    file.addEventListener('change', () => {
      if (file.files?.[0]) a.actions.importSubtitles(file.files[0]);
      file.value = '';
    });
    const fmt = h('select', { id: 'sel-export-sub', 'aria-label': 'Formato di esportazione' }, [['srt', 'SRT'], ['vtt', 'WebVTT'], ['txt', 'Testo'], ['lrc', 'LRC']].map(([v, l]) => h('option', { value: v }, l)));
    const shift = h('input', { type: 'number', id: 'sub-shift', step: '0.1', value: '0', class: 'num', 'aria-label': 'Spostamento in secondi' });
    this.subList = h('div', { class: 'sub-list', role: 'list' });
    const root = h('div', { class: 'lib-pane' },
      h('div', { class: 'lib-actions wrap' },
        h('button', { class: 'btn primary', type: 'button', id: 'btn-import-srt', title: 'SRT, VTT, ASS, LRC o testo semplice', onClick: () => file.click() }, icon('upload', 16), 'Importa'),
        h('button', { class: 'btn', type: 'button', id: 'btn-add-sub', onClick: () => a.actions.addSubtitleHere() }, icon('plus', 16), 'Aggiungi qui'),
        h('span', { class: 'inline-pair' }, fmt, h('button', { class: 'btn', type: 'button', id: 'btn-export-srt', onClick: () => a.actions.exportSubtitles(fmt.value) }, icon('download', 16), 'Esporta')), file),
      h('div', { class: 'lib-actions wrap' },
        h('label', { class: 'inline-pair', title: 'Sposta tutti i sottotitoli: positivo = più tardi, negativo = prima' }, 'Sposta di', shift, 's'),
        h('button', { class: 'btn small', type: 'button', id: 'btn-shift-subs', onClick: () => a.actions.shiftSubtitles(Number(shift.value)) }, 'Applica')),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Stile sottotitoli' },
        [['classic', 'Classico'], ['outline', 'Contorno'], ['yellow', 'Giallo'], ['box', 'Riquadro'], ['karaoke', 'Karaoke']].map(([id, label]) => h('button', { class: 'chip', type: 'button', 'data-style': id, onClick: () => a.actions.styleSubtitles(id) }, label))),
      this.subList,
      h('p', { class: 'hint' }, 'I sottotitoli sono clip di testo: puoi spostarli, ritagliarli e stilizzarli come gli altri. «Taglia» toglie dal video (e da tutte le tracce) il tratto di quella frase: così si monta partendo dalla trascrizione. La trascrizione automatica non è inclusa: l’editor lavora offline, senza servizi esterni.'),
    );
    this.#renderSubtitleList();
    return root;
  }

  #renderSubtitleList() {
    if (!this.subList) return;
    const p = this.app.store.project;
    const subs = allClips(p).filter((c) => c.kind === 'text' && c.role === 'subtitle').sort((x, y) => x.start - y.start);
    const sig = subs.map((c) => `${c.id}:${c.start.toFixed(3)}:${c.duration.toFixed(3)}:${c.text.content}`).join('|');
    if (sig === this.subSig && this.subList.children.length) return;
    // non ricostruire mentre si sta scrivendo in uno dei campi
    if (this.subList.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
    this.subSig = sig;
    clear(this.subList);
    if (!subs.length) {
      this.subList.append(h('div', { class: 'empty-state' }, icon('captions', 28), h('p', {}, 'Nessun sottotitolo'), h('small', {}, 'Importa un file .srt o aggiungine uno alla posizione della testina.')));
      return;
    }
    for (const c of subs) {
      const ta = h('textarea', { rows: 2, 'aria-label': `Testo sottotitolo a ${formatDuration(c.start, 1)}`, onInput: () => this.app.actions.setSubtitleText(c.id, ta.value) });
      ta.value = c.text.content;
      this.subList.append(h('div', { class: 'sub-row', role: 'listitem' },
        h('button', { class: 'sub-time', type: 'button', title: 'Vai a questo punto', onClick: () => { this.app.player.seek(c.start); this.app.selection.set([c.id]); } }, `${formatDuration(c.start, 1)} → ${formatDuration(c.start + c.duration, 1)}`),
        ta,
        h('button', { class: 'icon-btn small sub-cut', type: 'button', title: 'Taglia dal video questo tratto (e chiudi il buco)', 'aria-label': `Taglia dal video il tratto a ${formatDuration(c.start, 1)}`, onClick: () => this.app.actions.cutSubtitle(c.id) }, icon('scissors', 14))));
    }
  }
}
