// The arithmetic that turns an intended pass into a heading: how far ahead of a
// target to aim, and how far to the side.
//
// The numbers are `constants/pass-aim.ts`. EVERYTHING HERE IS PURE and takes the
// geometry as numbers, so the whole rule is assertable without flying anything.
// The vectors, the line of sight and the scratch to resolve them in belong to
// `NpcShip.attack`, which is the only caller and the only place that has them.

import {
  MAX_LEAD_SECONDS, MAX_MISS_STRETCH, PASS_MISS_DISTANCE,
} from '../constants/pass-aim.ts';

/**
 * How far ahead of itself a target should be aimed: time to the merge, capped.
 *
 * `closingSpeed` is the rate the RANGE is shutting — the attacker's own speed
 * less however much of the target's motion is carrying it away — so
 * `dist / closingSpeed` is when the two arrive in the same place. That is the
 * moment the pass has to clear, and predicting to it is what turns
 * `PASS_MISS_DISTANCE` from an intention into a distance.
 *
 * A target that is opening the range has no merge at all, and `dist/closing` is
 * then either negative or enormous, so both cases take the cap. That is not a
 * fallback: there is nothing to intercept, and the ship should aim half a second
 * ahead and keep flying its run.
 */
export function leadTime(dist: number, closingSpeed: number): number {
  if (closingSpeed <= 0) return MAX_LEAD_SECONDS;
  return Math.min(MAX_LEAD_SECONDS, dist / closingSpeed);
}

/**
 * How far to the side to aim THIS run, so the LINE it flies passes
 * `PASS_MISS_DISTANCE` clear.
 *
 * Aiming at a point 110 units to the side of the target does not make a ship
 * miss by 110. It makes it miss by however much its own path has diverged from
 * the target's by the time the two arrive, and that is a smaller number for two
 * separate reasons — both of which this corrects and neither of which is a
 * tuning constant.
 *
 * ROOM. From `dist` out, a line that passes `m` clear leaves the line of sight
 * by `asin(m/dist)`, so what the ship has to generate is a sideways rate of
 * `closing · m / sqrt(dist^2 - m^2)`, while aiming at a point `m` aside
 * generates `closing · m / dist`. The ratio is `dist / sqrt(dist^2 - m^2)`:
 * 1.01 at 900 units and 1.16 at the 220 the pass commits at. It is a pure
 * function of the range, so the aim stays tight where the gun is actually
 * firing and opens only at the merge.
 *
 * TRAVEL. The two ships meet after `dist/closing` seconds, in which the
 * attacker flies `own · dist/closing`. The faster the closure, the less of its
 * own run it has left to step sideways in — head-on against a commander flat
 * out that is 83 units of travel to open 110 units of gap, which no heading
 * achieves. So the aim is stretched by `closing/own`, which is 1 against a
 * target that is standing still and 2.7 in the fastest merge the game can
 * produce.
 *
 * Both are first-order and the exact solution is uglier; what matters is that
 * each one EARNS its place, measured. Contact per merge against a target
 * translating at 400, over 100 episodes: 0.034 with both terms, 0.053 with the
 * room term alone. With NEITHER it is also 0.034 — but over a fifth fewer
 * merges, because a ship that has not led its aim is missing by accident rather
 * than by design, and a pass that never arrives is not a fix.
 *
 * It is given the same closing speed `leadTime` is given, resolved once by the
 * caller along the one line of sight both of them are about.
 *
 * @param intended how wide this ship MEANS to pass, defaulting to the constant.
 * It is a parameter because a tactic is a choice of how wide to pass and nothing
 * else; the correction is the same arithmetic whatever the intent.
 */
export function passMissDistance(
  dist: number, closingSpeed: number, ownSpeed: number,
  intended: number = PASS_MISS_DISTANCE,
): number {
  if (ownSpeed <= 0) return intended;
  // Inside the miss distance there is no heading that opens it: take the cap
  // and let the pass commit. This is also the guard on the square root.
  const room = dist > intended
    ? dist / Math.sqrt(dist * dist - intended * intended)
    : MAX_MISS_STRETCH;
  const stretch = Math.min(
    MAX_MISS_STRETCH, Math.max(1, (closingSpeed / ownSpeed) * room));
  return intended * stretch;
}
