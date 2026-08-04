// How the run-OUT is flown: a curve, not a straight line.
//
// `break-off.ts` owns the ranges and the phases of an attack run and
// `pass-aim.ts` owns where the closing leg aims. This owns the third leg, which
// until docs/TODO/67 was the one nobody had written a rule for at all:
// `extending` steered for NOTHING. It held whatever heading the pass left it
// with until the range opened past its rolled turn-back point, and only then
// began to turn.
//
// WHAT THAT COSTS is the whole of the run. With a straight run-out the ship
// arrives at its turn-back point pointed 180 degrees from its target — measured
// over 244 turn-backs, a median of 177 — so the closing leg has to contain BOTH
// the reversal AND the run-in that settles it onto `PASS_MISS_DISTANCE`. A
// Krait reverses in 2.24s and 651 units of travel; a Python needs 1,026. The
// ship therefore has to go a long way out to have anywhere to turn in, and the
// player watches it fly away for nine seconds.
//
// Chris, having flown it: *"I think one thing I'm observing they fly quite far
// before turning for another run."* A pilot does not fly straight for 900 units
// and then pivot. They fly a curve, and arrive already pointed with the whole
// remaining distance available as run-in. With this, the same measurement reads
// a median of 120 degrees — exactly `180 - EXTEND_ARC_ANGLE` — and the run
// apexes at 794 units instead of 1,062 for the same quality of pass.
//
// IT IS NOT WHY SHORT RUNS RAMMED, which is what docs/TODO/67 expected it to be
// and worth writing down because the item's table looked like proof. Dropping
// the band with this in place still rammed; what was actually spending the miss
// distance was the SIDE the closing leg aimed off, and `npc.ts`'s `passOffset`
// carries that measurement. The curve is what buys the rhythm; the side is what
// made the shorter band safe. Both were needed and only one was diagnosed.
//
// PURE, and it takes the geometry as two numbers, so the whole rule is
// assertable without flying anything — pass-aim.ts's arrangement, for its
// reason. The vectors and the scratch to resolve them in belong to
// `NpcShip.attack`, which is the only caller and the only place that has them.

/**
 * The angle the run-out holds off the OUTWARD radial, at its tightest.
 *
 * This is the whole shape of the arc, and the one thing that makes it an arc
 * rather than the thing that was already measured and rejected. Steering at the
 * target during the extend cancels the extend outright — 0.90 passes an episode
 * with the range spread collapsed to 274/366/709, which is the turret this
 * cycle exists to avoid. So the ship is never given a heading that points
 * inward: it is given one at a fixed angle to the line it is opening along.
 *
 * The arithmetic is what makes that safe rather than hopeful. A ship flying at
 * `psi` to the outward radial opens the range at `v · cos(psi)`, so while
 * `psi < 90` the run-out ALWAYS terminates and the phase machine cannot be
 * starved of the range it is waiting for. And the heading it arrives with is
 * `180 - psi` off its target rather than a full 180, which is exactly the turn
 * the closing leg no longer has to find room for.
 *
 * 60 degrees, and it is a trade with a knee rather than a slope. What the angle
 * buys is turn done before the phase flips; what it costs is the seconds the
 * ship spends crawling outward, which is the very number this exists to cut:
 *
 *   psi     opens at   arrives      the run-out takes
 *    30      0.87 v     150 off      1.06x the straight time
 *    45      0.71 v     135 off      1.11x
 *    60      0.50 v     120 off      1.25x
 *    70      0.34 v     110 off      1.43x
 *    85      0.09 v      95 off      2.10x
 *
 * (the multiplier is `mean sec(psi)` over the ramp below, not `sec` at the cap —
 * the ship spends most of the run-out well inside the angle.)
 *
 * Measured, 40 episodes per row at the shipped band, median merge-to-merge gap
 * from `train/gap-probe.ts` against contact per merge in a five-ship fight:
 *
 *   psi            0     30     45     60     70     85
 *   median gap  8.28   7.80   7.47   7.22   7.32   7.40
 *   median apex  923    861    815    792    783    768
 *   contact/mrg 0.006  0.006  0.012  0.007  0.010  0.006
 *
 * The knee is at 60 and there is nothing past it: 60 and 70 re-flown over 80
 * episodes are 7.27 and 7.28 seconds, which is the same number. 85 is worse in
 * a way the gap column does not show — the range a lone pirate holds goes
 * 167/549/913 to 298/691/913, because a ship crawling outward at a tenth of its
 * speed is loitering at mid-range, which is the shape this cycle exists to
 * avoid. 60 is the lowest angle that buys the whole effect, so it is the one
 * that spends least on it.
 *
 * The zero row is not "no arc": it is this rule with the angle set to nothing,
 * which steers the ship dead radial rather than leaving it on the heading the
 * pass gave it. The true before is 9.47s at a 1,134 apex — the table under
 * `EXTEND_RANGE_MIN`, where the band and this angle were measured together.
 */
