# 90 — the cleanup list

Stragglers from the constants move. Everything here is a loose end the slices
deliberately did not tie, recorded as it was found so none of it is discovered
again from scratch.

Three kinds, and they want different treatment:

- **Blocked** — will be resolved by a later slice. No decision needed, just
  order.
- **Decided** — a stated exception. Not pending work; do not "fix" it.
- **Open** — needs a decision or a separate behaviour change.

---

## Blocked — a later slice unblocks these

| what | where | unblocked by |
| --- | --- | --- |
| `WORLD_SPEED_PER_SOURCE_SPEED` = `PLAYER_FLIGHT.maxSpeed / playerHull(COBRA_MK_3_HULL_ID).maxSpeed` | `game/ship-specs.ts:107` | nothing scheduled — see below |
| `ANCHOR_RECHARGE_RATING` = `playerHull(COBRA_MK_3_HULL_ID).energyRechargeRating` | `game/systems.ts` | nothing scheduled — the same case, see below |

All of these are correctly-derived constants that an import-nothing leaf cannot
reach. **This will keep happening**: the constants that most want to be
expressions are exactly the ones that pull another module's table into the leaf.
When a slice leaves one behind, add it here rather than weakening the leaf rule.

**The flight slice closed the other three.** `RAM_MIN_SPEED`, `CC_MAX_PITCH` and
`CC_MAX_ROLL` were waiting on `PLAYER_FLIGHT` and `TURN`; those are now
`constants/player-flight.ts` and `constants/hull-motion.ts`, and each derivation
lives in the constants file for its own subject — `RAM_MIN_SPEED` in
`constants/tactic-choice.ts`, the two caps in `constants/combat-computer.ts`.
They still evaluate to 280, 0.7 and 1.2. The same slice wrote the mirror of
`brain-flight.ts`'s `4.1396` warning beside `PLAYER_FLIGHT.rateRamp`, so the
pair now names itself from both sides.

**`WORLD_SPEED_PER_SOURCE_SPEED` is a harder case than the three above, and it
may never move.** Half of it is `PLAYER_FLIGHT`, which is home. The other half
is a released hull's top speed, and reaching one means `ship-identity.ts` →
`catalogue.ts` → six generated tables. The survey suggested relaxing the leaf
rule here on the grounds that "the catalogue is itself a leaf" — it is not; only
`combat-math.ts` imports nothing, and `playerHull` is nowhere near it. The
alternative, restating the Cobra's 42 as a literal, puts a pack number in a
Harmless file, which `ship-specs.ts`'s header forbids in capitals. So it stays
beside the roster, where both halves are already in scope, and the reasoning is
written out beside it. Anyone who wants it in the home has to answer the leaf
question first, for the whole directory.

**`ANCHOR_RECHARGE_RATING` is the second of exactly that shape, found by slice
4, and it is now the only constant left in `game/systems.ts`.** It is the Cobra
Mk III's `energyRechargeRating`, read from the catalogue so that a hull rated 2
recovers twice as fast whatever the Cobra's own rating becomes — the same
`playerHull` reach, the same six generated tables, the same refusal to restate a
pack number. The rest of the file's recharge model is `constants/recharge.ts`,
which says in its header that this half could not follow and why. Slice 3
predicted this would keep happening and it did, in the very next slice; the two
of them together are the argument that whoever reopens the leaf rule should
reopen it once, for the directory, rather than case by case.

---

## Decided — stated exceptions, leave them alone

**`MISSILE_HULL` stays in `game/ordnance.ts`.** It is a memoised
`requireShipDef` lookup, not a rule, and moving it would put a function call
inside the leaf. It sits in the gate's per-name allowlist under a heading saying
it is a decision rather than pending work.

