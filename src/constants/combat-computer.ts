// The combat computer you can buy: what it will engage, and the envelope it
// flies your ship in. The autopilot itself is `game/combat-computer.ts`.
//
// All five of its numbers are here now. The two turn caps waited for the flight
// slice, because they are `TURN` multiplied by a roster row and this directory
// may not reach outside itself; `hull-motion.ts` brought `TURN` in.

import { TURN } from './hull-motion.ts';

/** How far out it will look for something to fight. */
export const THREAT_RANGE = 6500;

/**
 * The autopilot cruises rather than sprints, where the commander's own ship
 * accelerates at 220 to a cap of 400.
 *
 * The trader Cobra's real acceleration is `220 * ACCEL_FRACTION` = 101.2, so
 * `CC_ACCEL` is not the hull it names. 100 is what shipped and what the defence
 * trials were flown at; it stays a literal, because closing the 1.2% is a
 * behaviour change — and Chris confirmed the flown 100 over the derived 101.2
 * on 2026-08-05.
 */
export const CC_MAX_SPEED = 220;
export const CC_ACCEL = 100;

/**
 * Turn caps, matching the trader Cobra the defence brain was trained in. Fly
 * the policy on a more agile ship than it learned on and it oversteers.
 *
 * `0.5` is that hull's `turnRate` (`SPECS.trader`, the Cobra Mk III row) and
 * the multipliers are `TURN`, so these cannot drift away from the hull they
 * name. Only the row's own 0.5 is written out; restating the products 0.7 and
 * 1.2 would give the coupling a second home.
 *
 * `test/combat-model.test.ts` holds them against the roster row itself, BY
 * DESIGN ID rather than against `0.5 * TURN.pitch` — which is this definition's
 * right-hand side written a second time and would pass while the row moved
 * underneath it. The row's `turnRate` was moved 1% once and no assertion in the
 * project failed (docs/TODO/87). A cap that moves invalidates every brain
 * fitted at it, so it should cost a red line to decide on.
 */
export const CC_MAX_PITCH = 0.5 * TURN.pitch;
export const CC_MAX_ROLL = 0.5 * TURN.roll;
