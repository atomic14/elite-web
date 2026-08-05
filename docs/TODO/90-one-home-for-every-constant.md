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

**Slice 6 — who is out there, and where the sky puts them — landed.** Five new
files, and the count went from 115 home / 341 out across 87 files to **175 home /
317 out across 83**. A WHOLE GROUP CLOSED: `game/spawning.ts`,
`game/population.ts`, `game/encounters.ts` and `game/world.ts` declare no
constants at all now and came off the gate's list; the two files left in that
group are named STAYS entries with their reasons.

| moved | file |
| --- | --- |
| how busy a system is when you arrive — the counts and the chances | `constants/population.ts` |
| what turns up while you fly, and how long you wait for it | `constants/encounters.ts` |
| where the sky puts a ship when it appears | `constants/spawn-placement.ts` |
| where an authored exercise starts its opposition | `constants/opposition-ring.ts` |
| mis-jump limbo: where the scenery goes, and what is waiting | `constants/witchspace.ts` |

**`MAX_TRADERS` HAS ONE HOME.** The constant this item is named after was `= 4`
in `game/population.ts` and `= 4` in `game/encounters.ts`, one capping the
arrival plan and the other the drip of later arrivals, agreeing by luck. It is
`constants/population.ts`'s — a property of what a system HOLDS rather than of
the clock that adds to it, which is the survey's answer — and both halves import
it. The gate's `MAX_TRADERS` check would now fail a third home; the new test in
`test/world.test.ts` fails a re-inlined literal in either of the two, bisected
out of `planPopulation` and `stepEncounters` separately and both confirmed red.

**Thirty-six inline literals got names**, which is why the home grew by 60 while
the outstanding count only fell by 24: the gate reads column-zero declarations
and every one of these was a number in the middle of a function. The three
clocks in `encounters.ts` (the trader lane, the pirate wave, the Thargon
redeploy), the whole of the witch-space ambush in `game.ts`, the pirate wave's
warp-in and the drone's deploy offset in `world-step.ts`, and the station's
Viper stack in `spawning.ts`.

**Two of those were one rule written twice inside one file.** `freshTimers` set
the first pirate wave to 60 and the reset computed `60 + government * 40`; it
set the first Thargon wait to 5 and the redeploy set 5. Both pairs are one
constant now, and the tests break if either half is re-inlined.

**The thargon timer is 5 in `encounters.ts` and 4 in `game.ts`, and that is
recorded rather than resolved.** The survey found it; this slice named both
(`THARGON_REDEPLOY`, `THARGON_AMBUSH_DELAY`), put them next to each other with
the two readings written out, and left the value alone. Choosing costs a second
of the opening of every mis-jump, so it is Chris's decision and it is on the
cleanup list's Open section.

**A gate this whole item depends on had a hole, found by breaking it.** The
leaf check scanned for `from '...'`, so a SIDE-EFFECT import — `import 'x';` —
went straight through: adding one to `constants/jump.ts` left the check green.
That is the most dangerous shape of the two, because it pulls a module's
top-level work into the leaf while leaving no binding in the file for a reader
to notice. It matches both patterns now, and an internal `import './planet.ts'`
still passes.

