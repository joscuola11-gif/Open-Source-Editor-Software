// Dati: copie di sicurezza, unione con un altro telefono, esportazione per Excel, importazione dalla banca.

import { h } from '../dom.js';
import { card, chips, confirmBox, errorToast, field, fmt, openSheet, pageHeader, row, sectionTitle, segmented, switchRow, toast } from '../kit.js';
import { commit, currentPeriod, getState, replaceState, resetAll, today, undo } from '../store.js';
import { alive, byId } from '../../core/model.js';
import { makeBackup, readBackup } from '../../core/backup.js';
import { mergeStates } from '../../core/merge.js';
import { formatCsv, parseCsv } from '../../core/csv.js';
import { monthSummaryText, transactionRows } from '../../core/export.js';
import { buildTransactions, detectMapping, hasHeader } from '../../core/importer.js';
import { addTransaction } from '../../core/ledger.js';
import { formatDate } from '../../core/dates.js';
import { isNative, pickTextFile, saveTextFile, shareText } from '../../platform.js';
import { loadAutoCopy, pref, wipeAll } from '../../storage.js';
import { go } from '../router.js';

const stamp = () => today();

async function saveBackup() {
  try {
    const name = `conti-di-casa-${stamp()}.json`;
    await saveTextFile(name, 'application/json', makeBackup(getState()));
    pref.set('ultimaCopia', today());
    toast(isNative() ? 'Copia salvata ✓' : `Copia scaricata: ${name}`);
    import('../store.js').then((m) => m.refresh());
  } catch (e) { errorToast(e); }
}

async function readFileAsBackup() {
  const f = await pickTextFile('.json,application/json,text/plain');
  if (!f) return null;
  return readBackup(f.text);
}

async function restore() {
  try {
    const b = await readFileAsBackup();
    if (!b) return;
    const ok = await confirmBox({ title: 'Ripristinare questa copia?', message: `La copia contiene ${b.info.movimenti} movimenti, ${b.info.conti} conti e ${b.info.membri} persone${b.info.esportato ? ` (fatta il ${formatDate(b.info.esportato.slice(0, 10), 'long')})` : ''}.\n\nTutti i dati di questo telefono vengono sostituiti. Potrai annullare subito dopo.`, ok: 'Ripristina', danger: true });
    if (!ok) return;
    replaceState(b.stato);
    toast('Copia ripristinata', { action: { label: 'Annulla', onClick: () => undo() } });
  } catch (e) { errorToast(e); }
}

async function mergeFromFile() {
  try {
    const b = await readFileAsBackup();
    if (!b) return;
    const { stato, riepilogo: r } = mergeStates(getState(), b.stato);
    const parts = [];
    if (r.aggiunti) parts.push(`${r.aggiunti} nuovi`);
    if (r.aggiornati) parts.push(`${r.aggiornati} cambiati`);
    if (r.cancellati) parts.push(`${r.cancellati} cancellati`);
    if (r.ripristinati) parts.push(`${r.ripristinati} rimessi`);
    if (!parts.length) return toast('Non c’è niente di nuovo: i due telefoni sono già uguali.');
    if (!(await confirmBox({ title: 'Unire i dati?', message: `Dal file arrivano: ${parts.join(', ')} (conti, movimenti, categorie…).\n\nI dati di questo telefono restano; vince la modifica più recente. Il PIN e il blocco restano i tuoi. Potrai annullare subito dopo.`, ok: 'Unisci' }))) return;
    replaceState(stato);
    toast('Dati uniti ✓', { action: { label: 'Annulla', onClick: () => undo() } });
  } catch (e) { errorToast(e); }
}

async function restoreAuto() {
  const a = await loadAutoCopy();
  if (!a?.stato) return toast('Non c’è ancora una copia automatica.');
  if (!(await confirmBox({ title: 'Tornare alla copia automatica?', message: `È la copia fatta da sola il ${formatDate(a.giorno, 'long')}. I dati attuali vengono sostituiti (potrai annullare subito).`, ok: 'Ripristina', danger: true }))) return;
  replaceState(a.stato);
  toast('Copia automatica ripristinata', { action: { label: 'Annulla', onClick: () => undo() } });
}

async function exportCsv(scope) {
  try {
    const p = currentPeriod();
    const rows = transactionRows(getState(), scope === 'periodo' ? { from: p.from, to: p.to } : {});
    if (rows.length <= 1) return toast('Non ci sono movimenti da esportare.');
    await saveTextFile(`movimenti-${scope === 'periodo' ? p.from : 'tutti'}.csv`, 'text/csv', formatCsv(rows));
    toast(`Esportati ${rows.length - 1} movimenti ✓`);
  } catch (e) { errorToast(e); }
}

