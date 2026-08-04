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

**Derivation is done inconsistently — some constants derive, most copy.** An
earlier draft of this item claimed exactly one constant in `src/` was expressed
in terms of another; three survey partitions independently proved that wrong.
The census grep below only matched a right-hand side beginning with an
UPPER_CASE identifier, so it missed every derivation wrapped in `Math.round`, a
parenthesis, a digit or a function call. There are at least twenty, listed in
docs/TODO/90-constants-survey.md.

So the pattern is established and good. What is missing is its consistent
application, and the survey's R-findings are the list of places where a stated
relationship is written as a second literal instead. Several relationships are
asserted in prose and enforced by nothing:

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

## Scope: game constants. Not styling.

Chris, 2026-08-04: *"Ignore the CSS, we care about game constants."*

So **out of scope**, and not to be reopened by a tidy-minded reviewer:

- The four phosphor colours, wherever they live — the CSS custom properties in
  `style.css`/`manual.css`/`landing.css`, the hex copies in `hud.ts` and
  `gallery.ts`, the `rgba()` decimal spellings, and the encyclopaedia's separate
  green and amber. `#4dff5c` has fourteen homes and they stay.
- Cockpit and panel layout in CSS — `top: 42%`, panel widths, z-indexes.
- `tools/posterise.py`'s palette, which is a copy of the stylesheet's greens.
- Pure drawing geometry in `hud.ts` — bracket radii, arrow polygons, scanner
  ring fractions. Single-use numbers that describe a shape nobody else needs to
  know.

**In scope, including where it sits in a presentation file.** A game rule is a
game rule wherever it is written down, so these stay in:

- `SCANNER_RANGE`, `TARGET_BRACKET_RANGE`, `SUNSKIM_COMPASS_RANGE`,
  `STATION_COMPASS_RADII` — ranges the simulation also has opinions about.
- The two gauge thresholds that guess at a rule they could read: the laser bar
  reddening at 0.8 against a real cut-out of 0.98, and the cabin bar at 0.72
  against death at 0.99.
- `ASSUMED_TARGET_SPEED` — a display constant standing next to the live value it
  is guessing at, and the worst single bug the survey found.
- `LOCAL_SCALE`, `LOCAL_CANVAS` and the chart projection's `256`/`128`/`/4`,
  which are the galaxy's own geometry.
- Prose that restates a live number: the briefing's fuel range and starting
  credits, `audio.ts`'s countdown pitch encoding `COUNTDOWN`.
- `SIGHT_Y` moves as a game constant. Its CSS twin stays duplicated, and that is
  now a deliberate, recorded exception rather than an open problem.

The test is **"is this a rule about the game, or about how it looks"** — and
when a number is both, it is in scope and the stylesheet keeps its copy.

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

## Running a slice — the recipe

Written down because the first five slices were driven from prompts that no
longer exist. **This section is the handoff.** A cold session should be able to
run slice six from here without asking anything.

### 1. Read, in this order

`CLAUDE.md` · this file, especially Progress · `90-constants-cleanup.md` ·
the relevant partition of `90-constants-survey.md` · then `src/constants/*.ts`
and `test/constants.test.ts` in full. Five slices set the precedent; match it
rather than inventing a sixth shape.

### 2. Pick the slice from the gate, not from a list here

`test/constants.test.ts`'s `OUTSIDE` array **is** the plan. Each entry is a
group with a `why` and the files still owed. Take one entry, move its
constants, shrink the entry. When a file declares nothing it comes off
entirely. The gate prints `N home, M still out across F files`; that must go
down every slice.

### 3. The shape, already decided

The file is the namespace: `src/constants/<subject>.ts`, flat
`export const`s, consumed as `import * as X` where a prefix reads well.
**The evidence moves WHOLE** — a forty-line sweep table moves as forty lines.
No abbreviating, no pointers back to the old home. **`src/constants/` imports
nothing outside itself**; if a constant cannot come without breaking that,
leave it and add it to the cleanup list with the reason.

Logic stays where it is and imports what it needs. You are moving values.

### 4. Prove equivalence — the worktree check

Every slice has done this and it is the strongest check available:

```sh
git worktree add /tmp/base HEAD
ln -s "$PWD/node_modules" /tmp/base/node_modules
```

