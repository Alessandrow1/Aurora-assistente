'use strict';

const DEFAULT_EDGE_TTS_CONFIG = Object.freeze({
  voice: 'pt-BR-ThalitaMultilingualNeural',
  lang: 'pt-BR',
  outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
  timeout: 12000,
});

/**
 * Free neural Brazilian Portuguese TTS through the Microsoft Edge online service.
 * Audio is consumed from the package's streaming generator and assembled per
 * sentence so the renderer can begin playback without waiting for Kokoro CPU inference.
 */
function createEdgeTtsSpeech({ EdgeTTS = null, config = DEFAULT_EDGE_TTS_CONFIG } = {}) {
  let client = null;

  function getClient() {
    if (client) return client;
    const EdgeTtsClass = EdgeTTS || require('node-edge-tts').EdgeTTS;
    if (typeof EdgeTtsClass !== 'function') {
      throw new Error('O pacote node-edge-tts não disponibilizou a classe EdgeTTS.');
    }
    client = new EdgeTtsClass({ ...config });
    if (typeof client.streamAudio !== 'function') {
      throw new Error('A versão instalada do node-edge-tts não oferece streamAudio(). Atualize as dependências do projeto.');
    }
    return client;
  }

  async function synthesize(rawText) {
    const text = typeof rawText === 'string' ? rawText.trim().slice(0, 4200) : '';
    if (!text) throw new Error('Não há texto para sintetizar com a voz neural gratuita.');

    const chunks = [];
    for await (const item of getClient().streamAudio(text)) {
      // Com saveSubtitles=false, normalmente chegam apenas buffers de áudio.
      // Ignorar metadados torna o módulo compatível com ambas as respostas.
      if (Buffer.isBuffer(item) && item.length > 0) chunks.push(item);
    }

    const audio = Buffer.concat(chunks);
    if (audio.length < 100) {
      throw new Error('Microsoft Edge TTS não retornou áudio MP3 suficiente.');
    }
    return audio;
  }

  return { synthesize };
}

module.exports = { DEFAULT_EDGE_TTS_CONFIG, createEdgeTtsSpeech };
