import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
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
