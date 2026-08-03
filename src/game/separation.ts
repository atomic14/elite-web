// Keeping wingmen out of each other's way.
//
// Chris, having flown the attack run in waves: "I think we need to get the npc
// better at collision avoidance though - they crashed into each other a couple
// of times."
//
// WHY IT HAPPENS is specific, and it is a consequence of the fix that stopped
// them ramming the PLAYER. An attack run's middle phase commits to a heading
// and does not steer at all — that is what carries a ship past its target
// instead of into it (see break-off.ts). A ship in that phase is therefore
// blind to everything, wingmen included, and several ships converging on one
// target arrive in the same small volume at the same moment by construction.
// Measured over 40 eight-ship engagements the one collision that occurred had
// BOTH ships in `passing`.
//
// So this is deliberately not a general steering behaviour. It is one vector,
// perpendicular to nothing and aimed at nobody: "there is a hull there, be
// somewhere else." It is applied two ways, and the difference between them is
// the whole design:
//
//   - while CLOSING, it bends the aim point, so ships pick different lines in
//     on the way and never meet at the merge. Prevention.
//   - while PASSING, it is the ONLY thing allowed to steer, and only when a
//     mate is genuinely close. Cure, kept as small as possible so the run still
//     clears the target it committed to.
//
// Pure, allocation-free, and it takes positions rather than ships so a test can
// place two hulls exactly where it wants them.

import * as THREE from 'three';

/**
 * How near a wingman has to be before a ship cares.
 *
 * 200, chosen by sweeping it against a cost it genuinely has. Two hulls are
 * roughly 68 units of radius before they touch, so this is about three decision
 * ticks of warning at the closures the game produces — enough to bend a line
 * and not enough to spend the fight dodging ships that were never going to hit.
 *
 * The cost is aggression, and it is not small when a fight is crowded: every
 * ship is near SOMEBODY, so a wide radius has them all flying around each other
 * instead of at the target. Measured over 40 engagements, near misses inside
 * 120 units against completed attack runs per fight:
 *
 *   range/push      5 ships                 8 ships
 *   off          7849 miss · 27.8 passes  17771 miss · 36.6 passes
 *   260/180      3736 miss · 24.7 passes   5798 miss · 19.4 passes  <- too strong
 *   200/120      4261 miss · 25.4 passes  10589 miss · 24.4 passes  <- this
 *   160/110      6720 miss · 26.8 passes  14146 miss · 31.9 passes
 *
 * 260 halved the near misses again and cost nearly half the attack runs at
 * eight ships, which is the pack behaviour undone — a gang that spreads out is
 * not a gang. 200 keeps most of the spacing for 8% of the runs in a five-ship
 * fight, which is the size a wave actually is.
 *
 * It stays smaller than `BREAK_OFF_RANGE` for the same reason.
 */
export const SEPARATION_RANGE = 200;

/**
 * How hard a closing ship bends its aim to avoid a mate, in units of offset.
 *
 * Scaled by how close the mate is, so a distant one costs nothing and one about
 * to be hit moves the aim point a long way. 120 at full strength, a shade above
 * `PASS_MISS_DISTANCE` — missing a wingman matters as much as missing the
 * target, and the two numbers being close is not a coincidence: both are "how
 * far to one side of a hull is far enough".
 */
export const SEPARATION_PUSH = 120;

/**
 * A unit vector away from the nearest mate worth avoiding, and how much it
 * matters — 0 when there is nobody near, 1 when contact is imminent.
 *
 * Returns the urgency and writes the direction into `out`, so the caller can
 * skip the work entirely on a 0 without this having allocated anything. The
 * NEAREST mate only: steering away from an average of several ships aims at a
 * gap that may not exist, and the one about to be hit is the one that matters.
 *
 * `mates` may include the ship itself — it is skipped by position identity
 * rather than by index, so a caller does not have to know where it sits in the
 * fleet, and a caller that passes a filtered list gets the same answer.
 */
export function separationFrom(
  me: THREE.Vector3,
  mates: readonly THREE.Vector3[],
  out: THREE.Vector3,
): number {
  let nearest: THREE.Vector3 | null = null;
  let nearestD = SEPARATION_RANGE;
  for (const mate of mates) {
    if (mate === me) continue;
    const d = me.distanceTo(mate);
    if (d < nearestD) { nearestD = d; nearest = mate; }
  }
  if (nearest === null) return 0;
  out.copy(me).sub(nearest);
  const len = out.length();
  // Two hulls in exactly the same place have no direction to separate along.
  // Any direction will do and none is better, so take one rather than
  // normalising a zero vector into NaNs that would reach the ship's position.
  if (len < 1e-4) { out.set(1, 0, 0); return 1; }
  out.divideScalar(len);
  // Linear in how far inside the range it is: 0 at the edge, 1 at contact.
  return 1 - nearestD / SEPARATION_RANGE;
}
