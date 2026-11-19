// Orchestratore: crea i servizi, assembla l'interfaccia e implementa tutte le azioni dell'editor.

import { Emitter, EditError, clamp, debounce, formatBytes, formatDuration, quantize, uid } from '../core/util.js';
import { Store, Selection } from '../core/store.js';
import { DEFAULT_TEXT_DURATION, createClip, createProject, isVisualKind, trackTypeFor } from '../core/project.js';
import {
  addClip, addMarker, addMediaClip, addTrack, allClips, clipEnd, copyClips, deleteClips, duplicateClips, findClip, insertFreezeFrame,
  moveTrack, normalizeProject, pasteClips, projectDuration, removeMarker, removeMedia, removeTrack, rippleDelete, setSpeed, setTransition,
  snapPoints, splitClip, trackWithRoom, trimToTime, cutRange, planMove, moveClips,
} from '../core/timeline.js';
import { removeKeyframeAt, toggleKeyframe, valueAt, setValueAt } from '../core/keyframes.js';
import { ASPECTS, EFFECTS, EXPORT_SIZES, TEXT_PRESETS } from '../core/presets.js';
import { formatSrt } from '../core/srt.js';
import { MIME, SUBTITLE_FORMATS, WRITERS, parseSubtitles } from '../core/subtitles.js';
import { findSilences, removeSilences } from '../core/silence.js';
import { VOICE_EFFECTS, applyGain, applyVoiceEffect, isolateVoice, loudness, noiseReduce, normalizeGain, pitchShift, removeVoice } from '../core/audio-fx.js';
import { detectBeats } from '../core/beats.js';
import { decodeWav, encodeWav } from '../core/wav.js';
import { defaultGrade, encodeLut, parseCube } from '../core/grade.js';
import { unzipStore, zipStore } from '../core/zip.js';
import { AudioEngine } from '../engine/audio-engine.js';
import { MediaPool } from '../engine/media-pool.js';
import { Renderer } from '../engine/renderer.js';
import { Player } from '../engine/player.js';
import { Storage } from '../engine/storage.js';
import { renderProjectAudio, encodeMp3, encodeGif } from '../engine/audio-export.js';
import { Teleprompter } from './teleprompter.js';
import { RECORD_MODES, ScreenRecorder, recorderSupported, screenSupported } from '../engine/screen-recorder.js';
import { Exporter, QUALITY, availableFormats, downloadBlob, estimateBitrate, exportSize, FORMATS } from '../engine/exporter.js';
import { VoiceRecorder, computePeaks, decodeAudio, kindOfFile, probeMedia, captureFrameBlob } from '../engine/media-import.js';
import { h, isTyping } from './dom.js';
import { icon } from './icons.js';
import { prefs } from './prefs.js';
import { confirmDialog, openDialog, promptDialog, toast } from './overlays.js';
import { Library } from './library.js';
import { PreviewView } from './preview-view.js';
import { TimelineView } from './timeline-view.js';
import { Inspector } from './inspector.js';
import { WorkspaceLayout } from './workspace-layout.js';

const SUBTITLE_STYLES = {
  classic: { size: 5.2, weight: 700, color: '#ffffff', stroke: { width: 0, color: '#000000' }, shadow: { blur: 0, x: 0, y: 0, color: '#000000', opacity: 0 }, bg: { enabled: true, color: '#000000', opacity: 0.6, padding: 0.3, radius: 0.2 }, karaoke: { enabled: false, mode: 'word', color: '#ffe14d' } },
  outline: { size: 5.6, weight: 800, color: '#ffffff', stroke: { width: 0.16, color: '#000000' }, shadow: { blur: 6, x: 0, y: 2, color: '#000000', opacity: 0.6 }, bg: { enabled: false, color: '#000000', opacity: 0.6, padding: 0.3, radius: 0.2 }, karaoke: { enabled: false, mode: 'word', color: '#ffe14d' } },
  yellow: { size: 5.6, weight: 800, color: '#ffe14d', stroke: { width: 0.14, color: '#1a1200' }, shadow: { blur: 0, x: 0, y: 0, color: '#000000', opacity: 0 }, bg: { enabled: false, color: '#000000', opacity: 0.6, padding: 0.3, radius: 0.2 }, karaoke: { enabled: false, mode: 'word', color: '#ffe14d' } },
  box: { size: 5, weight: 600, color: '#111111', stroke: { width: 0, color: '#000000' }, shadow: { blur: 0, x: 0, y: 0, color: '#000000', opacity: 0 }, bg: { enabled: true, color: '#ffffff', opacity: 0.92, padding: 0.35, radius: 0.3 }, karaoke: { enabled: false, mode: 'word', color: '#ffe14d' } },
  karaoke: { size: 5.6, weight: 800, color: '#ffffff', stroke: { width: 0.16, color: '#000000' }, shadow: { blur: 6, x: 0, y: 2, color: '#000000', opacity: 0.6 }, bg: { enabled: false, color: '#000000', opacity: 0.6, padding: 0.3, radius: 0.2 }, karaoke: { enabled: true, mode: 'word', color: '#ffe14d' } },
};

const SHORTCUTS = [
  ['Spazio / K', 'Riproduci / Pausa'],
  ['← / →', 'Fotogramma precedente / successivo (Maiusc: 1 secondo)'],
  ['↑ / ↓', 'Vai al taglio precedente / successivo'],
  ['Home / Fine', 'Vai all’inizio / alla fine'],
  ['S', 'Dividi alla testina'],
  ['Q / W', 'Elimina la parte a sinistra / a destra della testina'],
  ['Canc', 'Elimina · Maiusc+Canc: elimina e chiudi lo spazio'],
  ['Ctrl+Z / Ctrl+Maiusc+Z', 'Annulla / Ripeti'],
  ['Ctrl+C / X / V', 'Copia / Taglia / Incolla alla testina'],
  ['Ctrl+D', 'Duplica'],
  ['Ctrl+A', 'Seleziona tutto'],
  ['M', 'Aggiungi marcatore'],
  ['N', 'Calamita on/off'],
  ['+ / −  ·  \\', 'Zoom timeline · adatta alla finestra'],
  ['L', 'Ripeti in loop'],
  ['F', 'Schermo intero'],
  ['Ctrl+E', 'Esporta'],
  ['Maiusc+D', 'Mostra/nascondi statistiche prestazioni'],
  ['Esc', 'Deseleziona / annulla il trascinamento'],
  ['Pulsante Layout', 'Sposta l’anteprima, nascondi pannelli, scegli una disposizione'],
  ['?', 'Questa guida'],
];

export class App {
  constructor(root) {
    this.root = root;
    this.events = new Emitter();
    this.toast = toast;
    this.store = new Store(createProject());
    this.selection = new Selection();
    this.audio = new AudioEngine();
    this.pool = new MediaPool(this.audio);
    this.renderer = new Renderer(this.pool);
    this.player = new Player({ store: this.store, pool: this.pool, audio: this.audio, renderer: this.renderer });
    this.storage = new Storage();
    this.exporter = new Exporter({ store: this.store, player: this.player, audio: this.audio });
    this.voice = new VoiceRecorder();
    this.screenRec = new ScreenRecorder();
    this.prompter = new Teleprompter();
    this.prompter.onChange = () => this.events.emit('prompter');
    this.customFonts = [];
    this.fontsVersion = 0;
    this.clipboard = null;
    this.valueAt = valueAt;
    this.setValueAt = setValueAt;
    this.actions = this.#makeActions();
    this.saveState = 'saved';
    this.#applyTheme(prefs.get('theme', 'auto'));
    this.#build();
    this.#wire();
  }

  // ---------------------------------------------------------------------------
  // Costruzione dell'interfaccia
  // ---------------------------------------------------------------------------

  #build() {
    this.library = new Library(this);
    this.preview = new PreviewView(this);
    this.timeline = new TimelineView(this);
    this.inspector = new Inspector(this);

