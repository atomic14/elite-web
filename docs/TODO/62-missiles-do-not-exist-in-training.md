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
   **1,399 laser requests and 0 missile requests.**

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

Re-run the probe in the Why section: 200 hurt pirates with a full rack should
now produce a non-zero missile count and an emptied rack. Then
`npm run train -- defend --gens 20` and confirm the log shows episodes ending in
missile kills.
