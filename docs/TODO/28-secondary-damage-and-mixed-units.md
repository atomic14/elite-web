# 28 — Audit secondary damage and remove mixed units

**Kind:** combat audit · **Severity:** critical · **Size:** medium
**Depends on:** 26, 27

## Why

Laser parity will introduce NPC energy points and player 255-point defence into
a game whose missiles, collisions, hazards and scripts still use normalized
fractions. Leaving implicit conversions would make correct laser rules coexist
with incorrect combat.

## Implementation

1. Check in a damage-path inventory with source, target, old unit, new unit,
   owner and source-backed or Harmless-policy classification for:
   - player, NPC and NPC-to-NPC lasers;
   - player and NPC missiles;
   - energy bomb effects;
   - ship, station, cargo and rock collisions;
   - docking impacts and sun/heat hazards;
   - mission, campaign, simulator and debug damage.
2. Introduce narrow constructors/functions for NPC-energy damage and player
   defence damage so raw normalized literals cannot cross the boundary.
3. Make NPC-to-NPC laser hits use the attacker's combat profile and defender's
   exact energy/defence profile.
4. For source-unspecified damage, calibrate one named Harmless rule using
   explicit Cobra Mk III and representative-NPC anchors. Preserve relative
   threat where practical without calling the result an Elite-A fact.
5. Ensure Constrictor halving and station immunity apply only to player lasers,
   not automatically to missiles, collisions or hazards.
6. Apply source profiles to targetable missiles and world objects where the
   game supports damaging them.
7. Version reports/snapshots whose numbers changed meaning.
8. Delete the temporary conversion adapters from TODOs 26 and 27.
9. Search for direct health mutation, old fractional damage literals and
   bypasses around central damage functions; add a regression check for known
   legacy paths.

## Acceptance

- Every live damage path has a deterministic test and an inventory row.
- NPC-to-NPC laser arithmetic uses the same pure oracle as player-facing paths.
- Missiles, collisions, hazards and scripts convert exactly once.
- No implicit conversion remains among normalized observations, NPC energy and
  player defence points.
- Custom generation/hermit policies are explicit and source designs use their
  imported profiles.
- All temporary mixed-unit adapters are gone.

## Verify

Run the damage inventory suite, repository legacy-path check, simulations and
standard verification commands.
