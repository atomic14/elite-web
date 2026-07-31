# 02 — The trainer re-implements the firing sequence

**Kind:** information leakage · **Severity:** high (CLAUDE.md invariant 5) ·
**Size:** medium

## What is wrong

`scenario.ts` shares `gunnery.ts`'s *constants* but not its *sequences*. The
target's gun re-derives, from raw constants, both the NPC gate-then-cooldown
order that `npc.ts` implements and the cooldown-and-heat spend that
`gunnery.ts` exports as functions.

Invariant 5 says there is one combat model, and the file's own header says there
is no second physics here. Both are true of the numbers and false of the order in
which they are applied — which is exactly how the ordering drifted last time. The
inline comment at `scenario.ts:552-553` ("as in npc.ts: ...") is the tell: a
comment maintaining a correspondence that the compiler could maintain instead.

## Evidence (read at `de9a668`)

`src/ai-training/scenario.ts:542-575`, `fireTraderGun`:

- NPC branch (`:548-565`) hand-rolls the sequence: `if (t.laserCooldown > 0)
  return null`, then the gate/range test, then
  `t.laserCooldown = NPC_COOLDOWN_LO + random() * NPC_COOLDOWN_SPREAD`.
- Player-hull branch (`:567-574`) hand-rolls the pulse-laser sequence:
  `if (t.laserCooldown > 0 || t.laserTemp >= LASER_CUTOUT) return null`, then
  `t.laserCooldown = pulse.cooldown`, then
  `t.laserTemp = Math.min(1, t.laserTemp + pulse.heat)`.
- The functions that already are that sequence:
  `src/game/gunnery.ts:97` `export function canFire(sys: ShipSystems): boolean`
  and `src/game/gunnery.ts:102` `export function chargeShot(sys: ShipSystems,
  laser: LaserSpec): void`.

## The fix

Two halves, and the second is the one that matters:

1. **Player-hull branch** — call `canFire` / `chargeShot` over a small
   `ShipSystems`-shaped object. Check `ShipSystems`' shape first (in
   `src/game/systems.ts`); if the trader struct cannot satisfy it cheaply,
   narrowing the parameter type of those two functions to just the fields they
   read is the better move than building an adapter.
2. **NPC branch** — the sequence it copies lives in `npc.ts`, not `gunnery.ts`,
   and nothing exports it. Extract it: an `npcTriggerPull(gun, angle, dist, rng)`
   (or similar) beside the NPC gun constants in `gunnery.ts`, called by both
   `npc.ts` and `scenario.ts`. `gunnery.ts:108-121` already explains that the
   NPC's gun moved into that file for this exact reason; this finishes the job.

## Verify

- `npm run lint && npm test`
- **Equivalence, not self-consistency.** Before changing anything, capture a
  seeded episode's shot log; after, assert the same seed gives the identical
  sequence of hits, misses and cooldowns. If the extraction is faithful, nothing
  changes. If something does change, the brains are invalidated (invariant 5)
  and you must say so and retrain deliberately — do not quietly accept a diff.
- Freshly spawned NPCs need one settling step before their world matrices are
  valid, or the fixture diverges for reasons that are not the code's.

## Notes

If step 1 and step 2 cannot both be done cleanly, do step 2. The player-hull
duplication is three lines of arithmetic; the NPC gate-then-cooldown *order* is
the rule that has already drifted once.
