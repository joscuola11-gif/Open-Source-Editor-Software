// La «scocca» dell'app: barra in basso, pagine, blocco, primo avvio.

import { h } from './dom.js';
import * as store from './store.js';
import { go, canGoBack, isTab, onRoute, route, start as startRouter } from './router.js';
import { closeAllSheets, closeTopSheet, toast } from './kit.js';
import { applyTheme } from './theme.js';
import { consumeBusy, isNative, setSecure } from '../platform.js';
import { openTxForm } from './screens/txform.js';
import * as home from './screens/home.js';
import * as movimenti from './screens/movimenti.js';
import * as budget from './screens/budget.js';
import * as altro from './screens/altro.js';
import * as stats from './screens/stats.js';
import * as conti from './screens/conti.js';
import * as famiglia from './screens/famiglia.js';
import * as ricorrenti from './screens/ricorrenti.js';
import * as obiettivi from './screens/obiettivi.js';
import * as categorie from './screens/categorie.js';
import * as dati from './screens/dati.js';
import * as impostazioni from './screens/impostazioni.js';
import { renderLock } from './screens/lock.js';
import { renderOnboarding } from './screens/onboarding.js';

const SCREENS = {
  home: () => home.render(), movimenti: () => movimenti.render(), budget: () => budget.render(), altro: () => altro.render(),
  statistiche: () => stats.render(), conti: () => conti.render(), conto: (id) => conti.renderDetail(id), famiglia: () => famiglia.render(),
  ricorrenti: () => ricorrenti.render(), obiettivi: () => obiettivi.render(), categorie: () => categorie.render(), regole: () => categorie.renderRules(),
  dati: () => dati.render(), impostazioni: () => impostazioni.render(),
};
// a quale scheda in basso appartiene ogni pagina
const TAB_OF = { home: 'home', movimenti: 'movimenti', budget: 'budget' };
const TABS = [['home', '🏠', 'Casa'], ['movimenti', '🧾', 'Movimenti'], null, ['budget', '🎯', 'Budget'], ['altro', '☰', 'Altro']];

let mode = 'boot';
let main = null;
let banner = null;
let tabbar = null;
let lastKey = '';
let routerStarted = false;
let hiddenAt = 0;
let lastDay = '';
const root = () => document.getElementById('app');

const needsLock = () => {
  const s = store.settings();
  return Boolean(s.pinHash) || (s.bloccoTelefono && isNative());
};

function errorScreen(e) {
  console.error(e);
  return h('div', { class: 'screen' }, h('section', { class: 'card empty' }, h('div', { class: 'empty-emoji' }, '😕'), h('h3', null, 'Qualcosa non ha funzionato'), h('p', null, 'I tuoi dati sono al sicuro. Torna alla pagina iniziale e riprova.'), h('button', { class: 'btn primary', type: 'button', onClick: () => go('home') }, 'Torna alla Home')));
}

function renderMain() {
  if (mode !== 'app' || !main) return;
  const { name, arg } = route();
  const key = `${name}/${arg ?? ''}`;
  const y = key === lastKey ? window.scrollY : 0;
  let el;
  try {
    el = (SCREENS[name] ?? SCREENS.home)(arg);
  } catch (e) {
    el = errorScreen(e);
  }
  main.replaceChildren(el);
  window.scrollTo(0, y);
  lastKey = key;
  const active = TAB_OF[name] ?? 'altro';
  for (const b of tabbar.querySelectorAll('[data-tab]')) {
    const on = b.dataset.tab === active;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  banner.replaceChildren(store.storageWorks() ? '' : h('div', { class: 'banner warn', role: 'alert' }, '⚠️ Su questo telefono i dati non si possono salvare. Fai subito una copia da Altro → Dati e copie.'));
  document.title = `${name === 'home' ? 'Conti di Casa' : name.charAt(0).toUpperCase() + name.slice(1)} · Conti di Casa`;
}

function showApp() {
  mode = 'app';
  closeAllSheets();
  applyTheme();
  setSecure(needsLock());
  main = h('main', { id: 'main', tabindex: -1 });
  banner = h('div', { id: 'banner' });
  tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Menu principale' }, TABS.map((t) => (t
    ? h('button', { class: 'tab', type: 'button', dataset: { tab: t[0] }, onClick: () => go(t[0]) }, h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, t[1]), h('span', { class: 'tab-label' }, t[2]))
    : h('button', { class: 'fab', type: 'button', 'aria-label': 'Aggiungi un movimento', onClick: () => openTxForm() }, '＋'))));
  root().replaceChildren(h('div', { class: 'app' }, banner, main), tabbar);
  lastDay = store.today();
  const n = store.runRecurring();
  if (n) toast(`Registrat${n === 1 ? 'o 1 movimento ricorrente' : `i ${n} movimenti ricorrenti`}`, { action: { label: 'Annulla', onClick: () => store.undo() } });
  if (!routerStarted) {
    routerStarted = true;
    onRoute(() => { closeAllSheets(); renderMain(); });
    startRouter();
  } else renderMain();
}

function showLock() {
  mode = 'lock';
  closeAllSheets();
  store.view.reveal = false;
  store.view.offset = 0;
  root().replaceChildren(renderLock({ onUnlock: showApp }));
}

function showOnboarding() {
  mode = 'onboarding';
  root().replaceChildren(renderOnboarding());
}

// il tasto «indietro» di Android: chiude un foglio, torna indietro o esce
globalThis.__onBack = () => {
  if (closeTopSheet()) return true;
  if (mode !== 'app') return false;
  if (canGoBack()) { history.back(); return true; }
  if (route().name !== 'home') { go('home'); return true; }
  return false;
};

let away = false;
function leave() {
  if (away) return;
  away = true;
  hiddenAt = Date.now();
  void store.flush();
}
function comeBack() {
  if (!away) return;
  away = false;
  if (mode !== 'app') return;
  if (consumeBusy()) return;
  const wait = store.settings().bloccoAuto * 1000;
  if (needsLock() && Date.now() - hiddenAt >= wait) return showLock();
  if (store.today() !== lastDay) {
    lastDay = store.today();
    store.view.offset = 0;
    store.runRecurring();
    renderMain();
  }
}
// due fonti per lo stesso fatto: il browser (visibilitychange) e Android (onStop/onStart della finestra), senza doppioni
document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? leave() : comeBack()));
globalThis.__appHidden = leave;
globalThis.__appShown = comeBack;

export async function boot() {
  let has = false;
  try {
    has = await store.init();
  } catch (e) {
    console.error(e);
  }
  applyTheme();
  matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  store.subscribe(() => {
    if (mode === 'onboarding' && store.hasState()) return showApp();
    if (mode === 'app') { applyTheme(); renderMain(); }
  });
  if (!has) showOnboarding();
  else if (needsLock()) showLock();
  else showApp();
  if (!isNative() && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
}
