import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@framework': path.resolve(process.cwd(), 'src/vendor/cubism-framework'),
    },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, hmr: { overlay: false } },
});
