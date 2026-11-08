const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAuroraStore } = require('./aurora-store.cjs');

let root;
let store;
let originalFetch;

function makeSafeStorage() {
  return {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value) => Buffer.from('TEST-ENCRYPTED:' + value, 'utf8'),
    decryptStringAsync: async (buffer) => ({
      result: Buffer.from(buffer).toString('utf8').replace(/^TEST-ENCRYPTED:/, ''),
      shouldReEncrypt: false,
    }),
  };
}

test.beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-memory-test-'));
  originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ models: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  store = createAuroraStore({
    app: { getPath: () => root },
    safeStorage: makeSafeStorage(),
    ollamaUrl: 'http://127.0.0.1:11434',
  });
});

test.afterEach(async () => {
  global.fetch = originalFetch;
  await fs.rm(root, { recursive: true, force: true });
});

test('creates, saves, restores, searches and deletes a conversation', async () => {
  const created = await store.createConversation();
  assert.ok(created.id);

  const saved = await store.saveConversation({
    id: created.id,
    title: 'Nova conversa',
    messages: [
      { role: 'user', content: 'Vamos continuar o projeto Dr!nk de motoristas designados em São Paulo.' },
      { role: 'assistant', content: 'Vamos retomar a validação jurídica e a busca por um sócio.' },
    ],
  });
  assert.equal(saved.saved, true);
  assert.match(saved.conversation.title, /projeto Dr!nk/i);
  assert.equal(saved.conversation.messageCount, 2);

  const restored = await store.loadConversation(created.id);
  assert.equal(restored.found, true);
  assert.equal(restored.conversation.messages.length, 2);

  const results = await store.listConversations('motoristas designados');
  assert.equal(results.conversations.length, 1);
  assert.equal(results.conversations[0].id, created.id);

  const removed = await store.deleteConversation(created.id);
  assert.equal(removed.deleted, true);
  assert.equal((await store.loadConversation(created.id)).found, false);
});

test('imports, searches and deletes a local text document', async () => {
  const text = 'Este material explica os fundamentos de motoristas designados, segurança viária, validação operacional e responsabilidade civil.';
  const imported = await store.importDocument({
    name: 'guia-motorista.txt',
    base64: Buffer.from(text, 'utf8').toString('base64'),
    size: Buffer.byteLength(text, 'utf8'),
  });
  assert.equal(imported.saved, true);
  assert.equal(imported.document.name, 'guia-motorista.txt');
  assert.equal(imported.document.chunkCount, 1);

  const search = await store.searchKnowledge('segurança viária responsabilidade civil');
  assert.equal(search.length, 1);
  assert.match(search[0].source, /guia-motorista\.txt/);
  assert.match(search[0].content, /segurança viária/);

  const removed = await store.deleteDocument(imported.document.id);
  assert.equal(removed.deleted, true);
  assert.equal((await store.listDocuments()).documents.length, 0);
});

test('stores the official Aurora identity profile', async () => {
  const initial = await store.getIdentityProfile();
  assert.equal(initial.name, 'Aurora');

  const saved = await store.saveIdentityProfile({
    name: 'Aurora',
    avatar: 'Live2D 6xb',
    appearanceDescription: 'Cabelos longos castanhos, olhos grandes e roupa escura.',
    personality: 'Curiosa, brincalhona e atenciosa.',
  });
  assert.match(saved.appearanceDescription, /cabelos longos/i);

  const restored = await store.getIdentityProfile();
  assert.equal(restored.avatar, 'Live2D 6xb');
  assert.equal(restored.personality, 'Curiosa, brincalhona e atenciosa.');
});

test('rejects unsupported files and oversized document payloads', async () => {
  await assert.rejects(
    store.importDocument({ name: 'imagem.exe', base64: Buffer.from('arquivo').toString('base64'), size: 7 }),
    /Formato não suportado/,
  );
  await assert.rejects(
    store.importDocument({ name: 'grande.txt', base64: 'A'.repeat(34 * 1024 * 1024), size: 25 * 1024 * 1024 }),
    /24 MB/,
  );
});

test('uses lexical-only memory lookup without an Ollama embedding request', async () => {
  let requestCount = 0;
  global.fetch = async () => {
    requestCount += 1;
    throw new Error('A busca lexical não deve chamar o Ollama.');
  };

  const memories = [
    { id: 'drink-project', content: 'O projeto Dr!nk é um serviço de motorista designado.' },
    { id: 'study-goal', content: 'Estou estudando para um concurso público.' },
  ];

  const results = await store.searchMemories('projeto Dr!nk', memories, 2, { semantic: false });

  assert.equal(requestCount, 0);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'drink-project');
});

test('requires protected storage before writing encrypted records', async () => {
  const unavailableStore = createAuroraStore({
    app: { getPath: () => root },
    safeStorage: {
      isAsyncEncryptionAvailable: async () => false,
      encryptStringAsync: async () => Buffer.alloc(0),
      decryptStringAsync: async () => ({ result: '', shouldReEncrypt: false }),
    },
    ollamaUrl: 'http://127.0.0.1:11434',
  });
  await assert.rejects(unavailableStore.createConversation(), /armazenamento seguro/);
});


test('reuses one shared query embedding across memory and context searches', async () => {
  let embedRequests = 0;
  let tagsRequests = 0;

  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/tags')) {
      tagsRequests += 1;
      return new Response(JSON.stringify({
        models: [{ name: 'nomic-embed-text:latest' }],
      }), { status: 200 });
    }

    if (String(url).endsWith('/api/embed')) {
      embedRequests += 1;
      const body = JSON.parse(options.body);
      assert.deepEqual(body.input, ['Aurora e memoria']);

      return new Response(JSON.stringify({
        embeddings: [[1, 0, 0]],
      }), { status: 200 });
    }

    throw new Error('Unexpected Ollama request: ' + url);
  };

  const vector = await store.createQueryEmbedding('Aurora e memoria');
  assert.deepEqual(vector, [1, 0, 0]);

  await store.searchMemories(
    'Aurora e memoria',
    [{ id: 'aurora', content: 'Aurora e memoria inteligente.' }],
    3,
    { queryEmbedding: vector },
  );

  await store.searchContext(
    'Aurora e memoria',
    3,
    { queryEmbedding: vector },
  );

  assert.equal(tagsRequests, 1);
  assert.equal(embedRequests, 1);
});

test('uses lexical fallback when the shared query embedding is unavailable', async () => {
  let requestCount = 0;

  global.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ models: [] }), {
      status: 200,
    });
  };

  const vector = await store.createQueryEmbedding('projeto Aurora');
  assert.equal(vector, null);

  const memories = [
    { id: 'aurora', content: 'Projeto Aurora assistente local.' },
    { id: 'other', content: 'Outro assunto sem relacao.' },
  ];

  const results = await store.searchMemories(
    'projeto Aurora',
    memories,
    2,
    { queryEmbedding: vector },
  );

  await store.searchContext(
    'projeto Aurora',
    3,
    { queryEmbedding: vector },
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'aurora');
  assert.equal(requestCount, 1);
});
