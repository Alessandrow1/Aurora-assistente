'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createVoxCpm2Tts,
  validateEndpoint,
} = require('./aurora-voxcpm2-tts.cjs');

const CONFIG = {
  endpoint: 'https://example.com/v1/tts',
  token: 'token-de-teste-123456',
};

test('accepts HTTPS and local development endpoints', () => {
  assert.equal(validateEndpoint('https://example.com/v1/tts'), 'https://example.com/v1/tts');
  assert.equal(validateEndpoint('http://localhost:8000/tts'), 'http://localhost:8000/tts');
  assert.equal(validateEndpoint('http://127.0.0.1:8000/tts'), 'http://127.0.0.1:8000/tts');
});

test('rejects insecure or malformed endpoints', () => {
  assert.throws(() => validateEndpoint('http://example.com/tts'), /HTTPS/);
  assert.throws(() => validateEndpoint('not-a-url'), /endereço válido/);
  assert.throws(() => validateEndpoint('https://user:pass@example.com/tts'), /credenciais/);
  assert.throws(() => validateEndpoint('https://example.com/tts?token=123'), /parâmetros/);
});

test('sends text and bearer token and returns binary WAV audio', async () => {
  let capturedUrl;
  let capturedOptions;

  const engine = createVoxCpm2Tts({
    fetch: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;

      return new Response(Buffer.from('RIFF-test-audio'), {
        status: 200,
        headers: { 'content-type': 'audio/wav' },
      });
    },
  });

  const result = await engine.synthesize('  Olá, Aurora!  ', CONFIG);

  assert.equal(capturedUrl, 'https://example.com/synthesize');
  assert.equal(capturedOptions.method, 'POST');
  assert.equal(capturedOptions.headers.Authorization, 'Bearer ' + CONFIG.token);
  assert.deepEqual(JSON.parse(capturedOptions.body), { text: 'Olá, Aurora!' });
  assert.equal(Buffer.from(result.audioBase64, 'base64').toString(), 'RIFF-test-audio');
  assert.equal(result.audioMimeType, 'audio/wav');
  assert.equal(result.provider, 'voxcpm2');
});

test('accepts JSON Base64 audio responses', async () => {
  const audio = Buffer.from('RIFF-json-audio').toString('base64');

  const engine = createVoxCpm2Tts({
    fetch: async () => new Response(JSON.stringify({
      audioBase64: audio,
      audioMimeType: 'audio/wav',
      voice: 'Miki',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });

  const result = await engine.synthesize('Teste de voz', CONFIG);

  assert.equal(Buffer.from(result.audioBase64, 'base64').toString(), 'RIFF-json-audio');
  assert.equal(result.voice, 'Miki');
  assert.equal(result.provider, 'voxcpm2');
});

test('rejects empty text and invalid credentials', async () => {
  const engine = createVoxCpm2Tts({
    fetch: async () => {
      throw new Error('Não deveria chamar o servidor.');
    },
  });

  await assert.rejects(() => engine.synthesize('   ', CONFIG), /Não há texto/);
  await assert.rejects(() => engine.synthesize('Olá', {
    ...CONFIG,
    token: 'curto',
  }), /token.*inválido/i);
});

test('reports HTTP errors without silently returning fallback audio', async () => {
  const engine = createVoxCpm2Tts({
    fetch: async () => new Response('GPU indisponível', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    }),
  });

  await assert.rejects(
    () => engine.synthesize('Olá', CONFIG),
    /HTTP 503.*GPU indisponível/
  );
});

test('rejects unsupported audio formats', async () => {
  const engine = createVoxCpm2Tts({
    fetch: async () => new Response('arquivo', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  });

  await assert.rejects(
    () => engine.synthesize('Olá', CONFIG),
    /não retornou WAV/
  );
});


test('respeita o limite de tempo informado na própria chamada', async () => {
  const engine = createVoxCpm2Tts({
    fetch: (_url, requestOptions) => new Promise((_resolve, reject) => {
      requestOptions.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });
  const started = Date.now();
  await assert.rejects(
    engine.synthesize('olá', { ...CONFIG, timeoutMs: 60 }),
    /demorou mais de/,
  );
  assert.ok(Date.now() - started < 2000, 'deve abortar rápido, sem esperar os 90 s padrão');
});
