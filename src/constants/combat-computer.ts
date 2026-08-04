// The combat computer you can buy: what it will engage, and the envelope it
// flies your ship in. The autopilot itself is `game/combat-computer.ts`.
//
// Two of its five numbers are not here. `CC_MAX_PITCH` and `CC_MAX_ROLL` are
// `0.5 * TURN.pitch/roll` — the trader Cobra the defence brain was trained on,
// through the roster's multipliers — and this directory may not import
// `ship-specs.ts`. They join these when the flight slice brings `TURN` forward.

/** How far out it will look for something to fight. */
export const THREAT_RANGE = 6500;

/**
 * The autopilot cruises rather than sprints, where the commander's own ship
 * accelerates at 220 to a cap of 400.
 *
 * The trader Cobra's real acceleration is `220 * ACCEL_FRACTION` = 101.2, so
 * `CC_ACCEL` is not the hull it names. 100 is what shipped and what the defence
 * trials were flown at; it stays a literal, because closing the 1.2% is a
 * behaviour change.
 */
export const CC_MAX_SPEED = 220;
export const CC_ACCEL = 100;
