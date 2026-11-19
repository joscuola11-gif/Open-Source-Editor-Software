'use strict';
// Ponte minimo e controllato fra la pagina e il programma: scelta dello schermo da condividere,
// attirare l'attenzione quando arriva una chiamata e tenere lo schermo acceso. Nient'altro.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('squilloDesktop', {
  isDesktop: true,
  platform: process.platform,
  listSources: () => ipcRenderer.invoke('squillo:list-sources'),
  chooseSource: (id, audio) => ipcRenderer.invoke('squillo:choose-source', String(id), Boolean(audio)),
  alert: () => ipcRenderer.send('squillo:alert'),
  keepAwake: (on) => ipcRenderer.send('squillo:keep-awake', Boolean(on)),
});
