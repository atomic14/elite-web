// The Harmless motion overlay on the pack's hulls: how one turn rate becomes a
// pitch cap and a roll cap, and how hard a hull accelerates.
//
// The pack gives every design a top speed and nothing else. The original's
// handling is a table of per-frame rotation bytes for a 2 MHz 6502, not a
// number this flight model could take, so both values below are browser-game
// constants chosen for feel and no re-import can supply one.
//
// These are the multipliers EVERY ROSTER ROW SHARES. The per-hull `turnRate`
// and `maxSpeed` they multiply are roster data and stay in `game/ship-specs.ts`
// with the rest of the table. The commander's own envelope is not an overlay on
// anything and is `player-flight.ts`.
//
// Both are invisibly load-bearing for the AI: every shipped genome was fitted
// against the agility and the throttle authority these produce, so moving
// either is a retrain rather than a tuning pass.

/**
 * A hull's `turnRate` is one number; pitch and roll caps are multiples of it.
 *
 * It lived in ai-training/core.ts, which npc.ts imported — the game reaching
 * into the trainer for one of its own hull constants, and the last thing
 * keeping that file alive after the simulator merged into the engine. It is not
 * a property of any one row, which is why it is not in the roster either: it is
 * the shared multiplier the whole table is written against.
 *
 * These are deliberately UNCHANGED. Pirates being harder to track than the
 * player was fixed by making the *player* more agile (`PLAYER_FLIGHT`'s
 * maxPitch/maxRoll), not by slowing everyone down. Cutting them to 1.15/2.0 was
 * tried and reverted: it left the pirate/trader agility *ratio* identical while
 * lowering absolute turn rates, and evasion needs absolute agility far more
 * than aggression does — the Jameson defence went from dying in 10% of 2v1
 * fights to 92%, i.e. no better than an unarmed scripted trader.
 */
export const TURN = { pitch: 1.4, roll: 2.4 } as const;

/**
 * How hard a hull accelerates, as a fraction of its top speed.
 *
 * Every ship therefore reaches its cruise in about 1/ACCEL_FRACTION seconds,
 * and a Sidewinder gets to 300 no slower than a Worm gets to 200.
 *
 * This exists because `accel` was a number the game did not have. npc.ts
 * throttled EVERY brain-flown ship at a flat `BRAIN_ACCEL = 120` while the
 * training simulator gave each hull its own — 140 for a Sidewinder, 120 for a
 * pirate Cobra, 100 for a trader Cobra. So a Sidewinder was trained with 17%
 * more throttle authority than the game gave it and armed traders with 17%
 * less, and test/run.ts carried a TODO asking an owner to pick a side. Per-hull
 * accel is the right model; its absence was an omission.
 *
 * The fraction is not invented: the simulator's three hand-written accels are
 * 140/300, 120/260 and 100/220 — 0.467, 0.462 and 0.455. They were one rule all
 * along. 0.46 reproduces all three to within a rounding step, so no ship's
 * handling moves by more than 2% from the model the brains were fitted in.
 *
 * A row may still state its own `accel` and override this; `shipAccel()` in
 * game/ship-specs.ts is the one place that asks.
 */
export const ACCEL_FRACTION = 0.46;