Then a throwaway script that imports the OLD modules from `/tmp/base/src` and
the new constants from `src/`, compares every moved name, and prints
`N compared, M changed`. Where a constant is only observable through something
else — the roster's computed accel, a seeded world's frames — compare that
instead. **Then break your own harness** by nudging one constant, confirm the
count moves, and restore it. A harness that reports 0 changed because it is
comparing nothing is the failure mode.

`git worktree remove --force /tmp/base` afterwards.

### 5. The four gates

`npm run build` (lint + tests) · `npm run campaign` — byte-identical on all 33
balance rows · `npm run elite-a` · `npm run portability` — 0 contaminated.
**Read the current baselines from the last Progress entry**, not from here;
they move every slice.

### 6. Break the gate, and break what you wrote

Add `export const SOME_RULE = 42` to a file in your slice and confirm the
constants gate fails. Then break each rule you claimed to protect and confirm
the right test goes red. CLAUDE.md: a gate you have not broken is not a gate.

### 7. Traps that have actually bitten

- **`git checkout <file>` to undo a deliberate break destroys your real edits.**
  Slice 1 lost everything it had done to `gunnery.ts` that way. Undo with a
  targeted string replacement.
- **Grep `test/playtest.js` and `train/jameson-autopilot.js` for every name you
  move.** They reach into `src/` with *dynamic* imports, so a moved name becomes
  `undefined` with no error — a namespace object has no missing-property check.
  Slice 2 left the autopilot computing `NaN` for the player's speed and nothing
  went red, because nothing runs those files.
- **A threshold gate that probes at `CONSTANT ± 1` is vacuous** — the probe
  moves with the constant. Slice 5 wrote one, and all three mass-lock rungs
  stayed green at 4,510. Bisect the threshold out of the real function and
  compare it to the constant.
- **An optional field is not automatically a tolerance.** Check what writes it.
- **A comment that blames old saves may be describing live behaviour.** The
  identity round found a tier fallback whose real job is a design the roster
  stopped flying; deleting it would have been a behaviour change.

### 8. Do not touch

The three arithmetic mismatches in the cleanup list's Open section
(`slash.missDistance`, `CLEAR_RANGE`, `CC_ACCEL`) — expressing any of them
moves behaviour. Anything else on that list marked **Decided**. And do not
reinstate legacy or migration handling; three rounds deleted it deliberately
and the cleanup list says why.

### 9. When done

Add a Progress entry here in the shape of the five above — what moved, the new
gate counts, what stayed behind and why, what you broke to prove it. Update the
cleanup list. **Do not tick the item.** Do not edit the survey; it is the
phase-1 record and it is allowed to be wrong in the ways later slices found.

### 10. The last slice, and only the last

Add the read-it-do-not-grep-it instruction to CLAUDE.md — the wording is below,
under "The CLAUDE.md instruction". It waits because pointing an agent at a
half-built home is worse than pointing it nowhere. Add `src/constants/` to
`docs/ARCHITECTURE.md` at the same time.

## Progress

**Slice 1 — weapons and ordnance — landed.** `src/constants/` exists, with the
shape decided: one file per subject, flat named `export const`s, per-constant
JSDoc, and the evidence moved WHOLE with the value. No re-exports and no
pointers back to an old home.

| moved | file |
| --- | --- |
| the player's laser — reach, pacing, cut-out, graze, aim assist | `constants/player-gun.ts` |
| the NPC's laser — reach, gate, cadence, hit curve, crossfire coin | `constants/npc-gun.ts` |
| the warhead, the launch gates, the E.C.M. and the bomb | `constants/ordnance.ts` |
| the commander's pool capacities and what one bank holds | `constants/pools.ts` |

40 constants home, 412 still out across 99 files.

Three relationships were asked for and two were expressed:

- **`NPC_LASER_RANGE` is now `LASER_RANGE`.** Its own comment always said it had
  to match; nothing enforced it.
- **`ECM_ENERGY_COST` is now `ENERGY_BANK_POINTS`**, a new single home for
  `MAX_ENERGY / ENERGY_BANKS` that `LOW_ENERGY` also derives from. `MAX_ENERGY`,
  `MAX_SHIELD`, `ENERGY_BANKS` and `LOW_ENERGY` came forward from `systems.ts`
  to make that possible; the rest of `systems.ts` waits for its own slice.
