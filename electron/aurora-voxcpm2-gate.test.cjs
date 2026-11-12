'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createVoxCpm2Gate } = require('./aurora-voxcpm2-gate.cjs');

function makeGate(options = {}) {
  let time = 1000;
  const gate = createVoxCpm2Gate({ now: () => time, ...options });
  return { gate, advance: (ms) => { time += ms; } };
}

test('começa desconhecido e fica pronto por um tempo depois de markReady', () => {
  const { gate, advance } = makeGate({ readyTtlMs: 30000 });
  assert.equal(gate.check().state, 'unknown');
  gate.markReady();
  assert.equal(gate.check().state, 'ready');
  advance(29000);
  assert.equal(gate.check().state, 'ready');
  advance(2000);
  assert.equal(gate.check().state, 'unknown');
});

test('após falha, bloqueia as próximas tentativas sem esperar de novo', () => {
  const { gate, advance } = makeGate({ blockMs: 45000 });
  gate.markFailure('servidor não respondeu');
  const blocked = gate.check();
  assert.equal(blocked.state, 'blocked');
  assert.match(blocked.reason, /não respondeu/);
  advance(44000);
  assert.equal(gate.check().state, 'blocked');
  advance(2000);
  assert.equal(gate.check().state, 'unknown');
});

test('markReady desfaz um bloqueio (servidor terminou de iniciar em segundo plano)', () => {
  const { gate } = makeGate();
  gate.markFailure('iniciando');
  gate.markReady();
  assert.equal(gate.check().state, 'ready');
});

test('reset limpa tudo (ex.: usuário trocou o token ou o endereço)', () => {
  const { gate } = makeGate();
  gate.markFailure('x');
  gate.reset();
  assert.equal(gate.check().state, 'unknown');
});
