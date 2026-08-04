// How the commander's pools come back: the rate the whole model is anchored on,
// and the one fitting that changes it.
//
// SEPARATE FROM `pools.ts` BECAUSE THE TWO HAVE DIFFERENT PROVENANCE. What a
// pool holds is the released game's — 255 is a byte, and every flyable hull's
// capacity comes out of the pack. How fast it refills is not in the pack at
// all: the source gives each hull an `energyRechargeRating` and NO CLOCK, so
// what a rating is worth in seconds is a browser-game decision and is stated
// here as ours. One file is capacities somebody could re-import; this one is
// Harmless policy nobody can look up.
//
// The rule that spends these is `energyRegenPerSecond` in game/systems.ts,
// which is also where a hull's own rating is divided by the Cobra's — that
// anchor has to be read from the Elite-A catalogue and this directory may not
// import, so it stays there. `regenerate` accumulates the result in whole
// sub-ticks rather than as a float sum of dt, so 15, 60 and 144 Hz agree; that
// is a property of the code and not of these numbers.

import { MAX_SHIELD } from './pools.ts';

/**
 * The fraction of a full pool a Cobra Mk III recovers each second — the anchor
 * for the whole recharge model, and the pair of numbers a retune moves.
 *
 * 2.5% and 3.5% of a pool a second, which is a 40-second energy bank and a
 * 28.6-second shield face. `test/systems.test.ts` times both against those two
 * figures through the real `regenerate`, so moving either fraction costs a red
 * line rather than passing quietly.
 *
 * WHERE THEY CAME FROM. Before TODO 27 the bank was 4 whole points recovering
 * 0.1 of a point a second and each shield was 0..1 recovering 0.035, and these
 * are those rates restated as fractions — 0.1/4 and 0.035/1 — so that a Cobra
 * flies exactly the recharge it flew before the pools grew 64 times larger.
 * They were literally written as those quotients until the pre-TODO-27 scale
 * and its migration were deleted (Chris, 2026-08-04: nobody has a save on that
 * scale, so nothing was migrating). The divisors were the last thing keeping
 * the old capacities alive, and a constant that exists only to be a divisor for
 * a scale nothing uses is worse than the arithmetic written out here: a reader
 * would have had to go and look up `LEGACY_MAX_ENERGY` to discover it meant 4.
 * A fraction of a pool per second is what these ARE, on any scale.
 */
export const ENERGY_REGEN_FRACTION = 0.025;
export const SHIELD_REGEN_FRACTION = 0.035;

/**
 * Shield points a second, per face — and only while energy is above
 * `LOW_ENERGY`, which is `regenerate`'s rule rather than this number's.
 *
 * An absolute rate rather than a second fraction, because `recharge` counts
 * whole points into a pool: 255 x 0.035 is 8.925 a second, so a flattened face
 * is back in about 28.6 seconds.
 */
export const SHIELD_REGEN = MAX_SHIELD * SHIELD_REGEN_FRACTION;

/**
 * An energy unit doubles the bank's recharge, exactly as it always did. Applied
 * once, in `energyRegenPerSecond`, so that no caller can helpfully double it a
 * second time.
 */
export const ENERGY_UNIT_MULTIPLIER = 2;
