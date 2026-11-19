import { App } from './ui/app.js';

const root = document.getElementById('app');
const missing = [];
if (typeof MediaRecorder === 'undefined') missing.push('registrazione video (MediaRecorder)');
if (typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') missing.push('audio (WebAudio)');
if (typeof createImageBitmap === 'undefined') missing.push('immagini (createImageBitmap)');

const app = new App(root);
// Punto di accesso per debug e test automatici.
window.__ciak = app;
await app.start();
if (missing.length) app.toast(`Alcune funzioni non sono disponibili in questo browser: ${missing.join(', ')}. Usa una versione recente di Chrome, Edge o Firefox.`, { type: 'warn', ms: 9000 });
