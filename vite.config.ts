import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        // index is the landing page; the game itself is play.html, so the
        // three.js bundle never loads for someone who arrived to read
        main: resolve(__dirname, 'index.html'),
        play: resolve(__dirname, 'play.html'),
        viewer: resolve(__dirname, 'viewer.html'),
        manual: resolve(__dirname, 'manual.html'),
        novella: resolve(__dirname, 'novella.html'),
      },
    },
  },
});
