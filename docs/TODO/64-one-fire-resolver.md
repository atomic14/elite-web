# 64 — One resolver, so the trainer and the game cannot drift

**Kind:** architecture · **Severity:** high · **Size:** large
**Depends on:** 62, 63 (both are symptoms of this)
**Status:** DONE, 2026-08-04 — one row deliberately left open, and it is
docs/TODO/73's.

## Why

Chris, 2026-08-03: *"Training should match the 'real world' otherwise it's
always going to be wrong."*

Items 62 and 63 are two instances of one structural fault, and if only they are
fixed there will be a third. This is the item that stops it.

The project's north star holds for the DECISION half of combat: `NpcShip`,
`gunnery.ts`, `collisions.ts` and `rng.ts` have one home each, and the trainer
calls them. It did not hold for the RESOLUTION half. Invariant 15 splits the
world deliberately — *"NPCs return `FireEvent`s; the Game resolves all
consequences"* — and there were two Games:

| | the game | the trainer |
|---|---|---|
| resolver | `world-step.ts` `resolveNpcFire` | ~~`scenario.ts` `resolveNpcShot`~~ — **same**: both call `fire-resolution.ts` `resolveNpcFire` |
| reads `event.weapon` | yes | ~~no~~ — **closed by docs/TODO/62**, and now not read by either caller: the resolver branches on it |
| spends `state.missiles` | yes | ~~no~~ — **closed by 62**: both call `ordnance.ts`'s `launchNpcMissile` |
| calls `chooseWeapon` | yes | ~~no~~ — **closed by 62**: it is public and takes two scalars |
| regenerates the target | `systems.ts regenerate()` | ~~the gun's half only~~ — **closed by docs/TODO/63**: the episode's target runs the whole rule |
| rolls the laser's dice | `random() < npcHitChance(dist)` | **same** — one line, in the resolver |
| the RANGE those dice read | measured after the ship moved | ~~measured before it moved~~ — **same**: the resolver measures it, and neither caller may pass one in |
| what a hit is worth | `npcLaserDamageToPlayer(byte, hull)` | **same** — one line, in the resolver |
| which shield face takes it | ~~a quaternion inverse in `Combat.hitPlayer`~~ | ~~a dot product in the episode~~ — **same**: both call `shield-face.ts` `hitFromAhead` |
| crossfire (`at: NpcShip`) | `NPC_VS_NPC_HIT`, `npcCrossfireDamage` | **same** — the resolver owns it; an episode never orders one and says so |
| hands over inside `BRAIN_HANDOVER_RANGE` | the scripted break-off | **no, and left open on purpose** — docs/TODO/73 |

Every row after the first was a divergence nobody chose. They were found by
asking one question about missiles; there was no reason to believe the list was
complete, and no mechanism that would have reported any of them.

**The last row is the proof of that.** It was not in this table when the item was
written; doing 62 turned it up, and it is not even about resolving a shot — a
brain-flown pirate in an episode flies its policy to zero range where the game
hands over to `attack()` inside 150 units, so it never completes a pass, never
accrues `passesMade`, and can never take the missile launch that rewards
engaging.

This is the failure CLAUDE.md is organised against, stated in its own words:
**one rule with two homes, kept in step by hope.** It is worth writing down that
the usual defence did not fire — "it uses the same engine" is true, and was the
reason nobody looked.

## What was worked out

### The seam: a narrow interface, not an extracted method

Not "extract `resolveNpcFire`", for the reason the item gave: it reaches for
tracers, sounds, the station, despawn and the commander's equipment, and an
episode has none of them. **`src/game/fire-resolution.ts`** is the rule, and
`FireWorld` is the seam — the same shape as `engine/shell.ts` for the platform,
`StepHost` for the orchestrator and `OrdnanceWorld` as of 62. Four members:

```ts
interface FireWorld {
  target: {
    hullId: PlayerHullId;                                   // the armour a bolt meets
    pos: THREE.Vector3;                                     // the range the dice read
    damage(damage: PlayerPoolPoints, from: THREE.Vector3): void;
  };
  ordnance: Ordnance;                                       // where a round goes
  wreck(npc: NpcShip): void;                                // shot out of the sky
}
```

**Which consequences are rules and which are presentation** is the whole design,
and the split lands here:

| rule — in `fire-resolution.ts` | presentation — left with the caller |
| --- | --- |
| spend the round, put the warhead in the sky | the tracer, and the two `random()` draws that scatter a missed one |
| roll the hit against the range curve | `heard('enemyLaser')` |
| mint the damage from the firing build and the target hull | the `npcFired` report, and the trainer's shots/hits/damage tally |
| pick the shield face (`shield-face.ts`) | the damage flash, the `DamageSource` attribution, the death |
| crossfire: the flat chance, the composed damage, the wreck | the bounty, the despawn, the explosion |

`shield-face.ts` is the smallest piece and the most instructive: one line, and it
had two homes that AGREED. `Combat.hitPlayer` transformed the shooter into the
ship's frame and read the sign of z; the episode dotted the nose against the
direction to the shooter. `forward · v > 0` *is* `v_local.z < 0`, so nothing was
ever wrong — which is exactly why it survived. Neither copy could be changed
without someone remembering the other.

