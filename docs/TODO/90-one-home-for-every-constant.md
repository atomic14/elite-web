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

**The count of live bugs is not the argument.** Chris, 2026-08-04: *"It doesn't
matter if you can't find a problem now — it's a ticking time bomb."* This item
is not a bug hunt and it should not be scoped, justified or declared finished on
the basis of how many disagreements a survey turns up. 539 values with no rule
about where they live and no gate on defining a second one is the hazard;
`MAX_TRADERS` is one fuse that happens to be visible. A reviewer who moves the
constants and reports "and none of them disagreed" has done the job correctly.

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

## Where the meaning goes — decided

Some of this codebase's best documentation is a constant's neighbourhood.
`separation.ts`'s header carries a swept table showing what 260 costs at eight
ships; `break-off.ts` carries the arithmetic behind 220 and Chris's account of
flying it; `brains.ts` carries the measured table behind g3. The obvious worry
is that moving those values away from that writing loses it.

**It does not, because the writing moves too.** Chris, 2026-08-04: *"For the
ones where meaning is in the context — namespacing the constants in a meaningful
way with sensible comments is the answer."*

So there is no tension with CLAUDE.md to resolve, and an earlier draft of this
item invented one. "A constant is worth the sentence that says how it was
chosen, beside it" is satisfied by the sentence travelling with the constant.
The namespace supplies the context the old surrounding module used to supply,
and the comment supplies the reasoning. A constant, its comment and its measured
evidence are one thing and they live in one place.

What this rules out, explicitly:

- **No pointers back to the old module.** "See `separation.ts` for the sweep" is
  the reasoning living in a second place and being kept in step by hope.
- **No abbreviating a sweep table to make it fit.** If the evidence is forty
  lines, forty lines move. CLAUDE.md: trimming real content to fit under a
  ceiling is not an answer.
- **No constant whose comment is its own name restated.** `/** The maximum
  number of traders. */ MAX_TRADERS` tells a reader nothing they could not see.
  The comment says what the value MEANS and, where it is known, how it was
  chosen.

This is what forces the shape below: forty lines of evidence per swept constant
does not go in one flat file, so the home is a directory whose files are each
about one subject.

## The shape

`src/constants/`, one file per subject, each exporting one namespace. The
subjects fall out of the survey — combat, flight, ordnance, spawning and
population, economy and the market, the galaxy, docking, the HUD — and the test
of a good split is the same one CLAUDE.md applies everywhere: if naming the file
needs an "and", it is two files.

This is a directory rather than one flat file because the evidence moves with
the values. It is still one source of truth: there is exactly one place a given
constant can be, and the gate below enforces it.

## Divergence is the thing to hunt

Chris, 2026-08-04: *"We should also be very aware of constants that do similar
things that should be the same but have somehow diverged."*

`MAX_TRADERS` is the easy case — two homes that still agree. The dangerous case
is two homes that have **stopped** agreeing, because that is not a latent hazard
at all, it is a live bug that has already happened and that nobody has noticed.
It looks like this: one module caps something at 3,500 and another at 3,400,
both meaning "as far as a laser reaches"; one file's reload is 2.0s and
another's is 2.2s, both meaning "the gap between warheads"; a UI readout assumes
220 for a speed the flight model moved to 240 two commits ago.

By construction nothing in the codebase can find these, which is why the review
has to READ:

- They do not share a name, or `MAX_TRADERS` would be the template and a name
  scan would find them.
- They do not share a value — **that is precisely what has gone wrong** — so a
  value scan cannot see them either. A value scan finds the pairs that still
  agree and is blind to the ones that matter.
- They are usually in different subsystems, so no one file's author can see both.

Every such pair the review turns up is a finding in its own right and needs a
decision before anything moves: which value is right, whether the other is a
deliberate difference nobody wrote down, and what the correction does to the
game. **Fixing a divergence is a behaviour change** and must not be smuggled in
under a refactor that claims to be byte-identical. Land those separately, each
with its own measurement, before or after the move — never inside it.

