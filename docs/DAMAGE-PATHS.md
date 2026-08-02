# The damage-path inventory

Every way anything in HARMLESS can be hurt, what unit it is spent in, who owns
the number, and whether the number is the released game's or ours.

It exists because the alternative is unanswerable. Before TODO 28 the project
ran **three** damage scales at once — a ship's released energy bank, the
commander's 255-point pools, and a pre-parity normalized "fraction of a Cobra"
that a ram, a warhead, a canister and an NPC's own gun all still spoke — joined
by two conversion functions that could turn any float into either unit. Correct
laser rules sat next to that and looked fine. This table is what makes "which
numbers are in which units" a question with an answer, and
`test/damage-paths.test.ts` asserts the table against the code rather than
trusting it.

**Two units, and only two** (`src/game/damage-units.ts`), both whole numbers on
the released byte scale, both branded so one cannot be spent as the other:

| unit | what it comes off | range |
| --- | --- | --- |
| `NpcEnergyPoints` | a ship's or object's released energy bank | 2 (the missile) to 255 (the heaviest Dragon build) |
| `PlayerPoolPoints` | the commander's 255-point facing shield, then the 255-point bank | 0–510 to strip both |

**The old normalized scale is gone.** It survived TODO 28 in one place — the
training episode's stand-in target — and TODO 29 closed it: an episode's target
is the commander, with `game/systems.ts`'s three 255-point pools, hit by
`applyDamage` for `npcLaserDamageToPlayer` points off the firing build's own
packed byte. `TARGET_DAMAGE_LO`, `TARGET_DAMAGE_SPREAD`, `VICTIM_RAM_DAMAGE`,
`targetShotDamage` and `targetHullForPoolPoints` no longer exist anywhere, and
`test/damage-paths.test.ts` asserts that none of the five comes back. There are
now exactly two damage scales in the project and both are the released game's.

## The inventory

| # | source | target | old unit | new unit | owner | backing |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | player laser | NPC / object | source points | `NpcEnergyPoints` | `npc-energy.ts` `playerLaserDamage` → `elite-a/combat-math.ts` | **source** — `(byte & 0x7f) >> 1`, times the target's multiplier, less `maxEnergy & 7` |
| 2 | NPC laser | commander | source points | `PlayerPoolPoints` | `gunnery.ts` `npcLaserDamageToPlayer` → `elite-a/combat-math.ts` | **source** — `laserPower << 2`, less the hull's `perHitShieldArmour` |
| 3 | NPC laser | another NPC | normalized `0.11` flat | `NpcEnergyPoints` | `npc-energy.ts` `npcCrossfireDamage` → `elite-a/combat-math.ts` | **source halves, Harmless composition** — the pack tabulates the two player-facing directions only, so this is the attacker's own `laserPower << 2` less the defender's own `maxEnergy & 7`. No third arithmetic. |
| 4 | player missile warhead | NPC | "certainly fatal" (99 normalized) | `NpcEnergyPoints` 250 | `impact-damage.ts` `IMPACT.warhead` | **Harmless policy** |
| 5 | NPC missile warhead | commander | normalized `1.3` | `PlayerPoolPoints` 250 | `impact-damage.ts` `IMPACT.warhead` | **Harmless policy** |
| 6 | energy bomb | every NPC in range but a Thargoid | "certainly fatal" (99 normalized) | `NpcEnergyPoints` 255 | `impact-damage.ts` `IMPACT.energyBomb` | **Harmless policy** |
| 7 | ship↔ship collision | both ships | normalized `0.45` | `NpcEnergyPoints` 44 | `impact-damage.ts` `IMPACT.ram` | **Harmless policy** |
| 8 | player↔ship collision | commander | normalized `0.45` | `PlayerPoolPoints` 115 | `impact-damage.ts` `IMPACT.ram` | **Harmless policy** |
| 9 | canister on an unscooped hull | commander | normalized `0.06` | `PlayerPoolPoints` 15 | `impact-damage.ts` `IMPACT.canisterOnHull` | **Harmless policy** |
| 10 | Coriolis wall / fluffed slot | commander | normalized `0.9` | `PlayerPoolPoints` 230 | `impact-damage.ts` `IMPACT.stationScrape` | **Harmless policy** |
| 11 | player laser | drifting canister / escape capsule | none — deleted on any hit | `NpcEnergyPoints` off an 8-point bank | `cargo.ts` `takeLaserHit` → same oracle as row 1 | **source** — designs 4 and 2 |
| 12 | player laser | station (Coriolis, Dodo, rock hermit) | none — sparks only | none — `laserImmune` | `npc-energy.ts` policy field | **source** — `laserImmune`, and Harmless policy for the hermit overlay |
| 13 | ship↔station collision | neither | none | none | `collisions.ts` `npcsVsStation` | Harmless: a bounce only, deliberately — damage here would kill docking traffic at random |
| 14 | docking, successfully | neither | none | none | `docking.ts` / `world-step.ts` `checkStation` | a clean dock costs nothing; a bad one is row 10 |
| 15 | sun proximity (cabin heat) | commander | none | none — **outcome, not damage** | `systems.ts` `updateCabinTemp` | Harmless: `cabinTemp >= 0.99` ends the run outright; it never touches a pool |
| 16 | flying into the sun | commander | none | none — outcome | `world-step.ts` `SUN_KILL_DIST` | Harmless |
| 17 | flying into the planet | commander | none | none — outcome | `world-step.ts` `checkHazards` | Harmless |
| 18 | E.C.M. discharge | commander's own bank | `1` of 4 | `PlayerPoolPoints`-scale 64 (`ECM_ENERGY_COST`) | `ordnance.ts` / `game.ts` | Harmless: a **cost**, not damage — it is spent, never applied through `applyDamage`, and it cannot destroy the ship |
| 19 | missions (Constrictor) | — | — | — | `missions.ts` | no damage of any kind: it pays a bounty on a kill resolved by rows 1/4/6 |
| 20 | headless campaign | — | — | — | `test/campaign.ts` | flight is abstracted; it never applies damage |
| 21 | combat simulator | commander and opponents | — | rows 1–10, unchanged | `combat-sim.ts` via `exerciseStepHost` | it flies the **real** step; there is no simulator damage model |
| 22 | training episode → pirate | a real `NpcShip` | normalized, converted | `NpcEnergyPoints` (rows 3 and 7) | `ai-training/scenario.ts` | as the live game |
| 23 | training episode → its target | the episode's `TargetShip` | normalized | `PlayerPoolPoints` (rows 2 and 8) | `ai-training/scenario.ts` → `gunnery.ts`, `impact-damage.ts`, `systems.ts` `applyDamage` | **as the live game** — TODO 29. The target holds `freshSystems()` and takes `npcLaserDamageToPlayer` points on the facing shield. One thing is deliberately absent and stated in the file: the pools do NOT recharge, because a shield face recovers 8.9 points a second against a gang's two, and an episode with regeneration in it carries no gradient at all. |
| 24 | debug / console | — | — | — | `console.ts` | the handles are write-only: `__game`, `__policyKit`, `__simLog`. Nothing there applies damage. |
| 25 | in-flight missile as a target | — | — | none | — | Harmless **cannot** damage a missile in flight: `shot.ts` traces ships, cargo and the station only, and the E.C.M. destroys missiles outright. The pack's profile for design 15 (2 energy, 2 defence) is available the day it becomes a target. |