export const EXTEND_ARC_ANGLE = (60 * Math.PI) / 180;

/**
 * How far out the ship gets before it starts to curve at all.
 *
 * Turning before it has cleared puts the ship back through the target it has
 * just passed, which is the collision the pass itself was flown to avoid. The
 * pass commits at `BREAK_OFF_RANGE` (220) and the hulls are up to 68 units of
 * radius between them, so this is that range and half again: far enough that
 * the curve begins behind the target rather than across it.
 *
 * 340, drafted at that number in docs/TODO/67 before there was an arc to test
 * it against, and it survives the test as the value where nothing happens.
 * Measured over 40 five-ship episodes at the shipped band and angle:
 *
 *   CLEAR_RANGE    220    340    460    600
 *   median gap    7.38   7.32   7.40   7.88
 *   median apex    778    783    818    881
 *   contact/mrg  0.009  0.010  0.011  0.006
 *
 * Flat from 220 to 460 — the ramp below is what actually governs the early
 * curve, and it is gentle there whatever this says — and then 600 starts
 * costing half a second of gap, because a ship that may not begin its turn
 * until it is 600 out has to go further out to make one. So the number is not
 * sensitive, which is worth knowing, and it stays where the hazard argument put
 * it rather than being moved to chase a hundredth.
 */
export const CLEAR_RANGE = 340;

/**
 * The angle to hold off the outward radial, this far into the run-out.
 *
 * A RAMP rather than a constant angle, and the difference is the gap. Holding
 * the full angle for the whole run-out is a logarithmic spiral: elegant, and it
 * spends `sec(60) = 2` times the straight-line time getting out, which is paid
 * in exactly the seconds this item is about. Ramping means the ship leaves
 * fast, along the line the pass gave it, and tightens into the turn as it runs
 * out of run — which is also what a pilot does.
 *
 * It reaches the cap AT the turn-back point, so the ship is at its most turned
 * exactly when the phase flips — measured over 313 turn-backs, the heading
 * error there is 120 degrees at every quantile up to the ninth, which is the
 * cap arriving as asked rather than as hoped. Between `CLEAR_RANGE` and there
 * it is linear in the RANGE rather than in time, because range is what the
 * phase machine reads:
 * a ship whose run gets cut short by `underFire` has still curved as much as
 * its position earned, and one shoved back inward by a target that chased it
 * straightens out again on its own.
 *
 * `extendRange` is the ship's OWN rolled turn-back range, not the band's — so a
 * ship that rolled a short run curves harder for it, which is what makes the
 * short end of the band flyable rather than merely permitted.
 */
export function extendArcAngle(dist: number, extendRange: number): number {
  if (dist <= CLEAR_RANGE) return 0;
  const span = extendRange - CLEAR_RANGE;
  // A rolled range inside the clearance leaves no room to ramp through: the
  // ship is already at its turn-back point, so give it the whole angle.
  if (span <= 0) return EXTEND_ARC_ANGLE;
  return EXTEND_ARC_ANGLE * Math.min(1, (dist - CLEAR_RANGE) / span);
}
