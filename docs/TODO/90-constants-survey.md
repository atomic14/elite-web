# 90 — the constants survey, phase 1

The read-only inventory behind docs/TODO/90. Five agents, partitioned by
subject, each required to READ its files start to finish with grep banned,
because a diverged pair shares neither a name nor a value and no search can
find one.

This file is the working record. The findings are the deliverable; the
per-namespace inventories are not reproduced in full, because they can be
regenerated and the decisions cannot.

**Status:** all five partitions reported.

**Coverage, reconciled.** Every one of the 91 hand-written files in `src/game/`
(including all 14 screens and the four hand-written `elite-a/` files) was read
in full by at least one agent, as were `src/galaxy/`, `src/world/`,
`src/ships/`, `src/engine/`, `src/hud/`, `src/ui/`, `src/viewer/`,
`src/encyclopaedia/`, the four top-level `src/*.ts`, `src/ai-training/`, all 13
files in `train/` and all 16 in `tools/`. The five generated `elite-a/*.ts`
files were inspected structurally and treated as data. **The one gap is the
HTML**: `play.html`, `viewer.html`, `gallery.html` and `encyclopaedia.html` hold
element ids and the `?` panel's static rows, which are constants of the UI
partition and were outside every brief.

---

## Corrections to the parent item

The item's Why section said "exactly ONE constant in `src/` is expressed in
terms of another". **That is wrong**, and both completed partitions caught it
independently. The verify grep only matched `= UPPERCASE` at the start of a
line, so it missed every derivation wrapped in a call or an expression. The
real list is at least:

| where | derived constant |
| --- | --- |
| `systems.ts:78` | `LOW_ENERGY = Math.round(MAX_ENERGY / ENERGY_BANKS)` |
| `systems.ts:99-100` | `ENERGY_REGEN_FRACTION`, `SHIELD_REGEN_FRACTION` — over `LEGACY_MAX_*` |
| `systems.ts:105` | `SHIELD_REGEN = MAX_SHIELD * SHIELD_REGEN_FRACTION` |
| `systems.ts:113` | `ANCHOR_RECHARGE_RATING` — read from the catalogue |
| `ship-specs.ts:137` | `WORLD_SPEED_PER_SOURCE_SPEED` |
| `npc-energy.ts:89` | `ANCHOR_NPC_MAX_ENERGY` |
| `ordnance.ts:56` | `ECM_ENERGY_COST = Math.round(MAX_ENERGY / 4)` |
| `ship-specs.ts:326` | `PIRATE_TIERS` — from `hullThreatTier` |
| `shop.ts:64` | `perLightYear = Math.round(FUEL_PRICE * 10)` |

The pattern is therefore established and good, not absent. What is missing is
its **consistent** application — see the R-findings.

**A second correction, to the acceptance criteria.** The item says the new home
"must import nothing", on the `brain-names.ts` precedent. That cannot hold: the
correctly-derived constants above need the Elite-A catalogue, and the fix for
several R-findings needs it too. The workable shape is leaf files for literals
plus a small number of *derived* modules importing the catalogue only — the
catalogue is itself a leaf (`combat-math.ts` imports nothing at all).

---

## The strongest finding: a constant that has already diverged from its own evidence

`threat.ts:39`:

```ts
/** Cargo value (tenths of a credit) at which the prize term saturates — 1,600 Cr. */
export const PRIZE_SATURATION = 25000;
```

`markOf` builds `cargoValue` in tenths, so 25,000 tenths is **2,500 Cr, not
1,600**. The comment carries a swept comparison against 1,200 Cr, so every gang
frequency quoted beside it was measured at a value that is not the one shipping.
Either the constant moved from 16,000 and the prose did not follow, or the prose
was wrong when written.

This is the item's whole argument, already realised: the value and its reasoning
drifted apart while sitting on adjacent lines. It is also the case for keeping
the evidence WITH the constant rather than pointing at it — proximity was not
enough on its own, so the move has to come with a habit of re-deriving.

---

## Diverged pairs — same rule, different values

**A live bug, found independently by two partitions. The station's bounding
cube is 50 for the player and 40 for every NPC.**

- `docking.ts:165` `HULL_BOX_MARGIN = 50`, with the measurement beside it: the
  Coriolis reaches 160 against a 160 slot plane, and the Dodo's five tallest
  vertices reach **243 against a 196 one**. "50 clears both, which is what 'a
  little larger than the hull' has to mean if a ship is not to slip past a
  vertex and be reported clear."
