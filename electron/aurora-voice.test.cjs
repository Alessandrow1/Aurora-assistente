'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeVoiceTranscript } = require('./aurora-voice.cjs');

test('corrige a falha recorrente do Whisper em testes de microfone', () => {
  assert.equal(normalizeVoiceTranscript('Oi, tá meu vindo?'), 'Oi, tá me ouvindo?');
  assert.equal(normalizeVoiceTranscript('ta meu vindo'), 'Tá me ouvindo?');
  assert.equal(normalizeVoiceTranscript('Olá, você tá me ouvido?'), 'Olá, tá me ouvindo?');
  assert.equal(normalizeVoiceTranscript('OPA tá me vindo!'), 'Opa, tá me ouvindo?');
});

test('preserva transcrições que não correspondem ao erro conhecido', () => {
  assert.equal(normalizeVoiceTranscript('Oi, tudo bem?'), 'Oi, tudo bem?');
  assert.equal(normalizeVoiceTranscript('Meu arquivo está vindo de outra pasta.'), 'Meu arquivo está vindo de outra pasta.');
  assert.equal(normalizeVoiceTranscript(''), '');
});
