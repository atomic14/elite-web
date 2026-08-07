// Your CHARACTER: the reputation for dirty dealing that clings to a name after
// the fine is paid.
//
// A distinct thing from the two ladders beside it. `rating.ts` is how DANGEROUS
// you are (Harmless…Elite, and it only climbs); `law.ts` is where you stand with
// the Government RIGHT NOW (Clean/Offender/Fugitive, and it washes off when you
// pay the fine). This is what kind of pilot you are KNOWN to be — and it does
// not wash off with money. A score that shady deeds raise and time erodes, read
// off the ladder below by `game/character.ts`.
//
// It drives NOTHING in the world yet: this phase is the label alone, on the
// status screen. Wiring it into `markOf`/`pirateThreat` and the hermit hail —
// so a Dodgy pilot is treated as one — is a later phase, and the number will
// already be there and proven when it comes.

/**
 * The character ladder: the disrepute score, lowest first, and the name it
 * earns. Honest is the top rung and the default — the scale only ever describes
 * how far a name has slipped, never a boast. `characterName` reads it the way
 * `rating()` reads `RATINGS`, and `test/economy.test.ts` bisects the rungs back
 * out of the real function.
 */
export const CHARACTER: readonly (readonly [number, string])[] = [
  [0, 'Honest'],
  [10, 'Dubious'],
  [25, 'Dodgy'],
  [50, 'Shady'],
  [80, 'Notorious'],
  [120, 'Cutthroat'],
];

/**
 * What each deed adds to disrepute. Starting values, tuned in play.
 *
 * A hermit or a murder is a career-marking act — one takes an Honest pilot
 * clear to Dodgy on its own. Getting caught smuggling, or a single dirty sale,
 * is a nudge that only adds up to something over a run of them.
 */
export const DISREPUTE_HERMIT_KILL = 40;
export const DISREPUTE_MURDER = 40;
export const DISREPUTE_CAUGHT = 10;
export const DISREPUTE_CONTRABAND_SALE = 5;

/**
 * How fast disrepute fades, per day — people forget, but slowly. A hermit kill
 * (Dodgy) is gone after about a month of honest flying; a Notorious record
 * takes the better part of two. Slower than the galaxy's own `HEAT_DECAY`: a
 * cargo is forgotten in days, a reputation is not.
 */
export const DISREPUTE_DECAY = 1.5;

/**
 * The ceiling, so a lifetime of villainy cannot run the score away to a number
 * that never decays. A little past Cutthroat: solidly the worst there is, but
 * still reachable back from in a season of clean living.
 */
export const DISREPUTE_MAX = 160;
