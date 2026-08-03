// WHEN A MISSILE LEAVES THE RAIL — and nothing about where it goes afterwards.
//
// The pair to `ordnance.ts`, which owns missiles IN FLIGHT: spawn, homing,
// E.C.M. defeat, impact. This file owns the decision that precedes all of that,
// and it is a rule rather than a simulation, so it is pure and it is here where
// a test can reach it without a world.
//
// It was the last third of `gunnery.ts`, which is otherwise entirely about the
// LASER — the firing cone, the hit chance, the trigger pull, the ranges. Two
// subsystems in one file, and the file crossed 400 lines when the launch rule
// grew a reason for existing. "It is long" is not a reason to allowlist, and
// "what is this file FOR" had an `and` in the answer, so it split at the seam
// that was already there.

/**
 * The far edge of the seeker's envelope — beyond this a missile is thrown away.
 *
 * There used to be a MIN of 1200 and a CHANCE of 0.3 beside it, and together
 * they made a standoff weapon: a ship 1,200 to 3,200 out rolled 30% to send a
 * missile instead of a bolt, so the launch window was exactly the range at
 * which nothing was engaging. See `npcMissileEmergency` for what that did to a
 * wave-13 fight and why both are gone. The inner edge is now
 * `MISSILE_LAST_STAND_MIN_RANGE` for every launch rather than only desperate
 * ones, because the reason it exists — an undodgeable weapon is not a fight —
 * was never specific to desperation.
 */
export const MISSILE_MAX_RANGE = 3200;
/**
 * Hull fraction below which a ship stops saving its missiles for later.
 *
 * A pirate used to go down with them still on the rail, because the only way one
 * ever left was the opportunistic roll above — which fires at the moment the
 * ship takes a LASER shot, and a nearly-dead pirate is usually not lined up
 * enough to be taking one. A missile it never launches is worth nothing.
 */
export const MISSILE_LAST_STAND_HULL = 0.4;
/**
 * ...and it launches on a bearing rather than a firing line. A missile homes, so
 * the only reason to ask for any aim is that it leaves the nose: the target has
 * to be in the half of the sky the ship points at. Compare NPC_FIRE_GATE.
 */
export const MISSILE_LAST_STAND_GATE = Math.PI / 2;
/**
 * Desperation widens the envelope INWARD — the knife-range launch a pirate would
 * never waste a missile on is the only one left — but not all the way: inside
 * this the missile arrives before the player can reach the E.C.M. or turn, and
 * an undodgeable weapon is not a fight.
 */
export const MISSILE_LAST_STAND_MIN_RANGE = 250;
/** Gap between launches, so a Python does not empty both rails in one frame. */
export const MISSILE_RELOAD = 2;

/**
 * How many passes a ship makes before it accepts this is not going its way.
 *
 * Chris: "missiles are expensive, they should be used in emergencies — e.g.
 * when your opponent turns out to be tougher than you thought." Two of them
 * IS that discovery: it has committed twice, put its guns on the target twice,
 * and the target is still there.
 */
export const MISSILE_COMMIT_PASSES = 2;

/**
 * Is this ship in enough trouble to spend a missile?
 *
 * THE OPPORTUNISTIC LAUNCH IS GONE, and deleting it is the point rather than a
 * side effect. It was `dist > 1200 && dist < 3200 && roll < 0.3` — a dice roll
 * in a distance band — and the band was the whole problem: a ship only
 * "preferred" a missile when it was 1,200 to 3,200 units out, which is exactly
 * when it is NOT engaging. Six organised pirates therefore sat at a median of
 * 2,705 units, made ZERO passes between them, and killed a commander in 9.1
 * seconds with five launches. He never fired a shot. 94% of the damage was
 * missiles and the fight never happened, because the rule paid ships to stand
 * off and the attack run they were flying paid them to come in.
 *
 * Three ways in now, and each is a REASON rather than a roll:
 *
 *   - `hull <= MISSILE_LAST_STAND_HULL` — about to die, spend it or lose it.
 *     This is the original desperation launch and it is unchanged.
 *   - `passes >= MISSILE_COMMIT_PASSES` — it has flown at the target twice and
 *     the target is still flying. This is Chris's "tougher than you thought",
 *     and it is what makes a missile something a ship EARNS by engaging.
 *   - `matesLost > 0` — the gang is losing. One of us is already gone.
 *
 * A ship that has done none of those has no business launching, however good
 * the geometry is. The range and bearing gates still apply on top: `dist`
 * inside the seeker's envelope, and a bearing the ship could plausibly
 * launch on.
 */
export function npcMissileEmergency(
  hull: number, passes: number, matesLost: number,
  dist: number, bearing: number,
): boolean {
  if (dist <= MISSILE_LAST_STAND_MIN_RANGE || dist >= MISSILE_MAX_RANGE) return false;
  if (bearing >= MISSILE_LAST_STAND_GATE) return false;
  return hull <= MISSILE_LAST_STAND_HULL
    || passes >= MISSILE_COMMIT_PASSES
    || matesLost > 0;
}

/*
 * `npcMissileLastStand` used to live here — the desperation launch, hull <= 0.4.
 * It is not gone as a RULE, it is the first of the three reasons inside
 * `npcMissileEmergency`. Keeping it as a second entry point would have been one
 * rule with two homes, which is the failure this codebase is organised against:
 * both would have had to keep the same range and bearing gates in step by hope.
 */
