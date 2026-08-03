// How much of this game could move to another shell?
//
// PORTS UNCHANGED is the game itself; PLATFORM is the shell a port rewrites;
// CONTAMINATED is game code that has let that shell leak across the seam.
// Run: node tools/portability.mjs   (also `npm run portability`)

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const BROWSER = /\b(document|window|localStorage|sessionStorage|requestAnimationFrame|HTMLElement|HTMLCanvasElement|navigator|AudioContext|globalThis)\b/;

/** Files a desktop port deliberately replaces. */
export const PLATFORM = [
  'ui/', 'hud/', 'game/screens/', 'viewer/',
  // The encyclopaedia by FILE, not by directory, unlike `viewer/` above. Only
  // two of its four modules touch a browser: the canvas chart and the page
  // wiring. `entry.ts` and `filters.ts` are pure and stay counted as portable,
  // which is not bookkeeping — `entry.ts` runs under node during the build, to
  // write all 256 entries into the document, and would stop being able to the
  // moment it reached for a DOM.
  'encyclopaedia/chart.ts', 'encyclopaedia/main.ts',
  // The composition root: only main.ts imports it in shipped code. It creates
  // the input/HUD/screens and applies audio, storage and console effects; the
  // reusable rules and fixed step are the modules it orchestrates.
  'game/game.ts',
  'engine/render-stack.ts', 'engine/input.ts', 'engine/keymap.ts',
  'engine/browser-shell.ts', 'engine/inert-dom.ts',
  'audio.ts', 'main.ts', 'manual.ts',
  'game/storage.ts', 'game/console.ts', 'world/corona-texture.ts',
];

const stripComments = (source) => source.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
const slash = (path) => path.replaceAll('\\', '/');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}

// Type-only declarations are intentionally absent: TypeScript erases them.
const RUNTIME_IMPORT = /^\s*import\s+(?!type\b)(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
const RUNTIME_EXPORT = /^\s*export\s+(?!type\b)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/gm;

function runtimeSpecifiers(source) {
  const specifiers = [];
  for (const pattern of [RUNTIME_IMPORT, RUNTIME_EXPORT]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source))) {
      if (match[1].startsWith('.')) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function resolveRelativeImport(from, specifier, files) {
  const target = normalize(join(dirname(from), specifier));
  // The project uses explicit .ts imports, but accepting extensionless modules
  // and directory indexes keeps the check aligned with TypeScript resolution.
  const candidates = target.endsWith('.ts')
    ? [target]
    : [`${target}.ts`, join(target, 'index.ts')];
  return candidates.find((candidate) => files.has(candidate));
}

/**
 * Classify TypeScript files below root. Contamination chains begin at the
 * affected file and end at an intended platform module or "browser token".
 */
export function analyzePortability(root = 'src', platform = PLATFORM) {
  const files = new Set(walk(root).sort());
  const rel = (path) => slash(relative(root, path));
  const records = new Map();

  for (const path of files) {
    const source = readFileSync(path, 'utf8');
    const name = rel(path);
    records.set(path, {
      path,
      rel: name,
      lines: source.split('\n').length,
      platform: platform.some((entry) => name.startsWith(entry) || name.endsWith(entry)),
      browser: BROWSER.test(stripComments(source)),
      dependencies: [...new Set(runtimeSpecifiers(stripComments(source))
        .map((specifier) => resolveRelativeImport(path, specifier, files))
        .filter(Boolean))].sort((a, b) => rel(a).localeCompare(rel(b))),
    });
  }

  // Seed the two direct classifications, then propagate them to a fixed
  // point. A recursive DFS cannot safely call a back-edge "clean": if a
  // platform edge appears later in that cycle, the already-memoised member
  // would stay clean. Fixed-point propagation classifies the whole cycle and
  // terminates after at most one promotion per file.
  const state = new Map([...records].map(([path, record]) => [path,
    record.platform
      ? { kind: 'platform', chain: [record.rel] }
      : record.browser
        ? { kind: 'contaminated', chain: [record.rel, 'browser token'] }
        : { kind: 'clean' },
  ]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [path, record] of records) {
      if (state.get(path).kind !== 'clean') continue;
      for (const dependency of record.dependencies) {
        const dependencyResult = state.get(dependency);
        if (dependencyResult.kind !== 'platform'
            && dependencyResult.kind !== 'contaminated') continue;
        state.set(path, {
          kind: 'contaminated', chain: [record.rel, ...dependencyResult.chain],
        });
        changed = true;
        break;
      }
    }
  }

  const buckets = { 'ports unchanged': [], platform: [], contaminated: [] };
  for (const path of [...files].sort((a, b) => rel(a).localeCompare(rel(b)))) {
    const record = records.get(path);
    const result = state.get(path);
    const bucket = result.kind === 'clean' ? 'ports unchanged' : result.kind;
    buckets[bucket].push({ ...record, chain: result.chain });
  }
  return buckets;
}

export function reportPortability(root = 'src') {
  const buckets = analyzePortability(root);
  const total = Object.values(buckets).flat().reduce((sum, file) => sum + file.lines, 0);
  for (const [name, files] of Object.entries(buckets)) {
    const lines = files.reduce((sum, file) => sum + file.lines, 0);
    console.log(`${name.padEnd(18)} ${String(lines).padStart(6)} lines  ${String(Math.round(lines / total * 100)).padStart(3)}%  (${files.length} files)`);
    if (name === 'contaminated') {
      for (const file of files.sort((a, b) => b.lines - a.lines || a.rel.localeCompare(b.rel))) {
        console.log(`  ${String(file.lines).padStart(6)}  ${file.chain.join(' -> ')}`);
      }
    }
  }
  console.log(`${'total'.padEnd(18)} ${String(total).padStart(6)} lines`);
  console.log('\nthe contaminated list is the one to drive to zero.');
  return buckets;
}

if (process.argv[1]
    && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  const buckets = reportPortability();
  if (buckets.contaminated.length > 0) process.exitCode = 1;
}
