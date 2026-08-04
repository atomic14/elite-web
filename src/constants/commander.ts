// The commander's own ship, as capacities: the name a fresh career starts
// under, the grubstake, the tank, the missile rails and the two hold sizes.
//
// What the commander IS — the data shape, the starting loadout, the cargo
// arithmetic — stays in game/commander.ts; these are the numbers every other
// surface also reads: the shop sells against the rails and the tank, the
// charts draw the tank as a circle, the briefing states the grubstake, and a
// pirate sizes up the hold.
//
// A STANDING DESIGN QUESTION, recorded rather than decided (the survey's
// decision 3): each of these shadows a per-hull catalogue field now that a
// commander saves a `shipId` — the tank vs `hyperspaceRangeLightYears`, the
// rails vs `maxMissiles`, the holds vs `cargoHoldCapacity`. Whether a shipyard
// ever resolves them through the hull is a design decision, not a refactor;
// until it is taken, these flat numbers are the game.

/**
 * The original's own commander, and still the default here. `newCommander`
 * starts every career under it, and the save screens fall back to it when a
 * name normalises to nothing.
 */
export const DEFAULT_NAME = 'JAMESON';

/**
 * The grubstake, in tenths of a credit — the classic 100.0 Cr.
 *
 * The briefing's opening page states it in prose; it interpolates this
 * constant, so the sentence a new player reads cannot drift from the credits
 * they actually get.
 */
export const STARTING_CREDITS = 1000;

/**
 * The tank, in tenths of a light year — the classic 7.0 LY range.
 *
 * A tenth of a light year is also the unit of chart distance
 * (`chart-metric.ts`), so this one number is simultaneously the tank's size,
 * the reach of a full tank, and the radius of the dashed circle both charts
 * draw. The living galaxy's convoys fly the same 7 LY range on the stated
 * grounds that every ship does; `contracts.ts`'s bulletin board reaches to 68
 * rather than 70, and that divergence is recorded beside `CONTRACT_RANGE`.
 */
export const MAX_FUEL = 70;

/** The missile rails: four, as the original's Cobra carried. */
export const MAX_MISSILES = 4;

/**
 * What the hold carries, in tonnes, without and with the Large Cargo Bay.
 *
 * ONE RULE THAT HAD FOUR HOMES: `cargoCapacity()` in game/commander.ts owned
 * it, `markOf` in game/threat.ts restated both figures (a pirate reads the
 * bay you fitted), `pirateThreat`'s big-bay bonus wrote the 20 out again as a
 * threshold, and the shop's shelf label typed the 35 into a string. All four
 * read these now — the label interpolates, so the shelf cannot advertise a
 * bay the game does not fit.
 */
export const HOLD_TONNES = 20;
export const LARGE_BAY_TONNES = 35;