- `world-step.ts:404` passes `world.stationDockZ + 40` to `npcsVsStation` — a
  bare literal, no comment, the same axis-aligned cube test in `collisions.ts`.

196 + 40 = 236, and the Dodo's tallest vertices are at 243. **NPCs fly through
the Dodo's hull and are reported clear.** The Coriolis is unaffected (160 + 40 =
200 ≥ 160), which is why nobody has seen it — the Dodo only appears at tech
level ≥ 9. 50 is right, by the only measurement anyone took. Fixing it is a
behaviour change: NPC traffic near a Dodo will start bouncing where it did not.

**"Reachable on a full tank" is 68, 70 and 70.** `contracts.ts:44` filters
contract destinations at `d <= 68`; `living.ts:101` builds trade-partner lists
at `d <= 70` under a comment reading "Ships have a 7 LY jump range";
`commander.ts:20` `MAX_FUEL = 70` is that range. 70 is right — it is what the
fuel enforces. Correcting 68 widens the bulletin board, so it lands separately.

**The torus multiplier is 7 in the physics and 8 in three other places.**
`world-step.ts:294` adds `speed * 7 * dt` **on top of** the `speed * dt`
`player.update()` already applied, so travel is 8×. `game.ts:1379` sizes dust at
`speed * 8`; `command-help.ts:128` captions it "8×"; `starfield.ts:48-51`
justifies `FADE_IN`/`FULL` with "8 x 400 = 3200", hard-coding both the
multiplier and the top speed. Correct today only because 7 + 1 = 8.

**"Just outside the slot" is 420, 450 and 900.** `world-step.ts:642` bounces a
fluffed docking to `station + 420`; `station.ts:46` `LAUNCH_STANDOFF = 450`;
`world/system-scene.ts:71` parks the docked camera at `slot * 900` under a
comment claiming it is the launch point, which stopped being true when
`LAUNCH_STANDOFF` was introduced. The bounce leaves you nearer the hull than the
bay ever does.

**The stranded hint is 2 seconds the first time and 8 thereafter.**
`state.ts:142` vs `world-step.ts:544`. Probably deliberate; nothing says so.

**The thargon redeploy timer is 5 in `encounters.ts` and 4 in `game.ts:678`.**
Same field, two values, no stated reason.

---

## Duplicated pairs — same meaning, same value, two definitions

- **`MAX_TRADERS = 4`** — `encounters.ts:43` and `population.ts:41`. Confirmed
  one rule over one population measured one way. **Owner: population** — it is a
  property of what a system holds, not of the clock that adds to it.
  (`MAX_THARGONS = 4` on the next line is a different rule at the same value.)
- **`daysForJump` re-inlined.** `navigation.ts:74` exists *because* this was
  duplicated in `game.ts` and `test/campaign.ts`; `living.ts:184` is a fourth
  home.
- **`chartDistance` re-inlined.** `living.ts:363` is byte-identical to
  `navigation.ts:27` `distanceTenths`, doc sentence included — a fourth home for
  the file whose header lists the three it consolidated.
- **"Enough fuel to jump clear" = 10, three times.** `WITCHSPACE_ESCAPE_COST`,
  `world-step.ts:541`'s stranded gate, `game.ts:1244`'s rescue floor.
- **Cargo capacity 35/20, four homes.** `commander.ts:89` `cargoCapacity()`,
  `threat.ts:86`, `threat.ts:218`'s `> 20`, `shop.ts:80`'s label.
- **`VALUE_PER_TONNE = 4`** says in prose that it must equal `markOf`'s
  multiplier; `threat.ts:80` writes `* 4`. Enforced by nothing.
- **`BREED_INTERVAL = 20`** and `state.ts:140` `trumbleTimer: 20`. The
  neighbouring `autoSaveTimer` correctly imports `AUTOSAVE_INTERVAL`.
- **`FLUCTUATIONS = 256`** and `randomInt(256)` twice in the same file.
- **`PLAYER_SPEED_KEPT` and `NPC_SPEED_KEPT`**, both 0.3, adjacent, sharing one
  doc comment that speaks of them as one rule.
- **The camera** `PerspectiveCamera(60, 1, 1, 1_000_000)` verbatim in
  `render-stack.ts:52` and `shell.ts:92` — and the headless shell exists to
  prove the seam is real, so a drift there would make the proof false.
