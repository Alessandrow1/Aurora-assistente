'use strict';

function createVoxCpm2Gate({
  now = Date.now,
  readyTtlMs = 30000,
  blockMs = 45000,
} = {}) {
  let readyUntil = 0;
  let blockedUntil = 0;
  let blockedReason = '';

  return {
    check() {
      const current = now();
      if (current < blockedUntil) {
        return { state: 'blocked', reason: blockedReason, retryInMs: blockedUntil - current };
      }
      if (current < readyUntil) return { state: 'ready' };
      return { state: 'unknown' };
    },
    markReady() {
      readyUntil = now() + readyTtlMs;
      blockedUntil = 0;
      blockedReason = '';
    },
    markFailure(reason) {
      blockedUntil = now() + blockMs;
      blockedReason = String(reason || 'VoxCPM2 indisponível').slice(0, 200);
      readyUntil = 0;
    },
    reset() {
      readyUntil = 0;
      blockedUntil = 0;
      blockedReason = '';
    },
  };
}

module.exports = { createVoxCpm2Gate };
