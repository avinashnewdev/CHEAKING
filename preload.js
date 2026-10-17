const { contextBridge, ipcRenderer } = require('electron');
let progressCb = null;
ipcRenderer.on('aurora:progress', (e, p) => { if (progressCb) progressCb(p); });
contextBridge.exposeInMainWorld('auroraNative', {
  available: true,
  begin: (o) => ipcRenderer.invoke('aurora:begin', o),
  write: (id, data) => ipcRenderer.invoke('aurora:write', { id, data }),
  convert: (id, isVideo) => ipcRenderer.invoke('aurora:convert', { id, isVideo }),
  onProgress: (cb) => { progressCb = cb; }
});
