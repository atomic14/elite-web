// The jump, as numbers: the warning before the drive engages, what a jump
// costs in days, what it costs to climb back out of a mis-jump, and how often
// one happens.
//
// The transaction that spends them is game/hyperspace.ts and the metric it is
// priced in is `chart-metric.ts` — a jump's FARE is the chart distance in
// tenths of a light year, which is also what the fuel gauge holds, so there is
// no fuel-per-light-year constant anywhere and there must not be one.
//
// Where a jump leaves you is `planet.ts`'s `WITCHPOINT_RADII`; it is a distance
// from the planet rather than a property of the drive.

/**
 * Seconds of warning before the drive engages.
 *
 * `audio.ts`'s countdown blip is pitched at `700 + (COUNTDOWN - n) * 100`, so
 * the first blip of a jump is 700 Hz whatever this is and each second climbs a
 * hundred hertz towards the jump. It wrote the 5 out as a digit until this
 * constant was somewhere it could import from: change the countdown to 6 today
 * and the first blip dropped to 600 Hz for no reason anybody had written down.
 * `test/audio.test.ts` asserts the climb rather than the formula.
 */
export const COUNTDOWN = 5;

/**
 * A jump takes this many days, plus one more per `TENTHS_PER_JUMP_DAY`.
 *
 * The base day is the jump itself — even the shortest hop puts a day on the
 * calendar, which is what makes contract deadlines bite on a chain of short
 * legs as well as on one long one.
 */
export const JUMP_DAYS_BASE = 1;

/**
 * ...and that "one more per": 20 tenths, which is 2.0 light years a day.
 *
 * A CEILING rather than a rate — `daysForJump` rounds up — so 2.1 LY costs the
 * same as 4.0. `galaxy/navigation.ts` owns the arithmetic, and it exists
 * because game.ts and test/campaign.ts each had their own copy and the
 * campaign's careers therefore aged at whatever rate its copy said.
 */
export const TENTHS_PER_JUMP_DAY = 20;

/**
 * Flat fuel cost, in tenths of a LY, of escaping a mis-jump.
 *
 * A flat rate because witch-space is nowhere: there is no chart distance from
 * it to anywhere, so the fare cannot be the metric's. One light year buys you
 * out, whatever you were trying to fly.
 *
 * IT IS ALSO WHAT "ENOUGH FUEL TO JUMP CLEAR" MEANS, in the two places that
 * decide whether you are stranded: the world step starts offering the distress
 * beacon below it, and a rescue tops the tank back up TO it. Both wrote 10 out
 * as a literal, so raising the escape cost would have made the hint fire late
 * and the rescue put you back in witch-space still stranded.
 */
export const WITCHSPACE_ESCAPE_COST = 10;

/**
 * Chance a jump drops you into witch-space instead of at your destination.
 *
 * The original's cruelty, kept: the fare is charged either way, so a mis-jump
 * costs you the fuel and leaves you nowhere.
 */
export const MISJUMP_CHANCE = 0.09;

/**
 * ...and the raised chance while carrying the Constrictor plans (mission stage
 * 3). The ambush is the point of that leg, so it should not depend on luck
 * alone. Which stage is stage 3 is `game/missions.ts`'s.
 */
export const MISJUMP_CHANCE_PLANS = 0.22;
