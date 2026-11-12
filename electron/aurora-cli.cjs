'use strict';

const DEFAULT_VAD_PAUSE_MS = 1400;

function readOption(argv, name) {
  const prefix = '--' + name + '=';
  const found = (argv || []).find((arg) => typeof arg === 'string' && arg.startsWith(prefix));
  return found === undefined ? undefined : found.slice(prefix.length);
}

function normalizeMode(raw) {
  const value = String(raw || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (value === 'vad' || value === 'auto' || value === 'automatico') return 'vad';
  if (value === 'botao' || value === 'button' || value === 'ptt') return 'botao';
  return null;
}

function parseVoiceOptions(argv = process.argv, env = process.env) {
  const warnings = [];
  const rawMode = readOption(argv, 'modo-voz') ?? env.AURORA_MODO_VOZ;
  let mode = 'vad';
  if (rawMode !== undefined && String(rawMode).trim() !== '') {
    const normalized = normalizeMode(rawMode);
    if (normalized) mode = normalized;
    else warnings.push('Modo de voz "' + rawMode + '" desconhecido; usando "vad". Use --modo-voz=vad ou --modo-voz=botao.');
  }

  const rawPause = readOption(argv, 'vad-pausa-ms') ?? env.AURORA_VAD_PAUSA_MS;
  let vadPauseMs = DEFAULT_VAD_PAUSE_MS;
  if (rawPause !== undefined && String(rawPause).trim() !== '') {
    const value = Number(rawPause);
    if (Number.isFinite(value) && value >= 500 && value <= 4000) vadPauseMs = Math.round(value);
    else warnings.push('Pausa do VAD "' + rawPause + '" fora do intervalo 500-4000 ms; usando ' + DEFAULT_VAD_PAUSE_MS + ' ms.');
  }

  return { mode, vadPauseMs, warnings };
}

module.exports = { parseVoiceOptions, DEFAULT_VAD_PAUSE_MS };