### Why `Episode` is not a `StepHost`, which the item asked to be considered

Seriously considered and rejected, for four reasons, in order of weight:

1. **`NpcShip.update()` picks the SHIPPED brain** (`brains.ts`, via
   `pirateBrainFor`). A training episode is scoring a candidate genome that has
   no name and is not in `SHIPPED_BRAINS`. Flying the real step would mean
   putting a genome into `GameState`, which is the opposite of what
   `state.brains` is — a selection among named, shipped policies.
2. **The target is not the commander.** It is flown from a `FlightDemand` at
   envelopes that are not hers (`traderCobra`), on any of the 15 hulls, by four
   scripted pilots and a policy. `GameState` has one commander.
3. **Cost.** A `WorldStep` frame runs docking, the station, the sun, hazards,
   hyperspace, trumbles, autosave, encounters, cargo and the police scan; an
   episode is 2,700 frames of five ships in empty space, and a training run is
   millions of them. `freshState()` also builds a galaxy, a market and a system
   scene per episode.
4. **It would not have closed this item anyway.** The divergences were in what a
   shot COSTS, and those live below both orchestrators.

What the argument does apply to is the row still open: `NpcShip.update()` is the
only place that composes *pick a flight, then pick a weapon*, and every remaining
divergence is something `update()` does and an episode does not. That is
docs/TODO/73's second bullet, and it is the right next slice.

### What moved, in behaviour

- **The game is byte-identical.** Proved, not asserted — see Verify.
- **The trainer shifted, very slightly, and only from one closed row**: the range
  the hit dice read is now measured at the resolver, after the shooter's own step
  moved it, where the episode used to pass in the range it had measured before
  the flight. Over 120 held-out episodes (40 seeds × three target pilots, three
  scripted pirates apiece): **4 episodes of 120 differ**, mean pool points taken
  372.4 → 372.7, pirate accuracy 0.6201 → 0.6210, 5 kills → 5 kills. No
  `random()` call moved, so this is a different threshold and not a reordering;
  every seed still replays.
- **No brain was retrained and none needed to be.** `EPISODE_SCHEMA` stays at 3:
  a schema-3 record still describes the same world, to four significant figures.

## What is left, and why it is honest to leave it

**One row cannot read "same", and it is docs/TODO/73's**: the handover to the
scripted break-off inside `BRAIN_HANDOVER_RANGE`. It is not a resolution
divergence at all — it is in the DECIDING half — and closing it would change what
every attack and pack genome is scored against, which invariant 5 says
invalidates the brains. It has its own item, its own measurement (0.00 passes
against the scripted 3.88) and its own acceptance. Doing it inside a refactor
whose whole claim is "nothing changed" would be the wrong shape.

**And a fifth divergence turned up on the way out, pointing the other way**:
docs/TODO/74. The direction this item covers is *an NPC fired*; the direction it
does not is *the episode's TARGET fired*, and when that target stands in for an
armed freighter it composes the shot itself and rolls `npcHitChance`'s range
curve where the game's armed trader rolls the flat `NPC_VS_NPC_HIT` — 0.754 of
its shots landing against the sky's 0.500, at the ranges a fight is fought at.
It is outside this seam (the shooter is a `TargetShip`, not an `NpcShip`) and it
is a decision about which rule is right rather than a refactor, so it has its own
file. It is also the table's own sentence coming true one more time: *there is no
reason to believe the list is complete.*

**One difference below the seam is deliberate and stays**: `applyDamage`'s
equipment die. The game passes its default (`random`), so a hit that reaches the
hull may wreck cargo or a fitting; the episode passes `() => 1`, because it has
no fittings to wreck and no cargo to lose. It changes no pool — a `DamageResult`'s
`wreckedSomething` is read by the Game and by nothing else — and
`test/fire-resolution.test.ts` drives two bare-hull cases through both paths and
asserts the pools are identical across it. It is `applyDamage`'s own stated,
injectable parameter, not a second rule.

## Watch out for

- **`npm run portability` must stay at 0.** The shared resolver is a rule
  module; if it needs the effects system or audio, the seam is in the wrong
  place. It stays at 0: both new files are in `ports unchanged`, and both are in
  `test/ai.test.ts`'s `PURE` list, which fails on a browser reference.
- **Seeded reproducibility is the whole point of the trainer.** Any reordering
  of `random()` calls changes every archived outcome. **Nothing was reordered.**
  The draws in the resolver are the draws the step took, in the order it took
  them: the hit roll first and alone, then whatever the damage itself draws. The
  miss-scatter's two draws stayed with the caller and stayed AFTER the hit roll,
  which is the one place the extraction could have gone wrong invisibly.
- **Do not let this block 62 and 63.** They are worth fixing on their own; this
  is what stops number four.

## Acceptance

- [x] One module owns "a ship fired, what happens" and both `world-step.ts` and
      `scenario.ts` call it — `src/game/fire-resolution.ts`.
- [x] A parity test drives the same `FireEvent` through both and asserts
      identical damage, identical rack, identical pools —
      `test/fire-resolution.test.ts`, ten fixtures.
