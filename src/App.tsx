import { FormEvent, useEffect, useRef, useState } from 'react';
import Avatar3D from './components/Avatar3D';

type Message = { role: 'user' | 'assistant'; content: string };

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

function hasLaughingCue(text: string): boolean {
  return /(?:\b(?:kkkk+|haha+|hehe+|rsrs+)\b|\u{1F602}|\u{1F923}|\u{1F606}|\u{1F639}|\u{1F63A})/iu.test(text);
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
  const voiceModeRef = useRef(false);
  const thinkingRef = useRef(false);
  const sendMessageRef = useRef<(rawText: string) => Promise<void>>(async () => undefined);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [elevenLabsConfigured, setElevenLabsConfigured] = useState(false);
  const [elevenLabsStorageAvailable, setElevenLabsStorageAvailable] = useState(false);
  const [elevenLabsKeyInput, setElevenLabsKeyInput] = useState('');
  const [elevenLabsSaving, setElevenLabsSaving] = useState(false);
  useEffect(() => {
    window.aurora.getElevenLabsStatus()
      .then((status) => {
        setElevenLabsConfigured(status.configured);
        setElevenLabsStorageAvailable(status.storageAvailable);
      })
      .catch(() => {
        setElevenLabsConfigured(false);
        setElevenLabsStorageAvailable(false);
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
    stopVoiceCaptureRef.current?.(false);
    setListening(false);
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

  useEffect(() => {
    if (!laughing) return;
    const timeout = window.setTimeout(() => setLaughing(false), 2600);
    return () => window.clearTimeout(timeout);
  }, [laughing]);

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
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      stopVoiceMode();
      setNotice('Este ambiente do Electron nao oferece captura de audio. Atualize o aplicativo e verifique a permissao de microfone.');
      return;
    }

    let pendingStream: MediaStream | null = null;
    let pendingAudioContext: AudioContext | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 48000 },
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
        },
      });

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

            setNotice('Transcrevendo no proprio computador…');
            const result = await window.aurora.transcribeAudio(pcm16k);
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

          if (session.speechDetected && rms < session.speechThresholdRms * 0.68 && now - session.lastSpeechAt >= 950) {
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
    pauseVoiceRecognitionForSpeech();
    if (hasLaughingCue(text)) setLaughing(true);
    audioRef.current?.pause();
    audioRef.current = null;
    resetAudioAnalysis();
    window.speechSynthesis?.cancel();
    setSpeaking(true);

    let finishPlayback!: () => void;
    const playbackFinished = new Promise<void>((resolve) => { finishPlayback = resolve; });

    try {
      const result = await window.aurora.speak(text);
      if (!result?.audioBase64) throw new Error('A voz neural nao retornou audio.');
      if (result.provider === 'edge' && result.fallbackReason) {
        setNotice('ElevenLabs indisponivel: ' + result.fallbackReason.slice(0, 150) + '. Usando Edge TTS temporariamente.');
      } else if (result.provider === 'elevenlabs') {
        setNotice('');
      }

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
      if (waitForPlayback) await playbackFinished;
    } catch (error) {
      // Cancela qualquer retomada agendada antes de iniciar a voz de reserva.
      pauseVoiceRecognitionForSpeech();
      audioRef.current?.pause();
      audioRef.current = null;
      resetAudioAnalysis();

      // Fallback local: mantém a Aurora falando mesmo quando o serviço neural falha.
      try {
        if (!('speechSynthesis' in window)) throw error;
        const synth = window.speechSynthesis;
        const utterance = new SpeechSynthesisUtterance(text);
        const voices = synth.getVoices();
        const portugueseVoice = voices.find((voice) => /^pt-BR$/i.test(voice.lang))
          || voices.find((voice) => /^pt(-|_)/i.test(voice.lang));
        utterance.lang = 'pt-BR';
        if (portugueseVoice) utterance.voice = portugueseVoice;
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

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || thinkingRef.current) return;

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
    setMessages((current) => [...current, { role: 'user', content: text }]);
    setInput('');
    setThinking(true);

    try {
      const quickReply = await runQuickCommand(text);
      if (quickReply) {
        setEmotion(inferAvatarEmotion(text, quickReply));
        if (hasLaughingCue(text + " " + quickReply)) setLaughing(true);
        setMessages((current) => [...current, { role: 'assistant', content: quickReply }]);
        if (autoSpeak) void speak(quickReply);
        return;
      }

      const normalizedScreenRequest = text.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const asksForScreenAnalysis =
        /\b(analise|analisar|olha|olhe|olhar|veja|ver|observe|observar|descreva|descrever|mostre|mostrar)\b/.test(normalizedScreenRequest) &&
        /\b(tela|janela|aplicativo|programa|erro|mensagem|desktop|questao|questoes|alternativa|enunciado|exercicio|exercicios)\b/.test(normalizedScreenRequest) ||
        /\b(o que esta aparecendo|o que aparece na tela|o que tem na tela|minha tela|nessa janela|esse erro|essa questao|qual alternativa|qual a resposta|me explica isso|resolve essa)\b/.test(normalizedScreenRequest);
      // No Modo Estudo, cada pergunta recebe uma captura nova; o modelo não analisa vídeo em loop.
      const capture = (studyMode || asksForScreenAnalysis) ? await window.aurora.captureScreen() : null;
      const studyPrompt = studyMode
        ? 'MODO ESTUDO ENEM/CONCURSOS: aja como professor particular rigoroso e didático. Leia cuidadosamente a captura antes de responder. Primeiro identifique o que está escrito no enunciado e nas alternativas; nunca complete palavras ou números ilegíveis por adivinhação. Se uma parte essencial estiver pequena, cortada ou ambígua, diga exatamente o que não conseguiu ler e peça uma captura aproximada em vez de chutar. Identifique matéria e assunto. Em questão objetiva, indique a alternativa correta somente quando houver evidência suficiente, explique o raciocínio passo a passo e por que as alternativas mais plausíveis estão erradas. Confira cálculos, sinais, unidades, datas e conceitos antes de concluir. Diferencie fatos, interpretações e hipóteses. Nunca invente fonte, artigo de lei, número, autor, dado ou regra de edital. Para legislação, atualidades e regras de concurso que possam mudar, avise quando for necessária conferência em fonte oficial atualizada. Ensine o conceito por trás da questão com linguagem clara e um exemplo curto quando ajudar. Seja completa sem enrolar; faça uma pergunta de checagem apenas quando for útil para confirmar meu aprendizado.'
        : '';
      const computerPrompt = capture
        ? `${text}\n\nEstou fornecendo uma captura atual do desktop. Analise somente o que estiver visível e explique o que aparece. A visão é somente de leitura: não proponha cliques, movimentos de mouse, digitação, atalhos ou blocos de ação. Se algo estiver ilegível, diga isso com clareza. ${studyPrompt}`
        : text;
      const canStreamSpeech = autoSpeak && !capture;
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
        const cleanSegment = segment.trim();
        if (!cleanSegment) return;
        speechStarted = true;
        speechQueue = speechQueue
          .then(async () => {
            await speechSessionPromise;
            await speak(cleanSegment, true, false);
          })
          .catch((error) => {
            setNotice(error instanceof Error ? error.message : 'Não consegui reproduzir um trecho da resposta.');
          });
      };
      const collectCompleteSpeech = (chunk: string) => {
        speechBuffer += chunk;
        const boundary = /[.!?…]+\s+/g;
        let cursor = 0;
        let match: RegExpExecArray | null;
        while ((match = boundary.exec(speechBuffer)) !== null) {
          const end = match.index + match[0].length;
          const candidate = speechBuffer.slice(cursor, end).trim();
          const wordCount = candidate.split(/\s+/).filter(Boolean).length;
          if (candidate.length >= 18 || wordCount >= 5) {
            enqueueSpeech(candidate);
            cursor = end;
          }
        }
        if (cursor > 0) speechBuffer = speechBuffer.slice(cursor);
      };

      setMessages((current) => [...current, { role: 'assistant', content: '' }]);
      const response = await window.aurora.chat({ message: computerPrompt, history, voiceMode: voiceModeRef.current, studyMode, ...(capture ? { imageBase64: capture.imageBase64 } : {}) }, (chunk) => {
        setMessages((current) => {
          const updated = [...current];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, content: last.content + chunk };
          return updated;
        });
        // A voz começa quando chega uma frase completa, sem esperar o restante da resposta do LLM.
        if (canStreamSpeech) collectCompleteSpeech(chunk);
      });
      let answer = response.text?.trim() || 'Não consegui responder agora.';
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
          if (voiceModeRef.current) resumeVoiceRecognitionAfterSpeech(400);
        } else {
          void speak(answer);
        }
      }
    } catch (error) {
      if (closeSpeechSession) await closeSpeechSession();
      setNotice(error instanceof Error ? error.message : 'Ocorreu um erro ao conversar com a IA.');
      if (voiceModeRef.current && recognitionPausedRef.current) {
        resumeVoiceRecognitionAfterSpeech(500);
      }
    } finally {
      if (closeSpeechSession) await closeSpeechSession();
      thinkingRef.current = false;
      setThinking(false);
      if (!autoSpeak && voiceModeRef.current && recognitionPausedRef.current) {
        resumeVoiceRecognitionAfterSpeech(500);
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
    if (/\b(ta me ouvindo|esta me ouvindo|consegue me ouvir|ta ouvindo|me ouve)\b/.test(text)) {
      return 'Tô te ouvindo, sim. Pode falar, criatura.';
    }

    // Autodescricao deterministica: evita que modelos pequenos inventem corpo, sentimentos ou capacidades.
    if (/\b(quem voce e|quem e voce|quem e vc|se apresente|fale sobre voce|me fale sobre voce|descreva voce)\b/.test(text)) {
      return 'Sou a Aurora, sua parceira de call. Meu jeito é mandão, debochado e implicante, mas eu te ajudo de verdade. Meu visual na tela é o avatar Live2D 6xb. Meu cérebro roda localmente pelo Ollama; o modelo padrão é o Qwen 3.5 9B. Tenho voz, escuto quando o microfone está ativo, abro programas e pastas permitidos, analiso sua tela e posso estudar com você no Modo Estudo.';
    }
    if (/\b(como voce e|como e seu avatar|qual e sua aparencia|descreva sua aparencia|como voce aparece|como voce se parece)\b/.test(text)) {
      return 'Meu visual é o avatar Live2D 6xb que aparece na sua tela. Posso comentar minha aparência quando você me mostrar uma captura ou imagem, mas não vou inventar detalhes que não consigo confirmar. E não, não vou fingir que me olhei pela câmera sem você me mandar uma imagem.';
    }
    if (/\b(o que voce consegue fazer|o que voce sabe fazer|quais sao suas capacidades|o que voce pode fazer)\b/.test(text)) {
      return 'Consigo conversar por voz, abrir programas e pastas conhecidos, acessar sites e analisar sua tela. No Modo Estudo, leio uma captura nova a cada pergunta e explico questões do ENEM e de concursos. Minha visão é somente de leitura: não controlo mouse nem teclado.';
    }
    if (/\b(como voce funciona|qual modelo voce usa|qual e seu cerebro|voce roda localmente|onde sua ia roda)\b/.test(text)) {
      return 'Meu cérebro roda pelo Ollama no seu computador, e o padrão do projeto agora é Qwen 3.5 9B. O 6xb é meu avatar, não meu cérebro. Minha voz usa ElevenLabs quando está configurada, com alternativas do Edge TTS e do Windows. A transcrição do microfone é feita localmente pelo Whisper.';
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
    stopVoiceCaptureRef.current?.(false);
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
    setNotice('Escuta offline ativada. Fale naturalmente; o Whisper encerra sua frase apos uma pausa.');
    void window.aurora.warmupTranscription().catch((error) => {
      console.warn('[Aurora Whisper] Nao consegui aquecer o reconhecimento antecipadamente.', error);
    });
    void startVoiceCaptureRef.current?.();
  };

  const saveElevenLabsKey = async () => {
    const key = elevenLabsKeyInput.trim();
    if (!key) {
      setNotice('Cole sua chave API da ElevenLabs antes de salvar.');
      return;
    }
    setElevenLabsSaving(true);
    setNotice('');
    try {
      const result = await window.aurora.saveElevenLabsKey(key);
      setElevenLabsConfigured(result.configured);
      setElevenLabsKeyInput('');
      setNotice('Chave da ElevenLabs salva com criptografia protegida pelo Windows.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nao consegui salvar a chave da ElevenLabs.');
    } finally {
      setElevenLabsSaving(false);
    }
  };

  const removeElevenLabsKey = async () => {
    setElevenLabsSaving(true);
    setNotice('');
    try {
      await window.aurora.clearElevenLabsKey();
      setElevenLabsConfigured(false);
      setElevenLabsKeyInput('');
      setNotice('Chave da ElevenLabs removida. A Aurora usara a voz de reserva.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nao consegui remover a chave da ElevenLabs.');
    } finally {
      setElevenLabsSaving(false);
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
    setMessages([greeting]);
    setNotice('Conversa limpa. Podemos começar de novo!');
  };

  const connected = config.ollamaAvailable && config.modelInstalled;

  const lastAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant')?.content || 'Oi! Clique em conversar para falar comigo.';

  useEffect(() => {
    return window.aurora.onToggleCleanUi(() => {
      document.body.classList.toggle('aurora-ui-open');
      if (document.body.classList.contains('aurora-ui-open')) {
        setChatOpen(false);
        setAppsOpen(false);
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
        <button className={'pet-action ' + (chatOpen ? 'selected' : '')} onClick={() => { setChatOpen(!chatOpen); setAppsOpen(false); }} title="Conversar com Aurora">💬</button>
        <button className={'pet-action ' + (voiceMode ? 'selected' : '')} onClick={startListening} title={voiceMode ? 'Desligar microfone' : 'Ligar microfone'} aria-label={voiceMode ? 'Desligar microfone' : 'Ligar microfone'} aria-pressed={voiceMode}>🎙</button>
        <button className={'pet-action ' + (studyMode ? 'selected' : '')} onClick={() => setStudyMode((active) => !active)} title={studyMode ? 'Desativar Modo Estudo' : 'Ativar Modo Estudo'} aria-label={studyMode ? 'Desativar Modo Estudo' : 'Ativar Modo Estudo'} aria-pressed={studyMode}>📚</button>
        <button className="pet-action" onClick={() => void analyzeScreen()} title="Analisar o que está na tela">👁</button>
        <button className={'pet-action ' + (appsOpen ? 'selected' : '')} onClick={() => { setAppsOpen(!appsOpen); setChatOpen(false); }} title="Abrir aplicativos e pastas">▦</button>
        <button className="pet-action" onClick={() => setSettingsOpen(true)} title="Configurações">⚙</button>
        <button className="pet-action" onClick={() => window.aurora.minimize()} title="Minimizar">—</button>
        <button className="pet-action pet-close" onClick={() => window.aurora.close()} title="Fechar Aurora">×</button>
      </div>

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
              <span className="chat-subtitle">{voiceMode ? 'Conversa contínua ativa · pode falar naturalmente' : 'Pode pedir para eu abrir programas e pastas'}</span>
            </div>
            <button className="text-button" onClick={clearConversation} title="Limpar conversa">Limpar</button>
          </div>

          <div className="messages" ref={listRef}>
            {messages.map((message, index) => (
              <div className={'message-row ' + message.role} key={index + '-' + message.role}>
                {message.role === 'assistant' && <div className="message-avatar">✦</div>}
                <div className="message-bubble">{message.content}</div>
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
                <span>Sem API paga: o chat e a análise de tela usam o Ollama local no computador.</span>
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
                  <strong>Voz ElevenLabs da Aurora</strong>
                  <p>Vamos usar a voz que voce testou no laboratorio NOVAAURORA. A sintese usa sua conta ElevenLabs e pode consumir os creditos do seu plano.</p>
                  <div className="secure-note">
                    <span>{elevenLabsConfigured ? 'âœ“' : '!'}</span>
                    <span>{elevenLabsConfigured ? 'Chave cadastrada e armazenada de forma criptografada pelo Windows.' : 'Nenhuma chave ElevenLabs cadastrada. A voz atual de reserva continua disponivel.'}</span>
                  </div>
                  {!elevenLabsStorageAvailable && <p className="field-help">O armazenamento seguro ainda nao esta disponivel. Feche e abra a Aurora novamente antes de salvar a chave.</p>}
                  <label className="field-label" htmlFor="elevenlabs-api-key">Chave API da ElevenLabs</label>
                  <input
                    id="elevenlabs-api-key"
                    className="settings-input"
                    type="password"
                    value={elevenLabsKeyInput}
                    onChange={(event) => setElevenLabsKeyInput(event.target.value)}
                    placeholder={elevenLabsConfigured ? 'Chave ja cadastrada â€” cole outra para substituir' : 'Cole sua xi-api-key aqui'}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <div className="elevenlabs-key-actions">
                    <button className="pet-voice-test" type="button" onClick={() => void saveElevenLabsKey()} disabled={elevenLabsSaving || !elevenLabsStorageAvailable || !elevenLabsKeyInput.trim()}>
                      {elevenLabsSaving ? 'Salvando...' : 'Salvar chave protegida'}
                    </button>
                    {elevenLabsConfigured && <button className="text-button" type="button" onClick={() => void removeElevenLabsKey()} disabled={elevenLabsSaving}>Remover chave</button>}
                  </div>
                  <button className="pet-voice-test" type="button" onClick={() => void speak('Oii! Eu sou a Aurora! Hehehe! Vai demorar muito para me dar uma missao? Estou ficando entediada!')} disabled={!elevenLabsConfigured}>
                    â–¶ Testar voz ElevenLabs
                  </button>
                  <p className="field-help">Voz: 29BpZaywSObgMLvRvBhB Â· Modelo: eleven_v4_turbo. A chave nao e exibida novamente, nao vai para o React storage e nao deve ser enviada pelo chat.</p>
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
