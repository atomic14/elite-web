// The combat ladder: what a commander's kills add up to being CALLED.
//
// A leaf, and deliberately: it imports nothing, so a page that wants to print
// the ladder does not drag a commander, a galaxy and the whole Elite-A
// catalogue in behind it. That is not hypothetical — the manual page listed the
// nine ranks it could remember, missing BELOW AVERAGE, so a commander could
// read their own rating off the status screen and fail to find it on the chart.
// Rendering the page from the table is the fix (same bargain as the key tables,
// invariant 9), and rendering it from `commander.ts` would have put 220 kB of
// ship data on a text page.
//
// It lived in commander.ts, which is about the SHAPE of a commander. What you
// are called is a pure function of one number and has nothing to do with that
// shape.

/**
 * Score thresholds and the name each one earns, lowest first.
 *
 * The 1984 ladder, with `Below Average` in the place the original had it —
 * ten rungs, not nine.
 */
const RATINGS: readonly (readonly [number, string])[] = [
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

/** What `combatScore` is called. */
export function rating(combatScore: number): string {
  let r = RATINGS[0][1];
  for (const [threshold, name] of RATINGS) {
    if (combatScore >= threshold) r = name;
  }
  return r;
}

/**
 * Every rank in order, lowest first — the ladder as a list.
 *
 * It exists because the ladder had a second and a third home: the manual page
 * printed it by hand, and `test/campaign.ts` kept its own copy to time the
 * climb. Both render from this now.
 */
export function ratingLadder(): readonly string[] {
  return RATINGS.map(([, name]) => name);
}
