const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aurora', {
  getConfig: () => ipcRenderer.invoke('aurora:get-config'),
  checkOllama: () => ipcRenderer.invoke('aurora:check-ollama'),
  saveSettings: (payload) => ipcRenderer.invoke('aurora:save-settings', payload),
  chat: (payload) => ipcRenderer.invoke('aurora:chat', payload),
  speak: (text) => ipcRenderer.invoke('aurora:speak', text),
  minimize: () => ipcRenderer.send('aurora:minimize'),
  close: () => ipcRenderer.send('aurora:close'),
  version: () => ipcRenderer.invoke('aurora:version'),
});
