const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { copyVoiceAssets } = require('./copy-voice-assets.cjs');

test('copies Silero VAD, AudioWorklet and ONNX Runtime assets into the offline public folder', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-vad-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const vadDistDir = path.join(root, 'vad-dist');
  const ortDistDir = path.join(root, 'ort-dist');
  const outputDir = path.join(root, 'public', 'aurora-vad');
  fs.mkdirSync(vadDistDir, { recursive: true });
  fs.mkdirSync(ortDistDir, { recursive: true });

  for (const file of ['vad.worklet.bundle.min.js', 'silero_vad_v5.onnx']) {
    fs.writeFileSync(path.join(vadDistDir, file), 'vad:' + file);
  }
  for (const file of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) {
    fs.writeFileSync(path.join(ortDistDir, file), 'ort:' + file);
  }

  const copied = copyVoiceAssets({ vadDistDir, ortDistDir, outputDir });
  assert.deepEqual(copied.sort(), [
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
    'silero_vad_v5.onnx',
    'vad.worklet.bundle.min.js',
  ]);
  for (const file of copied) {
    assert.equal(fs.readFileSync(path.join(outputDir, file), 'utf8'), (file.startsWith('ort-') ? 'ort:' : 'vad:') + file);
  }
});

test('fails clearly when an offline VAD runtime asset is missing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-vad-missing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vadDistDir = path.join(root, 'vad');
  const ortDistDir = path.join(root, 'ort');
  fs.mkdirSync(vadDistDir, { recursive: true });
  fs.mkdirSync(ortDistDir, { recursive: true });
  fs.writeFileSync(path.join(vadDistDir, 'vad.worklet.bundle.min.js'), 'worklet');
  fs.writeFileSync(path.join(ortDistDir, 'ort.wasm'), 'wasm');
  fs.writeFileSync(path.join(ortDistDir, 'ort.mjs'), 'module');

  assert.throws(
    () => copyVoiceAssets({ vadDistDir, ortDistDir, outputDir: path.join(root, 'out') }),
    /silero_vad_v5\.onnx/i,
  );
});
