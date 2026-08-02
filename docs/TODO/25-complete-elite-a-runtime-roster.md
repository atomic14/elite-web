# 25 — Bring the complete Elite-A ship roster into runtime

**Kind:** world model / roster · **Severity:** high · **Size:** large
**Depends on:** 23, 24

## Why

Exact geometry is only a catalogue unless the game can construct and encounter
the ships. The current roster omits Cobra Mk I, Dragon, Monitor, Ophidian,
Ghavial, Bushmaster, Rattler, Iguana, Shuttle Mk II and Chameleon.

## Implementation

- Replace hull-name/geometry coupling in `NpcSpec` with `ShipDesignId` and
  `NpcCombatProfileId` lookups.
- Use `recommendedNpcProfile(designId)` for current spawning. It resolves to a
  real exact variant; exact S.A-S.W selection by current system remains
  deferred.
- Build candidate role membership from the source slot bands across all sets:
  shuttle/transporter 9-10, trader 11-14, child 15, police 16, pirate 17-24,
  hunter 25-28, Thargoid/Thargon 29-30 and Constrictor 31.
- Add all missing mobile designs to every current coarse role supported by
  those source assignments. Keep existing encounter counts, living-galaxy
  events and seeded choice points.
- Retain current pirate threat tiers as a Harmless selection overlay, but base
  their classification on named source combat-profile fields and document any
  curated exception.
- Use a single named source-speed conversion for newly added designs. Preserve
  existing motion tuning where changing it is unrelated to damage, and store
  all remaining turn/acceleration values in an explicit Harmless motion
  overlay because the pack does not define those browser-game constants.
- Use exact source geometry and target radius for stations and world objects.
- Keep the hermit and generation ship as explicit custom roles/profiles.
- Update simulator ship selection, scanner labels, status/debug output and
  deterministic spawn fixtures for the expanded roster.

## Acceptance

- All 38 source designs are constructible and profile-resolvable.
- The ten missing named ships can appear through an appropriate existing role.
- No role can choose a design unsupported by any corresponding source slot.
- A seeded run selects the same designs before and after save/restore.
- Source combat fields are not copied into `SPECS` or `PIRATE_TIERS`; those
  tables hold only deliberate Harmless presentation/motion/selection policy.
- Custom ships cannot accidentally enter an Elite-A parity matrix.

## Carried over from TODO 23

`persistence.ts` restores every pirate through `pirateSpecForTier`, so a pirate
spawned from the plain `SPECS.pirate` roster — reachable only through the
trainer's hull picker, which never autosaves — would come back on a tier-table
hull while keeping its saved identity. Hull and identity could then disagree.
TODO 23 deliberately did not add a cross-check, because that turns such a save
into a throw; fix it here, where restore learns to rebuild from the saved
design.

## Verify

Add role-membership, complete-catalogue, seeded spawning, snapshot and simulator
tests. Run standard verification and inspect every new ship in the browser.
