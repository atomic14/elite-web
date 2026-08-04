// Where an authored exercise starts its opposition.
//
// `spawnOpposition` in game/spawning.ts lays ships on a ring around the
// commander: an even ring, rotated by a random phase, with everything on top of
// it drawn from the world's seeded stream so the same seed gives the same sky.
// These are the defaults and the bounds of that layout.
//
// NOT `spawn-placement.ts`, which is where a SYSTEM's own traffic goes. The two
// answer different questions and must be free to move apart: a system's
// geometry is about where its traffic would actually be, and an exercise's is
// about what the pilot can see and how soon the fight starts.
//
// A caller may override the range and the cone (game/combat-sim-opening.ts does,
// per scenario). What it cannot override is the SPREAD — the four fractions at
// the bottom — and those are the reason a caller has to size its own cone
// against a product rather than against the angle it asked for.

/**
 * The default ring radius, in units.
 *
 * Far enough to see them coming and close enough to be fighting inside ten
 * seconds: a pirate at 300 and a Cobra at 400 close this in about five, and
 * 9,000 (`PLAYER_INTEREST_RANGE`) is where an NPC starts caring about you at
 * all, so a ring here is already inside everyone's attention.
 */
export const OPPOSITION_RANGE = 3200;

/**
 * A ceiling on it, because the arena's safety margins are what a caller is
 * really trusting.
 *
 * `test/arena.test.ts` builds a real world for 512 systems across two galaxies
 * and measures the arena centre's clearance: worst case 67,530 units above the
 * planet, 77,739 from the station, 392,032 from the sun (measured 2026-08-04).
 * So a ring inside this cannot put a ship in the planet or the station's box
 * however the numbers are passed in.
 */
export const OPPOSITION_RANGE_MAX = 20_000;

/**
 * Half-angle of the cone, in radians, when a facing is known and the caller
 * says no more.
 *
 * A FALLBACK THAT NOTHING SHIPPING USES: every scenario in
 * game/combat-sim-opening.ts states its own cone in degrees, and that file's own
 * note records why — widened by `OPPOSITION_CONE_FAR` this reaches 41 degrees
 * off the nose, which is off the side of the canopy. It is the right default for
 * a caller that has not thought about the canopy and the wrong one for a
 * trainer, so it stays a default rather than becoming the answer.
 */
export const OPPOSITION_CONE = 0.5;

/**
 * The nearest a ship lands, as a fraction of the ring radius...
 *
 * The ring is scattered rather than exact, so a gang does not arrive on the
 * surface of a sphere. Four ships at identical range read as a formation the
 * game placed; four at 0.85 to 1.15 read as four ships that happen to be near
 * each other.
 */
export const OPPOSITION_RING_NEAR = 0.85;

/** ...and the width of that band. */
export const OPPOSITION_RING_SPAN = 0.3;

/**
 * ...so the furthest is this, and a caller sizing an opening against the ring
 * it asked for wants THIS number rather than 1.
 *
 * `test/combat-sim-opening.test.ts` held its own copies of the near and far
 * fractions, transcribed out of the spawner it was checking — so a change to the
 * scatter would have left the test asserting the old band and passing.
 */
export const OPPOSITION_RING_FAR = OPPOSITION_RING_NEAR + OPPOSITION_RING_SPAN;

/**
 * The narrowest a ship lands off the cone's axis, as a fraction of the
 * half-angle asked for...
 *
 * The scatter spreads WITHIN the cone rather than on its surface, and it does
 * not start at zero: a ship placed on the axis is directly ahead of the
 * commander, which looks staged. So the innermost is a little over half the
 * angle out.
 */
export const OPPOSITION_CONE_NEAR = 0.55;

/** ...and the width of that band. */
export const OPPOSITION_CONE_SPAN = 0.9;

/**
 * ...so the widest is this — and THIS is the number a caller has to fit inside
 * the canopy.
 *
 * A cone of 8 degrees puts its widest ship 11.6 degrees off the nose, which is
 * what game/combat-sim-opening.ts sizes against. Asking for the angle you want
 * to see and getting 1.45 times it is the trap this constant exists to make
 * visible; it was written out as a bare 1.45 in two files that could not see the
 * spawner.
 *
 * Derived rather than written as 1.45 because the sum is what the spawner
 * actually computes — and in binary floating point `0.55 + 0.9` is
 * 1.4500000000000002, not 1.45, so a reader who wrote the rounded figure into a
 * bound would be off by the wrong sign.
 */
export const OPPOSITION_CONE_FAR = OPPOSITION_CONE_NEAR + OPPOSITION_CONE_SPAN;
