// Where an attack run is aimed: beside the target, and ahead of it.
//
// An attack run has to pass beside where the target WILL BE, on a line it has
// room to get onto. These three numbers say how far beside and how far ahead;
// `game/pass-aim.ts` turns them into a heading.

/**
 * How far to the SIDE of its target a ship aims its attack run.
 *
 * A pirate hull's contact radius plus the commander's 25 runs from 32 to 55, so
 * 110 clears the largest twice over while staying inside the gun's firing gate
 * on the way in. Aiming at the target instead costs 104 points of contact damage
 * an episode; widening to 130 cuts contact no further and costs lethality.
 *
 * It is the miss the ship AIMS for, not the one it gets — a straight line to a
 * stale point delivered 75. `passMissDistance` is the correction.
 */
export const PASS_MISS_DISTANCE = 110;

/**
 * The furthest ahead of a target a ship will aim, in seconds.
 *
 * A lead extrapolates a straight line, and the commander pitches at 1.45 rad/s,
 * so half a second is already 41 degrees of heading change. Measured against a
 * manoeuvring target over 100 episodes: 0.032 contact per merge at 0.5s against
 * 0.047 at a full second.
 */
export const MAX_LEAD_SECONDS = 0.5;

/**
 * The most the aim may be stretched by the geometry, in multiples of the
 * intended pass.
 *
 * It binds only where no heading opens the gap asked for — a merge too fast or a
 * range too short. Past it the ship flies more across its run than along it,
 * which is the orbit this flight model replaced.
 */
export const MAX_MISS_STRETCH = 3;
