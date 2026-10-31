/// <reference types="vite/client" />

type AuroraMessage = { role: 'user' | 'assistant'; content: string };
type AuroraStatus = { ollamaAvailable: boolean; installedModels: string[]; modelInstalled: boolean };

declare global {
  interface Window {
    aurora: {
      getConfig: () => Promise<AuroraStatus & { model: string }>;
      checkOllama: () => Promise<AuroraStatus>;
      saveSettings: (payload: { model: string }) => Promise<{ model: string }>;
      chat: (payload: { message: string; history: AuroraMessage[] }) => Promise<{ text: string }>;
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