**`NPC_HIT_FALLOFF` stays a literal in `constants/npc-gun.ts`.** It looks like
the laser's reach and the history says otherwise: `git log -S` puts the
expression in the initial commit, when the NPC's own firing gate was 2,600 while
the player's `LASER_RANGE` was 3,500. Two readings survive and they want
different expressions — `NPC_LASER_RANGE`, or `NPC_LASER_RANGE / 0.75` which is
4,667 and a balance change. The argument is written beside the constant.
**Resolving it is a decision for Chris, not a refactor.**

**`SIGHT_Y`'s CSS twin stays duplicated.** docs/TODO/93 owns the phosphor and
the stylesheets; CSS was ruled out of 90's scope.

**`VIEW_QUATS` stays in `game/views.ts`.** Four `THREE.Quaternion`s are objects
and the home may not import three, so the only part of the table that could move
is its four yaw angles — and splitting one table across two files buys nothing
here: the angles have no second home to diverge from, and 0/π/±π/2 is the
DEFINITION of front, rear, left and right rather than a number anybody would
tune. It has its own entry on the gate's list saying so. Slice 5 also found that
nothing tested it — left and right could be swapped with the suite still green —
and `test/world-step.test.ts` holds all four against the nose now.

**`ARENA_RADII = 16` stays a literal in `game/combat-sim-opening.ts`.** It is
the same number as `WITCHPOINT_RADII` and a DIFFERENT RULE: the witchpoint was
chosen for how big the planet looks and how long the cruise in takes, the arena
for its margins to the sun, the station and the ground across 768 systems.
Moving where a jump drops the player should not silently move where an exercise
is fought. Its old comment said it was not imported because game.ts cannot be
loaded without a browser; that reason expired in slice 5 and the honest one is
written there now.

**The step's docking-computer gains stay for the station slice.** `world-step.ts`
steers the autopilot at `1.2 * dt` and closes the throttle gap at
`Math.min(1, dt * 1.5)`. They are the docking computer's numbers, not the
clock's, and the rest of that subject is `docking.ts`, `station.ts` and
`autopilot.ts`.

### LEGACY AND MIGRATION WERE DELETED. Do not reinstate them.

Chris, 2026-08-04: *"We don't have any data to migrate yet — anything legacy can
be removed and any migration is not needed. We will only need migrations once we
start to release official versions."*

Slice 4 deleted, in `src/`:

| gone | what it was |
| --- | --- |
| `LEGACY_MAX_ENERGY`, `LEGACY_MAX_SHIELD` | the commander's pools before TODO 27 made them 255 points |
| `migratedSystems` | rescaling a save written on those |
| `LEGACY_ASTEROID_HULL_POINTS` | a rock's share of the pre-energy hull scale |
| `migratedNpcState` | rebuilding a bank from a save written on that |
| `legacyHullPoints` | the same scale as a roster column, on all 49 rows |

**The reasoning is docs/TODO/53's, and it is a rule rather than a one-off.** 53
deleted `migrateLegacySaves` and the TODO README records the argument: *"53
asked who the code was for. Nobody but us has ever played, so the answer was
nobody, and a careful migration serving nobody is still a hazard."* A migration
is a second reading of a value's meaning, kept alive for a reader who does not
exist, and it is exactly the second home this whole item is about.

Two consequences worth knowing:

- **The survey's `LEGACY_MAX_ENERGY` / `ENERGY_BANKS` trap is resolved by
  subtraction.** It is listed under Coincidences as "historically the same fact,
  now permanently different, because a save on disk depends on one". No save on
  disk depends on one. There is a single 4 in the subject now, `ENERGY_BANKS`,
  and it is free to move; `pools.ts` records what the other one was so that a
  reappearing 4 is recognisable as a migration divisor coming back.
- **`ENERGY_REGEN_FRACTION` and `SHIELD_REGEN_FRACTION` had to stop being
  derivations.** They were `0.1 / LEGACY_MAX_ENERGY` and
  `0.035 / LEGACY_MAX_SHIELD`. They are literals in `constants/recharge.ts` now,
  0.025 and 0.035, with the pre-TODO-27 arithmetic written out beside them —
  identical to the bit, and honest, because a fraction of a pool per second is
  what they are on any scale.

