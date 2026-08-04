// The planet as a distance: how far out a jump leaves you, and where the
// ground is.
//
// TWO RUNGS OF A LADDER WITH A THIRD IN ANOTHER FILE. Flying in from the
// witchpoint you meet them in this order:
//
//     16 radii   a jump drops you here                WITCHPOINT_RADII
//        4,000   the torus drive lets go              MASS_LOCK_PLANET_ALTITUDE
//           80   the ship is gone                     PLANET_CRASH_ALTITUDE
//
// The middle one is `torus.ts`'s, because it is the drive's cut-out rather than
// the planet's — one rule with three radii, and splitting it to complete a
// ladder here would be the worse trade. The order still matters and is stated
// once, here: the drive has to let go far enough out that the last of the
// approach is flown, and the ground has to be far enough below that that a
// mass-locked descent is not already fatal.
//
// Both are measured against the planet's own radius, which is drawn from the
// system seed and differs everywhere — an absolute coordinate would mean
// something different in every one of the 2,048 systems. What the planet LOOKS
// like is world/planet.ts, which shares nothing with this.

/**
 * How far out of the planet you drop from witch-space, in planet radii.
 *
 * Was 12, which measured badly against what it is supposed to feel like: the
 * planet came out 9.6 degrees wide — a sixth of the screen height, a ball
 * hanging in front of you rather than a world you have yet to reach — and the
 * clean torus run to the station took 17.8 seconds.
 *
 * 24 turned out to be too far the other way — a 43 second cruise before
 * anything happens. 16 puts the planet at 7.2 degrees and the clean run at
 * about 28 seconds: still a journey you notice, no longer one you resent.
 * The arrival pirates scatter along the corridor proportionally
 * (populateSystem uses the route length) so the ambush spread scales with it.
 *
 * The combat trainer's arena sits at the same 16 radii, anti-sunward
 * (`ARENA_RADII` in game/combat-sim-opening.ts). That is a SEPARATE rule at the
 * same number and it stays a separate number: it was measured for its margins
 * to the sun, the station and the ground across 768 systems, and moving where a
 * jump leaves you should not silently move where an exercise is fought.
 */
export const WITCHPOINT_RADII = 16;

/**
 * Altitude above the surface at which the ship is destroyed.
 *
 * A hard floor rather than a landing: Harmless has no surface to land on, so
 * the planet is a sphere you must not touch. It is checked in `checkHazards`,
 * beside the sun's own kill radius (`constants/sun.ts`), and the two are the
 * ways a leg ends with no countdown.
 *
 * 80 is what shipped and nothing records how it was chosen. What can be said
 * for it is scale: three times the commander's own contact radius
 * (`COMMANDER_HULL_RADIUS`), and a fifth of a second at top speed — close
 * enough to read as touching the surface rather than as a shell above it.
 */
export const PLANET_CRASH_ALTITUDE = 80;
