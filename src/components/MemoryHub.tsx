import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';

type Tab = 'history' | 'memories' | 'knowledge' | 'identity';
type ConversationItem = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
};
type MemoryItem = { id: string; content: string; createdAt: string };
type KnowledgeDocument = {
  id: string;
  name: string;
  extension: string;
  size: number;
  addedAt: string;
  characterCount: number;
  chunkCount: number;
};
type IdentityProfile = {
  name: string;
  avatar: string;
  appearanceDescription: string;
  personality: string;
};

type Props = {
  onOpenConversation: (id: string) => Promise<void>;
  onNewConversation: () => Promise<void>;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data desconhecida';
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function MemoryHub({ onOpenConversation, onNewConversation }: Props) {
  const [tab, setTab] = useState<Tab>('history');
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [memoryQuery, setMemoryQuery] = useState('');
  const [memoryDraft, setMemoryDraft] = useState('');
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [knowledgeQuery, setKnowledgeQuery] = useState('');
  const [knowledgeResults, setKnowledgeResults] = useState<Array<{ title: string; source: string; content: string }>>([]);
  const [identity, setIdentity] = useState<IdentityProfile>({
    name: 'Aurora',
    avatar: 'Live2D 6xb',
    appearanceDescription: '',
    personality: 'Companheira de conversa: confiante, brincalhona, carinhosa e curiosa.',
  });
  const [embeddingInstalled, setEmbeddingInstalled] = useState(false);
  const [embeddingBusy, setEmbeddingBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshHistory = async (query = historyQuery) => {
    const result = await window.aurora.listConversations(query);
    setConversations(result.conversations);
  };

  const refreshMemories = async () => {
    const result = await window.aurora.listMemories();
    setMemories(result.memories);
  };

  const refreshDocuments = async () => {
    const result = await window.aurora.listKnowledgeDocuments();
    setDocuments(result.documents);
  };

  const refreshIdentity = async () => {
    const result = await window.aurora.getIdentityProfile();
    setIdentity(result);
  };

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.aurora.listConversations(),
      window.aurora.listMemories(),
      window.aurora.listKnowledgeDocuments(),
      window.aurora.getEmbeddingStatus(),
      window.aurora.getIdentityProfile(),
    ]).then(([history, savedMemories, knowledge, embedding, profile]) => {
      if (!active) return;
      setConversations(history.conversations);
      setMemories(savedMemories.memories);
      setDocuments(knowledge.documents);
      setEmbeddingInstalled(embedding.installed);
      setIdentity(profile);
    }).catch((error) => {
      if (active) setNotice(error instanceof Error ? error.message : 'Não consegui carregar a memória da Aurora.');
    });
    const unsubscribe = window.aurora.onEmbeddingStatus((status) => {
      if (!active) return;
      if (status.message) setNotice(status.message + (typeof status.percent === 'number' ? ' ' + status.percent + '%' : ''));
      if (status.state === 'ready') {
        setEmbeddingInstalled(true);
        setEmbeddingBusy(false);
        setNotice(status.message || 'Busca semântica pronta.');
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const filteredMemories = useMemo(() => {
    const query = memoryQuery.trim().toLocaleLowerCase('pt-BR');
    if (!query) return memories;
    return memories.filter((item) => item.content.toLocaleLowerCase('pt-BR').includes(query));
  }, [memories, memoryQuery]);

  const saveMemory = async () => {
    const content = memoryDraft.trim();
    if (!content) return;
    setBusy(true);
    setNotice('');
    try {
      await window.aurora.saveMemory(content);
      setMemoryDraft('');
      await refreshMemories();
      setNotice('Lembrança salva na memória protegida da Aurora.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não consegui salvar essa lembrança.');
    } finally {
      setBusy(false);
    }
  };

  const removeMemory = async (item: MemoryItem) => {
    setBusy(true);
    try {
      const result = await window.aurora.deleteMemory(item.content);
      if (result.deleted) {
        await refreshMemories();
        setNotice('Lembrança apagada.');
      } else setNotice('Não encontrei essa lembrança para apagar.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não consegui apagar a lembrança.');
    } finally {
      setBusy(false);
    }
  };

  const removeConversation = async (item: ConversationItem) => {
    if (!window.confirm('Apagar esta conversa permanentemente?')) return;
    setBusy(true);
    try {
      await window.aurora.deleteConversation(item.id);
      await refreshHistory();
      setNotice('Conversa apagada.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não consegui apagar a conversa.');
    } finally {
      setBusy(false);
    }
  };

  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setBusy(true);
    setNotice('Importando material para a biblioteca local…');
    try {
      for (const file of files) {
        if (file.size > 24 * 1024 * 1024) throw new Error(file.name + ' ultrapassa o limite de 24 MB.');
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não consegui ler ' + file.name + '.'));
          reader.onerror = () => reject(new Error('Falha ao ler ' + file.name + '.'));
          reader.readAsDataURL(file);
        });
        const result = await window.aurora.importKnowledgeDocument({ name: file.name, base64: dataUrl, size: file.size });
        setNotice(result.document.name + ' adicionado (' + result.document.chunkCount + ' trechos).');
      }
      await refreshDocuments();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não consegui importar os arquivos.');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeDocument = async (item: KnowledgeDocument) => {
    setBusy(true);
    try {
      await window.aurora.deleteKnowledgeDocument(item.id);
      await refreshDocuments();
      setNotice('Material removido da biblioteca.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não consegui remover o documento.');
    } finally {
      setBusy(false);
    }
  };

  const searchDocuments = async () => {
    const query = knowledgeQuery.trim();
    if (!query) return;
    setBusy(true);
    try {
      const result = await window.aurora.searchKnowledge(query);
      setKnowledgeResults(result.results);
      setNotice(result.results.length ? result.results.length + ' trechos encontrados.' : 'Não encontrei trechos correspondentes na biblioteca.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'A busca na biblioteca falhou.');
    } finally {
      setBusy(false);
    }
  };

  const installEmbeddings = async () => {
    setEmbeddingBusy(true);
    setNotice('Preparando o modelo de busca semântica…');
    try {
      const result = await window.aurora.installEmbeddingModel();
      setEmbeddingInstalled(true);
      setNotice('Busca semântica ativada. ' + result.indexed + ' trechos indexados.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não consegui instalar o modelo de busca.');
    } finally {
      setEmbeddingBusy(false);
    }
  };

  const saveIdentity = async () => {
    setBusy(true);
    try {
      const updated = await window.aurora.saveIdentityProfile(identity);
      setIdentity(updated);
      setNotice('Identidade oficial da Aurora salva. Ela usará essa descrição quando falar sobre si mesma.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não consegui salvar a identidade da Aurora.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="chat-card pet-memory-hub">
      <div className="chat-heading">
        <div>
          <span className="chat-title">Memória da Aurora</span>
          <span className="chat-subtitle">Histórico, lembranças, conhecimento e identidade local</span>
        </div>
        <button className="text-button" onClick={() => void onNewConversation()} disabled={busy}>+ Nova conversa</button>
      </div>

      <nav className="memory-hub-tabs" aria-label="Seções da memória">
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Histórico</button>
        <button className={tab === 'memories' ? 'active' : ''} onClick={() => setTab('memories')}>Lembranças</button>
        <button className={tab === 'knowledge' ? 'active' : ''} onClick={() => setTab('knowledge')}>Biblioteca</button>
        <button className={tab === 'identity' ? 'active' : ''} onClick={() => setTab('identity')}>Identidade</button>
      </nav>

      <div className="memory-hub-content">
        {tab === 'history' && (
          <>
            <div className="memory-search-row">
              <input className="memory-input" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void refreshHistory(); }} placeholder="Pesquisar conversas antigas…" />
              <button onClick={() => void refreshHistory()} disabled={busy}>Buscar</button>
            </div>
            <div className="memory-list">
              {conversations.length === 0 && <p className="memory-empty">Ainda não há conversas salvas. Quando conversarmos, elas aparecerão aqui.</p>}
              {conversations.map((item) => (
                <article className="memory-list-item" key={item.id}>
                  <button className="memory-item-main" onClick={() => void onOpenConversation(item.id)}>
                    <strong>{item.title}</strong>
                    <span>{item.preview || 'Conversa sem mensagens'} </span>
                    <small>{formatDate(item.updatedAt)} · {item.messageCount} mensagens</small>
                  </button>
                  <button className="memory-delete" onClick={() => void removeConversation(item)} title="Apagar conversa" disabled={busy}>×</button>
                </article>
              ))}
            </div>
          </>
        )}

        {tab === 'memories' && (
          <>
            <p className="memory-description">Lembranças duradouras sobre você, suas preferências e seus projetos. A Aurora só grava automaticamente depois de você confirmar uma sugestão.</p>
            <div className="memory-compose">
              <textarea className="memory-textarea" rows={2} value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} placeholder="Ex.: Estou estudando para o concurso da Câmara de Mossoró." />
              <button onClick={() => void saveMemory()} disabled={busy || !memoryDraft.trim()}>Guardar lembrança</button>
            </div>
            <input className="memory-input full" value={memoryQuery} onChange={(event) => setMemoryQuery(event.target.value)} placeholder="Filtrar lembranças…" />
            <div className="memory-list">
              {filteredMemories.length === 0 && <p className="memory-empty">Nenhuma lembrança encontrada.</p>}
              {filteredMemories.map((item) => (
                <article className="memory-list-item" key={item.id}>
                  <div className="memory-item-main">
                    <span>{item.content}</span>
                    <small>Guardada em {formatDate(item.createdAt)}</small>
                  </div>
                  <button className="memory-delete" onClick={() => void removeMemory(item)} title="Apagar lembrança" disabled={busy}>×</button>
                </article>
              ))}
            </div>
          </>
        )}

        {tab === 'knowledge' && (
          <>
            <p className="memory-description">Adicione materiais para a Aurora consultar durante as conversas. Os arquivos ficam no computador e são indexados em trechos.</p>
            <div className="knowledge-actions">
              <button onClick={() => fileInputRef.current?.click()} disabled={busy}>＋ Adicionar arquivos</button>
              <button className={embeddingInstalled ? 'ready' : ''} onClick={() => void installEmbeddings()} disabled={embeddingBusy || busy}>
                {embeddingBusy ? 'Preparando…' : embeddingInstalled ? 'Atualizar busca semântica' : 'Ativar busca inteligente'}
              </button>
              <input ref={fileInputRef} type="file" multiple accept=".pdf,.txt,.md,.markdown,.csv,.json" onChange={(event) => void importFiles(event)} hidden />
            </div>
            <p className="memory-help">Aceita PDF, TXT, Markdown, CSV e JSON. PDFs precisam ter texto selecionável e o utilitário Poppler (pdftotext) instalado no Windows; PDFs digitalizados exigem OCR antes da importação.</p>
            <div className="memory-list knowledge-documents">
              {documents.length === 0 && <p className="memory-empty">Sua biblioteca ainda está vazia.</p>}
              {documents.map((item) => (
                <article className="memory-list-item" key={item.id}>
                  <div className="memory-item-main">
                    <strong>📄 {item.name}</strong>
                    <small>{formatSize(item.size)} · {item.chunkCount} trechos · {formatDate(item.addedAt)}</small>
                  </div>
                  <button className="memory-delete" onClick={() => void removeDocument(item)} title="Remover documento" disabled={busy}>×</button>
                </article>
              ))}
            </div>
            <div className="memory-search-row knowledge-search">
              <input className="memory-input" value={knowledgeQuery} onChange={(event) => setKnowledgeQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchDocuments(); }} placeholder="Pesquisar dentro dos documentos…" />
              <button onClick={() => void searchDocuments()} disabled={busy || !knowledgeQuery.trim()}>Buscar</button>
            </div>
            {knowledgeResults.map((item, index) => (
              <article className="knowledge-result" key={item.source + index}>
                <strong>{item.source}</strong>
                <p>{item.content}</p>
              </article>
            ))}
          </>
        )}

        {tab === 'identity' && (
          <>
            <p className="memory-description">Esta é a ficha oficial que a Aurora usa para manter coerência ao falar sobre sua própria identidade e aparência.</p>
            <label className="memory-label">Nome da personagem</label>
            <input className="memory-input full" value={identity.name} onChange={(event) => setIdentity((current) => ({ ...current, name: event.target.value }))} />
            <label className="memory-label">Avatar que a representa</label>
            <input className="memory-input full" value={identity.avatar} onChange={(event) => setIdentity((current) => ({ ...current, avatar: event.target.value }))} />
            <label className="memory-label">Descrição visual oficial</label>
            <textarea className="memory-textarea" rows={4} value={identity.appearanceDescription} onChange={(event) => setIdentity((current) => ({ ...current, appearanceDescription: event.target.value }))} placeholder="Descreva fielmente cabelo, olhos, rosto, roupas, acessórios e cores do avatar. Não inclua características que não estejam no modelo." />
            <label className="memory-label">Personalidade</label>
            <textarea className="memory-textarea" rows={3} value={identity.personality} onChange={(event) => setIdentity((current) => ({ ...current, personality: event.target.value }))} />
            <button className="memory-primary full-button" onClick={() => void saveIdentity()} disabled={busy || !identity.name.trim() || !identity.avatar.trim()}>Salvar identidade da Aurora</button>
            <p className="memory-help">A ficha dá à Aurora uma referência estável; reconhecer uma expressão ou pose em tempo real ainda depende de analisar uma captura atual do avatar.</p>
          </>
        )}
      </div>

      {notice && <div className="memory-hub-notice" role="status">{notice}</div>}
      <div className="memory-hub-footer">
        <span className={embeddingInstalled ? 'embedding-ready' : ''}>● {embeddingInstalled ? 'Busca semântica ativada' : 'Busca por palavras disponível'}</span>
        <span>Dados protegidos no computador</span>
      </div>
    </section>
  );
}
