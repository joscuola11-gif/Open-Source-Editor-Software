// Le «pagine» dell'app: stanno nell'indirizzo (#/home, #/conti…) così il tasto indietro funziona.

export const TABS = ['home', 'movimenti', 'budget', 'altro'];
const listeners = new Set();

export function parseHash(hash = location.hash) {
  const [name = 'home', ...rest] = hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'home', arg: rest.join('/') || null };
}
export const route = () => parseHash();
export const isTab = (name) => TABS.includes(name);

export function onRoute(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let depth = 0;
function emit() {
  for (const fn of listeners) fn(route());
}

export function start() {
  if (!location.hash) history.replaceState({ depth: 0 }, '', '#/home');
  depth = history.state?.depth ?? 0;
  window.addEventListener('popstate', () => {
    depth = history.state?.depth ?? 0;
    emit();
  });
  emit();
}

/** Va a una pagina. Le pagine principali sostituiscono quella corrente, le altre si aggiungono (così «indietro» torna dov'eri). */
export function go(to) {
  const target = `#/${to}`;
  if (location.hash === target) return emit();
  const { name } = parseHash(target);
  if (isTab(name)) {
    depth = 0;
    history.replaceState({ depth }, '', target);
  } else {
    depth += 1;
    history.pushState({ depth }, '', target);
  }
  emit();
}

/** Indietro: se si è arrivati da un'altra pagina dell'app si torna lì, altrimenti alla pagina «madre». */
export function back(fallback = 'altro') {
  if (depth > 0) history.back();
  else go(fallback);
}

export const canGoBack = () => depth > 0;
