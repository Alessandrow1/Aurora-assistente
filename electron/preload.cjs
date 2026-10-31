const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aurora', {
  getConfig: () => ipcRenderer.invoke('aurora:get-config'),
  checkOllama: () => ipcRenderer.invoke('aurora:check-ollama'),
  saveSettings: (payload) => ipcRenderer.invoke('aurora:save-settings', payload),
  chat: (payload, onChunk) => {
    const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const listener = (_event, data) => {
      if (data?.requestId === requestId && typeof data.content === 'string') onChunk?.(data.content);
    };
    ipcRenderer.on('aurora:chat-chunk', listener);
    return ipcRenderer.invoke('aurora:chat', { ...payload, requestId })
      .finally(() => ipcRenderer.removeListener('aurora:chat-chunk', listener));
  },
  speak: (text) => ipcRenderer.invoke('aurora:speak', text),
  captureScreen: () => ipcRenderer.invoke('aurora:capture-screen'),
  openApp: (appId) => ipcRenderer.invoke('aurora:open-app', appId),
  openFolder: (folderId) => ipcRenderer.invoke('aurora:open-folder', folderId),
  openUrl: (url) => ipcRenderer.invoke('aurora:open-url', url),
  executeAction: (action) => ipcRenderer.invoke('aurora:execute-action', action),
  minimize: () => ipcRenderer.send('aurora:minimize'),
  close: () => ipcRenderer.send('aurora:close'),
  version: () => ipcRenderer.invoke('aurora:version'),
});
