'use strict';
// Ponte minimo e controllato fra la pagina e il programma: conversioni con ffmpeg (MP4/MOV, FLAC/M4A).
// La pagina NON riceve `require`, `process` né alcun accesso al disco.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('ciakDesktop', {
  isDesktop: true,
  mediapipeBase: 'ciak-asset://mediapipe/',
  // percorso su disco di un file scelto dall'utente (serve a ffmpeg per leggere l'audio di video enormi senza caricarli in memoria)
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
  extractAudio: (input, options) => ipcRenderer.invoke('ciak:extract-audio', input, options),
  platform: process.platform,
  mp4Available: () => ipcRenderer.invoke('ciak:mp4-available'),
  convertToMp4: (bytes, options) => ipcRenderer.invoke('ciak:convert-mp4', bytes, options),
  convertAudio: (bytes, options) => ipcRenderer.invoke('ciak:convert-audio', bytes, options),
  listSources: () => ipcRenderer.invoke('ciak:list-sources'),
  chooseSource: (id, audio) => ipcRenderer.invoke('ciak:choose-source', String(id), Boolean(audio)),
  videoTool: (bytes, options) => ipcRenderer.invoke('ciak:video-tool', bytes, options),
  transcodeFile: (options) => ipcRenderer.invoke('ciak:transcode-file', options),
  ttsVoices: () => ipcRenderer.invoke('ciak:tts-voices'),
  tts: (text, options) => ipcRenderer.invoke('ciak:tts', text, options),
  asrAvailable: () => ipcRenderer.invoke('ciak:asr-available'),
  asrTranscribe: (samples, options) => ipcRenderer.invoke('ciak:asr-transcribe', samples, options),
  onAsrProgress: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('ciak:asr-progress', handler);
    return () => ipcRenderer.removeListener('ciak:asr-progress', handler);
  },
  cancelConvert: () => ipcRenderer.invoke('ciak:convert-cancel'),
  showInFolder: (filePath) => ipcRenderer.invoke('ciak:reveal', filePath),
  onConvertProgress: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('ciak:convert-progress', handler);
    return () => ipcRenderer.removeListener('ciak:convert-progress', handler);
  },
});