## How this gets done

This is too large for one pass and the survey half is pure reading, so it splits
in two.

**Phase 1 — survey, read-only, fanned out across subagents.** `src/` is ~35,500
lines over ~140 files, plus `train/` and `tools/`. Partition it by subject, one
agent per partition, and require each to READ ITS FILES IN FULL. Grep is banned
in this phase and the ban is the point: a constant whose name you would not
guess is exactly what the search misses, and divergence has neither a shared
name nor a shared value to search for. Each agent reports, for every constant it
finds: the value, what it actually means, how it was chosen if the file says,
the proposed namespace, and every other constant anywhere in its partition that
looks like it might be the same rule.

**Phase 2 — cross-partition synthesis.** The divergences that matter most are
between subsystems, so no phase-1 agent can see them. One pass over all the
inventories together, looking for pairs that mean the same thing, and producing
the list of decisions Chris has to make before any code moves.

**Then the work**, in reviewable slices — one subject per commit, each proved
byte-identical, with any divergence corrections landed separately as the
behaviour changes they are.

## What to work out

- **The namespace scheme.** Nested frozen objects (`COMBAT.BREAK_OFF_RANGE`) give
  real namespacing and a discoverable shape, at the cost of touching every call
  site and of slightly worse tree-shaking than bare `export const`. Prefixed flat
  names are cheaper and weaker. Pick one and say why. Whichever it is, the
  namespace has to carry meaning — it is doing the job the surrounding module
  used to do, so `MISC` or `GAME` is a failed split.
- **What counts.** A rule for which of the 539 move. Suggested starting point:
  every value that any OTHER module could reasonably need, plus every value that
  encodes a game rule. Excluded: mutable scratch, loop bounds, and values whose
  only meaning is local to one function.
- **Derived constants become expressions.** Wherever the review finds two
  constants that are meant to track each other, the dependent one is written as
  an expression over the other rather than as a second literal. That is the half
  of the ask that buys the most and it cannot be done mechanically — it needs
  the judgement about which relationships are real. Where the answer is "these
  two are the same number and NOT the same rule", that gets written down beside
  both, because the next reader will wonder the same thing.
- **`train/` and `tools/`.** 88 more constants. Decide whether they join or
  whether the home is `src/`-only, and note that `train/` must not pull the game
  into its module graph in a way the portability gate objects to.

## The CLAUDE.md instruction

Chris asked for this to be explicit, and the wording matters — the failure mode
is an agent grepping for a name it has already decided on, not finding it, and
adding a second home for a constant that exists under a different name. The
instruction is to READ, not to search:

> **Read `src/constants/` before you start.** Read the files, in full. Do not
> grep it, do not search it for the name you have in mind, and do not skim it —
> the whole point is to find the constant you did not know was already there,
> under a name you would not have guessed. Before adding any constant, including
> one derived from another, confirm it does not already exist. A value that
> exists twice is a rule with two homes, and this is the file that stops that.

Fit it to the file's voice when it lands, but keep "read it, do not grep it" and
keep the reason attached to it — an instruction without its reason is one a
future reader will optimise away.

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

- `src/constants/` exists, split by subject, each file exporting a meaningfully
  named namespace, holding every constant the review decided should move —
  with its comment and, where it has one, its measured evidence. No module
  outside it holds a game-rule constant, and no pointer back to an old home
  remains.
- **A gate.** A test that fails when a game-rule constant is defined outside the
  new home, in the spirit of `test/ai.test.ts`'s purity list and the sizes gate.
  Without it this is a one-off tidy that decays, and the next `MAX_TRADERS` will
  not be caught either. Break it to prove it works.
- `MAX_TRADERS` has one definition.
- Every relationship the review judged real is an expression, not a second
  literal, and `gunnery.ts`'s three 3500s and the three 6000s are each resolved
  one way or the other with the answer written down.
- CLAUDE.md carries the instruction above, explicitly saying to READ the files
  rather than grep them, with the reason attached.
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
