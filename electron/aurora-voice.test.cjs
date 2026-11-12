'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  choosePreferredModel,
  isElevenLabsQuotaExceeded,
  isExplicitDeepDiveRequest,
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

test('voz usa sempre o modelo das Configurações; imagem e estudo usam o 9B', () => {
  assert.equal(choosePreferredModel({ fastVoiceTurn: true, voiceMode: true }), 'qwen3.5:9b');
  assert.equal(choosePreferredModel({ conciseVoiceTurn: true, voiceMode: true, needsThinking: true }), 'qwen3.5:9b');
  assert.equal(choosePreferredModel({ voiceMode: true, needsStoredContext: true }), 'qwen3.5:9b');
  assert.equal(choosePreferredModel({ fastVoiceTurn: true, voiceMode: true, settingsModel: 'qwen3.5:2b' }), 'qwen3.5:2b');
  assert.equal(choosePreferredModel({ voiceMode: true, needsFactualKnowledge: true, settingsModel: 'qwen3.5:2b' }), 'qwen3.5:2b');
  assert.equal(choosePreferredModel({ voiceMode: true, hasImage: true, settingsModel: 'qwen3.5:2b' }), 'qwen3.5:9b');
  assert.equal(choosePreferredModel({ voiceMode: true, studyMode: true, settingsModel: 'qwen3.5:2b' }), 'qwen3.5:9b');
  assert.equal(choosePreferredModel({ needsThinking: true, settingsModel: 'qwen3.5:2b' }), 'qwen3.5:9b');
  assert.equal(choosePreferredModel({ voiceMode: false, settingsModel: 'qwen3.5:4b' }), 'qwen3.5:4b');
});

test('keeps ordinary follow-up questions concise and expands only on explicit request', () => {
  assert.equal(isExplicitDeepDiveRequest('Quantos planetas existem no Sistema Solar?'), false);
  assert.equal(isExplicitDeepDiveRequest('Quais são?'), false);
  assert.equal(isExplicitDeepDiveRequest('Tem mais que 8?'), false);
  assert.equal(isExplicitDeepDiveRequest('Me ensina mitose e meiose'), false);
  assert.equal(isExplicitDeepDiveRequest('Me explica melhor'), true);
  assert.equal(isExplicitDeepDiveRequest('Explica detalhadamente'), true);
  assert.equal(isExplicitDeepDiveRequest('Quero entender melhor, passo a passo'), true);
  assert.equal(isExplicitDeepDiveRequest('Pode aprofundar com exemplos?'), true);
});

test('detects exhausted ElevenLabs quota without treating other errors as quota exhaustion', () => {
  assert.equal(isElevenLabsQuotaExceeded('ElevenLabs HTTP 401: quota_exceeded'), true);
  assert.equal(isElevenLabsQuotaExceeded(new Error('This request exceeds your quota; 7 credits remaining')), true);
  assert.equal(isElevenLabsQuotaExceeded('invalid_api_key'), false);
  assert.equal(isElevenLabsQuotaExceeded('network timeout'), false);
});

test('foldPortuguese preserva letras e dígitos ao remover acentos (regressão do escape duplo)', () => {
  const { foldPortuguese } = require('./aurora-voice.cjs');
  assert.equal(foldPortuguese('Quem foi Santos Dumont?'), 'quem foi santos dumont');
  assert.equal(foldPortuguese('Como funciona o futebol?'), 'como funciona o futebol');
  assert.equal(foldPortuguese('Calcule 15 vezes 4'), 'calcule 15 vezes 4');
  assert.equal(foldPortuguese('Por que o céu é azul?'), 'por que o ceu e azul');
});
