// How much of this game could move to another shell?
//
// Chris's test, and it is a better one than "is this module leaky?" because it
// has an answer rather than an opinion: if we wanted a desktop build with the
// same core, could we do it, and what would we have to rewrite?
//
// Three buckets:
//
//   PORTS UNCHANGED   the game itself — rules, galaxy, physics, AI. Moves to
//                     any shell that can draw and take input.
//   PLATFORM          renderer, HUD, DOM screens, input, audio, storage. You
//                     EXPECT to rewrite these; that is the port, not a leak.
//   CONTAMINATED      engine code that cannot move because a mechanism has
//                     leaked into it. This is the number that should fall.
//
// Run: node tools/portability.mjs   (also `npm run portability`)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BROWSER = /\b(document|window|localStorage|sessionStorage|requestAnimationFrame|HTMLElement|HTMLCanvasElement|navigator|AudioContext|globalThis)\b/;

/**
 * Files that are *meant* to know about the platform. A desktop port
 * reimplements each of these against its own toolkit; that is the job, and
 * counting them as contamination would make the number meaningless.
 */
const PLATFORM = [
  'ui/', 'hud/', 'game/screens/', 'viewer/',
  'engine/render-stack.ts', 'engine/input.ts', 'engine/keymap.ts',
  // the shell: the whole port surface. `engine/shell.ts` is NOT here — it is
  // the interface plus a headless implementation, and it must stay portable
  // or the seam is a fiction.
  'engine/browser-shell.ts', 'engine/inert-dom.ts',
  'audio.ts', 'main.ts', 'manual.ts',
  // the one file allowed to know how a save is stored — swap it for a
  // file-backed one and nothing else changes
  'game/storage.ts',
  // ...and the one allowed to publish a console handle. Same bargain: a port
  // that has no console simply never calls it. Note this covers HANDLES the
  // game writes, never FLAGS it reads — see the header of console.ts.
  'game/console.ts',
  // the sun's corona is a canvas texture; it is rendering, and it already
  // degrades to null with no document
  'world/sun.ts',
];

const stripComments = (s) => s.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const buckets = { 'ports unchanged': [], platform: [], contaminated: [] };

for (const path of walk('src').sort()) {
  const rel = path.slice('src/'.length);
  const lines = readFileSync(path, 'utf8').split('\n').length;
  const isPlatform = PLATFORM.some((p) => rel.startsWith(p) || rel.endsWith(p));
  if (isPlatform) buckets.platform.push([lines, rel]);
  else if (BROWSER.test(stripComments(readFileSync(path, 'utf8')))) {
    buckets.contaminated.push([lines, rel]);
  } else buckets['ports unchanged'].push([lines, rel]);
}

const total = Object.values(buckets).flat().reduce((s, [n]) => s + n, 0);
for (const [name, files] of Object.entries(buckets)) {
  const n = files.reduce((s, [l]) => s + l, 0);
  console.log(`${name.padEnd(18)} ${String(n).padStart(6)} lines  ${String(Math.round(n / total * 100)).padStart(3)}%  (${files.length} files)`);
  if (name === 'contaminated') {
    for (const [l, rel] of files.sort((a, b) => b[0] - a[0])) {
      console.log(`  ${String(l).padStart(6)}  ${rel}`);
    }
  }
}
console.log(`${'total'.padEnd(18)} ${String(total).padStart(6)} lines`);
console.log('\nthe contaminated list is the one to drive to zero.');