- **`NPC_HIT_FALLOFF` is UNRESOLVED and stays a literal.** It is a denominator
  rather than a reach — the floor binds first, at 2,625 — and the initial commit
  shows the expression was written when the NPC's own gate was 2,600, so it was
  not the NPC gun's range when it was chosen. Two readings survive and they want
  different expressions (`NPC_LASER_RANGE`, or `NPC_LASER_RANGE / 0.75`, which is
  a behaviour change). The argument is written out beside the constant.

**The gate is `test/constants.test.ts`**, in `npm test` and therefore in the
build. It scans `src/` for module-level `UPPER_CASE` declarations, reading the
LEFT of the `=` so that derived constants cannot hide from it the way they hid
from the census grep above. It holds THE LIST of everything still outside the
home, grouped by the slice that will take it, and fails on a stale entry as well
as an unlisted one. It also fails if `src/constants/` imports anything outside
itself, if a name is declared twice inside it, or if any file in `src/`
redeclares a name that lives there — which is the `MAX_TRADERS` check.

**Slice 2 — the fight — landed.** Eleven more files, and the count went from
40 home / 412 out across 99 files to **77 home / 375 out across 91**.

| moved | file |
| --- | --- |
| the three ranges the attack run turns on, and the run-out band | `constants/attack-run.ts` |
| the ramp every shipped brain was fitted at, and the 10 Hz clock | `constants/brain-flight.ts` |
| what a ram costs in speed, and the commander's hull radius | `constants/collision.ts` |
| the purchasable co-pilot's envelope | `constants/combat-computer.ts` |
| the run-out curve — its angle and how far past the target it starts | `constants/extend-arc.ts` |
| how far each predator looks for its prey | `constants/hunt-ranges.ts` |
| how far to the side of its target a ship aims a pass | `constants/pass-aim.ts` |
| the one range at which a hostile engages you | `constants/player-interest.ts` |
| keeping wingmen out of each other's way | `constants/separation.ts` |
| which tactics a hull may fly, and what makes it re-decide | `constants/tactic-choice.ts` |
| the four ways a hostile can fly the one attack run | `constants/tactics.ts` |

`src/game/tactics.ts` and `src/game/player-interest.ts` are **deleted**: both
were a table or a single constant plus its reasoning, with no logic left once
the values moved. Six comments in `npc.ts` that named them by filename now name
the real home.

The heavy evidence moved whole, which was the point of taking this group
second: `separation.ts`'s swept table, `break-off.ts`'s five-column band sweep
over 40 episodes, `pass-aim.ts`'s two measured tables, `extend-arc.ts`'s
`sec(psi)` cost table, `tactic-choice.ts`'s weights argument.

**`BRAIN_RATE_RAMP` carries a warning not to fuse it with `player.ts`'s
`RATE_RAMP`.** Both are 4.1396 and they are not one rule — they agree by
history, having been recalibrated together from a flat 4.0, and their decays
(5.2207 against 13.3886) are the evidence. One is a feel setting; the other is
what every shipped genome was fitted at. They are in different files so they can
move apart, and `player.ts` is a later slice.

**Three constants stayed behind on purpose.** `RAM_MIN_SPEED`, `CC_MAX_PITCH`
and `CC_MAX_ROLL` derive from `PLAYER_FLIGHT` and `TURN`, so they cannot live in
an import-nothing leaf until those come forward. Slice 1 predicted exactly this
tension and it is the one real cost of the leaf rule.

**Three literals were deliberately NOT tidied**, because each is a derivation
whose stated arithmetic no longer produces the shipped value, and expressing any
of them moves behaviour: `slash.missDistance` is 175 against a stated 1.6 × 110
= 176; `CLEAR_RANGE` is 340 against a stated 220 × 1.5 = 330; `CC_ACCEL` is 100
against the trader Cobra's real 220 × `ACCEL_FRACTION` = 101.2. All three are on
the survey's land-separately list.

The suite reads 3066 rather than 3067 because `tactics.ts` left
`test/ai.test.ts`'s purity list when the file stopped existing. That is not a
lost gate: the table is now under the constants gate's import-nothing rule,
which is stricter than the purity check it replaced.

**Slice 3 — the flight model — landed.** Two new files, four edited, and the
count went from 77 home / 375 out across 91 files to **83 home / 363 out across
89**.

