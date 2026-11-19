// Scarica ffmpeg (build statica GPL di eugeneware/ffmpeg-static) per la piattaforma di destinazione e lo
// mette in desktop/ffmpeg/<piattaforma>-<arch>/, da dove electron-builder lo include nel pacchetto.
// Uso: node tools/fetch-ffmpeg.mjs [win32|linux|darwin] [x64|arm64]
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [platform = 'win32', arch = 'x64'] = process.argv.slice(2);
const exe = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const dest = path.join(ROOT, 'desktop', 'ffmpeg', `${platform}-${arch}`);
if (existsSync(path.join(dest, exe))) {
  console.log(`già presente: ${path.relative(ROOT, path.join(dest, exe))}`);
  process.exit(0);
}
const tmp = mkdtempSync(path.join(os.tmpdir(), 'ciak-ffmpeg-'));
try {
  // su Windows npm è `npm.cmd`: Node lo avvia solo tramite shell
  const win = process.platform === 'win32';
  execFileSync(win ? 'npm.cmd' : 'npm', ['init', '-y'], { cwd: tmp, stdio: 'ignore', shell: win });
  execFileSync(win ? 'npm.cmd' : 'npm', ['install', 'ffmpeg-static', '--no-audit', '--no-fund'], { cwd: tmp, stdio: 'inherit', shell: win, env: { ...process.env, npm_config_platform: platform, npm_config_arch: arch } });
  const src = path.join(tmp, 'node_modules', 'ffmpeg-static');
  mkdirSync(dest, { recursive: true });
  copyFileSync(path.join(src, exe), path.join(dest, exe));
  copyFileSync(path.join(src, `${exe}.LICENSE`), path.join(dest, 'LICENSE.txt'));
  copyFileSync(path.join(src, `${exe}.README`), path.join(dest, 'README.txt'));
  console.log(`scaricato: ${path.relative(ROOT, path.join(dest, exe))}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
