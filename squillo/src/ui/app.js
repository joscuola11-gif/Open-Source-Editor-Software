import { h, clear } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { prefs, addRecent, displayName } from '../lib/prefs.js';
import { Ringer } from '../lib/sounds.js';
import { formatBitrate, formatClock } from '../lib/util.js';
import { Line } from '../net/signal.js';
import { cleanServer, isDefaultServer, DEFAULT_SERVER } from '../net/config.js';
import { formatCode, newCode, parseCode } from '../net/ids.js';
import { CallManager, STATE } from '../call/session.js';
import { hasDisplayCapture, isMobile, listDevices } from '../call/media.js';
import { quality } from '../call/stats.js';
import { SCREEN_LADDER } from '../call/profiles.js';

const MODES = {
  detail: { label: 'Testo e documenti', hint: 'Nitidissimo: ideale per slide, codice e pagine web' },
  motion: { label: 'Video e movimento', hint: 'Più fluido: ideale per filmati, giochi e animazioni' },
};

const initials = (s) => (String(s).trim().match(/\p{L}|\d/u)?.[0] ?? '?').toUpperCase();
const hue = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const avatar = (label, size = 44) => h('span', { class: 'avatar', style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.42)}px`, background: `hsl(${hue(label)} 45% 38%)` }, 'aria-hidden': 'true' }, initials(label));

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'adesso';
  if (m < 60) return `${m} min fa`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs} h fa`;
  const d = new Date(ts);
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

export class App {
  constructor(root) {
    this.root = root;
    this.ringer = new Ringer();
    this.contacts = prefs.get('contacts', {});
    this.recents = prefs.get('recents', []);
    this.audioMuted = false;
    this.focus = 'auto'; // 'auto' | 'screen' | 'cam'
    this.showStats = prefs.get('showStats', false);
    this.lastStats = null;
    this.remote = { stream: null, screen: null, state: { mic: true, cam: true, screen: false } };
    this.localScreen = null;
    this.wakeLock = null;

    const code = /^[1-9]\d{8}$/.test(prefs.get('code', '')) ? prefs.get('code') : newCode();
    prefs.set('code', code);
    this.line = new Line({ code, server: this.#server(), ice: this.#ice() });
    this.calls = new CallManager({ line: this.line, getName: () => this.name, getPrefs: () => this.#callPrefs(), pickScreen: (o) => this.#pickScreen(o) });
    this.#build();
    this.#wire();
  }

  get name() {
    return String(prefs.get('name', '')).trim().slice(0, 40);
  }

  #server() {
    return cleanServer(prefs.get('server', DEFAULT_SERVER));
  }

  #ice() {
    try {
      const v = JSON.parse(prefs.get('ice', '') || 'null');
      return Array.isArray(v) ? v : undefined;
    } catch {
      return undefined;
    }
  }

  #callPrefs() {
    return {
      micId: prefs.get('micId', ''),
      camId: prefs.get('camId', ''),
      cameraQuality: prefs.get('cameraQuality', 'auto'),
      echo: prefs.get('echo', true),
      noise: prefs.get('noise', true),
      startCameraOff: prefs.get('startCameraOff', false),
    };
  }

  start() {
    this.line.start();
    this.#renderHome();
    this.#renderStatus();
  }

  // -------------------------------------------------------------------------------------------
  // Costruzione
  // -------------------------------------------------------------------------------------------

  #build() {
    this.toasts = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    this.home = h('main', { class: 'home' });
    this.callView = h('section', { class: 'call', hidden: true, 'aria-label': 'Chiamata' });
    this.incoming = h('section', { class: 'incoming', hidden: true, role: 'alertdialog', 'aria-label': 'Chiamata in arrivo' });
    this.settings = h('dialog', { class: 'settings', 'aria-label': 'Impostazioni' });
    this.picker = h('dialog', { class: 'picker', 'aria-label': 'Scegli cosa condividere' });
    this.root.append(this.home, this.callView, this.incoming, this.settings, this.picker, this.toasts);

    // audio degli altri: elementi a parte, così «silenzia» e la scelta dell'altoparlante valgono per tutto
    this.audioR = h('audio', { autoplay: true, playsinline: true });
    this.audioS = h('audio', { autoplay: true, playsinline: true });
    this.root.append(this.audioR, this.audioS);
    this.#buildCall();
    document.addEventListener('pointerdown', () => this.ringer.unlock(), { once: false, capture: true });
    document.addEventListener('keydown', () => this.ringer.unlock(), { capture: true });
  }

  #buildCall() {
    this.vMain = h('video', { class: 'v-main', autoplay: true, playsinline: true, muted: true, 'aria-label': 'Video dell’altra persona' });
    this.vThumbR = h('video', { class: 'v-thumb', autoplay: true, playsinline: true, muted: true });
    this.vLocal = h('video', { class: 'v-local', autoplay: true, playsinline: true, muted: true });
    this.thumbR = h('button', { class: 'tile tile-remote', type: 'button', hidden: true, title: 'Mostra la camera dell’altra persona', onClick: () => this.#setFocus(this.focus === 'cam' ? 'screen' : 'cam') }, this.vThumbR);
    this.tileLocal = h('div', { class: 'tile tile-local', title: 'Trascinami dove vuoi' }, this.vLocal, h('span', { class: 'tile-label' }, 'Tu'));
    this.waiting = h('div', { class: 'waiting' });
    this.remoteBadges = h('div', { class: 'remote-badges' });
    this.topbar = h('header', { class: 'call-top' });
    this.statsPanel = h('div', { class: 'stats-panel', hidden: true, role: 'status' });
    this.shareBar = h('div', { class: 'share-bar', hidden: true });
    this.controls = h('nav', { class: 'controls', 'aria-label': 'Controlli della chiamata' });
    this.stage = h('div', { class: 'stage' }, this.vMain, this.waiting, this.remoteBadges, this.thumbR, this.tileLocal);
    this.callView.append(this.topbar, this.stage, this.statsPanel, this.shareBar, this.controls);
    this.#dragTile(this.tileLocal);
    this.#buildControls();
  }

  #ctl(id, ico, label, onClick, extra = {}) {
    const b = h('button', { class: `ctl ${extra.class ?? ''}`, id: `c-${id}`, type: 'button', 'aria-label': label, title: label, 'aria-pressed': extra.pressed === undefined ? undefined : String(extra.pressed), onClick }, icon(ico, 22), h('span', { class: 'ctl-label' }, extra.short ?? label));
    return b;
  }

