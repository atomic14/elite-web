// The docked exercise: where a training fight opens, how it starts you, how
// long it may run, and the sky it empties first.
//
// The plans that spend the opening are `game/combat-sim-opening.ts` (per
// scenario, over `spawnOpposition`'s scatter — whose four spread fractions are
// ./opposition-ring.ts and are NOT overridable), and the exercise itself is
// `game/combat-sim.ts`.

import { PASS_FAR } from './combat-record.ts';

/**
 * The opening range for a fight you are meant to see coming, and every term of
 * it is load-bearing:
 *
 *  * **Outside their gun.** `NPC_LASER_RANGE` is 3,500 and a spawned ship is
 *    already pointed at you, so anything closer than 3,500 / 0.85 = 4,118
 *    (0.85 being `OPPOSITION_RING_NEAR`, the closest the scatter lands a ship)
 *    lets the nearest of them open fire on the first frame. That is the bug:
 *    being shot before you have found what is shooting.
 *  * **Inside their interest.** `PLAYER_INTEREST_RANGE` is 9,000 — an NPC does
 *    not care about you at all beyond it — so a longer opening would buy a
 *    stare rather than an approach.
 *  * **Clear of the attack-run thresholds.** TODO 34 counts a pass as closing
 *    inside `PASS_CLOSE` and opening back out past `PASS_FAR`
 *    (./combat-record.ts), so where a fight STARTS decides whether the first
 *    run is counted honestly: start inside the close threshold and
 *    `countPasses` begins the fight already "inside" and scores a free pass
 *    the first time anybody leaves; start in the dead band between the two and
 *    the first approach is half-measured. The nearest ship here starts at
 *    0.85 x 4,500 = 3,825 — more than six times `PASS_FAR` — so every run in
 *    the record is a run somebody actually flew. (This paragraph used to quote
 *    PASS_FAR as 900 and the margin as "four times": the threshold moved to
 *    600 in docs/TODO/67 and the transcribed figures had quietly gone stale,
 *    which is why they are names now.)
 *
 * At a quarter throttle (`ENTRY_THROTTLE`) against a pirate's own speed this is
 * ten seconds of approach — the ten seconds the trainer exists to show.
 */
export const OPENING_RANGE = 4500;

/**
 * An ambush opens INSIDE their gun, because that is what an ambush is.
 *
 * Still well clear of `PASS_FAR`: 0.85 x 2,400 = 2,040, so even the fight that
 * starts behind you counts its attack runs from a clean standing start.
 */
export const AMBUSH_RANGE = 2400;

/**
 * No opening may be closer than this.
 *
 * Twice `PASS_FAR`, which after the spawner's -15% scatter still leaves the
 * nearest ship well outside it. Stated as a rule rather than checked by eye
 * because the coupling is invisible: a range picked for how a fight FEELS would
 * silently change what the attack-run count MEANS, and `npm test` holds every
 * plan to it.
 */
export const MIN_OPENING_RANGE = 2 * PASS_FAR;

/**
 * The cone a visible opening is scattered through, half-angle in degrees.
 *
 * 8, so the widest a ship can land is 1.45 x 8 = 11.6 degrees off the nose and
 * the nearest 4.4 — inside the canopy with room to spare, and off-centre enough
 * that a gang is a spread rather than a stack. Dead ahead would be free target
 * practice; the old 0.5-radian cone reached 41 degrees, which is off-screen.
 * (The 1.45 is `OPPOSITION_CONE_FAR`, the spawner's own widest fraction.)
 */
export const OPENING_CONE_DEG = 8;

/** An ambush spreads wide behind you: 16 to 43 degrees off your tail. */
export const AMBUSH_CONE_DEG = 30;

/**
 * How far off the nose still counts as "the pilot can see it".
 *
 * The trainer's own number, like `SIX_CONE` and the pass thresholds, and for the
 * same reason: the game has no notion of the canopy, only a camera. That camera
 * is a 60-degree vertical field of view (`engine/render-stack.ts`), so half of it
 * is 30 degrees and the console eats the bottom of that — 20 is the arc a
 * contact is genuinely IN, rather than technically on screen at the corner of it,
 * which is the state the pilot reported as "off-screen".
 */
export const IN_VIEW_DEG = 20;

/** Where the exercise starts you, as a fraction of the ship's top speed. */
export const ENTRY_THROTTLE = 0.25;

/** Seconds a scenario exercise may run before it times out. */
export const SCENARIO_TIMEOUT = 120;

/**
 * How far out the encounter timers are pushed while an exercise runs.
 *
 * Without this `stepEncounters` keeps doing its job — traders warp in, and a
 * lawless system throws a pirate wave at you — and the arena fills up with
 * ships the scenario never asked for. `test/gang-trial.js` hit exactly this and
 * reported "4 of 3 alive".
 *
 * A big finite number rather than `Infinity`, because the timers are in
 * `GameState` and therefore in the SAVE, and `JSON.stringify(Infinity)` is
 * `null`. Thirty-one years of exercise is enough.
 */
export const NO_AMBIENT_TRAFFIC = 1e9;
