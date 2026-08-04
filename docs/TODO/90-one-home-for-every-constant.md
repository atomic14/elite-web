# 90 — One home for every constant

**Kind:** architecture · **Severity:** high · **Size:** large
**Depends on:** none · Chris, 2026-08-04 · this is a policy change, read it whole

## Why

Chris, 2026-08-04: *"I'd like a single constants file with a set of namespaced
constants... We want a single source of truth."*

CLAUDE.md's recurring failure is one rule with two homes, kept in step by hope,
and a constant is the smallest possible rule. Today they are federated — each
one beside the code it serves — and nothing checks that a value is defined once.

Counted 2026-08-04:

| where | `UPPER_CASE` consts |
| --- | --- |
| `src/`, exported | 251, across 74 files |
| `src/`, module-private | 200 |
| `train/` | 54 |
| `tools/` | 34 |
| **total** | **539** |

**The federation has already failed at least once.** `MAX_TRADERS = 4` is
defined in `game/encounters.ts:43` and again in `game/population.ts:41`. Both
mean "never more than four traders in a system", both are exported, and the two
files are the two halves of the same subject. Nothing detects it. They agree
today, which by CLAUDE.md's own standard is still a defect: nobody can change
either without remembering the other.

**Derivation is currently done by copying the number.** Exactly ONE constant in
`src/` is expressed in terms of another — `systems.ts:105`'s
`SHIELD_REGEN = MAX_SHIELD * SHIELD_REGEN_FRACTION`. Every other relationship
between two values is a coincidence a reader has to spot:

- `gunnery.ts` has `LASER_RANGE = 3500`, `NPC_LASER_RANGE = 3500` and
  `NPC_HIT_FALLOFF = 3500`, in one file. Whether the hit falloff is MEANT to be
  the laser's reach — so that a change to one should move the other — is not
  written down anywhere.
- `npc-targeting.ts` has `PIRATE_HUNT_RANGE = 6000` and `HUNTER_RANGE = 6000`,
  and `hud.ts` has `SCANNER_RANGE = 6000`. "They engage at scanner range" is a
  plausible rule and nothing states it.

## What is NOT the problem

- **Not every repeated value.** `player.ts`'s `ACCEL = 220`,
  `combat-computer.ts`'s `CC_MAX_SPEED = 220`, `break-off.ts`'s
  `BREAK_OFF_RANGE = 220` and `hud-model.ts`'s `ASSUMED_TARGET_SPEED = 220` are
  an acceleration, a speed, a distance and a speed. **A sweep that unifies on
  VALUE would fuse unrelated rules and be worse than the disease.** The review
  is by meaning, one constant at a time, and "these two are the same number and
  not the same rule" is a valid and common answer that should be written down
  where it is found.
- **Not the local scratch.** `const ZERO = new THREE.Vector3()` and
  `const UP = new THREE.Vector3(0, 1, 0)` appear in four and five modules. They
  are per-module scratch to avoid allocating per frame, they are mutable, and
  centralising a shared mutable vector would be a bug rather than a fix. The
  item needs a rule for what counts, and this is the clearest exclusion.
- **Not the tables.** `ship-specs.ts`, `galaxy.ts`'s market model and the
  Elite-A generated catalogue are DATA, not constants. They are generated or
  transcribed from a source and they have their own provenance.

## The tension this has to resolve, out loud

CLAUDE.md currently says two things that pull against the ask:

> **Leave the reasoning where the next person will look.** A constant is worth
> the sentence that says how it was chosen, beside it.

> **Keep files small**, and keep each one about a single thing.

Some of this codebase's best documentation is a constant's neighbourhood.
`separation.ts`'s header carries a swept table showing what 260 costs at eight
ships; `break-off.ts` carries the arithmetic behind 220 and Chris's account of
flying it; `brains.ts` carries the measured table behind g3. A "short
descriptive comment" in a central file cannot hold those, and deleting them to
fit would be exactly the trimming CLAUDE.md forbids.