**`spawnPopulation` had no test at all** — every distance was a literal in one
file, so a transposed pair would have moved traders into the slot with nothing
going red. `test/spawning.test.ts` is new: it flies the real spawner over 40
seeded worlds and holds each role's measured band against the constant it was
spawned from, the reception against the corridor as a FRACTION of the route, and
the station's Viper stack against all five of its numbers. Swapping
`TRADER_SCATTER` for `POLICE_SCATTER` fails two checks. (That transposition
happened for real mid-slice, when a restore replaced the wrong occurrence — the
recipe's trap 1 in a new costume — and the new test is what caught it.)

**Two measured findings that were nobody's intent.** `TRADER_GAP_BUSY_MAX = 50`
is unreachable: over all 2,048 systems of the eight galaxies, productivity runs
768 to 56,320, so the richest system buys 46.9 seconds of a possible 50. It is a
guard against a re-scaled productivity rather than a live rung, it says so
beside itself, and a test asks the whole galaxy. And the station's Viper stack
does not do what its comment claimed: the jitter is 80 in an independent
direction against a spacing of 120, so a pair can land anywhere from 0 to 280
apart — 1.16% of pairs intersect in a million-pair simulation, and the closest of
400 real seeded launches was 27 units against a hull radius of 18.75. Naming it
was free; changing it moves every station-launched Viper in the game, so it is
on the cleanup list.

**`ship-roles.ts` and `role-variants.ts` keep everything, and the gate now says
why per name.** `BAND_SLOTS` is the released sets' own slot numbering and is
deliberately PRIVATE — the file argues that nothing outside it should hold a
copy of "17 to 24 means pirate" — while `ROLE_BANDS`, `CANDIDATES`,
`MISSION_TARGET_DESIGNS` and `COMBAT_ROLES` are all keyed on `NpcRole`, a type
this directory may not import, and two of them are catalogue lookups computed
once at load rather than rules.

Byte-identical, verified against a worktree at HEAD: **1,697 compared, 0
changed** — every name in `src/constants/` then against now, the twelve declared
constants that moved, all thirty-six newly-named inline literals read out of
HEAD's SOURCE, `planPopulation` and `policeFor` over every government at nine
convoy counts and eight rng phases, an hour of `stepEncounters` at ten seconds a
tick in every government at three productivities with and without a mothership,
and the real spawner over 24 seeded worlds — the whole sky as text, plus the
arena ring with and without a facing, the station's Vipers, an arriving trader
and the banished scenery. Nine constants were broken in turn and reported 25,
122, 50, 25, 514, 15, 65, 1 and 577 changes before being restored.

**The witch-space ambush's four constants are the one weak spot in that proof.**
They are only reachable through `Game`, which needs a browser, so the harness
compares them against HEAD's source text and nothing else — which is why
breaking `THARGOID_AMBUSH_RANGE` moved 1 comparison rather than hundreds. No
unit test covers them either.

**Slice 7 — what is left of the fight — landed.** Four files touched in the
home, three of them new, and the count went from 175 home / 317 out across 83
files to **187 home / 307 out across 82**. The whole fight group left the
pending list: `game/impact-damage.ts` declares no constants at all and came off
entirely, and the other five files are named entries now, each with its reason.

| moved | file |
| --- | --- |
| every non-laser cost — the ram, the canister, the scrape, the warhead, the bomb | `constants/impact.ts` |
| who is worth robbing — the prize saturation, the challenge rate, the score weights, the tier thresholds, the one curated hull | `constants/threat.ts` |
| what destruction leaves behind — the escape-pod chances, and a mined rock's yield | `constants/wreck.ts` |
| the one lie a brain is told — the target-speed floor | `constants/brain-flight.ts` |

**`IMPACT` moved whole and its spend side did not.** The table with its anchors
argument is `constants/impact.ts`; `game/impact-damage.ts` keeps only the two
functions that turn a row into a branded number, still importing exactly
`damage-units.ts` — so `test/damage-paths.test.ts`'s imports-only check still
holds, and two new checks hold the table's home to importing nothing and to
seeing no ship, profile or role. Fifteen import sites split across src, test
and train, and docs/DAMAGE-PATHS.md's rows cite the new home.

**The survey's strongest finding is now written beside its constant.**
`PRIZE_SATURATION` is 25,000 tenths — 2,500 Cr — and its own comment said
"1,600 Cr" for its whole life, with a sweep quoted against the 1,600 reading.
The value stays (it is what the campaign's 33 rows are tuned against), both
readings are written out beside it, and choosing is on the cleanup list's Open
section. Which is right is a balance decision with a measurement attached.

**`TARGET_SPEED_FLOOR`'s trainer divergence is recorded beside it too** — the
game floors what a brain is told and `ai-training/scenario.ts` hands its
pirates the raw speed, so a training pirate reads observation slot 10 in a
range the live game never produces. The survey called it the biggest divergence
of its partition; it is a decision (apply the floor in training, or delete the
input and retrain), so the constant moved with the finding attached and the
decision went to the cleanup list.

**`FAME_FULL` stayed behind on purpose, and the relationship it restates is a
check now.** 2560 is the rating ladder's own Dangerous rung; the ladder is the
career slice's, so an expression cannot be written yet. `test/economy.test.ts`
bisects the fame saturation score out of the real `pirateThreat` and asserts
the real `rating()` starts saying Dangerous at exactly that score — the
relationship the survey said was "said in prose, enforced by nothing".

**Every moved tuning number is gated in the measured shape**, because the
campaign pins them only in aggregate: the prize saturation and the challenge
roll are bisected out of `pirateThreat`, the two tier thresholds out of a new
two-line `tierForScore` (extracted so the ladder is probeable at all), the two
score weights solved back out of `sourceThreatScore` as a linear system over
the real roster with zero residual required, the escape-pod rate per role and
the mining yield band flown through the real `wreck`/`destroy` over seeded
kills (the yield's floor and ceiling must both actually occur), and the
target-speed floor was already pinned by value in `test/brain-names.test.ts`.
The escape rate was read at two sizes — 0.425/0.2025 at 400 kills,
0.45975/0.1985 at 4,000 — same answer both times.

**`brain-names.ts` stays whole, per name, and that is the right outcome, not a
dodge.** It is the import-nothing leaf this item's own "Watch out for" section
names as the model, and CLAUDE.md points at it as where the scripted/trained
rule lives. Its thirteen constants are that rule's decisions stated as names,
tables keyed on `BrainName` (a type declared beside them that the home may not
import), two picker sentinels and the frozen empty default. `brains.ts`'s
three parsed weights files and `LOADED` are the `MISSILE_HULL` shape.
`npc-energy.ts`'s four are design ids, a catalogue read
(`ANCHOR_NPC_MAX_ENERGY`, exactly `ANCHOR_RECHARGE_RATING`'s case) and a
policy table keyed on imported overlay ids. `combat.ts` keeps the two
commodity-index lists for the career slice's ordinary-goods unification, and
`BEAM_FLASH`, which is a drawing duration.

**One survey doubt settled by measurement**: `HARMLESS_POLICY`'s rock-hermit
bank says "240 is what a Coriolis carries" and the survey suspected it was the
Dodo's figure. Measured from the catalogue: both released stations carry 240,
so the prose is true and nothing moved.

**Two orphaned doc comments healed.** `threat.ts` carried `MAX_CONTRACTS`'
whole justification while the constant sat bare in contracts.ts — the doc is
beside its constant now — and a stray contraband sentence documenting no
declaration at all (law.ts's `CONTRABAND` has its own) was deleted.

**And a new gate had the old hole, found by breaking it.** The first spelling
of "the table's home imports nothing" scanned for `from '...'`, so a
side-effect `import '../game/rng.ts';` sailed past it — the exact shape slice
6 found in the constants gate's leaf check. Only the constants gate went red
(1 failure). The check matches both shapes now and was confirmed red against
the same break before restoring.

Byte-identical, verified against a worktree at HEAD: **2,693 compared, 0
changed** — every name in `src/constants/` then against now, every `IMPACT`
row and both spend functions per legal row, `markOf` over 360 synthetic
commanders, `pirateThreat` over 7 systems x 3 dangers x 9 marks x 10 rng
phases, `memberTier` over its grid, `sourceThreatScore` and `hullThreatTier`
for all 49 rostered builds, `pirateBrainFor`'s guard and its floored
target-speed curve under both A/B selections, a 200-kill seeded
`wreck`/`destroy` trace through the real World (120 ships plus 80 mined
rocks), and the stayed-behind names read out of HEAD's source. The harness was
broken (`PRIZE_SATURATION` 25000 → 25100) and reported 211 changes before
being restored.

The four gates: `npm run build` passes (the two grown test files carry stated
reasons in `tools/sizes.mjs`); `npm run campaign` byte-identical on all 33
balance rows (only the runtime stamp differs); `npm run elite-a` 490 passed, 0
failed — up from 483 by exactly the seven new assertions that run in that
suite; `npm run portability` 0 contaminated. The full suite reads 3131 from
3117, all fourteen new. Both console harnesses were grepped for every one of
the thirty-one names this slice moved, created or left behind, plus the
functions whose files changed: clean.

Fourteen breaks, all confirmed red and restored: the gate's stray
`SOME_RULE` (1 failure), the side-effect import into the home (1, and the new
damage-paths check red against it after its own hole was closed), re-inlined
literals for the prize saturation (1), the challenge rate (2), both tier
thresholds (1 each), both score weights (2 each), the escape chance (1) and
the mining yield (1), a diverged `FAME_FULL` at 2561 (1), the curated
Sidewinder un-curated (3), the target-speed floor at 151 (1), and
`IMPACT.ram.ship` at 45 (1).

**Slice 8 — the career — landed.** Thirteen new files in the home plus
`FAME_FULL` landing in `constants/threat.ts` (and three headers that pointed
at the career updated in place), and the count went from 187 home / 307 out
across 82 files to **239 home / 261 out across 73**. The whole career group left the
pending list: `game/commander.ts`, `game/contracts.ts`, `game/law.ts`,
`game/jettison.ts`, `game/missions.ts`, `game/rating.ts`, `game/shop.ts` and
`game/trumbles.ts` declare no constants at all and came off entirely,
`galaxy/living.ts` and `game/cargo.ts` are named entries with their reasons,
and `game/threat.ts`'s `FAME_FULL` entry is gone — the debt slice 7 left.

| moved | file |
| --- | --- |
| the commander's ship — the name, the grubstake, the tank, the rails, both holds | `constants/commander.ts` |
| the law — contraband, the two fines, the defence range, the scan range | `constants/law.ts` |
| the bulletin board — how much work you may hold, how far it may send you | `constants/contracts.ts` |
| the market's fluctuation byte | `constants/market.ts` |
| the rock hermit's counter-market | `constants/hermit-market.ts` |
| buying your way out — the shares, the floors, and what a tonne is worth | `constants/jettison.ts` |
| the Navy mission — the kill gate, both legs, both payments | `constants/missions.ts` |
| the combat ladder | `constants/rating.ts` |
| what things cost — fuel, the catalogue, and the two laser prices the trade-in reads | `constants/shop.ts` |
| the trumbles — the broods, the appetite, the cure | `constants/trumbles.ts` |
| how fast the living galaxy forgets — the three decays | `constants/living-galaxy.ts` |
| the commodity classes — ordinary goods, what a wreck spills, what a rock yields | `constants/commodities.ts` |
| the cargo scoop's reach | `constants/scoop.ts` |
| `FAME_FULL`, now an expression | `constants/threat.ts` |

**`FAME_FULL` IS AN EXPRESSION AND THE BLOCKED ENTRY IS CLOSED.** The ladder
is `constants/rating.ts` now, so the fame saturation is
`RATINGS.find(Dangerous)[0]` in `constants/threat.ts` — the restatement slice
7 could not express because neither file had a home the other could read.
`test/economy.test.ts`'s bisect stays, because it is what goes red if either
CONSUMER re-inlines a literal, and both directions were broken to prove it:
a diverged `FAME_FULL = 2561` (1 failure) and a drifted `rating()` boundary
(2 failures).

**The ordinary-goods decision, by meaning, written down.** The survey's three
homes are TWO rules: a contract's consignment and a generation ship's shed
cargo are the same six rows and both read `ORDINARY_GOODS` now; a wreck's
spill is that class PLUS FURS, and whether the seventh row is a flourish or a
drift is recorded in `constants/commodities.ts` rather than resolved —
collapsing them moves what every wreck drops, so it is on the cleanup list's
Open section. `test/combat.test.ts` pins the relationship exactly (Furs found
by NAME, so the check cannot hold a stale index), flies 60 seeded wrecks and
200 mined rocks through the real `wreck`/`destroy` for membership, and
`test/contracts.test.ts` sweeps the real offer generator at two sizes: 2,301
and 11,595 offers, zero strays both times.

**The four-home cargo capacity is one rule.** `cargoCapacity()` owned it;
`markOf` restated both figures, `pirateThreat` wrote the 20 out again as its
big-bay threshold, and the shop's shelf label typed the 35 into a string. All
four read `HOLD_TONNES`/`LARGE_BAY_TONNES` now — the label interpolates, the
threshold is scanned out of the real `pirateThreat` (the step is at exactly
`HOLD_TONNES + 1`, found by scan rather than probed at the constant), and the
scanner's figure is compared to the real `cargoCapacity` in both bay states.

**The survey's `VALUE_PER_TONNE` pair is expressed, which resolves the
`jettison.ts` transcribed-number comment.** `markOf` wrote `* 4` as a bare
literal while jettison.ts's constant said in prose they had to agree; markOf
imports it now, and the checks are the cross-rule kind: the multiplier solved
back out of the real `markOf`, and a dumped tonne's toll value compared to
what the scanner said that tonne was worth. Two of the six transcribed
comments remain (`save-file.ts`, `docking.ts`), both other slices' files.

**`CONTRACT_RANGE` is the diverged 68, named and recorded rather than
resolved.** Every other reading of "reachable on a full tank" is `MAX_FUEL` =
70 — the living galaxy's convoy range said "ships have a 7 LY jump range" over
a bare 70 and reads MAX_FUEL now — while the bulletin board filters at 68 and
nothing says whether that is a margin or a transcription. The value stays,
both readings are beside it, choosing is on the cleanup Open list, and the
new sweep pins the bound from BOTH sides: the furthest offer must equal the
furthest system the bound admits (68 exactly, in galaxy 1) and the galaxy
holds 86 pairs in (68, 70] that must never be offered. Re-inlines at 70 and
at 66 were both confirmed red.

**Three decays measured out of one quiet day.** The living galaxy's
`PRESSURE_DECAY`, `HEAT_DECAY` and `DANGER_DECAY` moved with their reasoning;
`test/galaxy.test.ts` runs one pure-decay day of the real `advance` (an rng
pinned high launches no convoys) and solves each rate back out, government
scaling included. `COMMODITY_COUNT` stopped being a transcribed 17 and is
`COMMODITIES.length` — a derivation the home cannot hold (the table is DATA),
so it is the fourth entry of the `ANCHOR_RECHARGE_RATING` shape on the
cleanup's Blocked list and a named entry on the gate.

**One file held one rule in two homes, and the survey had not seen it.**
`commander.ts` exported `DEFAULT_NAME = 'JAMESON'` and `newCommander` wrote
`name: 'JAMESON'` as its own literal ten lines down. The literal reads the
constant now, and `STARTING_CREDITS` was named on the way past so the
briefing's "100 credits" and "7 light years on a full tank" — two prose
figures the item's scope section rules IN — are interpolations that render
the same bytes.

**The trade-in refunds are catalogue prices now, with one judged fusion.**
`trade.ts` refunded 4000 and 10000, copies of prices the catalogue owns. The
beam's is `BEAM_LASER_PRICE`; the pulse's 4000 is `PULSE_LASER_PRICE`, which
the three side-mount rows also charge — judged ONE rule (the pulse laser's
price, wherever mounted) against test/trade.test.ts's older reading that the
refund was its own only home, and the argument is written beside the
constant. The Large Cargo Bay's 4000 is the same number and NOT that rule; it
stays a literal in its row with the coincidence noted.

**Two renames, both to keep subjects apart in a flat namespace**: missions'
`HUNT_RANGE`/`COURIER_RANGE` are `MISSION_HUNT_RANGE`/`MISSION_COURIER_RANGE`
— "hunt range" already means how far a predator looks (`hunt-ranges.ts`), in
different units. And one deletion: law.ts's derived `CONTRABAND_SET` is gone,
`isContraband` runs `includes` over the three-row list instead of keeping a
second structure a gate entry would have had to explain.

**What stayed, per name.** `game/cargo.ts` keeps `CANISTER_HULL` and `POLICY`
(catalogue reads, the `MISSILE_HULL` shape) and `SPIN_RATE` — a canister's
tumble is how it LOOKS, nothing reads orientation back, the `BEAM_FLASH`
reading. `game/combat.ts` keeps only `BEAM_FLASH`. `freshSession`'s trumble
clock and `stepTrumbles`' reset are one `BREED_INTERVAL` now (the survey's
pair; the neighbouring `autoSaveTimer` was already the pattern), pinned in
`test/state.test.ts`.

Byte-identical, verified against a worktree at HEAD: **31,440 compared, 0
changed** — every name in `src/constants/` then against now, all 32 moved
exported names old-module-against-home, 28 private or renamed values read out
of HEAD's source, 400 seeded days of the living galaxy (full state, every
headline, price multipliers, and the notoriety spread from all 256 systems,
which is the neighbour lists as behaviour), 1,280 seeded offer batches, the
settlement and acceptance grids, the whole law over grids, 60 seeded dumps
plus the appetite and bribe grids, the mission machine at every stage times
kills times rng, `rating()` over all 26,001 scores, the fuel sweep and
ownership grid, `markOf`/`pirateThreat` over 8 holds x 2 bays x 3 scores x 10
phases, `tierForScore` over 0..300, the trumble grid (288 cells), fresh
careers and sessions, `marketEstimate` for 7 systems both pressured and flat,
`hermitMarket` over all 256 fluctuations at 3 systems, the scoop boundary
scanned in both trees, and a seeded 140-kill wreck-and-mine trace through the
real World. The harness was broken (`PRESSURE_DECAY` 0.12 → 0.121) and
reported 532 changes before being restored.

The four gates: `npm run build` passes (`test/galaxy.test.ts` crossed 400 and
carries its stated reason and the split it is waiting for in
`tools/sizes.mjs`); `npm run campaign` byte-identical on all 33 balance rows
(only the runtime stamp differs, diffed against the worktree's own run);
`npm run elite-a` 490 passed, 0 failed; `npm run portability` 0 contaminated.
The full suite reads 3155 from 3131, all twenty-four new. Both console
harnesses were grepped for every one of the fifty-odd names this slice moved,
created, renamed or left behind: clean — their only hits are two comments,
and playtest.js's stale "law.ts CONTRABAND" line now names where the
definition lives.

Twenty-five breaks, all confirmed red and restored with targeted edits: the
gate's stray `SOME_RULE` (1 failure) and a side-effect import into the home
(1); a diverged markOf multiplier (3 + 1 across two files), the big-bay
threshold at 26 (1), a re-inlined hold of 21 (2), `FAME_FULL` at 2561 (1), a
drifted `rating()` boundary (2), the contract range at 70 (1) and at 66 (1),
a drifted consignment list (1), `WRECK_CARGO` without Furs (1), a re-inlined
spill list with narcotics (1), the scoop reach at 46 (2), the trumble clock
at 21 (1), a re-inlined pressure decay (1), the convoy range at 60 (1), a
hand-typed bay label (1), a drifted pulse refund (1), `marketEstimate` at 255
fluctuations (2), a drifted `newCommander` name (1), a re-inlined hermit ore
price (4), the kill threshold at 15 (1), a re-inlined offender fine (1), a
re-inlined opportunist floor (1), and a re-inlined breed clock (2).

**Still to do**, in the groups the gate's list already names: the galaxy, the
station, the console, the combat trainer, saves, and the policy seam. Plus
one thing no slice has touched: CLAUDE.md does not yet carry the
read-it-do-not-grep-it instruction below — the gate catches a second home
mechanically, but the instruction is what stops one being written.

**Slice 9 — the galaxy, and the encyclopaedia's own geometry over it —
landed.** Two files touched in the home, one of them new, and the count went
from 239 home / 261 out across 73 files to **243 home / 257 out across 72**.
The whole group left the pending list: `galaxy/galaxy.ts`, `galaxy/goatsoup.ts`
and `galaxy/descriptions.ts` are named STAYS entries now, `encyclopaedia/filters.ts`
declares no constants at all and came off the list entirely, and
`encyclopaedia/chart.ts`/`encyclopaedia/main.ts` are named STAYS entries with
one name apiece.

| moved | file |
| --- | --- |
| the chart projection's width, and the height derived from the halving `chart-metric.ts` already named | `constants/chart-metric.ts` |
| the tech level scale the encyclopaedia's filter is bounded by | `constants/tech-level.ts` |

**This slice's honest outcome is mostly STAYS, exactly as the item's own
caution predicted.** Fourteen of the eighteen declared names in the group are
the 1984 generator's own data or a presentation exemption the item already
ruled out by name:

- `galaxy/galaxy.ts` (nine names) and `galaxy/goatsoup.ts` (two) — the three
  seed words and the twist, the digraph and species-name tables, the
  goat-soup grammar's option lists, and the market model's per-commodity base
  prices, gradients, quantities and masks. All of it is transcribed from the
  1984 algorithm rather than chosen by Harmless, which is exactly what
  docs/TODO/90 names by example — "the market model's per-commodity base
  prices and gradients... TRANSCRIBED FROM A SOURCE". `ECONOMY_NAMES` and
  `GOVERNMENT_NAMES` are the same case: the original's own category names,
  not a Harmless wording.
- `galaxy/descriptions.ts`'s `OVERLAYS` — a JSON map resolved once at load
  and keyed by system index, the `MISSILE_HULL` shape from slice 1: a
  catalogue-style lookup rather than a tunable rule, and content
  (docs/TODO/58's generated prose) rather than a game constant.
- `encyclopaedia/chart.ts`'s `THEME` — the encyclopaedia's own green and
  amber, which docs/TODO/90's scope section rules out of scope by name
  alongside every other phosphor colour in the game.
- `encyclopaedia/main.ts`'s `GALAXY` — which galaxy this build of the
  encyclopaedia covers, a page-build choice tied to the descriptions corpus
  being galaxy-1-only (recorded in `descriptions.ts`'s own header), not a
  rule any other module has an opinion about.

**Two names moved, matching the slice brief's own examples almost word for
word.** The brief named "a chart's projection scale" and "a filter's
threshold" as the shape of thing that DOES move despite living in a
presentation file, and both turned up:

- `encyclopaedia/chart.ts`'s private `SPAN_X`/`SPAN_Y` were the chart's
  projection span — 256 wide, 128 tall — and they are exactly the "chart
  projection's 256/128/4" docs/TODO/90's scope section names as in scope
  ("the galaxy's own geometry"). They join `chart-metric.ts`'s existing
  `TENTHS_PER_CHART_UNIT` and `CHART_Y_SQUASH` as `CHART_SPAN_X` and
  `CHART_SPAN_Y`. **`CHART_SPAN_Y` is now an expression.** It was a second
  literal, 128, sitting inside a comment that already explained the halving
  ("chart y counts for half of chart x") without naming it; it is
  `CHART_SPAN_X / CHART_Y_SQUASH` now, so "the chart is drawn half-height" is
  one fact rather than two — 256 / 2 is 128 exactly, so nothing moved.
- `encyclopaedia/filters.ts`'s `TECH_MIN`/`TECH_MAX` were the filter's bounds
  on the tech-level range, and they are exactly "a filter's threshold". They
  are `constants/tech-level.ts` now, a new file: the raw techLevel the 1984
  algorithm computes is capped at 0-14 by its own arithmetic (`(s1>>8)&3`
  tops out at 3, `economy^7` at 7, `government>>1` at 3, plus one if
  government is odd), and every reader adds one before showing it — so 15 is
  the algorithm's own ceiling restated in shown units, not a number Harmless
  picked. It cannot be expressed as that arithmetic because this directory
  may not import `galaxy.ts`, so the derivation is written out in prose
  beside the literal, the same shape as `torus.ts`'s mass-lock radii or
  `jettison.ts`'s tonne value.

**One duplicate found and left for its own slice.** `game/screens/chart.ts:158`
still writes `target.width / 256` as a bare literal — the same span as
`CHART_SPAN_X`, unnamed, in the console's own short-range chart. It is
`ui/screens.ts`'s group (the console slice), not the galaxy's, so it stays
inline; noted on the cleanup list for whoever takes that slice.

**Neither `descriptions.ts` nor `galaxy.ts`/`goatsoup.ts` changed at all.** No
divergence, no unexpressed relationship, and no coincidence worth recording
turned up in either — they are exactly what docs/TODO/90 predicted this
partition would be: a byte-accurate transcription with nothing to move.

Byte-identical, verified against a worktree at HEAD: **17,511 compared, 0
changed** — every name in `src/constants/` then against now (including the
two new ones), all 256 systems of galaxies 1/2/3/8 field by field (name, x,
y, economy, government, techLevel, population, productivity, radius,
species, `describeSystem`, the goat-soup description, and galaxy 1's AI
overlay text), the market table for six sample systems over all 256
fluctuations, the encyclopaedia chart's real `toScreen` projection exercised
through the actual `Chart` class over three viewport sizes with pan and zoom
applied (recording every drawn point), and the tech-level filter's
`emptyFilter`/`isUntouched`/`matches` swept over all 256 galaxy-1 systems at
four tech-min and three tech-max settings. `Chart`'s constructor uses
TypeScript parameter properties, which node's `--experimental-strip-types`
cannot parse; the harness ran under `--experimental-transform-types` instead,
the same class the browser and `npm run build` see. The harness was broken
twice and restored: `CHART_SPAN_X` 256 → 257 reported 110 changes, and
`TECH_MAX` 15 → 14 reported 2.

The four gates: `npm run build` passes (the encyclopaedia still builds its
530 kB page with the chart and rail wired up, invariant 1 unaffected); `npm
run campaign` reports "all balance checks passed" — untouched, since nothing
this slice moved reaches the campaign's trader/market/contract path; `npm run
elite-a` 490 passed, 0 failed; `npm run portability` 0 contaminated. The full
suite reads 3155, unchanged — this slice added no new behaviour, only a new
address for four numbers, and the existing `test/encyclopaedia.test.ts`
checks (`the tech bounds cover every world`, `an untouched filter matches
every world`) already pinned them; its import was repointed from
`filters.ts` to `constants/tech-level.ts` rather than kept as a re-export.
Both browser-console harnesses were grepped for every name this slice moved,
created or touched, plus the file names themselves: clean — neither reaches
past `COMMODITIES`/`generateMarket` in `galaxy/galaxy.ts`, which this slice
left untouched.

Four breaks, all confirmed red and restored with targeted edits: the gate's
stray `SOME_RULE` in `encyclopaedia/main.ts` (1 failure), a side-effect
import from `constants/tech-level.ts` into `galaxy/galaxy.ts` (1 failure), a
diverged `TECH_MAX` at 12 (2 failures — `an untouched filter matches every
world` and `the tech bounds cover every world`), and the equivalence harness
itself (above).

**Still to do**, in the groups the gate's list already names: the station,
the console, the combat trainer, saves, and the policy seam. Plus one thing
no slice has touched: CLAUDE.md does not yet carry the
read-it-do-not-grep-it instruction below.

**Slice 10 — the station — landed.** Three new files, and the count went from
243 home / 257 out across 72 files to **260 home / 247 out across 70**. The
whole station group left the pending list: `game/docking.ts` and
`game/station.ts` declare no constants at all and came off entirely, and
`game/autopilot.ts`, `hud/tunnel.ts` and `ships/station-hulls.ts` are named
STAYS entries with their reasons.

| moved | file |
| --- | --- |
| threading the slot — the letterbox, the roll tolerance, the approach gate, and both bounding cubes | `constants/docking.ts` |
| the docking computer — where it takes the job, and the hand it flies with | `constants/docking-computer.ts` |
| the station as a place — the spin, the Dodo rule, and the "just outside the slot" trio | `constants/station.ts` |

**Seven inline literals got names**, which is why the home grew by 17 while
the outstanding count only fell by 10: the docking computer's steer rate and
throttle gain in `world-step.ts` (`1.2 * dt` and `dt * 1.5`, the two numbers
the cleanup list held for this slice), the NPC bounding cube's bare `+ 40`,
the fluffed-dock bounce's 420, the station spin's 0.26, the Dodo threshold's
10 and the docked backdrop's 900.

**The survey's live divergence is NAMED and deliberately not fixed.**
`NPC_HULL_BOX_MARGIN` is 40 where the player's measured `HULL_BOX_MARGIN` is
50, so 196 + 40 = 236 against Dodo vertices at 243 — NPC traffic flies
through the Dodo's hull and is reported clear. The argument is written beside
the constant, `test/docking.test.ts` bisects the cube out of the real
`WorldStep` so that FIXING it is one edit and one red test, and the decision
is on the cleanup list's Open section: correcting it makes NPC traffic near a
Dodo start bouncing where it did not.

**The "just outside the slot" trio is recorded rather than resolved.** The
survey's 420/450/900 are three different events — the bounce, the launch, the
docked backdrop — kept adjacent in `constants/station.ts` with the oddity
stated: the bounce leaves you NEARER the hull than the bay ever does, and
nothing says whether that is menace or drift. Choosing moves where every
failed docking puts the player, so it went to the cleanup Open list, the
`THARGON_REDEPLOY` precedent exactly.

**`STATION_PRESENTATION_SCALE` is an expression, closing a survey R-finding.**
Its own comment said "4 is exactly the factor that cancels the conversion" in
English while a second literal 4 enforced nothing; it is
`SOURCE_UNITS_PER_WORLD_UNIT` now, so a station stays 1:1 with its source
units — the 160 every docking distance is built on — whatever the ship
conversion becomes. It cannot follow to the home (its meaning is a product
over the ships' geometry anchor, the `WORLD_SPEED_PER_SOURCE_SPEED` shape),
so it is a named entry on the gate with the reason.

**Two stale pieces of prose died on the way through.** `system-scene.ts`'s
"Launch/respawn point" comment described a rule (`LAUNCH_STANDOFF`) that had
moved out from under it — the 900 is the docked backdrop and now says so —
and `station.ts` carried the survey's dangling doc comment (station.ts:50-56),
a full JSDoc for `slotNormal` with no declaration under it, orphaned when the
function moved to `world/slot.ts`; deleted, since the real home carries its
own. `docking.ts`'s transcribed "0.26 rad/s" header — one of the survey's six
transcribed-number comments — names `STATION_SPIN` instead of writing the
number, which leaves only `save-file.ts`'s for the saves slice.

**Every moved number is pinned in the measured shape**, in a new
`test/docking.test.ts` plus three checks in `test/station.test.ts` and seven
in `test/world.test.ts` — the suite reads **3182 from 3155**. Each slot edge
is BISECTED out of the real `dockingOutcome`/`planDocking` (probing at
`CONSTANT ± 1` moves with the constant, the slice-5 lesson); the gate
distance is SOLVED back out of the approach heading; the computer's two gains
are solved out of one real `WorldStep` frame, so a re-inlined 1.2 in
world-step.ts goes red even though `planDocking` never sees it; the bounce,
the NPC cube, the launch standoff, the spin, the backdrop and the Dodo
threshold are all measured through the real step, the real `Station` and the
real scene. The Dodo rule is asked at every shown tech level around the
threshold, so it fails however `DODO_TECH_LEVEL` moves.

Byte-identical, verified against a worktree at HEAD: **114,709 compared, 0
changed** — every name in `src/constants/` then against now, the ten declared
constants that moved and the seven newly-named inline literals read out of
HEAD's source, `dockingOutcome` over a 100k-point grid of positions and rolls
at both station sizes, `planDocking` over a position grid in both phases,
`inSlotChannel`/`slotRollOffset`/`rollAlignedWithSlot` swept, a 600-frame
docking-computer approach through the real `WorldStep` traced every ten
frames, the bounce and the NPC cube at nine distances spanning the edge,
`buildSystemScene` at all fifteen tech levels (hull choice, spin, backdrop,
station position), a full `Station.dock`/`launch` with events, market and
board compared, and both built stations. The harness was broken twice and
restored: `ROLL_TOLERANCE` 0.65 → 0.66 reported 1 change (no grid point lies
between the two, which is what the second break is for) and
`HULL_BOX_MARGIN` 50 → 70 reported **9,493**.

The four gates: `npm run build` passes; `npm run campaign` byte-identical —
zero diff lines against the worktree's own run; `npm run elite-a` 490 passed,
0 failed; `npm run portability` 0 contaminated. Both console harnesses were
grepped for every name this slice moved, created or left behind plus the
functions whose files changed: their one hit is a comment naming
`rollAlignedWithSlot`, which is still exported from `game/docking.ts`.

Eighteen breaks, all confirmed red and restored with targeted edits: the
gate's stray `SOME_RULE` (1 failure) and a side-effect import into the home
(1); re-inlined literals for the arrival lateral (1), the channel width (1),
the hull cube (1), the slot depth (1), the roll tolerance (1), the gate
distance (1), the computer's turn rate (1) and throttle gain (1), the bounce
(1), the NPC cube at the player's 50 (1), the launch standoff (1) and speed
(1), the spin (1), the Dodo threshold (1) and the backdrop (1); and a
diverged presentation scale at `SOURCE_UNITS_PER_WORLD_UNIT + 1` (3, in
`test/ship-roles.test.ts`).

**Still to do**, in the groups the gate's list already names: the console,
the combat trainer, saves, and the policy seam. Plus one thing no slice has
touched: CLAUDE.md does not yet carry the read-it-do-not-grep-it instruction
below.

**Slice 11 — saves — landed.** One new file plus two names landing in
`constants/witchspace.ts`, and the count went from 260 home / 247 out across
70 files to **266 home / 243 out across 69**. The whole saves group left the
pending list: `game/state.ts` declares no constants at all and came off
entirely, and `game/save-file.ts`, `game/snapshot.ts` and `game/storage.ts`
are named STAYS entries with their reasons.

| moved | file |
| --- | --- |
| the shelf — the autosave cadence, the flight ring, the named-save cap, the name ceiling | `constants/saves.ts` |
| the stranded hint's 2/8 cadence, the survey's flagged pair | `constants/witchspace.ts` |

**This slice's honest outcome is half STAYS, and the reasons are
structural, not tidiness.** `SAVE_RECORD_VERSION` and `SNAPSHOT_VERSION` stay
beside the interfaces they version — a version bumped in a different file
from the shape it describes is a divergence waiting to happen, the
`BrainName` shape from slice 7. `SAVE_ID_PREFIX` stays with the id grammar it
opens, and reading it turned up that `parseSaveId`'s three regexes RESTATE
the prefix — one rule, four spellings in one file — held together by
`test/saves.test.ts`'s round trips: a drifted prefix makes every id
unparseable, which is a red test, so it is recorded in the gate entry rather
than re-plumbed. And `storage.ts` keeps `PLAYER_NS`, `HARNESS_NS`,
`BOOT_KEY` and `NEW_COMMANDER` on the file's own security argument: every
key is built from module-private mutable `ns` so that after
`useHarnessSaves()` nothing on the page can compute a player's key, and
moving the namespaces into a directory everything imports would break that
structurally — the survey's hard point 4, decided as it predicted.

**The stranded pair is two rules, not a divergence.** The survey's "2 the
first time and 8 thereafter — probably deliberate; nothing says so" is
`STRANDED_HINT_FIRST` and `STRANDED_HINT_REPEAT` now, adjacent, with the why
written down: the first nudge comes quickly because a player who does not
know the B key is stuck in an empty sky, the repeats come slowly because the
reminder is for someone busy fighting Thargoids. No decision was owed —
first-delay and repeat-period are different rules that happen to share a
sentence.

**The last transcribed-number comment of the survey's six is a check now.**
`FLIGHT_RING`'s "three, at the 20-second autosave cadence, is the last
minute of flying" reasoned from a cadence its file could not see; both
constants live in one file now, the comment names `AUTOSAVE_INTERVAL`, and
`test/saves.test.ts` pins the product at 60 seconds so neither can move
without the sentence going red. That closes the set: `save-file.ts` was the
one left after slice 10.

**Breaking the rules found one that was not protected.** Re-inlining the
autosave RESET as 21 in `stepShipSystems` failed nothing — the suite pinned
the fresh session's initial timer and that a save happened, never the
cadence. `test/world-step.test.ts` now solves the interval out of the save
times of a real run (first save one interval in, next one an interval
later), and both the reset and the init re-inlines fail 1 apiece. The
stranded cadence got the same shape: first hint at `STRANDED_HINT_FIRST`,
repeats at `STRANDED_HINT_REPEAT`, solved from message times through the
real step.

Byte-identical, verified against a worktree at HEAD: **342 compared, 0
changed** — every name in `src/constants/` then against now, the six moved
values read out of HEAD's source, the whole name/id grammar swept
(`normaliseSaveName`, `uniqueSaveName`, the three id builders and
`parseSaveId` over hostile inputs, `describeAge` over its rungs), a full
shelf drive through both trees' real `storage.ts` under a deterministic
clock and an in-memory store — dock save, five ring writes, a named-save
replace, an over-cap refusal, `clearFlightSaves`, boot pointer, career
resolution, and the final store compared key for key and byte for byte —
`summariseSave`/`loadCost`/`saveLabel` over the shelf's own rows in all
three live-run readings, a 20-second stranded run frame by frame, and
`freshSession` whole. The harness was broken twice and restored:
`FLIGHT_RING` 3 → 4 reported 12 changes and `STRANDED_HINT_REPEAT` 8 → 9
reported 2.

The four gates: `npm run build` passes; `npm run campaign` byte-identical —
zero diff lines against the worktree's own run; `npm run elite-a` 490
passed, 0 failed; `npm run portability` 0 contaminated. The suite reads
**3187 from 3182**, all five new. Both console harnesses were grepped for
every name this slice moved, created or left behind plus `strandedHint`,
`freshSession` and `autoSaveTimer`: zero hits.

Nine breaks, all confirmed red and restored with targeted edits: the gate's
stray `SOME_RULE` (1 failure) and a side-effect import into the home (1); a
re-inlined ring of 4 inside `flightIds` (2), a re-inlined name ceiling of 17
(1), a diverged `FLIGHT_RING = 4` (2), the autosave reset (1) and init (1)
at 21, and the stranded first at 3 (2) and repeat at 9 (2).

**Still to do**, in the groups the gate's list already names: the console,
the combat trainer, and the policy seam. Plus one thing no slice has
touched: CLAUDE.md does not yet carry the read-it-do-not-grep-it
instruction below.

**Slice 12 — the policy seam — landed, and it moved one constant and fixed
three homes.** The count went from 266 home / 243 out across 69 files to
**267 home / 243 out across 69**: the whole group resolved as named STAYS
entries, exactly as the gate's own brief predicted ("the shapes here are
what every shipped genome was fitted at, so it is not a tidy").

| moved | file |
| --- | --- |
| the observation speed scale every genome was fitted at, with its do-not-fuse warning | `constants/brain-flight.ts` |

**`policy.ts` stays whole, on the brain-names.ts precedent.** Its eight
constants are the genome FORMAT's own dimensions — the four observation
widths pick the encoder (`observeFor` chooses BY input count, so the sizes
must stay distinct), and the two head counts are what a weights file IS.
Moving them would split one format across two homes. `scenario.ts`'s eight
are a format version with a five-bump history (`EPISODE_SCHEMA`, the
`SNAPSHOT_VERSION` shape), four catalogue reads (the `MISSILE_HULL` shape),
and the three `WEAVE_*` numbers that calibrate docs/TODO/66's measurement
instrument — a synthetic target one private pilot flies, not a game rule.

**The survey's "highest value per line in the partition" is done.**
`observation.ts` normalized slots 11/12 by literal `1.4` and `2.4` — the
residue of `TURN` being moved OUT of ai-training so the two could not
disagree, and the two lines where they still could. Both read `TURN` now,
and `test/observation.test.ts` pins the rule rather than the copy: a ship at
its own pitch or roll cap reads exactly 1.

**The log-distance encoding had three homes in one file and has one.**
Slots 6, 17 and 19 each wrote
`Math.min(2, log10(max(50, d) / 100)) / 2` out again, feeding three
different brains — a floor or base moved in one place would have had every
genome silently reading a different geometry. It is one `logDistance`
helper now, and the test holds the three slots to one rule with an
equilateral fixture (all three distances exactly 1,000 → all three slots
exactly 0.5), plus the floor's edge at exactly 50 — the first spelling of
that check compared two clamped reads and stayed green under a drifted
floor, which is the vacuity trap again, caught by breaking it.

**The 400 was the 4.1396 trap at a different number, and it is recorded the
same way.** `observe()` normalized slot 10 and the closing rate by a bare
`400` — the same value as `PLAYER_FLIGHT.maxSpeed` and NOT the same rule:
it is the scale every shipped genome was fitted at, frozen, where the
commander's top speed is a feel setting a redesign may retune. Fusing them
would have every engine retune silently rescale every observation. It is
`OBS_SPEED_SCALE` in `constants/brain-flight.ts` now, beside
`TARGET_SPEED_FLOOR` (whose 0.375 quote is this scale's arithmetic) and the
ramp's own warning, with the mirror argument written out.

**One prose figure corrected**: `scenario.ts` claimed episodes fly the
game's "25-second life" — `MISSILE_LIFE` is the PLAYER's warhead; every
missile in an episode is hostile and lives `HOSTILE_MISSILE_LIFE` = 30. The
sentence names the constants now and records its own correction. The
survey's remaining training findings (`evolve.ts`'s `[400, 1.036]` fossil,
the trial harness's 280 pin, the seed strides and `EPISODE_SECONDS`
collisions) are all `train/` files, which are outside the home by decision
— they wait on the "does train/ join" question in What to work out.

Byte-identical, verified against a worktree at HEAD: **1,871 compared, 0
changed** — every name in `src/constants/` then against now, all four
encoders swept over 400 randomized view triples (positions, orientations,
rates, pools, warhead flags), and five seeded episodes flown 30 seconds
through both trees — solo policy, scripted vs holding, three scripted vs
weaving, a two-policy pack vs runner, and a full defence fit (armed, beam,
energy unit, E.C.M., defend-head genome) — with `setup()`, `report()`, the
per-frame shot counts and all four fitness functions compared to the byte.
The harness was broken (`OBS_SPEED_SCALE` 400 → 410) and reported **1,602**
changes before being restored.

The four gates: `npm run build` passes — `observation.ts` crossed 400 lines
and carries its stated reason in `tools/sizes.mjs`; `npm run campaign`
byte-identical, zero diff lines against the worktree's own run; `npm run
elite-a` 490 passed, 0 failed; `npm run portability` 0 contaminated. The
suite reads **3197 from 3187**, all ten new. Both console harnesses reach
this seam only through `kit.observeFor`, which is unchanged and still
exported.

Eight breaks, all confirmed red and restored with targeted edits: the
gate's stray `SOME_RULE` in scenario.ts (1 failure); drifted re-inlines for
the pitch cap at 1.5 (1), the roll cap at 2.5 (1) and the speed scale at
410 (1); slot 17 re-growing its own drifted spelling of the log rule (1);
the shared rule's own base drifted to 110 (3) and its floor to 60 (1 —
zero until the floor check was sharpened, which is why it was); and the
equivalence harness itself (above).

**Still to do**: the console and the combat trainer, then the CLAUDE.md
instruction below, which only the last slice may add.

**Slice 13 — the combat trainer — landed.** Three new files plus one name
landing in `constants/threat.ts`, and the count went from 267 home / 221+22
out across 69 files to **288 home / 221 out across 69**. The whole trainer
group left the pending list: every one of its ten files is a named entry now
— what the record measures is `constants/combat-record.ts`, the exercise's
opening, clocks and entry are `constants/exercise.ts`, the wave ramp's rates
are `constants/waves.ts`, and what stays is typed tables, format versions,
prose and drawing, each with its reason.

| moved | file |
| --- | --- |
| the record's rules — the sampling clock, the six cone, both pass thresholds and the buffer's bounds | `constants/combat-record.ts` |
| the exercise — where it opens, the in-view arc, the entry throttle, the timeout and the traffic sentinel | `constants/exercise.ts` |
| the wave ramp's rates and its count ceiling | `constants/waves.ts` |
| `MAX_TIER`, the tier ladder's own top rung | `constants/threat.ts` |

**The tier count had three spellings and has one.** The trainer's `MAX_TIER`
restated a fact the threat ladder owns, and `ai-training/scenario.ts`'s
`seed % 3` was a third spelling of the same rung count; both read
`constants/threat.ts` now, and breaking the constant to 3 fails four checks.
`MIN_OPENING_RANGE = 2 * PASS_FAR` survives as an expression inside the home
(one internal import, which the leaf rule allows), and
`WAVE_COUNT_SATURATION` moved as the derivation it already was.

**Two stale transcriptions died in the opening's own evidence.** The
`OPENING_RANGE` argument quoted `PASS_FAR` as "(900)" and the margin as
"four times" — both from before docs/TODO/67 moved the threshold to 600, a
comment that had already gone quietly wrong beside a correct constant. The
paragraph names the constants now and records its own correction. The
viewer's `SIM_DT = FIXED_DT` alias — a second name for the world clock —
was deleted outright; the loop reads `FIXED_DT`.

**Breaking the rules found three that were not protected, which is the
slice's real yield.** A diverged `PASS_FAR` at 650 failed nothing — the
break-off coupling is deliberately an inequality — so both thresholds are
now pinned as the decisions they are, with the sweep table as the reason. A
drifted `waveTier` at /4 passed every monotonic-and-saturates property, so
the documented ramp table (1/0 1/0 2/0 2/1 … 6/2) is asserted wave by wave.
And nothing observed the exercise's entry speed or the IN VIEW verdict's
edge: `ENTRY_THROTTLE` is solved back out of a real `startExercise` and
`IN_VIEW_DEG` flips a measured opening at ±0.6 degrees. One break is
deliberately allowed to pass: a diverged `OPENING_RANGE` at 4600 stays
green, because the test asserts the RULE (outside their gun via the
scatter's own `OPPOSITION_RING_NEAR`, inside their interest, clear of the
pass thresholds) and the choice inside those bounds is free — probing the
number itself would pin decoration.

Byte-identical, verified against a worktree at HEAD: **403 compared, 0
changed** — every name in `src/constants/` then against now, all 17 old
exports against their new homes, the four private literals read out of
HEAD's source, the whole ramp (`waveCount`/`waveTier`/`waveEscalation`/
`waveFit` over forty waves, `clampTier` over its range), the tables, every
opening plan placed and measured against a fixed sky, `countPasses` over 40
synthetic traces, and five seeded episodes through both trees across the
tier-spelling change. The harness was broken twice and restored: `PASS_FAR`
600 → 650 reported 26 changes and `WAVE_TIER_EVERY` 3 → 4 reported 4.

The four gates: `npm run build` passes; `npm run campaign` byte-identical —
zero diff lines against the worktree's own run; `npm run elite-a` 490
passed, 0 failed; `npm run portability` 0 contaminated. The suite reads
**3203 from 3197**, all six new. Both console harnesses name nothing this
slice touched.

Eleven breaks, all confirmed red and restored with targeted edits: the
gate's stray `SOME_RULE` (1 failure) and a side-effect import into the home
(1); a re-inlined `PASS_CLOSE` at 410 in the recorder (1), a diverged
`PASS_FAR` at 650 (1, zero until the pin), a re-inlined `waveTier` at /4
(1, zero until the ramp table), a re-inlined `waveCount` cap at 7 (1), a
diverged `MAX_TIER` at 3 (4), a re-inlined `SCENARIO_TIMEOUT` at 130 (2), a
re-inlined `ENTRY_THROTTLE` at 0.3 (1, new check) and a re-inlined
`IN_VIEW_DEG` at 25 (1, new check); plus the deliberate pass above.

**Still to do**: the console — the last group — then the CLAUDE.md
instruction below and the docs/ARCHITECTURE.md entry, which only the last
slice may add.

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
