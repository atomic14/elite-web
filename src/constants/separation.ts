// Keeping wingmen out of each other's way: how near is near enough to care, and
// how hard to bend the line when it is.
//
// A ship in the `passing` phase commits to a heading and steers for nothing, so
// it is blind to its wingmen, and several ships converging on one target arrive
// in the same volume at the same moment. `game/separation.ts` is the vector.

/**
 * How near a wingman has to be before a ship cares.
 *
 * Two hulls are ~68 units of radius before they touch, so 200 is about three
 * decision ticks of warning. The cost is aggression: swept over 40 engagements,
 * 260 halves the near misses again and costs nearly half the attack runs at
 * eight ships, which is the pack behaviour undone. Stays below
 * `BREAK_OFF_RANGE`.
 */
export const SEPARATION_RANGE = 200;

/**
 * How hard a closing ship bends its aim to avoid a mate, in units of offset,
 * scaled by how close the mate is.
 *
 * A shade above `PASS_MISS_DISTANCE`: both are "how far to one side of a hull is
 * far enough".
 */
export const SEPARATION_PUSH = 120;
