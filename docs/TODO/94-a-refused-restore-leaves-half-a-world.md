# 94 — A refused restore leaves half a world behind

**Kind:** correctness / saves · **Severity:** medium · **Size:** medium
**Depends on:** none · found while deleting the identity fallbacks (`9eeebc2`)

## Why

`Persistence.restore` mutates the live session as it goes, and it can throw
partway. There is no rollback, so a refused restore leaves the game holding a
world that is neither the one it had nor the one it was asked for.

The order it writes in (`persistence.ts`):

1. `s.commander = structuredClone(snap.commander)` — **the live commander is
   already gone**
2. `requirePlayerHullId(s.commander.shipId)` — first place it can throw
3. `s.systems = generateGalaxy(...)`, a new `LivingGalaxy`, `load(...)`
4. `restoreState(s.session, snap.session)`
5. `this.host.buildWorld()`, maybe `enterWitchspace()` — **the scene is rebuilt**
6. the player's position, quaternion, speed and rates
7. `Object.assign(s.sys, snap.systems)`
8. `World.restoreNpcs(...)` — throws on a ship that does not say what it is

A throw at step 8 leaves the commander replaced, the galaxy regenerated, the
scene rebuilt and the player moved, with no fleet. `resume()` catches it and
returns false, and boot then docks — so a player sees a fresh commander rather
than a crash, which is why this has never been visible.

## What is actually failing

**Nothing a player has hit.** `resume()`'s catch exists for exactly this, and
its comment states the guarantee it is defending: *"a world that will not come
back must never cost you the commander."* That guarantee holds today because
boot starts fresh afterwards, and a fresh commander is not the corrupted one.

What is wrong is that the guarantee is **accidental rather than structural**.
The catch converts a half-applied mutation into a fresh boot; it does not undo
the mutation. Anything that ever reads the state between the throw and the boot
sees a world that never existed, and nothing stops a future caller doing so.

This is pre-existing — any throwing restore has always done it. What changed in
`9eeebc2` is that it became **reachable for a class of snapshot that used to
succeed**: a fleet whose ships carry no identity now throws at step 8 where it
used to migrate. So the path is live, not hypothetical.

## What is NOT the problem

- **Not `resume()`'s catch.** It is right and it is why nobody has seen this.
- **Not the decision to refuse.** Chris, 2026-08-04: an unreadable save is old
  junk. Refusing is correct; refusing *cleanly* is what is missing.
- **Not `requirePlayerHullId` at step 2.** Throwing early is the good case — the
  earlier it throws the less it has broken. The bad case is the throw at step 8.
- **Not a reason to validate less.** The fix is not to stop checking.

## What to work out

Three shapes, and the third is probably right:

- **Validate first, mutate second.** Walk the snapshot and reject it before
  touching `s.commander` — every hull id, every ship identity, the version. The
  step-8 checks move to a step-0 pass. Cheap, and it makes the common refusal
  atomic by construction. The catch: two places now know what a valid snapshot
  is, which is the two-homes defect this repo keeps finding. Avoid that by
  having the validating pass BE the parse, and the restore consume its output.
- **Build beside, then swap.** Construct the new state fully, and only assign it
  over the live one once nothing can throw. The cleanest, and the largest change
  — `buildWorld()` and `enterWitchspace()` are host calls with side effects on
  the scene, so "beside" is not free.
- **Snapshot the live state and roll back on throw.** `capture()` already
  exists, so the before-image is one call. Tempting and probably wrong: a
  rollback path that runs only on failure is a path nothing exercises, and it
  would need its own gate to not rot.

Whatever is chosen, decide what `restoreSnapshot` — the console-harness and
combat-trainer entry point that does not go through `resume()` — should do. It
has no catch, so it currently throws into whatever called it.

## Watch out for

- **`capture()` → `restore()` → `capture()` is field-for-field identical today**
  (`test/persistence.test.ts`), in flight and docked. That is the property that
  must survive any restructuring.
- **Draw order is the world's reproducibility.** `restore` assigns `snap.rng`,
  and `World.restoreNpcs`'s constructor draws — a tumble axis, a pack offset, an
  E.C.M. coin, an opening tactic. Moving work either side of that assignment
  changes seeded outcomes. `test/snapshot.test.ts` pins that the fleet comes
  back identical from anywhere in the stream; keep it passing.
- **The combat trainer tears down through this path.** `T` at a station restores
  to get back out of an exercise, so a change here is a change to the room Chris
  playtests in.

## Acceptance

- A snapshot that will be refused does not modify the live session at all —
  asserted by capturing before, attempting a restore of a known-bad snapshot,
  capturing after, and comparing field for field.
- The refusal still surfaces as `resume()` returning false rather than an
  exception reaching the UI.
- `restoreSnapshot`'s behaviour on a bad snapshot is stated and tested.
- `capture` → `restore` → `capture` identity still holds.
- The seeded-fleet property still holds.

## Verify

The half-applied state is visible directly: build a snapshot whose fleet carries
no `designId`, capture the live commander, call `Persistence.restore` inside a
`try`, and compare the commander after the throw with the one before. Today they
differ — `s.commander` was replaced at line 1 of the function and the throw
happened seven steps later.
