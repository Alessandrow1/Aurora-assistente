const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');

const execFileAsync = promisify(execFile);
const EMBEDDING_MODEL = 'nomic-embed-text';
const MAX_CONVERSATIONS = 120;
const MAX_CONVERSATION_MESSAGES = 140;
const MAX_DOCUMENTS = 120;
const MAX_DOCUMENT_BYTES = 24 * 1024 * 1024;
const MAX_INDEXED_CHUNKS = 3000;

function normalize(value) {
  return String(value || '')
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreText(query, content) {
  const normalizedQuery = normalize(query);
  const normalizedContent = normalize(content);
  if (!normalizedQuery || !normalizedContent) return 0;
  if (normalizedContent.includes(normalizedQuery)) return 12;
  const stopWords = new Set(['que','para','com','uma','uns','das','dos','por','como','qual','quais','isso','essa','esse','sobre','meu','minha','voce','aurora','lembra','lembre','conversa']);
  const terms = [...new Set(normalizedQuery.split(' ').filter((term) => term.length > 2 && !stopWords.has(term)))];
  if (!terms.length) return 0;
  const words = new Set(normalizedContent.split(' '));
  return terms.reduce((score, term) => score + (words.has(term) ? 1 + Math.min(term.length, 10) / 10 : 0), 0);
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }
  return leftNorm && rightNorm ? dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)) : 0;
}

function splitIntoChunks(text, maxChars = 1500, overlap = 180) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
  if (!normalized) return [];
  const chunks = [];
  const pages = normalized.split('\f');
  pages.forEach((pageText, pageIndex) => {
    let remaining = pageText.trim();
    let part = 0;
    while (remaining.length) {
      let end = Math.min(maxChars, remaining.length);
      if (end < remaining.length) {
        const paragraphBreak = remaining.lastIndexOf('\n\n', end);
        const sentenceBreak = remaining.lastIndexOf('. ', end);
        const spaceBreak = remaining.lastIndexOf(' ', end);
        const bestBreak = Math.max(paragraphBreak, sentenceBreak, spaceBreak);
        if (bestBreak > Math.floor(maxChars * 0.55)) end = bestBreak + (bestBreak === sentenceBreak ? 1 : 0);
      }
      const content = remaining.slice(0, end).trim();
      if (content.length >= 40) chunks.push({ content, page: pages.length > 1 ? pageIndex + 1 : null, part: part + 1 });
      if (end >= remaining.length) break;
      remaining = remaining.slice(Math.max(0, end - overlap)).trim();
      part += 1;
    }
  });
  return chunks;
}

