'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { createAuroraCoquiTts } = require('./aurora-coqui-tts.cjs');

function makeFakeChild(onRequest) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      try {
        onRequest(JSON.parse(chunk.toString('utf8').trim()), child);
        callback();
      } catch (error) {
        callback(error);
      }
    },
  });
  child.kill = () => {
    child.killed = true;
    child.emit('close', 0);
    return true;
  };
  return child;
}

function setupCoquiDirectory() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-coqui-test-'));
  const pythonPath = process.platform === 'win32'
    ? path.join(root, 'venv', 'Scripts', 'python.exe')
    : path.join(root, 'venv', 'bin', 'python');
  fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
  fs.writeFileSync(pythonPath, '');
  const workerPath = path.join(root, 'worker.py');
  fs.writeFileSync(workerPath, '# fake worker');
  fs.writeFileSync(path.join(root, 'CPML-ACCEPTED.txt'), 'CPML ACCEPTED BY USER');
  return { root, pythonPath, workerPath };
}

test('reports the isolated Coqui environment and CPML acceptance state', () => {
  const { root, workerPath } = setupCoquiDirectory();
  const engine = createAuroraCoquiTts({ rootDirectory: root, workerPath, spawnImpl: () => {
    throw new Error('spawn should not be called for status');
  } });
  const status = engine.getStatus();
  assert.equal(status.installed, true);
  assert.equal(status.licenseAccepted, true);
  assert.equal(status.workerAvailable, true);
  assert.equal(status.provider, 'coqui-xtts');
  assert.equal(status.device, 'cpu');
  fs.rmSync(root, { recursive: true, force: true });
});

test('refuses to start XTTS until the user has explicitly accepted CPML', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-coqui-no-license-'));
  const pythonPath = process.platform === 'win32'
    ? path.join(root, 'venv', 'Scripts', 'python.exe')
    : path.join(root, 'venv', 'bin', 'python');
  fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
  fs.writeFileSync(pythonPath, '');
  const workerPath = path.join(root, 'worker.py');
  fs.writeFileSync(workerPath, '# fake worker');
  let spawnCalled = false;
  const engine = createAuroraCoquiTts({
    rootDirectory: root,
    workerPath,
    spawnImpl: () => { spawnCalled = true; throw new Error('must not spawn'); },
  });
  await assert.rejects(() => engine.synthesize('Olá, Aurora!'), /aceite.*CPML/i);
  assert.equal(spawnCalled, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('keeps one Python worker alive and returns generated WAV data from its JSONL response', async () => {
  const { root, workerPath } = setupCoquiDirectory();
  let spawnCount = 0;
  const engine = createAuroraCoquiTts({
    rootDirectory: root,
    workerPath,
    spawnImpl: (_command, _args, options) => {
      spawnCount += 1;
      assert.equal(options.env.COQUI_TOS_AGREED, '1');
      assert.equal(options.env.OMP_NUM_THREADS, '6');
      return makeFakeChild((request, child) => {
        assert.equal(request.action, 'synthesize');
        assert.equal(request.language, 'pt');
        child.stdout.write(JSON.stringify({
          type: 'status',
          state: 'model-loaded',
          message: 'loaded',
        }) + '\n');
        child.stdout.write(JSON.stringify({
          id: request.id,
          ok: true,
          speaker: request.speaker,
          audioBase64: Buffer.from('RIFFfake-wav').toString('base64'),
          performance: { modelLoadMs: 1000, synthesisMs: 250, audioSeconds: 1.2, sampleRate: 24000, audioBytes: 12, device: 'cpu' },
        }) + '\n');
      });
    },
  });

  const result = await engine.synthesize('Olá, Aurora!');
  assert.equal(result.provider, 'coqui-xtts');
  assert.equal(result.audioMimeType, 'audio/wav');
  assert.equal(Buffer.from(result.audioBase64, 'base64').toString(), 'RIFFfake-wav');
  assert.equal(result.voice, 'Ana Florence');
  assert.equal(result.performance.synthesisMs, 250);
  assert.equal(engine.getStatus().modelLoaded, true);
  assert.equal(spawnCount, 1);

  await engine.synthesize('Mais um teste.');
  assert.equal(spawnCount, 1);
  await engine.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

test('rejects empty text without starting the Python worker', async () => {
  const { root, workerPath } = setupCoquiDirectory();
  let spawnCount = 0;
  const engine = createAuroraCoquiTts({
    rootDirectory: root,
    workerPath,
    spawnImpl: () => { spawnCount += 1; throw new Error('must not spawn'); },
  });
  await assert.rejects(() => engine.synthesize('  '), /frase para testar/i);
  assert.equal(spawnCount, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
