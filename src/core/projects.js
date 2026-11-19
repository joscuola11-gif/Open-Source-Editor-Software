// «I miei progetti»: logica pura per elenco di progetti salvati (nomi, riepilogo, voci).

import { allClips, projectDuration } from './project.js';

/** Riepilogo leggero di un progetto, mostrato nell'elenco. */
export function summarizeProject(p) {
  const media = Object.values(p.media ?? {});
  return {
    duration: projectDuration(p),
    clips: allClips(p).length,
    mediaCount: media.length,
    mediaBytes: media.reduce((s, m) => s + (Number.isFinite(m.size) ? m.size : 0), 0),
    width: p.settings?.width ?? 0,
    height: p.settings?.height ?? 0,
  };
}

/** Nome non ancora usato: «Nome», «Nome (2)», «Nome (3)»… (senza distinguere maiuscole). */
export function uniqueName(base, existing) {
  const clean = String(base ?? '').trim().slice(0, 100) || 'Progetto';
  const taken = new Set([...existing].map((n) => String(n).trim().toLowerCase()));
  if (!taken.has(clean.toLowerCase())) return clean;
  const stem = clean.replace(/ \(\d+\)$/, '');
  for (let i = 2; i < 10000; i++) {
    const n = `${stem} (${i})`;
    if (!taken.has(n.toLowerCase())) return n;
  }
  return `${stem} (${Date.now()})`;
}

/** Voce da salvare nell'elenco. `project` viene copiato: modifiche successive non la toccano. */
export function makeEntry({ id, name, project, thumb = null, now = Date.now(), created = now }) {
  const copy = JSON.parse(JSON.stringify(project));
  copy.name = name;
  return { id, name, created, updated: now, thumb, ...summarizeProject(copy), project: copy };
}

/** Testo per la data dell'ultima modifica, in italiano e relativo a `now`. */
export function whenLabel(ts, now = Date.now()) {
  const d = new Date(ts);
  const n = new Date(now);
  const day = (x) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86400000);
  const diff = day(n) - day(d);
  const hm = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (diff <= 0) return `oggi alle ${hm}`;
  if (diff === 1) return `ieri alle ${hm}`;
  if (diff < 7) return `${diff} giorni fa`;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' });
}
