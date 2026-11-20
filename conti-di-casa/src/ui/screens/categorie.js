// Categorie di spesa e di entrata, e le regole che scelgono la categoria da sole.

import { h } from '../dom.js';
import { card, chips, confirmBox, emojiPicker, emptyState, errorToast, field, openSheet, pageHeader, row, sectionTitle, segmented, toast, switchRow } from '../kit.js';
import { commit, getState, undo } from '../store.js';
import { alive, byId, COLORS } from '../../core/model.js';
import { addCategory, removeCategory, removeItem, upsert } from '../../core/ops.js';
import { normalize } from '../../core/rules.js';
import { go } from '../router.js';

const usage = (state, id) => state.movimenti.filter((m) => !m.x && m.categoriaId === id).length;

/** Foglio per creare o cambiare una categoria. `onDone(categoria)` al salvataggio. */
export function openCategoryForm({ tipo = 'spesa', id = null, onDone } = {}) {
  const s = getState();
  const k = id ? byId(s.categorie, id) : null;
  const f = { nome: k?.nome ?? '', emoji: k?.emoji ?? (tipo === 'spesa' ? '🧾' : '💰'), colore: k?.colore ?? COLORS[s.categorie.length % COLORS.length], tipo: k?.tipo ?? tipo };
  const name = h('input', { type: 'text', maxlength: 40, autocomplete: 'off', value: f.nome, placeholder: 'Per esempio: Palestra', 'aria-label': 'Nome della categoria', onInput: () => { f.nome = name.value; } });
  const body = h('div', { class: 'form' },
    !k && segmented({ items: [{ value: 'spesa', label: 'Spesa' }, { value: 'entrata', label: 'Entrata' }], value: f.tipo, label: 'Tipo', onChange: (v) => { f.tipo = v; } }),
    field('Nome', name),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Disegno'), emojiPicker({ value: f.emoji, onChange: (e) => { f.emoji = e; } })),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Colore'), chips({ items: COLORS.map((c) => ({ value: c, label: '', color: c })), value: f.colore, label: 'Colore', onChange: (c) => { f.colore = c; } })),
    k && switchRow({ label: 'Nascondi dalle scelte', hint: 'I vecchi movimenti restano, ma non la proponi più', checked: k.archiviata, onChange: () => {} }),
  );
  const save = () => {
    try {
      let out;
      commit((st, now) => {
        if (k) {
          const arch = body.querySelector('input[role=switch]')?.checked ?? false;
          const dup = alive(st.categorie).some((x) => x.id !== k.id && x.tipo === k.tipo && x.nome.toLowerCase() === f.nome.trim().toLowerCase());
          if (!f.nome.trim()) throw new Error('Scrivi il nome della categoria.');
          if (dup) throw new Error('Esiste già una categoria con questo nome.');
          out = upsert(st, 'categorie', { id: k.id, nome: f.nome.trim(), emoji: f.emoji || '🧾', colore: f.colore, archiviata: arch }, now);
        } else out = addCategory(st, { nome: f.nome, tipo: f.tipo, emoji: f.emoji, colore: f.colore }, now);
      });
      sheet.close();
      onDone?.(out);
    } catch (e) {
      errorToast(e);
    }
  };
  const del = async () => {
    const st = getState();
    const n = usage(st, k.id);
    const others = alive(st.categorie).filter((x) => x.tipo === k.tipo && x.id !== k.id);
    let reassignTo = null;
    if (n > 0 && others.length) {
      const choice = await pickCategory({ title: `Dove mettere i ${n} movimenti?`, tipo: k.tipo, exclude: k.id, allowNone: true, noneLabel: 'Lascia senza categoria' });
      if (choice === undefined) return;
      reassignTo = choice || null;
    } else if (!(await confirmBox({ title: `Eliminare «${k.nome}»?`, message: 'Il budget e le regole di questa categoria spariscono.', ok: 'Elimina', danger: true }))) return;
    commit((state, now) => removeCategory(state, k.id, { reassignTo, now }));
    sheet.close();
    toast('Categoria eliminata', { action: { label: 'Annulla', onClick: () => undo() } });
  };
  const footer = [k && h('button', { class: 'btn danger-text', type: 'button', onClick: del }, 'Elimina'), h('button', { class: 'btn primary', type: 'button', onClick: save }, 'Salva')];
  const sheet = openSheet({ title: k ? 'Modifica categoria' : 'Nuova categoria', content: body, footer });
  if (!k) setTimeout(() => name.focus(), 200);
}

