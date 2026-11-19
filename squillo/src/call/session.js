// La chiamata. Un canale di controllo (testo) gestisce squillo, risposta, muto e riaggancio;
// il video/audio viaggia su una connessione a parte, e la condivisione dello schermo su una terza:
// così lo schermo si può accendere e spegnere senza toccare la voce e con le sue impostazioni di qualità.

import { Emitter } from '../lib/util.js';
import { LocalMedia, getScreen, explain } from './media.js';
import { preferCodecs, startBitrate, tuneOpus } from './sdp.js';
import { summarize } from './stats.js';
import { AUDIO_BITRATE, CAMERA_LADDER, CONTENT_HINT, DEGRADATION, SCREEN_LADDER, initialState, nextState } from './profiles.js';

const DIAL_TIMEOUT = 45_000;
const RING_TIMEOUT = 50_000;
const CONNECT_TIMEOUT = 20_000;
const STATS_EVERY = 1000;

export const STATE = { IDLE: 'idle', DIALING: 'dialing', RINGING: 'ringing', CONNECTING: 'connecting', ACTIVE: 'active' };

const callId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** SDP del video+audio della chiamata: voce chiara, bitrate di partenza decente. */
const mainSdp = (sdp) => startBitrate(tuneOpus(sdp, { maxBitrate: AUDIO_BITRATE.voice }), 1500);
/** SDP dello schermo: VP9 (il migliore per testo e interfacce) con ripiego su H.264 e VP8, audio stereo. */
const screenSdp = (sdp) => startBitrate(tuneOpus(preferCodecs(sdp, 'video', ['VP9', 'H264', 'VP8']), { stereo: true, maxBitrate: AUDIO_BITRATE.screen }), 3000);

export class CallManager extends Emitter {
  state = STATE.IDLE;
  call = null;
  /** @type {LocalMedia|null} */
  media = null;

  constructor({ line, getName, getPrefs, pickScreen }) {
    super();
    this.pickScreen = pickScreen;
    this.line = line;
    this.getName = getName;
    this.getPrefs = getPrefs;
    line.on('data', (dc) => this.#onIncomingData(dc));
    line.on('call', (mc) => this.#onIncomingMedia(mc));
    line.on('unavailable', (code) => this.#onUnavailable(code));
  }

  get active() {
    return this.state !== STATE.IDLE;
  }

  #set(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit('state', state, this.call);
  }

  // -------------------------------------------------------------------------------------------
  // Chiamare
  // -------------------------------------------------------------------------------------------

  async dial(code, { camera = true } = {}) {
    if (this.active) return false;
    if (code === this.line.code) {
      this.emit('notice', { kind: 'error', text: 'Questo è il tuo codice: inserisci quello dell\'altra persona.' });
      return false;
    }
    if (this.line.status !== 'online') {
      this.emit('notice', { kind: 'error', text: 'Non sei collegato al servizio di chiamate. Controlla la connessione a Internet e riprova.' });
      return false;
    }
    const call = this.#newCall('caller', code);
    this.call = call;
    this.#set(STATE.DIALING);
    try {
      await this.#openMedia(call, camera);
    } catch (e) {
      this.#finish(call, 'media', e.message);
      return false;
    }
    if (this.call !== call) return false;
    const ctl = this.line.connectData(code, { kind: 'ctl', id: call.id });
    call.ctl = ctl;
    this.#bindCtl(call, ctl);
    ctl.on('open', () => {
      this.#send(call, { t: 'ring', id: call.id, name: this.getName() });
      call.timers.dial = setTimeout(() => {
        if (this.call === call && this.state === STATE.DIALING) {
          this.#send(call, { t: 'cancel' });
          this.#finish(call, 'timeout', 'Nessuna risposta.');
        }
      }, DIAL_TIMEOUT);
    });
    return true;
  }

  #newCall(role, code) {
    return {
      id: callId(),
      role,
      remoteCode: code,
      remoteName: null,
      ctl: null,
      mainMc: null,
      screenMc: null,
      remoteScreenMc: null,
      remote: { stream: null, screenStream: null, mic: true, cam: true, screen: false, screenMode: 'detail' },
      screenStream: null,
      screen: { mode: 'detail', level: 0, audio: false },
      ctlState: { cam: initialState(0), screen: initialState(0) },
      startedAt: 0,
      timers: {},
      stats: { main: null, screen: null },
      ended: false,
    };
  }

  async #openMedia(call, camera) {
    const prefs = this.getPrefs();
    this.media = new LocalMedia({ audioId: prefs.micId, videoId: prefs.camId, quality: prefs.cameraQuality, echo: prefs.echo, noise: prefs.noise });
    await this.media.open({ camera: camera && !prefs.startCameraOff });
    if (this.media.cameraError) this.emit('notice', { kind: 'warn', text: this.media.cameraError.message });
    this.emit('local-media', this.media);
  }

