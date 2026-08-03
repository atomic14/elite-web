import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { generateGalaxy } from './src/galaxy/galaxy.ts';
import { entryFor, entryHtml } from './src/encyclopaedia/entry.ts';

/**
 * Write all 256 encyclopaedia entries into the document.
 *
 * The page is chart-led, and a chart is invisible to a crawler and useless to
 * a reader with no JavaScript — which would leave 205,000 characters of prose
 * that exists nowhere else behind a click. So the document is built the other
 * way up: the entries ARE the page, and the chart is an enhancement over
 * markup that is already complete.
 *
 * This runs `entryHtml()`, the same function the detail panel calls in the
 * browser, so there is no second rendering to drift from the first. It is
 * build-time and deterministic — the seeds in, the same bytes out — with no
 * model and no network, exactly like the Elite-A generator and the species
 * prompts.
 *
 * It hooks `transformIndexHtml` rather than emitting a file so that `npm run
 * dev` serves the same document the build produces; a placeholder that only
 * filled in for production would mean developing against a page nobody ships.
 */
function encyclopaediaEntries(): Plugin {
  const MARKER = '<!--ENTRIES-->';
  return {
    name: 'harmless:encyclopaedia-entries',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!ctx.path.includes('encyclopaedia') || !html.includes(MARKER)) return html;
        const entries = generateGalaxy(1)
          .map((sys) => entryHtml(entryFor(sys, 1)))
          .join('\n');
        return html.replace(MARKER, entries);
      },
    },
  };
}

export default defineConfig({
  plugins: [encyclopaediaEntries()],
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
        // The galaxy as a reference work — public content rather than a dev
        // page, so it is in the sitemap and linked from the landing page.
        encyclopaedia: resolve(__dirname, 'encyclopaedia.html'),
      },
    },
  },
});