- **The pretend viewport** `{width: 1280, height: 720}` in `inert-dom.ts:94` and
  `shell.ts:108`.
- **Object design ids.** `registry.ts:88` `OBJECT_DESIGNS` exists so that "a
  canister is design 4" is written once; `npc-energy.ts:78` writes 2, 4, 6 and
  15 again.
- **The Cobra Mk III design number**, `ship-specs.ts:46` and
  `npc-energy.ts:86`, both 10, held together only by a test.
- **Bulk cargo lists.** `contracts.ts:56` and `spawning.ts:116` are both
  `[0,1,4,8,9,12]`; `combat.ts:41` adds Furs. All three mean "ordinary goods".
- **The tow takes three days, twice**, on adjacent lines (`game.ts:1249-1250`).
- **`'elite-web-keymap'`** is `PLAYER_NS + 'keymap'` spelled out.
- **The laser trade-in refunds** 4000 and 10000 are `EQUIPMENT_CATALOGUE`
  prices, copied.

---

## Relationships that should be expressions

- **`STATION_PRESENTATION_SCALE = 4` is `SOURCE_UNITS_PER_WORLD_UNIT` written
  out again, and its comment says so in English**: "4 is exactly the factor that
  cancels the conversion." Move the geometry anchor off the Cobra and stations
  silently stop being 1:1.
- **Every `IMPACT` number is a stated percentage of a stated anchor, computed by
  hand.** `ram.ship = 44` is "45% of the Cobra's 98-point bank";
  `ram.commander = 115` is "the same 45% of the 255-point shield face";
  `canisterOnHull = 15` is 6%; `stationScrape = 230` is 90%. The test re-derives
  the *anchor* from the catalogue but not the products, so a re-import moving
  the Cobra's bank to 100 passes and leaves `ram.ship` meaning 44%.
- **`FAME_FULL = 2560` is the rating ladder's `Dangerous` threshold**, and
  `threat.ts:28` says so in words.
- **`HARMLESS_POLICY`'s two banks are copied catalogue values** — rock hermit
  240 ("what a Coriolis carries"), generation ship 252 ("the Anaconda's bank").
  The 240 may already be wrong: it matches the *Dodo*'s recommended default.
- **`ECM_ENERGY_COST = round(MAX_ENERGY / 4)`** is "one bank", and
  `ENERGY_BANKS = 4` exists — the same 4, one of them named.
- **The government scale top, 7**, is a bare literal in `threat.ts`, `living.ts`
  (three times), `population.ts` and `galaxy.ts`. It is
  `GOVERNMENT_NAMES.length - 1`.
- **`COMMODITY_COUNT = 17`** hard-codes `COMMODITIES.length`, and saved pressure
  arrays are sliced to it.
- **`world-step.ts:424`'s pirate-wave warp-in at 9000** is almost certainly
  `PLAYER_INTEREST_RANGE`; `spawning.ts:222` cites the same 9,000 in prose.
- **`ui/screens.ts`'s `fuel / 4`** is the inverse of `navigation.ts:30`'s `4 *`,
  in a spot whose own comment records it having been wrong once already.
- **`FLIGHT_RING × AUTOSAVE_INTERVAL` = "the last minute of flying"** —
  `save-file.ts:45` reasons from a cadence it cannot see.
- **`SIGHT_Y = 0.42` must match `#crosshair { top: 42% }` in `style.css`**, and
  says so in capitals. CSS cannot import from `src/constants/`; this is the
  hardest single case and needs a runtime `setProperty` or a gate.

**Reasoning that cites another file's value by transcribed number** — six
places that will go stale silently, and which must become references when the
comments move: `save-file.ts:36`, `input.ts:53`, `player.ts:52-56`,
`docking.ts:11`, `jettison.ts:29`, `starfield.ts:48`.

**Four doc comments already separated from their constant:** `threat.ts:57-63`
holds `MAX_CONTRACTS`' full justification while the constant sits bare at
`contracts.ts:390`; `threat.ts:31` holds `CONTRABAND`'s; `station.ts:50-56` and
`commander.ts:45-47` have doc comments with no declaration under them at all.

---

## Coincidences — same value, genuinely different rules. Do not fuse.

- **255**: `MAX_ENERGY`, `MAX_SHIELD`, and `IMPACT.energyBomb.ship` — the last
  deliberately "the top of the byte scale", not "the size of a bank".
