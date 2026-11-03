'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEdgeTtsSpeech, DEFAULT_EDGE_TTS_CONFIG } = require('./aurora-edge-tts.cjs');

test('configures a Brazilian Portuguese neural Edge voice without API credentials', () => {
  assert.equal(DEFAULT_EDGE_TTS_CONFIG.voice, 'pt-BR-ThalitaMultilingualNeural');
  assert.equal(DEFAULT_EDGE_TTS_CONFIG.lang, 'pt-BR');
  assert.equal(DEFAULT_EDGE_TTS_CONFIG.outputFormat, 'audio-24khz-96kbitrate-mono-mp3');
  assert.equal(DEFAULT_EDGE_TTS_CONFIG.pitch, '+12%');
  assert.ok(DEFAULT_EDGE_TTS_CONFIG.timeout >= 10000);
});

test('assembles streamed Edge audio buffers and ignores subtitle metadata', async () => {
  let capturedConfig;
  let capturedText;
  class FakeEdgeTTS {
    constructor(config) { capturedConfig = config; }
    async *streamAudio(text) {
      capturedText = text;
      yield Buffer.from('ID3' + 'a'.repeat(100));
      yield { part: 'Olá', start: 0, end: 200 };
      yield Buffer.from('b'.repeat(100));
    }
  }

  const engine = createEdgeTtsSpeech({ EdgeTTS: FakeEdgeTTS });
  const audio = await engine.synthesize('  Olá, Aurora!  ');
  assert.deepEqual(capturedConfig, DEFAULT_EDGE_TTS_CONFIG);
  assert.equal(capturedText, 'Olá, Aurora!');
  assert.equal(audio.length, 203);
  assert.equal(audio.subarray(0, 3).toString(), 'ID3');
});

test('rejects empty text and a stream without usable audio', async () => {
  class EmptyEdgeTTS {
    async *streamAudio() { yield { part: 'sem áudio', start: 0, end: 100 }; }
  }
  const engine = createEdgeTtsSpeech({ EdgeTTS: EmptyEdgeTTS });
  await assert.rejects(() => engine.synthesize('   '), /Não há texto/);
  await assert.rejects(() => engine.synthesize('Olá'), /não retornou áudio/);
});