## The one Harmless rule

Rows 4–10 are the paths where the released source says nothing at all. They
share one named rule, stated in `src/game/impact-damage.ts` and recorded in
`docs/GAP-ANALYSIS.md`:

> An impact costs a **fixed whole number of source points**, stated separately
> for a ship's energy bank and for the commander's pools, and is spent on
> whatever it hits without asking what that is.

Two columns rather than one, because the two banks are not comparable: a
released ship carries 2 to 255 energy, and the commander carries a 255-point
facing shield in front of a 255-point bank. Fixed points rather than a share of
the target, because a hull's size is meant to be worth something — a 44-point
scrape is a third of a Sidewinder and a sixth of an Anaconda.

**The anchors**, both the Cobra Mk III, and both re-derived from the catalogue by
`test/damage-paths.test.ts` so a re-import cannot leave them stale:

| impact | ship | severity against the 98-point NPC anchor | commander | severity against the 255-point shield face |
| --- | --- | --- | --- | --- |
| `ram` | 44 | 45% | 115 | 45% |
| `canisterOnHull` | — | — | 15 | 6% |
| `stationScrape` | — | — | 230 | 90% |
| `warhead` | 250 | above all but 5 of the 260 released builds (banks 252/253/255) | 250 | flattens a full face exactly |
| `energyBomb` | 255 | above every released bank | — | — |

## What the audit changed, and what it did not

Unchanged in play: the ram, the canister and the station scrape are the same
numbers they have always been, restated in the units they are spent in.

Changed, and deliberately:

- **NPC-vs-NPC laser** was a flat 11 points to anything from anything. It is now
  the firing build's own gun against the target's own defence, so a Thargoid's
  crossfire and a Worm's are no longer identical (row 3).
- **A warhead against a ship** was an unconditional kill. It is 250 points, so
  the five heaviest released builds — the two Anacondas (252), the two Thargoid
  motherships (253) and the `W:29` Dragon (255) — survive one at full energy by
  a sliver, and only an actual kill pays a bounty (row 4). The roster's own
  Dragon is `D:29` at 247 and still dies to one.
- **A warhead against the commander** was 332 pool points; it is 250 (row 5).
- **Shooting a canister** resolves through the oracle against the object's own
  8-point bank instead of deleting it unconditionally. Every laser the Cobra
  Mk III can carry still breaks one in a single hit, so nothing moves today
  (row 11).

## Rules this inventory encodes

- **The Constrictor's halving and a station's immunity are properties of a
  PLAYER LASER**, not of the ship. They live on the target's profile
  (`playerLaserMultiplier`, `laserImmune`) and are read by row 1 alone. Rows 3
  to 10 never see them: `npcCrossfireDamage` deliberately does not consult
  either, and no impact function is even given a target to ask.
- **One rule, one home.** No damage number appears at a call site. Every one of
  them is in `elite-a/combat-math.ts` (source arithmetic),
  `elite-a/*.generated.ts` (source data) or `impact-damage.ts` (ours).
- **Minting is restricted.** Only `gunnery.ts`, `npc-energy.ts` and
  `impact-damage.ts` may call the two point constructors; the test asserts it.