- **220**: `ACCEL` (acceleration), `CC_MAX_SPEED` (speed), `BREAK_OFF_RANGE`
  (distance), `ASSUMED_TARGET_SPEED` (speed), explosion debris speed.
- **4**: `MAX_TRADERS`, `MAX_THARGONS`, `MAX_MISSILES`, `VALUE_PER_TONNE`,
  `ENERGY_BANKS`, `NOTICEABLE`, `LEGACY_MAX_ENERGY`, `FACE_STRIDE`,
  `SOURCE_UNITS_PER_WORLD_UNIT`. The last two ARE one rule; the rest are not.
  `LEGACY_MAX_ENERGY = 4` and `ENERGY_BANKS = 4` are the trap: historically the
  same fact, now permanently different, because a save on disk depends on one.
- **20**: `AUTOSAVE_INTERVAL`, `BREED_INTERVAL`, `HERMIT_ORE_GLUT`,
  `MAX_NAMED_SAVES`, the beacon timer, the small hold, `daysForJump`'s divisor.
- **9000**: `DEFENCE_RANGE` and `PLAYER_INTEREST_RANGE` — and
  `player-interest.ts:29-32` already states outright that they are different
  questions and must not be unified. **This is the model for how every entry on
  this list should be recorded.**
- **6000**: `HUNTER_SCATTER`, the generation-ship notice range, and (other
  partitions) `SCANNER_RANGE`, `PIRATE_HUNT_RANGE`, `HUNTER_RANGE`. The hunter
  scatter sitting at scanner range may not be a coincidence — for phase 2.

---

## What will make the move hard

1. **Node-direct modules.** `contracts.ts`, `commander.ts`, `law.ts`,
   `rating.ts`, `threat.ts`, `shop.ts`, `navigation.ts`, `living.ts` and
   `galaxy.ts` are loaded directly by node for `test/campaign.ts`. A constants
   module they import must be erasable TypeScript with explicit `.ts`
   extensions and **must not drag in three.js** — `spawning.ts`, `world.ts`,
   `cargo.ts` and `docking.ts` all import three, so one flat shared module
   would poison the campaign harness.
2. **Cycle history is real.** `world/slot.ts` exists only because importing the
   slot normal from `spawning.ts` created a cycle; `chart-state.ts` exists
   because `ui/screens.ts` dragged save state into four of five import cycles.
3. **Save-file dependencies.** `SAVE_RECORD_VERSION`, `SNAPSHOT_VERSION`,
   `SAVE_ID_PREFIX`, `PLAYER_NS`/`HARNESS_NS`, `MAX_SAVE_NAME` (baked into
   stored ids), `FLIGHT_RING` (shrinking it orphans keys nothing can address),
   and `COMMODITIES.length` (the length of every saved cargo array). The
   `LEGACY_*` values are migration data — inert for live play, load-bearing for
   old saves, and they need a namespace that says so. **Never `POOLS`.**
4. **`storage.ts`'s namespace strings should probably NOT move.** Its header
   argues that no expression in the program may be able to name an old key, and
   `useHarnessSaves()`'s one-way guarantee depends on `ns` being module-private
   mutable state. Moving it into a module anything can import breaks that
   argument structurally.
5. **Draw order is the determinism.** Naming `randomInt(256)` as
   `randomInt(FLUCTUATIONS)` is safe; hoisting a draw to a module-level constant
   is not.
6. **Non-TypeScript homes.** `SIGHT_Y` ↔ `style.css`, and `keymap.ts`'s element
   ids ↔ `play.html`. The gate will need to skip these or read the CSS.

---

---

# The combat partition

## The most dangerous fusion in the codebase — do not unify these

`npc.ts:54` `BRAIN_RATE_RAMP = 4.1396` and `player.ts:66` `RATE_RAMP = 4.1396`
are **identical to seven digits and are not the same rule.** Both were
recalibrated from 4.0 when the ramp went exponential, so they agree by history,
not by design. The player's is a feel setting. The NPC's is **what every shipped
brain was fitted at.** Retune the human's and drag the NPC's with it and every
policy is out of distribution with nothing going red — a brain is a save file
that does not tell you when you have broken it.

Their decays already differ (13.3886 vs 5.2207), which is the evidence that they
are two rules. **This must be written down loudly beside both**, and it is the
single strongest argument for the by-meaning rule: a pass that unified identical
values would silently destroy the AI.

