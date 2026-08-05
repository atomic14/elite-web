// What the combat trainer's record measures: the sampling clock, the pass
// thresholds, the six cone, and the buffer's bounds.
//
// The recorder that spends these is `game/combat-sim-report.ts`, and
// `train/flight-probe.ts` reads the SAME definitions — which is the point:
// when the probe kept its own copy of what a pass is, the tool and the report
// could disagree, which is this project's named failure. The record's format
// version (`COMBAT_SIM_SCHEMA`) stays beside the record it versions.

/**
 * How often geometry is sampled, in Hz. Every duration the record reports is
 * derived from a count of samples, so this is also the resolution of
 * `engagedSeconds` and the on-six times.
 *
 * 10 was combat-recorder.js's rate and it stays: a fight is decided over
 * seconds, the game steps at 60, and sampling every ship's range and bearing
 * at 60 Hz for a twenty-minute sparring session is a lot of arithmetic for two
 * decimal places nobody reads.
 */
export const SAMPLE_HZ = 10;

/**
 * The rear cone that counts as somebody's six, as a half-angle from directly
 * astern.
 *
 * This one is the measurement's own number rather than a rule read from the
 * game, because the game has no notion of a six — it has a firing gate and aft
 * shields. 60 degrees is the arc a tailing ship holds; wider and "on your six"
 * would start including a ship off your beam, which is a different problem for
 * the pilot.
 */
export const SIX_CONE = Math.PI / 3;

/**
 * What an attack run is, in ranges: a ship counts as INSIDE once it closes past
 * `PASS_CLOSE`, and has completed a PASS once it opens back out past
 * `PASS_FAR`.
 *
 * Like `SIX_CONE` these are the measurement's own numbers rather than a rule
 * read from the game, and for the same reason: the game has no notion of an
 * attack run. It has a firing gate and two laser ranges, and `NPC_LASER_RANGE`
 * is 3500 — a ship that hangs at 3000 and snipes never leaves its own reach, so
 * a threshold taken from the gun would count a turret as engaged and count no
 * passes at all.
 *
 * TWO numbers, not one, because one threshold counts jitter: a ship holding
 * station at 400 crosses back and forth over a single line all fight and scores
 * a pass every time. With a gap it has to actually go somewhere — in past 400,
 * which is knife-fighting range for a human, and back out past 600, which is
 * far enough that it has plainly broken off rather than wobbled. A brain that
 * loiters at 450 scores none, however long it stays there.
 *
 * `PASS_CLOSE` is `train/flight-probe.ts`'s original, MOVED here rather than
 * re-picked. The probe imports both from here now; when it kept its own copy,
 * the tool and the report could disagree about what a pass is, which is this
 * project's named failure — one rule with two homes.
 *
 * `PASS_FAR` USED TO BE THE SAME NUMBER AS break-off.ts's `EXTEND_RANGE`, on the
 * argument that a flight model producing runs and a measurement counting them
 * should share one. Ships now roll their own turn-back range out of a band, so
 * there is no single range to share and the honest statement of the coupling is
 * weaker but still binding: PASS_FAR must sit BELOW the shortest run the flight
 * model can produce, or the measurement goes blind exactly where the flying got
 * better. `test/break-off.test.ts` asserts it.
 *
 * That was nearly a real break once and it became a real one. It USED to be
 * 900, on the grounds that the band then shipped apexed no lower than about 948
 * and 900 counted 89% of the merges that happened — leaving an archived log
 * comparable, which was worth more than the three points 650 would have added.
 *
 * docs/TODO/67 shortened the run: the run-out flies a curve now (extend-arc.ts)
 * and the band is 500-850, which apexes at 666 at its tenth percentile. At that
 * shape 900 counts **12%** of the merges a five-ship fight actually produces, so
 * every attack-run figure in the game and in `train/flight-probe.ts` would have
 * read close to zero for a flight model that had just got better at flying. It
 * is 600, where the same measurement counts 92% — the coverage 900 used to have
 * over the band it was picked for. Over 40 five-ship episodes:
 *
 *   PASS_FAR      450   500   550   600   650   700   800   900
 *   merges counted 95%   94%   93%   92%   87%   76%   44%   12%
 *
 * The cost is real and is stated rather than hidden: a pass counted before this
 * change and a pass counted after are not the same measurement, so the archived
 * rows in train/logs/todo32/ are a record of a different flight model as well
 * as a different threshold. `PASS_CLOSE` does NOT move — what "inside" means is
 * unchanged, and it is what keeps the two halves of a comparison honest.
 *
 * 600 is also the floor. It sits 200 above `PASS_CLOSE`, which is the hysteresis
 * that stops a ship loitering at one range scoring passes by wobbling, and the
 * trained policies are the check on that rather than the arithmetic: over 40
 * held-out episodes `pirate-attack-g3`, which hangs at a median of 240 units,
 * scores 0.00 passes at this threshold exactly as it did at 900.
 */
export const PASS_CLOSE = 400;
export const PASS_FAR = 600;

/** How many exercise records the in-memory ring keeps. */
export const SIM_LOG_LIMIT = 20;

/**
 * Samples kept before the buffer closes.
 *
 * Sparring and waves are endless by design, so the buffer is bounded — and it
 * STOPS rather than dropping the oldest sample, because a median over a sliding
 * tail of a fight is a median of the end of the fight while claiming to be a
 * median of the fight. When it fills, the report says so.
 */
export const MAX_SAMPLES = 12_000;
