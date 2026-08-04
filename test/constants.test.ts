// ONE HOME FOR EVERY CONSTANT — the gate that makes docs/TODO/90 stick.
//
// The move is a one-off tidy without this. `MAX_TRADERS` grew a second home in
// `encounters.ts` and `population.ts` and nothing noticed for months, and the
// only reason anybody knows is that a human read both files. A scan is the only
// thing that can notice.
//
// WHAT IT ENFORCES
//
//   1. Every module-level `UPPER_CASE` const declared in `src/` outside
//      `src/constants/` is named on THE LIST below. The list is the project
//      plan: one group per slice, shrinking as each subject moves. When a group
//      empties, its heading goes with it.
//   2. Nothing on the list is stale. A file that has lost its constants — or a
//      name that has — has to come off, or the list becomes a place to hide.
//   3. `src/constants/` imports nothing outside `src/constants/`. It is a leaf
//      and four modules plus the portability gate depend on that.
//   4. No name is declared twice inside `src/constants/`, and no name declared
//      there is declared anywhere else in `src/`. That is "one home", checked
//      rather than intended, and it is the check `MAX_TRADERS` would have
//      failed.
//
// HOW IT LOOKS, AND WHY NOT THE OBVIOUS GREP
//
// docs/TODO/90 shipped with a census grep that only matched a right-hand side
// beginning with an UPPER_CASE identifier. It therefore missed every derived
// constant wrapped in a call, a paren or a digit — `Math.round(MAX_ENERGY / 4)`,
// `0.1 / LEGACY_MAX_ENERGY`, `playerHull(...).energyRechargeRating` — and the
// item concluded from it that the codebase had exactly ONE derived constant when
// it has at least twenty. So this scan looks at the LEFT of the `=` and never at
// the right: a declaration is a declaration whatever it is initialised from.
//
// Two deliberate narrowings, both of them the item's own exclusions:
//
//   * COLUMN ZERO ONLY. An indented `const` is inside a function, and "values
//     whose only meaning is local to one function" are out of scope.
//   * COMMENTS STRIPPED. This project's prose names the things it deleted, on
//     purpose, and a scan that read the comments would fire on that history.
//
// `src/` only. `train/` and `tools/` are outside the home by decision, not by
// omission: the survey's answer is that `train/` should CONSUME src/constants/
// and keep its own search hyperparameters, seed bases and probe thresholds in a
// `train/constants.ts` that nothing in `src/` may import, and that `tools/` is a
// separate world. Neither is a game rule's home, so neither is gated here.
//
// Modelled on `test/ai.test.ts`'s purity list and `tools/sizes.mjs`: a policy
// enforced by scanning source, with an allowlist that is itself the review
// surface. Both of those have held.

import { readdirSync, readFileSync } from 'node:fs';
import { check } from './harness.ts';

/** Whole-file entry: every constant in it is still waiting for its slice. */
const ALL = '*' as const;

/**
 * THE LIST — everything still outside `src/constants/`, grouped by the slice
 * that will take it.
 *
 * Read this as the plan for docs/TODO/90 and not as a set of exemptions. A
 * group heading says what the subject IS, because that is also the argument for
 * what the constants file will be called; if naming a group needs an "and", it
 * is two slices.
 *
 * Three of the entries are not pending at all and say so in their heading. That
 * distinction matters: an exclusion the item has already decided (data tables,
 * a resolved object, a shader) is a finished answer, and burying it among the
 * pending work would leave the next reader re-deciding it.
 */
interface Group {
  /** what the subject IS, which is also the argument for the file it becomes. */
  readonly why: string;
  readonly files: Record<string, typeof ALL | readonly string[]>;
}

