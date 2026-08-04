// The combat ladder: what a commander's combat score adds up to being CALLED.
//
// The 1984 ladder, with Below Average in the place the original had it — ten
// rungs, not nine. The functions that read it (`rating`, `ratingLadder`) are
// game/rating.ts; the manual renders the chart from the same table, which is
// the fix for the day it listed the nine ranks it could remember and a
// commander could read their own rating off the status screen and fail to
// find it on the chart.
//
// The score the ladder is climbed with is `combatScore` — kills weighted by
// threat tier (`killValue` in game/commander.ts), a deliberate deviation from
// the original's flat body count so the fastest route to E L I T E is not
// farming the weakest thing you can find.

/**
 * Score thresholds and the name each one earns, lowest first.
 *
 * The Dangerous rung doubles as the threat model's fame saturation:
 * `threat.ts`'s `FAME_FULL` is an expression over this table, so "your name
 * fully precedes you" and "the ladder calls you Dangerous" cannot drift
 * apart. `test/economy.test.ts` still bisects both out of the real functions.
 */
export const RATINGS: readonly (readonly [number, string])[] = [
  [0, 'Harmless'],
  [8, 'Mostly Harmless'],
  [16, 'Poor'],
  [32, 'Below Average'],
  [64, 'Average'],
  [128, 'Above Average'],
  [512, 'Competent'],
  [2560, 'Dangerous'],
  [6400, 'Deadly'],
  [25600, 'E L I T E'],
];
