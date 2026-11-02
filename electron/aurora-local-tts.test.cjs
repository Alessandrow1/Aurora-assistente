const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const {
  createAuroraLocalTts,
  makeWavBuffer,
  chooseModelDirectory,
} = require('./aurora-local-tts.cjs');

test('Kokoro does not download itself during a normal speech request', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-kokoro-test-'));
  let downloadCalls = 0;
  const engine = createAuroraLocalTts({
    modelDirectory: path.join(root, 'missing-model'),
    fetchImpl: async () => {
      downloadCalls += 1;
      throw new Error('unexpected network request');
    },
    loadSherpa: () => {
      throw new Error('the runtime must not be loaded without model files');
    },
  });

  try {
    const status = await engine.getStatus();
    assert.equal(status.installed, false);
    assert.equal(status.ready, false);
    await assert.rejects(
      () => engine.synthesize('Oi, tudo bem?'),
      /ainda não foi instalada/i,
    );
    assert.equal(downloadCalls, 0);
  } finally {
    await engine.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Kokoro WAV writer returns valid 16-bit mono PCM', () => {
  const samples = new Float32Array([0, -1, 1, 0.5]);
  const wav = makeWavBuffer(samples, 24000);

  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.toString('ascii', 36, 40), 'data');
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), samples.length * 2);
  assert.equal(wav.length, 44 + samples.length * 2);
});

test('Kokoro stores voice assets on D: by default when the drive exists on Windows', () => {
  if (process.platform !== 'win32') return;
  const directory = chooseModelDirectory('C:\\Users\\Test\\AppData\\Roaming\\Aurora');
  assert.equal(directory.toLowerCase(), 'd:\\auroravoicemodels\\kokoro-pt-br'.toLowerCase());
});
