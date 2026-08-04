# 62 — Missiles do not exist in training, and nothing said so

**Kind:** training fidelity · **Severity:** high · **Size:** medium
**Depends on:** none (63 and 64 are the rest of the same finding)

## Why

Chris, 2026-08-03, on being told E.C.M. could be fitted for an exercise but
would do nothing in a training run: *"Our scripted NPC can fire missiles, why
can't they do that in the training system which should be using the same game
engine?"* And then the principle this and its two siblings exist to serve:
*"Training should match the 'real world' otherwise it's always going to be
wrong."*

He is right that it is the same engine, and that is what makes the gap hard to
see. Invariant 5 says episodes are built out of `NpcShip`, `PlayerShip`,
`gunnery.ts`, `collisions.ts` and `rng.ts` — true, and the flight model really
does have one home. What is NOT shared is the orchestrator, and invariant 15 is
the reason: *"NPCs return `FireEvent`s; the Game resolves all consequences."*
`world-step.ts` is the game's resolver and `scenario.ts` is the trainer's. Two
implementations of one contract.

This matters more than a missing feature. Missiles were **45%, 48% and 94%** of
the incoming damage in the three fights Chris recorded on 2026-08-03, and the
one that killed him in 9.1 seconds was almost entirely missiles. The policy that
flies the combat computer and every armed trader has never seen one.

## What is actually failing

Three things, and the first is enough on its own:

1. **`chooseWeapon` is never called.** It is the function that turns a laser
   shot into a missile launch, and it is called in exactly ONE place —
   `NpcShip.update()`, wrapping the result of `brainFly`/`attack`. Episodes do
   not call `update()`; they drive `brainFly` and `attack` directly. So no
   pirate in a training episode has ever *decided* to launch a missile.

   Measured: 200 hurt pirates, each given a full rack, 45 seconds apiece —
   **1,399 laser requests and 0 missile requests.** To reproduce, drive
   `NpcShip.attack` the way an episode does and count what it asks to fire:

   ```js
   // node --experimental-strip-types <this file>
   import * as THREE from 'three';
   const R = 'src';
   const { FIXED_DT } = await import(`../${R}/game/world-step.ts`);
   const { NpcShip } = await import(`../${R}/game/npc.ts`);
   const { seedWorld } = await import(`../${R}/game/rng.ts`);
   let laser = 0, missile = 0;
   for (let e = 0; e < 200; e++) {
     seedWorld(30000007 + e * 7919);
     const npc = new NpcShip('pirate', new THREE.Vector3(0, 0, -1200), 5);
     npc.state.threatTier = 2;
     npc.state.missiles = 2;                                   // arm it
     npc.state.energy = Math.round(npc.maxEnergy * 0.3);        // hurt it
     const target = new THREE.Vector3();
     for (let f = 0; f < 60 * 45; f++) {
       const d = npc.object.position.distanceTo(target);
       const ev = npc.attack(FIXED_DT, target, d, true, undefined, [npc]);
       if (ev) ev.weapon === 'missile' ? missile++ : laser++;
     }
   }
   console.log({ laser, missile });   // { laser: 1399, missile: 0 }
   ```

   `scenario.ts` already knows about this class of debt and has paid it once:
   *"`NpcShip.update` does this for the live sky; an episode drives
   `brainFly`/`attack` directly, so it owes the ship the same call"* — which is
   about `regenerate(dt)`. `chooseWeapon` is the same debt, unpaid.

2. **`resolveNpcShot` never reads `shot.weapon`.** Every `FireEvent` is resolved
   as a laser hit. `world-step.ts`'s `resolveNpcFire` branches on it. So fixing
   (1) alone would turn every missile into an instantly-arriving laser bolt.

3. **Nothing spends the rack.** `world-step.ts` does `npc.state.missiles -= 1`;
   the episode does not. So fixing (1) and (2) but not this gives a pirate an
   infinite supply, gated only by `MISSILE_RELOAD`.

## What is NOT the problem

- **Not `npcMissileEmergency`.** The launch rule is shared and correct; it is
  simply never reached from an episode.
- **Not the missile flight model.** `ordnance.ts` owns missiles in flight —
  spawn, homing, E.C.M. defeat, impact — and it is plain rules over THREE maths.
  It does not need a browser and it must not be reimplemented here: a second
  missile model is exactly the failure this item is about.

