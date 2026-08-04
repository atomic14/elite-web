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
| reads `event.weapon` | yes | ~~no~~ — **closed by docs/TODO/62** |
| spends `state.missiles` | yes | ~~no~~ — **closed by 62**: both call `ordnance.ts`'s `launchNpcMissile` |
| calls `chooseWeapon` | yes | ~~no~~ — **closed by 62**: it is public and takes two scalars |
| regenerates the target | `systems.ts regenerate()` | ~~the gun's half only~~ — **closed by docs/TODO/63**: the episode's target runs the whole rule |
| hands over inside `BRAIN_HANDOVER_RANGE` | the scripted break-off | **no** — found by 62, written up as docs/TODO/73 |

Every row after the first is a divergence nobody chose. They were found by
asking one question about missiles; there is no reason to believe the list is
complete, and no mechanism that would have reported any of them.

**The last row is the proof of that.** It was not in this table when the item was
written; doing 62 turned it up, and it is not even about resolving a shot — a
brain-flown pirate in an episode flies its policy to zero range where the game
hands over to `attack()` inside 150 units, so it never completes a pass, never
accrues `passesMade`, and can never take the missile launch that rewards
engaging. Four known divergences now, three of them closed one at a time by
hand, and still nothing that would report the fifth. That is this item.

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

**And prove the GAME side is byte-identical, which is a different check.** This
item is a refactor of live combat, and CLAUDE.md's rule for one is equivalence
with the previous code — same seed, identical outcome — not self-consistency.
docs/TODO/62 did it like this, and the recipe is worth reusing:

- `test/missiles.test.ts`'s `fight(seed, count, frames)` already builds the
  fixture — a real `Game` on `headlessShell()`, the sky emptied and refilled with
  a known gang, `world.scene.updateMatrixWorld(true)` for the settling step, and
  a per-frame line. Widen the line to every field a divergence could show in
  (positions, quaternions, pools, racks, reloads, phases, missiles in flight via
  `__game.missiles`) and print it instead of asserting on it.
- `git worktree add <dir> <commit>` for the old tree, symlink `node_modules`,
  run the same file in both, `diff` and `shasum -a 256`. Not `git stash`.
- Prove the trace is not vacuous before believing it: perturb one line of the
  code under test and confirm the hash moves. 62's probe changed the missile's
  muzzle from the nose to the hull centre and the trace diverged at frame 0.

62 ran three fights over 8,103 frames — 5,127,986 bytes, sha256
`3b02a88b…dde8c` on both `38914c7` and the change — which is what says
`matesLost(view) -> matesLost(view.fleet)`, `chooseWeapon(…, view, …) -> (…,
view.missileInbound, …)` and the extraction of `launchNpcMissile` moved nothing.
