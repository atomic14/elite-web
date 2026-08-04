// Keeping wingmen out of each other's way: one vector out of two positions.
//
// The ranges are `constants/separation.ts`. This is deliberately not a general
// steering behaviour — it is "there is a hull there, be somewhere else", applied
// two ways: while CLOSING it bends the aim point so ships pick different lines
// in (prevention), and while PASSING it is the only thing allowed to steer, and
// only when a mate is genuinely close (cure), so the committed run still clears
// the target.
//
// Pure, allocation-free, and it takes positions rather than ships so a test can
// place two hulls exactly where it wants them.

import * as THREE from 'three';
import { SEPARATION_RANGE } from '../constants/separation.ts';

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
