// The run-out, as numbers: a curve rather than a straight line.
//
// `extending` used to steer for nothing, so the whole 180 had to happen in the
// closing leg and the ship had to fly a long way out to have room for it. These
// two shape the curve; `game/extend-arc.ts` ramps it.

/**
 * The angle the run-out holds off the OUTWARD radial, at its tightest.
 *
 * A ship flying at `psi` to the radial opens the range at `v·cos(psi)`, so while
 * psi < 90 the run-out always terminates; it arrives `180 - psi` off its target
 * instead of a full 180, which is the turn the closing leg no longer has to make
 * room for.
 *
 * 60 degrees is the knee. Swept over 40 episodes a row, the merge-to-merge gap
 * falls 8.28s at 0 degrees to 7.22s at 60 and then stops improving; 85 starts
 * loitering at mid-range, which is the turret behaviour this avoids.
 */
export const EXTEND_ARC_ANGLE = (60 * Math.PI) / 180;

/**
 * How far out the ship gets before it starts to curve at all.
 *
 * Turning before it has cleared puts it back through the target it just passed.
 * The pass commits at `BREAK_OFF_RANGE` and the hulls are up to 68 units of
 * radius, so this is that range and half again — approximately: 220 x 1.5 is
 * 330, and 340 is what shipped and what the sweep was flown at. It stays a
 * literal; expressing it would move the ship 10 units.
 *
 * The sweep is flat from 220 to 460 and only starts costing gap at 600.
 */
export const CLEAR_RANGE = 340;
