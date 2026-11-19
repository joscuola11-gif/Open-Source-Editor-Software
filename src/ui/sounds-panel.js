// Scheda «Suoni»: effetti sonori e musica generati dal programma (nessun campione, nessuna licenza di terzi).
// Si ascolta con il tasto ▶ e si mette sulla timeline alla posizione della testina.

import { projectDuration } from '../core/project.js';
import { KEYS, MUSIC_STYLES, SFX, SFX_GROUPS, generateMusic, renderSfx } from '../core/synth.js';
import { formatDuration } from '../core/util.js';
import { encodeWav } from '../core/wav.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { toast } from './overlays.js';
import { prefs } from './prefs.js';

let player = null;
let playingUrl = null;
function playWav(bytes) {
  stopPreview();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  player = new Audio(url);
  playingUrl = url;
  player.addEventListener('ended', stopPreview);
  player.play().catch(() => toast('Il browser non permette di riprodurre l’anteprima. Prova a cliccare di nuovo.', { type: 'warn' }));
}
export function stopPreview() {
  player?.pause();
  player = null;
  if (playingUrl) URL.revokeObjectURL(playingUrl);
  playingUrl = null;
}

const tick = () => new Promise((r) => setTimeout(r));

export function buildSoundsTab(app) {
  const a = app.actions;
  const saved = prefs.get('sounds', {});
  const st = {
    pitch: 0,
    volume: 0.8,
    seed: 1,
    style: MUSIC_STYLES[saved.style] ? saved.style : 'pop',
    bpm: '',
    key: 'auto',
    mode: 'auto',
    seconds: 30,
    fit: false,
    mseed: 1,
  };

  const sfxBytes = (id) => {
    const r = renderSfx(id, { seed: st.seed, pitch: st.pitch, volume: st.volume });
    return { bytes: encodeWav(r.channels, r.sampleRate), duration: r.duration };
  };

  const pitch = h('input', { type: 'range', id: 'snd-pitch', min: -12, max: 12, step: 1, value: 0, 'aria-label': 'Altezza in semitoni' });
  const pitchOut = h('output', { for: 'snd-pitch' }, '0');
  pitch.addEventListener('input', () => {
    st.pitch = Number(pitch.value);
    pitchOut.textContent = st.pitch > 0 ? `+${st.pitch}` : String(st.pitch);
  });
  const vol = h('input', { type: 'range', id: 'snd-volume', min: 10, max: 100, step: 5, value: 80, 'aria-label': 'Volume' });
  vol.addEventListener('input', () => {
    st.volume = Number(vol.value) / 100;
  });
  const variant = h('button', { class: 'btn small', type: 'button', id: 'snd-variant', title: 'Cambia la variante (per i suoni con una parte casuale)', onClick: () => {
    st.seed += 1;
    variantNote.textContent = `Variante ${st.seed}`;
  } }, icon('shuffle', 14), 'Altra variante');
  const variantNote = h('span', { class: 'hint' }, 'Variante 1');

  const card = (s) => h('div', { class: 'snd-card', 'data-sfx': s.id, role: 'listitem' },
    h('span', { class: 'snd-name' }, s.label),
    h('span', { class: 'snd-btns' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Ascolta ${s.label}`, title: 'Ascolta', 'data-act': 'sfx-play', onClick: () => playWav(sfxBytes(s.id).bytes) }, icon('play', 14)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Aggiungi ${s.label} alla timeline`, title: 'Aggiungi alla timeline', 'data-act': 'sfx-add', onClick: () => {
        const { bytes } = sfxBytes(s.id);
        a.addGeneratedAudio(bytes, { name: `Suono · ${s.label}`, label: 'Aggiungi suono' });
      } }, icon('plus', 14))));

  // ---- musica ----
  const select = (id, entries, value, on, label) => {
    const el = h('select', { id, class: 'cap-select', 'aria-label': label }, entries.map(([v, l]) => h('option', { value: v }, l)));
    el.value = value;
    el.addEventListener('change', () => on(el.value));
    return el;
  };
  const styleSel = select('mus-style', Object.entries(MUSIC_STYLES).map(([k, s]) => [k, s.label]), st.style, (v) => {
    st.style = v;
    prefs.set('sounds', { ...prefs.get('sounds', {}), style: v });
    const [lo, hi] = MUSIC_STYLES[v].bpm;
    bpmIn.placeholder = `${lo}–${hi}`;
  }, 'Stile');
  const bpmIn = h('input', { type: 'number', id: 'mus-bpm', class: 'num', min: 50, max: 200, step: 1, placeholder: `${MUSIC_STYLES[st.style].bpm[0]}–${MUSIC_STYLES[st.style].bpm[1]}`, 'aria-label': 'Battiti al minuto (vuoto = automatico)' });
  bpmIn.addEventListener('input', () => {
    st.bpm = bpmIn.value;
  });
  const keySel = select('mus-key', [['auto', 'Automatica'], ...KEYS.map((k, i) => [String(i), k])], st.key, (v) => {
    st.key = v;
  }, 'Tonalità');
  const modeSel = select('mus-mode', [['auto', 'Di stile'], ['major', 'Maggiore (allegra)'], ['minor', 'Minore (malinconica)']], st.mode, (v) => {
    st.mode = v;
  }, 'Scala');
  const secIn = h('input', { type: 'number', id: 'mus-seconds', class: 'num', min: 4, max: 600, step: 1, value: st.seconds, 'aria-label': 'Durata in secondi' });
  secIn.addEventListener('input', () => {
    st.seconds = Number(secIn.value) || 30;
  });
  const fitBox = h('input', { type: 'checkbox', id: 'mus-fit' });
  fitBox.addEventListener('change', () => {
    st.fit = fitBox.checked;
    secIn.disabled = st.fit;
  });
  const info = h('p', { class: 'hint', id: 'mus-info', role: 'status' });
  let last = null;
  const busy = (b) => {
    for (const el of [playBtn, addBtn, againBtn]) el.disabled = b;
  };
  async function compose() {
    busy(true);
    info.textContent = 'Sto componendo…';
    await tick();
    try {
      const seconds = st.fit ? Math.max(4, projectDuration(app.store.project) || 30) : Math.min(600, Math.max(4, st.seconds));
      const m = generateMusic({
        style: st.style,
        seconds,
        seed: st.mseed,
        bpm: st.bpm ? Number(st.bpm) : undefined,
        key: st.key === 'auto' ? undefined : Number(st.key),
        mode: st.mode === 'auto' ? undefined : st.mode,
      });
      await tick();
      const bytes = encodeWav(m.channels, m.sampleRate);
      last = { bytes, m };
      info.textContent = `${MUSIC_STYLES[st.style].label} · ${m.bpm} battiti al minuto · ${KEYS[m.key]} ${m.mode === 'major' ? 'maggiore' : 'minore'} · ${formatDuration(m.duration, 0)}`;
      return last;
    } catch (e) {
      info.textContent = `Non riesco a comporre: ${e.message}`;
      return null;
    } finally {
      busy(false);
    }
  }
  const playBtn = h('button', { class: 'btn', type: 'button', id: 'mus-play', onClick: async () => {
    const r = await compose();
    if (r) playWav(r.bytes);
  } }, icon('play', 14), 'Componi e ascolta');
  const addBtn = h('button', { class: 'btn primary', type: 'button', id: 'mus-add', onClick: async () => {
    const r = last ?? (await compose());
    if (r) a.addGeneratedAudio(r.bytes, { name: `Musica · ${MUSIC_STYLES[st.style].label}`, label: 'Aggiungi musica' });
  } }, icon('plus', 14), 'Aggiungi alla timeline');
  const againBtn = h('button', { class: 'btn small', type: 'button', id: 'mus-again', title: 'Un’altra composizione con le stesse scelte', onClick: () => {
    st.mseed += 1;
    last = null;
    info.textContent = `Versione ${st.mseed}: premi «Componi e ascolta».`;
  } }, icon('shuffle', 14), 'Altra versione');
  // quando cambia una scelta, la composizione precedente non vale più
  for (const el of [styleSel, bpmIn, keySel, modeSel, secIn, fitBox]) el.addEventListener('change', () => { last = null; });

  return h('div', { class: 'lib-pane', id: 'sounds-pane' },
    h('p', { class: 'hint' }, 'Suoni e musica nascono dal programma stesso (sintesi): non c’è nessun brano di altri, quindi niente diritti da rispettare.'),
    h('h4', { class: 'lib-h' }, 'Effetti sonori'),
    h('div', { class: 'snd-opts' },
      h('label', { class: 'inline-pair' }, 'Altezza', pitch, pitchOut),
      h('label', { class: 'inline-pair' }, 'Volume', vol),
      variant, variantNote),
    SFX_GROUPS.map((g) => [
      h('h5', { class: 'lib-h2', 'data-sfx-group': g }, g),
      h('div', { class: 'snd-grid', role: 'list' }, SFX.filter((s) => s.group === g).map(card)),
    ]),
    h('h4', { class: 'lib-h' }, 'Musica'),
    h('div', { class: 'cap-row' },
      h('label', { class: 'cap-field' }, h('span', { class: 'field-label' }, 'Stile'), styleSel),
      h('label', { class: 'cap-field' }, h('span', { class: 'field-label' }, 'Battiti al minuto'), bpmIn)),
    h('div', { class: 'cap-row' },
      h('label', { class: 'cap-field' }, h('span', { class: 'field-label' }, 'Tonalità'), keySel),
      h('label', { class: 'cap-field' }, h('span', { class: 'field-label' }, 'Scala'), modeSel)),
    h('div', { class: 'cap-row' },
      h('label', { class: 'cap-field' }, h('span', { class: 'field-label' }, 'Durata (secondi)'), secIn),
      h('label', { class: 'cap-check' }, fitBox, 'Quanto il progetto')),
    info,
    h('div', { class: 'lib-actions wrap' }, playBtn, addBtn, againBtn),
    h('p', { class: 'hint' }, 'La musica dura un numero intero di battute, quindi può essere un po’ più corta o lunga di quanto chiesto.'));
}