Pinned the same way, and equally invisible: `MIN_CRUISE_FRACTION` (g3 was
trained where stopping does not exist), `TARGET_SPEED_FLOOR`, the four `CC_*`
caps, `TURN`, `ACCEL_FRACTION`, and `NpcShip.meView.laserTemp` staying zero
(obs slot 1 is always 0 in the game; filling it truthfully is a retrain).

## Diverged pairs

**Every ship's first attack run is flown at the top of the band, not its
middle.** `break-off.ts:181` derives `EXTEND_RANGE = (MIN + MAX)/2 = 675` and
its comment says why: *"the MIDDLE of the band it defaults for, because that is
the only honest thing a default can be. It was left at 900 when the band came
down to 500-850… exactly the kind of number that stops being harmless the day
somebody adds a caller that does not [pass its own]."* `npc.ts:534` initialises
that very field to `EXTEND_RANGE_MAX` = **850**. It is live from frame one:
until a ship first reaches `extending` and re-rolls, both `nextAttackPhase` and
the aim branch read 850. The comment anticipated this failure and it had already
happened.

**One defence policy, one input, three treatments.** `combat-computer.ts` spends
12 lines on the hazard of pinning a target's speed, and now writes the real one:
`this.target.speed = threat.state.speed`. `npc.ts:699-708` — the armed trader
flying the *same* `jameson-defend-g2` weights — still passes bare literals
**300** and **260** into that observation slot. 260 is a pirate Cobra's top
speed and 300 a Sidewinder's; neither is what the ship in front of it is doing.
Directly relevant to TODO 85 and 86.

**`CC_ACCEL = 100`; the hull it claims to fly accelerates at 101.2.**
`combat-computer.ts` derives its pitch and roll caps from `TURN` so they "cannot
drift away from the hull they name", then writes the accel as a literal. The
trader Cobra's `220 × ACCEL_FRACTION` is 101.2. Small, and exactly the shape.

**Three derivations whose arithmetic no longer produces the shipped value.**
`tactics.slash.missDistance = 175`, stated as "1.6× the standard pass" —
`110 × 1.6 = 176`. `extend-arc.ts` `CLEAR_RANGE = 340`, stated as
`BREAK_OFF_RANGE` "and half again" — `220 × 1.5 = 330`. `combat-sim-opening.ts`
reasons twice about a `PASS_FAR` of **900** when it has been **600** since
TODO 67. Anyone who "tidies" the first two into expressions moves behaviour by 1
and 10 units.

## Duplications and unexpressed relationships

- **`LASER_RANGE` and `NPC_LASER_RANGE`**, both 3500. Settled by reading:
  `NPC_LASER_RANGE`'s comment says *"Matches the player's `LASER_RANGE` above,
  and it has to"*, with the measurement from when they did not. Same rule,
  written twice. `NPC_HIT_FALLOFF = 3500` is the third and is a *denominator*,
  not a gate — `NPC_HIT_FLOOR` binds first at 2,625, so the curve floors at 75%
  of the gun's reach. Whether that is intended is unstated.
- **`ECM_ENERGY_COST = round(MAX_ENERGY / 4)` and `LOW_ENERGY =
  round(MAX_ENERGY / ENERGY_BANKS)` are the same expression written twice**,
  both 64. `systems.ts` promises that changing `ENERGY_BANKS` moves the gauge,
  the warning and the shield cut-off together; the E.C.M.'s price would not
  follow.
- **`FAME_FULL = 2560` is the rating ladder's `Dangerous` rung**, said in prose,
  enforced by nothing.
- **The 10 Hz decision interval** — named in `combat-computer.ts`, a bare `0.1`
  in `npc.ts:914`.
- **The seed stride `101` has three homes**, one of which says *"the same 101
  stride `resolve()` gives a table's groups"* — the author knew and wrote it
  again. Its sibling `SHIP_SEED_STRIDE = 7` is a named constant with one home.
- **`WAVE_STEP_EVERY = 2` is meant to be `WAVE_COUNT_EVERY`**; the doc says so
  twice. One is exported, one is private, both are 2.
- **`CLOSING_THROTTLE_MIN = 0.45` is defined against `MIN_CRUISE_FRACTION`'s
  0.43**, quoted as a number in two other files' comments.
- **`threat.ts` has 9 named and ~18 unnamed tuning values**, and
  `npm run campaign` is tuned against all of them.

---

# The UI partition

## The HUD leads every target as though it were a freighter