`test/damage-paths.test.ts`'s `GONE` list holds all six names against
`game/systems.ts`, `game/npc-energy.ts`, `game/ship-specs.ts`, `game/world.ts`
and `game/persistence.ts`, so reinstating any of them fails the build. Break it
by putting one back; that is what the check is for.

### THE IDENTITY FALLBACKS WENT TOO. Do not reinstate them either.

Slice 4 kept three of these on the grounds that they were corruption tolerance
as well as history, and left the decision to the saves slice. **Chris overruled
that on 2026-08-04:** *"yes, lose them — we don't need them. An unreadable save
is just old junk at the moment."* So the answer to "what does an unreadable save
do" is: it is not a save. Deleted:

| gone | what it was | what happens now |
| --- | --- | --- |
| `migratedPlayerHullId` (`ship-identity.ts`) | a missing OR unresolvable `shipId` became the Cobra Mk III, on every load from `storage.ts` and `persistence.ts` | `requirePlayerHullId` at both of those boundaries |
| `savedShipIdentity` returning `undefined` for `{}` | a snapshot with no ids took its design's recommended variant | it throws; `NpcSnapshot.designId` and `.profileId` are REQUIRED |

**The refusal is the save system's existing one, not a new failure mode.** That
was the open question and it is answered by matching what `parseSaveId` and a
bad `v` already do:

- `repairCommander`'s throw happens inside `readSave`'s `try`, so a record whose
  commander names no hull **reads as null** — the same nothing an unparseable
  key reads as. `bootSave()` then finds no save and `bootCommander()` starts a
  fresh one. Nothing reaches the screen.
- `savedShipIdentity`'s throw comes out of `World.restoreNpcs`, inside
  `Persistence.restore`, which `Persistence.resume` already catches: *"a world
  that will not come back must never cost you the commander"*. Every load in the
  UI is `setBootId` plus `location.reload()`, so `resume` is the only path a
  player can take into a restore. `test/world-step.test.ts` flies it and asserts
  `resume()` returns false rather than throwing, with the same bytes WITH their
  ids as the control.

**`role-variants.ts` was the third name on the list and it is LOAD-BEARING —
keep it.** Reading it, the only legacy thing in the file was the prose. Its
`recommendedProfileIdFor` fallbacks are live rules: a trader, a rock or an
overlay is not choosing a build for its gun, and the Constrictor sits in a slot
no pirate band draws from. `roleCombatProfileId` is called once per roster row
by `ship-specs.ts` at load and by nothing else now — a restore reads the build
out of the snapshot. Only the header and one docstring changed.

**A fourth thing was found and also kept**, for a reason that is not the one
written beside it. `persistence.ts`'s `specForDesign(...) ?? pirateSpecForTier(...)`
said the tier was "the answer for a save written before ships had ids, which
carries no design to look up". Every snapshot carries a design now, so that
sentence is dead — but the lookup can still miss, because a design the roster no
longer flies in that role has no row, and rosters do move (the Asp Mk II came
off the pirate list on purpose). `test/ship-roles.test.ts` tests that case now
instead of the legacy one.

Both harnesses were grepped for every name touched — `migratedPlayerHullId`,
`savedShipIdentity`, `specForDesign`, `designId`, `profileId`, `shipId` — and
neither names any of them. `test/playtest.js` and `train/jameson-autopilot.js`
take `useHarnessSaves`, `clearHarnessSaves` and `saveNamespace` from
`storage.ts` and nothing else, and all three are still exported.

### AND THE FOUR THAT WERE LEFT AS SEPARATE DECISIONS. All gone, plus a fifth.

The identity slice found four more legacy tolerances on its way through and
left each one as its own decision rather than folding them into that commit.
**Chris decided all four on 2026-08-04:** *"yes, clear them now."*