const OUTSIDE: readonly Group[] = [
  // --- MOVED, apart from a stated exception ---------------------------------

  {
    why: 'resolved once at load, not a rule — a catalogue lookup, and moving it would'
      + ' put a `requireShipDef` call inside a directory that may not import',
    files: {
      'game/ordnance.ts': ['MISSILE_HULL'],
    },
  },

  {
    why: 'per-module scratch vectors, reused so a per-frame path allocates nothing.'
      + ' docs/TODO/90 rules them out by name: they are MUTABLE, so a shared home'
      + ' would be a bug rather than a fix',
    files: {
      'game/npc.ts': ['ZERO', 'UP'],
    },
  },

  // --- pending slices --------------------------------------------------------

  {
    why: 'what is left of the fight: how much a kill is worth, what a hit costs, and'
      + ' which brain flies it',
    files: {
      'game/npc-energy.ts': ALL,
      'game/combat.ts': ALL,
      'game/impact-damage.ts': ALL,
      'game/threat.ts': ALL,
      'game/brains.ts': ALL,
      'game/brain-names.ts': ALL,
    },
  },

  {
    why: 'the ship the player flies, and the clock the world advances on. Two combat'
      + ' constants wait on it: the combat computer\'s turn caps are `TURN` and'
      + ' `RAM_MIN_SPEED` is `PLAYER_FLIGHT.maxSpeed`, and both are expressions today'
      + ' — writing them in src/constants/ before their anchors arrive would mean'
      + ' restating the anchor as a literal',
    files: {
      'player.ts': ALL,
      'game/ship-specs.ts': ALL,
      'game/world-step.ts': ALL,
      'game/views.ts': ALL,
      'game/hyperspace.ts': ALL,
      'galaxy/navigation.ts': ALL,
      'game/combat-computer.ts': ['CC_MAX_PITCH', 'CC_MAX_ROLL'],
      'game/tactic-choice.ts': ['RAM_MIN_SPEED'],
    },
  },

  {
    why: "the commander's pools, past the capacities: the recharge, the heat, the sun"
      + ' and the migration off the pre-TODO-27 scale',
    files: {
      'game/systems.ts': ALL,
    },
  },

  {
    why: 'who is out there: spawning, population and the roster a role draws from',
    files: {
      'game/spawning.ts': ALL,
      'game/population.ts': ALL,
      'game/encounters.ts': ALL,
      'game/ship-roles.ts': ALL,
      'game/role-variants.ts': ALL,
      'game/world.ts': ALL,
    },
  },

  {
    why: 'the career: the market, the law, contracts, missions and what a hold holds',
    files: {
      'galaxy/living.ts': ALL,
      'game/commander.ts': ALL,
      'game/contracts.ts': ALL,
      'game/law.ts': ALL,
      'game/jettison.ts': ALL,
      'game/missions.ts': ALL,
      'game/rating.ts': ALL,
      'game/shop.ts': ALL,
      'game/cargo.ts': ALL,
      'game/trumbles.ts': ALL,
    },
  },

  {
    why: 'the galaxy: the 1984 generator, its names and the encyclopaedia over it',
    files: {
      'galaxy/galaxy.ts': ALL,
      'galaxy/goatsoup.ts': ALL,
      'galaxy/descriptions.ts': ALL,
      'encyclopaedia/chart.ts': ALL,
      'encyclopaedia/filters.ts': ALL,
      'encyclopaedia/main.ts': ALL,
    },
  },

  {
    why: 'the station: its slot, the approach, and being pushed back out of it',
    files: {
      'game/docking.ts': ALL,
      'game/station.ts': ALL,
      'game/autopilot.ts': ALL,
      'hud/tunnel.ts': ALL,
      'ships/station-hulls.ts': ALL,
    },
  },

  {
    why: 'the console and the shell — in scope where a number is a rule about the game'
      + ' as well as about how it looks, and out where it is only drawing',
    files: {
      'hud/hud.ts': ALL,
      'hud/hud-binding.ts': ALL,
      'hud/hud-model.ts': ALL,
      'ui/screens.ts': ALL,
      'ui/key-help.ts': ALL,
      'game/command-help.ts': ALL,
      'game/controls.ts': ALL,
      'game/game.ts': ALL,
      'game/screens/save-transfer.ts': ALL,
      'engine/input.ts': ALL,
      'engine/keymap.ts': ALL,
      'engine/inert-dom.ts': ALL,
      'engine/render-stack.ts': ALL,
      'audio.ts': ALL,
      'manual.ts': ALL,
    },
  },

  {
    why: 'the docked combat trainer: who it sends at you, where they start and what it'
      + ' records',
    files: {
      'game/combat-sim.ts': ALL,
      'game/combat-sim-compare.ts': ALL,
      'game/combat-sim-opening.ts': ALL,
      'game/combat-sim-report.ts': ALL,
      'game/combat-sim-scenarios.ts': ALL,
      'game/screens/combat-sim-notes.ts': ALL,
      'game/screens/combat-sim-setup.ts': ALL,
      'viewer/main.ts': ALL,
      'viewer/gallery.ts': ALL,
      'viewer/gallery-main.ts': ALL,
    },
  },

  {
    why: 'saves: the versions, the namespaces and the ring — several of these are baked'
      + ' into keys on a real disk, so the slice that moves them moves nothing else',
    files: {
      'game/save-file.ts': ALL,
      'game/snapshot.ts': ALL,
      'game/state.ts': ALL,
      'game/storage.ts': ALL,
    },
  },

  {
    why: 'the policy seam: observation widths and the episode the trainer flies. The'
      + ' shapes here are what every shipped genome was fitted at, so they are a'
      + ' slice on their own and it is not a tidy',
    files: {
      'ai-training/policy.ts': ALL,
      'ai-training/scenario.ts': ALL,
    },
  },

  // --- decided: these stay where they are ------------------------------------

  {
    why: 'STAYS: hull and pack DATA, not constants. Generated or transcribed from a'
      + ' source, with their own provenance — docs/TODO/90 rules the tables out by'
      + ' name. The slice that reaches them records the exclusion; it does not move'
      + ' them',
    files: {
      'game/elite-a/catalogue.ts': ALL,
      'game/elite-a/combat-math.ts': ALL,
      'game/elite-a/designs.generated.ts': ALL,
      'game/elite-a/geometry.generated.ts': ALL,
      'game/elite-a/player-hulls.generated.ts': ALL,
      'game/elite-a/provenance.generated.ts': ALL,
      'game/elite-a/slots.generated.ts': ALL,
      'game/elite-a/variants.generated.ts': ALL,
      'game/ship-identity.ts': ALL,
      'ships/elite-a-faces.ts': ALL,
      'ships/elite-a-hulls.ts': ALL,
      'ships/harmless-hulls.ts': ALL,
      'ships/registry.ts': ALL,
    },
  },

  {
    why: 'STAYS: a GLSL program and a three.js material. Neither is a number anybody'
      + ' outside the file can act on',
    files: {
      'ships/geometry.ts': ALL,
      'world/planet.ts': ALL,
      'world/sun.ts': ALL,
    },
  },
];