`hud-model.ts:218` `ASSUMED_TARGET_SPEED = 220` is not a stale copy of anything
— it is a guess standing next to the live value. The lead marker computes
`forward × 220` for **every** locked ship, and the roster says: Sidewinder 300,
Krait 290, Mamba 310, Fer-de-Lance 330, Viper 320, Thargoid 300, Thargon 350,
Constrictor 370. **It under-leads a Fer-de-Lance by 33% and a Thargon by 37%.**

`npc.state.speed` is public, in scope at the call site, and documented as
existing so a shot can be led. `npc.ts:1306` already has `velocityOf(quat,
speed)` — the identical expression the HUD open-codes with a constant. This is a
live aiming bug, it lands separately, and CLAUDE.md says fly it before tuning it.

## CSS — RULED OUT OF SCOPE, 2026-08-04

Chris: *"Ignore the CSS, we care about game constants."* Recorded here because
the survey found it and the next reader will otherwise re-find it:

`SIGHT_Y = 0.42` and `style.css`'s `top: 42%` each carry a comment saying it
MUST match the other. `#4dff5c` has at least 14 homes in 3 spellings. The
encyclopaedia uses a different green and amber. Two of its greens have leaked
into `style.css`. **All of this stays.** `SIGHT_Y` moves as a game constant and
its CSS twin remains a deliberate, recorded duplication.

The two patterns that already bridge the boundary correctly — `--sight-r`
computed at boot from `AIM_ASSIST`, and `--chart-side` passed in from
`LOCAL_CANVAS` — are untouched and remain the template if this is ever reopened.

## TODO 50 left a home behind

`keymap.ts`'s header says the manual renders from `LAYOUTS` so a binding
"cannot drift". Twenty lines later, `refreshHelpPanel()` writes the same layouts
out by hand: `'S / X · ↑ / ↓'`, `'A / D · ← / → · , / .'`, `'A (or F)'`. Two
homes, one file, in the file whose whole argument is that there is one — and
TODO 50 was the item that claimed to reduce key bindings from six homes to one.

## Two gauge thresholds that guess at a rule they could read

`hud.ts:226` reddens the laser bar at `> 0.8`; the gun actually cuts out at
`LASER_CUTOUT = 0.98`. `hud.ts:229` reddens the cabin bar at `> 0.72`; you die
at `0.99`. Neither is named, neither states a relationship. The energy gauge next
to them is correct by contrast — `energyBanks` and `energyLow` arrive already
decided from `systems.ts`, with a comment recording that a third opinion once
disagreed at exactly 64.

## More prose copies of live constants

`audio.ts:159`'s countdown pitch `700 + (5 - n) * 100` hard-codes
`hyperspace.ts`'s `COUNTDOWN`; change it to 6 and the first blip drops to 600 Hz.
The briefing says "7 light years on a full tank" (`MAX_FUEL`), "100 credits"
(twice, and `newCommander` gives 1000 tenths), "six pages" (`BRIEFING.length`),
and `starfield.ts` justifies its fade thresholds with "max ship speed is 400" —
a value that is module-private in `player.ts`.

## The good examples, worth copying

`ui/screens.ts` prints "ATTACK RUNS (IN 400, OUT 600)" from `PASS_CLOSE` and
`PASS_FAR` rather than typed digits. `--sight-r` is computed from the rule.
`MIN_OPENING_RANGE = 2 * PASS_FAR`. The docking aid imports `inSlotChannel`
after a period when it hardcoded the channel and disagreed with the dock test.

## A rule for what counts, forced by this partition

`hud.ts` is 559 lines and roughly a third is inline layout arithmetic with no
names — bracket geometry, arrow polygons, scanner ring fractions. Admitting all
of it would move a hundred single-use numbers into a namespace and make the
drawing unreadable; admitting none leaves the file as it is. **The proposed
rule: admit anything a second surface also needs to know, or that encodes a game
rule; leave pure drawing geometry where it is, as a stated exclusion.**

---

# The training partition

## The biggest divergence in the survey: a pirate brain sees a different target speed in training than in the game

The game floors it. `brains.ts:135` `TARGET_SPEED_FLOOR = 150`, applied at
`brains.ts:236` as `targetSpeed: (a) => Math.max(TARGET_SPEED_FLOOR, a)` and
consumed at `npc.ts:674`.

The trainer does not. `scenario.ts:954` passes `this.trader.speed` raw.
`TARGET_SPEED_FLOOR` is imported by **nothing** in `train/` or
`src/ai-training/`.