| gone | where | what it was |
| --- | --- | --- |
| `CanisterSnapshot.energy?` | `snapshot.ts`, `cargo.ts` | optional, and absence meant "whole" — a world written before canisters had a bank. Required now, like every other field of that snapshot, and `Cargo.restore` takes the number instead of defaulting it |
| the missing-`dockPlan` case | `test/snapshot.test.ts` | **there was no code**: `restoreState` walks the keys the snapshot HAS, so a save written before the docking latch was persisted kept the fresh `gate` default for free. The tolerance existed only as an assertion pinning the shape of that loop as though it were a rule about old worlds. docs/TODO/17's *"Old snapshots must still load"* is the acceptance it came from, and that line is superseded |
| the `career` note | `snapshot.ts` | *"Saves written before TODO 43 still carry the key; nothing reads it."* There is no such FIELD — 43 deleted it — and no such save. The rule above it (a world has no opinion about whose autosave group it is in) stays, and `test/career-identity.test.ts` section 4 still enforces it from the source |
| the bare-commander import | `screens/save-transfer.ts` | `readSaveFile` accepted a raw `CommanderData` — credits and a system index, no name, no version, no world — as an export from before saves were records |
| **`AutopilotState.control.ecm?`** | `combat-computer.ts` | **the fifth, found by the sweep.** Same shape as the canister's bank: optional so a save written before the E.C.M. head existed could restore a control without one. `act()` returns `Control.ecm` unconditionally (always false for a brain with no logit for it), so nothing this build can write omits it |

**The import needed no fourth refusal line.** That was the open question, because
this one is different in kind: the other four are about what our own format
tolerates, and this is about what an import accepts from a file a human pastes
in — so the failure mode is a person seeing an error rather than a save quietly
not loading. It reuses `NOT_A_SAVE`, which is what such a file IS: bytes with no
name, no version and no world are not a save file, and `WRONG_VERSION` would be
a lie about a shape that carries no `v` to be wrong. `NOT_A_SAVE`,
`WRONG_VERSION` and `STORE_FULL` are still the whole vocabulary.

### THREE THINGS LOOKED LEGACY AND WERE LIVE. Keep them; only the prose moved.

This keeps happening — it happened to the tier fallback last time — so it is
worth naming the tell. **A save migration and an IMPORT REPAIR are the same code
wearing different reasons**, and only one of them is dead.

- **`repairCommander` (`storage.ts`) is the import boundary's validator, not a
  migration.** Nothing this build writes needs repairing: `capture()` clones a
  whole `CommanderData`. What arrives incomplete is an imported FILE —
  `adoptSaveFile` takes the commander straight out of a stranger's JSON and
  writes it unexamined, so the next `readSave` is the first look anything gives
  it. A hand-edited ten-entry `cargo`, an `equipment` of `{}` or a `day` of
  `"soon"` reaches that function. Every guard stays; the docstring says what
  they are really for.
- **`LivingGalaxy.load` (`galaxy/living.ts`) defaults all five fields for the
  same reason** — `WorldSnapshot.galaxyState` is `unknown` and comes off the
  same file. Only `heat` carried a comment blaming saves written before
  notoriety existed; it was the odd one out and the reason was false. The
  comment went, the uniform defaulting stayed, and the function now says why.
- **`SaveRecord.commander` is still reachable** and was checked before the
  import branch went, because that branch looked like its only producer. It is
  not: a record naming a commander with a world that does not own one still
  lands commander-only, which is a shape a text editor can produce and no save
  of ours can.

**And a migration was found that never ran.** `repairCommander`'s
*"saves from before weighted ratings: every past kill counts as one"* cannot
fire: `newCommander()` gained `combatScore: 0` in the same commit that added the
guard (`04561f0`), above a `{ ...newCommander(), ...stored }` that had already
answered — so every career saved before weighted ratings came back UNRATED
rather than re-scored, from the day the feature shipped. Kept for what it can
still do (repair a spoiled score from the body count beside it) with the
comment corrected. **A second home does not have to disagree loudly to be a
defect; this one lost silently for a week.**

