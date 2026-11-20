import { getState, hasState } from './store.js';

/** Applica il tema scelto (chiaro, scuro o quello del telefono). */
export function applyTheme() {
  const t = hasState() ? getState().impostazioni.tema : 'auto';
  const el = document.documentElement;
  if (t === 'chiaro') el.dataset.theme = 'light';
  else if (t === 'scuro') el.dataset.theme = 'dark';
  else delete el.dataset.theme;
  const dark = t === 'scuro' || (t === 'auto' && matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#101614' : '#1f7a5a');
}
