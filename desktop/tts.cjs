'use strict';
// Voce da testo, locale e gratuita: usa il sintetizzatore vocale del sistema.
//   Windows: System.Speech (le voci installate, per esempio «Microsoft Elsa» in italiano)
//   macOS:   `say`
//   Linux:   espeak-ng (o espeak)
// Il testo passa SEMPRE dallo standard input (mai nella riga di comando) e la voce si accetta solo se è nell'elenco.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_CHARS = 6000;

function run(cmd, args, { input, env, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Il sintetizzatore vocale non risponde.'));
    }, timeout);
    proc.stdout.on('data', (c) => (out += c));
    proc.stderr.on('data', (c) => (err = (err + c).slice(-2000)));
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} ha terminato con errore ${code}: ${err.trim().split('\n').slice(-2).join(' ')}`));
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(input ?? '', 'utf8');
  });
}

const which = async (cmd) => {
  try {
    await run(process.platform === 'win32' ? 'where' : 'which', [cmd], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};

const PS = (script) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];

async function linuxBin() {
  for (const b of ['espeak-ng', 'espeak']) if (await which(b)) return b;
  return null;
}

/** @returns {Promise<{id: string, name: string, lang: string}[]>} vuoto se non c'è nessun sintetizzatore */
async function listVoices() {
  try {
    if (process.platform === 'win32') {
      const out = await run('powershell.exe', PS('Add-Type -AssemblyName System.Speech; [Console]::OutputEncoding=[Text.Encoding]::UTF8; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name + "|" + $_.VoiceInfo.Culture.Name }'), { timeout: 20000 });
      return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const [name, lang] = l.split('|');
        return { id: name, name, lang: lang ?? '' };
      });
    }
    if (process.platform === 'darwin') {
      const out = await run('say', ['-v', '?'], { timeout: 10000 });
      return out.split('\n').map((l) => /^(.+?)\s{2,}([a-z]{2}[_-][A-Z]{2})\b/.exec(l)).filter(Boolean).map((m) => ({ id: m[1].trim(), name: m[1].trim(), lang: m[2] }));
    }
    const bin = await linuxBin();
    if (!bin) return [];
    const out = await run(bin, ['--voices']);
    const rows = out.split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 4);
    // un solo elemento per lingua (la voce principale), più i nomi delle varianti più comuni
    const seen = new Set();
    const voices = [];
    for (const c of rows) {
      const lang = c[1];
      if (seen.has(lang) || /^[^a-z]/.test(lang)) continue;
      seen.add(lang);
      voices.push({ id: lang, name: c[3].replace(/_/g, ' '), lang });
    }
    return voices;
  } catch {
    return [];
  }
}

/** Sintetizza `text` e restituisce un file WAV (Buffer). `rate`: 0.5–2 (1 = normale). */
async function synthesize(text, { voice, rate = 1 } = {}) {
  const t = String(text ?? '').trim();
  if (!t) throw new Error('Scrivi il testo da pronunciare.');
  if (t.length > MAX_CHARS) throw new Error(`Il testo è troppo lungo (massimo ${MAX_CHARS} caratteri).`);
  const r = Math.min(2, Math.max(0.5, Number(rate) || 1));
  const voices = await listVoices();
  if (!voices.length) throw new Error('Non trovo nessun sintetizzatore vocale in questo computer.');
  if (voice && !voices.some((v) => v.id === voice)) throw new Error('Voce non disponibile.');
  const chosen = voice ?? (voices.find((v) => /^it/i.test(v.lang))?.id ?? voices[0].id);
  const out = path.join(os.tmpdir(), `ciak-tts-${process.pid}-${Date.now()}.wav`);
  try {
    if (process.platform === 'win32') {
      const script = `Add-Type -AssemblyName System.Speech; [Console]::InputEncoding=[Text.Encoding]::UTF8; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice($env:CIAK_VOICE); $s.Rate=[int]$env:CIAK_RATE; $s.SetOutputToWaveFile($env:CIAK_OUT); $s.Speak([Console]::In.ReadToEnd()); $s.Dispose()`;
      await run('powershell.exe', PS(script), { input: t, env: { CIAK_VOICE: chosen, CIAK_RATE: String(Math.round((r - 1) * 10)), CIAK_OUT: out } });
    } else if (process.platform === 'darwin') {
      await run('say', ['-v', chosen, '-r', String(Math.round(175 * r)), '-o', out, '--file-format=WAVE', '--data-format=LEI16@44100', '-f', '-'], { input: t });
    } else {
      const bin = await linuxBin();
      await run(bin, ['-v', chosen, '-s', String(Math.round(160 * r)), '-w', out, '--stdin'], { input: t });
    }
    const wav = fs.readFileSync(out);
    if (wav.length < 100) throw new Error('Il sintetizzatore non ha prodotto audio.');
    return wav;
  } finally {
    fs.rm(out, { force: true }, () => {});
  }
}

module.exports = { listVoices, synthesize, MAX_CHARS };