Three more stale claims from the identity slice were corrected in passing:
`CommanderData.shipId` still said a save without one *"migrates to the Cobra
Mk III"*, and `combatScore` and `furthestWave` still advertised what a save
written before them loads as. And `summariseSave`'s `c.combatScore ?? c.kills`
went: it is a SECOND HOME for a rule `repairCommander` owns, on a commander that
has already been through it — `saveRows` over `listSaves()` is its only caller.

Two `?? 0` reads of required `CommanderData` fields are still out there and were
deliberately not touched, because they are a different subject from saves:
`cargoTonnes`'s `c.survivors ?? 0` and `recordFurthestWave`'s
`c.furthestWave ?? 0` (`commander.ts`). Both are dead by the type. Whoever does
a general defensive-`??` pass owns them.

**Three assertions went and six replaced them, and all three were legacy.**
`an old NPC snapshot without a dock plan starts at the fresh gate default`
(the whole of the dockPlan tolerance), and `a pre-record export still imports`
with `...keeping its commander` (the bare-commander import). The import's three
replacements assert the refusal, the line the player is told, and that nothing
of the file reaches the shelf. The other three are new coverage: **a canister's
bank had none.** The fallback was indistinguishable from the truth until
something was wounded, and nothing ever wounded one — so a save that dropped the
bank would have looked right for ever. It round-trips a canister at 3 points
now, with a full capsule beside it as the control.

Both harnesses were grepped again, for `energy`, `dockPlan`, `restoreState`,
`serialiseState`, `career`, `readSaveFile`, `adoptSaveFile`, `commanderOf`,
`DEFAULT_NAME`, `canisterMaxEnergy`, `CanisterSnapshot`, `repairCommander`,
`combatScore`, `furthestWave` and `survivors`. Neither harness names any of them
in a load-bearing way: their `energy` hits are the defence encoder's own field
and `poolsLeft`/`energyLeft` from the kit, and their `career` hits are prose.

3073 passed, 0 failed. elite-a 483. portability 0 contaminated. Campaign
byte-identical on all 33 balance rows. Constants gate unmoved at 98/347 across
89 files. Every new gate was broken and confirmed red — the two required fields
fail `tsc` when made optional again, the canister round trip fails when
`Cargo.restore` defaults the bank, and all three import checks fail when the
bare-commander branch is put back.

---

## Open — a decision or a separate change

### Three derivations whose arithmetic no longer produces the shipped value

Each looks like an obvious tidy-up. Each is a behaviour change. They are on the
survey's land-separately list and they stayed literals through slice 2, with the
discrepancy recorded in the comment beside them.

| constant | shipped | its own stated arithmetic |
| --- | --- | --- |
| `tactics.slash.missDistance` | 175 | "1.6× the standard pass" = `110 × 1.6` = **176** |
| `CLEAR_RANGE` | 340 | `BREAK_OFF_RANGE` "and half again" = `220 × 1.5` = **330** |
| `CC_ACCEL` | 100 | the trader Cobra's `220 × ACCEL_FRACTION` = **101.2** |

For each: is the value right and the prose wrong, or the other way round? A
one-unit move on the first, ten on the second, 1.2 on the third — small, but
each is a real change to how a ship flies.

### Three of the six transcribed-number comments are still out there

The survey listed six places where reasoning cites another file's value by
writing the number out: `save-file.ts:36`, `input.ts:53`, `player.ts:52-56`,
`docking.ts:11`, `jettison.ts:29`, `starfield.ts:48`. **Slice 3 did
`player.ts`'s and slice 5 did `input.ts`'s and `starfield.ts`'s**, leaving
`save-file.ts`, `docking.ts` and `jettison.ts`.

