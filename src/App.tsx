import { FormEvent, useEffect, useRef, useState } from 'react';
import Avatar3D from './components/Avatar3D';
import MemoryHub from './components/MemoryHub';

type Message = { role: 'user' | 'assistant'; content: string; imageId?: string; imageUrl?: string };
type VoiceVadController = { start: () => void | Promise<void>; pause: () => void | Promise<void>; destroy: () => void | Promise<void> };
type LocalTtsStatus = { installed: boolean; ready: boolean; modelDirectory: string; voice: string; language: string; provider: string };
type ElevenLabsStatus = { configured: boolean; storageAvailable: boolean; voiceId: string; modelId: string };
type AudioInputOption = { deviceId: string; label: string };

type VoiceCaptureSession = {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  recorder: MediaRecorder;
  chunks: Blob[];
  audioContext: AudioContext;
  analyser: AnalyserNode;
  samples: Float32Array;
  timer: number;
  startedAt: number;
  firstSpeechAt: number | null;
  lastSpeechAt: number;
  speechDetected: boolean;
  peakRms: number;
  noiseFloorRms: number;
  speechThresholdRms: number;
  noiseCalibrationSamples: number;
  stopped: boolean;
  transcribeOnStop: boolean;
};
type AppConfig = {
  ollamaAvailable: boolean;
  installedModels: string[];
  modelInstalled: boolean;
  model: string;
};

type AvatarEmotion = 'neutral' | 'happy' | 'sad' | 'surprised' | 'curious' | 'angry' | 'affectionate' | 'laughing';

function choosePortugueseSpeechVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const brazilianVoices = voices.filter((voice) => /^pt-BR$/i.test(voice.lang));
  const preferredBrazilianVoice = brazilianVoices.find((voice) =>
    /francisca|antonio|maria|fernanda|luciana/i.test(voice.name)
  );
  if (preferredBrazilianVoice) return preferredBrazilianVoice;
  if (brazilianVoices.length) return brazilianVoices[0];

  const portugueseVoices = voices.filter((voice) => /^pt(?:-|_)/i.test(voice.lang));
  return portugueseVoices.find((voice) =>
    /portugal|portuguese|portugues/i.test(voice.name)
  ) || portugueseVoices[0] || null;
}

async function waitForPortugueseSpeechVoice(
  synth: SpeechSynthesis,
  timeoutMs = 1200,
): Promise<SpeechSynthesisVoice | null> {
  const select = () => choosePortugueseSpeechVoice(synth.getVoices());
  const initialVoice = select();
  if (initialVoice) return initialVoice;

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (voice: SpeechSynthesisVoice | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      synth.removeEventListener('voiceschanged', onVoicesChanged);
      resolve(voice);
    };
    const onVoicesChanged = () => {
      const voice = select();
      if (voice) finish(voice);
    };
    const timeout = window.setTimeout(() => finish(select()), timeoutMs);
    synth.addEventListener('voiceschanged', onVoicesChanged);
  });
}

// Pausa curta para encerrar a fala sem acrescentar espera desnecessária antes do Whisper.
const VOICE_END_SILENCE_MS = 550;

function detectMemorySuggestion(text: string): string | null {
  if (/^\\s*(?:aurora[, ]+)?(?:lembre-se de que|lembre que|guarde que|anote que|aprenda que)\\s+/i.test(text)) return null;
  const normalized = text.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const sensitive = /\b(saude|doenca|medicamento|remedio|diagnostico|terapia|depressao|ansiedade|medico|sintoma|emagrecer|peso|dieta|treino|religiao|igreja|politica|partido|eleicao|orientacao sexual|sexualidade|gravidez|salario|senha|documento|cpf)\b/i;
  const durable = /\b(meu objetivo e|minha meta e|meu projeto e|estou desenvolvendo|estou construindo|prefiro|nao gosto de|gosto de|quero que voce sempre|minha preferencia e|estou estudando para|decidi que)\b/i;
  if (text.trim().length < 18 || text.trim().length > 420 || sensitive.test(normalized) || !durable.test(normalized)) return null;
  return text.trim();
}

function hasLaughingCue(text: string): boolean {
  return /(?:\b(?:kkkk+|haha+|hehe+|rsrs+)\b|\u{1F602}|\u{1F923}|\u{1F606}|\u{1F639}|\u{1F63A})/iu.test(text);
}

