import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function copyLocalVadAssets() {
  return {
    name: 'aurora-copy-local-vad-assets',
    configResolved() {
      const projectRoot = process.cwd();
      const vadDist = path.join(projectRoot, 'node_modules', '@ricky0123', 'vad-web', 'dist');
      const ortDist = path.join(projectRoot, 'node_modules', 'onnxruntime-web', 'dist');
      const destination = path.join(projectRoot, 'public', 'aurora-vad');
      if (!fs.existsSync(vadDist) || !fs.existsSync(ortDist)) {
        console.warn('[Aurora VAD] Dependências ainda não instaladas. Execute npm install para preparar os recursos locais do Silero VAD.');
        return;
      }
      fs.mkdirSync(destination, { recursive: true });
      const requiredVadFiles = ['vad.worklet.bundle.min.js', 'silero_vad_v5.onnx'];
      for (const file of requiredVadFiles) {
        const source = path.join(vadDist, file);
        if (!fs.existsSync(source)) throw new Error('[Aurora VAD] Arquivo obrigatório não encontrado: ' + source);
        fs.copyFileSync(source, path.join(destination, file));
      }
      for (const file of fs.readdirSync(ortDist)) {
        if (!/\.(?:wasm|mjs)$/.test(file)) continue;
        fs.copyFileSync(path.join(ortDist, file), path.join(destination, file));
      }
      console.info('[Aurora VAD] Recursos do Silero VAD e ONNX Runtime copiados para public/aurora-vad.');
    },
  };
}

export default defineConfig({
  plugins: [react(), copyLocalVadAssets()],
  base: './',
  resolve: {
    alias: {
      '@framework': path.resolve(process.cwd(), 'src/vendor/cubism-framework'),
    },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
