import { App } from './ui/app.js';

const app = new App(document.getElementById('app'));
window.__squillo = app; // comodo per i test e per chi vuole curiosare
app.start();

// installabile sul telefono (solo da https o localhost, non nel programma desktop)
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.squilloDesktop) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
