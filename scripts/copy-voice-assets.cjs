const fs = require('node:fs');
const path = require('node:path');

function requireDirectory(directory, label) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error('Não encontrei ' + label + ' em ' + directory + '. Execute npm install e tente novamente.');
  }
}

function copyVoiceAssets(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const vadDistDir = path.resolve(options.vadDistDir || path.join(rootDir, 'node_modules', '@ricky0123', 'vad-web', 'dist'));
  const ortDistDir = path.resolve(options.ortDistDir || path.join(rootDir, 'node_modules', 'onnxruntime-web', 'dist'));
  const outputDir = path.resolve(options.outputDir || path.join(rootDir, 'public', 'aurora-vad'));

  requireDirectory(vadDistDir, 'os assets do Silero VAD');
  requireDirectory(ortDistDir, 'os assets WASM do ONNX Runtime');

  const requiredVadFiles = ['vad.worklet.bundle.min.js', 'silero_vad_v5.onnx'];
  for (const file of requiredVadFiles) {
    if (!fs.existsSync(path.join(vadDistDir, file))) {
      throw new Error('O pacote @ricky0123/vad-web não contém ' + file + '. Confira a versão instalada.');
    }
  }

  const runtimeFiles = fs.readdirSync(ortDistDir)
    .filter((file) => /\.(wasm|mjs)$/i.test(file))
    .sort();
  const wasmFiles = runtimeFiles.filter((file) => /\.wasm$/i.test(file));
  const moduleFiles = runtimeFiles.filter((file) => /\.mjs$/i.test(file));
  if (wasmFiles.length === 0 || moduleFiles.length === 0) {
    throw new Error('O ONNX Runtime não contém arquivos WASM e MJS em ' + ortDistDir + '.');
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  for (const file of requiredVadFiles) {
    fs.copyFileSync(path.join(vadDistDir, file), path.join(outputDir, file));
  }
  for (const file of runtimeFiles) {
    fs.copyFileSync(path.join(ortDistDir, file), path.join(outputDir, file));
  }

  const copied = [...requiredVadFiles, ...runtimeFiles];
  console.info('[Aurora Voice Assets] ' + copied.length + ' arquivos locais preparados em ' + outputDir);
  return copied;
}

if (require.main === module) {
  try {
    copyVoiceAssets();
  } catch (error) {
    console.error('[Aurora Voice Assets] ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

module.exports = { copyVoiceAssets };
