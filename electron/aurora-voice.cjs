'use strict';

function foldPortuguese(text) {
  return String(text || '')
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function extractHearingCheck(text) {
  const folded = foldPortuguese(text);
  if (!folded) return null;
  const match = folded.match(/^(?:(oi|ola|opa|alo|aloo|e ai) )?(.+)$/);
  const greeting = match?.[1] || '';
  const body = (match?.[2] || folded)
    .replace(/\b(?:agora|ai|bem|direito|por favor|ne)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const directQuestion = /^(?:consegue me ouvir|me ouve|me escuta|esta ouvindo|ta ouvindo)$/.test(body);
  const speechCheckPattern = /^(?:voce )?(?:ta|esta) (?:me|meu|mim) (?:ouvindo|ouvido|vindo|ouvir|ouve|escutando|escuta)$/;
  if (directQuestion || speechCheckPattern.test(body)) {
    return { greeting, body };
  }
  return null;
}

function isVoiceHearingCheck(text) {
  return extractHearingCheck(text) !== null;
}

/**
 * Corrige apenas erros recorrentes do Whisper em perguntas para testar o microfone.
 * O restante da transcrição é preservado sem reescrita.
 */
function normalizeVoiceTranscript(rawText) {
  const original = typeof rawText === 'string' ? rawText.trim().replace(/\s+/g, ' ') : '';
  if (!original) return '';

  const hearingCheck = extractHearingCheck(original);
  if (!hearingCheck) return original;

  const greeting = hearingCheck.greeting;
  if (!greeting) return 'Tá me ouvindo?';
  if (greeting === 'ola') return 'Olá, tá me ouvindo?';
  if (greeting === 'e ai') return 'E aí, tá me ouvindo?';
  if (greeting === 'alo' || greeting === 'aloo') return 'Alô, tá me ouvindo?';
  return greeting[0].toUpperCase() + greeting.slice(1) + ', tá me ouvindo?';
}



function isElevenLabsQuotaExceeded(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /quota_exceeded|exceeds your quota|credits remaining/i.test(message);
}

function choosePreferredModel({
  fastVoiceTurn = false,
  voiceMode = false,
  needsThinking = false,
  needsExplanation = false,
  needsFactualKnowledge = false,
  needsStoredContext = false,
  hasImage = false,
  studyMode = false,
  settingsModel = 'qwen3.5:9b',
} = {}) {
  if (fastVoiceTurn) return 'qwen3.5:2b';
  if (voiceMode && !needsThinking && !needsExplanation && !needsFactualKnowledge && !needsStoredContext && !hasImage && !studyMode) {
    return 'qwen3.5:2b';
  }
  if (voiceMode || needsThinking || needsExplanation || needsFactualKnowledge || studyMode) {
    return 'qwen3.5:9b';
  }
  return settingsModel;
}

module.exports = { choosePreferredModel, foldPortuguese, isElevenLabsQuotaExceeded, isVoiceHearingCheck, normalizeVoiceTranscript };