  #buildControls() {
    const c = this.calls;
    this.bMic = this.#ctl('mic', 'mic', 'Muto microfono', () => c.setMic(!c.media?.micOn), { short: 'Microfono' });
    this.bCam = this.#ctl('cam', 'video', 'Camera', () => c.setCamera(!c.media?.camOn), { short: 'Camera' });
    this.bScreen = this.#ctl('screen', 'screen', 'Condividi lo schermo', () => this.#onScreenButton(), { short: 'Schermo' });
    this.bFlip = this.#ctl('flip', 'flip', 'Cambia camera', () => c.flipCamera(), { short: 'Gira' });
    this.bSpeaker = this.#ctl('speaker', 'volume', 'Silenzia l’altra persona', () => this.#toggleSpeaker(), { short: 'Audio' });
    this.bStats = this.#ctl('stats', 'info', 'Statistiche della connessione', () => this.#toggleStats(), { short: 'Info' });
    this.bFull = this.#ctl('full', 'expand', 'Schermo intero', () => this.#toggleFullscreen(), { short: 'Intero' });
    this.bHang = this.#ctl('hangup', 'hangup', 'Riaggancia', () => this.calls.hangup(), { class: 'hangup', short: 'Chiudi' });
    this.controls.append(this.bMic, this.bCam, this.bScreen, this.bFlip, this.bSpeaker, this.bStats, this.bFull, this.bHang);
    this.bFlip.hidden = !isMobile();
    this.bFull.hidden = !document.documentElement.requestFullscreen;
  }

  // -------------------------------------------------------------------------------------------
  // Collegamenti
  // -------------------------------------------------------------------------------------------

  #wire() {
    const { line, calls } = this;
    line.on('status', () => this.#renderStatus());
    line.on('code-changed', (code) => {
      prefs.set('code', code);
      this.#renderHome();
    });
    line.on('error', (e) => this.#toast(`Problema con il servizio di chiamate: ${e?.message ?? e?.type ?? 'errore'}`, 'error'));
    addEventListener('online', () => line.retryNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        line.retryNow();
        if (calls.active) this.#keepAwake();
      }
    });

    calls.on('state', (state) => this.#onState(state));
    calls.on('ringing', () => {
      this.#setStatusLine('Sta squillando…');
    });
    calls.on('incoming', ({ code, name }) => this.#onIncoming(code, name));
    calls.on('notice', (n) => this.#toast(n.text, n.kind));
    calls.on('local-media', (m) => {
      this.vLocal.srcObject = m.preview;
      m.on('video-track', () => {
        this.vLocal.srcObject = m.preview;
      });
      this.#syncControls();
    });
    calls.on('local-state', () => this.#syncControls());
    calls.on('remote-stream', (stream) => {
      this.remote.stream = stream;
      this.audioR.srcObject = stream;
      this.audioR.play().catch(() => {});
      this.#applyOutput();
      this.#syncVideos();
    });
    calls.on('remote-screen', (stream) => {
      this.remote.screen = stream;
      this.audioS.srcObject = stream && stream.getAudioTracks().length ? stream : null;
      this.audioS.play?.().catch(() => {});
      if (stream) this.focus = 'auto';
      this.#syncVideos();
      this.#syncControls();
    });
    calls.on('remote-state', (s) => {
      this.remote.state = s;
      this.#syncVideos();
      this.#renderBadges();
    });
    calls.on('local-screen', (stream) => {
      this.localScreen = stream;
      this.#syncControls();
      this.#renderShareBar();
    });
    calls.on('screen-quality', () => this.#renderShareBar());
    calls.on('stats', (s) => {
      this.lastStats = s;
      this.#renderStats();
      this.#renderTop();
      this.#renderShareBar();
    });
    calls.on('ended', (info) => this.#onEnded(info));
    setInterval(() => {
      if (this.calls.state === STATE.ACTIVE) this.#renderTop();
    }, 1000);
    addEventListener('keydown', (e) => this.#onKey(e));
  }

  #onKey(e) {
    if (this.calls.state !== STATE.ACTIVE || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (k === 'm') this.calls.setMic(!this.calls.media?.micOn);
    else if (k === 'v') this.calls.setCamera(!this.calls.media?.camOn);
    else if (k === 's') this.#onScreenButton();
    else if (k === 'f') this.#toggleFullscreen();
    else if (k === 'i') this.#toggleStats();
  }

  // -------------------------------------------------------------------------------------------
  // Schermata iniziale
  // -------------------------------------------------------------------------------------------

  #renderStatus() {
    const s = this.line.status;
    this.statusChip?.setAttribute('data-status', s);
    if (this.statusText) this.statusText.textContent = { online: 'Pronto a ricevere chiamate', connecting: 'Mi collego…', offline: 'Senza connessione: riprovo…', idle: 'Non collegato' }[s];
    if (this.callBtn) this.#syncCallInput();
  }

  #renderHome() {
    const code = this.line.code;
    this.statusText = h('span', {}, '');
    this.statusChip = h('div', { class: 'status', 'data-status': this.line.status, role: 'status' }, h('span', { class: 'dot' }), this.statusText);
    this.codeEl = h('div', { class: 'my-code', id: 'my-code', 'aria-label': 'Il tuo codice' }, formatCode(code));
    this.nameInput = h('input', { class: 'input', id: 'my-name', type: 'text', maxlength: '40', placeholder: 'Il tuo nome (lo vede chi chiami)', autocomplete: 'nickname', value: this.name, onInput: (e) => prefs.set('name', e.target.value.slice(0, 40)) });
    this.dialInput = h('input', { class: 'input dial', id: 'dial-input', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'Codice dell’altra persona', 'aria-label': 'Codice dell’altra persona', maxlength: '14', onInput: (e) => {
      const pos = e.target.selectionStart;
      e.target.value = formatCode(e.target.value);
      e.target.setSelectionRange(Math.min(pos + (e.target.value.length > pos ? 1 : 0), e.target.value.length), e.target.value.length);
      this.#syncCallInput();
    }, onKeydown: (e) => {
      if (e.key === 'Enter') this.#dialTyped(true);
    } });
    this.callBtn = h('button', { class: 'btn primary big', id: 'btn-call', type: 'button', onClick: () => this.#dialTyped(true) }, icon('video', 20), 'Videochiama');
    this.voiceBtn = h('button', { class: 'btn big', id: 'btn-voice', type: 'button', onClick: () => this.#dialTyped(false) }, icon('phone', 20), 'Solo voce');
    this.recentsEl = h('div', { class: 'recents', id: 'recents' });

    this.home.replaceChildren(
      h('header', { class: 'home-top' },
        h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 28, height: 28 }), h('span', {}, 'Squillo')),
        this.statusChip,
        h('button', { class: 'icon-btn', id: 'btn-settings', type: 'button', 'aria-label': 'Impostazioni', title: 'Impostazioni', onClick: () => this.#openSettings() }, icon('settings', 22))),
      h('div', { class: 'home-body' },
        h('section', { class: 'card mine' },
          h('h2', {}, 'Il tuo codice'),
          this.codeEl,
          h('p', { class: 'muted' }, 'Dillo a chi vuoi che ti chiami: serve solo che abbia Squillo.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn', id: 'btn-copy', type: 'button', onClick: () => this.#copyCode() }, icon('copy', 18), 'Copia'),
            navigator.share ? h('button', { class: 'btn', id: 'btn-share', type: 'button', onClick: () => this.#shareCode() }, icon('share', 18), 'Condividi') : null),
          this.nameInput),
        h('section', { class: 'card dialer' },
          h('h2', {}, 'Chiama qualcuno'),
          this.dialInput,
          h('div', { class: 'row stretch' }, this.callBtn, this.voiceBtn),
          h('p', { class: 'muted small' }, 'L’altra persona deve avere Squillo aperto in questo momento.')),
        h('section', { class: 'card history' }, h('h2', {}, 'Recenti'), this.recentsEl)));
    this.#syncCallInput();
    this.#renderRecents();
  }

  #syncCallInput() {
    const ok = !!parseCode(this.dialInput?.value) && this.line.status === 'online' && !this.calls.active;
    if (this.callBtn) this.callBtn.disabled = !ok;
    if (this.voiceBtn) this.voiceBtn.disabled = !ok;
  }

  #renderRecents() {
    clear(this.recentsEl);
    if (!this.recents.length) {
      this.recentsEl.append(h('p', { class: 'muted empty' }, 'Le chiamate che fai e ricevi compariranno qui.'));
      return;
    }
    const seen = new Set();
    for (const r of this.recents) {
      if (seen.has(r.code)) continue; // una riga per persona (la più recente)
      seen.add(r.code);
      const name = displayName(r.code, this.contacts, this.recents, formatCode);
      const label = name === formatCode(r.code) ? name : `${name}`;
      this.recentsEl.append(
        h('div', { class: 'recent', 'data-code': r.code },
          h('button', { class: 'recent-main', type: 'button', title: `Chiama ${label}`, onClick: () => this.#dialCode(r.code, true) },
            avatar(label),
            h('span', { class: 'recent-text' },
              h('span', { class: `recent-name ${r.dir === 'missed' ? 'missed' : ''}` }, label),
              h('span', { class: 'recent-sub' }, icon(r.dir === 'out' ? 'out' : r.dir === 'in' ? 'inn' : 'missed', 14), ' ', `${{ out: 'In uscita', in: 'In entrata', missed: 'Persa' }[r.dir]} · ${ago(r.ts)}${r.dur ? ` · ${formatClock(r.dur)}` : ''}`, name === formatCode(r.code) ? '' : ` · ${formatCode(r.code)}`))),
          h('button', { class: 'icon-btn', type: 'button', title: 'Dai un nome', 'aria-label': `Dai un nome a ${label}`, onClick: () => this.#rename(r.code) }, icon('user', 18)),
          h('button', { class: 'icon-btn', type: 'button', title: 'Togli dall’elenco', 'aria-label': `Togli ${label} dall’elenco`, onClick: () => this.#forget(r.code) }, icon('x', 18))));
    }
    this.recentsEl.append(h('button', { class: 'link', type: 'button', onClick: () => this.#clearHistory() }, 'Cancella la cronologia'));
  }

  #rename(code) {
    const cur = this.contacts[code] ?? '';
    const v = prompt('Che nome vuoi dare a questa persona?', cur);
    if (v === null) return;
    const name = v.trim().slice(0, 40);
    if (name) this.contacts[code] = name;
    else delete this.contacts[code];
    prefs.set('contacts', this.contacts);
    this.#renderRecents();
  }

  #forget(code) {
    this.recents = this.recents.filter((r) => r.code !== code);
    prefs.set('recents', this.recents);
    this.#renderRecents();
  }

  #clearHistory() {
    this.recents = [];
    prefs.set('recents', []);
    this.#renderRecents();
  }

  async #copyCode() {
    const text = formatCode(this.line.code);
    try {
      await navigator.clipboard.writeText(text);
      this.#toast('Codice copiato.', 'ok');
    } catch {
      this.#toast(`Il tuo codice è ${text}`, 'info');
    }
  }

  async #shareCode() {
    try {
      await navigator.share({ title: 'Squillo', text: `Chiamami su Squillo: il mio codice è ${formatCode(this.line.code)}` });
    } catch {
      /* annullato */
    }
  }

  #dialTyped(camera) {
    const code = parseCode(this.dialInput.value);
    if (!code) {
      this.#toast('Il codice ha 9 cifre: controlla di averlo scritto giusto.', 'error');
      return;
    }
    this.#dialCode(code, camera);
  }

  async #dialCode(code, camera) {
    this.ringer.unlock();
    this.#askNotifications();
    this.remote = { stream: null, screen: null, state: { mic: true, cam: true, screen: false } };
    const ok = await this.calls.dial(code, { camera });
    if (ok) this.ringer.start('outgoing');
  }

  // -------------------------------------------------------------------------------------------
  // Stato della chiamata → schermate
  // -------------------------------------------------------------------------------------------

  #onState(state) {
    const inCall = state !== STATE.IDLE && state !== STATE.RINGING;
    this.home.hidden = inCall;
    this.callView.hidden = !inCall;
    this.incoming.hidden = state !== STATE.RINGING;
    document.body.classList.toggle('in-call', inCall);
    if (state === STATE.DIALING) {
      this.focus = 'auto';
      this.#setStatusLine('Sto chiamando…');
    } else if (state === STATE.CONNECTING) {
      this.ringer.stop();
      this.#setStatusLine('Mi collego…');
    } else if (state === STATE.ACTIVE) {
      this.ringer.stop();
      this.#keepAwake();
      window.squilloDesktop?.keepAwake?.(true);
      if (this.showStats) this.#renderStats();
    } else if (state === STATE.IDLE) {
      this.ringer.stop();
      this.#releaseAwake();
      window.squilloDesktop?.keepAwake?.(false);
    }
    this.#syncCallInput();
    this.#syncVideos();
    this.#syncControls();
    this.#renderTop();
    this.#renderWaiting();
  }

  #setStatusLine(text) {
    this.statusLine = text;
    this.#renderTop();
    this.#renderWaiting();
  }

  #renderWaiting() {
    const call = this.calls.call;
    const showing = this.calls.state === STATE.DIALING || this.calls.state === STATE.CONNECTING;
    this.waiting.hidden = !showing;
    if (!showing || !call) return;
    const label = displayName(call.remoteCode, this.contacts, this.recents, formatCode);
    this.waiting.replaceChildren(h('div', { class: 'pulse' }, avatar(label, 96)), h('div', { class: 'w-name' }, label), h('div', { class: 'w-status', id: 'w-status' }, this.statusLine ?? ''));
  }

  #renderTop() {
    const call = this.calls.call;
    if (!call) return;
    const label = displayName(call.remoteCode, this.contacts, this.recents, formatCode);
    const active = this.calls.state === STATE.ACTIVE;
    const q = quality(this.lastStats?.main);
    this.topbar.replaceChildren(
      h('div', { class: 'top-name', id: 'top-name' }, label, this.remote.state.mic === false ? h('span', { class: 'mini-badge', title: 'Ha il microfono spento' }, icon('micOff', 14)) : null),
      h('div', { class: 'top-sub' },
        active ? h('span', { class: `q q-${q}`, title: { good: 'Connessione buona', fair: 'Connessione discreta', bad: 'Connessione scarsa' }[q] }, '●') : null,
        h('span', { id: 'timer' }, active ? formatClock((Date.now() - call.startedAt) / 1000) : (this.statusLine ?? ''))));
  }

  #renderBadges() {
    const s = this.remote.state;
    this.remoteBadges.replaceChildren(
      s.mic === false ? h('span', { class: 'badge', id: 'badge-mic' }, icon('micOff', 16), 'Microfono spento') : null,
      s.cam === false && !this.remote.screen ? h('span', { class: 'badge', id: 'badge-cam' }, icon('videoOff', 16), 'Camera spenta') : null,
      this.remote.screen ? h('span', { class: 'badge accent', id: 'badge-screen' }, icon('screen', 16), 'Sta condividendo lo schermo') : null);
    this.#renderTop();
  }

  #setFocus(f) {
    this.focus = f;
    this.#syncVideos();
  }

  /** Cosa mostrare in grande: lo schermo dell'altro se c'è, altrimenti la sua camera. Cliccando la miniatura si scambiano. */
  #syncVideos() {
    const hasScreen = !!this.remote.screen;
    const showScreenMain = hasScreen && this.focus !== 'cam';
    const main = showScreenMain ? this.remote.screen : this.remote.stream;
    if (this.vMain.srcObject !== main) {
      this.vMain.srcObject = main;
      this.vMain.play?.().catch(() => {});
    }
    this.vMain.classList.toggle('is-screen', showScreenMain);
    this.thumbR.hidden = !hasScreen;
    const thumb = hasScreen ? (showScreenMain ? this.remote.stream : this.remote.screen) : null;
    if (this.vThumbR.srcObject !== thumb) {
      this.vThumbR.srcObject = thumb;
      this.vThumbR.play?.().catch(() => {});
    }
    this.thumbR.title = showScreenMain ? 'Mostra la camera dell’altra persona' : 'Mostra lo schermo condiviso';
    this.stage.classList.toggle('has-main', !!main);
    this.#renderBadges();
  }

  #syncControls() {
    const m = this.calls.media;
    const active = this.calls.state === STATE.ACTIVE;
    const set = (btn, ico, on, label) => {
      btn.replaceChildren(icon(ico, 22), h('span', { class: 'ctl-label' }, btn.dataset.short ?? ''));
      btn.setAttribute('aria-pressed', String(on));
      btn.title = btn.ariaLabel = label;
    };
    for (const b of [this.bMic, this.bCam, this.bScreen, this.bFlip, this.bSpeaker, this.bStats, this.bFull, this.bHang]) b.dataset.short ??= b.querySelector('.ctl-label')?.textContent ?? '';
    const micOn = m?.micOn !== false;
    set(this.bMic, micOn ? 'mic' : 'micOff', !micOn, micOn ? 'Muto microfono' : 'Riattiva il microfono');
    this.bMic.classList.toggle('off', !micOn);
    const camOn = !!m?.camOn;
    set(this.bCam, camOn ? 'video' : 'videoOff', !camOn, camOn ? 'Spegni la camera' : 'Accendi la camera');
    this.bCam.classList.toggle('off', !camOn);
    const sharing = !!this.localScreen;
    set(this.bScreen, sharing ? 'screenOff' : 'screen', sharing, sharing ? 'Interrompi la condivisione' : 'Condividi lo schermo');
    this.bScreen.classList.toggle('on', sharing);
    this.bScreen.disabled = !active;
    this.bScreen.hidden = !hasDisplayCapture() && !window.squilloDesktop;
    set(this.bSpeaker, this.audioMuted ? 'volumeOff' : 'volume', this.audioMuted, this.audioMuted ? 'Riattiva l’audio dell’altra persona' : 'Silenzia l’altra persona');
    this.bSpeaker.classList.toggle('off', this.audioMuted);
    this.bStats.classList.toggle('on', this.showStats);
    this.bFlip.disabled = !camOn;
    this.bMic.disabled = !m;
    this.bCam.disabled = !m || !active;
    this.vLocal.classList.toggle('mirror', camOn && m?.facing !== 'environment' && !sharing);
    this.tileLocal.classList.toggle('cam-off', !camOn);
    this.bFull.replaceChildren(icon(document.fullscreenElement ? 'shrink' : 'expand', 22), h('span', { class: 'ctl-label' }, 'Intero'));
  }

  // -------------------------------------------------------------------------------------------
  // Volume, schermo intero, statistiche
  // -------------------------------------------------------------------------------------------

  #toggleSpeaker() {
    this.audioMuted = !this.audioMuted;
    this.#applyOutput();
    this.#syncControls();
  }

  #applyOutput() {
    this.audioR.muted = this.audioMuted;
    this.audioS.muted = this.audioMuted;
    const sink = prefs.get('speakerId', '');
    if (sink && this.audioR.setSinkId) {
      this.audioR.setSinkId(sink).catch(() => {});
      this.audioS.setSinkId?.(sink).catch(() => {});
    }
  }

  async #toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.callView.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      /* non consentito */
    }
    this.#syncControls();
  }

  #toggleStats() {
    this.showStats = !this.showStats;
    prefs.set('showStats', this.showStats);
    this.#renderStats();
    this.#syncControls();
  }

  #renderStats() {
    this.statsPanel.hidden = !this.showStats || this.calls.state !== STATE.ACTIVE;
    if (this.statsPanel.hidden) return;
    const s = this.lastStats;
    const line = (k, v) => h('div', { class: 'stat' }, h('span', {}, k), h('b', {}, v));
    const size = (z) => (z ? `${z.w}×${z.h}` : '–');
    const fps = (v) => (Number.isFinite(v) ? `${Math.round(v)} fps` : '–');
    const rows = [];
    if (s?.main) {
      const m = s.main;
      rows.push(h('h3', {}, 'Chiamata'),
        line('Invio', `${formatBitrate(m.outBitrate)} · ${size(m.outSize)} · ${fps(m.outFps)}`),
        line('Ricezione', `${formatBitrate(m.inBitrate)} · ${size(m.inSize)} · ${fps(m.inFps)}`),
        line('Ritardo', Number.isFinite(m.rtt) ? `${Math.round(m.rtt * 1000)} ms` : '–'),
        line('Pacchetti persi', `${Math.round((m.loss ?? 0) * 100)}%`),
        line('Percorso', m.relay === null ? '–' : m.relay ? 'Tramite server di appoggio' : 'Diretto'));
    } else rows.push(h('p', { class: 'muted' }, 'Sto raccogliendo i dati…'));
    if (s?.screen) {
      const m = s.screen;
      rows.push(h('h3', {}, 'Schermo condiviso'),
        line('Invio', `${formatBitrate(m.outBitrate)} · ${size(m.outSize)} · ${fps(m.outFps)}`),
        line('Codec', m.codecOut ?? '–'),
        line('Limite', { none: 'nessuno', bandwidth: 'rete', cpu: 'processore', other: 'altro' }[m.limitation] ?? '–'));
    }
    if (s?.remoteScreen) rows.push(h('h3', {}, 'Schermo ricevuto'), line('Ricezione', `${formatBitrate(s.remoteScreen.inBitrate)} · ${size(s.remoteScreen.inSize)} · ${fps(s.remoteScreen.inFps)}`));
    this.statsPanel.replaceChildren(...rows);
  }

  async #keepAwake() {
    try {
      if ('wakeLock' in navigator && !this.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
      }
    } catch {
      /* non disponibile */
    }
  }

  #releaseAwake() {
    this.wakeLock?.release?.().catch(() => {});
    this.wakeLock = null;
  }

  // -------------------------------------------------------------------------------------------
  // Condivisione dello schermo
  // -------------------------------------------------------------------------------------------

  #onScreenButton() {
    if (this.calls.state !== STATE.ACTIVE) return;
    if (this.localScreen) {
      this.calls.stopScreen();
      return;
    }
    if (this.screenMenu) {
      this.#closeScreenMenu();
      return;
    }
    let mode = prefs.get('screenMode', 'detail');
    let audio = prefs.get('screenAudio', false);
    const modeBtns = Object.entries(MODES).map(([id, m]) => h('button', { class: `opt ${id === mode ? 'sel' : ''}`, type: 'button', 'data-mode': id, onClick: (e) => {
      mode = id;
      for (const b of modeBtns) b.classList.toggle('sel', b === e.currentTarget);
    } }, h('b', {}, m.label), h('span', {}, m.hint)));
    const audioBox = h('input', { type: 'checkbox', id: 'share-audio', checked: audio, onChange: (e) => {
      audio = e.target.checked;
    } });
    const menu = h('div', { class: 'screen-menu', role: 'dialog', 'aria-label': 'Condividi lo schermo' },
      h('h3', {}, 'Cosa stai mostrando?'),
      ...modeBtns,
      h('label', { class: 'check' }, audioBox, h('span', {}, 'Condividi anche l’audio del computer', h('small', {}, ' (solo Windows e Chrome/Edge; usa le cuffie per evitare l’eco)'))),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', type: 'button', onClick: () => this.#closeScreenMenu() }, 'Annulla'),
        h('button', { class: 'btn primary', id: 'btn-share-go', type: 'button', onClick: async () => {
          prefs.set('screenMode', mode);
          prefs.set('screenAudio', audio);
          this.#closeScreenMenu();
          await this.calls.startScreen({ mode, audio });
        } }, 'Scegli e condividi')));
    this.screenMenu = menu;
    this.callView.append(menu);
    menu.querySelector('.opt.sel')?.focus();
  }

  #closeScreenMenu() {
    this.screenMenu?.remove();
    this.screenMenu = null;
  }

  /** Nel programma desktop mostra il nostro selettore (finestre e schermi con anteprima); nel browser decide il browser. */
  async #pickScreen() {
    const d = window.squilloDesktop;
    if (!d?.listSources) return true;
    const sources = await d.listSources();
    if (!sources.length) {
      this.#toast('Non trovo schermi o finestre da condividere.', 'error');
      return false;
    }
    return new Promise((resolve) => {
      const done = (v) => {
        this.picker.close();
        resolve(v);
      };
      const card = (s) => h('button', { class: 'src', type: 'button', 'data-id': s.id, title: s.name, onClick: async () => {
        await d.chooseSource(s.id, prefs.get('screenAudio', false));
        done(true);
      } }, h('img', { src: s.thumbnail, alt: '' }), h('span', {}, s.name));
      this.picker.replaceChildren(
        h('h2', {}, 'Cosa vuoi condividere?'),
        h('div', { class: 'src-grid' }, ...sources.map(card)),
        h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onClick: () => done(false) }, 'Annulla')));
      this.picker.onclose = () => resolve(false);
      this.picker.showModal();
    });
  }

  #renderShareBar() {
    const sharing = !!this.localScreen;
    this.shareBar.hidden = !sharing;
    if (!sharing) return;
    const call = this.calls.call;
    const mode = call?.screen.mode ?? 'detail';
    const m = this.lastStats?.screen;
    const level = call?.screen.level ?? 0;
    const step = SCREEN_LADDER[mode][level];
    this.shareBar.replaceChildren(
      h('span', { class: 'sb-title' }, icon('screen', 16), 'Stai condividendo lo schermo'),
      h('span', { class: 'sb-info', id: 'share-info' }, m ? `${m.outSize ? `${m.outSize.w}×${m.outSize.h}` : '…'} · ${Number.isFinite(m.outFps) ? Math.round(m.outFps) : '–'} fps · ${formatBitrate(m.outBitrate)}` : 'Avvio…', level > 0 ? ` · qualità adattata alla rete (${Math.round(step.bitrate / 1000)} kbit/s max)` : ''),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Tipo di contenuto' }, ...Object.entries(MODES).map(([id, md]) => h('button', { class: id === mode ? 'sel' : '', type: 'button', 'data-mode': id, title: md.hint, onClick: () => this.calls.setScreenMode(id) }, md.label))),
      h('button', { class: 'btn danger small', id: 'btn-stop-share', type: 'button', onClick: () => this.calls.stopScreen() }, 'Interrompi'));
  }

  // -------------------------------------------------------------------------------------------
  // Chiamata in arrivo
  // -------------------------------------------------------------------------------------------

  #onIncoming(code, theirName) {
    const label = this.contacts[code] || theirName || formatCode(code);
    this.remote = { stream: null, screen: null, state: { mic: true, cam: true, screen: false } };
    this.incoming.replaceChildren(
      h('div', { class: 'inc-card' },
        h('div', { class: 'pulse' }, avatar(label, 104)),
        h('h2', { id: 'inc-name' }, label),
        h('p', { class: 'muted' }, 'ti sta chiamando…', this.contacts[code] || !theirName ? '' : ` (${formatCode(code)})`),
        h('div', { class: 'inc-actions' },
          h('button', { class: 'round decline', id: 'btn-decline', type: 'button', 'aria-label': 'Rifiuta', onClick: () => this.calls.decline() }, icon('hangup', 28), h('span', {}, 'Rifiuta')),
          h('button', { class: 'round voice', id: 'btn-answer-voice', type: 'button', 'aria-label': 'Rispondi solo con la voce', onClick: () => this.#answer(false) }, icon('phone', 28), h('span', {}, 'Solo voce')),
          h('button', { class: 'round accept', id: 'btn-answer', type: 'button', 'aria-label': 'Rispondi', onClick: () => this.#answer(true) }, icon('video', 28), h('span', {}, 'Rispondi')))));
    this.ringer.start('incoming');
    if (this.ringer.blocked) this.#toast('Tocca lo schermo per attivare la suoneria.', 'info');
    this.#notifyIncoming(label);
    this.#titleBlink(label);
    window.squilloDesktop?.alert?.();
    this.incoming.querySelector('#btn-answer')?.focus();
  }

  async #answer(camera) {
    this.ringer.stop();
    this.#askNotifications();
    await this.calls.accept({ camera });
  }

  #titleBlink(label) {
    clearInterval(this.blink);
    const base = 'Squillo — videochiamate';
    let on = true;
    this.blink = setInterval(() => {
      if (this.calls.state !== STATE.RINGING) {
        clearInterval(this.blink);
        document.title = base;
        return;
      }
      document.title = on ? `📞 ${label} ti chiama` : base;
      on = !on;
    }, 900);
  }

  #askNotifications() {
    try {
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    } catch {
      /* non disponibile */
    }
  }

  #notifyIncoming(label) {
    try {
      if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        const n = new Notification('Squillo', { body: `${label} ti sta chiamando`, tag: 'squillo-call', requireInteraction: true });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      }
    } catch {
      /* alcuni telefoni non permettono Notification() da pagina */
    }
  }

  // -------------------------------------------------------------------------------------------
  // Fine chiamata
  // -------------------------------------------------------------------------------------------

  #onEnded(info) {
    this.ringer.stop();
    this.#closeScreenMenu();
    this.vMain.srcObject = this.vThumbR.srcObject = this.vLocal.srcObject = null;
    this.audioR.srcObject = this.audioS.srcObject = null;
    this.remote = { stream: null, screen: null, state: { mic: true, cam: true, screen: false } };
    this.localScreen = null;
    this.lastStats = null;
    this.statusLine = '';
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    const connected = info.startedAt > 0;
    const entry = connected ? { code: info.code, name: info.name, dir: info.role === 'caller' ? 'out' : 'in', dur: info.duration } : info.reason === 'missed' ? { code: info.code, name: info.name, dir: 'missed' } : info.role === 'caller' && info.reason !== 'media' ? { code: info.code, name: info.name, dir: 'out', dur: 0 } : null;
    if (entry) {
      if (entry.name && !this.contacts[entry.code]) {
        /* il nome dichiarato dall'altra persona resta nella cronologia */
      }
      this.recents = addRecent(this.recents, entry);
      prefs.set('recents', this.recents);
      this.#renderRecents();
    }
    if (info.text) {
      this.ringer.beep(info.reason === 'remote-hangup' ? 440 : 330);
      this.#toast(info.text, ['busy', 'offline', 'lost', 'failed', 'media', 'timeout', 'declined'].includes(info.reason) ? 'error' : 'info');
    }
    this.#syncCallInput();
    this.#syncControls();
  }

  // -------------------------------------------------------------------------------------------
  // Impostazioni
  // -------------------------------------------------------------------------------------------

  async #openSettings() {
    const dev = await listDevices();
    const sel = (id, list, cur, onChange, emptyLabel) => {
      const el = h('select', { class: 'input', id, onChange: (e) => onChange(e.target.value) }, h('option', { value: '' }, emptyLabel), ...list.map((d) => h('option', { value: d.id, selected: d.id === cur }, d.label)));
      return el;
    };
    const check = (id, label, key, def) => h('label', { class: 'check' }, h('input', { type: 'checkbox', id, checked: prefs.get(key, def), onChange: (e) => prefs.set(key, e.target.checked) }), h('span', {}, label));
    const srv = this.#server();
    const f = {
      host: h('input', { class: 'input', id: 's-host', value: srv.host, 'aria-label': 'Indirizzo' }),
      port: h('input', { class: 'input', id: 's-port', value: String(srv.port), inputmode: 'numeric', 'aria-label': 'Porta' }),
      path: h('input', { class: 'input', id: 's-path', value: srv.path, 'aria-label': 'Percorso' }),
      secure: h('input', { type: 'checkbox', id: 's-secure', checked: srv.secure }),
      ice: h('textarea', { class: 'input', id: 's-ice', rows: '3', placeholder: '[{"urls":"turn:esempio.it:3478","username":"…","credential":"…"}]', 'aria-label': 'Server di appoggio (TURN)' }, prefs.get('ice', '')),
    };
    const applyServer = () => {
      const next = cleanServer({ host: f.host.value, port: f.port.value, path: f.path.value, secure: f.secure.checked });
      let iceText = f.ice.value.trim();
      try {
        if (iceText && !Array.isArray(JSON.parse(iceText))) throw new Error('non è una lista');
      } catch {
        this.#toast('I server di appoggio devono essere una lista JSON valida.', 'error');
        return;
      }
      prefs.set('server', next);
      prefs.set('ice', iceText);
      if (this.calls.active) this.#toast('Salvato: sarà usato alla prossima apertura, dopo la chiamata.', 'info');
      else {
        this.line.restart({ server: next, ice: this.#ice() });
        this.#toast('Centralino aggiornato.', 'ok');
      }
      this.settings.close();
    };
    this.settings.replaceChildren(
      h('form', { method: 'dialog', class: 'settings-body', onSubmit: (e) => e.preventDefault() },
        h('header', {}, h('h2', {}, 'Impostazioni'), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Chiudi', onClick: () => this.settings.close() }, icon('x', 20))),
        h('h3', {}, 'Audio e video'),
        h('label', {}, 'Microfono', sel('s-mic', dev.mics, prefs.get('micId', ''), (v) => this.#devicePref('micId', v, 'audio'), 'Predefinito')),
        h('label', {}, 'Camera', sel('s-cam', dev.cams, prefs.get('camId', ''), (v) => this.#devicePref('camId', v, 'video'), 'Predefinita')),
        'setSinkId' in HTMLMediaElement.prototype ? h('label', {}, 'Altoparlante', sel('s-spk', dev.speakers, prefs.get('speakerId', ''), (v) => {
          prefs.set('speakerId', v);
          this.#applyOutput();
        }, 'Predefinito')) : null,
        h('label', {}, 'Qualità della camera', h('select', { class: 'input', id: 's-camq', onChange: (e) => prefs.set('cameraQuality', e.target.value) },
          h('option', { value: 'auto', selected: prefs.get('cameraQuality', 'auto') === 'auto' }, 'Alta (fino a 720p, si adatta alla rete)'),
          h('option', { value: 'saver', selected: prefs.get('cameraQuality', 'auto') === 'saver' }, 'Risparmio dati (360p)'))),
        check('s-echo', 'Elimina l’eco', 'echo', true),
        check('s-noise', 'Riduci il rumore di fondo', 'noise', true),
        check('s-camoff', 'Inizia le chiamate con la camera spenta', 'startCameraOff', false),
        h('h3', {}, 'Condivisione dello schermo'),
        h('label', {}, 'Contenuto abituale', h('select', { class: 'input', id: 's-mode', onChange: (e) => prefs.set('screenMode', e.target.value) }, ...Object.entries(MODES).map(([id, m]) => h('option', { value: id, selected: prefs.get('screenMode', 'detail') === id }, `${m.label} — ${m.hint}`)))),
        check('s-saudio', 'Condividi anche l’audio del computer', 'screenAudio', false),
        h('h3', {}, 'Centralino'),
        h('p', { class: 'muted small' }, isDefaultServer(srv) ? 'Stai usando il servizio pubblico gratuito (nessun account). Audio e video non passano di lì.' : 'Stai usando un centralino tuo.'),
        h('div', { class: 'grid3' }, h('label', {}, 'Indirizzo', f.host), h('label', {}, 'Porta', f.port), h('label', {}, 'Percorso', f.path)),
        h('label', { class: 'check' }, f.secure, h('span', {}, 'Connessione protetta (HTTPS)')),
        h('details', {}, h('summary', {}, 'Avanzate: server di appoggio (TURN)'), h('p', { class: 'muted small' }, 'Servono solo se due persone non riescono a collegarsi (reti molto chiuse). Lascia vuoto per usare quelli predefiniti.'), f.ice),
        h('div', { class: 'row end' },
          h('button', { class: 'btn', type: 'button', id: 's-reset', onClick: () => {
            const d = DEFAULT_SERVER;
            f.host.value = d.host;
            f.port.value = String(d.port);
            f.path.value = d.path;
            f.secure.checked = d.secure;
            f.ice.value = '';
          } }, 'Servizio predefinito'),
          h('button', { class: 'btn primary', type: 'button', id: 's-save', onClick: applyServer }, 'Salva')),
        h('p', { class: 'muted small about' }, `Squillo · il tuo codice è ${formatCode(this.line.code)}`)));
    this.settings.showModal();
  }

  #devicePref(key, value, kind) {
    prefs.set(key, value);
    if (this.calls.active) this.calls.switchDevice(kind, value);
  }

  // -------------------------------------------------------------------------------------------
  // Varie
  // -------------------------------------------------------------------------------------------

  #toast(text, kind = 'info') {
    if (!text) return;
    const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
    this.toasts.append(el);
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4800);
  }

  #dragTile(tile) {
    tile.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const box = this.stage.getBoundingClientRect();
      const r = tile.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      tile.setPointerCapture(e.pointerId);
      tile.classList.add('drag');
      const move = (ev) => {
        const x = Math.min(Math.max(ev.clientX - dx - box.left, 6), box.width - r.width - 6);
        const y = Math.min(Math.max(ev.clientY - dy - box.top, 6), box.height - r.height - 6);
        Object.assign(tile.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
      };
      const up = () => {
        tile.removeEventListener('pointermove', move);
        tile.removeEventListener('pointerup', up);
        tile.classList.remove('drag');
      };
      tile.addEventListener('pointermove', move);
      tile.addEventListener('pointerup', up);
    });
  }
}