// --- the scan ----------------------------------------------------------------

const ROOT = new URL('../src/', import.meta.url);

const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir))
    : /\.ts$/.test(e.name) ? [new URL(e.name, dir)] : []));

const FILES = walk(ROOT)
  .map((url) => ({ rel: url.pathname.slice(ROOT.pathname.length), url }))
  .sort((a, b) => a.rel.localeCompare(b.rel));

/**
 * The source with its comments gone.
 *
 * The same strip `test/ai.test.ts` and `tools/portability.mjs` use, and for the
 * same reason: this codebase deliberately writes down the constants it deleted,
 * and a scan that read prose would fire on the history that stops them coming
 * back.
 */
const code = (url: URL): string =>
  readFileSync(url, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');

/**
 * Every module-level UPPER_CASE constant a file declares.
 *
 * Deliberately blind to the initialiser: a name is captured whether it is a
 * literal, an expression, a call or a table. Anchored at column zero, so a
 * `const` inside a function is not one of these.
 */
const declarations = (source: string): string[] =>
  [...source.matchAll(/^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\b/gm)].map((m) => m[1]);

const inHome = (rel: string): boolean => rel.startsWith('constants/');

const found = new Map<string, string[]>();
for (const { rel, url } of FILES) {
  const names = declarations(code(url));
  if (names.length) found.set(rel, names);
}

console.log('\nconstants — one home for every one of them');

// The list, flattened. Two groups naming the same file would be two plans for
// it, so that is a failure of its own.
const listed = new Map<string, typeof ALL | readonly string[]>();
const claimedTwice: string[] = [];
for (const group of OUTSIDE) {
  for (const [rel, allowed] of Object.entries(group.files)) {
    if (listed.has(rel)) claimedTwice.push(rel);
    listed.set(rel, allowed);
  }
}
check('no file is claimed by two groups of the plan', claimedTwice.length === 0,
  claimedTwice.join(' · '));

// 1. NOTHING UNACCOUNTED FOR.
{
  const stray: string[] = [];
  for (const [rel, names] of found) {
    if (inHome(rel)) continue;
    const allowed = listed.get(rel);
    if (allowed === ALL) continue;
    const permitted = new Set(allowed ?? []);
    for (const name of names) if (!permitted.has(name)) stray.push(`${rel}: ${name}`);
  }
  check(`no game-rule constant is declared outside src/constants/ off the plan`
    + ` (${stray.length} stray)`,
  stray.length === 0,
  `${stray.slice(0, 8).join(' · ')}${stray.length > 8 ? ` (+${stray.length - 8} more)` : ''}`
    + ' — move it to src/constants/, or add it to OUTSIDE in test/constants.test.ts'
    + ' under the slice that owns it');
}

// 2. THE LIST IS NOT VACUOUS, AND IT IS NOT STALE.
{
  const remaining = [...found].filter(([rel]) => !inHome(rel))
    .reduce((n, [, names]) => n + names.length, 0);
  const homed = [...found].filter(([rel]) => inHome(rel))
    .reduce((n, [, names]) => n + names.length, 0);
  check(`the scan finds constants at all — ${homed} home, ${remaining} still out`
    + ` across ${[...found].filter(([rel]) => !inHome(rel)).length} files`,
  homed >= 30 && remaining >= 100);

  const stale: string[] = [];
  for (const [rel, allowed] of listed) {
    const names = found.get(rel);
    if (!names) { stale.push(`${rel} (no constants left)`); continue; }
    if (allowed === ALL) continue;
    for (const name of allowed) {
      if (!names.includes(name)) stale.push(`${rel}: ${name} (gone)`);
    }
  }
  check('...and every entry on the plan still has something to account for',
    stale.length === 0,
    `${stale.join(' · ')} — take it off the list in test/constants.test.ts`);
}

// 3. THE HOME IS A LEAF.
//
// Everything imports it, so a single edge out of it can create a cycle — and it
// would propagate the portability gate's contamination in both directions, since
// `npc.ts` and `combat-computer.ts` import `ai-training/` and `ai-training/` is
// reached from the trainer. `import type` is not exempted: the point of the rule
// is that a reader can see the directory has no dependencies, and an erased
// import still puts one in the file.
{
  const edges: string[] = [];
  for (const { rel, url } of FILES) {
    if (!inHome(rel)) continue;
    for (const m of code(url).matchAll(/^\s*(?:import|export)\b[^;]*?from\s+'([^']+)'/gm)) {
      // relative, and not escaping the directory. A bare specifier ('three')
      // fails the first half; '../game/rng.ts' fails the second.
      if (!m[1].startsWith('./') || m[1].includes('..')) edges.push(`${rel} -> ${m[1]}`);
    }
  }
  check('src/constants/ imports nothing outside src/constants/', edges.length === 0,
    edges.join(' · '));
}

// 4. ONE HOME, CHECKED.
{
  const home = new Map<string, string>();
  const twice: string[] = [];
  for (const [rel, names] of found) {
    if (!inHome(rel)) continue;
    for (const name of names) {
      const already = home.get(name);
      if (already) twice.push(`${name} (${already} and ${rel})`);
      else home.set(name, rel);
    }
  }
  check(`no constant is declared twice inside src/constants/ (${home.size} names)`,
    twice.length === 0, twice.join(' · '));

  const shadowed: string[] = [];
  for (const [rel, names] of found) {
    if (inHome(rel)) continue;
    for (const name of names) {
      if (home.has(name)) shadowed.push(`${name}: ${home.get(name)} and ${rel}`);
    }
  }
  check('...and nothing in src/ redeclares a name that lives there',
    shadowed.length === 0,
    `${shadowed.join(' · ')} — this is the MAX_TRADERS failure, in a file that`
    + ' can see the answer');
}
