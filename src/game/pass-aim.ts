// Where an attack run is AIMED — beside the target, and ahead of it.
//
// break-off.ts next door owns the run's ranges and its phases: how close a ship
// lets itself get, how far out it turns back, which of the three legs it is
// flying. This owns the one point the closing leg steers at, which is a
// different rule and had grown into a third of that file.
//
// The whole of it is one sentence: **an attack run has to pass beside where the
// target WILL BE, on a line it has room to get onto.** Three numbers implement
// that and each of them was got wrong once:
//
//   1. Aim at the target and commit to the heading — 104 points of contact
//      damage an episode. That is a collision by construction.
//   2. Aim `PASS_MISS_DISTANCE` to the side of where the target is NOW — the
//      shipped version until docs/TODO/66, and much better, but the aim point
//      is stale by the time the two ships meet.
//   3. Aim to the side of where the target will be, by a distance the ship has
//      the room to open. That is this file.
//
// EVERYTHING HERE IS PURE and takes the geometry as numbers, so the whole rule
// is assertable without flying anything. The vectors, the line of sight and the
// scratch to resolve them in belong to `NpcShip.attack`, which is the only
// caller and the only place that has them.

/**
 * How far to the SIDE of its target a ship aims its attack run.
 *
 * An attack run passes BESIDE the target, not through it. The first cut of the
 * three-phase run aimed at the target itself and then committed to the heading
 * — "go through, no steering" — which is correct for the steering and wrong for
 * the aim point, because the heading it commits to is the one pointed at the
 * hull. Measured over 60 episodes against a target that holds still, that is
 * not a near miss:
 *
 *   scripted, aiming at the target   collision damage 104.1 per episode
 *   scripted, aiming 110 to the side              (see the test)
 *   the old 180-degree break-off                             5.1
 *
 * The old reversal took almost no contact damage because it never went in — it
 * orbited at exactly 220 units at 137 speed, which is the turret reading
 * `train/flight-probe.ts` exists to catch. So both of the first two attempts
 * were wrong in opposite directions and the miss distance is what separates
 * them: commit to the run, but commit to a line that clears the hull.
 *
 * 110 units. A pirate hull's contact radius runs from 32 to 55 (the roster's
 * radii plus the commander's 25 — `collisions.ts`), so this clears the largest
 * of them twice over, and it is small enough that the gun's gate — an angle,
 * not an offset — still opens on the way in.
 *
 * IT IS THE MISS THE SHIP AIMS FOR, NOT THE MISS IT GETS. `passMissDistance`
 * below is what closes that gap, and the measurement it exists for is the
 * closest approach of 255 merges, one pirate, no wingmen to blame, against a
 * target that holds:
 *
 *   p05 56 · p10 64 · p25 73 · p50 75 · p90 77 — an intended 110, delivered 75
 *
 * The number was not too small. The ARITHMETIC of a straight line to a stale
 * point is what spent it, and that is a thing to correct rather than a constant
 * to inflate. Raising it to 130 or 150 was measured too and does cut contact
 * further — but it costs the gun, because a wider aim is a wider angle at every
 * range and the pirate is only inside its firing gate on the run-in.
 * `train/defence-probe.ts`, over 80 held-out fights against an armed commander:
 *
 *   aim                              pools left     contact, 5 ships
 *   110, stale aim point (shipped)        76.6%     1.15 an episode
 *   110, aimed by this file               78.1%     0.42
 *   130 flat, aimed by this file          80.2%     0.40
 *
 * Same contact for 3.4 more points of the commander's pools left standing every
 * fight — the second row buys the fix and the third buys a balance change
 * nobody asked for. So 110 stays, and the correction does the work.
 */
export const PASS_MISS_DISTANCE = 110;

/**
 * The furthest ahead of a target a ship will aim, in seconds.
 *
 * `leadTime` below answers "when will we meet"; this is the answer it is not
 * allowed to exceed, and the reason is that a lead is an extrapolation of a
 * STRAIGHT line. The commander pitches at 1.45 rad/s (`PLAYER_FLIGHT`), so half
 * a second is 41 degrees of heading change — about as much as a straight line
 * survives, and past a full second the line being extrapolated describes a ship
 * that is no longer flying it.
 *
 * Half a second, and it was measured rather than reasoned into place. Against a
 * target translating at 400 and changing course every 2.5-4s, contact per merge
 * over 100 episodes was 0.032 at this cap and 0.047 at a full second — the long
 * cap is the one that predicts through a turn.
 *
 * It costs the merge nothing, which is the point of choosing it here rather
 * than lower: from `BREAK_OFF_RANGE` at the closing speeds this game produces
 * the two ships meet in 0.34s (head-on) to 0.73s (a target barely moving), so
 * this binds at long range and on a target that is running, and never on the
 * moment that decides whether the pass touches.
 */
export const MAX_LEAD_SECONDS = 0.5;

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
 * fallback; it is the honest answer — there is nothing to intercept, and the
 * ship should aim half a second ahead and keep flying its run.
 */
export function leadTime(dist: number, closingSpeed: number): number {
  if (closingSpeed <= 0) return MAX_LEAD_SECONDS;
  return Math.min(MAX_LEAD_SECONDS, dist / closingSpeed);
}

/**
 * The most the aim may be stretched by the geometry.
 *
 * 3, and it binds only where the arithmetic below has stopped meaning anything:
 * a merge so fast, or a range so short, that no heading opens the gap asked
 * for. Past it the ship would be flying more across its run than along it,
 * which is not an attack run — it is the orbit this whole cycle replaced. The
 * floor is 1: this rule may widen a pass and may never narrow one, so anything
 * it cannot improve gets exactly the pass that shipped.
 */
export const MAX_MISS_STRETCH = 3;

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
 * firing and opens only at the merge — which is why this costs a fifth of the
 * lethality that raising the constant does.
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
 * caller along the one line of sight both of them are about — two answers to
 * one question, never read twice.
 */
export function passMissDistance(
  dist: number, closingSpeed: number, ownSpeed: number,
): number {
  if (ownSpeed <= 0) return PASS_MISS_DISTANCE;
  // Inside the miss distance there is no heading that opens it: take the cap
  // and let the pass commit. This is also the guard on the square root.
  const room = dist > PASS_MISS_DISTANCE
    ? dist / Math.sqrt(dist * dist - PASS_MISS_DISTANCE * PASS_MISS_DISTANCE)
    : MAX_MISS_STRETCH;
  const stretch = Math.min(
    MAX_MISS_STRETCH, Math.max(1, (closingSpeed / ownSpeed) * room));
  return PASS_MISS_DISTANCE * stretch;
}
