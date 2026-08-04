// Trumbles, as numbers: how fast they breed, how much they eat, and what
// drives them out.
//
// Elite's joke about buying something adorable at a station, and the numbers
// are the joke's timing: they double every brood, the only cure is the same
// manoeuvre that refuels you, and by the time they are worth mentioning they
// are already a problem. The rule that spends these is `stepTrumbles` in
// game/trumbles.ts; the shelf price of the mistake is `EQUIPMENT_CATALOGUE`'s
// trumble row.

/**
 * Cabin heat that drives them out — comfortably inside a sun-skim's working
 * band (the cabin settles at 0.36 at scooping range and death is
 * `CABIN_TEMP_FATAL` = 0.99, sun.ts), so the cure costs a deliberate dip
 * into the hot zone, not the ship.
 */
export const TRUMBLE_PURGE_TEMP = 0.55;

/**
 * Seconds between broods.
 *
 * Also the fresh session's own countdown: `freshSession` in game/state.ts
 * starts `trumbleTimer` at exactly one interval, and wrote the 20 out as a
 * literal until this had a home it could import — the same pair the survey
 * flagged, whose neighbour `autoSaveTimer` was already doing it right.
 */
export const BREED_INTERVAL = 20;

/** They multiply by this, plus one, every brood. */
export const BREED_RATE = 1.6;

/** No more than this many, or the hold report becomes a novel. */
export const MAX_TRUMBLES = 999;

/** One tonne eaten per this many trumbles, per brood. */
export const APPETITE_DIVISOR = 8;

/**
 * Below this many, they are not worth mentioning — the console stays quiet
 * so the infestation is discovered rather than announced. The survey lists
 * nine constants at 4 in this codebase; this one is none of the others.
 */
export const NOTICEABLE = 4;