/** Fa scegliere una categoria da un elenco. Risolve all'id, a '' (nessuna) o a undefined (annullato). */
export function pickCategory({ title = 'Scegli la categoria', tipo = 'spesa', exclude = null, allowNone = false, noneLabel = 'Nessuna categoria', current = null }) {
  return new Promise((resolve) => {
    let picked = false;
    const done = (v) => { picked = true; sheet.close(); resolve(v); };
    const list = alive(getState().categorie).filter((k) => k.tipo === tipo && k.id !== exclude && !k.archiviata);
    const body = h('div', { class: 'list' },
      allowNone && row({ icon: '∅', title: noneLabel, onClick: () => done('') }),
      list.map((k) => row({ icon: k.emoji, color: k.colore, title: k.nome, badge: k.id === current ? { text: 'attuale' } : null, onClick: () => done(k.id) })));
    const sheet = openSheet({ title, content: body, onClose: () => { if (!picked) resolve(undefined); } });
  });
}

export function render() {
  const s = getState();
  const section = (tipo, label) => {
    const list = alive(s.categorie).filter((k) => k.tipo === tipo).sort((a, b) => Number(a.archiviata) - Number(b.archiviata));
    return h('div', null,
      sectionTitle(label, { label: '＋ Aggiungi', onClick: () => openCategoryForm({ tipo }) }),
      card({ class: 'flush' }, h('div', { class: 'list' }, list.map((k) => row({ icon: k.emoji, color: k.colore, title: k.nome, subtitle: `${usage(s, k.id)} movimenti${k.archiviata ? ' · nascosta' : ''}`, onClick: () => openCategoryForm({ id: k.id }) })))));
  };
  return h('div', { class: 'screen' }, pageHeader({ title: 'Categorie' }), section('spesa', 'Spese'), section('entrata', 'Entrate'),
    h('div', { class: 'screen-links' }, h('button', { class: 'btn', type: 'button', onClick: () => go('regole') }, '⚙️ Regole automatiche')));
}

// ---- regole: «se la descrizione contiene … allora categoria …» ---------------------------------------------------

export function renderRules() {
  const s = getState();
  const cat = new Map(s.categorie.map((k) => [k.id, k]));
  const rules = alive(s.regole).filter((r) => cat.has(r.categoriaId) && !cat.get(r.categoriaId).x);
  const open = (r) => openRuleForm(r);
  return h('div', { class: 'screen' }, pageHeader({ title: 'Regole automatiche', fallback: 'categorie', actions: [h('button', { class: 'btn small primary', type: 'button', onClick: () => open(null) }, '＋ Nuova')] }),
    h('p', { class: 'lead' }, 'Se la descrizione di un movimento contiene una parola, l’app sceglie da sola la categoria. Per esempio: «esselunga» → Spesa alimentare.'),
    rules.length ? card({ class: 'flush' }, h('div', { class: 'list' }, rules.map((r) => row({ icon: cat.get(r.categoriaId).emoji, color: cat.get(r.categoriaId).colore, title: `«${r.contiene}»`, subtitle: `→ ${cat.get(r.categoriaId).nome}`, onClick: () => open(r) }))))
      : emptyState('⚙️', 'Nessuna regola', 'L’app impara anche da sola dai movimenti che hai già inserito. Le regole servono per i casi in cui vuoi decidere tu.', { label: '＋ Crea una regola', onClick: () => open(null) }));
}

function openRuleForm(rule) {
  const s = getState();
  const f = { contiene: rule?.contiene ?? '', categoriaId: rule?.categoriaId ?? '' };
  const inp = h('input', { type: 'text', maxlength: 60, autocomplete: 'off', value: f.contiene, placeholder: 'Per esempio: esselunga', 'aria-label': 'Parola da cercare', onInput: () => { f.contiene = inp.value; } });
  const list = alive(s.categorie).filter((k) => k.tipo === 'spesa' || k.tipo === 'entrata');
  const body = h('div', { class: 'form' }, field('Se la descrizione contiene', inp), h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'scegli la categoria'),
    chips({ items: list.map((k) => ({ value: k.id, label: k.nome, emoji: k.emoji, color: k.colore })), value: f.categoriaId, label: 'Categoria', onChange: (v) => { f.categoriaId = v; } })));
  const save = () => {
    try {
      if (!normalize(f.contiene)) throw new Error('Scrivi la parola da cercare.');
      if (!f.categoriaId) throw new Error('Scegli la categoria.');
      commit((st, now) => upsert(st, 'regole', { id: rule?.id, contiene: f.contiene.trim().toLowerCase(), categoriaId: f.categoriaId }, now));
      sheet.close();
    } catch (e) { errorToast(e); }
  };
  const footer = [rule && h('button', { class: 'btn danger-text', type: 'button', onClick: () => { commit((st, now) => removeItem(st, 'regole', rule.id, now)); sheet.close(); toast('Regola eliminata', { action: { label: 'Annulla', onClick: () => undo() } }); } }, 'Elimina'), h('button', { class: 'btn primary', type: 'button', onClick: save }, 'Salva')];
  const sheet = openSheet({ title: rule ? 'Modifica regola' : 'Nuova regola', content: body, footer });
}
