# 64 — One resolver, so the trainer and the game cannot drift

**Kind:** architecture · **Severity:** high · **Size:** large
**Depends on:** 62, 63 (both are symptoms of this)

## Why

Chris, 2026-08-03: *"Training should match the 'real world' otherwise it's
always going to be wrong."*

Items 62 and 63 are two instances of one structural fault, and if only they are
fixed there will be a third. This is the item that stops it.

The project's north star holds for the DECISION half of combat: `NpcShip`,
`gunnery.ts`, `collisions.ts` and `rng.ts` have one home each, and the trainer
calls them. It does not hold for the RESOLUTION half. Invariant 15 splits the
world deliberately — *"NPCs return `FireEvent`s; the Game resolves all
consequences"* — and there are two Games:

| | the game | the trainer |
|---|---|---|
| resolver | `world-step.ts` `resolveNpcFire` | `scenario.ts` `resolveNpcShot` |
| reads `event.weapon` | yes | **no** |
| spends `state.missiles` | yes | **no** |
| calls `chooseWeapon` | yes | **no** |
| regenerates the target | `systems.ts regenerate()` | the gun's half only |

Every row after the first is a divergence nobody chose. They were found by
asking one question about missiles; there is no reason to believe the list is
complete, and no mechanism that would have reported any of them.

This is the failure CLAUDE.md is organised against, stated in its own words:
**one rule with two homes, kept in step by hope.** It is worth writing down that
the usual defence did not fire — "it uses the same engine" is true, and was the
reason nobody looked.

## What to work out

- **What the shared thing IS.** Probably not "extract `resolveNpcFire`": it
  reaches for tracers, sounds, the station, despawn and the commander's
  equipment, none of which an episode has. The candidate seam is the one this
  codebase has used twice already — `engine/shell.ts` for the platform,
  `StepHost` for the orchestrator — a narrow interface the game and the trainer
  each implement, with the RULES above it in one file both call.
- **Which consequences are rules and which are presentation.** A tracer is
  presentation. Spending a missile, rolling the hit, choosing the damage and
  picking the shield face are rules. The split is the whole design.
- **Whether `Episode` should just BE a `StepHost`.** It may be that the trainer
  wants `world-step.ts` itself with a smaller world, rather than a parallel
  step. That is a bigger change and possibly the right one — `test/game.test.ts`
  already flies the real `Game` under node with `headlessShell()`, so the
  precedent exists.
- **What the gate is.** Whatever the shape, the item is not done without a test
  that would have caught these: same `FireEvent`, same seed, same outcome
  through both paths. A parity test is the only thing that makes "they cannot
  drift" true rather than intended.

## Watch out for

- **`npm run portability` must stay at 0.** The shared resolver is a rule
  module; if it needs the effects system or audio, the seam is in the wrong
  place.
- **Seeded reproducibility is the whole point of the trainer.** Any reordering
  of `random()` calls changes every archived outcome. Expected — but
  determinism from a given seed is not negotiable, and the regression fixtures
  will need regenerating deliberately rather than by accident.
- **Do not let this block 62 and 63.** They are worth fixing on their own; this
  is what stops number four.

## Acceptance

- One module owns "a ship fired, what happens" and both `world-step.ts` and
  `scenario.ts` call it.
- A parity test drives the same `FireEvent` through both and asserts identical
  damage, identical rack, identical pools.
- The table in the Why section is re-derived and every row reads "same".
- `npm test`, `npm run elite-a`, `npm run campaign` and `npm run portability`
  unmoved.

## Verify

Delete one branch of the shared resolver and confirm the parity test fails. That
is the only evidence that the gate is real rather than decorative — the same
standard `npm test`'s "the ban is not vacuous" checks already hold themselves
to.
