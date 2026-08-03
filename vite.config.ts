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
        // Two dev pages, one thing each: the combat viewer replays trained
        // episodes, the gallery shows the 38 released hulls. They were one page
        // with a `G` between them, so /viewer opened on the gallery.
        viewer: resolve(__dirname, 'viewer.html'),
        gallery: resolve(__dirname, 'gallery.html'),
        manual: resolve(__dirname, 'manual.html'),
        novella: resolve(__dirname, 'novella.html'),
      },
    },
  },
});
