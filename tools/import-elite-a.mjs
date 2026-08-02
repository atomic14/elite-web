// Import the vendored Elite-A pack into a compact, generated catalogue.
//
//   npm run generate:elite-a              # write
//   npm run generate:elite-a -- --check   # compare only, non-zero on drift
//
// This file is the boundary: it reads `reference/elite-a/source`, verifies the
// pack is the one this project was built against, and writes what
// `tools/elite-a/build.mjs` decided and `tools/elite-a/emit.mjs` rendered. All
// of the reasoning lives in those two; all of the I/O lives here.
//
// The pinned hashes below are the point of the whole exercise. The pack came
// from outside the repository, so "the same data" has to mean something
// checkable — not "the file with that name". A pack that hashes differently is
// a different pack, and this stops rather than quietly recording new hashes and
// regenerating a different game.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCatalogue } from './elite-a/build.mjs';
import { renderAll } from './elite-a/emit.mjs';
import { buildFixtures } from './elite-a/fixtures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'reference/elite-a/source');

/** The pack, by SHA-256. Changing one of these is a deliberate act. */
const PINNED = {
  'EliteACombatModel.swift': '0b2a198bd525b8244bf45b5f2000f7fc234dbe5bf73ce38c647fb75d214b3105',
  'README.txt': 'd667f3677bfddd07034c719845a2c3c2712ce50bfc6f75762db5587b6a2a4046',
  'elite_a_combat_reference.md': '57f5ea6c110e3feab91ef25b341c5c3f571b8ca31b518c2cefaaa05cddcd96f8',
  'elite_a_complete_ship_data.json': 'bc69c28bf5e09f166346a8aea88df335e746e566ceeeb556ce4baccb1cb257de',
  'elite_a_hit_ranges.json': '3e3c394967ce3700580a67444a1423b16a380bab963b3a3d8776c82961b31e5b',
  'elite_a_hit_ranges.md': '86e88ab405eceecd765e8c60cfbf27a02d25eb29b0cd0bc586ef517f1aab9482',
  'elite_a_hits_to_destroy.json': '53e603ea2a031d5b70788c03b22f1c0c208504b59037f511f13ad22890037e68',
  'elite_a_npc_damage_to_player.json': '4b53dce5218dd43b84471c0e53ebeebab8ed91e7f57a213e9235a383705346fe',
  'elite_a_npc_ship_summary.json': 'abfd6cf6e8e55f79753066f15be8860e9e9f1a139660c4cf15572d53dbdbf47c',
  'elite_a_player_ships.json': 'a9e3dc3e12425ee915a78917b7bab62c7eff1eddd82c47f4232708ac57e74021',
};

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/** Read the pack, refuse anything unexpected, and describe what was read. */
function readSource() {
  const names = readdirSync(SOURCE_DIR)
    .filter((name) => !name.startsWith('.'))
    .sort();
  const expected = Object.keys(PINNED).sort();
  if (names.join('\n') !== expected.join('\n')) {
    throw new Error(`reference/elite-a/source holds ${names.length} file(s), not the `
      + `${expected.length} pinned ones:\n  found:  ${names.join(', ')}\n`
      + `  pinned: ${expected.join(', ')}`);
  }

  const files = [];
  const bytes = new Map();
  for (const name of names) {
    const buffer = readFileSync(join(SOURCE_DIR, name));
    const hash = sha256(buffer);
    if (hash !== PINNED[name]) {
      throw new Error(`${name} does not match the pinned pack.\n`
        + `  expected ${PINNED[name]}\n  found    ${hash}\n`
        + 'STOP: do not record the new hash. Confirm the pack is the intended one,\n'
        + 'then update PINNED in tools/import-elite-a.mjs as its own reviewed change.');
    }
    files.push({ name, bytes: buffer.length, sha256: hash });
    bytes.set(name, buffer);
  }

  // One digest over the ten, so a generated file can name its whole input.
  const sourceHash = sha256(files.map((f) => `${f.name} ${f.sha256}\n`).join(''));
  return { files, bytes, sourceHash };
}

const parse = (bytes, name) => JSON.parse(bytes.get(name).toString('utf8'));

function manifestJson({ files, sourceHash }) {
  const body = files.map((f) => `    { "name": ${JSON.stringify(f.name)}, `
    + `"bytes": ${f.bytes}, "sha256": ${JSON.stringify(f.sha256)} }`).join(',\n');
  return `{
  "note": "Provenance for the verbatim pack in ./source. Regenerate with \`npm run generate:elite-a\`.",
  "sourceHash": ${JSON.stringify(sourceHash)},
  "files": [
${body}
  ]
}
`;
}

function main() {
  const check = process.argv.includes('--check');
  const source = readSource();
  const pack = {
    completeShipData: parse(source.bytes, 'elite_a_complete_ship_data.json'),
    playerShips: parse(source.bytes, 'elite_a_player_ships.json'),
    npcShipSummary: parse(source.bytes, 'elite_a_npc_ship_summary.json'),
    hitsToDestroy: parse(source.bytes, 'elite_a_hits_to_destroy.json'),
    npcDamageToPlayer: parse(source.bytes, 'elite_a_npc_damage_to_player.json'),
    hitRanges: parse(source.bytes, 'elite_a_hit_ranges.json'),
  };

  const model = buildCatalogue(pack, source.sourceHash);
  model.fixtures = buildFixtures(pack, source.sourceHash, {
    players: pack.completeShipData.playerShips,
    designs: model.designs,
    variants: model.variants,
  });
  const files = renderAll(model);
  files.set('reference/elite-a/manifest.json', manifestJson(source));

  const paths = [...files.keys()].sort();
  const drifted = [];
  for (const path of paths) {
    const absolute = join(ROOT, path);
    const wanted = files.get(path);
    let current = null;
    try {
      current = readFileSync(absolute, 'utf8');
    } catch { /* absent counts as drift, and as "write it" */ }
    if (current === wanted) continue;
    drifted.push(current === null ? `${path} (missing)` : path);
    if (!check) {
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, wanted);
    }
  }

  const counts = model.counts;
  console.log(`elite-a: ${counts.playerHulls} player hulls · ${counts.designs} designs`
    + ` · ${counts.blueprintSets} sets · ${counts.variants} exact variants`);
  console.log(`elite-a: ${counts.slotRows} slot rows (${counts.populatedSlots} populated)`
    + ` · ${counts.outgoingHitRows} outgoing · ${counts.incomingHitRows} incoming`
    + ` · ${counts.rangeRows} ranges`);
  console.log(`elite-a: source-hash ${source.sourceHash}`);

  if (check) {
    if (drifted.length === 0) {
      console.log(`elite-a: ${paths.length} generated file(s) up to date`);
      return;
    }
    console.error(`\nFAIL: ${drifted.length} generated file(s) differ from the pack:`);
    for (const path of drifted) console.error(`  ${path}`);
    console.error('\nRun `npm run generate:elite-a` and review the diff.');
    process.exit(1);
  }

  for (const path of paths) {
    console.log(`  ${drifted.includes(path) || drifted.includes(`${path} (missing)`)
      ? 'wrote' : 'same '} ${relative('.', path)}`);
  }
}

try {
  main();
} catch (error) {
  // A failed assertion here means the pack and this importer disagree. That is
  // a thing to read, not a stack to scroll past.
  console.error(`\nFAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
