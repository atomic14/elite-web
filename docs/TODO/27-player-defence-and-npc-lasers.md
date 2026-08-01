# 27 — Use 255-point player defence and clean NPC lasers

**Kind:** live combat migration · **Severity:** critical · **Size:** large
**Depends on:** 22, 23, 25, 26

## Why

NPC fire currently rolls normalized damage against `1/1/4` player systems.
Elite-A uses the firing variant's laser power, the active player hull's
per-hit armour, and 255-point fore shield, aft shield and energy capacities.

## Rules

```text
NPC hit before armour = laserPower << 2
damage = max(0, hit - playerHull.perHitShieldArmour)
fore shield = 255
aft shield = 255
energy = 255
```

Apply damage to the existing front/aft impact face, spill the remainder into
energy, and destroy at energy `<= 0`. The packed released diagnostic
`weaponByte >> 1` remains test-only because its missile bits must not alter
laser damage.

## Implementation

1. Replace the random NPC damage roll with the attacker's exact combat-profile
   laser power. Preserve current hit chance, cadence, range and aim behavior.
2. Resolve per-hit armour from `commander.shipId`, so all 15 player profiles
   work even though only Cobra Mk III is currently selectable in the UI.
3. Move player systems and snapshots to 255-point shield and energy units.
4. Apply armour once per registered NPC laser hit, before shield/energy damage.
5. Preserve current equipment-damage consequences when a hit reaches energy,
   but ensure their probability is not multiplied by the unit conversion.
6. Convert energy/shield recharge with named browser-game constants anchored to
   current Cobra Mk III real-time behavior. Apply the source hull recharge
   rating and existing energy-unit effect exactly once; label the conversion as
   Harmless policy rather than recovered source arithmetic.
7. Migrate old system values fractionally from their former maxima to 255.
8. Update HUD, warnings, reports, durability helpers and AI observations so no
   caller assumes the former `1/1/4` maxima.
9. Route incoming non-laser damage through the temporary TODO 28 conversion
   boundary.

## Acceptance

- The clean rule reproduces all 3,900 supplied NPC-to-player rows.
- Missile-count bits cannot influence live laser damage.
- Tests cover full armour absorption, one-point penetration, front/aft shield
  choice, spillover, destruction and equipment damage.
- All 15 player hull armour values are exercised through the runtime path.
- Legacy fractional migration and exact new-format save round trips pass.
- Recharge is frame-rate independent and applies hull/equipment multipliers
  once.

## Verify

Run the exhaustive incoming oracle, live fire, system migration, recharge, HUD
and snapshot tests, then the standard verification commands.
