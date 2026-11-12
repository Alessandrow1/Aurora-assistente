'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEdgeTtsSpeech, DEFAULT_EDGE_TTS_CONFIG, normalizeEdgeTtsPronunciation } = require('./aurora-edge-tts.cjs');

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


test('normalizes tsundere interjections into forms the neural voice can pronounce', () => {
  assert.equal(normalizeEdgeTtsPronunciation('Hã?!'), 'Hã?');
  assert.equal(normalizeEdgeTtsPronunciation('Tch!'), 'Tchi!');
  assert.equal(normalizeEdgeTtsPronunciation('Hã?! O que foi? Tch!'), 'Hã? O que foi? Tchi!');
  assert.equal(normalizeEdgeTtsPronunciation('Isso é sério?'), 'Isso é sério?');
});

test('sends pronounceable interjections to the Edge neural engine', async () => {
  let capturedText = '';
  class FakeEdgeTTS {
    async *streamAudio(text) {
      capturedText = text;
      yield Buffer.from('ID3' + 'a'.repeat(100));
    }
  }
  const engine = createEdgeTtsSpeech({ EdgeTTS: FakeEdgeTTS });
  await engine.synthesize('Hã?! Tch!');
  assert.equal(capturedText, 'Hã? Tchi!');
});

test('rejects empty text and a stream without usable audio', async () => {
  class EmptyEdgeTTS {
    async *streamAudio() { yield { part: 'sem áudio', start: 0, end: 100 }; }
  }
  const engine = createEdgeTtsSpeech({ EdgeTTS: EmptyEdgeTTS });
  await assert.rejects(() => engine.synthesize('   '), /Não há texto/);
  await assert.rejects(() => engine.synthesize('Olá'), /não retornou áudio/);
});

test('tenta de novo quando o serviço responde 429 e entrega o áudio', async () => {
  let calls = 0;
  class ThrottledEdgeTTS {
    async *streamAudio() {
      calls += 1;
      if (calls < 3) throw new Error('Unexpected server response: 429');
      yield Buffer.from('ID3' + 'a'.repeat(100));
    }
  }
  const engine = createEdgeTtsSpeech({ EdgeTTS: ThrottledEdgeTTS, retryDelayMs: 1 });
  const audio = await engine.synthesize('Olá');
  assert.equal(calls, 3);
  assert.ok(audio.length > 100);
});

test('desiste depois das tentativas e não repete erros que não são temporários', async () => {
  let calls = 0;
  class AlwaysThrottled { async *streamAudio() { calls += 1; throw new Error('Unexpected server response: 429'); } }
  const engine = createEdgeTtsSpeech({ EdgeTTS: AlwaysThrottled, retryDelayMs: 1 });
  await assert.rejects(() => engine.synthesize('Olá'), /429/);
  assert.equal(calls, 3);

  let invalidCalls = 0;
  class InvalidVoice { async *streamAudio() { invalidCalls += 1; throw new Error('voz inexistente'); } }
  await assert.rejects(() => createEdgeTtsSpeech({ EdgeTTS: InvalidVoice, retryDelayMs: 1 }).synthesize('Olá'), /voz inexistente/);
  assert.equal(invalidCalls, 1);
});