- [x] The table in the Why section is re-derived; every row reads "same" except
      the handover, which is docs/TODO/73 and is named above rather than faked.
- [x] `npm test` (2,845 → **2,872**), `npm run elite-a` (478 → **480**),
      `npm run campaign` (**byte-identical output**) and `npm run portability`
      (**0 contaminated**) unmoved.

## Verify

**The gate is real, not decorative.** Ten probes, each restored afterwards, in
two families. The first gut a branch of the shared resolver; the second re-grow a
copy of it in one caller, which is the shape every historical divergence in the
table actually had.

| probe | what broke |
| --- | --- |
| A1 `launchNpcMissile` stops spending the round | `...and the LAUNCHING ship paid for it (1 carried, 0 spent)` |
| A2 the missile branch puts nothing in the sky | `...a warhead left the rail (0 in the sky)` + A1's |
| A3 the hit roll always says yes | `...and the cases really fought: 7 bolts landed, 0 went wide` |
| A4 a hit costs her nothing | `0 bolts landed, 7 went wide`; `0 of them onto bare hull`; `...a hit spends exactly npcLaserDamageToPlayer` |
| A5 the crossfire branch hurts nobody | `...and crossfire both connected and went wide (0/2)` |
| A6 the shield face always says ahead | `...and one from astern is not`; `...it is the SHIP's frame`; `a hit from astern spends the aft face (fore 135, aft 255)` |
| B1 the trainer stops reading `event.weapon` (62's row) | `a warhead off the rail` — the parity `eq` |
| B2 the trainer resolves the laser itself (this item's row) | `a bolt from astern, spending the other face` — the parity `eq` |
| B3 the trainer works the shield face out for itself, `dot >= 0` | **NOTHING** — see below |
| B3' ...the same, with the sign the other way | `a bolt from dead ahead`; `a bolt from astern` — the parity `eq`s |
| B4 the game keeps its own copy of `NPC_VS_NPC_HIT` (0.4) | `crossfire lands at 0.5 (0.404 over 2000 rolls)` |
| B5 the trainer keeps its own hull id for the armour | three parity `eq`s |

**B3 is the most useful line in the table.** Restoring the episode's old dot
product changes nothing, because the two forms are the same arithmetic — which is
precisely how that copy survived unnoticed. A parity test cannot catch a second
home that is right; only having one home can. It is why `shield-face.ts` exists
as a file rather than as a check.

Note the two families fail differently, and both are needed. Gutting the shared
rule fails the branch-coverage counters (both callers break equally, so the
equivalences still agree); re-growing a copy in one caller fails the
equivalences. A file with only the `eq`s would pass on a deleted branch.

**And the GAME side is byte-identical, which is a different check.** The recipe
is 62's, widened:

- `test/missiles.test.ts`'s `fight(seed, count, frames)` builds the fixture — a
  real `Game` on `headlessShell()`, the sky emptied and refilled with a known
  gang, `world.scene.updateMatrixWorld(true)` for the settling step, a per-frame
  line. Widen it to every field a divergence could show in and print it.
- `git worktree add <dir> <commit>`, symlink `node_modules`, run the same file in
  both, `diff` and `shasum -a 256`. Not `git stash`.

**Five fights, 7,000 frames, 10,952,528 bytes, sha256
`c366bce9594ce33a8e43e0782c39e4d417a1b97e3ff0da1da0701166c898840f` on both
`acf1e2d` and the change.** Per frame: mode, all three pools and their carries,
laser heat and cooldown, cabin temp, credits, kills, legal status, the rack, the
hold, the fit-out, the player's position, quaternion and speed, canisters in
flight, every missile's owner/life/position/quaternion, and for every NPC its
role, alive, energy, regen carry, rack, missile reload, fire cooldown, attack
phase, `flownBy`, `passesMade`, `underFire`, `extendRange`, `passSide`, provoked,
provokedByPlayer, fleeing, its NPC target, speed, position and quaternion.

62 ran three fights and **the trace was too weak in exactly one place**, which is
worth recording: perturbing the player-facing hit chance by 10% moved nothing,
because those three fights are missile fights that draw only a handful of laser
rolls at the commander. Two `laserFight` fixtures were added — eight guns with
empty racks at knife range — and the probe moves the hash now. The five trace
probes, all against `acf1e2d`:

| trace probe | hash |
| --- | --- |
| baseline | `c366bce9594ce33a` |
| NPC hit chance × 0.9 | `5f0ec196457f510b` |
| the shield face flipped | `a55d57bf80d60e2f` |
| the laser damage off a stronger byte | `1cf1ef7210dfc7a8` |
| the missile launched from the hull centre, not the nose | `f8c384a5b7354e65` |
| crossfire chance 0.5 → 0.49 | `c366bce9594ce33a` — **unmoved**, see below |
| crossfire chance 0.5 → 0.25 | `d233440de6ecbc2a` |

The last pair is honest rather than reassuring: a 1% window catches no roll in
this fixture's crossfire fight, where halving the chance moves it at once. A
trace proves what its fixture exercises and no more, and the fixture's crossfire
leg is thinner than its laser legs.