**Proposed resolution, to be confirmed or overridden when the work starts:** the
VALUE moves and the long-form reasoning stays where it was measured, with the
central entry carrying the short comment plus a pointer to the module that
holds the sweep. A constant then has one home for its value and one home for
its evidence, and neither is duplicated. If that turns out to read badly in
practice, say so and re-decide — but decide it before moving 500 constants, not
after.

## What to work out

- **The namespace scheme.** Nested frozen objects (`COMBAT.BREAK_OFF_RANGE`) give
  real namespacing and a discoverable shape, at the cost of touching every call
  site and of slightly worse tree-shaking than bare `export const`. Prefixed flat
  names are cheaper and weaker. Pick one and say why.
- **One file, or one directory with a barrel.** 539 constants with comments will
  not fit under the 400-line ceiling. Either the file gets a deliberate
  allowlist entry with a stated reason — which CLAUDE.md permits — or it becomes
  `src/constants/` split by subject with an index, which is still one source of
  truth and keeps each file about a single thing. The second looks right; argue
  it.
- **What counts.** A rule for which of the 539 move. Suggested starting point:
  every value that any OTHER module could reasonably need, plus every value that
  encodes a game rule. Excluded: mutable scratch, loop bounds, and values whose
  only meaning is local to one function.
- **Derived constants become expressions.** Wherever the review finds two
  constants that are meant to track each other, the dependent one is written as
  an expression over the other rather than as a second literal. That is the half
  of the ask that buys the most and it cannot be done mechanically — it needs
  the judgement about which relationships are real.
- **`train/` and `tools/`.** 88 more constants. Decide whether they join or
  whether the file is `src/`-only, and note that `train/` must not pull the game
  into its module graph in a way the portability gate objects to.
- **The CLAUDE.md instruction Chris asked for**: agents read this file before
  starting work and check whether a constant already exists before adding one.

## Watch out for

- **The new file must import nothing.** A module everything imports has to be a
  leaf or it will create cycles. `brain-names.ts` already makes this argument for
  itself and is the precedent to follow.
- **This is a 500-site refactor with no behaviour change**, so it is exactly the
  case CLAUDE.md's "prove equivalence, not self-consistency" is for: the
  campaign, `npm run elite-a`, the AI gates and a seeded training episode must
  all be byte-identical afterwards. If any of them moves, a value was
  transcribed wrong, and that is the whole risk of this job.
- **Do it in reviewable slices.** One commit per subject area, each
  byte-identical, rather than one commit that moves 539 constants and cannot be
  read.
- **A move without a gate will drift back.** See below.

## Acceptance

- One source of truth exists — a file or a `src/constants/` directory with an
  index — holding the constants the review decided should move, each with a
  short comment saying what it is, and a pointer to the module holding its
  evidence where that evidence is long.
- **A gate.** A test that fails when a game-rule constant is defined outside the
  new home, in the spirit of `test/ai.test.ts`'s purity list and the sizes gate.
  Without it this is a one-off tidy that decays, and the next `MAX_TRADERS` will
  not be caught either. Break it to prove it works.
- `MAX_TRADERS` has one definition.
- Every relationship the review judged real is an expression, not a second
  literal, and `gunnery.ts`'s three 3500s and the three 6000s are each resolved
  one way or the other with the answer written down.
- CLAUDE.md instructs agents to read the constants home first and to check
  before adding.
- `npm run build`, `npm run campaign`, `npm run elite-a` and
  `npm run portability` all byte-identical to before the work.

## Verify

```sh
# the census
grep -rhE '^export const [A-Z][A-Z0-9_]+ *[:=]' src | wc -l   # 2026-08-04: 251
grep -rhE '^const [A-Z][A-Z0-9_]+ *[:=]' src | wc -l          # 2026-08-04: 200

# the duplicate that proves the point
grep -rn 'MAX_TRADERS' src
# encounters.ts:43 and population.ts:41, both `= 4`

# the only derived constant in the codebase
grep -rnE '^(export )?const [A-Z][A-Z0-9_]+ *(: *[A-Za-z<>]+ *)?= *[A-Z][A-Z0-9_]*[ )*/+-]' src
# systems.ts:105 only
```
