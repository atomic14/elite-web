// The torus jump drive: how much faster it is, and what makes it let go.
//
// One feature, and the manual says so in one breath — "torus jump drive (8x;
// cuts out when something massive is near)". The multiplier is what the drive
// BUYS and the three radii are its whole price: there is nowhere in the game a
// reader can act on one of these without the others, because a drive that
// never cuts out is a teleport and a cut-out with no drive to cut is nothing.
//
// The rules that spend them are `flyPlayer` and `massLocked` in
// game/world-step.ts. What the drive LOOKS like at speed is world/starfield.ts,
// whose streak thresholds are chosen against the top speed this produces.

/**
 * How much faster the torus drive travels than ordinary flight — the TOTAL,
 * which is what every reader of this number means by it.
 *
 * IT HAD FIVE HOMES AND TWO SPELLINGS. The step added `speed * 7 * dt` on top
 * of the `speed * dt` that `player.update()` had already applied that frame,
 * for a total of 8; the dust streaks were sized at `speed * 8`; the manual
 * captions the key "8x"; the briefing calls it "eight times speed"; and
 * starfield.ts justified its two fade thresholds in prose with "8 x 400 =
 * 3200". They agreed only because 7 + 1 = 8, and nothing anywhere said so.
 * Change the physics to 9 and the dust stops matching the ship, both prose
 * surfaces lie, and the starfield's justification silently stops holding.
 *
 * So the total is the constant, and the step adds `TORUS_MULTIPLIER - 1`
 * because the plain first multiple is already in the ship's position by the
 * time it runs. `8 - 1 === 7` exactly, so expressing it moved nothing.
 *
 * At the commander's 400 this is 3,200 units a second, which is the figure the
 * starfield's streaks are faded against and roughly a 28-second run in from the
 * witchpoint (see `WITCHPOINT_RADII`).
 */
export const TORUS_MULTIPLIER = 8;

/**
 * How near the station holds the drive down.
 *
 * The three radii below are ONE rule with three answers — `massLocked()` in
 * game/world-step.ts is true if any of them is — and they are separate numbers
 * because the three things are different sizes and mean different amounts of
 * trouble. They were three unnamed literals inside that one function.
 *
 * The station's is the largest of the three: it is measured to the station's
 * CENTRE rather than to its hull, and the point of it is that you cannot torus
 * past the slot you are trying to thread. `test/arena.test.ts` holds the
 * combat arena clear of it in all 256 systems of two galaxies.
 */
export const MASS_LOCK_STATION = 5000;

/**
 * ...and how near the planet, as an ALTITUDE above the surface rather than a
 * distance to the centre — a planet is tens of thousands of units across and
 * its radius varies with the seed, so a centre distance would mean something
 * different in every system.
 *
 * Far above `PLANET_CRASH_ALTITUDE`: the drive lets go long before the ground
 * is a danger, which is what makes the last of an approach a flown descent
 * rather than an arrival.
 */
export const MASS_LOCK_PLANET_ALTITUDE = 4000;

/**
 * ...and how near another ship — any live one that is not a rock.
 *
 * Asteroids are excluded deliberately: a field of them is scenery, and a torus
 * drive that cut out on every rock in the sky would strand you in a system with
 * nothing to fight. Between the station's 5,000 and the planet's 4,000 with
 * nothing forcing the order; what it buys is that a pirate who has come to meet
 * you gets to keep you, which is the whole reason an interception works.
 */
export const MASS_LOCK_SHIP = 4500;
