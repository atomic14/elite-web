// The commander's three pools: what they hold, and how the console reads them.
//
// Four values and one division. `game/systems.ts` owns everything that HAPPENS
// to the pools — `applyDamage`, `regenerate`, the two 0..1 readings a defence
// policy observes — and reads these; they are here because they are also what
// the console draws, what those readings divide by, and what the E.C.M. costs,
// and a capacity with four readers is not one module's private number.
//
// How fast they come back is `recharge.ts`, which is a different KIND of number
// — a capacity is the released game's and a refill rate is ours.
//
// They arrived in this directory ahead of the rest of systems.ts because
// `ECM_ENERGY_COST` could not be expressed without them: it was
// `Math.round(MAX_ENERGY / 4)`, a second spelling of `LOW_ENERGY`. See
// `ENERGY_BANK_POINTS`.

/** The released capacity of every flyable hull's energy bank and each shield. */
export const MAX_ENERGY = 255;
export const MAX_SHIELD = 255;

/**
 * How many BANKS the console reads the energy pool as.
 *
 * Four, as the original's console did: TODO 27 made energy one 255-point pool,
 * but a player still flies by "how many banks left", so the console draws this
 * many segments (hud.ts, via the frame).
 *
 * A LIVE DISPLAY RULE, and it may change — `ENERGY_BANK_POINTS` and
 * `LOW_ENERGY` derive from it precisely so that it can. It used to have a
 * dangerous twin: `LEGACY_MAX_ENERGY = 4` in systems.ts, how many points the
 * pool HELD before TODO 27, which looked like the same fact and was frozen
 * because a save was read against it. Both fours are not something to
 * reconcile any more — the pre-TODO-27 scale and everything that migrated off
 * it were deleted (Chris, 2026-08-04: nobody has such a save). If a second 4
 * ever reappears in this subject, it is a migration divisor coming back, and
 * the question to ask is who it is for.
 */
export const ENERGY_BANKS = 4;

/**
 * What ONE of those banks holds, in points — and the single home for the
 * division, because more than one rule in this game IS the size of a bank and
 * each of them used to do the arithmetic itself.
 *
 * `ENERGY_BANKS`'s promise is that changing it moves the gauge, the ENERGY LOW
 * warning and the shield cut-off together. It did not move the fourth thing:
 * `ordnance.ts` priced an E.C.M. burst at `Math.round(MAX_ENERGY / 4)` — the
 * same expression as `LOW_ENERGY` with the `4` unnamed, agreeing at 64 and
 * bound to stop agreeing. Naming the quantity is what makes the promise true
 * rather than hopeful.
 */
export const ENERGY_BANK_POINTS = Math.round(MAX_ENERGY / ENERGY_BANKS);

/**
 * You are down to your last bank: the shields stop recovering, the step flashes
 * ENERGY LOW and the gauge's last segment goes red. A point COUNT, not a
 * fraction, and the same count as one bank because "inside the last of four" and
 * "a quarter of the pool" are the same arithmetic.
 *
 * The one comparison the three readers share is `energyLow` in systems.ts, and
 * its inclusivity is argued there.
 */
export const LOW_ENERGY = ENERGY_BANK_POINTS;
