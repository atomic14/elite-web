# 94 — Parse a save at the door, and refuse it whole

**Kind:** correctness / saves · **Severity:** medium · **Size:** medium
**Depends on:** none · the defect was found while deleting the identity
fallbacks (`9eeebc2`); the shape is Chris's call, 2026-08-04

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
scene rebuilt and the player moved, with no fleet.

`resume()` catches it and returns false, and boot then docks — so a player sees
a fresh commander rather than a crash. The guarantee its comment states does
hold: *"a world that will not come back must never cost you the commander."*
But it holds **by accident**. The catch converts a half-applied mutation into a
fresh boot; it does not undo the mutation, and nothing stops a future caller
reading the state in between.

This is pre-existing — any throwing restore has always done it. What changed in
`9eeebc2` is that it became **reachable for a class of snapshot that used to
succeed**: a fleet whose ships carry no identity now throws at step 8 where it
used to migrate.

## The shape — decided

Chris, 2026-08-04, on `parse(capture(world))`: *"you're right — that should
match for a valid state. Nice and simple."*

**One parse boundary. `parseSnapshot(unknown): WorldSnapshot`, and a `restore`
that consumes only its output.** Validate at the door, mutate afterwards, so
"refused" and "half applied" stop being the same state.

### Not JSON Schema, and not a schema library

A `.json` schema beside the TypeScript interface is a second definition of
`WorldSnapshot` kept in step by hope — the defect this repo is organised
against, and the one that produced `MAX_TRADERS`. It is only worth it generated
from the types, which is a build step this does not need.

If a library is ever wanted, it is Zod or Valibot — schema-first with the type
inferred, so there is still one home — not ajv. The cost is a runtime dependency
in a project that has exactly one, and it does not solve the next paragraph.

### Half the snapshot is deliberately opaque, and must stay that way

```ts
galaxyState: unknown;
dockPlan: Record<string, unknown>;
combatComputer: Record<string, unknown>;
session: Record<string, unknown>;
market: unknown[];  hermitMarket: unknown[];  contractOffers: unknown[];
```

These are walked generically ON PURPOSE. `restoreState` copies `session` field
by field so that adding a session flag costs nothing at the save layer. A
validator that enumerated them would re-home `SessionState`, `AutopilotState`
and the dock plan into the save format, which is worse than no validation.

**The parser checks what has invariants and passes the rest through**: the
version, the branded ids (`requirePlayerHullId`, `requireShipDesignId` and
`requireNpcCombatProfileId` already exist and already do exactly this), the
`mode` enum, array shapes, finite numbers, the quaternion's arity, `targetLock`
being a valid index into `npcs`. The owning modules validate the opaque parts,
as they do now.

### The gate comes free, and cannot rot

`capture()` already produces the canonical valid snapshot. So:

- **`parse(capture(world))` succeeds and deep-equals its input**, in flight and
  docked — `test/persistence.test.ts` already sets both up.
- **Deleting or corrupting ANY field of a real captured snapshot makes `parse`
  fail.** Walk the captured object's own keys; do not write the list down.

The second one is the good part. It is derived from what the game actually
writes, so a field added next year is covered the day it is added, and a parser
that quietly stops checking something goes red. `capture()` IS the definition
and the parser is held to it. No schema language, no dependency, no second home.

## What is NOT the problem

- **Not `resume()`'s catch.** It is right, and it is why nobody has seen this.
- **Not the decision to refuse.** Chris, 2026-08-04: an unreadable save is old
  junk. Refusing is correct; refusing *cleanly* is what is missing.
- **Not `requirePlayerHullId` at step 2.** Throwing early is the good case — the
  earlier it throws, the less it has broken. The bad case is the throw at 8.
- **Not a reason to validate less**, and not a reason to reinstate any of the
  migration deleted in `1861911` and `9eeebc2`.

## What to work out

- **Where the parsed type is declared.** The honest version is that
  `parseSnapshot` returns a `WorldSnapshot`, the interface stays the single
  declaration, and the parser is the only door. Check nothing else casts into
  it from `unknown`.
- **What `restore` does with a refusal.** A discriminated result reads better
  than a throw, given `resume()` already wants a boolean — but `restoreSnapshot`,
  the console-harness and combat-trainer entry, has no catch at all and today
  throws into its caller. Decide both, and state what a harness sees.
- **Whether steps 3-5 can move after validation.** Once nothing can throw past
  the parse, the ordering problem mostly evaporates. If a step can still fail for
  a non-snapshot reason — a scene that will not build — say so and decide whether
  it needs the same treatment.
- **`SNAPSHOT_VERSION` is the parser's first check** and already throws. Keep it
  cheap; it is the refusal that must stay a single comparison.

## Watch out for

- **`capture()` → `restore()` → `capture()` is field-for-field identical today**
  (`test/persistence.test.ts`), in flight and docked. That property must survive.
- **Draw order is the world's reproducibility.** `restore` assigns `snap.rng`,
  and `World.restoreNpcs`'s constructor draws — a tumble axis, a pack offset, an
  E.C.M. coin, an opening tactic. Moving work either side of that assignment
  changes seeded outcomes. `test/snapshot.test.ts` pins that the fleet comes back
  identical from anywhere in the stream; keep it passing.
- **The combat trainer tears down through this path.** `T` at a station restores
  to get out of an exercise, so this is the room Chris playtests in.
- **A parser is easy to make vacuous.** One that accepts everything passes the
  round-trip half of the gate perfectly. The corruption half is what stops that,
  so write that test first and watch it fail before the parser exists.

## Acceptance

- `parseSnapshot` exists and is the only way a `WorldSnapshot` is made from
  untrusted input.
- A snapshot that will be refused **does not modify the live session at all** —
  asserted by capturing before, attempting the restore, capturing after, and
  comparing field for field.
- `parse(capture(world))` deep-equals its input, in flight and docked.
- Deleting or corrupting any single field of a captured snapshot fails the
  parse, driven off the snapshot's own keys rather than a written list.
- The refusal still surfaces as `resume()` returning false rather than an
  exception reaching the UI, and `restoreSnapshot`'s behaviour is stated.
- `capture` → `restore` → `capture` identity holds; the seeded-fleet property
  holds.

## Verify

The half-applied state is visible directly today: build a snapshot whose fleet
carries no `designId`, capture the live commander, call `Persistence.restore`
inside a `try`, and compare the commander after the throw with the one before.
They differ — `s.commander` was replaced on the function's first line and the
throw happened seven steps later.