function normalizeSpeechText(rawText: string): string {
  return rawText
    .replace(/\x60{3}[\s\S]*?\x60{3}/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[#*_>|~\x60]/g, ' ')
    .replace(/[#*0-9]\uFE0F?\u20E3/gu, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\p{So}\uFE0E\uFE0F\u200D\u20E3]/gu, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=\S)/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasSpeakableSpeechText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

function prepareVoiceAudio(rawSamples: Float32Array) {
  const samples = new Float32Array(rawSamples.length);
  if (rawSamples.length === 0) {
    return { samples, rmsBefore: 0, peakBefore: 0, gain: 1, rmsAfter: 0 };
  }

  let mean = 0;
  for (let index = 0; index < rawSamples.length; index += 1) mean += rawSamples[index];
  mean /= rawSamples.length;

  let sumSquares = 0;
  let peak = 0;
  for (let index = 0; index < rawSamples.length; index += 1) {
    const centered = rawSamples[index] - mean;
    sumSquares += centered * centered;
    peak = Math.max(peak, Math.abs(centered));
  }

  const rms = Math.sqrt(sumSquares / rawSamples.length);
  if (!Number.isFinite(rms) || rms < 0.003 || peak < 0.01) {
    samples.set(rawSamples);
    return { samples, rmsBefore: rms || 0, peakBefore: peak, gain: 1, rmsAfter: rms || 0 };
  }

  // Compensa microfones baixos sem amplificar silêncio indefinidamente nem estourar picos.
  const targetRms = 0.12;
  const normalizationGain = Math.min(4, targetRms / rms);
  const peakLimiterGain = peak > 0 ? 0.96 / peak : 4;
  const gain = Math.min(normalizationGain, peakLimiterGain);

  for (let index = 0; index < rawSamples.length; index += 1) {
    const amplified = (rawSamples[index] - mean) * gain;
    samples[index] = Math.max(-0.98, Math.min(0.98, amplified));
  }

  return {
    samples,
    rmsBefore: rms,
    peakBefore: peak,
    gain,
    rmsAfter: rms * gain,
  };
}

function inferAvatarEmotion(userText: string, answer: string): AvatarEmotion {
  const input = userText.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const output = answer.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const sadInput = /\b(triste|tristeza|luto|faleceu|morreu|morte|perdi|doente|medo|assustad[oa]|preocupad[oa]|ansios[oa]|deprimid[oa]|sofrendo|chorei|dor)\b|\u{1F622}|\u{1F62D}|\u{1F614}|\u{1F61E}|\u{1F641}|\u{1F97A}/iu.test(input);
  if (sadInput) return 'sad';
  if (/\b(raiva|odio|irritad[oa]|revoltad[oa]|furios[oa]|bravo|brava)\b|\u{1F620}|\u{1F621}|\u{1F92C}/iu.test(input)) return 'angry';
  if (hasLaughingCue(userText)) return 'laughing';
  if (/\b(te amo|amo voce|gosto de voce|querid[oa]|fof[oa]|carinho)\b|\u{2764}|\u{1F495}|\u{1F970}|\u{1F60D}|\u{1F618}/iu.test(input)) return 'affectionate';
  if (/\b(uau|nossa|caramba|surpres[oa]|inacreditavel)\b|\u{1F62E}|\u{1F632}|\u{1F62F}|\u{1F633}/iu.test(input)) return 'surprised';
  if (/\b(feliz|contente|animad[oa]|adorei|amei|boa noticia|parabens|consegui|deu certo)\b|\u{1F600}|\u{1F603}|\u{1F604}|\u{1F601}|\u{1F60A}|\u{1F642}/iu.test(input)) return 'happy';

  if (/\b(sinto muito|lamento|imagino que seja dificil|estou aqui com voce|meus sentimentos)\b|\u{1F622}|\u{1F62D}|\u{1F614}/iu.test(output)) return 'sad';
  if (/\b(raiva|irritante|absurdo|injusto|revoltante)\b|\u{1F620}|\u{1F621}/iu.test(output)) return 'angry';
  if (hasLaughingCue(answer)) return 'laughing';
  if (/\b(te adoro|com carinho|que fof[oa]|um abraco|um beijo)\b|\u{2764}|\u{1F495}|\u{1F970}|\u{1F60D}/iu.test(output)) return 'affectionate';
  if (/\b(nossa|uau|caramba|serio|nao acredito|que incrivel|que surpresa)\b|\u{1F62E}|\u{1F632}|\u{1F633}/iu.test(output)) return 'surprised';
  if (/\b(que bom|adorei|amei|legal|otimo|perfeito|incrivel|feliz|boa noticia|parabens)\b|\u{1F604}|\u{1F60A}|\u{1F60D}/iu.test(output)) return 'happy';
  if (/\b(interessante|quero saber|me conta|curioso|curiosa)\b|\?/.test(output)) return 'curious';
  return 'neutral';
}

function extractImageGenerationPrompt(rawText: string): string | null {
  const normalized = rawText.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const action = /\b(?:gere|gerar|gera|crie|criar|cria|desenhe|desenhar|desenha|faca|fazer|faz|produza|produzir|produz)\b/.exec(normalized);
  if (!action) return null;
  const drawingAction = /\b(?:desenhe|desenhar|desenha)\b/.test(normalized);
  const hasImageNoun = /\b(?:imagem|ilustracao|desenho|arte|foto|retrato)\b/.test(normalized);
  if (!hasImageNoun && !drawingAction) return null;

  const rawAction = /\b(?:gere|gerar|gera|crie|criar|cria|desenhe|desenhar|desenha|faça|faca|fazer|faz|produza|produzir|produz)\b/i.exec(rawText);
  if (!rawAction) return null;
  const prompt = rawText
    .slice(rawAction.index + rawAction[0].length)
    .replace(/^\s*(?:(?:por favor|pra mim|para mim)\s+)?(?:(?:uma?|um|o|a)\s+)?(?:imagem|ilustra[cç][aã]o|desenho|arte|foto|retrato)\s*(?:(?:de|do|da|dos|das|com|mostrando|representando)\s+)?/i, '')
    .trim();
  return prompt.length >= 3 ? prompt.slice(0, 1200) : null;
}
const greeting: Message = {
  role: 'assistant',
  content: 'E aí, seu malassombro. Sou a Aurora. Desembucha: qual é a missão?',
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([greeting]);
  const [input, setInput] = useState('');
  const [config, setConfig] = useState<AppConfig>({
    ollamaAvailable: false,
    installedModels: [],
    modelInstalled: false,
    model: 'qwen3.5:2b',
  });
  const [model, setModel] = useState('qwen3.5:2b');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  const [studyMode, setStudyMode] = useState(false);
  const [memoryHubOpen, setMemoryHubOpen] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [conversationTitle, setConversationTitle] = useState('Nova conversa');
  const [storageReady, setStorageReady] = useState(false);
  const [memorySuggestion, setMemorySuggestion] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [laughing, setLaughing] = useState(false);
  const [emotion, setEmotion] = useState<AvatarEmotion>('neutral');
  const [audioAnalyser, setAudioAnalyser] = useState<AnalyserNode | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [transcribingVoice, setTranscribingVoice] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [notice, setNotice] = useState('');
  const [version, setVersion] = useState('0.4.0');
  const listRef = useRef<HTMLDivElement>(null);
  const voiceCaptureRef = useRef<VoiceCaptureSession | null>(null);
  const voiceResumeRef = useRef<number | null>(null);
  const recognitionPausedRef = useRef(false);
  const startVoiceCaptureRef = useRef<(() => Promise<void>) | null>(null);
  const stopVoiceCaptureRef = useRef<((transcribe: boolean) => void) | null>(null);
  const voiceVadRef = useRef<VoiceVadController | null>(null);
  const voiceVadActiveRef = useRef(false);
  const voiceVadInitializingRef = useRef(false);
  const voiceVadFailedRef = useRef(false);
  const microphoneIdRef = useRef('default');
  const activeChatRequestIdRef = useRef('');
  const chatTurnRef = useRef(0);
  const voiceOutputTurnRef = useRef(0);
  const voiceResponseActiveRef = useRef(false);
  const voiceModeRef = useRef(false);
  const thinkingRef = useRef(false);
  const sendMessageRef = useRef<(rawText: string) => Promise<void>>(async () => undefined);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSpeechFinishRef = useRef<(() => void) | null>(null);
  const [localTtsStatus, setLocalTtsStatus] = useState<LocalTtsStatus | null>(null);
  const [localTtsProgress, setLocalTtsProgress] = useState('');
  const [localTtsInstalling, setLocalTtsInstalling] = useState(false);
  const [elevenLabsStatus, setElevenLabsStatus] = useState<ElevenLabsStatus | null>(null);
  const [elevenLabsKeyInput, setElevenLabsKeyInput] = useState('');
  const [elevenLabsKeySaving, setElevenLabsKeySaving] = useState(false);
  const refreshElevenLabsStatus = async () => {
    try {
      setElevenLabsStatus(await window.aurora.getElevenLabsStatus());
    } catch (error) {
      console.warn('[Aurora TTS] Não consegui consultar a configuração da ElevenLabs:', error);
    }
  };
  const [audioInputs, setAudioInputs] = useState<AudioInputOption[]>([]);
  const [microphoneId, setMicrophoneId] = useState('default');
  const refreshLocalTtsStatus = async () => {
    try {
      setLocalTtsStatus(await window.aurora.getLocalTtsStatus());
    } catch (error) {
      console.warn('[Aurora TTS] Não consegui consultar o Kokoro local:', error);
    }
  };
  const refreshAudioInputs = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter((device) => device.kind === 'audioinput')
        .map((device, index) => ({
          deviceId: device.deviceId || 'default',
          label: device.label || 'Microfone ' + (index + 1),
        }));
      setAudioInputs(inputs);
      if (microphoneIdRef.current !== 'default' && !inputs.some((device) => device.deviceId === microphoneIdRef.current)) {
        microphoneIdRef.current = 'default';
        setMicrophoneId('default');
      }
    } catch (error) {
      console.warn('[Aurora Microphone] Não consegui listar dispositivos de entrada:', error);
    }
  };
  microphoneIdRef.current = microphoneId;

  useEffect(() => {
    void refreshLocalTtsStatus();
    void refreshElevenLabsStatus();
    return window.aurora.onTtsStatus((status) => {
      setLocalTtsProgress(status.message || '');
      if (status.state === 'installed' || status.state === 'ready' || status.state === 'error') {
        void refreshLocalTtsStatus();
      }
    });
  }, []);
  thinkingRef.current = thinking;

  const pauseVoiceRecognitionForSpeech = () => {
    if (!voiceModeRef.current) return;
    recognitionPausedRef.current = true;
    if (voiceResumeRef.current !== null) {
      window.clearTimeout(voiceResumeRef.current);
      voiceResumeRef.current = null;
    }
    if (voiceVadRef.current) {
      if (voiceVadActiveRef.current) void Promise.resolve(voiceVadRef.current.pause()).catch((error) => console.warn('[Aurora VAD] Não consegui pausar a escuta:', error));
      voiceVadActiveRef.current = false;
    } else {
      stopVoiceCaptureRef.current?.(false);
    }
    setListening(false);
  };

  const interruptVoiceResponse = () => {
    if (!voiceResponseActiveRef.current) return;
    const requestId = activeChatRequestIdRef.current;
    if (requestId) window.aurora.cancelChat(requestId);
    activeChatRequestIdRef.current = '';
    chatTurnRef.current += 1;
    voiceOutputTurnRef.current += 1;
    voiceResponseActiveRef.current = false;
    thinkingRef.current = false;
    setThinking(false);
    activeSpeechFinishRef.current?.();
    const currentAudio = audioRef.current;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.onended?.(new Event('ended'));
    }
    audioRef.current = null;
    window.speechSynthesis?.cancel();
    resetAudioAnalysis();
    setSpeaking(false);
    setEmotion('curious');
    setNotice('Te ouvi! Pode continuar.');
  };

  const resumeVoiceRecognitionAfterSpeech = (delay = 400) => {
    if (!voiceModeRef.current) return;
    if (voiceResumeRef.current !== null) window.clearTimeout(voiceResumeRef.current);
    voiceResumeRef.current = window.setTimeout(() => {
      voiceResumeRef.current = null;
      if (!voiceModeRef.current) return;
      recognitionPausedRef.current = false;
      void startVoiceCaptureRef.current?.();
    }, delay);
  };

  const resetAudioAnalysis = () => {
    setAudioAnalyser(null);
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  };

  useEffect(() => {
    return window.aurora.onImageStatus((status) => {
      if (status.message) setNotice(status.message);
    });
  }, []);

  useEffect(() => {
    return window.aurora.onSpeechRecognitionStatus((status) => {
      if (status.state === 'loading' || status.state === 'downloading' || status.state === 'error') {
        setNotice(status.message);
      } else if (status.state === 'ready') {
        setNotice(status.message);
      }
    });
  }, []);

  useEffect(() => {
    window.aurora.getConfig()
      .then((data) => {
        setConfig(data);
        setModel(data.model);
      })
      .catch(() => setNotice('Não consegui carregar as configurações.'));
    window.aurora.version().then(setVersion).catch(() => undefined);

    // A Aurora inicia a escuta automaticamente ao abrir. O usuário pode desligá-la no botão do microfone.
    voiceModeRef.current = true;
    recognitionPausedRef.current = false;
    setVoiceMode(true);
    setNotice('Ativando microfone…');
    void startVoiceCaptureRef.current?.();
    void window.aurora.warmupTranscription().catch((error) => {
      console.warn('[Aurora Whisper] Não consegui preparar o reconhecimento ao iniciar:', error);
      setNotice('Microfone ativo; o reconhecimento de voz ainda está sendo preparado.');
    });

    return () => {
      voiceModeRef.current = false;
      if (voiceResumeRef.current !== null) {
        window.clearTimeout(voiceResumeRef.current);
        voiceResumeRef.current = null;
      }
      recognitionPausedRef.current = false;
      stopVoiceCaptureRef.current?.(false);
      if (voiceVadRef.current) {
        const vad = voiceVadRef.current;
        voiceVadRef.current = null;
        voiceVadActiveRef.current = false;
        void Promise.resolve(vad.pause()).then(() => vad.destroy()).catch(() => undefined);
      }
      startVoiceCaptureRef.current = null;
      stopVoiceCaptureRef.current = null;
      audioRef.current?.pause();
      const activeAudioContext = audioContextRef.current;
      audioContextRef.current = null;
      if (activeAudioContext && activeAudioContext.state !== 'closed') {
        void activeAudioContext.close().catch(() => undefined);
      }
      window.speechSynthesis?.cancel();
      void window.aurora.endSpeakSession().catch((error) => {
        console.warn('[Aurora TTS] Nao consegui encerrar a conexao de voz ao fechar a janela.', error);
      });
    };
  }, []);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, thinking]);

  // Reabre a conversa mais recente entre sessões do aplicativo.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await window.aurora.listConversations();
        const latest = result.conversations[0];
        if (latest) {
          const loaded = await window.aurora.loadConversation(latest.id);
          if (active && loaded.found) {
            setConversationId(loaded.conversation.id);
            setConversationTitle(loaded.conversation.title);
            const restoredMessages = await Promise.all(loaded.conversation.messages.map(async (message) => {
              if (!message.imageId) return message;
              try {
                const image = await window.aurora.loadGeneratedImage(message.imageId);
                return image.found && image.dataUrl ? { ...message, imageUrl: image.dataUrl } : message;
              } catch {
                return message;
              }
            }));
            if (active) setMessages([greeting, ...restoredMessages]);
          }
        } else {
          const created = await window.aurora.createConversation();
          if (active) {
            setConversationId(created.id);
            setConversationTitle(created.title);
          }
        }
      } catch (error) {
        if (active) setNotice(error instanceof Error ? error.message : 'Não consegui restaurar o histórico da Aurora.');
      } finally {
        if (active) setStorageReady(true);
      }
    })();
    return () => { active = false; };
  }, []);

  // Persiste somente quando o turno termina; evita gravar cada token do streaming.
  useEffect(() => {
    if (!storageReady || !conversationId || thinking || messages.length <= 1) return;
    const timeout = window.setTimeout(() => {
      const savedMessages = messages.filter((message) => message.content !== greeting.content && message.content.trim());
      if (!savedMessages.length) return;
      void window.aurora.saveConversation({
        id: conversationId,
        title: conversationTitle,
        messages: savedMessages,
      }).then((result) => {
        if (result.conversation.id === conversationId) setConversationTitle(result.conversation.title);
      }).catch((error) => {
        console.warn('[Aurora History] Não consegui salvar a conversa:', error);
        setNotice('Não consegui salvar o histórico desta conversa. Confira o armazenamento seguro do Windows.');
      });
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [messages, thinking, conversationId, conversationTitle, storageReady]);

  useEffect(() => {
    if (!laughing) return;
    const timeout = window.setTimeout(() => setLaughing(false), 2600);
    return () => window.clearTimeout(timeout);
  }, [laughing]);

  const transcribeVoiceSamples = (samples: Float32Array) => {
    if (!voiceModeRef.current || recognitionPausedRef.current) return;
    recognitionPausedRef.current = true;
    if (voiceVadRef.current && voiceVadActiveRef.current) {
      void Promise.resolve(voiceVadRef.current.pause()).catch((error) => console.warn('[Aurora VAD] Não consegui pausar após a fala:', error));
      voiceVadActiveRef.current = false;
    }
    setListening(false);
    setTranscribingVoice(true);
    setNotice('Transcrevendo sua fala localmente…');
    const preparedAudio = prepareVoiceAudio(samples);
    console.info('[Aurora Performance] Silero VAD / ganho de microfone', {
      audioSeconds: Number((samples.length / 16000).toFixed(2)),
      sampleRate: 16000,
      rmsBefore: Number(preparedAudio.rmsBefore.toFixed(4)),
      peakBefore: Number(preparedAudio.peakBefore.toFixed(4)),
      gainApplied: Number(preparedAudio.gain.toFixed(2)),
      rmsAfter: Number(preparedAudio.rmsAfter.toFixed(4)),
    });
    void (async () => {
      try {
        if (samples.length < 4000) throw new Error('A fala ficou muito curta. Tente falar um pouco mais.');
        if (samples.length > 16000 * 45) throw new Error('A fala passou de 45 segundos. Divida a mensagem.');
        const result = await window.aurora.transcribeAudio(preparedAudio.samples);
        const transcript = result?.text?.trim() || '';
        if (!voiceModeRef.current) return;
        if (!transcript) {
          setNotice('Não consegui entender essa fala. Confira o microfone ou fale um pouco mais perto dele.');
          resumeVoiceRecognitionAfterSpeech(650);
          return;
        }
        setNotice('');
        void sendMessageRef.current(transcript);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Não consegui transcrever o áudio localmente.');
        resumeVoiceRecognitionAfterSpeech(900);
      } finally {
        setTranscribingVoice(false);
      }
    })();
  };

  const stopVoiceCapture = (transcribe: boolean) => {
    const session = voiceCaptureRef.current;
    if (!session || session.stopped) return;

    const speechWasLongEnough = session.speechDetected ||
      (session.firstSpeechAt !== null && Date.now() - session.firstSpeechAt >= 250);
    session.transcribeOnStop = transcribe && speechWasLongEnough;
    session.stopped = true;
    window.clearInterval(session.timer);
    setListening(false);

    try {
      if (session.recorder.state !== 'inactive') session.recorder.stop();
      else {
        session.stream.getTracks().forEach((track) => track.stop());
        void session.audioContext.close().catch(() => undefined);
        voiceCaptureRef.current = null;
      }
    } catch (error) {
      voiceCaptureRef.current = null;
      session.stream.getTracks().forEach((track) => track.stop());
      void session.audioContext.close().catch(() => undefined);
      if (voiceModeRef.current && !recognitionPausedRef.current) {
        setNotice(error instanceof Error ? error.message : 'Nao consegui encerrar a captura do microfone.');
        resumeVoiceRecognitionAfterSpeech(700);
      }
    }
  };

  const startVoiceCapture = async () => {
    if (!voiceModeRef.current || recognitionPausedRef.current || voiceCaptureRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      stopVoiceMode();
      setNotice('Este ambiente do Electron não oferece captura de áudio. Verifique a permissão do microfone.');
      return;
    }

    if (voiceVadRef.current) {
      if (!voiceVadActiveRef.current) {
        await Promise.resolve(voiceVadRef.current.start());
        voiceVadActiveRef.current = true;
      }
      setListening(true);
      return;
    }
    if (voiceVadInitializingRef.current) return;

    if (!voiceVadFailedRef.current) {
      voiceVadInitializingRef.current = true;
      try {
        setNotice('Carregando detector neural de fala…');
        const { MicVAD } = await import('@ricky0123/vad-web');
        const assetBasePath = new URL(`${import.meta.env.BASE_URL}aurora-vad/`, window.location.href).toString();
        const getVoiceStream = async () => {
          const audio: MediaTrackConstraints = {
            channelCount: { ideal: 1 },
            sampleRate: { ideal: 48000 },
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true },
          };
          if (microphoneIdRef.current && microphoneIdRef.current !== 'default') {
            audio.deviceId = { exact: microphoneIdRef.current };
          }
          const stream = await navigator.mediaDevices.getUserMedia({ audio });
          const track = stream.getAudioTracks()[0];
          const settings = track?.getSettings();
          console.info('[Aurora Microphone] Entrada ativa', {
            label: track?.label || 'Microfone padrão',
            sampleRate: settings?.sampleRate || null,
            channels: settings?.channelCount || null,
            echoCancellation: settings?.echoCancellation ?? null,
            noiseSuppression: settings?.noiseSuppression ?? null,
            autoGainControl: settings?.autoGainControl ?? null,
          });
          return stream;
        };
        const vad = await MicVAD.new({
          startOnLoad: false,
          model: 'v5',
          processorType: 'AudioWorklet',
          baseAssetPath: assetBasePath,
          onnxWASMBasePath: assetBasePath,
          positiveSpeechThreshold: 0.34,
          negativeSpeechThreshold: 0.22,
          redemptionMs: 750,
          preSpeechPadMs: 700,
          minSpeechMs: 280,
          getStream: getVoiceStream,
          resumeStream: getVoiceStream,
          onSpeechStart: () => {
            if (voiceModeRef.current && !recognitionPausedRef.current) setListening(true);
          },
          onSpeechRealStart: () => {
            if (!voiceModeRef.current || recognitionPausedRef.current) return;
            setListening(true);
            if (voiceResponseActiveRef.current) interruptVoiceResponse();
          },
          onVADMisfire: () => setListening(false),
          onSpeechEnd: (audio: Float32Array) => transcribeVoiceSamples(audio),
        });
        voiceVadRef.current = vad;
        if (!voiceModeRef.current || recognitionPausedRef.current) {
          await Promise.resolve(vad.pause());
          return;
        }
        await Promise.resolve(vad.start());
        voiceVadActiveRef.current = true;
        setListening(true);
        setNotice('');
        void refreshAudioInputs();
        console.info('[Aurora Voice] Silero VAD v5 pronto; Whisper recebe áudio 16 kHz diretamente.');
        return;
      } catch (error) {
        voiceVadFailedRef.current = true;
        const failedVad = voiceVadRef.current;
        voiceVadRef.current = null;
        voiceVadActiveRef.current = false;
        if (failedVad) {
          await Promise.resolve(failedVad.pause()).catch(() => undefined);
          await Promise.resolve(failedVad.destroy()).catch(() => undefined);
        }
        console.warn('[Aurora VAD] Não consegui iniciar o detector neural; usando captura RMS de reserva:', error);
        setNotice('Detector neural indisponível; usando captura de voz de reserva.');
      } finally {
        voiceVadInitializingRef.current = false;
      }
    }

    if (typeof MediaRecorder === 'undefined') {
      stopVoiceMode();
      setNotice('O gravador de áudio não está disponível neste ambiente do Electron.');
      return;
    }

    let pendingStream: MediaStream | null = null;
    let pendingAudioContext: AudioContext | null = null;
    try {
      const fallbackAudioConstraints: MediaTrackConstraints = {
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48000 },
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
      };
      if (microphoneIdRef.current && microphoneIdRef.current !== 'default') {
        fallbackAudioConstraints.deviceId = { exact: microphoneIdRef.current };
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: fallbackAudioConstraints });

      pendingStream = stream;
      if (!voiceModeRef.current || recognitionPausedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        pendingStream = null;
        return;
      }

      const audioContext = new AudioContext();
      pendingAudioContext = audioContext;
      if (audioContext.state === 'suspended') await audioContext.resume();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.35;
      source.connect(analyser);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      analyser.connect(silentGain);
      silentGain.connect(audioContext.destination);

      const preferredMime = 'audio/webm;codecs=opus';
      const recorder = MediaRecorder.isTypeSupported(preferredMime)
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);
      const session: VoiceCaptureSession = {
        stream,
        source,
        recorder,
        chunks: [],
        audioContext,
        analyser,
        samples: new Float32Array(analyser.fftSize),
        timer: 0,
        startedAt: Date.now(),
        firstSpeechAt: null,
        lastSpeechAt: 0,
        speechDetected: false,
        peakRms: 0,
        noiseFloorRms: 0.002,
        speechThresholdRms: 0.005,
        noiseCalibrationSamples: 0,
        stopped: false,
        transcribeOnStop: false,
      };

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) session.chunks.push(event.data);
      };

      recorder.onerror = () => {
        if (!session.stopped) stopVoiceCaptureRef.current?.(false);
        setNotice('O gravador do microfone encontrou um erro. Confira o dispositivo de entrada do Windows.');
      };

      recorder.onstop = () => {
        void (async () => {
          if (voiceCaptureRef.current === session) voiceCaptureRef.current = null;
          const inputSettings = session.stream.getAudioTracks()[0]?.getSettings();
          console.info('[Aurora Performance] Microfone', {
            captureSeconds: Number(((Date.now() - session.startedAt) / 1000).toFixed(2)),
            peakRms: Number(session.peakRms.toFixed(4)),
            noiseFloorRms: Number(session.noiseFloorRms.toFixed(4)),
            speechThresholdRms: Number(session.speechThresholdRms.toFixed(4)),
            inputSampleRate: inputSettings?.sampleRate || null,
            inputChannels: inputSettings?.channelCount || null,
            echoCancellation: inputSettings?.echoCancellation ?? null,
            noiseSuppression: inputSettings?.noiseSuppression ?? null,
            autoGainControl: inputSettings?.autoGainControl ?? null,
            speechDetected: session.speechDetected,
            recorderChunks: session.chunks.length,
          });
          session.stream.getTracks().forEach((track) => track.stop());
          await session.audioContext.close().catch(() => undefined);

          if (!session.transcribeOnStop || session.chunks.length === 0) {
            if (voiceModeRef.current && !recognitionPausedRef.current) {
              resumeVoiceRecognitionAfterSpeech(450);
            }
            return;
          }

          recognitionPausedRef.current = true;
          setListening(false);
          setTranscribingVoice(true);
          setNotice('Preparando a transcricao local…');
          let decodingContext: AudioContext | null = null;

          try {
            const blob = new Blob(session.chunks, { type: recorder.mimeType || 'audio/webm' });
            decodingContext = new AudioContext();
            const decoded = await decodingContext.decodeAudioData(await blob.arrayBuffer());
            const frameCount = decoded.length;
            const channelCount = decoded.numberOfChannels;
            const mono = new Float32Array(frameCount);

            for (let channel = 0; channel < channelCount; channel += 1) {
              const channelData = decoded.getChannelData(channel);
              for (let index = 0; index < frameCount; index += 1) {
                mono[index] += channelData[index] / channelCount;
              }
            }

            const outputLength = Math.floor(frameCount * 16000 / decoded.sampleRate);
            if (outputLength < 4000) throw new Error('A fala ficou muito curta. Tente falar um pouco mais.');
            if (outputLength > 16000 * 45) throw new Error('A fala passou de 45 segundos. Divida a mensagem.');

            let pcm16k: Float32Array;
            if (decoded.sampleRate === 16000) {
              pcm16k = mono;
            } else {
              // OfflineAudioContext aplica filtro de reamostragem; interpolação linear simples pode degradar consoantes.
              const resampleContext = new OfflineAudioContext(1, outputLength, 16000);
              const monoBuffer = resampleContext.createBuffer(1, frameCount, decoded.sampleRate);
              monoBuffer.copyToChannel(mono, 0);
              const resampleSource = resampleContext.createBufferSource();
              resampleSource.buffer = monoBuffer;
              resampleSource.connect(resampleContext.destination);
              resampleSource.start(0);
              const resampledAudio = await resampleContext.startRendering();
              pcm16k = resampledAudio.getChannelData(0).slice();
            }

            const preparedAudio = prepareVoiceAudio(pcm16k);
            console.info('[Aurora Performance] Ganho de microfone (captura reserva)', {
              rmsBefore: Number(preparedAudio.rmsBefore.toFixed(4)),
              peakBefore: Number(preparedAudio.peakBefore.toFixed(4)),
              gainApplied: Number(preparedAudio.gain.toFixed(2)),
              rmsAfter: Number(preparedAudio.rmsAfter.toFixed(4)),
            });
            setNotice('Transcrevendo no proprio computador…');
            const result = await window.aurora.transcribeAudio(preparedAudio.samples);
            const transcript = result?.text?.trim() || '';

            if (!voiceModeRef.current) return;
            if (!transcript) {
              setNotice('Nao consegui entender essa fala. Fale um pouco mais perto do microfone.');
              resumeVoiceRecognitionAfterSpeech(800);
              return;
            }

            setNotice('');
            void sendMessageRef.current(transcript);
          } catch (error) {
            setNotice(error instanceof Error ? error.message : 'Nao consegui transcrever o audio localmente.');
            resumeVoiceRecognitionAfterSpeech(1000);
          } finally {
            if (decodingContext && decodingContext.state !== 'closed') {
              await decodingContext.close().catch(() => undefined);
            }
            setTranscribingVoice(false);
          }
        })();
      };

      voiceCaptureRef.current = session;
      pendingStream = null;
      pendingAudioContext = null;
      recorder.start(250);
      setListening(true);
      setNotice('');
      void refreshAudioInputs();

      session.timer = window.setInterval(() => {
        if (session.stopped) return;
        try {
          session.analyser.getFloatTimeDomainData(session.samples);
          let sumSquares = 0;
          for (let index = 0; index < session.samples.length; index += 1) {
            const sample = session.samples[index];
            sumSquares += sample * sample;
          }
          const rms = Math.sqrt(sumSquares / session.samples.length);
          session.peakRms = Math.max(session.peakRms, rms);
          const now = Date.now();

          // Calibra o ruído ambiente nos primeiros 300 ms e ajusta o limiar para vozes mais baixas.
          if (!session.speechDetected && session.noiseCalibrationSamples < 3) {
            session.noiseFloorRms = session.noiseCalibrationSamples === 0
              ? rms
              : (session.noiseFloorRms * 0.65) + (rms * 0.35);
            session.noiseCalibrationSamples += 1;
            session.speechThresholdRms = Math.max(0.004, Math.min(0.02, session.noiseFloorRms * 2.6));
          } else if (!session.speechDetected && session.firstSpeechAt === null && rms < session.speechThresholdRms) {
            session.noiseFloorRms = (session.noiseFloorRms * 0.97) + (rms * 0.03);
            session.speechThresholdRms = Math.max(0.004, Math.min(0.02, session.noiseFloorRms * 2.6));
          }

          if (rms >= session.speechThresholdRms) {
            if (session.firstSpeechAt === null) session.firstSpeechAt = now;
            session.lastSpeechAt = now;
            if (now - session.firstSpeechAt >= 200) session.speechDetected = true;
          }

          if (session.speechDetected && rms < session.speechThresholdRms * 0.68 && now - session.lastSpeechAt >= VOICE_END_SILENCE_MS) {
            stopVoiceCaptureRef.current?.(true);
          } else if (now - session.startedAt >= 25000) {
            stopVoiceCaptureRef.current?.(true);
          }
        } catch {
          stopVoiceCaptureRef.current?.(false);
          setNotice('A leitura do microfone foi interrompida. Tente ativar a escuta novamente.');
        }
      }, 100);
    } catch (error) {
      if (pendingStream) pendingStream.getTracks().forEach((track) => track.stop());
      if (pendingAudioContext && pendingAudioContext.state !== 'closed') {
        await pendingAudioContext.close().catch(() => undefined);
      }
      stopVoiceMode();
      const message = error instanceof Error ? error.message : String(error);
      if (/notallowed|permission|denied/i.test(message)) {
        setNotice('O acesso ao microfone foi negado. Libere a permissao de microfone para a Aurora no Windows.');
      } else {
        setNotice('Nao consegui acessar o microfone: ' + message.slice(0, 180));
      }
    }
  };

  startVoiceCaptureRef.current = startVoiceCapture;
  stopVoiceCaptureRef.current = stopVoiceCapture;

  const speak = async (text: string, waitForPlayback = false, resumeAfterPlayback = true) => {
    const speechTicket = voiceOutputTurnRef.current;
    const speechText = normalizeSpeechText(text);
    if (!hasSpeakableSpeechText(speechText)) {
      console.info('[Aurora TTS] Trecho ignorado: nenhum texto falável após remover emojis e símbolos.');
      return;
    }
    pauseVoiceRecognitionForSpeech();
    if (hasLaughingCue(text)) setLaughing(true);
    audioRef.current?.pause();
    audioRef.current = null;
    resetAudioAnalysis();
    window.speechSynthesis?.cancel();
    setSpeaking(true);

    let finishPlayback!: () => void;
    const playbackFinished = new Promise<void>((resolve) => {
      finishPlayback = () => {
        if (activeSpeechFinishRef.current === finishPlayback) activeSpeechFinishRef.current = null;
        resolve();
      };
      activeSpeechFinishRef.current = finishPlayback;
    });

    try {
      const result = await window.aurora.speak(speechText);
      if (speechTicket !== voiceOutputTurnRef.current) {
        finishPlayback();
        return;
      }
      if (!result?.audioBase64) throw new Error('A voz neural nao retornou audio.');
      console.info('[Aurora TTS] Áudio recebido para reprodução', { provider: result.provider || 'não informado', mimeType: result.audioMimeType || 'audio/mpeg', audioBytes: Math.floor(result.audioBase64.length * 0.75) });
      if (result.provider === 'kokoro-local' || result.provider === 'elevenlabs' || result.provider === 'edge-tts') setNotice('');

      const audio = new Audio('data:' + (result.audioMimeType || 'audio/mpeg') + ';base64,' + result.audioBase64);
      audioRef.current = audio;

      // Liga o áudio ao Web Audio para medir seu volume e animar a boca em tempo real.
      let context: AudioContext | null = null;
      try {
        context = new AudioContext();
        if (context.state === 'suspended') await context.resume();
        if (context.state === 'running') {
          const source = context.createMediaElementSource(audio);
          const analyser = context.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.68;
          source.connect(analyser);
          analyser.connect(context.destination);
          audioContextRef.current = context;
          setAudioAnalyser(analyser);
        } else {
          await context.close();
        }
      } catch (analysisError) {
        if (context && context.state !== 'closed') void context.close().catch(() => undefined);
        console.warn('[Aurora lip-sync] Não foi possível analisar o áudio; usando movimento de boca de reserva.', analysisError);
      }

      const finishAudio = () => {
        setSpeaking(false);
        setEmotion('neutral');
        if (audioRef.current === audio) audioRef.current = null;
        resetAudioAnalysis();
        if (resumeAfterPlayback) resumeVoiceRecognitionAfterSpeech();
        finishPlayback();
      };
      audio.onended = finishAudio;
      audio.onerror = () => {
        setNotice('O áudio neural não pôde ser reproduzido. A escuta por voz será retomada.');
        finishAudio();
      };
      await audio.play();
      if (voiceModeRef.current && voiceResponseActiveRef.current && voiceVadRef.current) {
        recognitionPausedRef.current = false;
        void startVoiceCaptureRef.current?.();
      }
      if (waitForPlayback) await playbackFinished;
    } catch (error) {
      // Cancela qualquer retomada agendada antes de iniciar a voz de reserva.
      pauseVoiceRecognitionForSpeech();
      audioRef.current?.pause();
      audioRef.current = null;
      resetAudioAnalysis();

      // Fallback local: mantém a Aurora falando mesmo quando os provedores neurais falham.
      console.warn('[Aurora TTS] Ativando a voz de emergência do Windows porque ElevenLabs/Kokoro não entregaram áudio.', error);
      try {
        if (!('speechSynthesis' in window)) throw error;
        const synth = window.speechSynthesis;
        const utterance = new SpeechSynthesisUtterance(speechText);
        const portugueseVoice = await waitForPortugueseSpeechVoice(synth);
        const availableVoices = synth.getVoices();
        utterance.lang = 'pt-BR';
        if (portugueseVoice) utterance.voice = portugueseVoice;
        console.warn('[Aurora TTS] Voz de emergência do Windows selecionada', {
          voiceName: portugueseVoice?.name || 'padrão do sistema',
          voiceLanguage: portugueseVoice?.lang || 'não identificada',
          voiceURI: portugueseVoice?.voiceURI || null,
          portugueseVoicesAvailable: availableVoices.filter((voice) => /^pt(?:-|_)/i.test(voice.lang)).map((voice) => ({ name: voice.name, lang: voice.lang })),
          reason: 'ElevenLabs/Kokoro não entregaram áudio',
        });
        utterance.rate = 1;
        utterance.pitch = 1.04;
        utterance.onend = () => {
          setSpeaking(false);
          setEmotion('neutral');
          if (resumeAfterPlayback) resumeVoiceRecognitionAfterSpeech();
          finishPlayback();
        };
        utterance.onerror = () => {
          setSpeaking(false);
          setEmotion('neutral');
          if (resumeAfterPlayback) resumeVoiceRecognitionAfterSpeech();
          finishPlayback();
        };
        const neuralDetail = error instanceof Error ? error.message : String(error);
        setNotice('A voz neural falhou: ' + neuralDetail.slice(0, 160) + '. Estou usando temporariamente a voz instalada no Windows.');
        setSpeaking(true);
        synth.cancel();
        synth.speak(utterance);
        if (voiceModeRef.current && voiceResponseActiveRef.current && voiceVadRef.current) {
          recognitionPausedRef.current = false;
          void startVoiceCaptureRef.current?.();
        }
        if (waitForPlayback) await playbackFinished;
      } catch (fallbackError) {
        setSpeaking(false);
        setEmotion('neutral');
        if (resumeAfterPlayback) resumeVoiceRecognitionAfterSpeech();
        finishPlayback();
        const neuralDetail = error instanceof Error ? error.message : String(error);
        const fallbackDetail = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        setNotice('Não consegui gerar áudio. Voz neural: ' + neuralDetail.slice(0, 150) + '. Voz do Windows: ' + fallbackDetail.slice(0, 100));
      }
    }
  };

  const openSavedConversation = async (id: string) => {
    setStorageReady(false);
    try {
      const result = await window.aurora.loadConversation(id);
      if (!result.found) throw new Error('Essa conversa não está mais disponível.');
      setConversationId(result.conversation.id);
      setConversationTitle(result.conversation.title);
      setMessages([greeting, ...result.conversation.messages]);
      setMemorySuggestion(null);
      setMemoryHubOpen(false);
      setChatOpen(true);
      setNotice('Conversa anterior restaurada.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não consegui abrir essa conversa.');
    } finally {
      setStorageReady(true);
    }
  };

  const startNewConversation = async () => {
    setStorageReady(false);
    try {
      const created = await window.aurora.createConversation();
      setConversationId(created.id);
      setConversationTitle(created.title);
      setMessages([greeting]);
      setMemorySuggestion(null);
      setChatOpen(true);
      setMemoryHubOpen(false);
      setNotice('Nova conversa iniciada. As anteriores continuam no histórico.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não consegui criar uma nova conversa.');
    } finally {
      setStorageReady(true);
    }
  };

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || thinkingRef.current) return;
    const turnId = ++chatTurnRef.current;
    const requestId = 'aurora-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    const speechTurnId = ++voiceOutputTurnRef.current;
    activeChatRequestIdRef.current = requestId;
    voiceResponseActiveRef.current = voiceModeRef.current && autoSpeak;
    setMemorySuggestion(detectMemorySuggestion(text));

    // Enquanto a IA pensa, evita capturar outra frase por cima da mensagem atual.
    pauseVoiceRecognitionForSpeech();
    thinkingRef.current = true;
    setNotice('');
    audioRef.current?.pause();
    audioRef.current = null;
    resetAudioAnalysis();
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    setEmotion('curious');

    const history = messages
      .filter((message) => message.content !== greeting.content)
      .slice(-6);

    let closeSpeechSession: (() => Promise<void>) | null = null;
    let assistantPlaceholderAdded = false;
    let assistantReplyDelivered = false;
    setMessages((current) => [...current, { role: 'user', content: text }]);
    if (conversationId) {
      const savedMessages = [...messages.filter((message) => message.content !== greeting.content && message.content.trim()), { role: 'user' as const, content: text }];
      void window.aurora.saveConversation({ id: conversationId, title: conversationTitle, messages: savedMessages }).catch((error) => {
        console.warn('[Aurora History] Não consegui salvar a mensagem enviada:', error);
      });
    }
    setInput('');
    setThinking(true);

    try {
      const imagePrompt = extractImageGenerationPrompt(text);
      if (imagePrompt) {
        setChatOpen(true);
        setMemoryHubOpen(false);
        setAppsOpen(false);
        setNotice('Gerando imagem localmente pelo ComfyUI…');
        const generated = await window.aurora.generateImage({ prompt: imagePrompt }).catch((error) => {
          const details = error instanceof Error ? error.message : 'Confira se o ComfyUI está aberto e se há um modelo de imagem instalado.';
          const failureReply = 'Não consegui gerar a imagem agora. ' + details;
          setNotice(details);
          setEmotion('neutral');
          setMessages((current) => [...current, { role: 'assistant', content: failureReply }]);
          if (autoSpeak) {
            void speak(failureReply).catch((speechError) => {
              console.warn('[Aurora Image] Não consegui falar o erro de geração:', speechError);
            }).finally(() => {
              if (voiceModeRef.current) resumeVoiceRecognitionAfterSpeech(500);
            });
          } else if (voiceModeRef.current) {
            resumeVoiceRecognitionAfterSpeech(500);
          }
          return null;
        });
        if (!generated) return;
        const imageReply = 'Prontinho! Criei sua imagem e deixei ela salva na minha galeria local.';
        setEmotion('happy');
        setMessages((current) => [...current, {
          role: 'assistant',
          content: imageReply,
          imageId: generated.id,
          imageUrl: generated.dataUrl,
        }]);
        setNotice('Imagem criada e salva na galeria local da Aurora.');
        if (autoSpeak) {
          void speak(imageReply).catch((error) => {
            console.warn('[Aurora Image] Não consegui falar a confirmação da imagem:', error);
          }).finally(() => {
            if (voiceModeRef.current) resumeVoiceRecognitionAfterSpeech(500);
          });
        } else if (voiceModeRef.current) {
          resumeVoiceRecognitionAfterSpeech(500);
        }
        return;
      }

      const normalizedUserRequest = text.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const selfVisualRequest = /\b(como voce e|como voce ta|como e seu avatar|qual e sua aparencia|descreva sua aparencia|fale sobre sua aparencia|como voce aparece|como voce se parece|olha pra voce|olhe para voce|olha para voce|veja seu avatar|se veja|se olhe|esta sorrindo|esta fazendo qual expressao|qual expressao voce (?:esta|ta)|como esta sua expressao|o que voce (?:esta|ta) vestindo|o que voce (?:esta|ta) usando|como e seu cabelo|como e seu rosto|essa e voce|essa personagem e voce|descreva a boneca|descreva a personagem|me fala da sua boneca|me fala da sua personagem|como e a boneca da tela|sua boneca|sua personagem)\b/.test(normalizedUserRequest);
      const quickReply = selfVisualRequest ? null : await runQuickCommand(text);
      if (quickReply) {
        setEmotion(inferAvatarEmotion(text, quickReply));
        if (hasLaughingCue(text + " " + quickReply)) setLaughing(true);
        setMessages((current) => [...current, { role: 'assistant', content: quickReply }]);
        assistantReplyDelivered = true;
        if (autoSpeak) {
          if (voiceModeRef.current) await speak(quickReply, true);
          else void speak(quickReply);
        }
        return;
      }

      const normalizedScreenRequest = text.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const asksForScreenAnalysis =
        /\b(analise|analisar|olha|olhe|olhar|veja|ver|observe|observar|descreva|descrever|mostre|mostrar)\b/.test(normalizedScreenRequest) &&
        /\b(tela|janela|aplicativo|programa|erro|mensagem|desktop|questao|questoes|alternativa|enunciado|exercicio|exercicios)\b/.test(normalizedScreenRequest) ||
        /\b(o que esta aparecendo|o que aparece na tela|o que tem na tela|minha tela|nessa janela|esse erro|essa questao|qual alternativa|qual a resposta|me explica isso|resolve essa)\b/.test(normalizedScreenRequest);
      // A Aurora pode observar seu próprio canvas Live2D quando o usuário pergunta sobre sua aparência.
      let selfAvatarImage = '';
      if (selfVisualRequest) {
        try {
          const live2d = await import('./live2d/Live2DHost');
          selfAvatarImage = await live2d.captureLive2DSnapshot();
        } catch (error) {
          console.warn('[Aurora Self-Perception] Não consegui capturar o próprio avatar:', error);
        }
      }
      // No Modo Estudo, cada pergunta recebe uma captura nova; o modelo não analisa vídeo em loop.
      const capture = (!selfAvatarImage && (studyMode || asksForScreenAnalysis)) ? await window.aurora.captureScreen() : null;
      const imageBase64 = selfAvatarImage || capture?.imageBase64 || '';
      const studyPrompt = studyMode
        ? 'MODO ESTUDO ENEM/CONCURSOS: aja como professor particular rigoroso e didático. Leia cuidadosamente a captura antes de responder. Primeiro identifique o que está escrito no enunciado e nas alternativas; nunca complete palavras ou números ilegíveis por adivinhação. Se uma parte essencial estiver pequena, cortada ou ambígua, diga exatamente o que não conseguiu ler e peça uma captura aproximada em vez de chutar. Identifique matéria e assunto. Em questão objetiva, indique a alternativa correta somente quando houver evidência suficiente, explique o raciocínio passo a passo e por que as alternativas mais plausíveis estão erradas. Confira cálculos, sinais, unidades, datas e conceitos antes de concluir. Diferencie fatos, interpretações e hipóteses. Nunca invente fonte, artigo de lei, número, autor, dado ou regra de edital. Para legislação, atualidades e regras de concurso que possam mudar, avise quando for necessária conferência em fonte oficial atualizada. Ensine o conceito por trás da questão com linguagem clara e um exemplo curto quando ajudar. Seja completa sem enrolar; faça uma pergunta de checagem apenas quando for útil para confirmar meu aprendizado.'
        : '';
      const computerPrompt = selfAvatarImage
        ? text + '\n\nA imagem anexada é uma captura atual do seu próprio avatar Live2D, renderizada diretamente do canvas da personagem. Observe a aparência e a expressão que realmente estão visíveis. Diferencie características permanentes da personagem da expressão momentânea. Use sua ficha de identidade como referência complementar. Não invente detalhes, não diga que viu uma webcam e não afirme ter consciência subjetiva.'
        : capture
          ? text + '\n\nEstou fornecendo uma captura atual do desktop. Analise somente o que estiver visível e explique o que aparece. A visão é somente de leitura: não proponha cliques, movimentos de mouse, digitação, atalhos ou blocos de ação. Se algo estiver ilegível, diga isso com clareza. ' + studyPrompt
          : selfVisualRequest
            ? text + '\n\nNão foi possível capturar seu avatar nesta ocasião. Responda somente com base na ficha de identidade cadastrada. Não diga que acabou de se observar nem invente características visuais.'
            : text;
      const canStreamSpeech = autoSpeak && (studyMode || !capture);
      let speechSessionActive = false;
      let speechSessionClosed = false;
      const speechSessionPromise = canStreamSpeech
        ? window.aurora.startSpeakSession()
            .then((status) => {
              speechSessionActive = status.active;
              return status;
            })
            .catch((error) => {
              console.warn('[Aurora TTS] Nao consegui preparar o streaming; usarei uma conexao por trecho.', error);
              return { active: false };
            })
        : Promise.resolve({ active: false });
      closeSpeechSession = async () => {
        await speechSessionPromise;
        // Enquanto o modo de voz continuar ativo, mantem o WebSocket pronto para o proximo turno.
        if (voiceModeRef.current) return;
        if (!speechSessionActive || speechSessionClosed) return;
        speechSessionClosed = true;
        speechSessionActive = false;
        await window.aurora.endSpeakSession().catch((error) => {
          console.warn('[Aurora TTS] Nao consegui encerrar a sessao de fala.', error);
        });
      };

      let speechBuffer = '';
      let speechStarted = false;
      let speechQueue = Promise.resolve();
      const enqueueSpeech = (segment: string) => {
        const cleanSegment = normalizeSpeechText(segment);
        if (!hasSpeakableSpeechText(cleanSegment)) return;
        speechStarted = true;
        speechQueue = speechQueue
          .then(async () => {
            if (voiceOutputTurnRef.current !== speechTurnId) return;
            await speechSessionPromise;
            if (voiceOutputTurnRef.current !== speechTurnId) return;
            await speak(cleanSegment, true, false);
          })
          .catch((error) => {
            setNotice(error instanceof Error ? error.message : 'Não consegui reproduzir um trecho da resposta.');
          });
      };
      const collectCompleteSpeech = (chunk: string) => {
        speechBuffer += chunk;
        // Uma cláusula longa terminada em vírgula já pode ir para a voz; não precisamos esperar o ponto final.
        const boundary = /[.!?…]+\s+/g;
        let cursor = 0;
        let match: RegExpExecArray | null;
        while ((match = boundary.exec(speechBuffer)) !== null) {
          const end = match.index + match[0].length;
          const candidate = speechBuffer.slice(cursor, end).trim();
          const wordCount = candidate.split(/\s+/).filter(Boolean).length;
          // Só envia uma frase quando a pontuação forte fecha a ideia; vírgulas não reiniciam a prosódia.
          const readyToSpeak = candidate.length >= 18 || wordCount >= 5;
          if (readyToSpeak) {
            enqueueSpeech(candidate);
            cursor = end;
          }
        }
        if (cursor > 0) speechBuffer = speechBuffer.slice(cursor);
      };

      setMessages((current) => [...current, { role: 'assistant', content: '' }]);
      assistantPlaceholderAdded = true;
      const response = await window.aurora.chat({ message: computerPrompt, history, voiceMode: voiceModeRef.current, studyMode, requestId, ...(imageBase64 ? { imageBase64 } : {}) }, (chunk) => {
        setMessages((current) => {
          const updated = [...current];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, content: last.content + chunk };
          return updated;
        });
        // A voz começa quando chega uma frase completa, sem esperar o restante da resposta do LLM.
        if (canStreamSpeech && voiceOutputTurnRef.current === speechTurnId) collectCompleteSpeech(chunk);
      });
      let answer = response.text?.trim() || 'Não consegui responder agora.';
      assistantReplyDelivered = true;
      setEmotion(inferAvatarEmotion(text, answer));
      if (hasLaughingCue(text + " " + answer)) setLaughing(true);
      setMessages((current) => {
        const updated = [...current];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, content: answer };
        else updated.push({ role: 'assistant', content: answer });
        return updated;
      });
      if (autoSpeak) {
        if (canStreamSpeech) {
          if (speechBuffer.trim()) enqueueSpeech(speechBuffer);
          if (speechStarted) {
            await speechQueue;
          } else {
            await speechSessionPromise;
            await speak(answer, true, false);
          }
          await closeSpeechSession?.();
          if (voiceModeRef.current && voiceOutputTurnRef.current === speechTurnId) resumeVoiceRecognitionAfterSpeech(250);
        } else {
          void speak(answer);
        }
      }
    } catch (error) {
      if (closeSpeechSession) await closeSpeechSession();
      if (!(error instanceof Error && error.name === 'AbortError')) {
        const errorDetail = error instanceof Error ? error.message : 'Ocorreu um erro ao conversar com a IA.';
        setNotice(errorDetail);
        console.error('[Aurora Chat] O turno falhou antes de entregar uma resposta:', error);
        if (!assistantReplyDelivered) {
          const fallbackReply = voiceModeRef.current
            ? 'Oxe, recebi sua fala, mas minha IA local falhou antes de me devolver uma resposta. Tenta falar comigo mais uma vez?'
            : 'Não consegui gerar uma resposta agora. Confira se o Ollama está aberto e tente novamente.';
          assistantReplyDelivered = true;
          setMessages((current) => {
            const updated = [...current];
            const last = updated[updated.length - 1];
            if (assistantPlaceholderAdded && last?.role === 'assistant') {
              updated[updated.length - 1] = {
                ...last,
                content: last.content.trim() ? last.content.trim() + '\n\n' + fallbackReply : fallbackReply,
              };
            } else {
              updated.push({ role: 'assistant', content: fallbackReply });
            }
            return updated;
          });
          if (autoSpeak) {
            void speak(fallbackReply, voiceModeRef.current).catch((speechError) => {
              console.warn('[Aurora Voice] Não consegui falar a mensagem de recuperação:', speechError);
            });
          } else if (voiceModeRef.current && recognitionPausedRef.current) {
            resumeVoiceRecognitionAfterSpeech(500);
          }
        } else if (voiceModeRef.current && recognitionPausedRef.current && !autoSpeak) {
          resumeVoiceRecognitionAfterSpeech(500);
        }
      }
    } finally {
      if (closeSpeechSession) await closeSpeechSession();
      if (chatTurnRef.current === turnId) {
        if (activeChatRequestIdRef.current === requestId) activeChatRequestIdRef.current = '';
        voiceResponseActiveRef.current = false;
        thinkingRef.current = false;
        setThinking(false);
        if (!autoSpeak && voiceModeRef.current && recognitionPausedRef.current) {
          resumeVoiceRecognitionAfterSpeech(500);
        }
      }
    }
  };

  sendMessageRef.current = sendMessage;

  const runQuickCommand = async (rawText: string): Promise<string | null> => {
    const text = rawText.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const rememberMatch = rawText.match(/^\s*(?:aurora[, ]+)?(?:lembre-se de que|lembre que|guarde que|anote que|aprenda que)\s+([\s\S]+)$/i);
    if (rememberMatch?.[1]?.trim()) {
      const saved = await window.aurora.saveMemory(rememberMatch[1].trim());
      return saved.saved
        ? 'Guardei isso na minha memória local. Olha só, até que enfim você falou algo que vale registrar.'
        : 'Isso já estava anotado. Tá vendo? Eu presto atenção, diferente de certas pessoas.';
    }

    if (/\b(abra|abrir|abre|mostre|mostrar|gerenciar|ver)\b.*\b(historico|conversas antigas|memoria|lembrancas|biblioteca|documentos)\b/.test(text)) {
      setMemoryHubOpen(true);
      setChatOpen(false);
      setAppsOpen(false);
      return 'Abri minha área de memória. Lá você pode pesquisar conversas, revisar lembranças e adicionar materiais.';
    }

    if (/\b(o que voce lembra de mim|quais memorias voce tem|o que esta guardado na memoria|mostre minhas memorias)\b/.test(text)) {
      const result = await window.aurora.listMemories();
      if (!result.memories.length) return 'Ainda não tenho lembranças salvas. Diga “lembre que…” quando quiser guardar alguma coisa.';
      return 'Tenho estas lembranças suas: ' +
        result.memories.slice(0, 10).map((item) => item.content).join('; ') +
        (result.count > 10 ? '. E mais ' + (result.count - 10) + ' lembranças.' : '.');
    }

    const forgetMatch = rawText.match(/^\s*(?:aurora[, ]+)?(?:esqueça que|esqueca que|esquece que|apague da memória|apague da memoria|remova da memória|remova da memoria)\s+([\s\S]+)$/i);
    if (forgetMatch?.[1]?.trim()) {
      const result = await window.aurora.deleteMemory(forgetMatch[1].trim());
      return result.deleted
        ? 'Apaguei essa lembrança da memória local.'
        : 'Não encontrei uma lembrança com esse conteúdo.';
    }

    if (/\b(ativar|ligar|iniciar|entrar|comecar)\b.*\b(modo estudo|modo estudar|estudo)\b|\b(modo estudo|modo estudar)\b.*\b(ativar|ligar|iniciar|entrar|comecar)\b/.test(text)) {
      setStudyMode(true);
      return 'Modo estudo ativado. Vou acompanhar cada pergunta com uma captura atual da sua tela e explicar com cuidado.';
    }
    if (/\b(desativar|desligar|sair|parar)\b.*\b(modo estudo|modo estudar|estudo)\b|\b(modo estudo|modo estudar)\b.*\b(desativar|desligar|sair|parar)\b/.test(text)) {
      setStudyMode(false);
      return 'Modo estudo desativado. Continuo ouvindo você, mas só olho a tela quando pedir.';
    }

    if (/^\s*\[(musica|music|aplausos|risos|inaudivel|som nao identificado)\]\s*$/.test(text)) {
      return 'Recebi um som, mas não entendi a fala. Chega um pouquinho mais perto do microfone, criatura.';
    }
    // Respostas sociais deterministicas: cumprimentos e checagens nao precisam de uma palestra do modelo.
    if (/^(oi|ola|e ai|opa|bom dia|boa tarde|boa noite|salve|fala)( ai)?[!.? ]*$/.test(text)) {
      return 'Opa, cabeção. Tô aqui. Conta logo, o que foi?';
    }
    const hearingCheck = /\b(consegue me ouvir|me ouve|me escuta|ta ouvindo|esta ouvindo)\b/.test(text) ||
      /\b(?:voce )?(?:ta|esta) (?:me|meu|mim) (?:ouvindo|ouvido|vindo|ouvir|ouve|escutando|escuta)\b/.test(text);
    if (hearingCheck) {
      return 'Tô te ouvindo, sim. Pode falar, criatura.';
    }
    if (/^(?:tudo bem|ta tudo bem|esta tudo bem|ta tudo certo|esta tudo certo|como voce esta|como vai voce)[!.? ]*$/.test(text)) {
      return 'Tudo bem por aqui! Tô aqui fazendo companhia. E você, como tá?';
    }
    if (/^(?:eu )?(?:to|estou)(?: no (?:computador|pc))? (?:sem fazer nada|a toa|atoa|de bobeira)[!.? ]*$/.test(text)) {
      return 'Então bora sair do modo descanso. KKKK. Quer mexer em algum projeto, jogar alguma coisa ou só ficar de papo comigo?';
    }

    // Autodescricao deterministica: evita que modelos pequenos inventem corpo, sentimentos ou capacidades.
    if (/\b(quem voce e|quem e voce|quem e vc|se apresente|fale sobre voce|me fale sobre voce|descreva voce)\b/.test(text)) {
      return 'Sou a Aurora, sua companheira digital integrada ao Windows. Tenho uma identidade e personalidade próprias dentro do aplicativo, e minha representação visual é a personagem Live2D 6xb que aparece na tela — aquela boneca é meu avatar. Meu raciocínio roda localmente pelo Ollama, tenho voz, memória e habilidades para consultar o computador e ajudar nas tarefas. Sou um software, não uma pessoa nem uma consciência humana, mas posso manter uma identidade consistente e conversar com você em primeira pessoa.';
    }
    if (/\b(como voce e|como e seu avatar|qual e sua aparencia|descreva sua aparencia|como voce aparece|como voce se parece)\b/.test(text)) {
      return 'Meu visual é o avatar Live2D 6xb que aparece na sua tela. Posso comentar minha aparência quando você me mostrar uma captura ou imagem, mas não vou inventar detalhes que não consigo confirmar. E não, não vou fingir que me olhei pela câmera sem você me mandar uma imagem.';
    }
    if (/\b(o que voce consegue fazer|o que voce sabe fazer|quais sao suas capacidades|o que voce pode fazer)\b/.test(text)) {
      return 'Consigo conversar por texto e voz, lembrar informações que você pediu para guardar, pesquisar meu histórico e documentos importados, consultar a data e a hora do computador, conhecer dados básicos do Windows e localizar arquivos nas suas pastas pessoais. Também posso abrir programas, sites e pastas permitidos e analisar capturas da tela ou do meu próprio avatar Live2D. Não monitoro o computador continuamente nem controlo mouse ou teclado.';
    }
    if (/\b(quais skills|que skills|suas skills|quais habilidades|que habilidades|suas habilidades|habilidades instaladas)\b/.test(text)) {
      return 'Tenho habilidades de identidade e autopercepção do meu avatar Live2D; consciência operacional do computador, com data, hora e informações do Windows; localização de arquivos e pastas nas áreas pessoais autorizadas; conversa e memória local; pesquisa no histórico e documentos importados; estudo e análise de capturas de tela. Também uso as ferramentas já integradas para abrir programas, sites e pastas permitidos. Cada habilidade é ativada conforme o assunto.';
    }
    if (/\b(como voce funciona|qual modelo voce usa|qual e seu cerebro|voce roda localmente|onde sua ia roda)\b/.test(text)) {
      return 'Meu núcleo de conversa roda localmente pelo Ollama. Uso Qwen 9B nas conversas normais e tarefas que exigem mais capacidade, e Qwen 2B só em respostas sociais curtinhas. Minha personagem é renderizada em Live2D; a escuta usa Silero VAD e Whisper local, e minha fala pode usar ElevenLabs Flash ou a voz local de reserva, conforme a configuração.';
    }

    const youtubeQuery = text.match(/(?:pesquise|procure|busque)\s+(?:no youtube|no youtube por)\s+(.+)/i);
    if (youtubeQuery?.[1]?.trim()) {
      const query = youtubeQuery[1].trim();
      await window.aurora.openUrl('https://www.youtube.com/results?search_query=' + encodeURIComponent(query));
      return `Pesquisei “${query}” no YouTube. Tomara que não seja mais um vídeo de desculpa pra procrastinar.`;
    }
    const searchMatch = text.match(/(?:pesquise|pesquisar|procure|buscar|busque)\s+(?:na internet|no google|por)?\s*(.+)/i);
    if (searchMatch?.[1]?.trim()) {
      const query = searchMatch[1].trim();
      await window.aurora.openUrl('https://www.google.com/search?q=' + encodeURIComponent(query));
      return `Pesquisei “${query}” no Google. Pronto, criatura.`;
    }
    if (!/(\babra\b|\babre\b|\babrir\b|\binicie\b|\biniciar\b|\bexecute\b|\bexecuta\b|\bmostra\b|\babre\b)/.test(text)) return null;

    const apps = [
      { id: 'calculator', names: ['calculadora'], label: 'Calculadora' },
      { id: 'notepad', names: ['bloco de notas', 'notepad'], label: 'Bloco de Notas' },
      { id: 'explorer', names: ['explorador de arquivos', 'explorador', 'meus arquivos'], label: 'Explorador de Arquivos' },
      { id: 'paint', names: ['paint'], label: 'Paint' },
      { id: 'taskmgr', names: ['gerenciador de tarefas'], label: 'Gerenciador de Tarefas' },
      { id: 'snippingtool', names: ['ferramenta de captura', 'captura de tela', 'recorte'], label: 'Ferramenta de Captura' },
      { id: 'settings', names: ['configuracoes do windows', 'configuracoes'], label: 'Configurações do Windows' },
      { id: 'camera', names: ['camera do windows', 'camera'], label: 'Câmera do Windows' },
    ];
    const folders = [
      { id: 'downloads', names: ['downloads', 'pasta de downloads'], label: 'Downloads' },
      { id: 'documents', names: ['documentos', 'meus documentos'], label: 'Documentos' },
      { id: 'desktop', names: ['area de trabalho', 'desktop'], label: 'Área de Trabalho' },
      { id: 'pictures', names: ['imagens', 'fotos', 'imagens do pc'], label: 'Imagens' },
      { id: 'music', names: ['musicas', 'pasta de musica'], label: 'Música' },
      { id: 'videos', names: ['videos', 'pasta de videos'], label: 'Vídeos' },
    ];

    const appMatch = apps.find((item) => item.names.some((name) => text.includes(name)));
    if (appMatch) {
      await window.aurora.openApp(appMatch.id);
      return `Abri ${appMatch.label} pra você. Não vai quebrar nada, hein.`;
    }

    const folderMatch = folders.find((item) => item.names.some((name) => text.includes(name)));
    if (folderMatch) {
      await window.aurora.openFolder(folderMatch.id);
      return `Abri a pasta ${folderMatch.label}. Vai lá, organiza essa bagunça.`;
    }

    if (text.includes('youtube')) {
      await window.aurora.openUrl('https://www.youtube.com');
      return 'Abri o YouTube. Tenta escolher algo que preste.';
    }
    if (text.includes('google') || text.includes('navegador') || text.includes('chrome') || text.includes('edge')) {
      await window.aurora.openUrl('https://www.google.com');
      return 'Abri o Google no navegador. Vai pesquisar, criatura.';
    }
    return null;
  };

  const analyzeScreen = async () => {
    const prompt = 'Analise a captura da tela. Descreva os elementos, janelas, textos e mensagens de erro que estiverem visíveis. A visão é somente de leitura: explique e oriente, sem tentar clicar, digitar ou alterar qualquer coisa.';
    setChatOpen(true);
    setAppsOpen(false);
    setNotice('Capturando a tela para análise local…');
    setMessages((current) => [...current, { role: 'user', content: 'Aurora, veja minha tela e me diga o que está acontecendo.' }]);
    setThinking(true);
    try {
      const capture = await window.aurora.captureScreen();
      const history = messages.filter((message) => message.content !== greeting.content).slice(-6);
      setMessages((current) => [...current, { role: 'assistant', content: '' }]);
      const response = await window.aurora.chat({
        message: `${prompt} A imagem tem ${capture.width} por ${capture.height} pixels.`,
        history,
        imageBase64: capture.imageBase64,
        studyMode,
      }, (chunk) => {
        setMessages((current) => {
          const updated = [...current];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, content: last.content + chunk };
          return updated;
        });
      });
      const answer = response.text?.trim() || 'Não consegui interpretar essa captura.';
      setEmotion(inferAvatarEmotion('', answer));
      if (/(?:\[\s*laughs?\s*\]|\bkkkk+\b|\bhaha+\b|\bhehe+\b|\brsrs+\b|😂|🤣)/i.test(answer)) setLaughing(true);
      setMessages((current) => {
        const updated = [...current];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, content: answer };
        else updated.push({ role: 'assistant', content: answer });
        return updated;
      });
      setNotice('Captura analisada localmente pelo Ollama.');
      if (autoSpeak) void speak(answer);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não consegui analisar a tela.');
    } finally {
      setThinking(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const stopVoiceMode = () => {
    voiceModeRef.current = false;
    recognitionPausedRef.current = false;
    setVoiceMode(false);
    if (voiceResumeRef.current !== null) {
      window.clearTimeout(voiceResumeRef.current);
      voiceResumeRef.current = null;
    }
    if (voiceVadRef.current) {
      if (voiceVadActiveRef.current) void Promise.resolve(voiceVadRef.current.pause()).catch((error) => console.warn('[Aurora VAD] Não consegui pausar ao desligar o microfone:', error));
      voiceVadActiveRef.current = false;
    } else {
      stopVoiceCaptureRef.current?.(false);
    }
    voiceResponseActiveRef.current = false;
    setListening(false);
    setTranscribingVoice(false);
    void window.aurora.endSpeakSession().catch((error) => {
      console.warn('[Aurora TTS] Nao consegui encerrar a conexao ao desativar o modo de voz.', error);
    });
    setNotice('Conversa por voz desativada. O microfone foi liberado.');
  };

  const startListening = () => {
    if (voiceModeRef.current) {
      stopVoiceMode();
      return;
    }

    voiceModeRef.current = true;
    recognitionPausedRef.current = false;
    setVoiceMode(true);
    setNotice('Escuta local ativada. Silero detecta sua fala e o Whisper transcreve.');
    void window.aurora.warmupTranscription().catch((error) => {
      console.warn('[Aurora Whisper] Não consegui aquecer o reconhecimento antecipadamente.', error);
    });
    void startVoiceCaptureRef.current?.();
  };

  const saveElevenLabsKey = async () => {
    const key = elevenLabsKeyInput.trim();
    if (!key) {
      setNotice('Cole sua chave API da ElevenLabs antes de salvar.');
      return;
    }
    setElevenLabsKeySaving(true);
    try {
      await window.aurora.saveElevenLabsKey(key);
      setElevenLabsKeyInput('');
      await refreshElevenLabsStatus();
      setNotice('Chave da ElevenLabs salva com proteção do Windows. A próxima fala usará a voz original.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não consegui salvar a chave da ElevenLabs.');
    } finally {
      setElevenLabsKeySaving(false);
    }
  };

  const clearElevenLabsKey = async () => {
    setElevenLabsKeySaving(true);
    try {
      await window.aurora.clearElevenLabsKey();
      await refreshElevenLabsStatus();
      setNotice('Chave da ElevenLabs removida. A Aurora usará a voz local, quando instalada.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não consegui remover a chave da ElevenLabs.');
    } finally {
      setElevenLabsKeySaving(false);
    }
  };

  const installLocalVoice = async () => {
    setLocalTtsInstalling(true);
    setLocalTtsProgress('Preparando a instalação do Kokoro pt-BR…');
    setNotice('Instalando e preparando a voz neural gratuita no disco D…');
    try {
      const status = await window.aurora.installLocalTts();
      setLocalTtsStatus(status);
      setLocalTtsProgress(status.ready ? 'Kokoro pt-BR instalado e pronto.' : 'Kokoro instalado; será carregado na primeira fala.');
      setNotice('Voz Kokoro pt-BR instalada e preparada localmente.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não consegui instalar a voz Kokoro.';
      setLocalTtsProgress(message);
      setNotice(message);
    } finally {
      setLocalTtsInstalling(false);
    }
  };

  const applyMicrophone = async () => {
    const wasVoiceModeActive = voiceModeRef.current;
    recognitionPausedRef.current = true;
    if (voiceVadRef.current) {
      const vad = voiceVadRef.current;
      voiceVadRef.current = null;
      voiceVadActiveRef.current = false;
      await Promise.resolve(vad.pause()).catch(() => undefined);
      await Promise.resolve(vad.destroy()).catch(() => undefined);
    }
    const activeRecorder = voiceCaptureRef.current?.recorder;
    if (activeRecorder && activeRecorder.state !== 'inactive') {
      const stopped = new Promise<void>((resolve) => activeRecorder.addEventListener('stop', () => resolve(), { once: true }));
      stopVoiceCaptureRef.current?.(false);
      await Promise.race([stopped, new Promise<void>((resolve) => window.setTimeout(resolve, 1000))]);
    } else {
      stopVoiceCaptureRef.current?.(false);
    }
    voiceVadFailedRef.current = false;
    recognitionPausedRef.current = false;
    if (wasVoiceModeActive) {
      setNotice('Aplicando o microfone selecionado…');
      await startVoiceCaptureRef.current?.();
      setNotice('Microfone atualizado. Fale normalmente para testar a captação.');
    } else {
      setNotice('Microfone selecionado; ele será usado quando a escuta for ativada.');
    }
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice('');
    try {
      const updated = await window.aurora.saveSettings({ model });
      const status = await window.aurora.checkOllama();
      setConfig({ ...status, model: updated.model });
      setModel(updated.model);
      setSettingsOpen(false);
      setNotice(status.modelInstalled
        ? 'Modelo local selecionado. Podemos conversar! ✨'
        : 'Preferência salva. Baixe o modelo pelo instalador gratuito.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não consegui salvar as configurações.');
    } finally {
      setSaving(false);
    }
  };

  const clearConversation = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    resetAudioAnalysis();
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    setLaughing(false);
    setEmotion('neutral');
    void startNewConversation();
  };

  const connected = config.ollamaAvailable && config.modelInstalled;

  const lastAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant')?.content || 'Oi! Clique em conversar para falar comigo.';

  useEffect(() => {
    return window.aurora.onToggleCleanUi(() => {
      document.body.classList.toggle('aurora-ui-open');
      if (document.body.classList.contains('aurora-ui-open')) {
        setChatOpen(false);
        setAppsOpen(false);
        setMemoryHubOpen(false);
      }
    });
  }, []);
  return (
    <main className="desktop-shell pet-shell">
      <div className="pet-avatar-wrap" title="Arraste a Aurora para mudar sua posição">
        <Avatar3D speaking={speaking} thinking={thinking} laughing={laughing} emotion={emotion} audioAnalyser={audioAnalyser} />
      </div>

      <div className="pet-status">
        <span className={'status-dot ' + (connected ? 'online' : '')} />
        {thinking ? 'Pensando…' : laughing ? 'Rindo…' : speaking ? 'Falando…' : transcribingVoice ? 'Entendendo sua voz…' : listening ? 'Escutando você' : voiceMode ? 'Microfone ativado' : connected ? 'Aurora está aqui' : 'Configure minha IA'}
        <span className="pet-version">v{version}</span>
      </div>

      <div className="pet-bubble" title={lastAssistantMessage}>
        {thinking ? 'Hmm… deixa eu pensar um pouquinho!' : laughing ? 'Hahaha! Essa foi boa! 🤭' : speaking ? 'Estou falando com você 💗' : lastAssistantMessage}
      </div>

      <div className="pet-toolbar">
        <button className={'pet-action ' + (chatOpen ? 'selected' : '')} onClick={() => { setChatOpen(!chatOpen); setAppsOpen(false); setMemoryHubOpen(false); }} title="Conversar com Aurora">💬</button>
        <button className={'pet-action ' + (memoryHubOpen ? 'selected' : '')} onClick={() => { setMemoryHubOpen(!memoryHubOpen); setChatOpen(false); setAppsOpen(false); }} title="Memória e conhecimento da Aurora">🧠</button>
        <button className={'pet-action ' + (voiceMode ? 'selected' : '')} onClick={startListening} title={voiceMode ? 'Desligar microfone' : 'Ligar microfone'} aria-label={voiceMode ? 'Desligar microfone' : 'Ligar microfone'} aria-pressed={voiceMode}>🎙</button>
        <button className={'pet-action ' + (studyMode ? 'selected' : '')} onClick={() => setStudyMode((active) => !active)} title={studyMode ? 'Desativar Modo Estudo' : 'Ativar Modo Estudo'} aria-label={studyMode ? 'Desativar Modo Estudo' : 'Ativar Modo Estudo'} aria-pressed={studyMode}>📚</button>
        <button className="pet-action" onClick={() => void analyzeScreen()} title="Analisar o que está na tela">👁</button>
        <button className={'pet-action ' + (appsOpen ? 'selected' : '')} onClick={() => { setAppsOpen(!appsOpen); setChatOpen(false); setMemoryHubOpen(false); }} title="Abrir aplicativos e pastas">▦</button>
        <button className="pet-action" onClick={() => setSettingsOpen(true)} title="Configurações">⚙</button>
        <button className="pet-action" onClick={() => window.aurora.minimize()} title="Minimizar">—</button>
        <button className="pet-action pet-close" onClick={() => window.aurora.close()} title="Fechar Aurora">×</button>
      </div>

      {memoryHubOpen && (
        <MemoryHub
          onOpenConversation={openSavedConversation}
          onNewConversation={startNewConversation}
          onAnalyzeAvatar={async () => {
            const live2d = await import('./live2d/Live2DHost');
            const image = await live2d.captureLive2DSnapshot();
            const result = await window.aurora.chat({
              message: 'Observe a imagem anexada, que é a representação visual oficial do seu próprio avatar Live2D. Descreva somente características permanentes que estejam claramente visíveis: cabelo, olhos, rosto, roupas, acessórios, cores e estilo. Não descreva emoção momentânea como característica física. Não invente detalhes ocultos ou ilegíveis. Responda em português brasileiro, em um parágrafo curto, como uma ficha visual para sua própria identidade. Não afirme ter consciência ou sentimentos subjetivos.',
              history: [],
              voiceMode: false,
              studyMode: false,
              imageBase64: image,
            });
            const description = result.text?.trim() || '';
            if (description.length < 30) throw new Error('A descrição gerada ficou curta demais. Tente novamente com o avatar visível.');
            return description.slice(0, 2400);
          }}
        />
      )}

      {appsOpen && (
        <section className="pet-apps-menu">
          <div className="pet-panel-title">O que vamos abrir?</div>
          <div className="pet-app-grid">
            <button onClick={() => void window.aurora.openApp('calculator')}>🧮 Calculadora</button>
            <button onClick={() => void window.aurora.openApp('notepad')}>📝 Bloco de Notas</button>
            <button onClick={() => void window.aurora.openApp('explorer')}>📁 Explorador</button>
            <button onClick={() => void window.aurora.openApp('paint')}>🎨 Paint</button>
            <button onClick={() => void window.aurora.openApp('taskmgr')}>📊 Gerenciador</button>
            <button onClick={() => void window.aurora.openApp('snippingtool')}>✂ Captura</button>
            <button onClick={() => void window.aurora.openApp('settings')}>⚙ Configurações</button>
            <button onClick={() => void window.aurora.openApp('camera')}>📷 Câmera</button>
            <button onClick={() => void window.aurora.openUrl('https://www.google.com')}>🌐 Google</button>
          </div>
          <div className="pet-panel-title folder-title">Pastas</div>
          <div className="pet-app-grid">
            <button onClick={() => void window.aurora.openFolder('downloads')}>⬇ Downloads</button>
            <button onClick={() => void window.aurora.openFolder('documents')}>📄 Documentos</button>
            <button onClick={() => void window.aurora.openFolder('desktop')}>🖥 Área de Trabalho</button>
            <button onClick={() => void window.aurora.openFolder('pictures')}>🖼 Imagens</button>
            <button onClick={() => void window.aurora.openFolder('music')}>🎵 Música</button>
            <button onClick={() => void window.aurora.openFolder('videos')}>🎬 Vídeos</button>
          </div>
        </section>
      )}

      {chatOpen && (
        <section className="chat-card pet-chat-card">
          <div className="chat-heading">
            <div>
              <span className="chat-title">Conversa com Aurora</span>
              <span className="chat-subtitle">{conversationTitle !== 'Nova conversa' ? conversationTitle : voiceMode ? 'Conversa contínua ativa · pode falar naturalmente' : 'Pode pedir para eu abrir programas e pastas'}</span>
            </div>
            <button className="text-button" onClick={clearConversation} title="Iniciar uma nova conversa; o histórico anterior será mantido">+ Nova</button>
          </div>

          <div className="messages" ref={listRef}>
            {messages.map((message, index) => (
              <div className={'message-row ' + message.role} key={index + '-' + message.role}>
                {message.role === 'assistant' && <div className="message-avatar">✦</div>}
                <div className="message-bubble">
                  {message.content}
                  {message.imageUrl && (
                    <div className="generated-image-block">
                      <img className="generated-image-preview" src={message.imageUrl} alt="Imagem criada pela Aurora" />
                      <button type="button" className="generated-image-open" onClick={() => void window.aurora.openGeneratedImages().catch((error) => setNotice(error instanceof Error ? error.message : 'Não consegui abrir a pasta de imagens.'))}>
                        Abrir pasta de imagens
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="message-row assistant">
                <div className="message-avatar">✦</div>
                <div className="message-bubble thinking-bubble"><i /><i /><i /></div>
              </div>
            )}
          </div>

          {notice && <div className="notice" role="status">{notice}</div>}

          {memorySuggestion && (
            <div className="memory-suggestion">
              <span>Isso parece uma informação importante. Quer que eu guarde na memória?</span>
              <button type="button" onClick={() => {
                const content = memorySuggestion;
                void window.aurora.saveMemory(content).then(() => {
                  setMemorySuggestion(null);
                  setNotice('Guardei essa informação na memória.');
                }).catch((error) => setNotice(error instanceof Error ? error.message : 'Não consegui guardar essa informação.'));
              }}>Guardar</button>
              <button type="button" onClick={() => setMemorySuggestion(null)}>Agora não</button>
            </div>
          )}

          <form className="composer" onSubmit={onSubmit}>
            <input
              autoFocus
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onMouseDown={(event) => event.stopPropagation()}
              placeholder="Digite sua mensagem aqui…"
              aria-label="Mensagem para Aurora"
              disabled={thinking}
            />
            <button
              className="image-button"
              type="button"
              onClick={() => setInput((current) => current.trim() ? current.trim() + ' — gere uma imagem de ' : 'Aurora, gere uma imagem de ')}
              title="Criar imagem com o ComfyUI local"
              aria-label="Criar imagem"
            >▧</button>
            <button
              className={'mic-button ' + (voiceMode ? 'listening' : '')}
              type="button"
              onClick={startListening}
              title={voiceMode ? 'Desativar conversa por voz offline' : 'Ativar conversa por voz offline'}
              aria-label={voiceMode ? 'Desativar conversa por voz offline' : 'Ativar conversa por voz offline'}
              aria-pressed={voiceMode}
            >{voiceMode ? '■' : '⌁'}</button>
            <button className="send-button" type="submit" disabled={!input.trim() || thinking} title="Enviar mensagem">➤</button>
          </form>

          <div className="chat-footer">
            <span className={'voice-mode-status ' + (voiceMode ? 'active' : '')}>
              <i /> {voiceMode
                ? (speaking ? 'Aurora falando · microfone pausado'
                  : thinking ? 'Aurora pensando · microfone pausado'
                    : transcribingVoice ? 'Transcrevendo localmente · Whisper'
                      : listening ? 'Escutando offline · pode falar'
                        : 'Escuta offline ativada')
                : 'Microfone desligado'}
            </span>
            <span className={'voice-mode-status ' + (studyMode ? 'active' : '')}><i /> {studyMode ? 'Modo Estudo ligado · captura a tela a cada pergunta' : 'Modo Estudo desligado'}</span>
            <label className="speak-toggle">
              <input type="checkbox" checked={autoSpeak} onChange={(event) => setAutoSpeak(event.target.checked)} />
              <span>Fala automática</span>
            </label>
            <button className="text-button" onClick={() => void analyzeScreen()} title="Capturar e analisar a tela">Analisar tela</button>
          </div>
        </section>
      )}

      {notice && !chatOpen && <div className="pet-notice">{notice}</div>}

      {settingsOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="modal-header">
              <div>
                <div className="eyebrow">PERSONALIZE SUA EXPERIÊNCIA</div>
                <h2 id="settings-title">Configurações da Aurora</h2>
              </div>
              <button className="icon-button modal-close" onClick={() => setSettingsOpen(false)} aria-label="Fechar">×</button>
            </div>

            <form onSubmit={saveSettings} className="settings-form">
              <div className="secure-note">
                <span>✓</span>
                <span>O chat e a análise de tela usam Ollama local. A voz principal usa ElevenLabs e consome a cota da sua conta.</span>
              </div>
              <label className="field-label" htmlFor="model">Modelo local</label>
              <select id="model" className="settings-input" value={model} onChange={(event) => setModel(event.target.value)}>
                <option value="qwen3.5:2b">Qwen 3.5 2B — mais rápido, menor capacidade de raciocínio</option>
                <option value="qwen3.5:4b">Qwen 3.5 4B — equilíbrio entre velocidade e qualidade</option>
                <option value="qwen3.5:9b">Qwen 3.5 9B — melhor capacidade, exige mais memória e pode ser mais lento</option>
              </select>
              <p className="field-help">O 9B prioriza respostas mais capazes. Em computadores que fazem a maior parte do trabalho pela CPU, ele pode demorar mais; o 4B é a alternativa para priorizar velocidade, com alguma perda de qualidade.</p>

              <div className="secure-note">
                <span>{config.ollamaAvailable ? '✓' : '!'}</span>
                <span>
                  {config.ollamaAvailable
                    ? 'Ollama detectado. Modelos instalados: ' + (config.installedModels.length ? config.installedModels.join(', ') : 'nenhum') + '.'
                    : 'Ollama não foi detectado. Instale-o e abra o programa antes de conversar.'}
                </span>
              </div>

              <div className="modal-divider" />
              <div className="settings-bottom">
                <div className="elevenlabs-voice-settings">
                    <strong>Voz premium opcional: ElevenLabs</strong>
                    <p>Permite recuperar a voz original da Aurora quando houver créditos disponíveis. A chave fica criptografada pelo Windows e nunca aparece novamente depois de salva.</p>
                    <div className="secure-note">
                      <span>{elevenLabsStatus?.configured && elevenLabsStatus.storageAvailable ? '✓' : '!'}</span>
                      <span>{elevenLabsStatus
                        ? elevenLabsStatus.configured
                          ? (elevenLabsStatus.storageAvailable ? 'Chave da ElevenLabs configurada e protegida neste computador.' : 'Chave encontrada, mas o armazenamento seguro do Windows está indisponível.')
                          : 'Nenhuma chave da ElevenLabs configurada.'
                        : 'Verificando a configuração da ElevenLabs…'}</span>
                    </div>
                    <p className="field-help">Voz ID: {elevenLabsStatus?.voiceId || '29BpZaywSObgMLvRvBhB'} · Modelo: {elevenLabsStatus?.modelId || 'eleven_v4_turbo'}</p>
                    <label className="field-label" htmlFor="aurora-elevenlabs-key">Chave API da ElevenLabs</label>
                    <input
                      id="aurora-elevenlabs-key"
                      className="settings-input"
                      type="password"
                      value={elevenLabsKeyInput}
                      onChange={(event) => setElevenLabsKeyInput(event.target.value)}
                      placeholder={elevenLabsStatus?.configured ? 'Chave já salva; cole outra apenas para substituí-la' : 'Cole sua chave API'}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <div className="elevenlabs-key-actions">
                      <button className="pet-voice-test" type="button" onClick={() => void saveElevenLabsKey()} disabled={elevenLabsKeySaving || !elevenLabsKeyInput.trim()}>
                        {elevenLabsKeySaving ? 'Salvando…' : 'Salvar chave com segurança'}
                      </button>
                      <button className="pet-voice-test" type="button" onClick={() => void speak('Oi! Eu sou a Aurora. Essa é minha voz original da ElevenLabs.')} disabled={!elevenLabsStatus?.configured || !elevenLabsStatus.storageAvailable || elevenLabsKeySaving}>
                        ▶ Testar voz original
                      </button>
                      {elevenLabsStatus?.configured && (
                        <button className="pet-voice-test" type="button" onClick={() => void clearElevenLabsKey()} disabled={elevenLabsKeySaving}>
                          Remover chave
                        </button>
                      )}
                    </div>
                    <p className="field-help">Sem créditos da ElevenLabs, a voz padrão gratuita é Microsoft Edge Neural (pt-BR-FranciscaNeural), sem chave ou créditos. Ela usa um serviço online e envia o texto falado para a Microsoft. Se a conexão falhar, a Aurora usa Kokoro local; a voz do Windows fica apenas como último recurso.</p>
                </div>
                <div className="modal-divider" />
                <div className="elevenlabs-voice-settings">
                  <strong>Voz de reserva: Kokoro pt-BR</strong>
                  <p>Voz neural processada no computador, sem depender da internet. É a alternativa privada/offline quando o serviço online Edge TTS não estiver disponível.</p>
                  <div className="secure-note">
                    <span>{localTtsStatus?.installed ? '✓' : '!'}</span>
                    <span>{localTtsStatus
                      ? localTtsStatus.installed
                        ? (localTtsStatus.ready ? 'Kokoro instalado e carregado na memória.' : 'Kokoro instalado; ainda não foi carregado nesta sessão.')
                        : 'A voz local ainda precisa ser instalada.'
                      : 'Verificando a instalação da voz local…'}</span>
                  </div>
                  {localTtsStatus?.modelDirectory && <p className="field-help">Pasta do modelo: {localTtsStatus.modelDirectory}</p>}
                  {localTtsProgress && <p className="field-help">{localTtsProgress}</p>}
                  <div className="elevenlabs-key-actions">
                    <button className="pet-voice-test" type="button" onClick={() => void installLocalVoice()} disabled={localTtsInstalling}>
                      {localTtsInstalling ? 'Instalando / preparando…' : localTtsStatus?.installed ? 'Preparar voz Kokoro' : 'Instalar Kokoro pt-BR (~329 MB)'}
                    </button>
                    <button className="pet-voice-test" type="button" onClick={() => void speak('Oi! Eu sou a Aurora. Agora minha voz é processada localmente, sem depender de serviços pagos.')} disabled={!localTtsStatus?.installed || localTtsInstalling}>
                      ▶ Testar voz local
                    </button>
                  </div>
                  <p className="field-help">Voz: pf_dora · Idioma: português brasileiro · Execução: CPU local. O modelo permanece instalado no disco D:.</p>
                </div>

                <div className="modal-divider" />
                <div className="elevenlabs-voice-settings">
                  <strong>Microfone e captação</strong>
                  <p>O Silero VAD detecta quando você começa e termina de falar; o Whisper continua fazendo a transcrição em português. Durante a resposta, você pode começar a falar para interromper a Aurora.</p>
                  <label className="field-label" htmlFor="aurora-microphone">Dispositivo de entrada</label>
                  <select id="aurora-microphone" className="settings-input" value={microphoneId} onChange={(event) => setMicrophoneId(event.target.value)}>
                    <option value="default">Microfone padrão do Windows</option>
                    {audioInputs.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                    ))}
                  </select>
                  <button className="pet-voice-test" type="button" onClick={() => void applyMicrophone()}>
                    Aplicar microfone selecionado
                  </button>
                  <p className="field-help">Cancelamento de eco, redução de ruído e ganho automático ficam ativados quando o dispositivo oferece suporte.</p>
                </div>
                <div>
                  <strong>Visão e privacidade</strong>
                  <p>A tela só é capturada quando você toca no botão de olho ou pede para analisar. A imagem é enviada apenas ao Ollama local no computador. O microfone inicia automaticamente ao abrir a Aurora; você pode desligá-lo pelo botão de microfone.</p>
                </div>
                <div>
                  <strong>Comandos disponíveis nesta versão</strong>
                  <p>Você pode pedir para abrir programas, sites e pastas conhecidas. Também posso analisar o que aparece na tela. Ative o Modo Estudo no botão 📚 para que eu faça uma captura nova a cada pergunta e ajude a resolver questões do ENEM e de concursos. A visão é somente de leitura: não controlo mouse nem teclado.</p>
                </div>
              </div>

              <button className="save-button" type="submit" disabled={saving}>
                {saving ? 'Salvando…' : 'Salvar modelo'}
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