It lands on `observation.ts:179`, `out[10] = target.speed / 400` — the input
`brains.ts`'s own comment says *"the policy has latched onto"*. Against
`playerCobraSlow` (ceiling 90) or `holding` (brakes below 60), a training pirate
reads slot 10 anywhere from 0.00 to 0.225. **The same brain against the same
commander in the game reads at least 0.375.** Two of the four target speeds
`flies()` samples are unreachable in the live game.

This is docs/TODO/71's shape inverted: there, a constant the trainer could not
see; here, a correction the game applies and the trainer does not.
`combat-computer.ts` records the identical trap on the defence side and calls
the surviving constant "the divergence rather than the protection". Nobody has
written that sentence about this one.

**It needs a decision, not a lookup.** Either the floor is a real game rule and
the trainer must apply it — in which case every pirate brain was fitted in a
world that does not exist below 150 — or it is a patch for the brain being out
of distribution at low speed, and `brains.ts`'s own stated honest fix applies:
*"deleting the input entirely is the honest fix and costs a retrain of every
brain."* Its own behaviour change either way.

## The trial harness still pins what the combat computer un-pinned

`jameson-autopilot.js:83` sets `tgView.speed = 280` and `combatStep` never
writes it again — 280 for the whole trial. `combat-computer.ts:118-127` removed
exactly this pin two TODOs ago, saying the constant "is what would put the
shipped policy out of distribution". **Every figure in docs/JAMESON-TRIALS.md
produced since `jameson-defend-g2` shipped was flown with the defence policy out
of distribution on slot 10.** One line fixes it, and it invalidates the trials.

## Two probe files each claim the other's seed base does not exist

`flight-probe.ts:80` `PROBE_BASE = 30_000_007` — *"distinct from every other
base in the project."* `gap-probe.ts:57` `GAP_PROBE_BASE = 30_000_007` —
*"IMPORTED rather than re-picked."* It is not imported; it is a second literal,
and `gap-probe.ts` imports nothing at all from `flight-probe.ts`. **Both
comments are false, in opposite directions**, and either would have caught the
other if read together.

## The rejection gate carries a fossil of a bug the codebase believes it fixed