| moved | file |
| --- | --- |
| the commander's envelope — speed, thrust, the two turn caps and the ramp | `constants/player-flight.ts` |
| the Harmless motion overlay every roster row shares — `TURN`, `ACCEL_FRACTION` | `constants/hull-motion.ts` |

`src/game/combat-computer.ts` and `src/game/tactic-choice.ts` now declare no
constants at all and came off the list; `src/player.ts` keeps only its two
`THREE.Vector3` axes and joined the mutable-vectors entry beside `npc.ts`'s
`ZERO`/`UP`. `src/game/ship-specs.ts` moved from "pending" to a named list: the
roster tables are DATA and stay, which docs/TODO/90 rules by name.

**The three constants slice 2 left behind are all expressions now**, in the same
file as the value each derives from. `RAM_MIN_SPEED` = `PLAYER_FLIGHT.maxSpeed *
0.7` is in `constants/tactic-choice.ts`; `CC_MAX_PITCH` and `CC_MAX_ROLL` =
`0.5 * TURN.pitch/roll` are in `constants/combat-computer.ts`. All three
evaluate to what they did — 280, 0.7 and 1.2.

**`PLAYER_FLIGHT` is now the only spelling of the commander's envelope.**
`player.ts` held six module-private literals AND an object assembled from them:
the flight model read the literals and everybody else read the object, so the
same six values were written down twice in one file. The literals are gone and
`PlayerShip.update` reads the object. This is what the item means by not
reintroducing a second spelling — the shape that already existed had one.

**`WORLD_SPEED_PER_SOURCE_SPEED` did not come.** Half of it is `PLAYER_FLIGHT`,
which is home; the other half is `playerHull(COBRA_MK_3_HULL_ID).maxSpeed`, and
reaching a released hull means `ship-identity.ts` → `catalogue.ts` → six
generated tables. The survey proposed relaxing the leaf rule for exactly this
("the catalogue is itself a leaf"), and that is not what the catalogue is: only
`combat-math.ts` imports nothing. Restating 42 would put a pack number in a
Harmless file, which `ship-specs.ts`'s own header forbids. It stays where both
halves are in scope, and it is on the cleanup list with the reason.

**The 4.1396 pair now names itself from both sides.** `brain-flight.ts` already
warned against fusing `BRAIN_RATE_RAMP` with the commander's; the mirror is
beside `PLAYER_FLIGHT.rateRamp`, each names the other, each says which one is
safe to retune, and both name `test/combat-model.test.ts` as the gate that pins
all four constants against the linear rule they were re-fitted from.

