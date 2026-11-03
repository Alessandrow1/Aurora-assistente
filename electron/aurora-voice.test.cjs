'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  choosePreferredModel,
  isElevenLabsQuotaExceeded,
  isVoiceHearingCheck,
  normalizeVoiceTranscript,
} = require('./aurora-voice.cjs');

test('corrige variantes recorrentes do Whisper em testes de microfone', () => {
  assert.equal(normalizeVoiceTranscript('Oi, tá meu vindo?'), 'Oi, tá me ouvindo?');
  assert.equal(normalizeVoiceTranscript('ta meu vindo'), 'Tá me ouvindo?');
  assert.equal(normalizeVoiceTranscript('Olá, você tá me ouvido?'), 'Olá, tá me ouvindo?');
  assert.equal(normalizeVoiceTranscript('OPA tá me vindo!'), 'Opa, tá me ouvindo?');
  assert.equal(normalizeVoiceTranscript('Oi, você está me ouvindo agora?'), 'Oi, tá me ouvindo?');
  assert.equal(normalizeVoiceTranscript('E aí, consegue me ouvir?'), 'E aí, tá me ouvindo?');
});

test('reconhece perguntas de áudio mesmo com palavras confundidas pelo Whisper', () => {
  assert.equal(isVoiceHearingCheck('Oi, tá meu vindo?'), true);
  assert.equal(isVoiceHearingCheck('Oi, tá me ouvindo?'), true);
  assert.equal(isVoiceHearingCheck('Você está me ouvindo agora?'), true);
  assert.equal(isVoiceHearingCheck('Consegue me ouvir?'), true);
  assert.equal(isVoiceHearingCheck('Meu arquivo está vindo de outra pasta.'), false);
  assert.equal(isVoiceHearingCheck('Oi, tudo bem?'), false);
});

test('preserva transcrições que não correspondem ao erro conhecido', () => {
  assert.equal(normalizeVoiceTranscript('Oi, tudo bem?'), 'Oi, tudo bem?');
  assert.equal(normalizeVoiceTranscript('Meu arquivo está vindo de outra pasta.'), 'Meu arquivo está vindo de outra pasta.');
  assert.equal(normalizeVoiceTranscript(''), '');
});

test('uses 2b for casual voice and 9b for demanding voice or study turns', () => {
  assert.equal(choosePreferredModel({ fastVoiceTurn: true, voiceMode: true }), 'qwen3.5:2b');
  assert.equal(choosePreferredModel({ fastVoiceTurn: false, voiceMode: true }), 'qwen3.5:9b');
  assert.equal(choosePreferredModel({ fastVoiceTurn: false, voiceMode: true, needsExplanation: true }), 'qwen3.5:9b');
  assert.equal(choosePreferredModel({ fastVoiceTurn: false, voiceMode: true, needsStoredContext: true }), 'qwen3.5:9b');
  assert.equal(choosePreferredModel({ fastVoiceTurn: false, voiceMode: true, hasImage: true }), 'qwen3.5:9b');
  assert.equal(choosePreferredModel({ fastVoiceTurn: false, needsThinking: true }), 'qwen3.5:9b');
  assert.equal(choosePreferredModel({ fastVoiceTurn: false, voiceMode: false, settingsModel: 'qwen3.5:4b' }), 'qwen3.5:4b');
});

test('detects exhausted ElevenLabs quota without treating other errors as quota exhaustion', () => {
  assert.equal(isElevenLabsQuotaExceeded('ElevenLabs HTTP 401: quota_exceeded'), true);
  assert.equal(isElevenLabsQuotaExceeded(new Error('This request exceeds your quota; 7 credits remaining')), true);
  assert.equal(isElevenLabsQuotaExceeded('invalid_api_key'), false);
  assert.equal(isElevenLabsQuotaExceeded('network timeout'), false);
});