async function shareSummary() {
  try {
    const s = getState();
    await shareText(`${s.famiglia.nome} — riepilogo`, monthSummaryText(s, currentPeriod(), { currency: s.impostazioni.valuta }));
  } catch (e) { if (!/annullat/i.test(e.message)) errorToast(e); }
}

// ---- importazione di un estratto conto ---------------------------------------------------------------------------

async function importCsv() {
  try {
    const f = await pickTextFile('.csv,.txt,text/csv,text/plain');
    if (!f) return;
    const { righe } = parseCsv(f.text);
    if (righe.length < 1) throw new Error('Il file è vuoto.');
    openImportSheet(righe, f.name);
  } catch (e) { errorToast(e); }
}

function openImportSheet(rows, fileName) {
  const s = getState();
  const header = hasHeader(rows) ? rows[0] : null;
  const data = header ? rows.slice(1) : rows;
  if (!data.length) return errorToast(new Error('Nel file ci sono solo le intestazioni, nessun movimento.'));
  const width = Math.max(...rows.slice(0, 50).map((r) => r.length));
  const colNames = Array.from({ length: width }, (_, i) => (header?.[i]?.trim() ? header[i].trim() : `Colonna ${i + 1}`));
  const mapping = header ? detectMapping(header) : {};
  const accounts = alive(s.conti).filter((c) => !c.archiviato);
  const members = alive(s.membri).filter((m) => !m.archiviato);
  const f = { contoId: accounts[0]?.id ?? '', membroId: '', invert: false, doppioni: false };
  const result = h('div', { class: 'import-result', 'aria-live': 'polite' });
  const importBtn = h('button', { class: 'btn primary', type: 'button' }, 'Importa');
  let built = { voci: [], errori: [] };

  function recompute() {
    if (!f.contoId) { result.textContent = 'Scegli il conto.'; importBtn.disabled = true; return; }
    const m = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if (m.data === undefined || (m.importo === undefined && m.entrate === undefined && m.uscite === undefined)) {
      result.textContent = 'Indica quali colonne sono la data e l’importo.';
      importBtn.disabled = true;
      built = { voci: [], errori: [] };
      return;
    }
    built = buildTransactions(data, m, { state: s, contoId: f.contoId, membroId: f.membroId || null, invertSign: f.invert });
    const dup = built.voci.filter((v) => v.doppione).length;
    const toImport = f.doppioni ? built.voci.length : built.voci.length - dup;
    const sample = built.voci.slice(0, 3).map((v) => `${formatDate(v.tx.data, 'short')} · ${v.tx.descrizione || '—'} · ${fmt(v.tx.tipo === 'spesa' ? -v.tx.importo : v.tx.importo, { force: true })}`);
    result.replaceChildren(
      h('p', null, h('strong', null, `${toImport} da importare`), dup ? ` · ${dup} già presenti${f.doppioni ? ' (li importo lo stesso)' : ' (saltati)'}` : '', built.errori.length ? ` · ${built.errori.length} righe da scartare` : ''),
      sample.length ? h('ul', { class: 'notes' }, sample.map((x) => h('li', null, x))) : null,
      built.errori.length ? h('p', { class: 'field-hint bad' }, `Prima riga scartata: riga ${built.errori[0].riga} — ${built.errori[0].motivo}`) : null);
    importBtn.disabled = toImport === 0;
    importBtn.textContent = toImport ? `Importa ${toImport}` : 'Importa';
  }
  const colSelect = (key, label, optional = true) => {
    const sel = h('select', { 'aria-label': label, onChange: () => { if (sel.value === '') delete mapping[key]; else mapping[key] = Number(sel.value); recompute(); } },
      h('option', { value: '' }, optional ? '— nessuna —' : 'Scegli…'), colNames.map((n, i) => h('option', { value: i, selected: mapping[key] === i }, n)));
    return field(label, sel);
  };
  const body = h('div', { class: 'form' },
    h('p', { class: 'lead' }, `File: ${fileName} · ${data.length} righe`),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Su quale conto vanno?'), chips({ items: accounts.map((c) => ({ value: c.id, label: c.nome, emoji: c.emoji, color: c.colore })), value: f.contoId, label: 'Conto', onChange: (v) => { f.contoId = v; recompute(); } })),
    members.length > 1 && h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Di chi sono?'), chips({ items: [{ value: '', label: 'Non indicato' }, ...members.map((m) => ({ value: m.id, label: m.nome, emoji: m.emoji, color: m.colore }))], value: f.membroId, label: 'Chi', onChange: (v) => { f.membroId = v; recompute(); } })),
    colSelect('data', 'Colonna della data', false), colSelect('descrizione', 'Colonna della descrizione'), colSelect('importo', 'Colonna dell’importo (con il segno)'),
    h('details', { class: 'more' }, h('summary', null, 'Entrate e uscite in colonne separate'), colSelect('entrate', 'Colonna delle entrate'), colSelect('uscite', 'Colonna delle uscite')),
    colSelect('categoria', 'Colonna della categoria (facoltativa)'),
    switchRow({ label: 'Inverti i segni', hint: 'Attivalo se le spese risultano entrate (alcune carte usano il segno + per gli acquisti)', checked: f.invert, onChange: (v) => { f.invert = v; recompute(); } }),
    switchRow({ label: 'Importa anche i doppioni', hint: 'Di norma i movimenti già presenti si saltano', checked: f.doppioni, onChange: (v) => { f.doppioni = v; recompute(); } }),
    result);
  importBtn.addEventListener('click', () => {
    const list = built.voci.filter((v) => f.doppioni || !v.doppione);
    let ok = 0;
    let fail = 0;
    commit((st, now) => {
      for (const v of list) {
        try { addTransaction(st, v.tx, now); ok++; } catch { fail++; }
      }
    });
    sheet.close();
    toast(`Importati ${ok} movimenti${fail ? ` (${fail} non validi)` : ''}`, { action: { label: 'Annulla', onClick: () => undo() } });
  });
  const sheet = openSheet({ title: 'Importa dalla banca', content: body, footer: [importBtn], wide: true });
  recompute();
}

