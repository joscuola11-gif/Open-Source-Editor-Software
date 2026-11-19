// Genera le icone dell'app (PNG) dal logo. Richiede Playwright: `node tools/make-icons.mjs`
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// «maskable»: il disegno sta nella zona sicura centrale (il sistema ritaglia i bordi)
const svg = (maskable) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6aa4ff"/><stop offset="1" stop-color="#2b5be0"/></linearGradient>
  </defs>
  ${maskable ? '<rect width="512" height="512" fill="url(#bg)"/>' : '<rect x="16" y="16" width="480" height="480" rx="116" fill="url(#bg)"/>'}
  <g transform="translate(256 256) scale(${maskable ? 0.62 : 0.78}) translate(-256 -256)">
    <g fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round">
      <rect x="86" y="170" width="236" height="172" rx="34"/>
      <path d="M322 232l104-56v160l-104-56z"/>
    </g>
    <circle cx="204" cy="256" r="26" fill="#fff"/>
  </g>
</svg>`;

await mkdir(path.join(ROOT, 'icons'), { recursive: true });
const browser = await chromium.launch();
for (const [name, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${svg(maskable).replace('width="512" height="512"', `width="${size}" height="${size}"`)}</div></body>`);
  await page.screenshot({ path: path.join(ROOT, 'icons', name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}
await browser.close();
console.log('icons/*.png');
