# 83 — The one-warhead-in-the-air cap can be deleted and nothing notices

**Kind:** test gap · **Severity:** medium · **Size:** small
**Depends on:** none · found by the same mutation sweep as 76; do before 75

## Why

`WorldView.missileInbound` exists because of a specific recorded failure, written
into `npc.ts`:

> One in the air at a time, across the whole gang. E.C.M. destroys every missile
> in flight in one burst for a quarter of the bank, so it is a complete answer to
> one missile and no answer at all to five — **which is how a wave-13 gang put
> three through in nine seconds.** Capping the air makes the counterplay the
> player already owns actually work.

It is a fairness rule with a stated design and three cooperating parts: the
`Ordnance.missileInbound` getter, the once-per-frame read in `world-step.ts:345`
and `scenario.ts:913` (both of which have comments explaining why it must be read
once and not per ship), and the guard in `chooseWeapon`:

```ts
if (missileInbound) return shot;          // npc.ts:1290
```

**Deleting the guard breaks no test.** Changing that line to

```ts
if (missileInbound && false) return shot;
```

leaves `npm test` at **2982 passed, 0 failed**.

## What is actually failing

Nothing today. The rule works — I read all three parts and they agree. What is
missing is the gate.

The three parts are also the shape that this project has repeatedly found
drifting: a fact computed in one module, read once per frame by two different
orchestrators, and applied in a third. Each of the three can fail
independently and none of the failures is visible:

- **The read moves inside the loop.** Both call sites carry a comment saying it
  must not, which is the "kept in step by hope" signature. If either moves, the
  first launcher in a frame silences the rest within that frame, which is a
  different program and produces exactly the same test output.
- **The getter changes meaning.** `missileInbound` is `missiles.some(m => m.target === null)`,
  and `target === null` IS what makes a missile hostile. Anything that gives a
  hostile missile a target — a homing rework, a missile fired at an NPC by
  another NPC — silently uncaps the sky.
- **The guard moves relative to `missileReload`.** It sits after the reload tick
  and before `npcMissileEmergency`, deliberately, so "a ship that would have
  launched keeps its missile AND fires its gun". Reordering it costs the gang a
  round for nothing.

`test/missiles.test.ts` does test a great deal about launching — 52 warheads over
60 fights, the rack running down, the reload — but every fixture it builds passes
`missileInbound: false`, so the capped branch is never taken.

It matters more the moment docs/TODO/75 lands: turning the "the gang is losing"
reason back on adds launches to exactly the fights where several ships are hurt
at once, and this cap is the only thing between that and the wave-13 record.

## What is NOT the problem

- **Not `ordnance.ts`.** `test/defence-answer.test.ts:251-255` does assert
  `sky.missileInbound` both ways around an E.C.M. burst, so the getter is
  covered. What is not covered is anything READING it to decide.
- **Not `autopilotEcm`.** That is the other consumer of the same fact and it is
  well tested (`defence-answer.test.ts:120-137` is a genuine two-sided test).
- **Not the training side.** `Episode.step` reads it once per frame and passes it
  to every `chooseWeapon`; the code is right.

## What to work out

Two assertions, and both are small because `chooseWeapon` is public and takes
the two facts as scalars (which is exactly why 62 made it so):

- **The unit case.** A ship with a rack, hurt enough to launch, asked twice:
  `chooseWeapon(shot, dt, dist, pos, /*missileInbound*/ false, 0)` returns a
  missile; the same ship with `true` returns the laser `shot` unchanged AND still
  has its rack. That second half is the design ("the gang loses nothing except
  the ability to saturate a countermeasure") and is what a `return null` would
  quietly break.
- **The gang case.** Several armed, hurt pirates stepped through one frame of
  `world-step` with a warhead already in the sky: exactly zero launches. This is
  the one that catches the read moving inside the loop, and it needs the step
  rather than the ship.

Worth adding at the same time, because it is the same fixture: a test that two
pirates in ONE frame cannot both launch — which is the property the
once-per-frame read exists to give and which no unit test of `chooseWeapon` can
see.

## Watch out for

- **A one-ship test is not enough.** The interesting failure is a gang, and the
  gang case needs the orchestrator, so it belongs in `test/world-step.test.ts`
  or beside the missile tests with a stepped world.
- **`test/missiles.test.ts` builds its `WorldView` with `missileInbound: false`
  in a helper.** Adding a parameter there is the smallest change; check it does
  not move the seeded outcomes of the existing assertions.
- **Do not assert on `Ordnance.missiles.length`.** The cap is on HOSTILE missiles;
  the player's own are in the same array.

## Acceptance

- `chooseWeapon` with `missileInbound: true` returns the laser shot and spends no
  round, asserted directly.
- A stepped world with a warhead in the sky produces zero launches from a gang
  that would otherwise produce several.
- The mutation `if (missileInbound && false)` fails `npm test`.

## Verify

```sh
# src/game/npc.ts:1290   if (missileInbound) return shot;
#                     -> if (missileInbound && false) return shot;
npm test
# 2026-08-04: 2982 passed, 0 failed
git checkout src/game/npc.ts
```
