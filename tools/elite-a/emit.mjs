// Rendering the Elite-A catalogue to text — and nothing else.
//
// `buildCatalogue()` decides what the data IS; this file decides what it looks
// like on disk. Both halves are pure, which is what lets `--check` re-render
// into memory and compare bytes: there is no path that writes something the
// check could not have produced.
//
// Determinism is the whole contract here, so the rules are narrow:
//
//   * key order is insertion order, fixed by the builder — never Object.keys()
//     of something reordered, never a sort that depends on locale;
//   * numbers go through `num()`, which refuses anything non-finite so a NaN
//     cannot silently become the string "NaN";
//   * nothing consults the clock, the environment, or a random source.
//
// Every file opens with the same stamp: what wrote it, that it is not to be
// edited, and the hash of the pack it came from.

import { assert } from './build.mjs';

const num = (value) => {
  assert(typeof value === 'number' && Number.isFinite(value),
    `cannot emit non-finite number ${String(value)}`);
  return String(value);
};

/** A JSON/TS scalar. Strings use JSON quoting, which is valid TypeScript. */
function scalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return num(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(scalar).join(', ')}]`;
  if (typeof value === 'object') {
    return `{ ${Object.entries(value).map(([k, v]) => `${k}: ${scalar(v)}`).join(', ')} }`;
  }
  throw new Error(`cannot emit ${typeof value}`);
}

/** One record per line: long lines, but a diff that points at one variant. */
const records = (rows) => rows.map((row) => `  ${scalar(row)},`).join('\n');

/** Reflow a role sentence to comment width, so no generated line runs away. */
function commentLines(role) {
  const lines = [];
  let line = '//';
  for (const word of role.split(' ')) {
    if (`${line} ${word}`.length > 78) { lines.push(line); line = '//'; }
    line += ` ${word}`;
  }
  return [...lines, line];
}

function stamp(role, sourceHash) {
  return [
    '// GENERATED FILE — DO NOT EDIT.',
    '//',
    ...commentLines(role),
    '//',
    '// Written by `npm run generate:elite-a` from the vendored pack under',
    '// reference/elite-a/source. To change it, change the importer or the pack,',
    '// regenerate, and review the diff. `npm run generate:elite-a -- --check`',
    '// fails if this file and the pack have drifted apart.',
    '//',
    `// source-hash: ${sourceHash}`,
    '',
  ].join('\n');
}

function tsModule(role, sourceHash, typeName, constName, elementType, rows) {
  return `${stamp(role, sourceHash)}
import type { ${typeName} } from './types.ts';

export const ${constName}: readonly ${elementType}[] = [
${records(rows)}
];
`;
}

/** Wrap a long flat array so a fixture stays a file rather than one line. */
function wrapped(values, perLine, indent = '') {
  const lines = [];
  for (let i = 0; i < values.length; i += perLine) {
    lines.push(indent + values.slice(i, i + perLine).map(scalar).join(','));
  }
  return lines.join(',\n');
}

/** Deterministic JSON: our key order, our line breaks, no library involved. */
function fixtureJson(fixture, longArrayKeys) {
  const body = Object.entries(fixture).map(([key, value]) => {
    if (longArrayKeys.has(key)) {
      return `${JSON.stringify(key)}: [\n${wrapped(value, 32)}\n]`;
    }
    if (Array.isArray(value) && value.length > 24) {
      return `${JSON.stringify(key)}: [\n${wrapped(value, value[0] && Array.isArray(value[0]) ? 1 : 16)}\n]`;
    }
    return `${JSON.stringify(key)}: ${scalar(value)}`;
  });
  return `{\n${body.join(',\n')}\n}\n`;
}

/**
 * Every generated artefact, as `relative path -> exact bytes`.
 *
 * The caller writes the map or compares it; it never re-derives a path, so
 * writing and checking cannot disagree about which files are generated.
 */
export function renderAll(model) {
  const hash = model.sourceHash;
  const files = new Map();

  files.set('src/game/elite-a/provenance.generated.ts',
    `${stamp('The pack this catalogue came from, and what it contained.', hash)}
/** SHA-256 over the vendored pack's per-file hashes — see reference/elite-a. */
export const ELITE_A_SOURCE_HASH = ${JSON.stringify(hash)};

/** What the importer counted. A parity gate can assert these without the pack. */
export const ELITE_A_COUNTS = {
${Object.entries(model.counts).map(([k, v]) => `  ${k}: ${num(v)},`).join('\n')}
} as const;

/** Bit position of each NEWB flag, solved from all ${num(model.counts.slotRows)} slot rows. */
export const ELITE_A_NEWB_BITS = {
${Object.entries(model.newbBits).map(([k, v]) => `  ${k}: ${num(v)},`).join('\n')}
} as const;
`);

  files.set('src/game/elite-a/player-hulls.generated.ts', tsModule(
    'The 15 flyable Elite-A hulls: lasers, mounts, armour and flight envelope.',
    hash, 'EliteAPlayerHull', 'ELITE_A_PLAYER_HULLS', 'EliteAPlayerHull', model.playerHulls));

  files.set('src/game/elite-a/designs.generated.ts', tsModule(
    'The 38 NPC/object designs: identity, the header fields that never vary '
    + 'across a design, laser classification and the resolved recommended variant.',
    hash, 'EliteADesign', 'ELITE_A_DESIGNS', 'EliteADesign', model.designs));

  files.set('src/game/elite-a/variants.generated.ts', tsModule(
    'The 260 exact S.A-S.W variants: only the header fields that differ between '
    + "a design's variants. Everything constant lives on the design.",
    hash, 'EliteAVariant', 'ELITE_A_VARIANTS', 'EliteAVariant', model.variants));

  files.set('src/game/elite-a/slots.generated.ts', tsModule(
    'The 713 blueprint-slot assignments: which design fills which role in which '
    + 'set, with its raw NEWB byte.',
    hash, 'EliteASlot', 'ELITE_A_SLOTS', 'EliteASlot', model.slots));

  files.set('src/game/elite-a/geometry.generated.ts',
    `${stamp('One hull per design — deduplicated, since every variant of a design '
      + 'shares it. Flat arrays with a fixed stride; see types.ts for the columns.',
      hash)}
import type { EliteAGeometry } from './types.ts';

export const ELITE_A_GEOMETRY: readonly EliteAGeometry[] = [
${model.geometry.map((g) => `  {
    designId: ${num(g.designId)},
    vertices: ${scalar(g.vertices)},
    edges: ${scalar(g.edges)},
    faces: ${scalar(g.faces)},
  },`).join('\n')}
];
`);

  files.set('test/fixtures/elite-a/hits-to-destroy.json',
    fixtureJson(model.fixtures.hitsToDestroy,
      new Set(['effectiveDamagePerHit', 'hitsToDestroy'])));
  files.set('test/fixtures/elite-a/npc-damage-to-player.json',
    fixtureJson(model.fixtures.npcDamageToPlayer,
      new Set(['cleanBeforeArmour', 'originalBeforeArmour',
        'cleanAfterArmour', 'originalAfterArmour'])));
  files.set('test/fixtures/elite-a/hit-ranges.json',
    fixtureJson(model.fixtures.hitRanges, new Set()));

  return files;
}