## What to work out

- **Where the episode calls `chooseWeapon`.** It needs `view.missileInbound` and
  `matesLost`, which an episode has no `WorldView` for. Either build one, or
  extract the part of `update()` that is "fly, then choose a weapon" so both
  callers share it. The second is better and is item 63.
- **What an episode's `Ordnance` is.** It takes a world; an episode has a fleet
  and a target. Work out the smallest honest seam — most likely the same one
  `headlessShell()` established for the renderer.
- **What the target does about it.** The commander in an episode has no E.C.M.
  and no way to fire one. Adding the equipment is worthless until a policy has
  an action for it, which is a change to the 11-output head — decide whether
  this item stops at "missiles fly and can kill you" and leaves the answer to a
  later one.

## Watch out for

- **This invalidates the brains, and that is invariant 5's own warning.** A
  pirate that spends a missile is a different opponent. Retrain deliberately and
  record it in docs/TRAINING-LOG.md.
- **Seeded reproducibility.** `random()` calls move when a branch is added, so
  every archived episode outcome shifts. That is expected; what must not shift
  is determinism from a given seed.
- **The 10 Hz decision cache.** `chooseWeapon` ticks `missileReload` itself, so
  calling it once per frame and once per decision are different programs.

## Acceptance

- A pirate in a training episode launches a missile, it flies, and it can kill
  the target.
- Its rack empties: a ship with two missiles launches at most twice.
- A test asserts that the same `FireEvent`, on the same seed, produces the same
  outcome through the game's resolver and the trainer's — see item 64.
- `npm run elite-a` and `npm test` unmoved.

## Verify

Re-run the snippet in "What is actually failing": it should now report a
non-zero `missile` count, and a ship given two missiles should end with none.
Then `npm run train -- defend --gens 20` and confirm episodes end in missile
kills, and `npm run defence-probe` to see what it does to the shipped policy's
numbers — a defender that has never met a missile should get noticeably worse
when one exists, and that drop is the measurement working, not a regression.

## Done, 2026-08-04 — and two things it left open

All three defects are closed and the acceptance holds. The measurements:

    the item's own snippet, before   { laser: 1374, missile: 0 }
    the same 200 pirates, driven the way an episode drives them NOW —
    fly, then choose a weapon        { laser: 1365, missile: 400,
                                       maxRackLeft: 0, minRackLeft: 0 }

