// The attack run, as ranges: how close a hostile gets before it turns away,
// how far it runs out, how slowly it flies to turn, and where a trained pilot
// hands over to the script.
//
// The phase machine that spends these is `game/break-off.ts`. Where the closing
// leg aims is `pass-aim.ts`; how the run-out curves is `extend-arc.ts`.

/**
 * A ship this close to what it is fighting stops closing and turns away.
 *
 * A STEERING rule only — it keeps shooting. Two hulls are ~68 units of radius
 * before they touch and a ship re-decides at 10 Hz, so 220 is several decision
 * ticks of turning room.
 */
export const BREAK_OFF_RANGE = 220;

/**
 * Range at which a trained pilot stops flying its own policy and hands the ship
 * over to the scripted break-off.
 *
 * The pre-generation policies were fitted in a simulator with no collisions, so
 * they close to zero range and sit there — which in a game where ships are solid
 * reads as ramming. A head-on closure covers 70 units between decisions against
 * 68 units of hull, so a guard has to leave more than one tick to turn in: 150
 * does, 90 did not.
 */
export const BRAIN_HANDOVER_RANGE = 150;

/**
 * The band a ship's own turn-back range is rolled from, each time it extends.
 *
 * A band rather than one number because one number turns a whole gang at the
 * same place and sends it back as a wave. Rolled per extend, not per ship, or
 * each individual stays as metronomic as before.
 *
 * 500-850 was chosen on feel across 40 episodes per band: everything from
 * 400-700 up flies clean, and shorter bands buy a tighter rhythm (median
 * merge-to-merge 6.9s against 8.5s at the old 700-1100). 400-700 is not taken
 * because it apexes at 707 and `PASS_FAR` has to sit below the shortest run.
 */
export const EXTEND_RANGE_MIN = 500;
export const EXTEND_RANGE_MAX = 850;

/**
 * The default turn-back range for a caller that has not rolled one — the middle
 * of the band.
 *
 * `npc.ts` initialises `state.extendRange` to `EXTEND_RANGE_MAX` instead, so a
 * ship's FIRST run is flown at 850 rather than this. That is a live bug and
 * correcting it changes flight, so it lands on its own.
 */
export const EXTEND_RANGE = (EXTEND_RANGE_MIN + EXTEND_RANGE_MAX) / 2;

/**
 * How long a ship keeps flying evasively after the last hit it took. A decay,
 * not a latch: it goes back to fighting once you stop landing them.
 */
export const UNDER_FIRE_SECONDS = 1.2;

/**
 * The slowest an attacking ship throttles back to in order to turn.
 *
 * Deliberately just above `MIN_CRUISE_FRACTION`, so the flying rule and the
 * backstop never argue. Two literals on purpose: "just above" is the whole
 * relationship, and an expression would make moving the backstop drag the
 * flying with it.
 */
export const CLOSING_THROTTLE_MIN = 0.45;

/**
 * Hostiles cannot throttle below this fraction of their top speed. A fighter
 * that can stop dead holds a firing line for free and becomes a turret.
 *
 * Traders and haulers may come to rest. Pinned by the brains as well as by the
 * design — `pirate-attack-g3` was fitted where stopping does not exist.
 */
export const MIN_CRUISE_FRACTION = 0.43;
