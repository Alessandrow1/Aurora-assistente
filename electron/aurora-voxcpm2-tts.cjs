'use strict';

const DEFAULT_TIMEOUT_MS = 90000;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

function validateEndpoint(value) {
  let url;

  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('Informe um endereço válido para o servidor VoxCPM2.');
  }

  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) {
    throw new Error('O servidor VoxCPM2 precisa usar HTTPS. HTTP só é permitido em localhost.');
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error('O endereço do VoxCPM2 não pode conter credenciais, parâmetros ou fragmentos.');
  }

  return url.toString();
}

async function readLimitedBody(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length') || 0);

  if (declaredLength > maxBytes) {
    throw new Error('A resposta do servidor VoxCPM2 excede o limite permitido.');
  }

  if (!response.body) {
    throw new Error('O servidor VoxCPM2 retornou uma resposta vazia.');
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = Buffer.from(value);
      total += chunk.length;

      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('A resposta do servidor VoxCPM2 excede o limite permitido.');
      }

      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, total);
}
function createVoxCpm2Tts(options = {}) {
  const request = options.fetch || globalThis.fetch;

  if (typeof request !== 'function') {
    throw new Error('O ambiente não oferece suporte a requisições HTTP.');
  }

  async function synthesize(text, config = {}) {
    const cleanText = typeof text === 'string' ? text.trim() : '';

    if (!cleanText) {
      throw new Error('Não há texto para transformar em fala.');
    }

    if (cleanText.length > 4200) {
      throw new Error('O texto excede o limite de 4200 caracteres.');
    }

    const endpoint = validateEndpoint(config.endpoint);
    const token = typeof config.token === 'string' ? config.token.trim() : '';

    if (token.length < 8 || token.length > 4096 || /\s/.test(token)) {
      throw new Error('O token do servidor VoxCPM2 está ausente ou inválido.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs || DEFAULT_TIMEOUT_MS
    );

    try {
      const response = await request(new URL('/synthesize', endpoint).toString(), {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          Accept: 'audio/wav, audio/mpeg, application/json',
        },
        body: JSON.stringify({ text: cleanText }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        throw new Error(
          'Servidor VoxCPM2 respondeu HTTP ' + response.status +
          (detail ? ': ' + detail : '.')
        );
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();

      if (contentType.includes('application/json')) {
        const jsonBytes = await readLimitedBody(response, Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 65536);
        const payload = JSON.parse(jsonBytes.toString('utf8'));
        const encoded = typeof payload.audioBase64 === 'string'
          ? payload.audioBase64
          : '';

        if (!encoded || encoded.length > Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 16) {
          throw new Error('O servidor VoxCPM2 retornou áudio Base64 vazio ou muito grande.');
        }

        const audio = Buffer.from(encoded, 'base64');

        if (!audio.length || audio.length > MAX_AUDIO_BYTES) {
          throw new Error('O áudio retornado pelo VoxCPM2 é inválido ou excede 20 MB.');
        }

        const mime = typeof payload.audioMimeType === 'string'
          ? payload.audioMimeType.toLowerCase()
          : 'audio/wav';

        if (!['audio/wav', 'audio/x-wav', 'audio/mpeg'].includes(mime)) {
          throw new Error('O servidor VoxCPM2 retornou um formato de áudio não suportado.');
        }

        return {
          audioBase64: audio.toString('base64'),
          audioMimeType: mime,
          voice: typeof payload.voice === 'string' ? payload.voice.slice(0, 100) : 'VoxCPM2',
          provider: 'voxcpm2',
        };
      }

      if (!['audio/wav', 'audio/x-wav', 'audio/mpeg'].some((mime) => contentType.includes(mime))) {
        throw new Error('O servidor VoxCPM2 não retornou WAV, MP3 ou JSON de áudio.');
      }

      const declaredLength = Number(response.headers.get('content-length') || 0);

      if (declaredLength > MAX_AUDIO_BYTES) {
        throw new Error('O áudio retornado pelo VoxCPM2 excede 20 MB.');
      }

      const audio = await readLimitedBody(response, MAX_AUDIO_BYTES);

      if (!audio.length || audio.length > MAX_AUDIO_BYTES) {
        throw new Error('O áudio retornado pelo VoxCPM2 é vazio ou excede 20 MB.');
      }

      return {
        audioBase64: audio.toString('base64'),
        audioMimeType: contentType.includes('mpeg') ? 'audio/mpeg' : 'audio/wav',
        voice: 'VoxCPM2',
        provider: 'voxcpm2',
      };
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new Error('O servidor VoxCPM2 demorou mais de ' +
          Math.round((options.timeoutMs || DEFAULT_TIMEOUT_MS) / 1000) +
          ' segundos para responder.');
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { synthesize };
}

module.exports = {
  createVoxCpm2Tts,
  validateEndpoint,
  DEFAULT_TIMEOUT_MS,
  MAX_AUDIO_BYTES,
};


