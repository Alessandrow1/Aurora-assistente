/// <reference types="vite/client" />

type AuroraMessage = { role: 'user' | 'assistant'; content: string; imageId?: string };
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
      createConversation: () => Promise<{ id: string; title: string; createdAt: string; updatedAt: string }>;
      saveConversation: (payload: { id: string; title?: string; createdAt?: string; messages: AuroraMessage[] }) => Promise<{ saved: boolean; conversation: { id: string; title: string; createdAt: string; updatedAt: string; messageCount: number } }>;
      listConversations: (query?: string) => Promise<{ conversations: Array<{ id: string; title: string; createdAt: string; updatedAt: string; messageCount: number; preview: string }>; count: number }>;
      loadConversation: (id: string) => Promise<{ found: false } | { found: true; conversation: { id: string; title: string; createdAt: string; updatedAt: string; messages: AuroraMessage[] } }>;
      deleteConversation: (id: string) => Promise<{ deleted: boolean; count: number }>;
      importKnowledgeDocument: (payload: { name: string; base64: string; size: number }) => Promise<{ saved: boolean; document: { id: string; name: string; extension: string; size: number; addedAt: string; characterCount: number; chunkCount: number }; semanticReady: boolean }>;
      listKnowledgeDocuments: () => Promise<{ documents: Array<{ id: string; name: string; extension: string; size: number; addedAt: string; characterCount: number; chunkCount: number }> }>;
      deleteKnowledgeDocument: (id: string) => Promise<{ deleted: boolean; name?: string }>;
      searchKnowledge: (query: string) => Promise<{ results: Array<{ type: string; title: string; source: string; content: string }> }>;
      getIdentityProfile: () => Promise<{ name: string; avatar: string; appearanceDescription: string; personality: string }>;
      saveIdentityProfile: (profile: { name: string; avatar: string; appearanceDescription: string; personality: string }) => Promise<{ name: string; avatar: string; appearanceDescription: string; personality: string }>;
      getEmbeddingStatus: () => Promise<{ checkedAt?: number; installed: boolean; model: string }>;
      installEmbeddingModel: () => Promise<{ installed: boolean; indexed: number; documents: number; conversations: number }>;
      getImageGeneratorStatus: () => Promise<{ available: boolean; checkpointAvailable: boolean; checkpoints: string[]; checkpointCount: number; message: string }>;
      getLocalTtsStatus: () => Promise<{ installed: boolean; ready: boolean; modelDirectory: string; voice: string; language: string; provider: string }>;
      installLocalTts: () => Promise<{ installed: boolean; ready: boolean; modelDirectory: string; voice: string; language: string; provider: string }>;
      onTtsStatus: (callback: (status: { state: string; message: string; synthesisMs?: number; audioSeconds?: number }) => void) => () => void;
      generateImage: (payload: { prompt: string }) => Promise<{ id: string; dataUrl: string; prompt: string; checkpoint: string }>;
      loadGeneratedImage: (id: string) => Promise<{ found: boolean; dataUrl?: string }>;
      openGeneratedImages: () => Promise<{ success: boolean }>;
      onImageStatus: (callback: (status: { state: string; message?: string }) => void) => () => void;
      onEmbeddingStatus: (callback: (status: { state: string; message?: string; percent?: number | null; completed?: number; total?: number }) => void) => () => void;
      getElevenLabsStatus: () => Promise<{ configured: boolean; storageAvailable: boolean; voiceId: string; modelId: string }>;
      saveElevenLabsKey: (apiKey: string) => Promise<{ configured: boolean }>;
      clearElevenLabsKey: () => Promise<{ configured: boolean }>;
      chat: (payload: { message: string; history: AuroraMessage[]; voiceMode?: boolean; studyMode?: boolean; imageBase64?: string; requestId?: string }, onChunk?: (content: string) => void) => Promise<{ text: string }>;
      cancelChat: (requestId: string) => void;
      captureScreen: () => Promise<{ imageBase64: string; width: number; height: number; screenWidth: number; screenHeight: number }>;
      openApp: (appId: string) => Promise<{ success: boolean; label: string }>;
      openFolder: (folderId: string) => Promise<{ success: boolean; label: string }>;
      openUrl: (url: string) => Promise<{ success: boolean }>;
      speak: (text: string) => Promise<{ audioBase64: string; audioMimeType?: string; voice: string; provider: 'elevenlabs' | 'kokoro-local'; fallbackReason?: string }>;
      startSpeakSession: () => Promise<{ active: boolean; provider?: 'elevenlabs' | 'kokoro-local'; error?: string }>;
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
