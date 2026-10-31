import { FormEvent, useEffect, useRef, useState } from 'react';
import Avatar3D from './components/Avatar3D';

type Message = { role: 'user' | 'assistant'; content: string };
type AppConfig = { ollamaAvailable: boolean; installedModels: string[]; modelInstalled: boolean; model: string };

const greeting: Message = {
  role: 'assistant',
  content: 'Oi! Eu sou a Aurora. ✨ Minha inteligência roda no seu próprio computador, sem assinatura nem API paga. Para começarmos, instale o Ollama e baixe meu modelo local!',
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([greeting]);
  const [input, setInput] = useState('');
  const [config, setConfig] = useState<AppConfig>({ ollamaAvailable: false, installedModels: [], modelInstalled: false, model: 'qwen3.5:2b' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [model, setModel] = useState('qwen3.5:2b');
  const [saving, setSaving] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [notice, setNotice] = useState('');
  const [version, setVersion] = useState('0.2.3');
  const listRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    window.aurora.getConfig().then((data) => {
      setConfig(data);
      setModel(data.model);
    }).catch(() => setNotice('Não consegui carregar as configurações.'));
    window.aurora.version().then(setVersion).catch(() => undefined);

    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      recognitionRef.current?.abort?.();
    };
  }, []);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, thinking]);

  const speak = async (text: string) => {
    try {
      audioRef.current?.pause();
      audioRef.current = null;
      setSpeaking(true);
      const result = await window.aurora.speak(text);
      if (!result?.audioBase64) throw new Error('A voz neural não retornou áudio.');
      const audio = new Audio(`data:audio/mpeg;base64,${result.audioBase64}`);
      audioRef.current = audio;
      audio.onended = () => { setSpeaking(false); audioRef.current = null; };
      audio.onerror = () => { setSpeaking(false); audioRef.current = null; setNotice('O áudio não pôde ser reproduzido.'); };
      await audio.play();
    } catch (error) {
      setSpeaking(false);
      const message = error instanceof Error ? error.message : 'Não consegui iniciar a voz neural.';
      setNotice(message);
    }
  };

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || thinking) return;
    setNotice('');
    audioRef.current?.pause();
    audioRef.current = null;
    setSpeaking(false);
    const previous = messages.filter((message) => message.content !== greeting.content).slice(-12);
    setMessages((current) => [...current, { role: 'user', content: text }]);
    setInput('');
    setThinking(true);
    try {
      const response = await window.aurora.chat({ message: text, history: previous });
      const answer = response.text?.trim() || 'Não consegui responder agora.';
      setMessages((current) => [...current, { role: 'assistant', content: answer }]);
      if (autoSpeak) speak(answer);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ocorreu um erro ao conversar com a IA.';
      setNotice(message);
    } finally {
      setThinking(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const startListening = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setNotice('O reconhecimento de voz não está disponível nesta versão do navegador. Você ainda pode digitar e ouvir minhas respostas.');
      return;
    }
    try {
      recognitionRef.current?.abort?.();
      const recognition = new Recognition();
      recognition.lang = 'pt-BR';
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.onstart = () => { setListening(true); setNotice('Estou ouvindo…'); };
      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript || '';
        setNotice('');
        void sendMessage(transcript);
      };
      recognition.onerror = (event: any) => {
        setNotice(event.error === 'not-allowed'
          ? 'O acesso ao microfone foi bloqueado. Libere a permissão do microfone no Windows.'
          : 'Não consegui entender o áudio. Tente novamente ou digite sua mensagem.');
        setListening(false);
      };
      recognition.onend = () => setListening(false);
      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setListening(false);
      setNotice('Não consegui iniciar o microfone.');
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
      setNotice(status.modelInstalled ? 'Modelo local selecionado. Podemos conversar! ✨' : 'Preferência salva. Agora baixe o modelo pelo instalador gratuito.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não consegui salvar as configurações.');
    } finally {
      setSaving(false);
    }
  };

  const clearConversation = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setSpeaking(false);
    setMessages([greeting]);
    setNotice('Conversa limpa. Podemos começar de novo!');
  };

  return (
    <main className="desktop-shell">
      <div className="window-grip" aria-hidden="true" />
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-orb"><span>✦</span></div>
          <div>
            <div className="brand-name">Aurora</div>
            <div className="brand-state"><span className={`status-dot ${config.ollamaAvailable && config.modelInstalled ? 'online' : ''}`} />{config.ollamaAvailable && config.modelInstalled ? 'IA local conectada' : 'IA local não configurada'}</div>
          </div>
        </div>
        <div className="window-actions">
          <button className="icon-button" title="Configurações" onClick={() => setSettingsOpen(true)}>⚙</button>
          <button className="icon-button" title="Minimizar" onClick={() => window.aurora.minimize()}>—</button>
          <button className="icon-button close-button" title="Fechar" onClick={() => window.aurora.close()}>×</button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-glow" />
        <div className="floating-badge"><span className="sparkle">✦</span> SUA COMPANHEIRA DIGITAL</div>
        <Avatar3D speaking={speaking} thinking={thinking} />
        <div className="speech-status">
          {thinking ? <><span className="typing-dots"><i /><i /><i /></span> Estou pensando…</>
            : speaking ? <><span className="sound-bars"><i /><i /><i /><i /></span> Falando com você</>
              : listening ? <><span className="record-dot" /> Estou ouvindo…</>
                : 'Oi! Que bom ter você por aqui.'}
        </div>
      </section>

      <section className="chat-card">
        <div className="chat-heading">
          <div><span className="chat-title">Nossa conversa</span><span className="chat-subtitle">Pode falar comigo à vontade</span></div>
          <button className="text-button" onClick={clearConversation} title="Limpar conversa">Limpar</button>
        </div>
        <div className="messages" ref={listRef}>
          {messages.map((message, index) => (
            <div className={`message-row ${message.role}`} key={`${index}-${message.role}`}>
              {message.role === 'assistant' && <div className="message-avatar">✦</div>}
              <div className="message-bubble">{message.content}</div>
            </div>
          ))}
          {thinking && <div className="message-row assistant"><div className="message-avatar">✦</div><div className="message-bubble thinking-bubble"><i /><i /><i /></div></div>}
        </div>
        {notice && <div className="notice" role="status">{notice}</div>}
        <form className="composer" onSubmit={onSubmit}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Escreva para a Aurora…"
            aria-label="Mensagem para Aurora"
            disabled={thinking}
          />
          <button className={`mic-button ${listening ? 'listening' : ''}`} type="button" onClick={startListening} title="Ativar microfone para falar com a Aurora. O reconhecimento ainda pode exigir internet." disabled={thinking || listening}>⌁</button>
          <button className="send-button" type="submit" disabled={!input.trim() || thinking} title="Enviar mensagem">➤</button>
        </form>
        <div className="chat-footer">
          <label className="speak-toggle"><input type="checkbox" checked={autoSpeak} onChange={(event) => setAutoSpeakevent.target.checked)} /> <span>Voz natural • Francisca</span></label>
          <span>Enter para enviar</span>
        </div>
      </section>

      <footer className="bottom-note"><span>✧</span> Aurora está evoluindo com você <span className="version">v{version}</span></footer>

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMousDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="modal-header">
              <div><div className="eyebrow">PERSONALIZE SUA EXPERIêNCIA</div><h2 id="settings-title">Configurações</h2></div>
              <button className="icon-button modal-close" onClick={() => setSettingsOpen(false)} aria-label="Fechar">×</button>
            </div>
            <form onSubmit={saveSettings} className="settings-form">
              <div className="secure-note"><span>✓</span><span>Sem mensalidade, sem chave de API e sem cobrança por mensagem. A IA roda localmente pelo Ollama.</span></div>
              <label className="field-label" htmlFor="model">Modelo local</label>
              <select id="model" className="settings-input" value={model} onChange={(event) => setModel(event.target.value)}>
                <option value="qwen3.5:2b">Qwen 3.5 2B — Mais leve (recomendado para começar)</option>
                <option value="qwen3.5:4b">Qwen 3.5 4B — melhor qualidade, exige mais melória</option>
                <option value="qwen3.5:9b">Qwen 3.5 9B — mais pesado, PC mais forte</option>
              </select>
              <p className="field-help">O modelo precisa ser baixado uma vez. Depois, as conversas podem funcionar sem internet. O 2B ocupa cerca de 3 GB; modelos maiores exigem mais memória.</p>
              <div className="secure-note"><span>{config.ollamaAvailable ? '✓' : '!'}`</span><span>{config.ollamaAvailable ? `Ollama detectado. Modelos instalados: ${config.installedModels.length ? config.installedModels.join(', ') : 'nenhum'}.` : 'Ollama não foi detectado. Instale-o e abra o programa antes de conversar.'}</span></div>
              <button className="save-button" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar modelo'}</button>
            </form>
            <div className="modal-divider" />
            <div className="settings-bottom">
              <div><strong>Como ativar a inteligência</strong><p>Feche a Aurora e execute INSTALAR-IA-GRATUITA.bat dentro da pasta do projeto. Ele instala o Ollama (se necessário) e baixa o modelo leve Qwen 3.5 2B. Para usar o 4B ou 9B, execute `ollama pull qwen3.5:4b` ou `ollama pull qwen3.5:9b` no terminal.</p></div>
              <div><strong>Privacidade u voz</strong><p>O texto do chat é processado no próprio PC pelo Ollama. A fala de saída usa a voz neural Francisca do serviço online do Microsoft Edge e precisa de internet. O botão de microfone usa o reconhecimento de voz do Chromium, que também pode depender de internet; ainda não é totalmente offline.</p></div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
