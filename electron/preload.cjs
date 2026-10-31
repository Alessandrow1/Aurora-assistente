const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aurora', {
  getConfig: () => ipcRenderer.invoke('aurora:get-config'),
  checkOllama: () => ipcRenderer.invoke('aurora:check-ollama'),
  saveSettings: (payload) => ipcRenderer.invoke('aurora:save-settings', payload),
  chat: (payload) => ipcRenderer.invoke('aurora:chat', payload),
  speak: (text) => ipcRenderer.invoke('aurora:speak', text),
  captureScreen: () => ipcRenderer.invoke('aurora:capture-screen'),
  openApp: (appId) => ipcRenderer.invoke('aurora:open-app', appId),
  openFolder: (folderId) => ipcRenderer.invoke('aurora:open-folder', folderId),
  openUrl: (url) => ipcRenderer.invoke('aurora:open-url', url),
  minimize: () => ipcRenderer.send('aurora:minimize'),
  close: () => ipcRenderer.send('aurora:close'),
  version: () => ipcRenderer.invoke('aurora:version'),
});
