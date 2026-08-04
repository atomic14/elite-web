// How busy a system is the moment you arrive in it.
//
// Counts and chances only: how many traders are already on their runs, how many
// rocks are drifting about, whether a bounty hunter is working the system today.
// WHERE any of them ends up is `spawn-placement.ts`, and what turns up LATER,
// while you are flying, is `encounters.ts`.
//
// The rule that spends these is `planPopulation` in game/population.ts, which
// returns a plan the Game builds. Police are not here: how many patrols a
// government runs is a two-line ladder inside `policeFor`, and its numbers are
// the branches of that function rather than values anything else can act on.

/**
 * Never fewer than this many traders, whatever the living galaxy says.
 *
 * A system with nobody in it reads as broken rather than as quiet, and the
 * lanes are what make a galaxy feel inhabited at all.
 */
export const MIN_TRADERS = 1;

/**
 * ...and never more than this many, however many convoys are due.
 *
 * THIS IS THE CONSTANT docs/TODO/90 IS NAMED AFTER. It had two homes —
 * `game/population.ts` capped the arrival plan and `game/encounters.ts` capped
 * the drip of later arrivals — both `= 4`, both meaning "never more than four
 * traders in a system", and nothing detected it. They agreed, which by
 * CLAUDE.md's standard is still a defect: nobody could change either without
 * remembering the other, and a raised cap in one half would have been silently
 * held down by the other.
 *
 * It is population's rather than encounters': it is a property of what a system
 * HOLDS, not of the clock that adds to it. `test/constants.test.ts` now fails
 * if any file in `src/` declares the name again.
 *
 * `MAX_THARGONS` in `encounters.ts` is also 4 and is a different rule.
 */
export const MAX_TRADERS = 4;

/**
 * Chance a bounty hunter is working the system when you arrive...
 *
 * Higher than the launch figure below because arriving is when the system gets
 * to react to you: you have come out of witch-space somewhere it can see, and
 * a hunter is hostile to any offender, so meeting one is part of what arriving
 * in a rough system costs.
 */
export const HUNTER_CHANCE_ARRIVAL = 0.35;

/**
 * ...and the lower chance when you launch from its station instead.
 *
 * Launching is deliberately the safe half of the pair — the reception committee
 * is arrivals-only too (`planPopulation` passes no threat on a launch), because
 * nobody organised anything for a ship that was parked in the bay.
 */
export const HUNTER_CHANCE_LAUNCH = 0.2;

/**
 * Chance a rock hermit is hiding out among the asteroids.
 *
 * A homage to Oolite rather than to the 1984 original, which has no such thing:
 * a hollowed-out rock that trades ore and asks no questions, and the only place
 * in the galaxy that will buy from you without a legal opinion.
 */
export const HERMIT_CHANCE = 0.3;

/**
 * Chance a generation ship is crossing, on arrival only.
 *
 * Rare on purpose: it is scenery with a story rather than an encounter, and the
 * Game announces it when one is here. Meeting one twice in an evening would make
 * a centuries-long voyage look like traffic.
 */
export const GENERATION_SHIP_CHANCE = 0.08;

/**
 * The fewest rocks a system holds...
 *
 * Every system has some. They are what a mining laser is for, they are what
 * makes an asteroid field a place to hide, and a sky with nothing in it but
 * ships reads as a level rather than as space.
 */
export const ASTEROIDS_MIN = 2;

/**
 * ...and how many more it may have, drawn flat: `ASTEROIDS_MIN` plus 0, 1 or 2.
 *
 * A SPAN rather than a maximum, because that is the shape of the draw
 * (`Math.floor(rng() * ASTEROIDS_VARIATION)`) and writing the ceiling here
 * would leave a reader working out whether it was inclusive. The most a system
 * holds is four.
 */
export const ASTEROIDS_VARIATION = 3;
