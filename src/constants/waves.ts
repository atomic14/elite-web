// The wave ramp's arithmetic: how fast the count and the tier climb, and where
// the numbers stop.
//
// The ramp itself — `waveCount`, `waveTier`, the four stated `WAVE_STEPS` and
// the `WAVE_SATURATION` they produce — is `game/combat-sim-scenarios.ts`,
// which holds "who you fight" as one subject. These are only that ramp's
// tunable rates; the steps are a typed table the home may not import.
//
// It must RAMP and then SATURATE, never diverge. A ramp that keeps going turns
// the answer into a number about arithmetic — wave 40 is 40 Fer-de-Lances and
// nobody learns anything from that — where a ramp that stops means the late
// waves are all the same fight and surviving three of them is a fact about
// flying. Both properties are asserted in `npm test`.
//
//   wave   1  2  3  4  5  6  7  8  9 10 11 12+
//   count  1  1  2  2  3  3  4  4  5  5  6  6
//   tier   0  0  0  1  1  1  2  2  2  2  2  2
//
// Organised from wave 7, when the tier tops out and there are enough of them
// to bother forming a gang — the same rule `pirateThreat` uses. From wave 12
// the numbers stop and the FIGHT keeps going: `WAVE_STEPS`.

import { MAX_TIER } from './threat.ts';

/** The most ships a wave ever holds — the ceiling the ramp exists to have. */
export const WAVE_MAX_COUNT = 6;

/** The count grows by one every this many waves... */
export const WAVE_COUNT_EVERY = 2;

/** ...and the tier climbs a rung every this many. */
export const WAVE_TIER_EVERY = 3;

/**
 * One new thing every this many waves, once the numbers have stopped — the
 * count ramp's own cadence, and the point of the spacing: you meet a new thing,
 * and then you meet it again knowing it is coming, which is the difference
 * between learning it and being surprised by it twice.
 */
export const WAVE_STEP_EVERY = 2;

/**
 * From this wave on, count and tier stop growing — six of them, all at the top
 * tier, in a gang. It is NOT where the ramp stops any more; the four
 * `WAVE_STEPS` keep escalating past it, and `WAVE_SATURATION` (derived from
 * them, in game/combat-sim-scenarios.ts) is where every later wave is
 * identical.
 */
export const WAVE_COUNT_SATURATION = Math.max(
  (WAVE_MAX_COUNT - 1) * WAVE_COUNT_EVERY, MAX_TIER * WAVE_TIER_EVERY) + 1;