async function wipe() {
  if (!(await confirmBox({ title: 'Cancellare tutto?', message: 'Conti, movimenti, budget… tutto sparisce da questo telefono. Se non hai una copia di sicurezza, non si recupera.', ok: 'Cancella tutto', danger: true }))) return;
  if (!(await confirmBox({ title: 'Sicuro, sicuro?', message: 'Ultima conferma: ricomincerai da zero.', ok: 'Sì, cancella', danger: true }))) return;
  await wipeAll();
  resetAll();
  location.hash = '#/home';
  location.reload();
}

export function render() {
  const s = getState();
  const last = pref.get('ultimaCopia');
  const root = h('div', { class: 'screen' }, pageHeader({ title: 'Dati e copie' }));
  root.append(card(null, sectionTitle('Copia di sicurezza'), h('p', { class: 'muted' }, last ? `Ultima copia: ${formatDate(last, 'long')}.` : 'Non hai ancora fatto nessuna copia.'),
    h('p', null, 'I tuoi dati stanno solo su questo telefono. Salva ogni tanto una copia (e mandala a te stesso per e-mail o su un cloud) per non perderli se cambi o rompi il telefono.'),
    h('div', { class: 'btn-col' }, h('button', { class: 'btn primary', type: 'button', onClick: saveBackup }, '💾 Salva una copia'), h('button', { class: 'btn', type: 'button', onClick: restore }, '📂 Ripristina da una copia'), h('button', { class: 'btn small', type: 'button', onClick: restoreAuto }, '🕘 Torna alla copia automatica di oggi'))));
  root.append(card(null, sectionTitle('Unisci con un altro telefono'), h('p', null, 'Anche il coniuge usa l’app? Ognuno salva una copia, la manda all’altro e la unisce qui: i movimenti di tutti e due finiscono insieme, senza doppioni. Ripetilo quando vuoi.'),
    h('button', { class: 'btn', type: 'button', onClick: mergeFromFile }, '🔀 Unisci una copia')));
  root.append(card(null, sectionTitle('Per Excel e per la banca'), h('div', { class: 'btn-col' },
    h('button', { class: 'btn', type: 'button', onClick: () => exportCsv('periodo') }, `📤 Esporta ${currentPeriod().label.split(' (')[0]} (CSV)`), h('button', { class: 'btn', type: 'button', onClick: () => exportCsv('tutto') }, '📤 Esporta tutti i movimenti (CSV)'),
    h('button', { class: 'btn', type: 'button', onClick: shareSummary }, '✉️ Manda il riepilogo del periodo'), h('button', { class: 'btn', type: 'button', onClick: importCsv }, '📥 Importa un estratto conto (CSV)')),
    h('p', { class: 'field-hint' }, 'L’estratto conto si scarica dal sito o dall’app della banca. Riconosciamo da soli le colonne più comuni.')));
  root.append(card({ class: 'danger-zone' }, sectionTitle('Zona pericolosa'), h('button', { class: 'btn danger', type: 'button', onClick: wipe }, '🗑 Cancella tutti i dati')));
  return root;
}
