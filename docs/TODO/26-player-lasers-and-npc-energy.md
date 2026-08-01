# 26 — Use exact player lasers, NPC energy and defence

**Kind:** live combat migration · **Severity:** critical · **Size:** large
**Depends on:** 22, 23, 25

## Why

Player lasers currently deal normalized fractions against hand-authored NPC
HP. This TODO replaces that direction of live combat with Elite-A's integer
laser, energy and per-hit defence rules.

## Rules

```text
player hit = (laserByte & 0x7f) >> 1
NPC defence = maxEnergy & 7
damage = max(0, hit - defence)
Constrictor hit = hit >> 1 before defence
destroy when currentEnergy <= 0
```

Stations are immune to player lasers. Ordinary AI ships regenerate one energy
point per elapsed second; stations, missiles, cargo and rocks do not.

## Implementation

1. Make `laserForView()` return pacing fields plus an exact hit value resolved
   from `(commander.shipId, fitted laser type)`. Current front/rear/side fitting
   behavior stays intact.
2. Support all four source laser types in the profile API and oracle. The live
   equipment redesign that turns the existing mining attachment into a true
   mounted mining laser remains deferred and must be documented as such.
3. Replace `NpcSpec.hp` and `NpcShip.state.hp` with source-scale
   `maxEnergy/currentEnergy` from `NpcCombatProfileId`.
4. Apply the target profile's immunity and Constrictor modifier in the pure
   combat rule, not as mission or hull-name conditionals in the caller.
5. Regenerate eligible targets from elapsed simulation time, clamped to their
   maximum. Do not grant background/pause catch-up bursts.
6. Migrate legacy snapshots by preserving old HP fraction against the resolved
   profile's `maxEnergy`; exact new snapshots round-trip the point value.
7. Keep AI and HUD health observations normalized at their presentation/input
   boundaries.
8. Until TODO 28 audits secondary damage, route every non-laser NPC damage
   source through one named compatibility conversion. No caller may pass an old
   fractional literal directly into an integer energy pool.
9. Give custom Harmless profiles explicit energy/defence/regeneration policy;
   exclude them from claims of source parity.

## Acceptance

- The pure and live calculation agree for all 15 player hulls, four laser
  types and 260 exact target variants: all 15,600 supplied rows.
- All 570 hit-range summaries and hits-to-destroy results agree.
- Tests cover immunity, zero damage, one-point damage, exact-zero destruction,
  overkill, Constrictor order of operations and continuous-bit masking.
- Regeneration totals match at several frame-step partitions.
- Save/restore preserves exact profile identity, energy and RNG continuation.
- The only remaining normalized-to-energy bridge is the named TODO 28 adapter.

## Verify

Run the exhaustive outgoing oracle, live integration, snapshot, HUD and
frame-rate tests, then the standard verification commands.