`starfield.ts` is the one worth copying: its two fade thresholds were justified
by "max ship speed is 400" and "8 x 400 = 3200", two numbers the file could not
see, and both are expressions over `PLAYER_FLIGHT.maxSpeed` and
`TORUS_MULTIPLIER` now — 520 and 2400 to the bit. A prose figure became a
derivation, which is stronger than a corrected sentence.

**The flight slice did `player.ts`'s, and found it already wrong.** The
commander's pitch cap was argued against four pirate hulls by transcribing
`turnRate × TURN.pitch` for each, and one of the four was an Asp Mk II at 1.68 —
a hull that has since been taken off the pirate roster on purpose. The comment
was reasoning about a ship the player cannot meet. It is now re-derived from the
rows it names in `test/combat-model.test.ts`, and the checks assert the claim
(you out-turn the heavy hulls, the light ones still edge you) rather than the
arithmetic.

That is the shape to copy for the other five: bringing both anchors into
`src/constants/` is what makes the reference expressible, and a check that
re-derives the product is what stops the next one rotting. **Expect at least one
of the remaining five to be wrong already.**

### `MAX_TRADERS` still has two homes

`game/encounters.ts:43` and `game/population.ts:41`, both `= 4`. This is the
fuse the whole item was named after and it is still lit. The survey settled the
answer: **population owns it** — it is a property of what a system holds, not of
the clock that adds to it. Waiting on the spawning-and-population slice.

The gate would now catch a *third* home mechanically, but not these two: they
are both on the allowlist as pending work.

### CLAUDE.md does not yet carry the instruction

The read-it-do-not-grep-it wording is written out in
`docs/TODO/90-one-home-for-every-constant.md` and has not been added to
CLAUDE.md, because pointing at `src/constants/` before it is finished would send
an agent to a half-built home. **Add it when the last slice lands**, not before.

The gate catches a second home mechanically, which is stronger than the
instruction. The instruction is what stops one being written in the first place.

### What slice 5 left inline in the world step, and for whom

The world clock slice named every inline number in `world-step.ts` that was its
own subject and left the rest where the SLICE THAT OWNS THE SUBJECT will find
it. None of these is visible to the gate — it reads column-zero declarations,
and every one of these is a literal in the middle of a function.

| left inline | where | whose |
| --- | --- | --- |
| `npcTargetTimer = 2` — how often the sky re-decides who is hunting whom | `world-step.ts` | the rest of the fight; `npc-targeting.ts` owns the rule and has no constants file yet |
| `stationDockZ + 40` — the NPC bounding cube | `world-step.ts` | the station. **This is the survey's live divergence**: `docking.ts`'s `HULL_BOX_MARGIN` is 50 for the player, measured, and 40 lets an NPC through a Dodo's hull. Naming it is free; fixing it is a behaviour change |
| `9000 + random() * 4000` — where an arrival pirate wave warps in | `world-step.ts` | spawning. The survey thinks the 9,000 is `PLAYER_INTEREST_RANGE`, which is already home, but "almost certainly" is not an argument for asserting it |
| `multiplyScalar(150)` — how far a thargon appears from its mother | `world-step.ts` | spawning |
| the hermit's 900 / 320 / speed 40, and the generation ship's 6,000 | `world-step.ts` | encounters. **And the hermit's message says "SLOW TO 20" while the gate is `speed < 40`** — either the line is stale or the tolerance is deliberate, and nothing says which |
| `strandedHintTimer = 8` | `world-step.ts` | the survey's "2 the first time and 8 thereafter" pair with `state.ts:142`, which is the saves slice's file |
| `energyLowTimer = 1.2` and every message duration | `world-step.ts` | nobody: these are how long a line stays on the console, and the console's own slice can decide whether they are rules |

### The README is a prose home for the torus multiplier

