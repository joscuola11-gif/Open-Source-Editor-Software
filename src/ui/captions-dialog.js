// Finestra «Sottotitoli automatici»: sceglie l'audio (clip selezionato o tutto il progetto), il metodo
// (riconoscimento del parlato, testo già pronto da allineare, solo i tempi), poi mostra i sottotitoli da correggere prima di metterli in timeline.

import { CAPTION_STYLES, cuesForTimeline } from '../core/captions.js';
import { allClips, findClip } from '../core/project.js';
import { formatSrt } from '../core/srt.js';
import { captionsFromScript, emptyCuesFromSpeech, transcribe } from '../core/transcribe.js';
import { ASR_LANGUAGES, ASR_MODELS, createAsrEngine } from '../engine/asr-engines.js';
import { renderProjectAudio } from '../engine/audio-export.js';
import { downloadBlob } from '../engine/exporter.js';
import { formatDuration } from '../core/util.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { openDialog, toast } from './overlays.js';
import { prefs } from './prefs.js';

const METHODS = [
  ['asr', 'Riconosci il parlato', 'Il programma ascolta la voce e scrive il testo da solo.'],
  ['script', 'Ho già il testo', 'Incolla il testo (copione): il programma lo mette a tempo con la voce, senza errori di trascrizione.'],
  ['timing', 'Solo i tempi', 'Crea una riga vuota per ogni frase detta, già a tempo: il testo lo scrivi tu.'],
];
const LOOKS = [['classic', 'Classico'], ['outline', 'Contorno'], ['yellow', 'Giallo'], ['box', 'Riquadro'], ['karaoke', 'Karaoke']];

