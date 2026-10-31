/// <reference types="vite/client" />

type AuroraMessage = { role: 'user' | 'assistant'; content: string };
type AuroraStatus = { ollamaAvailable: boolean; installedModels: string[]; modelInstalled: boolean };

declare global {
  interface Window {
    aurora: {
      getConfig: () => Promise<AuroraStatus & { model: string }>;
      checkOllama: () => Promise<AuroraStatus>;
      saveSettings: (payload: { model: string }) => Promise<{ model: string }>;
      chat: (payload: { message: string; history: AuroraMessage[]; imageBase64?: string }) => Promise<{ text: string }>;
      captureScreen: () => Promise<{ imageBase64: string; width: number; height: number }>;
      openApp: (appId: string) => Promise<{ success: boolean; label: string }>;
      openFolder: (folderId: string) => Promise<{ success: boolean; label: string }>;
      openUrl: (url: string) => Promise<{ success: boolean }>;
      speak: (text: string) => Promise<{ audioBase64: string; voice: string }>;
      minimize: () => void;
      close: () => void;
      version: () => Promise<string>;
    };
    SpeechRecognition?: new () => any;
    webkitSpeechRecognition?: new () => any;
  }
}

export {};
