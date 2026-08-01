# 22 — Implement the pure Elite-A combat oracle

**Kind:** rules foundation · **Severity:** high · **Size:** medium
**Depends on:** 21

## Why

The Swift sample and JSON matrices define exact arithmetic, while Harmless's
live combat currently uses fractional balance values. Before changing behavior,
we need one pure TypeScript owner for the new rules and proof that it reproduces
the supplied data.

## Implementation

Create a browser-free `src/game/elite-a/combat-math.ts` that owns:

- `npcDefence(maxEnergy) = maxEnergy & 7`;
- player laser decoding: continuous high bit, seven-bit power, then `>> 1`;
- Constrictor incoming multiplier, applied before defence and floored;
- `max(0, scaledHit - defence)` damage to an NPC;
- clean NPC laser strength, `laserPower << 2`;
- released packed-byte strength, `weaponByte >> 1`, as a diagnostic-only mode;
- per-hit player armour subtraction;
- destruction at `energy <= 0`;
- hits-to-destroy using ceiling division when damage is positive; and
- elapsed-time regeneration clamped to maximum energy.

Use integers for registered-hit arithmetic and numbers for accumulated
time-based energy. Do not import `NpcShip`, `PlayerShip`, Three.js, RNG, HUD or
the generated geometry.

## Acceptance

- The clean rule reproduces every one of the 15,600 player-to-NPC rows and
  every one of the 3,900 NPC-to-player rows.
- All 570 summarized min/max ranges are reproduced from exact variants rather
  than trusted as a second implementation.
- Tests cover station immunity, no-damage cases, Constrictor halving,
  continuous-bit masking, missile-count independence, the original diagnostic
  mode, exact-zero destruction and negative `dt` clamping.
- Regeneration totals match at 15, 60 and 144 Hz for equal elapsed time.
- No shipped gameplay behavior changes in this TODO.

## Verify

Add a dedicated oracle test file to `test/run.ts`, run it directly, then run
the standard verification commands.
