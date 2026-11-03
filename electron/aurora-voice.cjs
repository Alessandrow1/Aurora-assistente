'use strict';

function foldPortuguese(text) {
  return String(text || '')
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\\s+/g, ' ');
}

/**
 * Corrige apenas uma classe muito específica de erro recorrente do Whisper:
 * "tá meu vindo?" / "tá me vindo?" quando a intenção é "tá me ouvindo?".
 * O restante da transcrição é preservado sem reescrita.
 */
function normalizeVoiceTranscript(rawText) {
  const original = typeof rawText === 'string' ? rawText.trim().replace(/\\s+/g, ' ') : '';
  if (!original) return '';

  const folded = foldPortuguese(original);
  const match = folded.match(/^(?:(oi|ola|opa|alo|e ai) )?((?:voce )?(?:ta|esta) (?:meu|me|mim) (?:vindo|ouvindo|ouvido|ouvir))$/);
  if (!match) return original;

  const greeting = match[1];
  return greeting
    ? greeting === 'ola' ? 'Olá, tá me ouvindo?' :
      greeting === 'e ai' ? 'E aí, tá me ouvindo?' :
      greeting === 'alo' ? 'Alô, tá me ouvindo?' :
      greeting[0].toUpperCase() + greeting.slice(1) + ', tá me ouvindo?'
    : 'Tá me ouvindo?';
}

module.exports = { foldPortuguese, normalizeVoiceTranscript };
