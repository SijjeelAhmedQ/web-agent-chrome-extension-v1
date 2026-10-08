import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Main build: the two extension pages (side panel, configuration) and the background
 * service worker. The background is emitted as a fixed-name ES module (manifest
 * "type": "module"). The content script is built separately (vite.content.config.ts)
 * because Chrome injects it as a classic script, so it must be a single IIFE file.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome116',
    modulePreload: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        options: resolve(__dirname, 'options.html'),
        background: resolve(__dirname, 'src/extension/background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
