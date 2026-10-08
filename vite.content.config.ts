import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/** Content script: one self-contained IIFE, appended to the main build's dist/. */
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome116',
    lib: {
      entry: resolve(__dirname, 'src/extension/content/index.ts'),
      name: 'WebAgentContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
});
