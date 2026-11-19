import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, detectFormat, parseVtt, parseAss, parseLrc, parseTxt, parseSubtitles, formatVtt, formatTxt, formatLrc } from '../../src/core/subtitles.js';
import { formatSrt, parseSrt } from '../../src/core/srt.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('tempi: con o senza ore, virgola o punto, millisecondi o centesimi', () => {
  near(parseTime('00:01:02,500'), 62.5);
  near(parseTime('01:02.250'), 62.25);
  near(parseTime('1:02:03.45'), 3723.45);
  near(parseTime('0:00:01.5'), 1.5);
  near(parseTime('12:34'), 754);
  for (const bad of ['', 'abc', '12', '1:2', null, undefined]) assert.equal(parseTime(bad), null, String(bad));
});

test('riconoscimento del formato: dall\'estensione e dal contenuto', () => {
  assert.equal(detectFormat('', 'a.SRT'), 'srt');
  assert.equal(detectFormat('', 'a.ssa'), 'ass');
  assert.equal(detectFormat('WEBVTT\n\n', 'sub'), 'vtt');
  assert.equal(detectFormat('[Script Info]\n', ''), 'ass');
  assert.equal(detectFormat('1\n00:00:01,000 --> 00:00:02,000\nx', ''), 'srt');
  assert.equal(detectFormat('[00:12.30]ciao', ''), 'lrc');
  assert.equal(detectFormat('solo parole', 'note'), 'txt');
  assert.equal(detectFormat('', ''), 'txt');
});

test('WebVTT: intestazione, note, identificatori, impostazioni, tag ed entità', () => {
  const vtt = `WEBVTT - titolo

NOTE un commento

STYLE
::cue { color: red }

intro
00:01.000 --> 00:03.500 align:start position:10%
<v Anna>Ciao <b>a tutti</b> &amp; benvenuti

01:00:00.000 --> 01:00:02.000
Un'ora dopo

00:05.000 --> 00:04.000
tempo invertito (ignorata)

00:06.000 --> 00:07.000

`;
  const c = parseVtt(vtt);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0], { start: 1, end: 3.5, text: 'Ciao a tutti & benvenuti' });
  near(c[1].start, 3600);
  assert.equal(parseVtt('').length, 0);
});

test('ASS: colonne dichiarate, virgole nel testo, codici di stile, \\N e karaoke \\k', () => {
  const ass = `[Script Info]
Title: x

[V4+ Styles]
Format: Name, Fontname
Style: Default,Arial

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\an8}Ciao, mondo\\Nsecondo rigo
Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,{\\k50}Una {\\k100}frase {\\k50}cantata
Comment: 0,0:00:07.00,0:00:08.00,Default,,0,0,0,,non è un dialogo
Dialogue: 0,0:00:09.00,0:00:08.00,Default,,0,0,0,,fine prima dell'inizio
`;
  const c = parseAss(ass);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0], { start: 1, end: 3.5, text: 'Ciao, mondo\nsecondo rigo' });
  assert.equal(c[1].text, 'Una frase cantata');
  assert.deepEqual(c[1].words.map((w) => w.w), ['Una', 'frase', 'cantata']);
  near(c[1].words[0].t, 0);
  near(c[1].words[1].t, 0.5);
  near(c[1].words[2].t, 1.5);
  // formato con colonne in altro ordine
  const alt = '[Events]\nFormat: Start, End, Text\nDialogue: 0:00:01.00,0:00:02.00,uno, due\n';
  assert.deepEqual(parseAss(alt), [{ start: 1, end: 2, text: 'uno, due' }]);
});

test('LRC: righe con più tempi, metadati, offset, parole per parola e fine = inizio della successiva', () => {
  const lrc = `[ar:Qualcuno]
[ti:Canzone]
[offset:-500]
[00:10.00]Prima riga
[00:14.50]Seconda <00:15.00>riga <00:15.80>cantata
[00:20.00][00:30.00]Ritornello
[00:31.00]
`;
  const c = parseLrc(lrc);
  assert.equal(c.length, 4);
  near(c[0].start, 10.5);
  near(c[0].end, 15, 1e-6);
  assert.equal(c[1].text, 'Seconda riga cantata');
  assert.deepEqual(c[1].words.map((w) => w.w), ['riga', 'cantata']);
  near(c[1].words[0].t, 0.5 + 0 , 1e-6);
  assert.equal(c[2].text, 'Ritornello');
  near(c[2].start, 20.5);
  near(c[3].start, 30.5);
  assert.ok(c[3].end > c[3].start, 'l\'ultima riga ha una durata');
  assert.equal(parseLrc('niente di utile').length, 0);
});

test('TXT: un blocco per paragrafo (o per riga), durate ragionevoli e consecutive', () => {
  const byPara = parseTxt('Primo\nsu due righe\n\nSecondo paragrafo molto più lungo del primo per durare di più\n\n\nTerzo');
  assert.equal(byPara.length, 3);
  assert.equal(byPara[0].text, 'Primo\nsu due righe');
  for (let i = 1; i < byPara.length; i++) assert.ok(byPara[i].start >= byPara[i - 1].end, 'in sequenza');
  for (const c of byPara) assert.ok(c.end - c.start >= 1.5 && c.end - c.start <= 6);
  assert.equal(parseTxt('uno\ndue\ntre').length, 3);
  assert.equal(parseTxt('   \n \n').length, 0);
  assert.equal(parseTxt('').length, 0);
});

test('parseSubtitles sceglie il lettore giusto; scrittura e rilettura danno le stesse cue', () => {
  const cues = [{ start: 1.5, end: 3, text: 'Uno' }, { start: 4, end: 6.25, text: 'Due\nrighe' }];
  const vtt = formatVtt(cues);
  assert.match(vtt, /^WEBVTT\n\n00:00:01\.500 --> 00:00:03\.000\nUno/);
  assert.deepEqual(parseSubtitles(vtt, 'x.vtt'), { format: 'vtt', cues });
  assert.deepEqual(parseSubtitles(formatSrt(cues), 'x.srt'), { format: 'srt', cues });
  assert.equal(formatTxt(cues), 'Uno\n\nDue\nrighe\n');
  const lrc = formatLrc(cues);
  assert.equal(lrc, '[00:01.50]Uno\n[00:04.00]Due righe\n');
  const back = parseSubtitles(lrc, 'x.lrc');
  assert.equal(back.cues.length, 2);
  near(back.cues[0].start, 1.5);
  assert.equal(parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\nciao', '').format, 'srt');
  assert.deepEqual(parseSrt('').length, 0);
});