export function openCaptionsDialog(app) {
  const a = app.actions;
  const remembered = prefs.get('captions', {}) ?? {};
  const sel = app.selection.ids.map((id) => findClip(app.store.project, id)?.clip).find((c) => c && (c.kind === 'audio' || c.kind === 'video') && c.mediaId && !c.muted);
  const state = {
    source: sel ? 'clip' : 'project',
    method: 'asr',
    language: remembered.language && ASR_LANGUAGES[remembered.language] ? remembered.language : 'it',
    model: remembered.model && ASR_MODELS[remembered.model] ? remembered.model : 'tiny',
    style: 'standard',
    look: 'classic',
    karaoke: false,
    fillers: false,
    replace: allClips(app.store.project).some((c) => c.role === 'subtitle'),
    script: '',
    cues: [],
    offset: 0,
    speed: 1,
    running: false,
    signal: null,
  };

  const field = (label, control, hint) => h('label', { class: 'cap-field' }, h('span', { class: 'field-label' }, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
  const select = (id, entries, value, onChange) => {
    const el = h('select', { id, class: 'cap-select' }, entries.map(([v, l]) => h('option', { value: v }, l)));
    el.value = value;
    el.addEventListener('change', () => onChange(el.value));
    return el;
  };
  const check = (id, label, value, onChange) => {
    const el = h('input', { type: 'checkbox', id, checked: value });
    el.addEventListener('change', () => onChange(el.checked));
    return h('label', { class: 'cap-check' }, el, label);
  };

  const sourceSel = select('cap-source', [['clip', sel ? `Clip selezionato: ${(sel.name || 'senza nome').slice(0, 30)}` : 'Clip selezionato (selezionane uno)'], ['project', 'Tutto l’audio del progetto']], state.source, (v) => {
    state.source = v;
  });
  if (!sel) sourceSel.querySelector('option[value="clip"]').disabled = true;
  const methodHint = h('p', { class: 'hint', id: 'cap-method-hint' }, METHODS[0][2]);
  const methodSel = select('cap-method', METHODS.map(([v, l]) => [v, l]), state.method, (v) => {
    state.method = v;
    syncVisibility();
  });
  const langSel = select('cap-lang', Object.entries(ASR_LANGUAGES), state.language, (v) => {
    state.language = v;
  });
  const modelSel = select('cap-model', Object.entries(ASR_MODELS).map(([k, m]) => [k, m.label]), state.model, (v) => {
    state.model = v;
  });
  const styleSel = select('cap-style', Object.entries(CAPTION_STYLES).map(([k, s]) => [k, s.label]), state.style, (v) => {
    state.style = v;
  });
  const lookSel = select('cap-look', LOOKS, state.look, (v) => {
    state.look = v;
  });
  const script = h('textarea', { id: 'cap-script', class: 'cap-script', rows: 5, placeholder: 'Incolla qui il testo parlato, nell’ordine in cui viene detto…', 'aria-label': 'Testo da allineare alla voce' });
  script.addEventListener('input', () => {
    state.script = script.value;
  });

  const modelBox = h('div', { class: 'cap-model-box' }, field('Modello', modelSel, 'La prima volta viene scaricato (serve internet); poi funziona anche senza.'));
  const scriptBox = h('div', { class: 'cap-script-box' }, field('Testo', script));
  const fillersBox = check('cap-fillers', 'Togli le esitazioni («ehm», «uhm»…)', state.fillers, (v) => {
    state.fillers = v;
  });
  const styleBox = h('div', { class: 'cap-row' }, field('Lunghezza dei sottotitoli', styleSel), field('Aspetto', lookSel));

  const progress = h('progress', { class: 'exp-progress', id: 'cap-progress', max: 1, value: 0, hidden: true });
  const status = h('div', { class: 'exp-status', id: 'cap-status', role: 'status' });
  const list = h('div', { class: 'cap-list', id: 'cap-list', role: 'list' });
  const resultBox = h('div', { class: 'cap-result', hidden: true });

  function syncVisibility() {
    methodHint.textContent = METHODS.find((m) => m[0] === state.method)[2];
    modelBox.hidden = state.method !== 'asr';
    langSel.closest('.cap-field').hidden = state.method === 'timing';
    scriptBox.hidden = state.method !== 'script';
    fillersBox.hidden = state.method !== 'asr';
    styleBox.hidden = state.method === 'timing';
  }

  const modelProgress = (p) => {
    if (!p) return;
    if (p.status === 'progress' && Number.isFinite(p.progress)) {
      progress.hidden = false;
      progress.value = p.progress / 100;
      status.textContent = `Scarico il modello… ${Math.round(p.progress)}%`;
    } else if (p.status === 'ready') status.textContent = 'Modello pronto.';
  };

  const setBusy = (busy) => {
    state.running = busy;
    runBtn.disabled = busy;
    stopBtn.hidden = !busy;
    for (const el of [sourceSel, methodSel, langSel, modelSel, styleSel, lookSel, script]) el.disabled = busy;
    if (!sel) sourceSel.querySelector('option[value="clip"]').disabled = true;
  };

  const fail = (e) => {
    status.textContent = '';
    progress.hidden = true;
    status.className = 'exp-status error';
    status.textContent = e?.message === 'Operazione annullata.' ? 'Operazione annullata.' : `Non è riuscito: ${e?.message ?? e}`;
    status.dataset.state = 'error';
  };

  async function getAudio() {
    if (state.source === 'clip') {
      if (!sel) throw new Error('Seleziona un clip con audio.');
      const r = await a.clipAudio(sel);
      state.offset = sel.start;
      state.speed = sel.speed || 1;
      return r;
    }
    const r = await renderProjectAudio(app.store.project, app.pool, (v) => {
      progress.hidden = false;
      progress.value = v * 0.3;
      status.textContent = 'Preparo l’audio del progetto…';
    });
    state.offset = 0;
    state.speed = 1;
    return r;
  }

  async function run() {
    if (state.running) return;
    status.className = 'exp-status';
    delete status.dataset.state;
    setBusy(true);
    state.signal = { aborted: false };
    progress.hidden = false;
    progress.value = 0;
    status.textContent = 'Preparo l’audio…';
    try {
      if (state.method === 'script' && !state.script.trim()) throw new Error('Scrivi o incolla il testo da allineare.');
      const { channels, sampleRate } = await getAudio();
      let cues;
      if (state.method === 'timing') {
        status.textContent = 'Cerco dove si parla…';
        cues = emptyCuesFromSpeech({ channels, sampleRate }).cues;
        if (!cues.length) throw new Error('Non sento parlato in questo audio.');
      } else if (state.method === 'script') {
        status.textContent = 'Allineo il testo alla voce…';
        await new Promise((r) => setTimeout(r));
        cues = captionsFromScript({ channels, sampleRate, script: state.script, style: state.style, captionOptions: {} }).cues;
        if (!cues.length) throw new Error('Non riesco a mettere a tempo il testo: controlla che nell’audio ci sia parlato.');
      } else {
        const engine = createAsrEngine({ model: state.model, onModelProgress: modelProgress });
        const av = await engine.available();
        if (!av.ok) throw new Error(av.reason || 'Il riconoscimento vocale non è disponibile su questo computer.');
        try {
          const r = await transcribe({
            channels,
            sampleRate,
            language: state.language,
            engine,
            style: state.style,
            captionOptions: { removeFillers: state.fillers },
            signal: state.signal,
            onProgress: ({ step, done, total }) => {
              progress.hidden = false;
              if (step === 'voce') status.textContent = 'Cerco dove si parla…';
              else if (step === 'riconoscimento') {
                status.textContent = total > 1 ? `Riconosco il parlato… (${done + 1} di ${total})` : 'Riconosco il parlato…';
                progress.value = 0.3 + 0.65 * (done / Math.max(1, total));
              } else status.textContent = 'Preparo i sottotitoli…';
            },
          });
          cues = r.cues;
          if (!cues.length) throw new Error('Non ho riconosciuto parole. Prova con un’altra lingua o un modello migliore.');
        } finally {
          engine.dispose?.();
        }
        prefs.set('captions', { language: state.language, model: state.model });
      }
      state.cues = cues;
      progress.value = 1;
      status.textContent = `${cues.length} sottotitoli pronti. Controllali e correggili se serve, poi aggiungili alla timeline.`;
      renderList();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const timelineTime = (t) => state.offset + t / state.speed;

  function renderList() {
    resultBox.hidden = !state.cues.length;
    list.replaceChildren(...state.cues.map((c, i) => {
      const ta = h('textarea', { class: 'cap-text', rows: Math.max(1, c.text.split('\n').length), 'aria-label': `Testo del sottotitolo ${i + 1}`, placeholder: state.method === 'timing' ? 'Scrivi qui cosa viene detto…' : '' });
      ta.value = c.text;
      ta.addEventListener('input', () => {
        c.text = ta.value;
      });
      return h('div', { class: 'cap-row-item', role: 'listitem', 'data-i': i },
        h('button', { class: 'sub-time', type: 'button', title: 'Vai a questo punto', onClick: () => app.player.seek(Math.max(0, timelineTime(c.start))) }, `${formatDuration(timelineTime(c.start), 1)} → ${formatDuration(timelineTime(c.end), 1)}`),
        ta,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Elimina questo sottotitolo', title: 'Elimina', onClick: () => { state.cues.splice(state.cues.indexOf(c), 1); renderList(); } }, icon('trash', 14)));
    }));
  }

  function addToTimeline() {
    const karaoke = state.karaoke || state.look === 'karaoke';
    const cues = cuesForTimeline(state.cues, { offset: state.offset, speed: state.speed, karaoke });
    if (!cues.length) return toast('Non c’è nessun sottotitolo con del testo da aggiungere.', { type: 'warn' });
    const r = a.addSubtitleCues(cues, { style: state.look, label: 'Sottotitoli automatici', replace: state.replace });
    if (r?.ok) {
      toast(`${cues.length} sottotitoli aggiunti alla timeline`, { type: 'success' });
      ctl.close('added');
    }
  }

  function exportSrt() {
    const cues = cuesForTimeline(state.cues, { offset: state.offset, speed: state.speed });
    if (!cues.length) return toast('Non c’è nulla da esportare.', { type: 'warn' });
    downloadBlob(new Blob([formatSrt(cues)], { type: 'application/x-subrip;charset=utf-8' }), `${app.store.project.name}.srt`);
  }

  const runBtn = h('button', { class: 'btn primary', type: 'button', id: 'cap-run', 'data-act': 'cap-run', onClick: run }, icon('sparkles', 16), 'Crea i sottotitoli');
  const stopBtn = h('button', { class: 'btn', type: 'button', id: 'cap-stop', hidden: true, onClick: () => { if (state.signal) state.signal.aborted = true; } }, 'Annulla');
  const karaokeCheck = check('cap-karaoke', 'Evidenzia le parole mentre vengono dette (karaoke)', state.karaoke, (v) => {
    state.karaoke = v;
  });
  const replaceCheck = check('cap-replace', 'Sostituisci i sottotitoli già presenti', state.replace, (v) => {
    state.replace = v;
  });
  resultBox.append(
    h('div', { class: 'cap-opts' }, karaokeCheck, replaceCheck),
    list,
    h('div', { class: 'cap-actions' },
      h('button', { class: 'btn primary', type: 'button', id: 'cap-add', 'data-act': 'cap-add', onClick: addToTimeline }, icon('plus', 16), 'Aggiungi alla timeline'),
      h('button', { class: 'btn', type: 'button', id: 'cap-srt', 'data-act': 'cap-srt', onClick: exportSrt }, icon('download', 16), 'Esporta SRT')));

  const content = h('div', { class: 'cap-dialog' },
    h('div', { class: 'cap-row' }, field('Audio', sourceSel), field('Metodo', methodSel)),
    methodHint,
    h('div', { class: 'cap-row' }, field('Lingua', langSel), modelBox),
    scriptBox,
    styleBox,
    fillersBox,
    h('div', { class: 'cap-run' }, runBtn, stopBtn),
    progress,
    status,
    resultBox);
  syncVisibility();
  const ctl = openDialog({ title: 'Sottotitoli automatici', content, wide: true, id: 'captions-dialog', actions: [{ label: 'Chiudi', id: 'cap-close', onClick: () => { if (state.signal) state.signal.aborted = true; } }] });
  return { ctl, state };
}