400 warheads from 200 ships carrying two each: the rail runs dry and never
further. (The item quotes 1,399 lasers; the tree reads 1,374 on the same
snippet, which is docs/TODO/66's aim change moving where the ships end up.)

**The snippet as written still reports 0, and that is correct.** `attack()` is
the FLIGHT and its gun; choosing the weapon was always a separate decision. What
was wrong is that only `NpcShip.update()` made it. `chooseWeapon` is public now
and takes two scalars — `missileInbound` and `matesLost` — instead of a
`WorldView`, because those are the only two facts in it that are not on the ship,
and an episode has neither a view nor a station to build one around. That is the
seam docs/TODO/64 widens; it deliberately does not close it.

The other two: `resolveNpcShot` reads `shot.weapon` and returns `null` for a
missile (a warhead is a ship in the sky for the next 25 seconds, not a bolt that
lands in the frame it left, so it is not a tracer and not in the accuracy
denominator); and the round is spent by `ordnance.ts`'s new `launchNpcMissile`,
which **both** resolvers now call, so "spend the rack, put it in the sky" has one
home. `Ordnance` takes an `OrdnanceWorld` — `attach`, `detach`, `npcs` — which
`World` already satisfied and an episode supplies as its own fleet with an
`attach` that draws nowhere. Same bargain as `headlessShell()`: nothing reads the
scene back, a missile's position is its own, and there is no second missile model.

`EPISODE_SCHEMA` is **3**, and the setup and report carry the rack: what each
pirate warped in with, what it fired, what is left.

### What it did to the numbers

`npm run defence-probe`, `jameson-defend-g1`, the same 240 held-out episodes:

| | pools left | by 1 / 2 / 3 / 4 pirates | killed | died |
| --- | --- | --- | --- | --- |
| before (lasers only) | 99.2% | 100.0 / 99.6 / 99.1 / 97.9 | 5.7% | **0/240** |
| **after** | **90.1%** | 96.4 / 89.5 / 88.8 / 86.2 | 5.7% | **6/240** |

That drop is the measurement working. A defender that has never met a missile
has no answer to one, and now there is something in the world worth having an
answer to. `npm run survivability` says the same from her side: **0% destroyed at
every gang size becomes 1-4%**, and a gang of four kills her in **8.3 seconds** —
Chris's real 9.1-second death, in the trainer, for the first time.

The kill column did not move at all, in any cell. That is docs/TODO/71: a
defence policy's fourteen observations do not include its own health, so nothing
about how it flies can change.

### It did NOT restore docs/TODO/70's kill bonus

Three `pirate-pack-r4-selectonly` against the armed scripted trader, the same 60
seeds: `fitnessPack` 4.61, kill term 0.00, **0 kills**, 442.2 pool points,
80 shots — byte-identical to 70's "after" row, and **0 missiles launched**. 70
hoped this item would close it. It does not, and the reason is docs/TODO/73:
`npcMissileEmergency`'s three ways in are a hull under 0.4, a dead wingman, and
two completed passes, and a brain-flown pirate in an episode completes **zero**
passes because nothing hands it over to the scripted break-off inside
`BRAIN_HANDOVER_RANGE` the way `NpcShip.update()` does. Against a target that
never shoots back, none of the three can happen. 70 is still open and still wants
its own decision.

### Two things this cannot close

- **docs/TODO/72** — the target has no E.C.M. and no output that could fire one.
  Missiles are undodgeable in training, which is the same fidelity fault as this
  item pointing the other way. It needs a twelfth output (which invalidates all
  three brains at once) or a stated reflex, and it needs 65 and 71 first or the
  measurement will call "hide and press it" an improvement.
- **docs/TODO/73** — the handover, above. It is a fourth row for 64's table and
  the first that is not about resolving a shot.

### The retrain

Recorded in docs/TRAINING-LOG.md with the commands and the held-out table.
**Nothing was promoted**, for the reason docs/TODO/65 gives in arithmetic: a
defender is still selected on terminal pools-left, where 1% is worth ten points
and a kill is worth three. `src/ai-training/brains/` holds the same three files.

### The game side is byte-identical, proved rather than assumed

Three of the files this touched are ones the live game runs — `npc.ts`,
`world-step.ts`, `ordnance.ts` — and `npm run campaign` is a trade and economy
playtest that abstracts flight away entirely, so it is no evidence at all about
the missile path. CLAUDE.md's rule for a refactor is equivalence with the
previous code on the same seed, so:

A fixture flies the real `Game` on `headlessShell()` — the sky emptied and
refilled with a known gang of hurt Pythons plus one dead wingman, so two of
`npcMissileEmergency`'s three reasons are true from the first frame — and writes
every field a divergence could show in, per frame: player position, quaternion,
speed, all three pools, laser heat and cooldown, legal status, credits, and for
every ship its energy, rack, `missileReload`, `passesMade`, attack phase,
`flownBy`, fire cooldown, E.C.M. roll, position and quaternion, plus every
missile in flight with its life and transform. `world.scene.updateMatrixWorld(true)`
before the first step is CLAUDE.md's settling caveat, handled.

Three fights: four attackers (she dies at frame 286), two (frame 730), and one
(she survives all 2,700 frames, which is the long live trace). **8,103 lines,
5,127,986 bytes, sha256 `3b02a88bf20c60a8fd059e89504db725edb6a4f52468d48173c76b024a922540`
on `38914c7` and on the change — `diff` reports no differing lines.**

Not vacuous: changing the muzzle in `launchNpcMissile` from
`npc.nosePosition(...)` to the hull centre moves the hash to
`9e55183c…d9076` and diverges at frame 0.

The durable half of the fixture is `test/missiles.test.ts`'s "in the real game,
headless" block, which was the other gap — **nothing in `npm test` asserted that
a missile ever left an NPC in the actual game.** It now checks that one does,
that the warhead arrives for `IMPACT.warhead`'s 250 points, that it kills her,
and that the whole fight replays byte-identically from its seed. Deleting the
missile branch of `world-step.ts`'s resolver fails three of those five. The
cross-checkout comparison needs two working trees and cannot live in a test;
docs/TODO/64's Verify section records the recipe, because 64 is the refactor
that will need it next.
