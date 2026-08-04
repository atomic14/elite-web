// Choosing a tactic: how wide a pass has to be aimed to clear, how hurt a ship
// has to be before it rethinks, how likely each choice is, and how long it holds
// one before it may change again.
//
// `tactics.ts` is the vocabulary. The gates, the roll and the trigger that spend
// these are `game/tactic-choice.ts`.
//
// One number of the choice is not here: `RAM_MIN_SPEED` is
// `PLAYER_FLIGHT.maxSpeed * 0.7`, and this directory may not import, so it stays
// in game/tactic-choice.ts until the commander's envelope arrives. Restating 400
// as a literal would be a second home for it.

/**
 * How much wider than contact a pass has to be AIMED to actually clear, as a
 * multiple of the two hulls' radii.
 *
 * A ship misses by how far its path has diverged by the time the two arrive, not
 * by the distance it aimed at. Measured over 60 episodes, an intended 110
 * delivered a floor of about 0.64 of the intent, so 1.6x contact is what an
 * intent has to be.
 *
 * It rarely binds: at `knife`'s 100 only the three largest hulls are excluded.
 * `RAM_MIN_SPEED` is the gate with teeth. Agility does not bind at all — the
 * worst case is 0.16 rad/s demanded of a Python that has 0.35.
 */
export const PASS_CLEARANCE = 1.6;

/**
 * How hurt a ship has to be before being hit makes it rethink.
 *
 * Not "took a hit": every ship in a firefight is hit within seconds, so a bare
 * damage trigger re-rolls the whole sky and the spawn roll means nothing. Damage
 * AND a hull going the wrong way is the signal.
 */
export const TACTIC_HURT_HEALTH = 0.6;

/** ...and how hurt before a ram is on the table, and nothing else new is. */
export const TACTIC_LAST_STAND_HEALTH = 0.25;

/**
 * How likely each tactic is, per reason. Relative, and renormalised over
 * whatever the hull is offered.
 *
 * `run` at half of every spawn keeps half the sky flying the behaviour that was
 * measured. The `hurt` row is a design choice, not a measured one — 20/55/25 and
 * 20/40/40 take the same damage off an armed commander over 96 fights, and a
 * gang that systematically retreats has swapped one learnable pattern for
 * another. `ram` is zero everywhere but the last stand, on top of the health
 * gate in `tacticsFor`.
 *
 * No `Record<TacticReason, Record<TacticId, number>>` annotation: `TacticReason`
 * belongs to the switch that produces one and this directory may not import.
 * `as const` plus `chooseTactic`'s two lookups is the same exhaustiveness check
 * from the spending side — a fifth reason or tactic with no row is a compile
 * error at the index.
 */
export const TACTIC_WEIGHTS = {
  spawn: { run: 50, slash: 25, knife: 25, ram: 0 },
  sleeper: { run: 40, slash: 30, knife: 30, ram: 0 },
  hurt: { run: 20, slash: 40, knife: 40, ram: 0 },
  lastStand: { run: 15, slash: 40, knife: 0, ram: 45 },
} as const;

/**
 * The least time a ship keeps a tactic before it may take another.
 *
 * Bracketed on both sides: longer than one pass, so a tactic survives long
 * enough to be seen in a record; shorter than one full cycle (7.2s median
 * merge-to-merge), so a ship being hammered can change its mind more than once.
 */
export const TACTIC_MIN_DWELL = 5;

/**
 * How long a ship goes without getting a shot away before it concludes that
 * whatever it is doing is not working.
 *
 * The anti-degeneracy rule, and the one trigger that needs nothing to have gone
 * wrong in a way the code can name. 12 seconds is comfortably past a whole
 * attack run (7.2s median, 9.98 at the ninetieth).
 */
export const TACTIC_SLEEPER_SECONDS = 12;