function createAuroraStore({ app, safeStorage, ollamaUrl, onEmbeddingStatus = () => undefined }) {
  const conversationsPath = () => path.join(app.getPath('userData'), 'aurora-conversations.bin');
  const knowledgePath = () => path.join(app.getPath('userData'), 'aurora-knowledge.bin');
  const tempDirectory = () => path.join(app.getPath('userData'), 'knowledge-import');
  const baseUrl = String(ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  let embeddingAvailability = { checkedAt: 0, installed: false };
  let conversationWrite = Promise.resolve();
  let knowledgeWrite = Promise.resolve();

  const emptyConversations = () => ({ version: 1, conversations: [], index: [] });
  const emptyKnowledge = () => ({ version: 1, documents: [], chunks: [], memoryEmbeddings: {}, identityProfile: { name: 'Aurora', avatar: 'Live2D 6xb', appearanceDescription: '', personality: 'Companheira de conversa: confiante, brincalhona, carinhosa e curiosa.' } });

  async function readEncrypted(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback();
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('O armazenamento seguro do Windows está indisponível. Não consegui abrir os dados protegidos da Aurora.');
    }
    const encrypted = await fsp.readFile(filePath);
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    const parsed = JSON.parse(decrypted.result);
    if (!parsed || typeof parsed !== 'object') return fallback();
    return parsed;
  }

  async function writeEncrypted(filePath, value, queueName) {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('O armazenamento seguro do Windows está indisponível. Não vou salvar dados sem criptografia.');
    }
    const queue = queueName === 'conversations' ? conversationWrite : knowledgeWrite;
    const nextWrite = queue.catch(() => undefined).then(async () => {
      const serialized = JSON.stringify(value);
      const encrypted = await safeStorage.encryptStringAsync(serialized);
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      const temporary = filePath + '.tmp';
      await fsp.writeFile(temporary, encrypted, { mode: 0o600 });
      await fsp.rename(temporary, filePath);
    });
    if (queueName === 'conversations') conversationWrite = nextWrite;
    else knowledgeWrite = nextWrite;
    await nextWrite;
  }

  async function readConversations() {
    const data = await readEncrypted(conversationsPath(), emptyConversations);
    return {
      version: 1,
      conversations: Array.isArray(data.conversations) ? data.conversations.filter((item) => item && typeof item.id === 'string') : [],
      index: Array.isArray(data.index) ? data.index.filter((item) => item && typeof item.id === 'string' && typeof item.text === 'string') : [],
    };
  }

  async function readKnowledge() {
    const data = await readEncrypted(knowledgePath(), emptyKnowledge);
    return {
      version: 1,
      documents: Array.isArray(data.documents) ? data.documents.filter((item) => item && typeof item.id === 'string') : [],
      chunks: Array.isArray(data.chunks) ? data.chunks.filter((item) => item && typeof item.id === 'string' && typeof item.content === 'string') : [],
      memoryEmbeddings: data.memoryEmbeddings && typeof data.memoryEmbeddings === 'object' ? data.memoryEmbeddings : {},
      identityProfile: data.identityProfile && typeof data.identityProfile === 'object'
        ? { ...emptyKnowledge().identityProfile, ...data.identityProfile }
        : emptyKnowledge().identityProfile,
    };
  }

  async function getEmbeddingStatus(force = false) {
    if (!force && Date.now() - embeddingAvailability.checkedAt < 30000) return embeddingAvailability;
    try {
      const response = await fetch(baseUrl + '/api/tags', { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error('Ollama indisponível.');
      const data = await response.json();
      const models = Array.isArray(data.models) ? data.models.map((item) => String(item.name || '')) : [];
      const installed = models.some((name) => name === EMBEDDING_MODEL || name.startsWith(EMBEDDING_MODEL + ':'));
      embeddingAvailability = { checkedAt: Date.now(), installed, model: EMBEDDING_MODEL };
      return embeddingAvailability;
    } catch {
      embeddingAvailability = { checkedAt: Date.now(), installed: false, model: EMBEDDING_MODEL };
      return embeddingAvailability;
    }
  }

  async function generateEmbeddings(texts) {
    const inputs = texts.map((text) => String(text || '').slice(0, 7000));
    if (!inputs.length) return [];
    const status = await getEmbeddingStatus();
    if (!status.installed) return null;
    const response = await fetch(baseUrl + '/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs, keep_alive: '10m' }),
    });
    if (!response.ok) throw new Error('Ollama não conseguiu gerar os embeddings (' + response.status + ').');
    const data = await response.json();
    if (!Array.isArray(data.embeddings) || data.embeddings.length !== inputs.length) {
      throw new Error('O modelo de embeddings retornou um formato inesperado.');
    }
    return data.embeddings;
  }

  async function generateEmbeddingsInBatches(texts, batchSize = 24) {
    const embeddings = [];
    for (let offset = 0; offset < texts.length; offset += batchSize) {
      const batch = await generateEmbeddings(texts.slice(offset, offset + batchSize));
      if (!batch) return null;
      embeddings.push(...batch);
      onEmbeddingStatus({
        state: 'indexing',
        completed: Math.min(offset + batch.length, texts.length),
        total: texts.length,
      });
    }
    return embeddings;
  }

  async function createConversation() {
    const data = await readConversations();
    const now = new Date().toISOString();
    const conversation = {
      id: crypto.randomUUID(),
      title: 'Nova conversa',
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    data.conversations.unshift(conversation);
    data.conversations = data.conversations.slice(0, MAX_CONVERSATIONS);
    const retainedIds = new Set(data.conversations.map((item) => item.id));
    data.index = data.index.filter((item) => retainedIds.has(item.sessionId));
    await writeEncrypted(conversationsPath(), data, 'conversations');
    return { id: conversation.id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt };
  }

  async function saveConversation(raw) {
    const id = typeof raw?.id === 'string' ? raw.id : '';
    if (!id) throw new Error('A conversa não possui um identificador válido.');
    const data = await readConversations();
    const existing = data.conversations.find((item) => item.id === id);
    const messages = (Array.isArray(raw.messages) ? raw.messages : [])
      .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
      .filter((item) => item.content.trim())
      .slice(-MAX_CONVERSATION_MESSAGES)
      .map((item) => ({
        role: item.role,
        content: item.content.slice(0, 8000),
        ...(typeof item.imageId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.imageId)
          ? { imageId: item.imageId }
          : {}),
      }));
    const firstUserMessage = messages.find((item) => item.role === 'user')?.content || '';
    const requestedTitle = typeof raw.title === 'string' ? raw.title.trim() : '';
    const title = (requestedTitle && requestedTitle !== 'Nova conversa' ? requestedTitle : (firstUserMessage || existing?.title || 'Nova conversa'))
      .replace(/\s+/g, ' ').slice(0, 72);
    const now = new Date().toISOString();
    const conversation = {
      id,
      title: title || 'Nova conversa',
      createdAt: existing?.createdAt || (typeof raw.createdAt === 'string' ? raw.createdAt : now),
      updatedAt: now,
      messages,
    };
    data.conversations = [conversation, ...data.conversations.filter((item) => item.id !== id)]
      .slice(0, MAX_CONVERSATIONS);
    const retainedIds = new Set(data.conversations.map((item) => item.id));
    data.index = data.index.filter((item) => retainedIds.has(item.sessionId));
    await writeEncrypted(conversationsPath(), data, 'conversations');
    // A indexação é assíncrona: a gravação do histórico não espera o modelo de embeddings.
    void indexConversationPairs(conversation).catch((error) => {
      console.warn('[Aurora History] Não consegui atualizar o índice da conversa:', error instanceof Error ? error.message : String(error));
    });
    return {
      saved: true,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: messages.length,
      },
    };
  }

  async function indexConversationPairs(conversation) {
    const data = await readConversations();
    const pairs = [];
    for (let i = 0; i < conversation.messages.length; i += 1) {
      const user = conversation.messages[i];
      if (user.role !== 'user') continue;
      const assistant = conversation.messages[i + 1]?.role === 'assistant' ? conversation.messages[i + 1] : null;
      if (!assistant) continue;
      const text = ('Usuário: ' + user.content + '\nAurora: ' + assistant.content).slice(0, 9000);
      const id = conversation.id + ':' + i;
      const previous = data.index.find((item) => item.id === id);
      if (previous?.text === text) continue;
      const item = { id, sessionId: conversation.id, title: conversation.title, text, updatedAt: conversation.updatedAt, embedding: null };
      if (previous) Object.assign(previous, item);
      else data.index.push(item);
      pairs.push(item);
    }
    if (!pairs.length) return;
    data.index = data.index.slice(-1600);
    // Primeiro persiste o texto pesquisável; a busca lexical funciona mesmo sem embeddings.
    await writeEncrypted(conversationsPath(), data, 'conversations');
    try {
      const vectors = await generateEmbeddingsInBatches(pairs.map((item) => item.text));
      if (!vectors) return;
      // Reabre o arquivo para não sobrescrever mensagens novas gravadas enquanto o Ollama calcula vetores.
      const latest = await readConversations();
      pairs.forEach((item, index) => {
        const current = latest.index.find((stored) => stored.id === item.id && stored.text === item.text);
        if (current) current.embedding = vectors[index];
      });
      await writeEncrypted(conversationsPath(), latest, 'conversations');
    } catch (error) {
      console.warn('[Aurora Memory] Não consegui indexar a conversa semanticamente:', error instanceof Error ? error.message : String(error));
    }
  }

  async function listConversations(query = '') {
    const data = await readConversations();
    const normalizedQuery = normalize(query);
    let queryVector = null;
    if (normalizedQuery) {
      try { [queryVector] = (await generateEmbeddings([query])) || []; } catch { /* busca lexical continua disponível */ }
    }
    const semanticScores = new Map();
    if (queryVector) {
      for (const item of data.index) {
        if (!item.embedding) continue;
        const score = cosineSimilarity(queryVector, item.embedding);
        semanticScores.set(item.sessionId, Math.max(semanticScores.get(item.sessionId) || 0, score));
      }
    }
    const ranked = data.conversations.map((item) => {
      const lexical = normalizedQuery
        ? scoreText(query, item.title + ' ' + (item.messages || []).map((message) => message.content).join(' '))
        : 0;
      const semantic = semanticScores.get(item.id) || 0;
      return { item, score: normalizedQuery ? Math.max(lexical, semantic * 10) : 0 };
    });
    const sessions = ranked
      .filter(({ score }) => !normalizedQuery || score >= 1.5)
      .sort((left, right) => normalizedQuery
        ? right.score - left.score || String(right.item.updatedAt).localeCompare(String(left.item.updatedAt))
        : String(right.item.updatedAt).localeCompare(String(left.item.updatedAt)))
      .slice(0, 100)
      .map(({ item }) => ({
        id: item.id,
        title: item.title,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        messageCount: Array.isArray(item.messages) ? item.messages.length : 0,
        preview: [...(item.messages || [])].reverse().find((message) => message.role === 'user')?.content?.slice(0, 120) || '',
      }));
    return { conversations: sessions, count: data.conversations.length };
  }

  async function loadConversation(id) {
    const data = await readConversations();
    const item = data.conversations.find((conversation) => conversation.id === id);
    if (!item) return { found: false };
    return {
      found: true,
      conversation: {
        id: item.id,
        title: item.title,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        messages: Array.isArray(item.messages) ? item.messages : [],
      },
    };
  }

  async function deleteConversation(id) {
    const data = await readConversations();
    const before = data.conversations.length;
    data.conversations = data.conversations.filter((item) => item.id !== id);
    data.index = data.index.filter((item) => item.sessionId !== id);
    if (before !== data.conversations.length) await writeEncrypted(conversationsPath(), data, 'conversations');
    return { deleted: before !== data.conversations.length, count: data.conversations.length };
  }

  async function indexMemory(memory) {
    if (!memory || typeof memory.id !== 'string' || typeof memory.content !== 'string') return;
    const data = await readKnowledge();
    try {
      const [embedding] = await generateEmbeddings([memory.content]);
      if (!embedding) return;
      // Reabre o arquivo antes de gravar para preservar documentos ou perfil salvos em paralelo.
      const latest = await readKnowledge();
      latest.memoryEmbeddings[memory.id] = { content: memory.content, embedding };
      await writeEncrypted(knowledgePath(), latest, 'knowledge');
    } catch (error) {
      console.warn('[Aurora Memory] Não consegui criar embedding da lembrança:', error instanceof Error ? error.message : String(error));
    }
  }

  async function searchMemories(query, memories, limit = 5) {
    const data = await readKnowledge();
    let queryVector = null;
    try {
      [queryVector] = (await generateEmbeddings([query])) || [];
    } catch { /* a busca por palavras continua disponível */ }
    const results = memories.map((memory, index) => {
      const stored = data.memoryEmbeddings[memory.id];
      const semantic = queryVector && stored?.embedding ? cosineSimilarity(queryVector, stored.embedding) : 0;
      const lexical = scoreText(query, memory.content);
      return { memory, score: semantic > 0 ? semantic * 10 + lexical * 0.1 : lexical, index };
    });
    return results.filter((item) => item.score >= (queryVector ? 0.18 : 1.3))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, limit)
      .map((item) => item.memory);
  }

  async function importDocument({ name, base64, size }) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('O arquivo não tem um nome válido.');
    if (typeof base64 !== 'string' || !base64.trim()) throw new Error('O conteúdo do arquivo está vazio.');
    const cleanName = path.basename(name).slice(0, 180);
    const extension = path.extname(cleanName).toLocaleLowerCase('pt-BR');
    if (!['.txt', '.md', '.markdown', '.csv', '.json', '.pdf'].includes(extension)) {
      throw new Error('Formato não suportado. Use PDF, TXT, Markdown, CSV ou JSON.');
    }
    const encoded = base64.replace(/^data:[^;]+;base64,/, '');
    if (encoded.length > Math.ceil(MAX_DOCUMENT_BYTES * 4 / 3) + 16 || Number(size) > MAX_DOCUMENT_BYTES) {
      throw new Error('O arquivo precisa ter até 24 MB e não pode estar vazio.');
    }
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES) {
      throw new Error('O arquivo precisa ter até 24 MB e não pode estar vazio.');
    }
    let content = '';
    if (extension === '.pdf') {
      await fsp.mkdir(tempDirectory(), { recursive: true });
      const tempPath = path.join(tempDirectory(), crypto.randomUUID() + '.pdf');
      try {
        await fsp.writeFile(tempPath, bytes);
        const extracted = await execFileAsync('pdftotext', ['-layout', tempPath, '-'], {
          windowsHide: true,
          maxBuffer: 32 * 1024 * 1024,
          timeout: 90000,
          encoding: 'utf8',
        });
        content = extracted.stdout || '';
      } catch (error) {
        const detail = error && error.code === 'ENOENT'
          ? 'Para importar PDFs, instale o Poppler no Windows (com o comando pdftotext disponível no PATH). Como alternativa, exporte o PDF para TXT.'
          : 'Não consegui extrair o texto deste PDF. Ele pode estar protegido, ser apenas uma imagem digitalizada ou conter texto não extraível.';
        throw new Error(detail);
      } finally {
        await fsp.rm(tempPath, { force: true }).catch(() => undefined);
      }
    } else {
      content = bytes.toString('utf8');
    }
    content = content.replace(/\u0000/g, '').trim();
    if (content.length < 40) throw new Error('Não encontrei texto suficiente neste arquivo. PDFs digitalizados precisam de OCR antes da importação.');
    const pieces = splitIntoChunks(content);
    if (!pieces.length) throw new Error('Não consegui dividir o conteúdo do arquivo em trechos pesquisáveis.');
    const data = await readKnowledge();
    if (data.documents.length >= MAX_DOCUMENTS) throw new Error('A biblioteca atingiu o limite de 120 documentos. Remova algum material antigo.');
    const availableChunks = MAX_INDEXED_CHUNKS - data.chunks.length;
    if (pieces.length > availableChunks) {
      throw new Error('Este material geraria ' + pieces.length + ' trechos, mas só há espaço para ' + Math.max(availableChunks, 0) + '. Remova documentos antigos ou divida o arquivo em partes menores.');
    }
    const id = crypto.randomUUID();
    const document = {
      id,
      name: cleanName,
      extension,
      size: bytes.length,
      addedAt: new Date().toISOString(),
      characterCount: content.length,
      chunkCount: pieces.length,
    };
    const chunks = pieces.map((piece, index) => ({
      id: id + ':' + index,
      documentId: id,
      title: cleanName,
      content: piece.content,
      page: piece.page,
      part: piece.part,
      embedding: null,
    }));
    try {
      const vectors = await generateEmbeddingsInBatches(chunks.map((chunk) => chunk.content));
      if (vectors) chunks.forEach((chunk, index) => { chunk.embedding = vectors[index]; });
    } catch (error) {
      console.warn('[Aurora Knowledge] Documento salvo sem vetores semânticos:', error instanceof Error ? error.message : String(error));
    }
    // Preserva a identidade e outras importações que possam ter sido salvas enquanto o embedding era calculado.
    const latest = await readKnowledge();
    latest.documents = [document, ...latest.documents.filter((item) => item.id !== id)].slice(0, MAX_DOCUMENTS);
    latest.chunks = [...chunks, ...latest.chunks].slice(0, MAX_INDEXED_CHUNKS);
    await writeEncrypted(knowledgePath(), latest, 'knowledge');
    return { saved: true, document, semanticReady: chunks.some((chunk) => Array.isArray(chunk.embedding)) };
  }

  async function listDocuments() {
    const data = await readKnowledge();
    return { documents: data.documents.map(({ id, name, extension, size, addedAt, characterCount, chunkCount }) => ({ id, name, extension, size, addedAt, characterCount, chunkCount })) };
  }

  async function deleteDocument(id) {
    const data = await readKnowledge();
    const document = data.documents.find((item) => item.id === id);
    if (!document) return { deleted: false };
    data.documents = data.documents.filter((item) => item.id !== id);
    data.chunks = data.chunks.filter((item) => item.documentId !== id);
    await writeEncrypted(knowledgePath(), data, 'knowledge');
    return { deleted: true, name: document.name };
  }

  async function searchKnowledge(query, limit = 8) {
    const data = await readKnowledge();
    let queryVector = null;
    try { [queryVector] = (await generateEmbeddings([query])) || []; } catch { /* busca lexical continua disponível */ }
    return data.chunks.map((chunk, index) => {
      const semantic = queryVector && chunk.embedding ? cosineSimilarity(queryVector, chunk.embedding) : 0;
      const lexical = scoreText(query, chunk.content + ' ' + chunk.title);
      return { chunk, score: semantic > 0 ? semantic * 10 + lexical * 0.1 : lexical, index };
    })
      .filter((item) => item.score >= (queryVector ? 0.18 : 1.3))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, limit)
      .map(({ chunk }) => ({
        type: 'document',
        title: chunk.title,
        source: chunk.page ? chunk.title + ', página ' + chunk.page : chunk.title + ', trecho ' + chunk.part,
        content: chunk.content.slice(0, 1700),
      }));
  }

  async function searchContext(query, limit = 5) {
    const [conversations, knowledge] = await Promise.all([readConversations(), readKnowledge()]);
    let queryVector = null;
    try { [queryVector] = (await generateEmbeddings([query])) || []; } catch { /* recuperação por termos fica como fallback */ }
    const candidates = [
      ...knowledge.chunks.map((chunk, index) => ({
        type: 'document',
        title: chunk.title,
        source: chunk.page ? chunk.title + ', página ' + chunk.page : chunk.title + ', trecho ' + chunk.part,
        content: chunk.content,
        embedding: chunk.embedding,
        index,
      })),
      ...conversations.index.map((item, index) => ({
        type: 'conversation',
        title: item.title,
        source: 'Histórico: ' + item.title,
        content: item.text,
        embedding: item.embedding,
        index: knowledge.chunks.length + index,
      })),
    ];
    return candidates.map((item) => {
      const semantic = queryVector && item.embedding ? cosineSimilarity(queryVector, item.embedding) : 0;
      const lexical = scoreText(query, item.title + ' ' + item.content);
      return { item, score: semantic > 0 ? semantic * 10 + lexical * 0.1 : lexical };
    })
      .filter((result) => result.score >= (queryVector ? 0.2 : 1.5))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(({ item }) => ({ type: item.type, title: item.title, source: item.source, content: item.content.slice(0, 900) }));
  }

  async function reindexAll(memories = []) {
    const status = await getEmbeddingStatus(true);
    if (!status.installed) throw new Error('Instale o modelo de embeddings antes de reconstruir a busca inteligente.');
    const knowledge = await readKnowledge();
    const conversations = await readConversations();
    const pending = [];
    const apply = [];
    for (const chunk of knowledge.chunks) {
      if (!Array.isArray(chunk.embedding)) {
        pending.push(chunk.content);
        apply.push((vector) => { chunk.embedding = vector; });
      }
    }
    for (const item of conversations.index) {
      if (!Array.isArray(item.embedding)) {
        pending.push(item.text);
        apply.push((vector) => { item.embedding = vector; });
      }
    }
    for (const memory of memories) {
      if (!knowledge.memoryEmbeddings[memory.id]?.embedding) {
        pending.push(memory.content);
        apply.push((vector) => { knowledge.memoryEmbeddings[memory.id] = { content: memory.content, embedding: vector }; });
      }
    }
    for (let offset = 0; offset < pending.length; offset += 24) {
      const vectors = await generateEmbeddings(pending.slice(offset, offset + 24));
      if (!vectors) break;
      vectors.forEach((vector, index) => apply[offset + index](vector));
      onEmbeddingStatus({ state: 'indexing', completed: Math.min(offset + vectors.length, pending.length), total: pending.length });
    }
    await Promise.all([
      writeEncrypted(knowledgePath(), knowledge, 'knowledge'),
      writeEncrypted(conversationsPath(), conversations, 'conversations'),
    ]);
    return { indexed: pending.length, documents: knowledge.documents.length, conversations: conversations.conversations.length };
  }

  async function installEmbeddingModel(memories = []) {
    const status = await getEmbeddingStatus(true);
    if (status.installed) {
      onEmbeddingStatus({ state: 'indexing', message: 'Reconstruindo o índice semântico…' });
      const result = await reindexAll(memories);
      onEmbeddingStatus({ state: 'ready', message: 'Busca semântica pronta.' });
      return { installed: true, ...result };
    }
    const response = await fetch(baseUrl + '/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60 * 60 * 1000),
      body: JSON.stringify({ model: EMBEDDING_MODEL, stream: true }),
    });
    if (!response.ok || !response.body) throw new Error('Ollama não conseguiu baixar o modelo de embeddings. Verifique sua conexão e tente novamente.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let progress;
        try { progress = JSON.parse(line); } catch { continue; }
        if (progress.error) throw new Error(String(progress.error));
        const total = Number(progress.total) || 0;
        const completed = Number(progress.completed) || 0;
        onEmbeddingStatus({
          state: 'downloading',
          message: String(progress.status || 'Baixando modelo de busca…'),
          percent: total > 0 ? Math.round(completed / total * 100) : null,
        });
      }
    }
    embeddingAvailability = { checkedAt: Date.now(), installed: false, model: EMBEDDING_MODEL };
    const installed = await getEmbeddingStatus(true);
    if (!installed.installed) throw new Error('O download terminou, mas o modelo de embeddings não apareceu na lista do Ollama.');
    onEmbeddingStatus({ state: 'indexing', message: 'Criando índices de documentos, conversas e lembranças…' });
    const result = await reindexAll(memories);
    onEmbeddingStatus({ state: 'ready', message: 'Busca semântica pronta.' });
    return { installed: true, ...result };
  }

  async function getIdentityProfile() {
    const data = await readKnowledge();
    return data.identityProfile;
  }

  async function saveIdentityProfile(raw = {}) {
    const data = await readKnowledge();
    const current = data.identityProfile;
    data.identityProfile = {
      name: String(raw.name || current.name).trim().slice(0, 80) || 'Aurora',
      avatar: String(raw.avatar || current.avatar).trim().slice(0, 120) || 'Live2D 6xb',
      appearanceDescription: String(raw.appearanceDescription || '').trim().slice(0, 2500),
      personality: String(raw.personality || current.personality).trim().slice(0, 1200),
    };
    await writeEncrypted(knowledgePath(), data, 'knowledge');
    return data.identityProfile;
  }

  return {
    getIdentityProfile,
    saveIdentityProfile,
    createConversation,
    saveConversation,
    listConversations,
    loadConversation,
    deleteConversation,
    importDocument,
    listDocuments,
    deleteDocument,
    searchKnowledge,
    searchContext,
    indexMemory,
    searchMemories,
    getEmbeddingStatus,
    installEmbeddingModel,
    reindexAll,
  };
}

module.exports = { createAuroraStore, EMBEDDING_MODEL };
