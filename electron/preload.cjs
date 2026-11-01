const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aurora', {
  getConfig: () => ipcRenderer.invoke('aurora:get-config'),
  checkOllama: () => ipcRenderer.invoke('aurora:check-ollama'),
  saveSettings: (payload) => ipcRenderer.invoke('aurora:save-settings', payload),
  saveMemory: (content) => ipcRenderer.invoke('aurora:memory-save', content),
  listMemories: () => ipcRenderer.invoke('aurora:memory-list'),
  deleteMemory: (query) => ipcRenderer.invoke('aurora:memory-delete', query),
  getElevenLabsStatus: () => ipcRenderer.invoke('aurora:elevenlabs-status'),
  saveElevenLabsKey: (apiKey) => ipcRenderer.invoke('aurora:save-elevenlabs-key', apiKey),
  clearElevenLabsKey: () => ipcRenderer.invoke('aurora:clear-elevenlabs-key'),
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
  transcribeAudio: (samples) => ipcRenderer.invoke('aurora:transcribe-audio', samples),
  onSpeechRecognitionStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('aurora:speech-recognition-status', listener);
    return () => ipcRenderer.removeListener('aurora:speech-recognition-status', listener);
  },
  captureScreen: () => ipcRenderer.invoke('aurora:capture-screen'),
  openApp: (appId) => ipcRenderer.invoke('aurora:open-app', appId),
  openFolder: (folderId) => ipcRenderer.invoke('aurora:open-folder', folderId),
  openUrl: (url) => ipcRenderer.invoke('aurora:open-url', url),
  executeAction: (action) => ipcRenderer.invoke('aurora:execute-action', action),
  setMousePassthrough: (ignore) => ipcRenderer.send('aurora:set-mouse-passthrough', Boolean(ignore)),
  onCursorPosition: (callback) => {
    const listener = (_event, position) => callback(position);
    ipcRenderer.on('aurora:cursor-position', listener);
    return () => ipcRenderer.removeListener('aurora:cursor-position', listener);
  },  moveWindowBy: (deltaX, deltaY) => ipcRenderer.send('aurora:move-window-by', { deltaX, deltaY }),
  onToggleCleanUi: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('aurora:toggle-clean-ui', listener);
    return () => ipcRenderer.removeListener('aurora:toggle-clean-ui', listener);
  },  minimize: () => ipcRenderer.send('aurora:minimize'),
  close: () => ipcRenderer.send('aurora:close'),
  version: () => ipcRenderer.invoke('aurora:version'),
});
