import { FormEvent, useEffect, useRef, useState } from 'react';
import Avatar3D from './components/Avatar3D';

type Message = { role: 'user' | 'assistant'; content: string };
type PendingAction =
  | { type: 'click'; x: number; y: number; imageWidth: number; imageHeight: number }
  | { type: 'scroll'; x: number; y: number; delta: number; imageWidth: number; imageHeight: number }
  | { type: 'type'; text: string }
  | { type: 'key'; key: string };
type AppConfig = {
  ollamaAvailable: boolean;
  installedModels: string[];
  modelInstalled: boolean;
  model: string;
};

const greeting: Message = {
  role: 'assistant',
  content: 'Oi! Eu sou a Aurora. ✨ Minha inteligência roda no seu próprio computador, sem assinatura nem API paga. Instale o Ollama e baixe meu modelo local para conversarmos.',
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
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionRunning, setActionRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [laughing, setLaughing] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [notice, setNotice] = useState('');
  const [version, setVersion] = useState('0.4.0');
  const listRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const recognitionRestartRef = useRef<number | null>(null);
  const voiceModeRef = useRef(false);
  const thinkingRef = useRef(false);
  const pendingVoiceRef = useRef<string[]>([]);
  const sendMessageRef = useRef<(rawText: string) => Promise<void>>(async () => undefined);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  thinkingRef.current = thinking;

  useEffect(() => {
    window.aurora.getConfig()
      .then((data) => {
        setConfig(data);
        setModel(data.model);
      })
      .catch(() => setNotice('Não consegui carregar as configurações.'));
    window.aurora.version().then(setVersion).catch(() => undefined);

    return () => {
      voiceModeRef.current = false;
      if (recognitionRestartRef.current !== null) {
        window.clearTimeout(recognitionRestartRef.current);
        recognitionRestartRef.current = null;
      }
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
      recognitionRef.current?.abort?.();
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

  const speak = async (text: string) => {
    if (/(?:\bkkkk+\b|\bhaha+\b|\bhehe+\b|\brsrs+\b|😂|🤣)/i.test(text)) setLaughing(true);
    audioRef.current?.pause();
    audioRef.current = null;
    window.speechSynthesis?.cancel();
    setSpeaking(true);

    try {
      const result = await window.aurora.speak(text);
      if (!result?.audioBase64) throw new Error('A voz neural não retornou áudio.');

      const audio = new Audio('data:audio/mpeg;base64,' + result.audioBase64);
      audioRef.current = audio;
      audio.onended = () => {
        setSpeaking(false);
        audioRef.current = null;
      };
      audio.onerror = () => {
        setSpeaking(false);
        audioRef.current = null;
        setNotice('O áudio neural não pôde ser reproduzido.');
      };
      await audio.play();
    } catch (error) {
      audioRef.current?.pause();
      audioRef.current = null;

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
        utterance.onend = () => setSpeaking(false);
        utterance.onerror = () => setSpeaking(false);
        setNotice('A voz neural está indisponível. Estou usando temporariamente a voz instalada no Windows.');
        synth.cancel();
        synth.speak(utterance);
      } catch (fallbackError) {
        setSpeaking(false);
        const neuralDetail = error instanceof Error ? error.message : String(error);
        const fallbackDetail = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        setNotice('Não consegui gerar áudio. Voz neural: ' + neuralDetail.slice(0, 150) + '. Voz do Windows: ' + fallbackDetail.slice(0, 100));
      }
    }
  };

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || thinkingRef.current) return;

    thinkingRef.current = true;
    setNotice('');
    audioRef.current?.pause();
    audioRef.current = null;
    window.speechSynthesis?.cancel();
    setSpeaking(false);

    const history = messages
      .filter((message) => message.content !== greeting.content)
      .slice(-6);

    setMessages((current) => [...current, { role: 'user', content: text }]);
    setInput('');
    setThinking(true);

    try {
      const quickReply = await runQuickCommand(text);
      if (quickReply) {
        setMessages((current) => [...current, { role: 'assistant', content: quickReply }]);
        if (autoSpeak) void speak(quickReply);
        return;
      }

      const asksForComputerAction = /\b(clique|clica|digite|escreva|pressione|aperte|selecione|marque|preencha|role|rolar|pagine|desça|suba|scroll|copie|cole|analise|analisa|olhe|olha|veja|observe|resolva|arrume|configure|configurar|explique|identifique|ajuda|ajude|corrija|conserte|feche|fechar|print|captura)\b/i.test(text);
      const capture = asksForComputerAction ? await window.aurora.captureScreen() : null;
      const computerPrompt = capture
        ? `${text}\n\nEstou fornecendo uma captura atual do desktop. Analise-a e, se puder cumprir exatamente o pedido, retorne um único bloco [AURORA_ACTION]{JSON}[/AURORA_ACTION] com coordenadas relativas à imagem ou texto/atalho solicitado. Tipos aceitos: click com x/y, scroll com x/y/delta (-1200 a 1200; positivo desce, negativo sobe), type com text, key com key. Use apenas uma ação por vez. Se não conseguir identificar o alvo com clareza, não sugira ação.`
        : text;

      setMessages((current) => [...current, { role: 'assistant', content: '' }]);
      const response = await window.aurora.chat({ message: computerPrompt, history, ...(capture ? { imageBase64: capture.imageBase64 } : {}) }, (chunk) => {
        setMessages((current) => {
          const updated = [...current];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, content: last.content + chunk };
          return updated;
        });
      });
      let answer = response.text?.trim() || 'Não consegui responder agora.';
      if (/(?:\bkkkk+\b|\bhaha+\b|\bhehe+\b|\brsrs+\b|😂|🤣)/i.test(text + ' ' + answer)) setLaughing(true);
      const actionMatch = answer.match(/\[AURORA_ACTION\]\s*(\{[\s\S]*?\})\s*\[\/AURORA_ACTION\]/i);
      if (actionMatch) {
        try {
          const candidate = JSON.parse(actionMatch[1]);
          let safeAction: PendingAction | null = null;
          if (candidate?.type === 'click' && capture &&
              Number.isFinite(candidate.x) && Number.isFinite(candidate.y) &&
              candidate.x >= 0 && candidate.y >= 0 &&
              candidate.x < capture.width && candidate.y < capture.height) {
            safeAction = { type: 'click', x: Math.round(candidate.x), y: Math.round(candidate.y), imageWidth: capture.width, imageHeight: capture.height };
          } else if (candidate?.type === 'scroll' && capture &&
              Number.isFinite(candidate.x) && Number.isFinite(candidate.y) && Number.isFinite(candidate.delta) &&
              candidate.x >= 0 && candidate.y >= 0 && candidate.x < capture.width && candidate.y < capture.height &&
              candidate.delta !== 0 && Math.abs(candidate.delta) <= 1200) {
            safeAction = { type: 'scroll', x: Math.round(candidate.x), y: Math.round(candidate.y), delta: Math.round(candidate.delta), imageWidth: capture.width, imageHeight: capture.height };
          } else if (candidate?.type === 'type' && typeof candidate.text === 'string' && candidate.text.length > 0 && candidate.text.length <= 1500) {
            safeAction = { type: 'type', text: candidate.text };
          } else if (candidate?.type === 'key' && typeof candidate.key === 'string' &&
              ['ENTER','TAB','ESC','BACKSPACE','SPACE','DELETE','UP','DOWN','LEFT','RIGHT','HOME','END','PAGEUP','PAGEDOWN','F5','CTRL+A','CTRL+C','CTRL+V','CTRL+L','CTRL+S','CTRL+Z','CTRL+F','CTRL+W','CTRL+T','CTRL+R','CTRL+SHIFT+S','ALT+TAB','ALT+F4','ALT+LEFT','ALT+RIGHT'].includes(candidate.key.toUpperCase())) {
            safeAction = { type: 'key', key: candidate.key.toUpperCase() };
          }
          if (safeAction) {
            setPendingAction(safeAction);
            setChatOpen(true);
            answer = answer.replace(actionMatch[0], '').trim() + '\n\nPosso executar essa ação? Confira e confirme na janelinha.';
          }
        } catch {
          answer = answer.replace(actionMatch[0], '').trim();
        }
      }
      setMessages((current) => {
        const updated = [...current];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, content: answer };
        else updated.push({ role: 'assistant', content: answer });
        return updated;
      });
      if (autoSpeak) void speak(answer);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Ocorreu um erro ao conversar com a IA.');
    } finally {
      thinkingRef.current = false;
      setThinking(false);
    }
  };

  sendMessageRef.current = sendMessage;

  useEffect(() => {
    if (!thinking && pendingVoiceRef.current.length > 0) {
      const nextTranscript = pendingVoiceRef.current.shift();
      if (nextTranscript) void sendMessageRef.current(nextTranscript);
    }
  }, [thinking]);

  const runQuickCommand = async (rawText: string): Promise<string | null> => {
    const text = rawText.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const youtubeQuery = text.match(/(?:pesquise|procure|busque)\s+(?:no youtube|no youtube por)\s+(.+)/i);
    if (youtubeQuery?.[1]?.trim()) {
      const query = youtubeQuery[1].trim();
      await window.aurora.openUrl('https://www.youtube.com/results?search_query=' + encodeURIComponent(query));
      return `Procurei “${query}” no YouTube. Espero que seja algo bom, hein. 😏`;
    }
    const searchMatch = text.match(/(?:pesquise|pesquisar|procure|buscar|busque)\s+(?:na internet|no google|por)?\s*(.+)/i);
    if (searchMatch?.[1]?.trim()) {
      const query = searchMatch[1].trim();
      await window.aurora.openUrl('https://www.google.com/search?q=' + encodeURIComponent(query));
      return `Pesquisei por “${query}” no Google. Até que enfim uma pergunta interessante. 😏`;
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
      return `Abri o ${appMatch.label} para você! ✨`;
    }

    const folderMatch = folders.find((item) => item.names.some((name) => text.includes(name)));
    if (folderMatch) {
      await window.aurora.openFolder(folderMatch.id);
      return `Aqui está sua pasta ${folderMatch.label}. ✨`;
    }

    if (text.includes('youtube')) {
      await window.aurora.openUrl('https://www.youtube.com');
      return 'Abri o YouTube para você! ✨';
    }
    if (text.includes('google') || text.includes('navegador') || text.includes('chrome') || text.includes('edge')) {
      await window.aurora.openUrl('https://www.google.com');
      return 'Abri seu navegador com o Google. Não me agradeça toda hora. 😌';
    }
    return null;
  };

  const analyzeScreen = async () => {
    const prompt = 'Analise a captura da minha tela. Descreva o que está visível e me ajude com o que eu estiver fazendo. Se houver erro, identifique a mensagem e sugira como resolver. Não afirme que clicou ou alterou nada: apenas observe e oriente.';
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
      }, (chunk) => {
        setMessages((current) => {
          const updated = [...current];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, content: last.content + chunk };
          return updated;
        });
      });
      const answer = response.text?.trim() || 'Não consegui interpretar essa captura.';
      if (/(?:\bkkkk+\b|\bhaha+\b|\bhehe+\b|\brsrs+\b|😂|🤣)/i.test(answer)) setLaughing(true);
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

  const approvePendingAction = async () => {
    if (!pendingAction || actionRunning) return;
    setActionRunning(true);
    try {
      const result = await window.aurora.executeAction(pendingAction);
      const confirmation = result.description || 'Ação executada.';
      setMessages((current) => [...current, { role: 'assistant', content: `Prontinho! ${confirmation}. ✨` }]);
      setNotice('Ação confirmada e executada.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não consegui executar essa ação.');
    } finally {
      setPendingAction(null);
      setActionRunning(false);
    }
  };

  const stopVoiceMode = () => {
    voiceModeRef.current = false;
    setVoiceMode(false);
    if (recognitionRestartRef.current !== null) {
      window.clearTimeout(recognitionRestartRef.current);
      recognitionRestartRef.current = null;
    }
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    recognition?.abort?.();
    setListening(false);
    setNotice('Conversa por voz desativada. O microfone foi liberado.');
  };

  const startListening = () => {
    if (voiceModeRef.current) {
      stopVoiceMode();
      return;
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setNotice('O reconhecimento contínuo não está disponível nesta instalação do Electron.');
      return;
    }

    voiceModeRef.current = true;
    setVoiceMode(true);
    setNotice('Conversa contínua ativada. O microfone ficará ligado até você tocar novamente no botão.');

    let startRecognitionSession: () => void;
    const scheduleRestart = (delay = 850) => {
      if (!voiceModeRef.current || recognitionRestartRef.current !== null) return;
      recognitionRestartRef.current = window.setTimeout(() => {
        recognitionRestartRef.current = null;
        startRecognitionSession();
      }, delay);
    };

    startRecognitionSession = () => {
      if (!voiceModeRef.current) return;
      const recognition = new Recognition();
      recognition.lang = 'pt-BR';
      recognition.interimResults = false;
      recognition.continuous = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => setListening(true);
      recognition.onresult = (event: any) => {
        if (!voiceModeRef.current) return;
        const phrases: string[] = [];
        for (let index = event.resultIndex ?? 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const phrase = result?.[0]?.transcript?.trim();
          if (result?.isFinal && phrase) phrases.push(phrase);
        }
        const transcript = phrases.join(' ').replace(/\s+/g, ' ').trim();
        if (!transcript) return;

        // A fala reconhecida do usuário interrompe a voz atual da Aurora.
        audioRef.current?.pause();
        audioRef.current = null;
        window.speechSynthesis?.cancel();
        setSpeaking(false);
        setNotice('');

        if (thinkingRef.current) {
          pendingVoiceRef.current.push(transcript);
          setNotice('Recebi sua fala. Vou responder assim que terminar a resposta atual.');
        } else {
          void sendMessageRef.current(transcript);
        }
      };
      recognition.onerror = (event: any) => {
        setListening(false);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          voiceModeRef.current = false;
          setVoiceMode(false);
          setNotice('O acesso ao microfone foi bloqueado. Libere a permissão de microfone no Windows.');
        } else if (event.error === 'audio-capture') {
          voiceModeRef.current = false;
          setVoiceMode(false);
          setNotice('Não encontrei um microfone ativo. Confira o dispositivo de entrada do Windows.');
        } else if (event.error && !['no-speech', 'aborted', 'network'].includes(event.error)) {
          setNotice('O reconhecimento de voz encontrou um erro: ' + event.error);
        }
      };
      recognition.onend = () => {
        setListening(false);
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        if (voiceModeRef.current) scheduleRestart();
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        scheduleRestart(1400);
      }
    };

    startRecognitionSession();
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
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    setMessages([greeting]);
    setNotice('Conversa limpa. Podemos começar de novo!');
  };

  const connected = config.ollamaAvailable && config.modelInstalled;

  const lastAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant')?.content || 'Oi! Clique em conversar para falar comigo.';

  return (
    <main className="desktop-shell pet-shell">
      <div className="pet-avatar-wrap" title="Arraste a Aurora para mudar sua posição">
        <Avatar3D speaking={speaking} thinking={thinking} laughing={laughing} />
      </div>

      <div className="pet-status">
        <span className={'status-dot ' + (connected ? 'online' : '')} />
        {thinking ? 'Pensando…' : laughing ? 'Rindo…' : speaking ? 'Falando…' : connected ? 'Aurora está aqui' : 'Configure minha IA'}
        <span className="pet-version">v{version}</span>
      </div>

      <div className="pet-bubble" title={lastAssistantMessage}>
        {thinking ? 'Hmm… deixa eu pensar um pouquinho!' : laughing ? 'Hahaha! Essa foi boa! 🤭' : speaking ? 'Estou falando com você 💗' : lastAssistantMessage}
      </div>

      <div className="pet-toolbar">
        <button className={'pet-action ' + (chatOpen ? 'selected' : '')} onClick={() => { setChatOpen(!chatOpen); setAppsOpen(false); }} title="Conversar com Aurora">💬</button>
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

      {pendingAction && (
        <section className="pet-action-confirm" role="alertdialog" aria-modal="true" aria-label="Confirmar ação no computador">
          <div className="pet-panel-title">Aurora quer fazer uma ação</div>
          <strong>
            {pendingAction.type === 'click'
              ? `Clicar na posição aproximada ${pendingAction.x}, ${pendingAction.y} da captura`
              : pendingAction.type === 'scroll'
                ? `Rolar ${pendingAction.delta > 0 ? 'para baixo' : 'para cima'} na posição ${pendingAction.x}, ${pendingAction.y}`
                : pendingAction.type === 'type'
                ? `Digitar: “${pendingAction.text.slice(0, 160)}${pendingAction.text.length > 160 ? '…' : ''}”`
                : `Pressionar ${pendingAction.key}`}
          </strong>
          <p>Vou executar somente esta ação na janela que estava ativa quando fiz a captura. Você pode cancelar.</p>
          <div className="pet-action-buttons">
            <button className="pet-confirm-button" onClick={() => void approvePendingAction()} disabled={actionRunning}>
              {actionRunning ? 'Executando…' : 'Confirmar ação'}
            </button>
            <button className="pet-cancel-button" onClick={() => setPendingAction(null)} disabled={actionRunning}>Cancelar</button>
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
              title={voiceMode ? 'Desativar conversa contínua' : 'Ativar conversa contínua'}
              aria-label={voiceMode ? 'Desativar conversa contínua' : 'Ativar conversa contínua'}
              aria-pressed={voiceMode}
            >{voiceMode ? '■' : '⌁'}</button>
            <button className="send-button" type="submit" disabled={!input.trim() || thinking} title="Enviar mensagem">➤</button>
          </form>

          <div className="chat-footer">
            <span className={'voice-mode-status ' + (voiceMode ? 'active' : '')}>
              <i /> {voiceMode ? (listening ? 'Microfone ativo' : 'Reconectando microfone…') : 'Microfone desligado'}
            </span>
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
                <option value="qwen3.5:2b">Qwen 3.5 2B — mais leve, também entende imagens</option>
                <option value="qwen3.5:4b">Qwen 3.5 4B — melhor qualidade, exige mais memória</option>
                <option value="qwen3.5:9b">Qwen 3.5 9B — mais pesado, PC mais forte</option>
              </select>
              <p className="field-help">Modelos maiores podem demorar mais para responder. Para começar, mantenha o 2B.</p>

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
                <div>
                  <strong>Voz de anime da Aurora</strong>
                  <p>A voz padrão é a Leticia Neural, uma voz feminina jovem, com pitch +42 Hz e fala 12% mais rápida. A voz é sintetizada online e precisa de internet.</p>
                  <button className="pet-voice-test" type="button" onClick={() => void speak('Oii! Eu sou a Aurora! Hehehe! Vai demorar muito para me dar uma missão? Estou ficando entediada!')}>▶ Testar minha voz</button>
                </div>
                <div>
                  <strong>Visão e privacidade</strong>
                  <p>A tela só é capturada quando você toca no botão de olho ou pede para analisar a tela. A imagem vai para o Ollama local no seu PC; não é enviada a uma API na nuvem.</p>
                </div>
                <div>
                  <strong>Comandos disponíveis nesta versão</strong>
                  <p>Você pode pedir para abrir Calculadora, Bloco de Notas, Explorador, Paint, Gerenciador de Tarefas, Ferramenta de Captura, Configurações, Câmera, sites, pesquisas na internet e pastas conhecidas. Também posso analisar sua tela e sugerir cliques, rolagem, digitação e atalhos; ações no PC sempre precisam de confirmação.</p>
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
