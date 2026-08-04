// Scooping drifting cargo: the reach.
//
// One number, because collection is one rule: fly this close to a canister
// or an escape capsule and it is aboard — whether that is a windfall, a
// rescue or a legal problem is the Game's business (game/cargo.ts reports,
// the Game decides). Scooping FUEL off the sun is a different rule at a
// different scale entirely: `SUN_SCOOP_RANGE` and `SCOOP_RATE` in sun.ts.

/**
 * How close the commander must fly to scoop a drifting object, in world
 * units.
 *
 * Under twice the commander's own contact radius (25, collision.ts), so
 * scooping reads as flying THROUGH the canister rather than vacuuming it
 * from a distance — you line up on a 12-unit object, which is why it is a
 * deliberate act and why the fuel-scoops fitting is what makes it safe
 * (hitting one without them is `IMPACT.canisterOnHull`).
 */
export const SCOOP_RANGE = 45;
