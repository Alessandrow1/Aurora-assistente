/// <reference types="vite/client" />

type AuroraMessage = { role: 'user' | 'assistant'; content: string };
type AuroraStatus = { ollamaAvailable: boolean; installedModels: string[]; modelInstalled: boolean };

declare global {
  interface Window {
    aurora: {
      getConfig: () => Promise<AuroraStatus & { model: string }>;
      checkOllama: () => Promise<AuroraStatus>;
      saveSettings: (payload: { model: string }) => Promise<{ model: string }>;
      saveMemory: (content: string) => Promise<{ saved: boolean; memory: { id: string; content: string; createdAt: string }; count: number }>;
      listMemories: () => Promise<{ memories: Array<{ id: string; content: string; createdAt: string }>; count: number }>;
      deleteMemory: (query: string) => Promise<{ deleted: boolean; memory?: string; count: number }>;
      getElevenLabsStatus: () => Promise<{ configured: boolean; storageAvailable: boolean; voiceId: string; modelId: string }>;
      saveElevenLabsKey: (apiKey: string) => Promise<{ configured: boolean }>;
      clearElevenLabsKey: () => Promise<{ configured: boolean }>;
      chat: (payload: { message: string; history: AuroraMessage[]; voiceMode?: boolean; imageBase64?: string }, onChunk?: (content: string) => void) => Promise<{ text: string }>;
      captureScreen: () => Promise<{ captureId: string; windowTitle: string; imageBase64: string; width: number; height: number; screenWidth: number; screenHeight: number }>;
      executeAction: (action: { captureId: string; type: 'click' | 'doubleClick' | 'rightClick' | 'move'; x: number; y: number; imageWidth: number; imageHeight: number } | { captureId: string; type: 'drag'; x: number; y: number; endX: number; endY: number; imageWidth: number; imageHeight: number } | { captureId: string; type: 'scroll'; x: number; y: number; delta: number; imageWidth: number; imageHeight: number } | { captureId: string; type: 'type'; text: string } | { captureId: string; type: 'key'; key: string }) => Promise<{ success: boolean; description: string }>; 
      openApp: (appId: string) => Promise<{ success: boolean; label: string }>;
      openFolder: (folderId: string) => Promise<{ success: boolean; label: string }>;
      openUrl: (url: string) => Promise<{ success: boolean }>;
      speak: (text: string) => Promise<{ audioBase64: string; audioMimeType?: string; voice: string; provider: 'elevenlabs' | 'edge'; fallbackReason?: string }>;
      startSpeakSession: () => Promise<{ active: boolean }>;
      endSpeakSession: () => Promise<{ closed: boolean }>;
      transcribeAudio: (samples: Float32Array) => Promise<{ text: string }>;
      warmupTranscription: () => Promise<{ ready: boolean }>;
      onSpeechRecognitionStatus: (callback: (status: { state: 'loading' | 'downloading' | 'ready' | 'error'; message: string }) => void) => () => void;
      setMousePassthrough: (ignore: boolean) => void;
      onCursorPosition: (callback: (position: { x: number; y: number }) => void) => () => void;
      moveWindowBy: (deltaX: number, deltaY: number) => void;
      onToggleCleanUi: (callback: () => void) => () => void;      minimize: () => void;
      close: () => void;
      version: () => Promise<string>;
    };
  }
}

export {};