`evolve.ts:529` hard-codes the commander's envelope as `[400, 1.036]`.
`scenario.ts:243-247` documents 1.036 as a bug that was FIXED — the deleted
simulator "stored the pitch cap as a rounded quotient (1.036 × 1.4 = 1.4504
against 1.45)". The true value is `1.45 / 1.4` = 1.0357142857…. It survives in
`flies()`, the one function that decides whether a champion is thrown away. It
is inert today only by accident (no encoder reads a *target's* `cls`).

## More copies

- **The log-distance encoding is written out three times** in one file
  (`observation.ts:175, 259, 330`), feeding three different brains. If the
  floor, the decade base or the ceiling moves in one, every genome silently
  reads a different geometry from the one it was fitted on.
- **`TURN.pitch` and `TURN.roll` are literal `1.4` and `2.4`** in
  `observation.ts:180-181` — and `ship-specs.ts` records that `TURN` was moved
  *out* of `ai-training/` precisely so the two could not disagree. These are the
  residue. Free fix, highest value per line in the partition.
- **The seed stride `7919` has eight homes**, and `defence-fight.ts` reasons
  arithmetically about it from a ninth place without being able to import it.
- **The episode clocks 45 and 60 have ten homes between them.**
- **The 10 Hz decision rate has three code homes and a fourth in prose.**
- **`DEFENCE_POOLS_KEPT + DEFENCE_ATTACKERS_BROKEN = 1`** — the comment states
  the constraint, the code writes two literals.
- **`durability(true)` as `765`**, three times in the trial harness, which
  already dynamically imports five modules.
- **`EPISODE_SECONDS` is defined three times: 45, 45 and 70.** Both values are
  right and the 70 has a stated reason; the name colliding is the hazard.

## Two prose figures that are simply wrong

`scenario.ts:820` claims the trainer flies the game's "25-second life" —
`MISSILE_LIFE = 25` is the *player's*; every warhead in an episode is hostile
and lives 30. And `defence-fight.ts:60` quotes the combat computer at "20,000
credits" and the energy unit at "15,000" when `shop.ts` states prices in tenths:
they are 2,000 Cr and 1,500 Cr. The argument survives; the figures are 10× out.

## What the trainer gets right, and it is a lot

Sixteen constants and rules are imported rather than copied — `FIXED_DT` (was
`1/15`, a whole different world), the fire resolver, `IMPACT`, `regenerate`,
`hitFromAhead`, `npcTriggerPull`, `npcHitChance`, `LASER_RANGE`/`hitCone`,
`npcCrossfireDamage`, the ram geometry, the target's whole envelope,
`memberTier`, `BREAK_OFF_RANGE`, `PASS_CLOSE`/`PASS_FAR`,
`defenceBrainNameFor()`, and the `CC_*` constants via a **dynamic** import from
a console paste. Every one was a divergence at some point. The pattern works
when it is applied.

## Where trainer constants may live — the gate constrains it

`npm run portability` reports **0 contaminated** today and `src/ai-training/` is
clean. The gate walks `src/` only, so:

- `src/constants/` must import nothing, or contamination propagates through the
  import edge — `npc.ts` and `combat-computer.ts` already import
  `ai-training/policy.ts` and `observation.ts`, so the dependency runs both ways
  and anything reachable from one side is reachable from both.
- If the three 6000s are unified, **the home must not be `hud.ts`** — `hud/` is
  on the PLATFORM list, and one such import would take the trainer from 0
  contaminated to non-zero in a single edit.
- The answer to "do `train/` and `tools/` join" is **asymmetric**: `train/`
  should consume `src/constants/` and contribute its game-mirroring constants to
  it, while its search hyperparameters, seed bases and probe thresholds belong
  in a `train/constants.ts` that nothing in `src/` may import. `tools/` is a
  separate world and should stay one.
- `observation.ts` deliberately uses structural `V3`/`Q4` rather than
  `THREE.Vector3`. A constants file with a three-typed helper in it would give
  the encoders a dependency they do not have.

**The equivalence proof for this partition is cheap**: `Episode` seeds the world
PRNG in its constructor, so a seeded `probeEpisode` before and after must return
byte-identical `report()` output. One constraint — episodes must be run one at a
time, never interleaved, or the dice braid and the proof means nothing.

---

## Decisions for Chris, before any code moves

1. **The Dodo collision box.** Confirm 50, and that NPC traffic bouncing near a
   Dodo where it previously did not is the intended correction.
2. **Contract range 68 → 70**, which slightly widens the bulletin board.
3. **Five flat constants shadow per-hull catalogue fields** now that
   `CommanderData.shipId` resolves to a hull carrying all of them:
   `MAX_MISSILES` vs `maxMissiles`, `cargoCapacity` 35/20 vs
   `cargoHoldCapacity`, `MAX_FUEL` vs `hyperspaceRangeLightYears`,
   `MAX_ROLL`/`MAX_PITCH` vs `maxPitchRollRate`, `MAX_ENERGY`/`MAX_SHIELD` vs
   the hull's three capacities. Only the last two are argued anywhere as
   deliberate Harmless policy. This is a design question — it decides whether a
   shipyard is possible — not a refactor.
4. **`PRIZE_SATURATION`**: is the value wrong or the comment?
5. **`TARGET_SPEED_FLOOR`** — the training partition's D1, and the biggest of
   the lot. Is the floor a real game rule the trainer must apply, or a patch for
   an input that should be deleted? `brains.ts` already says which it thinks.
6. **`ASSUMED_TARGET_SPEED`** — confirm the HUD should lead on the target's real
   speed. The marker moves, so it wants flying before it is tuned.
*(CSS and the two palettes were decisions 7 and 8. Ruled out of scope
2026-08-04 — see above.)*

## Behaviour changes that must land on their own, never inside the move

The Dodo collision box · contract range 68 → 70 · `EXTEND_RANGE` 850 → 675 ·
`ASSUMED_TARGET_SPEED` → the real speed · the trainer's target-speed floor ·
`jameson-autopilot`'s 280 pin · `slash.missDistance` 175 → 176 ·
`CLEAR_RANGE` 340 → 330 · `CC_ACCEL` 100 → 101.2.

Each is a real change to what the game or the trainer does. Several invalidate
measurements: the trials, the defence figures, the campaign's tuning.

Three of them have an answer already written in the code and need no decision —
the Dodo box (50 is the only measured value), `EXTEND_RANGE` (`break-off.ts`
argues the midpoint), and the `280` pin (`combat-computer.ts` already removed
its twin and said why). Two are genuine questions for Chris: the trainer's
target-speed floor, and whether the HUD should lead on the real speed.
