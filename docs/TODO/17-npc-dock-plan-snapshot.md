# 17 — NPC docking latch is missing from the snapshot

**Kind:** missing behavior state · **Severity:** high · **Size:** small

## What is wrong

`NpcShip` keeps a private `DockPlan` outside `NpcState`. Its `phase` is a
behavior-driving latch: once a trader commits to the slot run, `planDocking`
must remember that decision or the ship can turn back toward the gate and
oscillate. NPC persistence serializes only `NpcState`, so restoring a trader
mid-run silently resets the plan to `gate`.

## Evidence

- `src/game/npc.ts` owns `private readonly dockPlan = makeDockPlan()` and passes
  it to `planDocking` every docking frame.
- `src/game/docking.ts` documents why `DockPlan.phase` must latch across frames.
- `src/game/world.ts` captures and restores only `npc.state`.
- The current snapshot replay fixture flies a pirate, not a trader committed to
  docking, so it cannot see this divergence.

## The fix

Make the plan's behavior-driving state part of `NpcState`, preferably by moving
the reusable `DockPlan` into it. Preserve the current allocation behavior and
the live vector identities used by `planDocking`. If only `phase` truly needs
to persist, prove that the remaining plan fields are derived outputs before
storing less than the whole object.

Old snapshots must still load: absent plan state should start from the same
fresh `gate` default as a newly spawned trader.

## Verify

- Add a mid-docking snapshot test: advance a trader until its plan is committed,
  serialize through JSON, restore into a fresh world, and require the restored
  and uninterrupted runs to remain equivalent through docking/despawn.
- Include a control demonstrating that resetting the latch makes the fixture
  diverge.
- `npm run lint && npm test && npm run sizes`
- `git diff --check`
