// The sun as a hazard and as a fuel supply: four distances, what the cabin does
// about them, and what you get for the risk.
//
// THE FOUR DISTANCES ARE ONE ORDERED LADDER and that is the only reason they
// are in one file. Coming in from deep space you meet them in this order:
//
//     110,000  the cabin starts to warm            SUN_HEAT_START
//      80,000  the scoops start to gather          SUN_SCOOP_RANGE
//      26,840  the cabin reaches CABIN_TEMP_FATAL  (SUN_HEAT_MAX's ramp)
//      21,000  the ship is gone regardless         SUN_KILL_DIST
//
// Each rung buys something from the one below it. Warming before scooping means
// a sun-skim run always costs you heat; the fatal temperature arriving before
// the kill radius means the cabin gauge is a real warning rather than
// decoration; scooping outside the fatal band means there is a place to sit and
// fill the tank. Swap any two and sun-skimming stops being the trade it is.
//
// Nothing enforced that ordering — the rungs were four literals in two files,
// and game.ts carried a comment describing the order for constants that had
// already left it. `test/systems.test.ts` now walks in through `scoopFuel` and
// `updateCabinTemp` and asserts what each rung BUYS, which is a check the
// numbers can fail rather than a comment they can outlive.
//
// For scale: the sun orbits about 320,000 out (world/system-scene.ts), so the
// hot part of a system is the last third of the way to it. What the sun LOOKS
// like is world/sun.ts, which shares nothing with this.

/** Closer than this and the cabin starts to warm. */
export const SUN_HEAT_START = 110_000;

/**
 * Close enough to scoop fuel, if you have the scoops for it.
 *
 * Inside `SUN_HEAT_START`, so you are always warm before you are earning: at
 * this range the cabin settles at 36% and stays there indefinitely, which is
 * the safe end of sun-skimming. Everything past it is a choice.
 */
export const SUN_SCOOP_RANGE = 80_000;

/**
 * The bottom of the temperature ramp: at this distance the cabin's TARGET is
 * 1.0, and it passes `CABIN_TEMP_FATAL` at 26,840 on the way in.
 *
 * Temperature is linear in distance between here and `SUN_HEAT_START`, so this
 * is a slope end-point rather than a place anything happens — nothing tests the
 * distance against it.
 */
export const SUN_HEAT_MAX = 26_000;

/** Fly this close and the ship is gone, temperature or not. */
export const SUN_KILL_DIST = 21_000;

/**
 * How fast the cabin follows the temperature its distance implies, as a
 * first-order lag in reciprocal seconds.
 *
 * SUN-SKIMMING IS RIDING THE HOT ZONE ON PURPOSE, so the lag is the mechanic
 * rather than a smoothing filter: it is what gives you time to pull out. From
 * cold, sitting at the bottom of the ramp reaches the fatal temperature in 3.8
 * seconds, which is a few seconds of dipping in and out and not a free pass.
 *
 * Applied as `Math.min(1, dt * CABIN_TEMP_LAG)` per frame, so unlike the
 * recharge it is NOT exactly frame-rate independent — one second of full heat
 * measures 0.714 at 15 Hz against 0.700 at 144 Hz. Two percent, in a quantity
 * you have seconds to react to, and correcting it to a true exponential would
 * move the number a player feels; recorded rather than fixed.
 */
export const CABIN_TEMP_LAG = 1.2;

/**
 * The cabin temperature that kills you, on the gauge's own 0..1 scale.
 *
 * 0.99 rather than 1.0 because the lag above only ever APPROACHES its target:
 * `cabinTemp` climbs by a fraction of the remaining gap each frame and reaches
 * exactly 1.0 at no finite time, so a test for 1.0 would let you sit at the
 * bottom of the ramp forever. The doc comment on `ShipSystems.cabinTemp` said
 * "1.0 is fatal" for as long as the code has said 0.99.
 */
export const CABIN_TEMP_FATAL = 0.99;

/** Tonnes of fuel — tenths of a light year — gathered per second while scooping. */
export const SCOOP_RATE = 5;
