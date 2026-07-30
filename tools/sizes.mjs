// Are any files getting away from us?
//
// Two files in this project reached 3,244 and 4,729 lines, and both got there
// the same way: they were the default place to put things, so nobody ever
// decided. The cost was not tidiness. A kitchen-sink file is where one rule
// quietly grows two homes — the failure this codebase is organised against —
// and it is where parallel work collides: three agents on unrelated modules
// still conflicted in the same test file, and one merge spliced a section
// inside another's block and left an unbalanced brace.
//
// So the ceiling is checked rather than encouraged. Exceeding it is allowed;
// exceeding it SILENTLY is not. Anything over the limit must be listed below
// with a reason, which makes the list itself the review surface — the same
// shape as the purity list and the seeded-rng exemptions, both of which have
// held.
//
// Run: node tools/sizes.mjs   (also `npm run sizes`, and part of `npm run check`)

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Above this, a file needs a stated reason. */
const LIMIT = 400;

/**
 * Files allowed to exceed the limit, each with why.
 *
 * A reason is not "it is long". It is why splitting it would make the code
 * worse — usually that the file is one table, or one grammar, or a single
 * cohesive rule set that reads worse in pieces.
 *
 * Anything here that is really just unfinished work should say so, with the
 * split it is waiting for, so the list does not become a place to hide.
 */
const ALLOWED = {
  // one data table each: splitting a table is strictly worse
  'ships/geometry.ts': 'every hull as vertex/edge/face tables — one roster, read top to bottom',
  'galaxy/goatsoup.ts': "the 1984 planet-description grammar, verbatim",
  'tools/species-prompts.ts': 'generation prompts, one per species — a data file',

  // cohesive single subsystems
  'ui/screens.ts': 'one render function per screen; they share layout helpers and nothing else',
  'hud/hud.ts': 'the cockpit console — one painter, one canvas set',
  'ai-training/scenario.ts': 'one Episode plus its four fitness functions; the fitness is the methodology and reads as a unit',
  'game/world-step.ts': 'the five phases of flight in the order they must run — the order IS the content',
  'game/combat-sim-report.ts': 'one recorder plus its derivations; splitting the maths from the accumulation would put a statistic in two files',
  'game/combat-sim-scenarios.ts': 'the scenario table plus the mode rules — data, and the two pure functions over it',
  'train/evolve.ts': 'the trainer: one search loop with its selection and logging',
  'test/campaign.ts': 'one career simulation, run thousands of times',
  'test/world-step.test.ts': 'the five phases of the step in the order they run, mirroring world-step.ts — the order IS the content on both sides',
  'test/combat-sim-career.test.ts': "the combat trainer's one rule — nothing that happens in the simulator leaves it — argued across three enforcement layers. Splitting it would put half a safety argument in another file.",
  'test/playtest.js': 'a console paste — it cannot import, so it must be self-contained',

  // WAITING TO BE SPLIT — not exceptions, debts
  'game/game.ts': 'DEBT: down from 3,244 and still the orchestrator plus leftovers. Target ~300.',
  'game/npc.ts': 'DEBT: behaviour and brain flight in one file; the flight half wants its own.',
  'game/combat-sim.ts': 'DEBT: the session lifecycle AND the twelve-member StepHost table in one file. The host is the safety-critical surface and wants to be readable on its own — split to combat-sim-host.ts.',
  'game/contracts.ts': 'DEBT: holds contracts AND pirate economics (markOf, pirateThreat, memberTier), which are not contracts. The threat model wants its own file.',
};

const roots = ['src', 'test', 'train', 'tools'];
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  return e.isDirectory() ? walk(p) : /\.(ts|js|mjs)$/.test(e.name) ? [p] : [];
});

const over = [];
for (const root of roots) {
  for (const path of walk(root)) {
    const n = readFileSync(path, 'utf8').split('\n').length;
    if (n <= LIMIT) continue;
    // match on the shortest suffix that appears in the allowlist
    const key = Object.keys(ALLOWED).find((k) => path.endsWith(k));
    over.push({ path, n, why: key ? ALLOWED[key] : null });
  }
}
over.sort((a, b) => b.n - a.n);

const unlisted = over.filter((f) => !f.why);
const debts = over.filter((f) => f.why?.startsWith('DEBT'));

for (const f of over) {
  const tag = f.why ? (f.why.startsWith('DEBT') ? 'DEBT ' : 'ok   ') : 'NEW  ';
  console.log(`${tag} ${String(f.n).padStart(5)}  ${f.path}`);
  if (f.why) console.log(`              ${f.why}`);
}
console.log(`\n${over.length} files over ${LIMIT} lines · ${debts.length} known debts`
  + ` · ${unlisted.length} unlisted`);

if (unlisted.length) {
  console.error(`\nFAIL: ${unlisted.length} file(s) over ${LIMIT} lines with no stated reason.`);
  console.error('Split it, or add it to ALLOWED in tools/sizes.mjs saying why splitting');
  console.error('would make the code worse. "It is long" is not a reason.');
  process.exit(1);
}
console.log('no unlisted oversize files');
