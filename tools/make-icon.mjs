// Genera l'icona dell'app (PNG 512×512) dal logo. Richiede Playwright: `node tools/make-icon.mjs`
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2030"/><stop offset="1" stop-color="#0b0d12"/></linearGradient>
    <linearGradient id="or" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a5c"/><stop offset="1" stop-color="#ff5a2a"/></linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
  <g transform="translate(96 108) scale(10.6)">
    <rect x="3" y="11" width="26" height="17" rx="3" fill="#e9ebf1"/>
    <path d="M3 11l3-7 5 1.5L8 12zm9 1.5L15 5l5 1.5-3 7.5zm9 0L24 6l5 1.5-.8 3.5z" fill="url(#or)"/>
    <path d="M13 16.5v8l7-4z" fill="#ff5a2a"/>
  </g>
</svg>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
await page.screenshot({ path: path.join(ROOT, 'desktop/build/icon.png'), omitBackground: true, clip: { x: 0, y: 0, width: 512, height: 512 } });
await browser.close();
console.log('desktop/build/icon.png');
