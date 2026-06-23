const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendAudio: (buffer) => ipcRenderer.send('audio-data', buffer),
  toggleListening: () => ipcRenderer.send('toggle-listening'),
  copyToClipboard: (text) => ipcRenderer.send('copy-to-clipboard', text),
  autoPaste: (text) => ipcRenderer.send('auto-paste', text),

  onStatusChange: (cb) => ipcRenderer.on('stt-status', (_e, s) => cb(s)),
  onResult: (cb) => ipcRenderer.on('stt-result', (_e, r) => cb(r)),
  onError: (cb) => ipcRenderer.on('stt-error', (_e, m) => cb(m)),
  onServerStatus: (cb) => ipcRenderer.on('stt-server-status', (_e, m) => cb(m)),
});
