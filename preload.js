const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  startAutomation: () => ipcRenderer.send('start-automation'),
  stopAutomation: () => ipcRenderer.send('stop-automation'),
  onStatusUpdate: (callback) => ipcRenderer.on('update-status', callback),
  onTerminalUpdate: (callback) => ipcRenderer.on('update-terminal', callback),
});