    this.nameBtn = h('button', { class: 'project-name', type: 'button', title: 'Impostazioni del progetto', onClick: () => this.selection.clear() }, 'Nuovo progetto');
    this.saveLabel = h('span', { class: 'save-state', role: 'status', 'aria-live': 'polite' }, 'Salvato');
    this.themeBtn = h('button', { class: 'icon-btn', type: 'button', id: 'btn-theme', title: 'Cambia tema chiaro/scuro', 'aria-label': 'Cambia tema chiaro/scuro', onClick: () => this.actions.toggleTheme() }, icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 18));
    this.layoutBtn = h('button', { class: 'btn layout-btn', type: 'button', id: 'btn-layout', title: 'Layout: sposta l’anteprima e scegli la disposizione dei pannelli', 'aria-haspopup': 'menu', onClick: () => this.layout.openMenu() }, icon('layout', 16), h('span', { class: 'layout-btn-label' }, 'Layout'));
    const logo = h('div', { class: 'brand', 'aria-label': 'Ciak Studio' },
      h('span', { class: 'logo' }, (() => {
        const s = document.createElement('span');
        s.innerHTML = '<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><rect x="3" y="11" width="26" height="17" rx="3" fill="currentColor"/><path d="M3 11l3-7 5 1.5L8 12zm9 1.5L15 5l5 1.5-3 7.5zm9 0L24 6l5 1.5-.8 3.5z" fill="var(--accent)"/></svg>';
        return s.firstChild;
      })()),
      h('span', { class: 'brand-name' }, 'Ciak', h('b', {}, ' Studio')));
    this.topbar = h('header', { class: 'topbar' },
      logo, this.nameBtn,
      h('span', { class: 'tb-spacer' }),
      this.saveLabel,
      this.layoutBtn,
      this.themeBtn,
      h('button', { class: 'icon-btn', type: 'button', id: 'btn-help', title: 'Guida e scorciatoie (?)', 'aria-label': 'Guida e scorciatoie', onClick: () => this.actions.showHelp() }, icon('help', 18)),
      h('button', { class: 'btn primary export-btn', type: 'button', id: 'btn-export', onClick: () => this.actions.openExport() }, icon('download', 16), 'Esporta'));
    this.splitter = h('div', { class: 'splitter', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Ridimensiona la timeline', tabindex: '0' });
    this.workspace = h('div', { class: 'workspace' }, this.library.el, this.preview.el, this.inspector.el);
    this.dropVeil = h('div', { class: 'drop-veil', hidden: true }, h('div', {}, icon('upload', 40), h('p', {}, 'Rilascia i file per importarli')));
    this.shell = h('div', { class: 'app' }, this.topbar, this.workspace, this.splitter, this.timeline.el, this.dropVeil);
    this.root.append(this.shell);
    this.shell.style.setProperty('--tl-h', `${clamp(prefs.get('tlHeight', 330), 200, 700)}px`);
    this.#initSplitter();
    this.layout = new WorkspaceLayout(this, this.layoutBtn);
  }

  /** Altezza della timeline in pixel (il limite superiore dipende dalla disposizione scelta). */
  setTimelineHeight(v) {
    const hgt = clamp(Math.round(v), 180, Math.max(220, innerHeight - 260));
    this.shell.style.setProperty('--tl-h', `${hgt}px`);
    prefs.set('tlHeight', hgt);
  }

  #initSplitter() {
    const set = (v) => this.setTimelineHeight(v);
    this.splitter.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const start = this.timeline.el.getBoundingClientRect().height;
      const move = (ev) => set(start + (startY - ev.clientY));
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
    this.splitter.addEventListener('keydown', (e) => {
      const cur = this.timeline.el.getBoundingClientRect().height;
      if (e.key === 'ArrowUp') set(cur + 30);
      if (e.key === 'ArrowDown') set(cur - 30);
    });
  }

  // ---------------------------------------------------------------------------
  // Collegamenti globali
  // ---------------------------------------------------------------------------

  #wire() {
    const { store, selection, player } = this;
    store.on('change', ({ kind }) => {
      selection.sanitize(store.project);
      this.nameBtn.textContent = store.project.name;
      document.title = `${store.project.name} — Ciak Studio`;
      if (kind !== 'gesture') this.#scheduleSave();
    });
    player.on('ended', () => this.preview.setLoop(player.loop));
    addEventListener('keydown', (e) => this.#onKey(e));
    // import da trascinamento su tutta la finestra
    let depth = 0;
    addEventListener('dragenter', (e) => {
      if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
      depth++;
      this.dropVeil.hidden = false;
    });
    addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) this.dropVeil.hidden = true;
    });
    addEventListener('dragover', (e) => {
      if ([...(e.dataTransfer?.types ?? [])].includes('Files')) e.preventDefault();
    });
    addEventListener('drop', (e) => {
      depth = 0;
      this.dropVeil.hidden = true;
      if (e.defaultPrevented) return;
      if (e.dataTransfer?.files?.length) {
        e.preventDefault();
        this.actions.importFiles([...e.dataTransfer.files]);
      }
    });
    addEventListener('beforeunload', (e) => {
      if (this.saveState !== 'saved' && !this.storage.available && allClips(store.project).length) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    let lastErr = 0;
    const report = (msg) => {
      console.error('[errore]', msg);
      if (Date.now() - lastErr > 4000) {
        lastErr = Date.now();
        toast(`Errore imprevisto: ${String(msg?.message ?? msg).slice(0, 140)}`, { type: 'error' });
      }
    };
    addEventListener('error', (e) => report(e.error ?? e.message));
    addEventListener('unhandledrejection', (e) => report(e.reason));
    this.#syncUi();
    store.on('change', () => this.#syncUi());
  }

  #syncUi() {
    this.nameBtn.textContent = this.store.project.name;
    this.preview.setLoop(this.player.loop);
  }

  #applyTheme(mode) {
    const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  // ---------------------------------------------------------------------------
  // Salvataggio automatico e ripristino
  // ---------------------------------------------------------------------------

  #setSaveState(s) {
    this.saveState = s;
    this.saveLabel.textContent = { saved: 'Salvato', saving: 'Salvataggio…', dirty: 'Modifiche non salvate', off: 'Salvataggio non disponibile' }[s];
    this.saveLabel.dataset.state = s;
  }

  #scheduleSave() {
    if (!this.storage.available) return this.#setSaveState('off');
    this.#setSaveState('dirty');
    this.#save();
  }

  #save = debounce(async () => {
    if (!this.storage.available) return;
    const rev = this.store.revision;
    this.#setSaveState('saving');
    try {
      await this.storage.saveProject(this.store.project);
      if (this.store.revision === rev) {
        this.store.markSaved(rev);
        this.#setSaveState('saved');
      } else this.#setSaveState('dirty');
    } catch (e) {
      console.warn('[save]', e);
      this.#setSaveState('dirty');
      if (e?.name === 'QuotaExceededError') toast('Spazio del browser esaurito: il progetto non può essere salvato.', { type: 'error' });
    }
  }, 700);

  /** Avvio: apre il database e ripristina l'ultimo progetto. */
  async start() {
    const ok = await this.storage.open();
    if (!ok) {
      this.#setSaveState('off');
      this.preview.applyQuality();
      return;
    }
    this.storage.persist();
    try {
      const raw = await this.storage.loadProject();
      if (raw && (Object.keys(raw.media ?? {}).length || (raw.tracks ?? []).some((t) => t.clips?.length))) {
        const p = normalizeProject(raw);
        let missing = 0;
        for (const id of Object.keys(p.media)) {
          const blob = await this.storage.getMedia(id);
          if (blob) this.pool.add(id, blob);
          else missing++;
        }
        this.store.replace(p);
        this.selection.clear();
        this.player.resizeCanvas();
        this.player.seek(0);
        for (const id of Object.keys(p.media)) if (this.pool.has(id)) this.#enrich(id, true);
        await this.storage.gc(Object.keys(p.media));
        toast(missing ? `Progetto ripristinato. ${missing} file multimediali non sono più disponibili.` : 'Progetto ripristinato', { type: missing ? 'warn' : 'success' });
        this.timeline.fit();
      }
    } catch (e) {
      console.error('[restore]', e);
      toast('Non è stato possibile ripristinare il progetto precedente.', { type: 'warn' });
    }
    this.#setSaveState('saved');
  }

  /** Miniatura e forma d'onda in background. */
  async #enrich(id, thumb = false) {
    const blob = this.pool.blob(id);
    const m = this.store.project.media[id];
    if (!blob || !m) return;
    try {
      if (thumb && !this.pool.info(id)?.thumb && m.kind !== 'audio') {
        const meta = await probeMedia(blob instanceof File ? blob : new File([blob], m.name, { type: m.mime }));
        this.pool.setInfo(id, { thumb: meta.thumb });
      }
      if (m.kind === 'image') await this.pool.loadImage(id);
      else {
        const r = await computePeaks(blob);
        this.pool.setInfo(id, { peaks: r?.peaks ?? null, peaksRate: r?.rate ?? 50, hasAudio: !!r });
      }
    } catch (e) {
      console.warn('[enrich]', id, e);
    }
  }

  // ---------------------------------------------------------------------------
  // Scorciatoie
  // ---------------------------------------------------------------------------

  #onKey(e) {
    if (e.defaultPrevented || e.isComposing) return;
    if (document.querySelector('dialog[open]')) return;
    if (isTyping(e.target)) return;
    const a = this.actions;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const done = () => {
      e.preventDefault();
      if (e.target instanceof HTMLElement && e.target.tagName === 'BUTTON') e.target.blur();
    };
    if (mod) {
      const lk = k.toLowerCase();
      if (lk === 'z') return e.shiftKey ? (done(), a.redo()) : (done(), a.undo());
      if (lk === 'y') return done(), a.redo();
      if (lk === 'c') return done(), a.copy();
      if (lk === 'x') return done(), a.cut();
      if (lk === 'v') return done(), a.paste();
      if (lk === 'd') return done(), a.duplicate();
      if (lk === 'a') return done(), a.selectAll();
      if (lk === 'e') return done(), a.openExport();
      if (lk === 's') return done(), a.saveNow();
      return;
    }
    if (e.altKey) return;
    switch (k) {
      case ' ':
      case 'k':
        return done(), a.togglePlay();
      case 'ArrowLeft':
        return done(), e.shiftKey ? a.jump(-1) : a.stepFrame(-1);
      case 'ArrowRight':
        return done(), e.shiftKey ? a.jump(1) : a.stepFrame(1);
      case 'ArrowUp':
        return done(), a.gotoEdit(-1);
      case 'ArrowDown':
        return done(), a.gotoEdit(1);
      case 'Home':
        return done(), a.seekStart();
      case 'End':
        return done(), a.seekEnd();
      case 's':
        return done(), a.split();
      case 'q':
        return done(), a.trimSide('left');
      case 'w':
        return done(), a.trimSide('right');
      case 'Delete':
      case 'Backspace':
        return done(), e.shiftKey ? a.rippleDeleteSelected() : a.deleteSelected();
      case 'm':
        return done(), a.addMarker();
      case 'n':
        return done(), this.timeline.toggleSnap();
      case '+':
      case '=':
        return done(), this.timeline.zoomBy(1.25);
      case '-':
      case '_':
        return done(), this.timeline.zoomBy(0.8);
      case '\\':
        return done(), this.timeline.fit();
      case 'f':
        return done(), this.preview.fullscreen();
      case 'l':
        return done(), a.toggleLoop();
      case 'D':
        return done(), this.preview.toggleHud();
      case '?':
        return done(), a.showHelp();
      case 'Escape':
        if (!this.store.inGesture) this.selection.clear();
        return;
      default:
    }
  }

  // ---------------------------------------------------------------------------
  // Utilità interne alle azioni
  // ---------------------------------------------------------------------------

  /** Clip bersaglio: selezione, oppure il clip visivo più in alto sotto la testina. */
  targets({ visual = false } = {}) {
    const p = this.store.project;
    let ids = this.selection.ids.filter((id) => findClip(p, id));
    if (visual) ids = ids.filter((id) => isVisualKind(findClip(p, id).clip.kind));
    if (ids.length) return ids;
    const t = this.player.time;
    for (const tr of p.tracks) {
      if (tr.type !== 'video' || tr.hidden || tr.locked) continue;
      const c = tr.clips.find((q) => t >= q.start - 1e-6 && t < clipEnd(q) - 1e-6);
      if (c) return [c.id];
    }
    return [];
  }

  commit(label, fn, opts) {
    const r = this.store.commit(label, fn, opts);
    if (!r.ok) toast(r.error, { type: 'warn' });
    return r;
  }

  /** Inserisce un nuovo clip (testo, forma…) sulla traccia visiva più alta con spazio libero. */
  #place(clip, label, { fromTop = true } = {}) {
    const r = this.commit(label, (p) => {
      const track = trackWithRoom(p, trackTypeFor(clip.kind), clip.start, clip.duration, { fromTop });
      return addClip(p, track.id, clip, clip.start);
    });
    if (r.ok) {
      this.selection.set([clip.id]);
      this.timeline.ensureVisible(clip.start);
    }
    return r;
  }

  // ---------------------------------------------------------------------------
  // Azioni
  // ---------------------------------------------------------------------------

  #makeActions() {
    const app = this;
    const A = {
      recording: false,

      // ---- importazione ------------------------------------------------------
      async importFiles(files, opts = {}) {
        const list = [...files].filter(Boolean);
        if (!list.length) return;
        const progress = toast(`Importazione di ${list.length} ${list.length === 1 ? 'file' : 'file'}…`, { ms: 120000 });
        let ok = 0;
        const errors = [];
        for (const file of list) {
          try {
            if (!kindOfFile(file)) throw new Error('tipo di file non supportato');
            const meta = await probeMedia(file);
            const id = uid('m');
            const first = Object.keys(app.store.project.media).length === 0 && allClips(app.store.project).length === 0;
            app.pool.add(id, file);
            app.pool.setInfo(id, { thumb: meta.thumb });
            app.store.commit('Importa media', (p) => {
              p.media[id] = { id, name: file.name, kind: meta.kind, mime: meta.mime || file.type, size: file.size, duration: meta.duration, width: meta.width, height: meta.height, hasAudio: meta.kind !== 'image' };
            });
            app.storage.putMedia(id, file).catch((e) => {
              console.warn('[storage] media non salvato', e);
              toast(`«${file.name}» non può essere conservato nel browser (spazio insufficiente?). Resterà disponibile finché non chiudi la pagina.`, { type: 'warn' });
            });
            app.#enrich(id);
            if (first && meta.kind !== 'audio') A.matchAspect(meta.width, meta.height);
            if (opts.addToTimeline) A.addMediaClip(id, { start: opts.start });
            ok++;
          } catch (e) {
            errors.push(`«${file.name}»: ${e.message}`);
          }
        }
        progress.remove();
        if (ok) toast(ok === 1 ? 'File importato' : `${ok} file importati`, { type: 'success' });
        for (const msg of errors) toast(`Importazione non riuscita — ${msg}`, { type: 'error' });
      },

      matchAspect(w, h2) {
        const r = w / h2;
        const best = ASPECTS.map((a) => ({ a, d: Math.abs(a.width / a.height - r) / r })).sort((x, y) => x.d - y.d)[0];
        if (best.d < 0.03 && (best.a.width !== app.store.project.settings.width || best.a.height !== app.store.project.settings.height)) {
          app.store.commit('Formato', (p) => {
            p.settings.width = best.a.width;
            p.settings.height = best.a.height;
          });
          toast(`Formato impostato su ${best.a.id} (come il primo clip)`);
        }
      },

      addMediaClip(mediaId, { start, trackId } = {}) {
        const m = app.store.project.media[mediaId];
        if (!m) return toast('Media non trovato', { type: 'error' });
        if (!app.pool.has(mediaId)) return toast(`Il file «${m.name}» non è disponibile: reimportalo.`, { type: 'warn' });
        const at = start ?? app.player.time;
        const r = app.commit('Aggiungi clip', (p) => addMediaClip(p, p.media[mediaId], { start: at, trackId }));
        if (r.ok) {
          app.selection.set([r.result.id]);
          app.timeline.ensureVisible(r.result.start);
          if (app.pool.info(mediaId) === null) app.#enrich(mediaId);
        }
        return r;
      },

      removeMedia(mediaId) {
        const p = app.store.project;
        const n = allClips(p).filter((c) => c.mediaId === mediaId).length;
        const go = () => {
          app.commit('Rimuovi media', (d) => removeMedia(d, mediaId));
        };
        if (!n) return go();
        confirmDialog(`Questo media è usato da ${n} clip. Rimuovendolo verranno eliminati anche i clip.`, { confirmLabel: 'Rimuovi', danger: true, title: 'Rimuovere il media?' }).then((yes) => yes && go());
      },

      // ---- inserimento di elementi -------------------------------------------
      addText(presetId) {
        const pr = TEXT_PRESETS.find((x) => x.id === presetId);
        const t = app.player.time;
        const clip = createClip('text', { name: pr?.label ?? 'Testo', start: t, duration: DEFAULT_TEXT_DURATION, text: pr ? structuredClone(pr.text) : {}, transform: { y: pr?.y ?? 0 } });
        if (pr?.animIn) clip.anim.in = { type: pr.animIn, duration: 1 };
        if (pr?.loop) clip.anim.loop = { ...pr.loop };
        const r = app.#place(clip, 'Aggiungi testo');
        if (r.ok) setTimeout(() => app.inspector.focusText(), 50);
      },
      addSticker(emoji) {
        app.#place(createClip('sticker', { name: 'Adesivo', start: app.player.time, duration: 3, sticker: { emoji, size: 0.25 } }), 'Aggiungi adesivo');
      },
      addShape(type) {
        app.#place(createClip('shape', { name: 'Forma', start: app.player.time, duration: 3, shape: { type, w: type === 'line' ? 0.5 : 0.3, h: type === 'line' ? 0.01 : 0.3, strokeWidth: type === 'line' ? 0.012 : 0 } }), 'Aggiungi forma');
      },
      addSolid(color) {
        app.#place(createClip('shape', { name: 'Sfondo', start: app.player.time, duration: 5, shape: { type: 'rect', fill: color, full: true } }), 'Aggiungi sfondo', { fromTop: false });
      },
      addAdjustment() {
        const t = app.player.time;
        app.#place(createClip('adjustment', { name: 'Regolazione', start: t, duration: Math.max(3, Math.min(10, projectDuration(app.store.project) - t) || 5) }), 'Aggiungi livello di regolazione');
      },

      // ---- modifica ------------------------------------------------------------
      split() {
        const { store, selection, player } = app;
        const t = quantize(player.time, store.project.settings.fps);
        const p = store.project;
        let ids = selection.ids.filter((id) => {
          const c = findClip(p, id)?.clip;
          return c && t > c.start && t < clipEnd(c);
        });
        if (!ids.length) {
          ids = allClips(p).filter((c) => t > c.start && t < clipEnd(c) && !findClip(p, c.id).track.locked && !findClip(p, c.id).track.hidden).map((c) => c.id);
        }
        if (!ids.length) return toast('Posiziona la testina dentro un clip per dividerlo', { type: 'warn' });
        app.commit('Dividi clip', (d) => {
          let n = 0;
          let last = null;
          for (const id of ids) {
            try {
              splitClip(d, id, t);
              n++;
            } catch (e) {
              if (!(e instanceof EditError)) throw e;
              last = e;
            }
          }
          if (!n) throw last ?? new EditError('Impossibile dividere');
        });
      },
      /** Elimina la parte a sinistra («Q») o a destra («W») della testina dei clip selezionati (o sotto la testina). */
      trimSide(side) {
        const { store, selection, player } = app;
        const t = quantize(player.time, store.project.settings.fps);
        const p = store.project;
        let ids = selection.ids.filter((id) => {
          const c = findClip(p, id)?.clip;
          return c && t > c.start && t < clipEnd(c);
        });
        if (!ids.length) {
          ids = allClips(p).filter((c) => t > c.start && t < clipEnd(c) && !findClip(p, c.id).track.locked && !findClip(p, c.id).track.hidden).map((c) => c.id);
        }
        if (!ids.length) return toast('Posiziona la testina dentro un clip', { type: 'warn' });
        app.commit(side === 'left' ? 'Elimina a sinistra della testina' : 'Elimina a destra della testina', (d) => {
          let n = 0;
          let last = null;
          for (const id of ids) {
            try {
              trimToTime(d, id, side, t);
              n++;
            } catch (e) {
              if (!(e instanceof EditError)) throw e;
              last = e;
            }
          }
          if (!n) throw last ?? new EditError('Impossibile tagliare');
        });
      },
      deleteSelected() {
        const ids = app.selection.ids;
        if (!ids.length) return;
        const r = app.commit('Elimina', (d) => {
          if (!deleteClips(d, ids)) throw new EditError('Nessun clip eliminato');
        });
        if (r.ok) app.selection.clear();
      },
      rippleDeleteSelected() {
        const ids = app.selection.ids;
        if (!ids.length) return;
        const r = app.commit('Elimina e chiudi lo spazio', (d) => {
          if (!rippleDelete(d, ids)) throw new EditError('Nessun clip eliminato');
        });
        if (r.ok) app.selection.clear();
      },
      duplicate() {
        const ids = app.selection.ids;
        if (!ids.length) return;
        const r = app.commit('Duplica', (d) => duplicateClips(d, ids));
        if (r.ok) app.selection.set(r.result);
      },
      copy() {
        if (!app.selection.size) return;
        app.clipboard = copyClips(app.store.project, app.selection.ids);
        toast(`${app.selection.size === 1 ? 'Clip copiato' : `${app.selection.size} clip copiati`}`);
      },
      cut() {
        if (!app.selection.size) return;
        A.copy();
        A.deleteSelected();
      },
      paste(at = app.player.time) {
        if (!app.clipboard) return toast('Niente da incollare', { type: 'warn' });
        const r = app.commit('Incolla', (d) => pasteClips(d, app.clipboard, at));
        if (r.ok) app.selection.set(r.result);
      },
      selectAll() {
        app.selection.set(allClips(app.store.project).map((c) => c.id));
      },
      undo() {
        const label = app.store.undoLabel;
        if (app.store.undo()) toast(`Annullato: ${label}`, { ms: 1400 });
      },
      redo() {
        const label = app.store.redoLabel;
        if (app.store.redo()) toast(`Ripetuto: ${label}`, { ms: 1400 });
      },

      // ---- trasporto -----------------------------------------------------------
      togglePlay: () => app.player.toggle(),
      seekStart: () => app.player.seek(0),
      seekEnd: () => app.player.seek(app.player.duration),
      stepFrame: (n) => app.player.stepFrames(n),
      jump: (s) => app.player.seek(app.player.time + s),
      gotoEdit(dir) {
        const pts = snapPoints(app.store.project);
        const t = app.player.time;
        const target = dir < 0 ? [...pts].reverse().find((x) => x < t - 1e-3) : pts.find((x) => x > t + 1e-3);
        if (target !== undefined) {
          app.player.seek(target);
          app.timeline.ensureVisible(target);
        }
      },
      toggleLoop() {
        app.player.loop = !app.player.loop;
        app.preview.setLoop(app.player.loop);
      },
      seek: (t) => app.player.seek(t),

      // ---- marcatori e tracce ----------------------------------------------------
      addMarker(at = app.player.time) {
        app.commit('Aggiungi marcatore', (d) => addMarker(d, at));
      },
      removeMarker(id) {
        app.commit('Elimina marcatore', (d) => removeMarker(d, id));
      },
      goToMarker(id) {
        const m = app.store.project.markers.find((x) => x.id === id);
        if (m) app.player.seek(m.time);
      },
      async renameMarker(id) {
        const m = app.store.project.markers.find((x) => x.id === id);
        const name = m && (await promptDialog('Nome del marcatore', m.label));
        if (name !== null && name !== undefined) app.commit('Rinomina marcatore', (d) => { const q = d.markers.find((x) => x.id === id); if (q) q.label = name; });
      },
      addTrack(type) {
        app.commit('Aggiungi traccia', (d) => addTrack(d, type));
      },
      toggleTrackFlag(id, flag) {
        app.commit('Traccia', (d) => {
          const t = d.tracks.find((x) => x.id === id);
          if (t) t[flag] = !t[flag];
        });
      },
      async renameTrack(id) {
        const t = app.store.project.tracks.find((x) => x.id === id);
        const name = t && (await promptDialog('Nome della traccia', t.name));
        if (name) app.commit('Rinomina traccia', (d) => { const q = d.tracks.find((x) => x.id === id); if (q) q.name = name.slice(0, 40); });
      },
      moveTrack(id, dir) {
        app.commit('Sposta traccia', (d) => { if (!moveTrack(d, id, dir)) throw new EditError('La traccia non può spostarsi oltre'); });
      },
      removeTrack(id) {
        const t = app.store.project.tracks.find((x) => x.id === id);
        if (!t) return;
        const go = () => app.commit('Elimina traccia', (d) => removeTrack(d, id));
        if (!t.clips.length) return go();
        confirmDialog(`La traccia «${t.name}» contiene ${t.clips.length} clip che verranno eliminati.`, { confirmLabel: 'Elimina', danger: true, title: 'Eliminare la traccia?' }).then((yes) => yes && go());
      },

      // ---- aspetto del clip ----------------------------------------------------------
      applyFilter(id) {
        const ids = app.targets({ visual: true });
        if (!ids.length) return toast('Seleziona prima un clip a cui applicare il filtro', { type: 'warn' });
        app.commit('Filtro', (d) => {
          for (const cid of ids) {
            const c = findClip(d, cid).clip;
            c.filter = { id, intensity: c.filter?.id === id ? c.filter.intensity : 1 };
          }
        });
        if (!app.selection.size) app.selection.set(ids);
      },
      toggleEffect(type) {
        const ids = app.targets({ visual: true });
        if (!ids.length) return toast('Seleziona prima un clip a cui applicare l’effetto', { type: 'warn' });
        app.commit('Effetto', (d) => {
          for (const cid of ids) {
            const c = findClip(d, cid).clip;
            const i = c.effects.findIndex((e) => e.type === type);
            if (i >= 0) c.effects.splice(i, 1);
            else c.effects.push({ id: uid('e'), type, amount: EFFECTS.find((e) => e.id === type)?.amount ?? 50 });
          }
        });
        if (!app.selection.size) app.selection.set(ids);
      },
      addEffect(type) {
        if (!app.inspector.clipId) return;
        app.commit('Aggiungi effetto', (d) => { findClip(d, app.inspector.clipId).clip.effects.push({ id: uid('e'), type, amount: EFFECTS.find((e) => e.id === type)?.amount ?? 50 }); });
      },
      removeEffect(id) {
        if (!app.inspector.clipId) return;
        app.commit('Rimuovi effetto', (d) => { const c = findClip(d, app.inspector.clipId).clip; c.effects = c.effects.filter((e) => e.id !== id); });
      },
      applyTransition(type, duration) {
        const ids = app.targets({ visual: true });
        if (!ids.length) return toast('Seleziona prima un clip: la transizione si applica al suo inizio', { type: 'warn' });
        app.commit('Transizione', (d) => {
          for (const cid of ids) setTransition(d, cid, type === 'none' ? null : { type, duration });
        });
        if (!app.selection.size) app.selection.set(ids);
      },
      /** Importa una LUT 3D (.cube) nel progetto e la applica al clip selezionato. */
      async importLut(file) {
        const id = app.inspector.clipId;
        if (!id) return;
        if (file.size > 20 * 1024 * 1024) return toast('Il file è troppo grande per essere una LUT.', { type: 'warn' });
        let lut;
        try {
          lut = parseCube(await file.text());
        } catch (e) {
          return toast(`LUT non valida: ${e.message}`, { type: 'warn' });
        }
        const lid = uid('lut');
        const r = app.commit('Importa LUT', (d) => {
          d.luts ??= {};
          d.luts[lid] = encodeLut(lut);
          const c = findClip(d, id)?.clip;
          if (!c) throw new EditError('Clip non trovato');
          c.grade.lut = { id: lid, intensity: 100 };
        });
        if (r.ok) toast(`LUT «${lut.name}» applicata.`, { type: 'success' });
      },
      resetAdjust() {
        const id = app.inspector.clipId;
        if (!id) return;
        app.commit('Azzera regolazioni', (d) => {
          const c = findClip(d, id).clip;
          c.adjust = createClip('image').adjust;
          c.grade = defaultGrade();
          c.filter = { id: 'none', intensity: 1 };
        });
      },
      fitClip(mode) {
        const id = app.inspector.clipId;
        if (!id) return;
        const { settings } = app.store.project;
        app.commit(mode === 'reset' ? 'Azzera trasformazione' : mode === 'fit' ? 'Adatta' : 'Riempi', (d) => {
          const c = findClip(d, id).clip;
          if (mode === 'reset') {
            c.transform.x = 0; c.transform.y = 0; c.transform.scale = 1; c.transform.rotation = 0; c.transform.opacity = 1;
            for (const k of ['x', 'y', 'scale', 'rotation', 'opacity']) delete c.keyframes[k];
            return;
          }
          if (mode === 'fit') {
            c.transform.scale = 1;
            delete c.keyframes.scale;
            return;
          }
          const g = app.renderer.geometry({ ...d, settings }, c, c.start, settings.width, settings.height);
          if (!g) return;
          c.transform.scale = clamp(valueAt(c, 'scale', 0) * Math.max(settings.width / g.w, settings.height / g.h), 0.05, 20);
          c.transform.x = 0;
          c.transform.y = 0;
          delete c.keyframes.scale;
        });
      },
      flipClip(key) {
        const id = app.inspector.clipId;
        if (id) app.commit('Ribalta', (d) => { const c = findClip(d, id).clip; c.transform[key] = !c.transform[key]; });
      },
      toggleKeyframe(prop) {
        const id = app.inspector.clipId;
        if (!id) return;
        app.commit('Keyframe', (d) => {
          const c = findClip(d, id).clip;
          toggleKeyframe(c, prop, clamp(app.player.time - c.start, 0, c.duration));
        });
      },
      clearKeyframes(prop) {
        const id = app.inspector.clipId;
        if (id) app.commit('Rimuovi keyframe', (d) => { delete findClip(d, id).clip.keyframes[prop]; });
      },

      // ---- progetto -----------------------------------------------------------------
      setAspect(a) {
        app.commit('Formato', (d) => {
          d.settings.width = a.width;
          d.settings.height = a.height;
        });
      },
      setFps(n) {
        app.commit('Frequenza fotogrammi', (d) => { d.settings.fps = n; });
      },
      toggleTheme() {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        app.#applyTheme(next);
        prefs.set('theme', next);
        app.themeBtn.replaceChildren(icon(next === 'dark' ? 'sun' : 'moon', 18));
      },
      focusInspectorText: () => app.inspector.focusText(),
      saveNow() {
        app.#save.flush?.();
        app.#save();
        toast('Il progetto viene salvato automaticamente nel browser', { ms: 1800 });
      },

      async newProject() {
        const has = allClips(app.store.project).length || Object.keys(app.store.project.media).length;
        if (has && !(await confirmDialog('Il progetto corrente verrà chiuso e i suoi dati rimossi dal browser. Esporta o salva un pacchetto .ciak se vuoi conservarlo.', { confirmLabel: 'Nuovo progetto', danger: true, title: 'Iniziare un nuovo progetto?' }))) return;
        await app.#reset(createProject());
        toast('Nuovo progetto creato');
      },

      // ---- audio: estrai, fermo immagine, voce, font -----------------------------------
      detachAudio() {
        const id = app.selection.primary;
        const f = id && findClip(app.store.project, id);
        if (!f || f.clip.kind !== 'video') return toast('Seleziona un clip video', { type: 'warn' });
        if (app.pool.info(f.clip.mediaId) && !app.pool.info(f.clip.mediaId).peaks && app.pool.info(f.clip.mediaId).hasAudio === false) return toast('Questo video non contiene audio', { type: 'warn' });
        const r = app.commit('Estrai audio', (d) => {
          const { clip } = findClip(d, id);
          const ac = createClip('audio', { name: `Audio · ${clip.name}`, mediaId: clip.mediaId, start: clip.start, duration: clip.duration, in: clip.in, speed: clip.speed, volume: clip.volume });
          const track = trackWithRoom(d, 'audio', clip.start, clip.duration);
          addClip(d, track.id, ac, clip.start);
          clip.muted = true;
          return ac;
        });
        if (r.ok) toast('Audio estratto su una traccia separata', { type: 'success' });
      },

      async freezeFrame() {
        const id = app.selection.primary;
        const f = id && findClip(app.store.project, id);
        if (!f || f.clip.kind !== 'video') return toast('Seleziona un clip video', { type: 'warn' });
        const clip = f.clip;
        const t = quantize(clamp(app.player.time, clip.start, clipEnd(clip)), app.store.project.settings.fps);
        app.player.pause();
        app.player.seek(t);
        await app.player.settle();
        const el = app.pool.peek(clip.id);
        const m = app.store.project.media[clip.mediaId];
        if (!el || el.readyState < 2) return toast('Fotogramma non disponibile, riprova', { type: 'warn' });
        try {
          const blob = await captureFrameBlob(el, el.videoWidth, el.videoHeight);
          const mid = uid('m');
          const file = new File([blob], `Fermo immagine ${formatDuration(t, 1)}.png`, { type: 'image/png' });
          app.pool.add(mid, file);
          app.storage.putMedia(mid, file).catch(() => {});
          const r = app.commit('Fotogramma fisso', (d) => {
            d.media[mid] = { id: mid, name: file.name, kind: 'image', mime: 'image/png', size: file.size, duration: 0, width: el.videoWidth, height: el.videoHeight, hasAudio: false };
            return insertFreezeFrame(d, clip.id, t, mid, 2);
          });
          if (r.ok) {
            app.selection.set([r.result.id]);
            app.#enrich(mid, true);
            toast('Fotogramma fisso inserito (2 s)', { type: 'success' });
          } else app.pool.removeMedia(mid);
        } catch (e) {
          toast(`Fotogramma fisso non riuscito: ${e.message}`, { type: 'error' });
        }
        void m;
      },

      async toggleVoiceRecording() {
        if (!VoiceRecorder.supported()) return toast('La registrazione audio non è supportata da questo browser', { type: 'error' });
        if (!A.recording) {
          try {
            await app.voice.start();
          } catch (e) {
            return toast(e?.name === 'NotAllowedError' ? 'Permesso al microfono negato' : `Microfono non disponibile: ${e.message}`, { type: 'error' });
          }
          A.recording = true;
          app.recStart = app.player.time;
          app.events.emit('voice');
          toast('Registrazione in corso… la timeline scorre mentre parli', { ms: 3500 });
          app.player.play();
        } else {
          A.recording = false;
          app.events.emit('voice');
          app.player.pause();
          try {
            const { blob, seconds } = await app.voice.stop();
            if (seconds < 0.3) return toast('Registrazione troppo breve', { type: 'warn' });
            const n = Object.values(app.store.project.media).filter((m) => m.name.startsWith('Voce')).length + 1;
            const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
            const file = new File([blob], `Voce ${n}.${ext}`, { type: blob.type });
            await A.importFiles([file], { addToTimeline: true, start: app.recStart });
          } catch (e) {
            toast(`Registrazione non riuscita: ${e.message}`, { type: 'error' });
          }
        }
      },

      async loadFont(file) {
        try {
          const name = file.name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 40) || 'Font';
          const face = new FontFace(name, await file.arrayBuffer());
          await face.load();
          document.fonts.add(face);
          if (!app.customFonts.includes(name)) app.customFonts.push(name);
          app.fontsVersion++;
          app.inspector.refresh?.();
          toast(`Font «${name}» caricato (disponibile in questa sessione)`, { type: 'success' });
        } catch {
          toast('Font non valido', { type: 'error' });
        }
      },

      // ---- sottotitoli ------------------------------------------------------------------
      async importSubtitles(file) {
        try {
          const { format, cues } = parseSubtitles(await file.text(), file.name);
          if (!cues.length) return toast('Nessun sottotitolo valido nel file', { type: 'warn' });
          // il testo semplice non ha tempi: parte dalla testina
          const shift = format === 'txt' ? quantize(app.player.time, app.store.project.settings.fps) : 0;
          const r = app.commit('Importa sottotitoli', (d) => {
            let sub = d.tracks.find((t) => t.type === 'video' && t.name === 'Sottotitoli');
            if (!sub) sub = addTrack(d, 'video', { index: 0, name: 'Sottotitoli' });
            for (const cue of cues) {
              const style = structuredClone(SUBTITLE_STYLES[cue.words ? 'karaoke' : 'classic']);
              const text = { ...style, content: cue.text };
              if (cue.words) text.words = cue.words.map((w) => ({ t: w.t, w: w.w }));
              const clip = createClip('text', { name: cue.text.slice(0, 30), role: 'subtitle', start: cue.start + shift, duration: Math.max(0.2, cue.end - cue.start), text, transform: { y: 0.36 } });
              const track = trackWithRoom(d, 'video', clip.start, clip.duration, { preferId: sub.id, fromTop: true });
              addClip(d, track.id, clip, clip.start);
            }
          });
          if (r.ok) toast(`${cues.length} sottotitoli importati (${format.toUpperCase()})`, { type: 'success' });
        } catch (e) {
          toast(`Importazione dei sottotitoli non riuscita: ${e.message}`, { type: 'error' });
        }
      },
      importSrt(file) {
        return this.importSubtitles(file);
      },
      /** Sposta tutti i sottotitoli di `delta` secondi (anche negativo): per sincronizzarli con il parlato. */
      shiftSubtitles(delta) {
        if (!Number.isFinite(delta) || delta === 0) return toast('Scrivi di quanti secondi spostare (anche negativo).', { type: 'warn' });
        const ids = allClips(app.store.project).filter((c) => c.role === 'subtitle').map((c) => c.id);
        if (!ids.length) return toast('Non ci sono sottotitoli da spostare', { type: 'warn' });
        const plan = planMove(app.store.project, ids, delta);
        if (!plan) return toast('Non si possono spostare così: uscirebbero dalla timeline', { type: 'warn' });
        const r = app.commit('Sposta sottotitoli', (d) => moveClips(d, ids, plan.delta, plan.offset));
        if (r.ok && Math.abs(plan.delta - delta) > 0.01) toast(`Spostati di ${plan.delta.toFixed(2)} s (il resto non era possibile)`, { type: 'info' });
      },
      /** Apre o chiude la finestra del teleprompter (copione che scorre da solo). */
      toggleTeleprompter() {
        app.prompter.toggle();
      },
      /** Registratore di schermo, webcam o entrambi: finestra di scelta, poi barra rossa con tempo e «Ferma». */
      openRecorder() {
        if (!recorderSupported()) return toast('Questo browser non sa registrare.', { type: 'warn' });
        if (app.screenRec.recording) return A.stopRecording();
        const desk = globalThis.ciakDesktop?.listSources ? globalThis.ciakDesktop : null;
        const canScreen = screenSupported() || !!desk;
        const modes = RECORD_MODES.filter((m) => canScreen || m.id === 'webcam');
        const sel = h('select', { id: 'rec-mode', 'aria-label': 'Cosa registrare' }, modes.map((m) => h('option', { value: m.id }, m.label)));
        const mic = h('input', { type: 'checkbox', id: 'rec-mic', checked: true, 'aria-label': 'Registra anche il microfono' });
        const prompter = h('input', { type: 'checkbox', id: 'rec-prompter', checked: app.prompter.isOpen, 'aria-label': 'Teleprompter durante la registrazione' });
        const sys = h('input', { type: 'checkbox', id: 'rec-sys', 'aria-label': 'Registra anche l’audio del computer' });
        const body = h('div', { class: 'exp-form' },
          h('div', { class: 'ctl select' }, h('label', { class: 'ctl-label' }, 'Cosa registrare'), sel),
          h('label', { class: 'check' }, mic, h('span', {}, 'Registra anche la mia voce (microfono)')),
          canScreen ? h('label', { class: 'check' }, sys, h('span', {}, 'Registra anche l’audio del computer', h('small', {}, ' (solo Windows e Chrome/Edge: usa le cuffie per evitare l’eco)'))) : null,
          h('label', { class: 'check' }, prompter, h('span', {}, 'Mostra il teleprompter e fallo partire con la registrazione', h('small', {}, ' (il copione si scrive nella sua finestra)'))),
          h('p', { class: 'hint' }, 'La registrazione finisce nella libreria e viene messa subito sulla timeline alla posizione della testina.'));
        openDialog({ title: 'Registra', content: body, actions: [{ label: 'Annulla' }, { label: 'Inizia a registrare', primary: true, id: 'rec-go', onClick: () => { A.startRecording({ mode: sel.value, mic: mic.checked, systemAudio: sys.checked, prompter: prompter.checked }); return true; } }] });
      },
      async startRecording({ mode, mic, systemAudio, prompter = false }) {
        try {
          if (mode !== 'webcam' && globalThis.ciakDesktop?.listSources && !(await app.#pickCaptureSource(systemAudio))) return;
          await app.screenRec.start({ mode, mic, systemAudio }, { onEnded: () => A.stopRecording() });
        } catch (e) {
          if (!e.cancelled) toast(e.message, { type: 'error' });
          return;
        }
        app.#showRecBar();
        if (prompter) app.prompter.start();
        toast('Registrazione in corso…', { ms: 2500 });
      },
      async stopRecording() {
        if (!app.screenRec.recording) return;
        const mode = app.screenRec.mode;
        app.prompter.pause();
        app.#hideRecBar();
        try {
          const { blob, seconds } = await app.screenRec.stop();
          const stamp = new Date().toLocaleString('it-IT').replace(/[/:]/g, '.').replace(', ', ' ');
          const file = new File([blob], `Registrazione ${mode === 'screen' ? 'schermo' : mode === 'webcam' ? 'webcam' : 'schermo e webcam'} ${stamp}.webm`, { type: blob.type });
          if (seconds < 0.5) return toast('Registrazione troppo breve.', { type: 'warn' });
          await A.importFiles([file], { addToTimeline: true, start: app.player.time });
        } catch (e) {
          toast(`Registrazione non riuscita: ${e.message}`, { type: 'error' });
        }
      },
      /**
       * Strumenti video con ffmpeg (programma per computer): al contrario, stabilizza, meno disturbo, più nitido,
       * senza sfarfallio, ingrandisci, più fluido, super rallentatore. Il risultato è un nuovo file che prende il posto
       * di quello del clip (annullabile); l'originale resta nella libreria.
       */
      async applyVideoTool({ clipId, tool }) {
        const d = globalThis.ciakDesktop;
        if (!d?.videoTool) return toast('Questo strumento richiede il programma per computer.', { type: 'warn' });
        const f = findClip(app.store.project, clipId ?? app.inspector.clipId);
        if (!f || f.clip.kind !== 'video') return toast('Seleziona un clip video', { type: 'warn' });
        const clip = f.clip;
        const src = app.store.project.media[clip.mediaId];
        const blob = app.pool.blob(clip.mediaId);
        if (!blob || !src) return toast('File non disponibile.', { type: 'warn' });
        const LABEL = { reverse: 'Al contrario', denoise: 'Meno disturbo', enhance: 'Più nitido', deflicker: 'Senza sfarfallio', upscale: 'Ingrandito 2×', smooth: 'Più fluido', slowmo: 'Super rallentatore', stabilize: 'Stabilizzato' };
        const progress = toast(`${LABEL[tool] ?? 'Elaborazione'}… può richiedere qualche minuto`, { ms: 600000 });
        const off = d.onConvertProgress((v) => { const m = progress.querySelector('.toast-msg'); if (m) m.textContent = `${LABEL[tool]}… ${Math.round(v * 100)}%`; });
        try {
          const r = await d.videoTool(await blob.arrayBuffer(), { tool, duration: src.duration });
          if (!r.ok) throw new Error(r.error);
          const file = new File([r.video], `${clip.name || src.name} · ${LABEL[tool]}.mp4`, { type: 'video/mp4' });
          const meta = await probeMedia(file);
          const mid = uid('m');
          app.pool.add(mid, file);
          app.pool.setInfo(mid, { thumb: meta.thumb });
          app.storage.putMedia(mid, file).catch(() => {});
          const rr = app.commit(`Video: ${LABEL[tool]}`, (dr) => {
            dr.media[mid] = { id: mid, name: file.name, kind: 'video', mime: 'video/mp4', size: file.size, duration: meta.duration, width: meta.width, height: meta.height, hasAudio: true };
            const q = findClip(dr, clip.id).clip;
            const used = q.duration * q.speed;
            if (tool === 'reverse') q.in = Math.max(0, meta.duration - (q.in + used)); // si guarda la stessa parte, ma all'indietro
            q.mediaId = mid;
            q.in = Math.min(q.in, Math.max(0, meta.duration - 0.05));
            if (tool === 'slowmo') setSpeed(dr, q.id, 0.25);
            q.duration = Math.min(q.duration, (meta.duration - q.in) / q.speed);
            return q;
          });
          if (rr.ok) {
            app.#enrich(mid, true);
            toast(`${LABEL[tool]}: fatto.`, { type: 'success' });
          } else app.pool.removeMedia(mid);
        } catch (e) {
          toast(e.message, { type: 'warn' });
        } finally {
          off();
          progress.remove();
        }
      },
      /** Strumento a parte: comprime o converte in MP4 un video qualsiasi del computer (richiede il programma per computer). */
      openTranscode() {
        const d = globalThis.ciakDesktop;
        if (!d?.transcodeFile) return toast('Questa funzione richiede il programma per computer.', { type: 'warn' });
        const sel = h('select', { id: 'tc-preset', 'aria-label': 'Cosa fare' },
          h('option', { value: 'compress720' }, 'Comprimi (720p, file molto più piccolo)'),
          h('option', { value: 'compress480' }, 'Comprimi molto (480p)'),
          h('option', { value: 'convert' }, 'Converti in MP4 (stessa risoluzione, buona qualità)'));
        const progress = h('progress', { max: 1, value: 0, hidden: true, class: 'exp-progress', 'aria-label': 'Avanzamento' });
        const status = h('p', { class: 'hint', id: 'tc-status', role: 'status' });
        const body = h('div', { class: 'exp-form' }, h('div', { class: 'ctl select' }, h('label', { class: 'ctl-label' }, 'Cosa fare'), sel), h('p', { class: 'hint' }, 'Scegli un video qualsiasi del tuo computer: viene ricodificato in MP4 (H.264/AAC), adatto a chat, e-mail e social. L’originale non viene toccato.'), progress, status);
        let ctl;
        const start = { label: 'Scegli il video e avvia', primary: true, id: 'tc-start', onClick: async () => {
          progress.hidden = false;
          progress.value = 0;
          status.textContent = 'Scegli il file…';
          ctl.setActions([{ label: 'Annulla', danger: true, id: 'tc-cancel', onClick: () => { d.cancelConvert(); return false; } }]);
          const off = d.onConvertProgress((v) => { progress.value = v; status.textContent = `Conversione… ${Math.round(v * 100)}%`; });
          const r = await d.transcodeFile({ preset: sel.value });
          off();
          progress.hidden = true;
          if (r.ok) {
            const pct = Math.round((1 - r.bytesOut / r.bytesIn) * 100);
            status.replaceChildren(h('span', { class: 'ok', id: 'tc-done' }, icon('check', 16), ` Fatto: ${r.path.split(/[\\/]/).pop()} · ${formatBytes(r.bytesIn)} → ${formatBytes(r.bytesOut)}${pct > 0 ? ` (${pct}% in meno)` : ''}`), ' ', h('button', { class: 'btn small', type: 'button', onClick: () => d.showInFolder(r.path) }, 'Mostra nella cartella'));
            ctl.setActions([{ label: 'Chiudi', primary: true, id: 'close' }]);
          } else {
            status.textContent = r.canceled ? '' : r.error;
            ctl.setActions([{ label: 'Chiudi', id: 'close' }, start]);
          }
          return false;
        } };
        ctl = openDialog({ title: 'Comprimi o converti un video', content: body, actions: [{ label: 'Chiudi' }, start] });
      },
      /** «Voce da testo»: finestra con testo, voce e velocità; il risultato diventa un clip audio alla testina. */
      async openSpeech() {
        const d = globalThis.ciakDesktop;
        if (!d?.ttsVoices) return toast('La voce da testo richiede il programma per computer.', { type: 'warn' });
        const voices = await d.ttsVoices();
        if (!voices.length) return toast('Nel tuo computer non c’è nessuna voce di sistema: su Windows e macOS sono incluse, su Linux serve «espeak-ng».', { type: 'warn' });
        const text = h('textarea', { rows: 6, id: 'tts-text', maxlength: 6000, placeholder: 'Scrivi qui ciò che deve dire la voce…', 'aria-label': 'Testo da pronunciare' });
        const sel = h('select', { id: 'tts-voice', 'aria-label': 'Voce' }, voices.map((v) => h('option', { value: v.id }, `${v.name} (${v.lang})`)));
        const it = voices.find((v) => /^it/i.test(v.lang));
        if (it) sel.value = it.id;
        const rate = h('input', { type: 'range', id: 'tts-rate', min: '0.5', max: '2', step: '0.1', value: '1', 'aria-label': 'Velocità' });
        const rateLabel = h('span', {}, '1,0×');
        rate.addEventListener('input', () => { rateLabel.textContent = `${Number(rate.value).toFixed(1).replace('.', ',')}×`; });
        const status = h('p', { class: 'hint', id: 'tts-status', role: 'status' });
        let audio = null;
        const synth = async () => {
          if (!text.value.trim()) throw new Error('Scrivi il testo da pronunciare.');
          status.textContent = 'Preparo la voce…';
          const r = await d.tts(text.value, { voice: sel.value, rate: Number(rate.value) });
          if (!r.ok) throw new Error(r.error);
          status.textContent = '';
          return new Uint8Array(r.wav);
        };
        const ctl = openDialog({
          title: 'Voce da testo',
          content: h('div', { class: 'exp-form' }, h('div', { class: 'ctl select' }, h('label', { class: 'ctl-label' }, 'Testo'), text), h('div', { class: 'ctl select' }, h('label', { class: 'ctl-label' }, 'Voce'), sel), h('div', { class: 'ctl select' }, h('label', { class: 'ctl-label' }, 'Velocità'), rate, rateLabel), status,
            h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', id: 'btn-tts-preview', onClick: async () => {
              try {
                const wav = await synth();
                audio?.pause();
                audio = new Audio(URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })));
                await audio.play();
              } catch (e) {
                status.textContent = e.message;
              }
            } }, icon('play', 14), 'Ascolta'))),
          actions: [{ label: 'Chiudi' }, { label: 'Aggiungi alla timeline', primary: true, id: 'tts-add', onClick: async () => {
            try {
              const wav = await synth();
              audio?.pause();
              A.addSpeechClip(wav, text.value.trim());
              return true;
            } catch (e) {
              status.textContent = e.message;
              return false;
            }
          } }],
          onClose: () => audio?.pause(),
        });
        void ctl;
      },
      /** Inserisce un audio WAV già pronto come clip alla testina (nuovo file nel progetto). */
      addSpeechClip(wavBytes, label) {
        const { channels, sampleRate } = decodeWav(wavBytes);
        const dur = channels[0].length / sampleRate;
        const mid = uid('m');
        const name = `Voce · ${label.replace(/\s+/g, ' ').slice(0, 32) || 'testo'}`;
        const file = new File([wavBytes], `${name}.wav`, { type: 'audio/wav' });
        app.pool.add(mid, file);
        app.storage.putMedia(mid, file).catch(() => {});
        const start = quantize(app.player.time, app.store.project.settings.fps);
        const r = app.commit('Voce da testo', (d) => {
          d.media[mid] = { id: mid, name: file.name, kind: 'audio', mime: 'audio/wav', size: file.size, duration: dur, width: 0, height: 0, hasAudio: true };
          const clip = createClip('audio', { name, mediaId: mid, start, duration: dur });
          const track = trackWithRoom(d, 'audio', start, dur);
          addClip(d, track.id, clip, start);
          return clip;
        });
        if (r.ok) {
          app.selection.set([r.result.id]);
          app.#enrich(mid, true);
          toast('Voce aggiunta alla timeline.', { type: 'success' });
        } else app.pool.removeMedia(mid);
        return r;
      },
      /** Porzione di audio del clip (la parte di file che il clip usa), decodificata: la base degli effetti e dell'analisi. */
      async clipAudio(clip) {
        const blob = app.pool.blob(clip.mediaId);
        if (!blob) throw new Error('File non disponibile.');
        const { channels, sampleRate } = await decodeAudio(blob);
        const a = Math.max(0, Math.floor(clip.in * sampleRate));
        const b = Math.min(channels[0].length, Math.ceil((clip.in + clip.duration * clip.speed) * sampleRate));
        if (b - a < sampleRate * 0.05) throw new Error('La parte di audio usata dal clip è troppo breve.');
        return { channels: channels.map((c) => c.slice(a, b)), sampleRate };
      },
      /**
       * Effetti audio «offline»: riduzione del rumore, voci, altezza, togli/isola la voce. Il risultato è un nuovo file audio
       * che prende il posto della parte usata (per i video: un clip audio separato, mentre l'audio originale si silenzia).
       */
      async applyAudioFx({ clipId, kind, id, amount = 70, semitones = 0 }) {
        const f = findClip(app.store.project, clipId ?? app.inspector.clipId);
        if (!f || (f.clip.kind !== 'audio' && f.clip.kind !== 'video')) return toast('Seleziona un clip audio o video', { type: 'warn' });
        const clip = f.clip;
        const working = toast('Elaborazione dell’audio…', { ms: 120000 });
        try {
          const { channels, sampleRate } = await A.clipAudio(clip);
          let out;
          if (kind === 'noise') out = noiseReduce(channels, { amount: amount / 100 });
          else if (kind === 'pitch') {
            if (!semitones) throw new Error('Scegli di quanti semitoni cambiare il tono.');
            out = pitchShift(channels, semitones);
          } else if (kind === 'voice') out = applyVoiceEffect(channels, sampleRate, id);
          else if (kind === 'removeVoice') out = removeVoice(channels);
          else if (kind === 'isolateVoice') out = isolateVoice(channels, sampleRate);
          else throw new Error('Effetto sconosciuto');
          const label = { noise: 'Meno rumore', pitch: `Tono ${semitones > 0 ? '+' : ''}${semitones}`, voice: VOICE_EFFECTS[id]?.label ?? 'Effetto', removeVoice: 'Senza voce', isolateVoice: 'Solo voce' }[kind];
          const bytes = encodeWav(out, sampleRate);
          const mid = uid('m');
          const file = new File([bytes], `${clip.name || 'Audio'} · ${label}.wav`, { type: 'audio/wav' });
          const dur = out[0].length / sampleRate;
          app.pool.add(mid, file);
          app.storage.putMedia(mid, file).catch(() => {});
          const r = app.commit(`Audio: ${label}`, (d) => {
            d.media[mid] = { id: mid, name: file.name, kind: 'audio', mime: 'audio/wav', size: file.size, duration: dur, width: 0, height: 0, hasAudio: true };
            const q = findClip(d, clip.id).clip;
            if (q.kind === 'audio') {
              q.mediaId = mid;
              q.in = 0;
              q.duration = Math.min(q.duration, dur / q.speed);
              q.name = file.name;
              return q;
            }
            const ac = createClip('audio', { name: `${label} · ${q.name}`, mediaId: mid, start: q.start, duration: Math.min(q.duration, dur / q.speed), in: 0, speed: q.speed, volume: q.volume });
            const track = trackWithRoom(d, 'audio', q.start, ac.duration);
            addClip(d, track.id, ac, q.start);
            q.muted = true;
            return ac;
          });
          if (r.ok) {
            app.#enrich(mid, true);
            toast(`${label}: fatto.`, { type: 'success' });
          } else app.pool.removeMedia(mid);
        } catch (e) {
          toast(e.message, { type: 'warn' });
        } finally {
          working?.remove?.();
        }
      },
      /** Porta il volume del clip a un livello costante (come «normalizza» di CapCut). */
      async normalizeClip({ clipId, targetDb = -16 }) {
        const f = findClip(app.store.project, clipId ?? app.inspector.clipId);
        if (!f || (f.clip.kind !== 'audio' && f.clip.kind !== 'video')) return toast('Seleziona un clip audio o video', { type: 'warn' });
        try {
          const { channels, sampleRate } = await A.clipAudio(f.clip);
          const before = loudness(channels, sampleRate);
          if (before.rmsDb < -80) return toast('Questo clip è praticamente muto.', { type: 'warn' });
          const gain = normalizeGain(applyGain(channels, f.clip.volume), sampleRate, { targetDb, ceilDb: -1 });
          const vol = Math.min(4, f.clip.volume * gain);
          app.commit('Normalizza il volume', (d) => { findClip(d, f.clip.id).clip.volume = vol; });
          toast(`Volume portato a ${Math.round(vol * 100)}% (livello medio ${targetDb} dB).`, { type: 'success' });
        } catch (e) {
          toast(e.message, { type: 'warn' });
        }
      },
      /** Trova i battiti della musica e li segna con dei marcatori sulla timeline. */
      async findBeats({ clipId }) {
        const f = findClip(app.store.project, clipId ?? app.inspector.clipId);
        if (!f || (f.clip.kind !== 'audio' && f.clip.kind !== 'video')) return toast('Seleziona un clip audio o video', { type: 'warn' });
        const clip = f.clip;
        const working = toast('Ascolto il ritmo…', { ms: 120000 });
        try {
          const { channels, sampleRate } = await A.clipAudio(clip);
          const r = detectBeats(channels, sampleRate);
          if (!r.bpm || !r.beats.length) return toast('Non sento un ritmo regolare in questo audio.', { type: 'warn' });
          const times = r.beats.slice(0, 600).map((t) => clip.start + t / clip.speed).filter((t) => t < clipEnd(clip));
          app.commit('Segna i battiti', (d) => {
            d.markers = d.markers.filter((m) => m.label !== 'Battito');
            for (const t of times) addMarker(d, t, 'Battito');
          });
          app.timeline.ensureVisible(times[0]);
          toast(`Trovati ${times.length} battiti (circa ${Math.round(r.bpm)} al minuto).`, { type: 'success' });
        } catch (e) {
          toast(e.message, { type: 'warn' });
        } finally {
          working?.remove?.();
        }
      },
      /** Divide i clip selezionati (o quelli sotto i battiti) a tempo di musica: ogni `every` battiti. */
      cutOnBeats({ every = 1 }) {
        const p = app.store.project;
        const beats = p.markers.filter((m) => m.label === 'Battito').map((m) => m.time).sort((a, b) => a - b);
        if (!beats.length) return toast('Prima trova i battiti di una musica (sezione «Ritmo»).', { type: 'warn' });
        let ids = app.selection.ids.filter((id) => { const c = findClip(p, id)?.clip; return c && isVisualKind(c.kind); });
        if (!ids.length) ids = allClips(p).filter((c) => isVisualKind(c.kind) && c.role !== 'subtitle').map((c) => c.id);
        const cuts = beats.filter((_, i) => i % Math.max(1, every) === 0);
        let n = 0;
        const r = app.commit('Taglia a tempo di musica', (d) => {
          for (const t of cuts) {
            for (const id of [...ids]) {
              const c = findClip(d, id)?.clip;
              if (!c || !(t > c.start + 0.05 && t < clipEnd(c) - 0.05)) continue;
              try {
                const right = splitClip(d, id, t);
                ids.push(right.id); // la parte destra può essere divisa dai battiti successivi
                n++;
              } catch (e) {
                if (!(e instanceof EditError)) throw e;
              }
            }
          }
          if (!n) throw new EditError('I battiti non cadono dentro i clip scelti.');
        });
        if (r.ok) toast(`Fatti ${n} tagli a tempo.`, { type: 'success' });
      },
      /** Toglie le pause (silenzi) dal clip: dall'inviluppo audio già calcolato, senza rielaborare il file. */
      removeSilences({ clipId, threshold, minSilence, keep, all = true }) {
        const f = findClip(app.store.project, clipId ?? app.inspector.clipId);
        if (!f) return;
        const info = app.pool.info(f.clip.mediaId);
        if (!info?.peaks) return toast('Questo file non ha un audio analizzabile (o l’analisi non è ancora finita).', { type: 'warn' });
        const sil = findSilences(info.peaks, info.peaksRate, { from: f.clip.in, to: f.clip.in + f.clip.duration * f.clip.speed, threshold: threshold / 100, minSilence, keep });
        if (!sil.length) return toast('Nessuna pausa trovata con queste impostazioni.', { type: 'warn' });
        const r = app.commit('Rimuovi le pause', (d) => removeSilences(d, f.clip.id, sil, { trackIds: all ? null : [f.track.id] }));
        if (r.ok) toast(`Tolte ${r.result.cuts} pause (${r.result.removed.toFixed(1)} s).`, { type: 'success' });
      },
      /** «Modifica da trascrizione»: toglie dal video, da tutte le tracce, l'intervallo di un sottotitolo e chiude il buco. */
      cutSubtitle(id) {
        const c = findClip(app.store.project, id)?.clip;
        if (!c) return;
        const r = app.commit('Taglia dal video', (d) => {
          const q = findClip(d, id).clip;
          cutRange(d, q.start, q.start + q.duration);
        });
        if (r.ok) toast('Tolto dal video e dal resto delle tracce.', { type: 'success' });
      },
      addSubtitleHere() {
        const clip = createClip('text', { name: 'Sottotitolo', role: 'subtitle', start: app.player.time, duration: 2, text: { ...structuredClone(SUBTITLE_STYLES.classic), content: 'Nuovo sottotitolo' }, transform: { y: 0.36 } });
        app.#place(clip, 'Aggiungi sottotitolo');
      },
      setSubtitleText(id, text) {
        app.store.commit('Modifica sottotitolo', (d) => {
          const c = findClip(d, id)?.clip;
          if (c) {
            c.text.content = text || ' ';
            c.name = text.slice(0, 30);
          }
        }, { coalesce: `sub:${id}` });
      },
      styleSubtitles(styleId) {
        const style = SUBTITLE_STYLES[styleId];
        const subs = allClips(app.store.project).filter((c) => c.role === 'subtitle');
        if (!subs.length) return toast('Non ci sono sottotitoli da stilizzare', { type: 'warn' });
        app.commit('Stile sottotitoli', (d) => {
          for (const s of allClips(d).filter((c) => c.role === 'subtitle')) Object.assign(s.text, structuredClone(style));
        });
      },
      exportSubtitles(format = 'srt') {
        if (!SUBTITLE_FORMATS.includes(format) || format === 'ass') format = 'srt';
        const p = app.store.project;
        let clips = allClips(p).filter((c) => c.kind === 'text' && c.role === 'subtitle');
        if (!clips.length) clips = allClips(p).filter((c) => c.kind === 'text');
        if (!clips.length) return toast('Non ci sono testi da esportare', { type: 'warn' });
        const cues = clips.sort((a, b) => a.start - b.start).map((c) => ({ start: c.start, end: c.start + c.duration, text: c.text.content.trim() }));
        const body = format === 'srt' ? formatSrt(cues) : WRITERS[format](cues);
        downloadBlob(new Blob([body], { type: `${MIME[format]};charset=utf-8` }), `${p.name}.${format}`);
        toast(`${cues.length} sottotitoli esportati (.${format})`, { type: 'success' });
      },
      exportSrt() {
        return this.exportSubtitles('srt');
      },

      // ---- pacchetto .ciak ------------------------------------------------------------------
      async savePackage() {
        const p = app.store.project;
        const ids = Object.keys(p.media).filter((id) => app.pool.has(id));
        const total = ids.reduce((s, id) => s + (app.pool.blob(id)?.size ?? 0), 0);
        if (total > 600 * 1024 * 1024 && !(await confirmDialog(`Il pacchetto supera ${formatBytes(total)} e verrà costruito in memoria: potrebbe essere lento. Continuare?`, { confirmLabel: 'Continua' }))) return;
        const t = toast('Creazione del pacchetto…', { ms: 60000 });
        try {
          const files = [{ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify({ format: 'ciak-studio', version: 1, created: new Date().toISOString() })) }, { name: 'project.json', data: new TextEncoder().encode(JSON.stringify(p)) }];
          for (const id of ids) files.push({ name: `media/${id}`, data: new Uint8Array(await app.pool.blob(id).arrayBuffer()) });
          downloadBlob(new Blob([zipStore(files)], { type: 'application/zip' }), `${p.name}.ciak`);
          toast('Pacchetto salvato', { type: 'success' });
        } catch (e) {
          toast(`Salvataggio non riuscito: ${e.message}`, { type: 'error' });
        } finally {
          t.remove();
        }
      },
      openPackage() {
        const input = h('input', { type: 'file', accept: '.ciak,application/zip' });
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            const entries = unzipStore(new Uint8Array(await file.arrayBuffer()));
            const get = (n) => entries.find((e) => e.name === n);
            const manifest = get('manifest.json');
            if (!manifest || JSON.parse(new TextDecoder().decode(manifest.data)).format !== 'ciak-studio') throw new Error('non è un pacchetto Ciak Studio');
            const raw = JSON.parse(new TextDecoder().decode(get('project.json').data));
            const p = normalizeProject(raw);
            const blobs = new Map();
            for (const id of Object.keys(p.media)) {
              const e = get(`media/${id}`);
              if (e) blobs.set(id, new File([e.data], p.media[id].name, { type: p.media[id].mime }));
            }
            await app.#reset(p, blobs);
            toast(`Progetto «${p.name}» aperto`, { type: 'success' });
          } catch (e) {
            toast(`Impossibile aprire il pacchetto: ${e.message}`, { type: 'error' });
          }
        });
        input.click();
      },

      // ---- esportazione ------------------------------------------------------------------------
      showHelp() {
        openDialog({
          title: 'Guida e scorciatoie',
          wide: true,
          content: h('div', { class: 'help' },
            h('p', {}, 'Ciak Studio è un editor video non lineare che funziona interamente nel browser: i tuoi file non lasciano mai il computer.'),
            h('table', { class: 'keys' }, h('tbody', {}, SHORTCUTS.map(([k, d]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, d))))),
            h('h3', {}, 'Da sapere'),
            h('ul', {},
              h('li', {}, 'L’esportazione registra l’anteprima a piena risoluzione in tempo reale: mantieni la scheda visibile fino alla fine.'),
              h('li', {}, 'Il progetto si salva da solo nel browser. Per spostarlo usa «Salva .ciak» nelle impostazioni del progetto.'),
              h('li', {}, 'Non incluse: trascrizione automatica, rimozione sfondo con IA, stabilizzazione, riproduzione inversa.'),
              h('li', {}, 'Formati letti: quelli supportati dal browser (MP4/H.264, WebM, MOV in parte, MP3, WAV, AAC, PNG, JPG, WebP…).'))),
          actions: [{ label: 'Chiudi', primary: true }],
        });
      },

      openExport() {
        app.#exportDialog();
      },
    };
    return A;
  }

  /** Barra rossa «● Registrazione 0:12 — Ferma» sopra l'editor. */
  #showRecBar() {
    this.#hideRecBar();
    const time = h('span', { id: 'rec-time' }, '0:00');
    this.recBar = h('div', { class: 'rec-bar', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'rec-dot' }), h('span', {}, 'Registrazione'), time, h('button', { class: 'btn small danger', type: 'button', id: 'btn-rec-stop', onClick: () => this.actions.stopRecording() }, icon('stop', 14), 'Ferma'));
    document.body.append(this.recBar);
    this.recTimer = setInterval(() => { time.textContent = formatDuration(this.screenRec.elapsed, 0); }, 500);
    this.#refreshRecButtons();
  }

  #hideRecBar() {
    clearInterval(this.recTimer);
    this.recBar?.remove();
    this.recBar = null;
    this.#refreshRecButtons();
  }

  #refreshRecButtons() {
    const b = document.querySelector('#btn-record-screen');
    if (!b) return;
    const rec = !!this.recBar;
    b.replaceChildren(icon(rec ? 'stop' : 'camera', 16), rec ? 'Ferma la registrazione' : 'Registra schermo/webcam');
  }

  /** Programma per computer: finestra con schermi e finestre (con anteprima) fra cui scegliere. */
  #pickCaptureSource(audio) {
    const d = globalThis.ciakDesktop;
    return new Promise((resolve) => {
      d.listSources().then((sources) => {
        if (!sources.length) {
          toast('Non trovo schermi o finestre da registrare.', { type: 'error' });
          return resolve(false);
        }
        const dlg = h('dialog', { class: 'dialog wide', id: 'capture-picker', 'aria-label': 'Scegli cosa registrare' });
        const done = (v) => {
          dlg.close();
          dlg.remove();
          resolve(v);
        };
        dlg.append(h('div', { class: 'dialog-body' },
          h('h2', {}, 'Cosa vuoi registrare?'),
          h('div', { class: 'src-grid' }, sources.map((s) => h('button', { class: 'src', type: 'button', 'data-id': s.id, title: s.name, onClick: async () => { await d.chooseSource(s.id, audio); done(true); } }, h('img', { src: s.thumbnail, alt: '' }), h('span', {}, s.name)))),
          h('div', { class: 'btn-row end' }, h('button', { class: 'btn', type: 'button', onClick: () => done(false) }, 'Annulla'))));
        dlg.addEventListener('close', () => resolve(false));
        document.body.append(dlg);
        dlg.showModal();
      }).catch((e) => {
        toast(`Impossibile elencare gli schermi: ${e.message}`, { type: 'error' });
        resolve(false);
      });
    });
  }

  /** Sostituisce l'intero progetto (nuovo/apri) e ripulisce i media. */
  async #reset(project, blobs = new Map()) {
    this.player.pause();
    this.selection.clear();
    this.pool.clear();
    this.clipboard = null;
    if (this.storage.available) await this.storage.clearAll().catch(() => {});
    for (const [id, blob] of blobs) {
      this.pool.add(id, blob);
      this.storage.putMedia(id, blob).catch(() => {});
    }
    this.store.replace(project);
    this.player.resizeCanvas();
    this.player.seek(0);
    for (const id of blobs.keys()) this.#enrich(id, true);
    this.timeline.fit();
    this.#scheduleSave();
  }

  // ---------------------------------------------------------------------------
  // Dialogo di esportazione
  // ---------------------------------------------------------------------------

  #exportDialog() {
    const { store, player, exporter } = this;
    const p = store.project;
    const dur = projectDuration(p);
    if (dur <= 0) return toast('La timeline è vuota: aggiungi almeno un clip prima di esportare', { type: 'warn' });
    if (typeof MediaRecorder === 'undefined') return toast('Questo browser non supporta l’esportazione video. Usa una versione recente di Chrome, Edge o Firefox.', { type: 'error' });
    player.pause();
    // tutte le risoluzioni fino al 4K: sopra quella del progetto l'immagine viene ingrandita (testi e forme restano nitidi)
    const sizes = EXPORT_SIZES;
    const shortP = Math.min(p.settings.width, p.settings.height);
    const sizeSel = h('select', { id: 'exp-size', 'aria-label': 'Risoluzione' }, sizes.map((s) => { const d = exportSize(p.settings, s); return h('option', { value: s }, `${s === 2160 ? '4K · ' : ''}${s}p · ${d.width}×${d.height}${s > shortP * 1.0001 ? ' (ingrandito)' : ''}`); }));
    sizeSel.value = String(sizes.includes(1080) && shortP >= 1080 ? 1080 : sizes.filter((s) => s <= Math.max(720, shortP * 1.0001)).at(-1));
    const fmtSel = h('select', { id: 'exp-format', 'aria-label': 'Formato' }, availableFormats().map((f) => h('option', { value: f }, FORMATS[f].label)));
    // Programma desktop: ffmpeg incluso → MP4 vero (H.264/AAC). Il registratore produce WebM, poi viene convertito.
    const desktop = globalThis.ciakDesktop?.isDesktop ? globalThis.ciakDesktop : null;
    desktop?.mp4Available().then((ok) => {
      if (!ok) return;
      fmtSel.prepend(h('option', { value: 'mp4-ffmpeg' }, 'MP4 (H.264/AAC) · consigliato'));
      fmtSel.children[0].after(h('option', { value: 'h265-ffmpeg' }, 'MP4 (H.265/AAC) · file più piccoli'), h('option', { value: 'mov-ffmpeg' }, 'MOV (H.264/AAC) · per altri programmi di montaggio'), h('option', { value: 'mkv-ffmpeg' }, 'MKV (H.264/AAC)'), h('option', { value: 'webm-ffmpeg' }, 'WebM (VP9/Opus) · web'), h('option', { value: 'av1-ffmpeg' }, 'WebM (AV1/Opus) · il più compatto, lento'));
      const audioGroup = fmtSel.querySelector('optgroup[label="Solo audio"]');
      audioGroup?.append(h('option', { value: 'flac-ffmpeg' }, 'Audio FLAC (senza perdite, compresso)'), h('option', { value: 'm4a-ffmpeg' }, 'Audio M4A (AAC 256 kbit/s)'));
      fmtSel.value = 'mp4-ffmpeg';
    }).catch(() => {});
    const qSel = h('select', { id: 'exp-quality', 'aria-label': 'Qualità' }, [...Object.entries(QUALITY).map(([id, q]) => h('option', { value: id }, q.label)), h('option', { value: 'custom' }, 'Personalizzata (bitrate in Mbit/s)…')]);
    qSel.value = 'high';
    const bitrateIn = h('input', { type: 'number', class: 'text-input', id: 'exp-bitrate', min: '0.5', max: '200', step: '0.5', value: '15', 'aria-label': 'Bitrate in megabit al secondo' });
    const bitrateRow = h('div', { class: 'ctl select', hidden: true }, h('label', { class: 'ctl-label' }, 'Bitrate (Mbit/s)'), bitrateIn);
    const customBps = () => (qSel.value === 'custom' ? Math.max(0.5, Math.min(200, Number(bitrateIn.value) || 15)) * 1e6 : null);
    qSel.addEventListener('change', () => { bitrateRow.hidden = qSel.value !== 'custom'; });
    const nameIn = h('input', { type: 'text', class: 'text-input', id: 'exp-name', value: p.name, 'aria-label': 'Nome del file', maxlength: 100 });
    const est = h('p', { class: 'hint', id: 'exp-estimate' });
    const updateEst = () => {
      const d = exportSize(p.settings, +sizeSel.value);
      const bytes = ((customBps() ?? estimateBitrate(d.width, d.height, p.settings.fps, qSel.value)) * dur) / 8 + (192_000 * dur) / 8;
      est.textContent = `Durata ${formatDuration(dur, 1)} · ${p.settings.fps} fps · circa ${formatBytes(bytes)} · tempo necessario ≈ ${formatDuration(dur + 2)} (l’esportazione avviene in tempo reale: tieni aperta questa scheda).`;
    };
    for (const s of [sizeSel, qSel]) s.addEventListener('change', updateEst);
    bitrateIn.addEventListener('input', updateEst);
    updateEst();
    const progress = h('progress', { max: 1, value: 0, class: 'exp-progress', hidden: true, 'aria-label': 'Avanzamento esportazione' });
    const status = h('p', { class: 'exp-status', role: 'status', 'aria-live': 'polite' });
    const result = h('div', { class: 'exp-result', hidden: true });
    const row = (l, c) => h('div', { class: 'ctl select' }, h('label', { class: 'ctl-label' }, l), c);
    const sizeRow = row('Risoluzione', sizeSel);
    const qualRow = row('Qualità', qSel);
    const form = h('div', { class: 'exp-form' }, row('Nome file', nameIn), sizeRow, row('Formato', fmtSel), qualRow, bitrateRow, est);
    // altri formati: solo audio (WAV/MP3) e GIF animata, anche senza il programma desktop
    fmtSel.append(h('optgroup', { label: 'Solo audio' }, h('option', { value: 'wav' }, 'Audio WAV (senza perdite)'), h('option', { value: 'mp3' }, 'Audio MP3 (192 kbit/s)')), h('optgroup', { label: 'Immagine animata' }, h('option', { value: 'gif' }, 'GIF animata (lato corto fino a 480 px, 12 fps)')));
    const OTHER = ['wav', 'mp3', 'gif', 'flac-ffmpeg', 'm4a-ffmpeg'];
    const syncRows = () => {
      const audioOnly = ['wav', 'mp3', 'flac-ffmpeg', 'm4a-ffmpeg'].includes(fmtSel.value);
      sizeRow.hidden = audioOnly;
      qualRow.hidden = OTHER.includes(fmtSel.value);
      if (OTHER.includes(fmtSel.value)) est.textContent = audioOnly ? `Durata ${formatDuration(dur, 1)} · l’audio si prepara in pochi secondi, senza riproduzione in tempo reale.` : `Durata ${formatDuration(dur, 1)} · la GIF si costruisce fotogramma per fotogramma (più il video è lungo, più ci vuole). Consigliata sotto i 15 secondi.`;
      else updateEst();
    };
    fmtSel.addEventListener('change', syncRows);
    let ctl;
    const secondary = h('div', { class: 'btn-row wrap' },
      h('button', { class: 'btn small', type: 'button', id: 'btn-export-png', onClick: () => this.#exportFrame(+sizeSel.value, nameIn.value) }, icon('image', 14), 'Salva fotogramma (PNG)'),
      h('button', { class: 'btn small', type: 'button', onClick: () => this.actions.exportSrt() }, icon('captions', 14), 'Esporta sottotitoli (.srt)'));
    const warnings = (res) => {
      const out = [];
      const missed = res.expectedFrames - res.frames;
      if (res.hiddenDuringExport) out.push('La scheda è stata nascosta durante l’esportazione: il video potrebbe avere scatti.');
      if (missed > Math.max(3, res.expectedFrames * 0.04)) out.push(`Il computer non ha tenuto il passo: ${res.frames} fotogrammi su ${res.expectedFrames}. Riprova con una risoluzione inferiore.`);
      return out;
    };
    const baseName = () => (nameIn.value.trim() || 'video').replace(/[\\/:*?"<>|]+/g, '_');
    /** Converte il WebM registrato in MP4 con ffmpeg e lo fa salvare dall'utente. */
    let container = 'mp4';
    let codec = 'h264';
    const convertToMp4 = async (res) => {
      status.textContent = `Fase 2/2 · conversione in ${container.toUpperCase()}…`;
      progress.hidden = false;
      progress.value = 0.7;
      ctl.setActions([{ label: 'Annulla conversione', danger: true, id: 'cancel', onClick: () => { desktop.cancelConvert(); return false; } }]);
      const off = desktop.onConvertProgress((v) => {
        progress.value = 0.7 + 0.3 * v;
        status.textContent = `Fase 2/2 · conversione in ${container.toUpperCase()}… ${Math.round(v * 100)}%`;
      });
      try {
        return await desktop.convertToMp4(await res.blob.arrayBuffer(), { name: baseName(), duration: dur, fps: p.settings.fps, quality: qSel.value, container, codec, bitrate: customBps() });
      } finally {
        off();
      }
    };
    const showResult = (res, conv) => {
      progress.hidden = true;
      status.textContent = '';
      const file = conv?.ok ? conv.path.split(/[\\/]/).pop() : `${baseName()}.${res.ext}`;
      const kids = [];
      if (conv?.ok) {
        kids.push(
          h('p', { class: 'ok' }, icon('check', 16), ` Video ${container.toUpperCase()} salvato: ${file}`),
          h('p', { class: 'hint', id: 'exp-saved-path' }, `${conv.path} · ${res.width}×${res.height} · ${formatBytes(conv.bytes)} · ${res.frames}/${res.expectedFrames} fotogrammi`),
        );
      } else if (conv) {
        kids.push(
          h('p', { class: 'warn' }, conv.canceled ? 'Salvataggio MP4 annullato.' : `Conversione in MP4 non riuscita: ${conv.error}`),
          h('p', { class: 'hint' }, 'Il video registrato è ancora disponibile: puoi riprovare oppure salvarlo così com’è (WebM).'),
        );
      } else {
        kids.push(
          h('p', { class: 'ok' }, icon('check', 16), ` Esportazione completata: ${file}`),
          h('p', { class: 'hint' }, `${res.width}×${res.height} · ${res.mime.split(';')[0]} · ${formatBytes(res.blob.size)} · ${res.frames}/${res.expectedFrames} fotogrammi · ${res.seconds.toFixed(1)} s`),
        );
      }
      kids.push(...warnings(res).map((w) => h('p', { class: 'warn' }, w)));
      const buttons = [];
      if (conv?.ok) buttons.push(h('button', { class: 'btn', type: 'button', id: 'btn-reveal', onClick: () => desktop.showInFolder(conv.path) }, icon('folder', 14), 'Mostra nella cartella'));
      else if (conv) {
        buttons.push(
          h('button', { class: 'btn primary', type: 'button', id: 'btn-retry-mp4', onClick: async () => { const again = await convertToMp4(res); showResult(res, again); } }, icon('download', 14), 'Salva come MP4'),
          h('button', { class: 'btn', type: 'button', onClick: () => downloadBlob(res.blob, `${baseName()}.${res.ext}`) }, 'Salva il WebM originale'),
        );
      } else buttons.push(h('button', { class: 'btn', type: 'button', onClick: () => downloadBlob(res.blob, file) }, icon('download', 14), 'Scarica di nuovo'));
      clearChildren(result).append(...kids, h('div', { class: 'btn-row wrap' }, ...buttons));
      result.hidden = false;
      ctl.setActions([{ label: 'Chiudi', primary: true, id: 'close' }]);
      this.lastExport = { ...res, file, converted: conv ?? null };
    };
    /** Solo audio e GIF: niente registrazione in tempo reale, si lavora a freddo. */
    const runOther = async (kind) => {
      form.hidden = true;
      secondary.hidden = true;
      progress.hidden = false;
      progress.value = 0;
      result.hidden = true;
      let cancelled = false;
      status.textContent = kind === 'gif' ? 'Costruisco la GIF…' : 'Preparo l’audio…';
      ctl.setActions([{ label: 'Annulla', danger: true, id: 'cancel', onClick: () => { cancelled = true; return false; } }]);
      try {
        let blob;
        let ext = kind;
        if (kind === 'gif') {
          const short = Math.min(480, +sizeSel.value);
          const d = exportSize(p.settings, short);
          const keep = player.time;
          blob = await encodeGif({
            width: d.width, height: d.height, fps: 12, duration: Math.min(dur, 60),
            isCancelled: () => cancelled,
            onProgress: (v) => { progress.value = v; status.textContent = `Costruisco la GIF… ${Math.round(v * 100)}%`; },
            drawFrame: async (ctx, t) => {
              player.seek(t);
              await player.settle();
              this.renderer.render(ctx, store.project, t);
            },
          });
          player.seek(keep);
        } else {
          const mix = await renderProjectAudio(store.project, this.pool, (v) => { progress.value = v * 0.9; status.textContent = `Preparo l’audio… ${Math.round(v * 90)}%`; });
          if (cancelled) throw Object.assign(new Error('annullata'), { cancelled: true });
          if (kind === 'flac-ffmpeg' || kind === 'm4a-ffmpeg') {
            status.textContent = 'Converto con ffmpeg…';
            progress.value = 0.93;
            const k = kind.split('-')[0];
            const conv = await desktop.convertAudio(encodeWav(mix.channels, mix.sampleRate), { kind: k, name: baseName() });
            progress.hidden = true;
            status.textContent = '';
            if (!conv.ok) {
              form.hidden = false;
              secondary.hidden = false;
              ctl.setActions([{ label: 'Chiudi', id: 'close' }, startBtn]);
              if (conv.canceled) toast('Salvataggio annullato');
              else toast(`Conversione non riuscita: ${conv.error}`, { type: 'error' });
              return false;
            }
            clearChildren(result).append(h('p', { class: 'ok', id: 'exp-saved-path-audio' }, icon('check', 16), ` Audio ${k.toUpperCase()} salvato: ${conv.path.split(/[\\/]/).pop()}`), h('p', { class: 'hint', id: 'exp-saved-path' }, `${conv.path} · ${formatBytes(conv.bytes)}`), h('div', { class: 'btn-row wrap' }, h('button', { class: 'btn', type: 'button', onClick: () => desktop.showInFolder(conv.path) }, icon('folder', 14), 'Mostra nella cartella')));
            result.hidden = false;
            ctl.setActions([{ label: 'Chiudi', primary: true, id: 'close' }]);
            this.lastExport = { file: conv.path, kind: k, converted: conv };
            return false;
          }
          status.textContent = kind === 'mp3' ? 'Codifico l’MP3…' : 'Scrivo il file WAV…';
          await new Promise((r) => setTimeout(r, 20));
          blob = kind === 'mp3' ? encodeMp3(mix.channels, mix.sampleRate, 192) : new Blob([encodeWav(mix.channels, mix.sampleRate)], { type: 'audio/wav' });
        }
        progress.value = 1;
        const file = `${baseName()}.${ext}`;
        downloadBlob(blob, file);
        progress.hidden = true;
        status.textContent = '';
        clearChildren(result).append(h('p', { class: 'ok', id: 'exp-other-done' }, icon('check', 16), ` Esportazione completata: ${file}`), h('p', { class: 'hint' }, `${blob.type} · ${formatBytes(blob.size)}`), h('div', { class: 'btn-row wrap' }, h('button', { class: 'btn', type: 'button', onClick: () => downloadBlob(blob, file) }, icon('download', 14), 'Scarica di nuovo')));
        result.hidden = false;
        ctl.setActions([{ label: 'Chiudi', primary: true, id: 'close' }]);
        this.lastExport = { blob, file, kind };
      } catch (e) {
        progress.hidden = true;
        status.textContent = '';
        form.hidden = false;
        secondary.hidden = false;
        ctl.setActions([{ label: 'Chiudi', id: 'close' }, startBtn]);
        if (e.cancelled || /annullata/.test(e.message)) toast('Esportazione annullata');
        else toast(`Esportazione non riuscita: ${e.message}`, { type: 'error' });
      }
      return false;
    };
    const startBtn = { label: 'Avvia esportazione', primary: true, id: 'start', onClick: async () => {
      if (OTHER.includes(fmtSel.value)) return runOther(fmtSel.value);
      form.hidden = true;
      secondary.hidden = true;
      progress.hidden = false;
      progress.value = 0;
      result.hidden = true;
      const FF = { 'mp4-ffmpeg': ['mp4', 'h264'], 'h265-ffmpeg': ['mp4', 'h265'], 'mov-ffmpeg': ['mov', 'h264'], 'mkv-ffmpeg': ['mkv', 'h264'], 'webm-ffmpeg': ['webm', 'vp9'], 'av1-ffmpeg': ['webm', 'av1'] };
      const mp4 = !!desktop && fmtSel.value in FF;
      [container, codec] = FF[fmtSel.value] ?? ['mp4', 'h264'];
      status.textContent = mp4 ? 'Fase 1/2 · registrazione… non nascondere la finestra.' : 'Esportazione in corso… non cambiare scheda.';
      ctl.setActions([{ label: 'Annulla', danger: true, id: 'cancel', onClick: () => { exporter.cancel(); return false; } }]);
      // se si converte, la registrazione intermedia usa una qualità più alta per non degradare due volte
      const interQuality = mp4 ? { low: 'medium', medium: 'high', high: 'ultra', ultra: 'ultra', custom: 'ultra' }[qSel.value] : qSel.value;
      try {
        const res = await exporter.run({
          shortSide: +sizeSel.value, format: mp4 ? 'webm' : fmtSel.value, quality: interQuality === 'custom' ? 'ultra' : interQuality, bitrate: mp4 ? null : customBps(),
          onProgress: (v) => { progress.value = mp4 ? v * 0.7 : v; status.textContent = `${mp4 ? 'Fase 1/2 · registrazione' : 'Esportazione'}… ${Math.round(v * 100)}%`; },
        });
        if (mp4) {
          const conv = await convertToMp4(res);
          showResult(res, conv);
        } else {
          downloadBlob(res.blob, `${baseName()}.${res.ext}`);
          showResult(res, null);
        }
      } catch (e) {
        progress.hidden = true;
        status.textContent = '';
        form.hidden = false;
        secondary.hidden = false;
        ctl.setActions([{ label: 'Chiudi', id: 'close' }, startBtn]);
        if (!e.cancelled) toast(`Esportazione non riuscita: ${e.message}`, { type: 'error' });
        else toast('Esportazione annullata');
      }
      return false;
    } };
    ctl = openDialog({ title: 'Esporta video', content: h('div', {}, form, progress, status, result, secondary), actions: [{ label: 'Chiudi' }, startBtn], onClose: () => exporter.running && exporter.cancel() });
  }

  async #exportFrame(shortSide, name) {
    const { store, player, renderer } = this;
    const p = store.project;
    player.pause();
    await player.settle();
    const { width, height } = exportSize(p.settings, shortSide);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    renderer.render(c.getContext('2d'), p, Math.min(player.time, Math.max(0, projectDuration(p) - 1e-3)));
    c.toBlob((b) => {
      if (!b) return toast('Cattura non riuscita', { type: 'error' });
      downloadBlob(b, `${(name.trim() || 'fotogramma').replace(/[\\/:*?"<>|]+/g, '_')}-${formatDuration(player.time, 1).replace(':', 'm')}s.png`);
      toast('Fotogramma salvato', { type: 'success' });
    }, 'image/png');
  }
}

function clearChildren(el) {
  el.replaceChildren();
  return el;
}
