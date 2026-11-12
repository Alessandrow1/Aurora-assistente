'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVoiceOptions } = require('./aurora-cli.cjs');

test('o padrão é o VAD com pausa de 1400 ms', () => {
  assert.deepEqual(parseVoiceOptions(['electron', '.'], {}), { mode: 'vad', vadPauseMs: 1400, warnings: [] });
});

test('aceita --modo-voz=botao (com ou sem acento) e a variável de ambiente', () => {
  assert.equal(parseVoiceOptions(['electron', '.', '--modo-voz=botao'], {}).mode, 'botao');
  assert.equal(parseVoiceOptions(['electron', '.', '--modo-voz=Botão'], {}).mode, 'botao');
  assert.equal(parseVoiceOptions(['electron', '.'], { AURORA_MODO_VOZ: 'botao' }).mode, 'botao');
  assert.equal(parseVoiceOptions(['electron', '.', '--modo-voz=vad'], { AURORA_MODO_VOZ: 'botao' }).mode, 'vad', 'a linha de comando vence');
});

test('aceita uma pausa do VAD dentro do intervalo e recusa valores absurdos', () => {
  assert.equal(parseVoiceOptions(['--vad-pausa-ms=2000'], {}).vadPauseMs, 2000);
  assert.equal(parseVoiceOptions([], { AURORA_VAD_PAUSA_MS: '900' }).vadPauseMs, 900);
  const tooShort = parseVoiceOptions(['--vad-pausa-ms=50'], {});
  assert.equal(tooShort.vadPauseMs, 1400);
  assert.equal(tooShort.warnings.length, 1);
});

test('modo desconhecido volta para o VAD com aviso', () => {
  const result = parseVoiceOptions(['--modo-voz=telepatia'], {});
  assert.equal(result.mode, 'vad');
  assert.match(result.warnings[0], /desconhecido/);
});
