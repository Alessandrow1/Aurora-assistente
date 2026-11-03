'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