**One stale transcription found and gated.** `MAX_PITCH`'s comment argued the
commander's agility against four pirate hulls by writing out `turnRate ×
TURN.pitch` for each — and one of the four was an Asp Mk II at 1.68, a hull that
is no longer rostered as a pirate at all. Now that both anchors are in one
directory the products are re-derived in `test/combat-model.test.ts` from the
rows they name, and the four checks assert the CLAIM (you out-turn the heavy
hulls, the light ones still edge you) rather than the arithmetic. That is one of
the survey's six "reasoning that cites another file's value by transcribed
number", and it had already gone wrong.

**Slice 2 left `train/jameson-autopilot.js` broken and this slice fixed it.**
The console harness destructures `CC_MAX_SPEED` and `CC_ACCEL` out of
`/src/game/combat-computer.ts`, which stopped exporting them when they moved. A
module namespace object has no missing-property error, so both were `undefined`
and the harness was throttling the player to `Math.min(undefined, …)`. Nothing
went red because nothing runs it. Any slice that moves a constant out of a
module has to check the two browser-console harnesses by hand.

Byte-identical, verified by importing the old modules from a worktree at HEAD:
**373 compared, 0 changed** — the six envelope fields, both `TURN` axes,
`ACCEL_FRACTION`, `WORLD_SPEED_PER_SOURCE_SPEED`, the three unblocked
derivations, thrust and both turn caps for all 48 roster rows, and every name in
`src/constants/` at HEAD against every name in it now. The harness was broken
(`ACCEL_FRACTION` 0.46 → 0.461) and reported 48 changes before being restored.

**Slice 4 — the rest of the commander's pools, and the sun — landed.** Four
files touched in the home, three of them new, and the count went from 83 home /
363 out across 89 files to **98 home / 347 out across 89**. The file count does
not move: `systems.ts`, `npc-energy.ts` and `world-step.ts` all keep other
constants.

| moved | file |
| --- | --- |
| how the pools come back — the two fractions, the shield rate, the energy unit | `constants/recharge.ts` |
| the sun's ordered ladder, the cabin's lag and what you can scoop off it | `constants/sun.ts` |
| what a hull breach costs — the two chances and the fittings that can go | `constants/hull-breach.ts` |
| `LASER_COOL_RATE`, joining the cut-out and the pacing it argues with | `constants/player-gun.ts` |

**The recharge is its own file, not part of `pools.ts`, and the split is by
provenance.** A capacity is the released game's — 255 is a byte and every hull's
comes out of the pack — while a refill rate is not in the pack at all: the
source gives a `energyRechargeRating` and no clock. One file is numbers somebody
could re-import; the other is Harmless policy nobody can look up.

**`SUN_KILL_DIST` came out of `world-step.ts` to join them.** The four sun
distances are one ordered ladder — heat starts, scooping, the cabin's fatal
band, the sun itself — and they were four literals in two files with nothing
holding the order. `game.ts` still carried a comment describing that ordering
for constants that had already left it, which is a comment that cannot fail.
`test/systems.test.ts` now walks in from deep space through the real `scoopFuel`
and `updateCabinTemp` and asserts what each rung BUYS; each of the three
interior rungs was moved and confirmed red.

**Two inline magic numbers got names**: `CABIN_TEMP_LAG` (the `dt * 1.2` in
`updateCabinTemp`) and `CABIN_TEMP_FATAL` (`0.99`). `ShipSystems.cabinTemp`'s
doc said "1.0 is fatal" and had done for as long as the code said 0.99 — the
prose is fixed and the reason 1.0 is unreachable (an exponential lag never
arrives) is written beside the constant. `laserTemp`'s doc restated `0.98`; it
names `LASER_CUTOUT` now.

**`ANCHOR_RECHARGE_RATING` did not come**, exactly as slice 3 predicted. It is
`playerHull(COBRA_MK_3_HULL_ID).energyRechargeRating`, so it reaches the Elite-A
catalogue through `ship-identity.ts` and six generated tables. It is on the
cleanup list beside `WORLD_SPEED_PER_SOURCE_SPEED` with the same reasoning, and
`game/systems.ts` is now a NAMED entry on the gate's list rather than a whole
file: that one constant is all it has left.

**AND THE LEGACY CONSTANTS WERE DELETED RATHER THAN NAMESPACED.** This item's
survey said `LEGACY_MAX_ENERGY = 4` and `ENERGY_BANKS = 4` were "the trap:
historically the same fact, now permanently different, because a save on disk
depends on one", and asked for a `MIGRATION` namespace to keep them apart. Chris,
2026-08-04: *"We don't have any data to migrate yet — anything legacy can be
removed and any migration is not needed. We will only need migrations once we
start to release official versions."* No save on disk depends on it, because
nobody outside this project has ever played. So the trap is resolved by
subtraction: `LEGACY_MAX_ENERGY`, `LEGACY_MAX_SHIELD`,
`LEGACY_ASTEROID_HULL_POINTS`, the roster's `legacyHullPoints` column,
`migratedSystems` and `migratedNpcState` are gone, and the six names are on
`test/damage-paths.test.ts`'s "cannot come back" list beside the TODO 26/27
bridges. The precedent is docs/TODO/53, which deleted `migrateLegacySaves` on
the same reasoning.

That forced the one real decision of the slice. `ENERGY_REGEN_FRACTION` was
`0.1 / LEGACY_MAX_ENERGY` and `SHIELD_REGEN_FRACTION` was
`0.035 / LEGACY_MAX_SHIELD` — live constants over migration divisors. **They are
literals now, 0.025 and 0.035, with the arithmetic written out beside them**,
and that is the deliberate answer rather than the lazy one: a fraction of a pool
per second is what they ARE on any scale, and expressing one over a constant
that exists only to be a divisor for a scale nothing uses would have left a
reader looking up `LEGACY_MAX_ENERGY` to discover it meant 4. `0.1 / 4 === 0.025`
to the bit, so nothing moved. The two derivations that ARE real stayed
derivations: `SHIELD_REGEN = MAX_SHIELD * SHIELD_REGEN_FRACTION`, and
`ANCHOR_RECHARGE_RATING` off the catalogue.

The claim those two fractions make — a 40-second bank and a 28.6-second shield
face, unchanged since before the pools grew — is timed through the real
`regenerate` in `test/systems.test.ts`. **Its tolerance was 0.2s and did not
gate**: moving `ENERGY_REGEN_FRACTION` by 0.4% left it passing. It is 0.1s now,
which is the tick quantisation and nothing else, and both fractions were moved
by 0.4% and confirmed red.

Byte-identical, verified against a worktree at HEAD: **2679 compared, 0
changed** — every name in `src/constants/` then against now, the fifteen that
left `systems.ts`, `SUN_KILL_DIST`, both newly-named inline literals,
`energyRegenPerSecond` for all 15 hulls at both fits, `regenerate` from all 256
bank values, `updateCabinTemp` and `scoopFuel` swept over 261 distances,
`applyDamage` and the three pool readings over 87 damages, `breachLoss` over 400
seeded trials, and all 49 roster rows minus the deleted column. 104 of those
comparisons are the deletion's own proof: for every save that can actually
exist, HEAD's `migratedSystems` and `migratedNpcState` are the identity, so
removing them removes no behaviour. The harness was broken
(`ENERGY_REGEN_FRACTION` 0.025 → 0.0251) and reported 284 changes before being
restored.

**The suite reads 3066 rather than 3070, and all eleven lost assertions were
migration.** Four in `test/systems.test.ts` (`migratedSystems` as an identity, a
1/1/4 save keeping its fractions, its carries starting clean, an empty save
coming back whole), five in `test/snapshot.test.ts` (the pre-energy conversion's
purity, its pass-through, a quarter-hull, no stray `hp`, a sliver not rounding
to death) and two in `test/world-step.test.ts` (a pre-255 world through the real
`Persistence.restore`). Seven new ones replace them: six for the sun's ladder,
and one in `test/snapshot.test.ts` that is better than the check it stands in
for — restoring a fleet DOES draw, because rebuilding a ship rolls a tumble
axis, a pack offset, an E.C.M. coin and an opening tactic, so the property worth
pinning is that the fleet which comes back is the same fleet from anywhere in
the stream. `world.ts`'s own comment claimed "no draw from the rng" and was
wrong about that.

**Slice 5 — the world clock and the jump — landed.** Five new files, and the
count went from 98 home / 347 out across 89 files to **115 home / 341 out across
87**. Two whole entries left the gate's list — `game/hyperspace.ts` and
`galaxy/navigation.ts` have no constants at all now — and two files dropped from
"everything in it" to a named pair of three.js vectors: `game/world-step.ts` and
`game/game.ts` are on the mutable-vectors entry with `npc.ts` and `player.ts`.

| moved | file |
| --- | --- |
| the slice the world advances in, and the frame loop's clamp on catching up | `constants/world-clock.ts` |
| the torus drive's multiplier and the three radii that cut it out | `constants/torus.ts` |
| the countdown, the fare in days, the escape and the two mis-jump chances | `constants/jump.ts` |
| where a jump leaves you, and where the ground is | `constants/planet.ts` |
| the two numbers the 1984 chart distance is made of | `constants/chart-metric.ts` |

**The torus multiplier had five homes and two spellings, and expressing it cost
nothing.** `world-step.ts` added `speed * 7 * dt` ON TOP of the `speed * dt`
`player.update()` had already applied; `game.ts` sized the dust streaks at
`speed * 8`; the manual captioned the key "8×"; the briefing said "eight times
speed"; and `world/starfield.ts` justified both its fade thresholds in prose
with "8 x 400 = 3200". They agreed only because 7 + 1 = 8 and nothing anywhere
said so. `TORUS_MULTIPLIER` is the TOTAL — which is what all five mean — the
step adds `TORUS_MULTIPLIER - 1` with the reason beside it, and `8 - 1 === 7`
exactly. The dust, the caption and the starfield's two thresholds are all
derived from it now; the starfield's are `PLAYER_FLIGHT.maxSpeed * 1.3` and
`maxSpeed * TORUS_MULTIPLIER * 0.75`, which are 520 and 2400 to the bit.
Breaking the constant to 9 moves all five together and the equivalence harness
reports exactly that.

**The three inline mass-lock radii are one rule with three answers.** 5,000 at
the station, 4,000 of ALTITUDE over the planet and 4,500 to any live ship that
is not a rock, all three unnamed inside `massLocked()`. They are in `torus.ts`
rather than in a file of their own because the cut-out is the drive's price and
nobody can act on one without the other.

**Three relationships were asked for and all three are expressions now.**
`audio.ts`'s countdown pitch is `700 + (COUNTDOWN - n) * 100`, so the first blip
of a jump is 700 Hz whatever the warning is; the world step's stranded hint and
`game.ts`'s rescue floor both read `WITCHSPACE_ESCAPE_COST`, so "enough fuel to
jump clear" is one number in three places; and `galaxy/living.ts`'s two
re-inlined copies of `navigation.ts`'s rules are gone — its private
`chartDistance()` was byte-identical to `distanceTenths` down to the doc
sentence, and its `1 + ceil(d/20)` was `daysForJump`.

**The gate that should have caught that fourth home read four hand-picked
files.** `test/galaxy.test.ts`'s "only navigation.ts implements the distance
metric" scanned `screens.ts`, `contracts.ts`, `game.ts` and `campaign.ts` — the
places it had gone wrong before — and `living.ts` was not among them. It walks
all 165 files in `src/` now, in both the old spelling and one written with the
new constants, and putting the copy back fails two checks.

**`VIEW_QUATS` stays, and it is a table rather than a constant.** Four
`THREE.Quaternion`s are objects and this directory may not import three, so the
only part of it that could move is the four yaw angles — which would split one
table across two files to buy nothing, since the angles have no second home and
are the definition of what "rear" and "left" mean rather than a tuning choice.
Recording that decision turned up that **nothing tested it**: swapping left for
right passed the whole suite. `test/world-step.test.ts` now holds all four
against the nose.

**The measured-threshold shape, because probing at the constant is `f(x) ===
f(x)`.** The first version of the mass-lock gate asked whether
`MASS_LOCK_STATION - 1` locks and `MASS_LOCK_STATION + 1` does not, and moving
the constant moved the probe with it: all three rungs stayed green at 4,510.
Each threshold is bisected out of the real function now and compared to the
constant that is supposed to say it — the station, the planet altitude, the ship,
the ground, and the tank the beacon is offered below — so re-inlining a literal
anywhere costs a red line. All five were confirmed red that way.

**Two more of the survey's six transcribed-number comments are references now**,
leaving three (`save-file.ts`, `docking.ts`, `jettison.ts`). `input.ts`'s
`CARRY_LIMIT` said "MAX_STEPS_PER_FRAME is 5" from a file that could not see it;
`combat-sim-opening.ts`'s `ARENA_RADII` wrote out the mass lock's 4,000, the
ground's 80 and the station's 5,000, and said it could not import the witchpoint
because game.ts needs a browser — a reason that expired when the witchpoint
moved here. `test/arena.test.ts` holds its margins against the constants
themselves, and both products are exactly the 20,000 it asserted before.
`ARENA_RADII` itself stays a literal: it is a separate rule at the same number,
and moving where hyperspace drops the player should not move where an exercise
is fought.

Byte-identical, verified against a worktree at HEAD: **11,910 compared, 0
changed** — every name in `src/constants/` then against now, the six constants
that moved, the twelve inline numbers that got names read out of HEAD's source,
all four navigation functions over three whole galaxies, `daysForJump` over 400
distances, 400 seeded days of the living galaxy plus all 256 neighbour lists,
`jumpCost`/`checkJump`/`resolveJump` over 256 targets at five tanks and two
mission stages, six 900-step seeded worlds with their per-frame mass-lock trace,
a swept walk across all three mass-lock radii and the ground, a 600-step torus
cruise, and the stranded hint at seven fuel levels. Breaking each moved constant
in turn reported 21, 2, 2,727, 2 and 3,073 changes before being restored.

One deliberate change that is NOT byte-identical, and it is prose: the briefing's
"the torus drive — eight times speed" is `${TORUS_MULTIPLIER} times speed`, so
the page now reads "8 times speed". The manual's caption interpolates to the
same bytes it had.

**Still to do**, in the groups the gate's list already names: spawning and
population, the career, the galaxy, the station, the
console, the combat trainer, saves, and the policy seam. Plus two things no slice
has touched: `MAX_TRADERS` still has two homes, and CLAUDE.md does not yet carry
the read-it-do-not-grep-it instruction below — the gate catches a second home
mechanically, but the instruction is what stops one being written.

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
