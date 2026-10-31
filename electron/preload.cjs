const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('supervpn', {
  call: (method, payload) => ipcRenderer.invoke('client', method, payload),
  onUpdate: (callback) => { const listener = (_, value) => callback(value); ipcRenderer.on('update', listener); return () => ipcRenderer.removeListener('update', listener); }
});
