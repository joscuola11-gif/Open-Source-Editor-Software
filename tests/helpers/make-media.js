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
  // immagine e video a toni medi (niente bianchi o neri pieni): servono per provare esposizione, curve e colori
  const MID = 'color=c=0x606060:s=640x360:r=30:d=3,drawbox=x=0:y=0:w=320:h=180:color=0x805030:t=fill,drawbox=x=320:y=180:w=320:h=180:color=0x305080:t=fill';
  for (const [name, col] of [['red', 'red'], ['blue', 'blue']]) {
    if (!existsSync(f(`${name}.webm`))) run(['-f', 'lavfi', '-i', `color=c=${col}:s=640x360:r=30:d=4`, ...vp8, '-an', f(`${name}.webm`)]);
  }
  if (!existsSync(f('dark.png'))) run(['-f', 'lavfi', '-i', 'testsrc2=size=640x360', '-frames:v', '1', '-vf', 'eq=brightness=-0.32:contrast=0.45', f('dark.png')]);
  if (!existsSync(f('cast.png'))) run(['-f', 'lavfi', '-i', 'testsrc2=size=640x360', '-frames:v', '1', '-vf', 'colorchannelmixer=rr=0.65:gg=0.9:bb=1.15', f('cast.png')]);
  if (!existsSync(f('warm.png'))) run(['-f', 'lavfi', '-i', 'testsrc2=size=640x360', '-frames:v', '1', '-vf', 'colorchannelmixer=rr=1:gg=0.85:bb=0.6,eq=brightness=0.05', f('warm.png')]);
  if (!existsSync(f('mid.webm'))) run(['-f', 'lavfi', '-i', MID, ...vp8, '-an', f('mid.webm')]);
  if (!existsSync(f('mid.png'))) run(['-f', 'lavfi', '-i', MID.replace('s=640x360', 's=800x600').replace(/x=320:y=180:w=320:h=180/, 'x=400:y=300:w=400:h=300').replace('w=320:h=180:color=0x805030', 'w=400:h=300:color=0x805030'), '-frames:v', '1', f('mid.png')]);
  // 5 s con voce (tono) e due pause: 1,0–2,5 s e 3,5–4,5 s
  if (!existsSync(f('pause.webm')))
    run(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-af', "volume=enable='between(t,1,2.5)+between(t,3.5,4.5)':volume=0", ...vp8, '-c:a', 'libopus', '-shortest', f('pause.webm')]);
  // base ritmica a 120 al minuto (un colpo ogni 0,5 s) e voce con rumore di fondo
  if (!existsSync(f('beat.wav')))
    run(['-f', 'lavfi', '-i', 'sine=frequency=1000:duration=8', '-af', "volume='if(lt(mod(t,0.5),0.04),1,0)':eval=frame", f('beat.wav')]);
  if (!existsSync(f('noisy.wav')))
    run(['-f', 'lavfi', '-i', 'sine=frequency=300:duration=4', '-f', 'lavfi', '-i', 'anoisesrc=d=4:a=0.08:c=white', '-filter_complex', "[0:a]volume='if(between(t,1,3),4,0)':eval=frame[s];[s][1:a]amix=inputs=2:normalize=0:duration=first", '-ar', '44100', f('noisy.wav')]);
  // video «tremolante»: griglia fissa vista attraverso un riquadro che oscilla; e un clip brevissimo per gli strumenti lenti
  if (!existsSync(f('tex.png'))) run(['-f', 'lavfi', '-i', 'nullsrc=s=900x600,geq=random(1)*255:128:128', '-frames:v', '1', '-vf', 'gblur=sigma=2.5,eq=contrast=2.2', f('tex.png')]);
  if (!existsSync(f('shaky.webm')))
    run(['-framerate', '30', '-loop', '1', '-i', f('tex.png'), '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-t', '3', '-vf', "crop=640:360:'130+40*sin(2*PI*t*2)':'110+30*cos(2*PI*t*3)'", ...vp8, '-c:a', 'libopus', '-shortest', f('shaky.webm')]);
  if (!existsSync(f('tiny.webm')))
    run(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1', ...vp8, '-c:a', 'libopus', '-shortest', f('tiny.webm')]);
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