  // -------------------------------------------------------------------------------------------
  // Canale di controllo
  // -------------------------------------------------------------------------------------------

  #send(call, msg) {
    try {
      if (call.ctl?.open) call.ctl.send(msg);
    } catch {
      /* canale chiuso: la chiusura è già gestita */
    }
  }

  #bindCtl(call, ctl) {
    ctl.on('data', (msg) => this.#onCtlMessage(call, msg));
    ctl.on('close', () => {
      if (this.call !== call || call.ended) return;
      if (this.state === STATE.ACTIVE || this.state === STATE.CONNECTING) {
        // piccola tolleranza: il canale può cadere un attimo mentre la rete cambia
        clearTimeout(call.timers.lost);
        call.timers.lost = setTimeout(() => {
          if (this.call === call && (!call.ctl || !call.ctl.open)) this.#finish(call, 'lost', 'Connessione persa.');
        }, 6000);
      } else if (this.state === STATE.DIALING) this.#finish(call, 'declined', 'L\'altra persona non ha risposto.');
      else if (this.state === STATE.RINGING) this.#finish(call, 'missed', 'Chiamata persa.');
    });
    ctl.on('error', () => {});
  }

  #onCtlMessage(call, msg) {
    if (this.call !== call || call.ended || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'ringing':
        this.emit('ringing');
        break;
      case 'busy':
        this.#finish(call, 'busy', 'L\'altra persona è già in chiamata.');
        break;
      case 'decline':
        this.#finish(call, 'declined', 'Chiamata rifiutata.');
        break;
      case 'cancel':
        this.#finish(call, 'missed', 'Chiamata persa.');
        break;
      case 'accept':
        if (call.role === 'caller' && this.state === STATE.DIALING) {
          call.remoteName = typeof msg.name === 'string' ? msg.name.slice(0, 40) : call.remoteName;
          this.#startMedia(call);
        }
        break;
      case 'state':
        call.remote.mic = msg.mic !== false;
        call.remote.cam = msg.cam !== false;
        this.emit('remote-state', { ...call.remote });
        break;
      case 'screen':
        if (msg.on) {
          call.remote.screen = true;
          call.remote.screenMode = msg.mode === 'motion' ? 'motion' : 'detail';
        } else {
          call.remote.screen = false;
          call.remote.screenStream = null;
          try {
            call.remoteScreenMc?.close();
          } catch {
            /* già chiusa */
          }
          call.remoteScreenMc = null;
          this.emit('remote-screen', null);
        }
        this.emit('remote-state', { ...call.remote });
        break;
      case 'bye':
        this.#finish(call, 'remote-hangup', 'Chiamata terminata.');
        break;
      default:
    }
  }

  // -------------------------------------------------------------------------------------------
  // Ricevere
  // -------------------------------------------------------------------------------------------

  #onIncomingData(dc) {
    if (dc.metadata?.kind !== 'ctl') {
      dc.close();
      return;
    }
    dc.on('error', () => {});
    const remoteCode = String(dc.peer).replace(/^squillo-/, '');
    const onFirst = (msg) => {
      if (msg?.t !== 'ring') return;
      dc.off?.('data', onFirst);
      this.#ring(dc, remoteCode, msg);
    };
    // PeerJS emette 'data' dopo l'apertura: la prima cosa che arriva è il «ring»
    dc.on('data', onFirst);
  }

  #ring(dc, remoteCode, msg) {
    const reply = (m) => {
      try {
        dc.send(m);
      } catch {
        /* chiuso */
      }
    };
    if (this.active) {
      const mine = this.call;
      // sovrapposizione: ci stiamo chiamando a vicenda nello stesso momento. Vince il codice più piccolo.
      if (mine && mine.remoteCode === remoteCode && mine.role === 'caller' && this.state === STATE.DIALING) {
        if (this.line.peerId > dc.peer) {
          // cediamo: trattiamo la loro chiamata come quella vera e la accettiamo subito
          clearTimeout(mine.timers.dial);
          this.#send(mine, { t: 'cancel' });
          this.#teardown(mine);
          this.call = null;
          this.state = STATE.IDLE;
          const call = this.#newCall('callee', remoteCode);
          call.id = String(msg.id ?? call.id);
          call.remoteName = typeof msg.name === 'string' ? msg.name.slice(0, 40) : null;
          call.ctl = dc;
          this.call = call;
          this.#bindCtl(call, dc);
          this.#set(STATE.RINGING);
          this.accept().catch(() => {});
          return;
        }
        reply({ t: 'busy' });
        dc.close();
        return;
      }
      reply({ t: 'busy' });
      setTimeout(() => dc.close(), 300);
      this.emit('missed-while-busy', { code: remoteCode, name: msg.name });
      return;
    }
    const call = this.#newCall('callee', remoteCode);
    call.id = String(msg.id ?? call.id).slice(0, 40);
    call.remoteName = typeof msg.name === 'string' ? msg.name.slice(0, 40) : null;
    call.ctl = dc;
    this.call = call;
    this.#bindCtl(call, dc);
    this.#set(STATE.RINGING);
    reply({ t: 'ringing' });
    this.emit('incoming', { code: remoteCode, name: call.remoteName });
    call.timers.ring = setTimeout(() => {
      if (this.call === call && this.state === STATE.RINGING) {
        this.#finish(call, 'missed', 'Chiamata persa.');
        this.#send(call, { t: 'decline' });
      }
    }, RING_TIMEOUT);
  }

  async accept({ camera = true } = {}) {
    const call = this.call;
    if (!call || call.role !== 'callee' || this.state !== STATE.RINGING) return false;
    clearTimeout(call.timers.ring);
    try {
      await this.#openMedia(call, camera);
    } catch (e) {
      this.#send(call, { t: 'decline' });
      this.#finish(call, 'media', e.message);
      return false;
    }
    if (this.call !== call || call.ended) return false;
    this.#set(STATE.CONNECTING);
    this.#send(call, { t: 'accept', name: this.getName() });
    call.timers.connect = setTimeout(() => {
      if (this.call === call && this.state === STATE.CONNECTING) this.#finish(call, 'failed', 'Non riesco a collegarmi. Riprova.');
    }, CONNECT_TIMEOUT);
    return true;
  }

  decline() {
    const call = this.call;
    if (!call || call.role !== 'callee' || this.state !== STATE.RINGING) return;
    this.#send(call, { t: 'decline' });
    this.#finish(call, 'declined-by-me', '');
  }

  // -------------------------------------------------------------------------------------------
  // Media
  // -------------------------------------------------------------------------------------------

  #startMedia(call) {
    this.#set(STATE.CONNECTING);
    clearTimeout(call.timers.dial);
    const mc = this.line.callMedia(call.remoteCode, this.media.stream, { metadata: { id: call.id, role: 'main' }, sdpTransform: mainSdp });
    call.mainMc = mc;
    this.#bindMain(call, mc);
    call.timers.connect = setTimeout(() => {
      if (this.call === call && this.state === STATE.CONNECTING) this.#finish(call, 'failed', 'Non riesco a collegarmi. Riprova.');
    }, CONNECT_TIMEOUT);
  }

  #onIncomingMedia(mc) {
    const call = this.call;
    const meta = mc.metadata ?? {};
    if (!call || call.ended || meta.id !== call.id || String(mc.peer) !== `squillo-${call.remoteCode}`) {
      mc.close();
      return;
    }
    if (meta.role === 'main') {
      if (call.role !== 'callee' || (this.state !== STATE.CONNECTING && this.state !== STATE.ACTIVE)) {
        mc.close();
        return;
      }
      call.mainMc = mc;
      mc.answer(this.media.stream, { sdpTransform: mainSdp });
      this.#bindMain(call, mc);
    } else if (meta.role === 'screen') {
      call.remoteScreenMc = mc;
      mc.answer(undefined, { sdpTransform: screenSdp });
      mc.on('stream', (stream) => {
        call.remote.screenStream = stream;
        call.remote.screen = true;
        this.emit('remote-screen', stream);
        this.emit('remote-state', { ...call.remote });
      });
    } else mc.close();
  }

  #bindMain(call, mc) {
    mc.on('stream', (stream) => {
      if (call.remote.stream === stream) return;
      call.remote.stream = stream;
      this.emit('remote-stream', stream);
      if (this.state !== STATE.ACTIVE) this.#connected(call);
    });
    mc.on('error', () => {});
    mc.on('close', () => {
      if (this.call === call && !call.ended && call.mainMc === mc && (this.state === STATE.ACTIVE || this.state === STATE.CONNECTING)) this.#finish(call, 'lost', 'Connessione persa.');
    });
    // la traccia remota può arrivare prima dell'evento di PeerJS: guardiamo anche il collegamento vero
    const watch = setInterval(() => {
      const pc = mc.peerConnection;
      if (!pc || call.ended) return clearInterval(watch);
      if (pc.connectionState === 'connected' && call.remote.stream && this.state === STATE.CONNECTING) this.#connected(call);
    }, 300);
    call.timers.watch = watch;
  }

  #connected(call) {
    if (this.call !== call || call.ended || this.state === STATE.ACTIVE) return;
    clearTimeout(call.timers.connect);
    call.startedAt = Date.now();
    this.#set(STATE.ACTIVE);
    this.#sendState(call);
    this.#applyCamera(call);
    call.timers.stats = setInterval(() => this.#tick(call), STATS_EVERY);
  }

  #sendState(call) {
    this.#send(call, { t: 'state', mic: this.media.micOn, cam: this.media.camOn, screen: !!call.screenStream });
  }

  #videoSenders(pc) {
    return pc ? pc.getSenders().filter((s) => s.track?.kind === 'video' || s.track === null) : [];
  }

  #allCamSenders(call) {
    // tutti i mittenti video della connessione principale (la camera o il suo segnaposto)
    return call.mainMc?.peerConnection ? call.mainMc.peerConnection.getTransceivers().filter((t) => t.sender && (t.receiver.track?.kind === 'video')).map((t) => t.sender) : [];
  }

  // -------------------------------------------------------------------------------------------
  // Comandi durante la chiamata
  // -------------------------------------------------------------------------------------------

  setMic(on) {
    if (!this.media) return;
    this.media.setMic(on);
    if (this.call) this.#sendState(this.call);
    this.emit('local-state');
  }

  async setCamera(on) {
    if (!this.media || !this.call) return;
    try {
      await this.media.setCamera(on, this.#allCamSenders(this.call));
    } catch (e) {
      this.emit('notice', { kind: 'error', text: explain(e, 'camera').message });
    }
    this.#sendState(this.call);
    this.emit('local-state');
  }

  async flipCamera() {
    if (!this.media || !this.call) return;
    try {
      await this.media.flipCamera(this.#allCamSenders(this.call));
    } catch (e) {
      this.emit('notice', { kind: 'error', text: e.message });
    }
    this.emit('local-state');
  }

  async switchDevice(kind, id) {
    if (!this.media || !this.call) return;
    try {
      await this.media.switchDevice(kind, id, kind === 'audio' ? (this.call.mainMc?.peerConnection?.getSenders().filter((s) => s.track?.kind === 'audio') ?? []) : this.#allCamSenders(this.call));
    } catch (e) {
      this.emit('notice', { kind: 'error', text: e.message });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Condivisione dello schermo
  // -------------------------------------------------------------------------------------------

  get sharing() {
    return !!this.call?.screenStream;
  }

  async startScreen({ mode = 'detail', audio = false } = {}) {
    const call = this.call;
    if (!call || this.state !== STATE.ACTIVE || call.screenStream) return false;
    let stream;
    try {
      // nel programma desktop si sceglie prima cosa condividere con il nostro selettore
      if (this.pickScreen && !(await this.pickScreen({ audio }))) return false;
      stream = await getScreen({ mode, audio });
    } catch (e) {
      if (e.code !== 'cancelled') this.emit('notice', { kind: 'error', text: e.message });
      return false;
    }
    if (this.call !== call || call.ended) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    call.screenStream = stream;
    call.screen = { mode, level: 0, audio: stream.getAudioTracks().length > 0 };
    call.ctlState.screen = initialState(0);
    const mc = this.line.callMedia(call.remoteCode, stream, { metadata: { id: call.id, role: 'screen', mode }, sdpTransform: screenSdp });
    call.screenMc = mc;
    mc.on('error', () => {});
    mc.on('close', () => {
      if (call.screenMc === mc && call.screenStream) this.stopScreen();
    });
    const v = stream.getVideoTracks()[0];
    v?.addEventListener('ended', () => this.stopScreen()); // l'utente ha premuto «Interrompi condivisione» del browser
    this.#send(call, { t: 'screen', on: true, mode });
    this.#sendState(call);
    this.#applyScreen(call);
    this.emit('local-screen', stream);
    this.emit('local-state');
    return true;
  }

  stopScreen() {
    const call = this.call;
    if (!call?.screenStream) return;
    const s = call.screenStream;
    call.screenStream = null;
    s.getTracks().forEach((t) => t.stop());
    try {
      call.screenMc?.close();
    } catch {
      /* già chiusa */
    }
    call.screenMc = null;
    call.stats.screen = null;
    this.#send(call, { t: 'screen', on: false });
    this.#sendState(call);
    this.emit('local-screen', null);
    this.emit('local-state');
  }

  /** Cambia «testo» ↔ «movimento» durante la condivisione. */
  setScreenMode(mode) {
    const call = this.call;
    if (!call?.screenStream || call.screen.mode === mode) return;
    call.screen = { ...call.screen, mode, level: 0 };
    call.ctlState.screen = initialState(0);
    const v = call.screenStream.getVideoTracks()[0];
    if (v) {
      v.contentHint = CONTENT_HINT[mode];
      // più fotogrammi per il movimento: si riapplica il vincolo di cattura
      v.applyConstraints({ frameRate: { ideal: mode === 'motion' ? 60 : 30, max: mode === 'motion' ? 60 : 30 } }).catch(() => {});
    }
    this.#send(call, { t: 'screen', on: true, mode });
    this.#applyScreen(call);
    this.emit('local-state');
  }

  // -------------------------------------------------------------------------------------------
  // Qualità: applica i livelli ai mittenti e li regola dalle statistiche
  // -------------------------------------------------------------------------------------------

  async #applyEncoding(sender, step, degradation) {
    if (!sender || !step) return;
    try {
      const p = sender.getParameters();
      if (!p.encodings?.length) p.encodings = [{}];
      const e = p.encodings[0];
      e.maxBitrate = step.bitrate;
      e.maxFramerate = step.fps;
      e.scaleResolutionDownBy = step.scale;
      e.networkPriority = 'high';
      e.priority = 'high';
      if (degradation) p.degradationPreference = degradation;
      await sender.setParameters(p);
    } catch {
      /* alcuni browser non accettano tutti i campi: va bene lo stesso */
    }
  }

  #screenSenders(call) {
    return call.screenMc?.peerConnection?.getSenders().filter((s) => s.track?.kind === 'video') ?? [];
  }

  #applyScreen(call) {
    if (!call.screenMc) return;
    const ladder = SCREEN_LADDER[call.screen.mode];
    const apply = () => {
      for (const s of this.#screenSenders(call)) this.#applyEncoding(s, ladder[call.ctlState.screen.level], DEGRADATION[call.screen.mode]);
    };
    // i mittenti esistono quando la connessione è stata creata, ma i parametri si accettano solo dopo l'accordo
    const pc = call.screenMc.peerConnection;
    if (pc?.connectionState === 'connected') apply();
    else {
      call.screenMc.on('stream', apply);
      const t = setInterval(() => {
        if (call.ended || !call.screenMc) return clearInterval(t);
        if (call.screenMc.peerConnection?.connectionState === 'connected' || call.screenMc.open) {
          clearInterval(t);
          apply();
        }
      }, 200);
    }
  }

  #applyCamera(call) {
    const q = this.getPrefs().cameraQuality === 'saver' ? 'saver' : 'auto';
    for (const s of this.#allCamSenders(call)) this.#applyEncoding(s, CAMERA_LADDER[q][call.ctlState.cam.level], DEGRADATION.camera);
  }

  async #tick(call) {
    if (this.call !== call || call.ended || this.state !== STATE.ACTIVE) return;
    const sample = async (pc, prev) => {
      if (!pc) return null;
      try {
        const rep = await pc.getStats();
        return summarize([...rep.values()], prev);
      } catch {
        return prev;
      }
    };
    const main = await sample(call.mainMc?.peerConnection, call.stats.main);
    const screen = call.screenMc ? await sample(call.screenMc.peerConnection, call.stats.screen) : null;
    const remoteScreenIn = call.remoteScreenMc ? await sample(call.remoteScreenMc.peerConnection, call.stats.remoteScreen) : null;
    if (this.call !== call || call.ended) return;
    call.stats = { main, screen, remoteScreen: remoteScreenIn };

    // regolazione automatica
    const q = this.getPrefs().cameraQuality === 'saver' ? 'saver' : 'auto';
    if (main?.outBitrate !== null && main) {
      const before = call.ctlState.cam.level;
      call.ctlState.cam = nextState(call.ctlState.cam, main, CAMERA_LADDER[q]);
      if (call.ctlState.cam.level !== before) this.#applyCamera(call);
    }
    if (screen && call.screenStream) {
      const ladder = SCREEN_LADDER[call.screen.mode];
      const before = call.ctlState.screen.level;
      call.ctlState.screen = nextState(call.ctlState.screen, screen, ladder);
      if (call.ctlState.screen.level !== before) {
        call.screen.level = call.ctlState.screen.level;
        this.#applyScreen(call);
        this.emit('screen-quality', { level: call.screen.level, step: ladder[call.screen.level], mode: call.screen.mode });
      }
    }
    this.emit('stats', { main, screen, remoteScreen: remoteScreenIn, screenLevel: call.screen.level, camLevel: call.ctlState.cam.level });

    const pc = call.mainMc?.peerConnection;
    if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) this.#finish(call, 'lost', 'Connessione persa.');
  }

  // -------------------------------------------------------------------------------------------
  // Fine
  // -------------------------------------------------------------------------------------------

  hangup() {
    const call = this.call;
    if (!call) return;
    if (this.state === STATE.DIALING) this.#send(call, { t: 'cancel' });
    else if (this.state === STATE.RINGING) this.#send(call, { t: 'decline' });
    else this.#send(call, { t: 'bye' });
    this.#finish(call, 'hangup', '');
  }

  #onUnavailable(code) {
    const call = this.call;
    if (!call || this.state !== STATE.DIALING || (code && code !== call.remoteCode)) return;
    this.#finish(call, 'offline', 'Non risponde: l\'altra persona deve avere Squillo aperto e un codice giusto.');
  }

  #teardown(call) {
    call.ended = true;
    for (const t of Object.values(call.timers)) {
      clearTimeout(t);
      clearInterval(t);
    }
    call.screenStream?.getTracks().forEach((t) => t.stop());
    for (const mc of [call.mainMc, call.screenMc, call.remoteScreenMc]) {
      try {
        mc?.close();
      } catch {
        /* già chiusa */
      }
    }
    // lasciamo che l'ultimo messaggio parta prima di chiudere il canale
    const ctl = call.ctl;
    setTimeout(() => {
      try {
        ctl?.close();
      } catch {
        /* già chiuso */
      }
    }, 400);
    this.media?.stop();
    this.media = null;
  }

  #finish(call, reason, text) {
    if (call.ended) return;
    const duration = call.startedAt ? Math.round((Date.now() - call.startedAt) / 1000) : 0;
    this.#teardown(call);
    if (this.call === call) this.call = null;
    this.state = STATE.IDLE;
    this.emit('state', STATE.IDLE, null);
    this.emit('ended', { reason, text, duration, code: call.remoteCode, name: call.remoteName, role: call.role, startedAt: call.startedAt });
  }
}