`README.md`'s key table says "torus jump drive (8×, stars streak; cuts out when
mass-locked)". Slice 5 made the manual's caption and the briefing read
`TORUS_MULTIPLIER`, and markdown cannot import. `test/key-help.test.ts` holds
the README to the binding table by KEY only, never by description, so this one
is checked by nothing. It belongs with the non-TypeScript homes below.

### `CARRY_LIMIT` is still module-private in `engine/input.ts`

Three unread taps of one key, chosen against `MAX_STEPS_PER_FRAME`. Slice 5 put
the budget in the home and the comment names it now instead of writing "is 5",
but the constant itself waits for the console slice — and when it lands, the
relationship wants a check rather than a sentence, in the shape
`test/combat-model.test.ts` uses for the rate ramps.

### The scan cannot see four things

Recorded so nobody assumes the gate is total:

- **Function-local constants.** The scan is column-zero only, by the item's own
  rule that a value whose meaning is local to one function is not in scope.
- **Magic numbers written inline.** The survey found hundreds — `threat.ts`
  alone has ~18 unnamed tuning values that `npm run campaign` is tuned against.
  A named constant in the wrong place is caught; an unnamed one anywhere is not.
- **`train/` and `tools/`.** Excluded deliberately: the trainer's search
  hyperparameters and seed bases are its own, and `tools/` is a separate world.
  But `train/` also mirrors game constants, and those mirrors are exactly what
  invariant 15 keeps being broken by — see the survey's training section.
- **Non-TypeScript homes.** CSS and the four `.html` files. 93 owns the first;
  nothing owns the second.

### The two browser-console harnesses are not on any gate

`test/playtest.js` and `train/jameson-autopilot.js` reach into `src/` with
DYNAMIC imports against the dev server, which is the whole point of them: the
commodity table, the contraband list and the autopilot's turn rates stop being
copies kept in step by hope. Nothing type-checks them and nothing runs them, and
a module namespace object has no missing-property error, so a name that moves
becomes `undefined` in silence.

**It has already happened.** Slice 2 moved `CC_MAX_SPEED` and `CC_ACCEL` out of
`game/combat-computer.ts`, and `jameson-autopilot.js:43` went on destructuring
them from it — so the harness spent the interval throttling the player to
`Math.min(undefined, …)`, which is `NaN`. The flight slice found it and fixed
both files.

Until something checks them, **every slice must grep these two files for the
names it moves.** That is the one place in this project where grep is the right
tool, because the hazard is a name that is not there.

Slice 4 did it, for all eighteen names it moved or deleted, and both files were
clean: neither harness names a pool constant, a sun distance, a recharge rate or
any of the deleted legacy names. They reach `poolsLeft` and `energyLeft` through
the kit, and both of those are still exported from `game/systems.ts`.

Slice 5 did it for all twenty-two names it moved, renamed or created, and both
files were clean of every one of them. The only things either harness takes from
a file this slice touched are `distanceTenths` (still exported from
`galaxy/navigation.ts`) and `g.massLocked()` (still a method on Game), and both
still resolve. **`test/playtest.js` did hold a sixth home for the escape cost**
— `if (g.commander.fuel < 10) break; // no fuel to jump clear` — and it takes
`WITCHSPACE_ESCAPE_COST` out of `constants/jump.ts` now, alongside the
`PLAYER_FLIGHT` import it already had.

### `src/constants/` is not in docs/ARCHITECTURE.md

Four slices in, the directory holds 98 names in 20 files and the architecture
doc's tree does not mention it. Nobody has added it because it is half-built and
its shape still moves each slice. **The last slice should add it**, and the entry
that goes there is one line per file, which is the same sentence each file's
header already opens with. Slice 4 corrected the one line that had gone actively
wrong — `systems.ts` was described as holding "the save migration".

### `player-interest.ts` and `tactics.ts` were deleted

Both were a table or a single constant plus reasoning, with nothing left once
the values moved. Six comments in `npc.ts` naming them by filename were
repointed. If a future reader finds another dangling reference, it belongs here.
