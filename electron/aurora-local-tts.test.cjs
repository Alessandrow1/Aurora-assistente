const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
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
  if (process.platform !== 'win32' || !fsSync.existsSync('D:\\\\')) return;
  const directory = chooseModelDirectory('C:\\Users\\Test\\AppData\\Roaming\\Aurora');
  assert.equal(directory.toLowerCase(), 'd:\\auroravoicemodels\\kokoro-pt-br'.toLowerCase());
});


async function createCompleteKokoroFixture(directory, wrapperName = 'kokoro-multi-lang-v1_0') {
  const modelRoot = path.join(directory, wrapperName);
  const espeak = path.join(modelRoot, 'espeak-ng-data');
  await fs.mkdir(espeak, { recursive: true });
  const model = await fs.open(path.join(modelRoot, 'model.onnx'), 'w');
  await model.truncate(250 * 1024 * 1024 + 1);
  await model.close();
  const voices = await fs.open(path.join(modelRoot, 'voices.bin'), 'w');
  await voices.truncate(1024 * 1024 + 1);
  await voices.close();
  await fs.writeFile(path.join(modelRoot, 'tokens.txt'), 't'.repeat(687));
  await fs.writeFile(path.join(espeak, 'phontab'), 'test phoneme data');
  return modelRoot;
}

test('Kokoro recognizes the official archive layout when it has a wrapper directory', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-kokoro-layout-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const modelDirectory = path.join(root, 'kokoro-pt-br');
  await createCompleteKokoroFixture(modelDirectory, 'letrinhas-kokoro-pt');

  const engine = createAuroraLocalTts({
    modelDirectory,
    fetchImpl: async () => { throw new Error('the complete local model should be reused'); },
  });
  try {
    const status = await engine.getStatus();
    assert.equal(status.installed, true);
    assert.equal(status.ready, false);
  } finally {
    await engine.dispose();
  }
});

test('Kokoro installation recovers a valid previous extraction without downloading again', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-kokoro-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const modelDirectory = path.join(root, 'kokoro-pt-br');
  const stagingDirectory = modelDirectory + '.installing';
  await createCompleteKokoroFixture(stagingDirectory, 'letrinhas-kokoro-pt');

  let downloadCalls = 0;
  const engine = createAuroraLocalTts({
    modelDirectory,
    fetchImpl: async () => {
      downloadCalls += 1;
      throw new Error('a validated staged model should not be downloaded again');
    },
  });
  try {
    const installed = await engine.install();
    assert.equal(downloadCalls, 0);
    assert.equal(await fs.stat(installed.model).then((stat) => stat.size), 250 * 1024 * 1024 + 1);
    assert.equal((await engine.getStatus()).installed, true);
    await fs.access(modelDirectory);
    await assert.rejects(fs.access(stagingDirectory));
  } finally {
    await engine.dispose();
  }
});
