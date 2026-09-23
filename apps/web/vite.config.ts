import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 3001,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist/public',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@remote-commander/ai-core': path.resolve(__dirname, '../../packages/ai-core/src/index.ts'),
      '@remote-commander/shared-types': path.resolve(
        __dirname,
        '../../packages/shared-types/src/index.ts',
      ),
      '@remote-commander/tool-schema': path.resolve(
        __dirname,
        '../../packages/tool-schema/src/index.ts',
      ),
    },
  },
});
