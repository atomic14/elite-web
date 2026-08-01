# 23 — Add stable ship and combat-profile identities

**Kind:** state model / migration · **Severity:** high · **Size:** medium
**Depends on:** 21

## Why

Combat currently infers identity from role-specific `NpcSpec` objects and the
player is implicitly always a Cobra Mk III. Damage, geometry and a future
shipyard need durable source IDs rather than object identity or copied values.

## Implementation

- Generate and expose three validated identity types:
  - `PlayerHullId` for all 15 flyable hulls;
  - `ShipDesignId` for all 38 geometry designs;
  - `NpcCombatProfileId` for each exact `{ blueprintSet, designId }` variant.
- Add `shipId` to `CommanderData` and all commander/report clones. Missing or
  invalid legacy values migrate to Cobra Mk III, catalogue player id 7.
- Keep `newCommander()` on Cobra Mk III in this phase.
- Add a combat-profile id and design id to every source-backed `NpcSpec` and
  persist them in `NpcSnapshot`.
- Give the Harmless-only generation ship and hermit station namespaced custom
  IDs. They must remain visibly separate from Elite-A source profiles.
- Migrate a legacy NPC snapshot deterministically from its current hull,
  role and seed through `recommendedNpcProfile(designId)`. That lookup selects
  a real exact variant matching the recommended tuple. Save only the new
  identity thereafter; restore must never reroll it.
- Centralize validated lookups. Callers must not index generated arrays or
  compare Three.js geometry objects to discover identity.
- Include identity in combat-simulator inputs and report metadata without
  changing damage, rendering or spawning yet.

## Future shipyard seam

The saved `shipId` is the only player identity a later purchase flow should
change. Generated player profiles retain laser bytes, mount topology, armour,
recharge, speed, hold, range, rack, price group and turn limits, but this TODO
does not apply the non-combat characteristics to live flight.

## Acceptance

- Every generated ID resolves to exactly one immutable record and invalid IDs
  are rejected at serialization boundaries.
- A missing player ID loads as Cobra Mk III without losing other state.
- All 15 player IDs round-trip through commander JSON and simulator clones.
- Every current NPC and exact variant ID round-trips through snapshots.
- Save/restore continuation does not consume RNG or change combat identity.
- Deterministic gameplay is unchanged apart from new serialized metadata.

## Verify

Add catalogue lookup, legacy migration, snapshot continuation, simulator
isolation and invalid-input tests, then run the standard verification commands.
