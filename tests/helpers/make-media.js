// Genera media di prova con ffmpeg (VP8/Opus in WebM: decodificabili da qualsiasi Chromium, anche senza codec proprietari).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp', 'media');

const run = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: 'pipe' });

export function mediaDir() {
  return ROOT;
}

export function makeMedia() {
  mkdirSync(ROOT, { recursive: true });
  const f = (n) => path.join(ROOT, n);
  const vp8 = ['-c:v', 'libvpx', '-b:v', '700k', '-pix_fmt', 'yuv420p', '-g', '15'];
  if (!existsSync(f('a.webm')))
    run(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', ...vp8, '-c:a', 'libopus', '-shortest', f('a.webm')]);
  if (!existsSync(f('b.webm')))
    run(['-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', ...vp8, '-c:a', 'libopus', '-shortest', f('b.webm')]);
  if (!existsSync(f('portrait.webm')))
    run(['-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=30:duration=2', ...vp8, '-an', f('portrait.webm')]);
  if (!existsSync(f('green.webm')))
    run(['-f', 'lavfi', '-i', 'color=c=0x00ff00:s=640x360:r=30:d=3,drawbox=x=220:y=100:w=200:h=160:color=red:t=fill', ...vp8, '-an', f('green.webm')]);
  if (!existsSync(f('tone.wav'))) run(['-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', f('tone.wav')]);
  if (!existsSync(f('photo.png'))) run(['-f', 'lavfi', '-i', 'testsrc=size=800x600', '-frames:v', '1', f('photo.png')]);
  if (!existsSync(f('subs.srt')))
    writeFileSync(f('subs.srt'), '1\n00:00:00,500 --> 00:00:01,500\nPrimo sottotitolo\n\n2\n00:00:02,000 --> 00:00:03,200\nSecondo\nsu due righe\n\n');
  return { dir: ROOT, f };
}

export function ffprobe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(out);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  return { video: v, audio: a, duration: Number(j.format.duration), format: j.format.format_name, size: Number(j.format.size) };
}
