// The combat computer you can buy: what it will engage, the envelope it flies
// your ship in, and how it pursues. The autopilot itself is
// `game/combat-computer.ts` (the trained brain) and `game/scripted-co-pilot.ts`
// (the shipped pursuit dogfighter).
//
// Two groups live here. The engage range, the cruise envelope and the two turn
// caps are the TRAINED co-pilot's — the caps are `TURN` times a roster row, and
// this directory may not reach outside itself, so `hull-motion.ts` brought
// `TURN` in. The `STEER_*`/`PURSUIT_*` block is the SCRIPTED co-pilot's, and is
// feel rather than fit: no brain flies through it.

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

/**
 * The heading error, in radians, at which the SCRIPTED co-pilot asks for full
 * pitch or roll. Below it the ask is proportional; at or beyond it the stick is
 * hard over.
 *
 * A feel setting for the scripted combat computer's bank-to-turn steering
 * (`game/pitch-roll-steer.ts`), not a fitted one — no brain flies through it.
 * 0.35 rad (~20 degrees) was chosen on the sphere-convergence probe: it saturates
 * soon enough that acquisition is not sluggish (the old roll-then-pitch slew was),
 * while staying proportional in the last degrees so the ramp settles on the
 * target instead of overshooting and dithering across it.
 */
export const STEER_SATURATION = 0.35;

/**
 * The off-nose angle, in radians, at which the co-pilot asks for full PITCH when
 * the target is dead ahead — the strong-pitch saturation. Much tighter than
 * `STEER_SATURATION` on purpose: with a shared 0.35 band a target 4 degrees
 * above the sights got only ~20% pitch and a weaving target was never dragged
 * into the cone (Chris, flying it: "the pitch is not strong enough"). At 0.08
 * (~4.5 degrees) the nose is hauled onto a near target hard.
 *
 * It applies only when the target is AHEAD (`localZ > 0`), blended back to
 * `STEER_SATURATION` as the target moves abeam or behind — pitching hard before
 * the bank has brought a far-behind target into the pitch plane would loop the
 * nose the wrong way and cost convergence. The sphere-convergence sweep holds at
 * 0 stuck with this gating; without it, ~20 directions were lost.
 */
export const STEER_PITCH_SATURATION = 0.08;

// --- the scripted co-pilot as a PURSUIT DOGFIGHTER --------------------------
//
// It does not fly the pirates' slash-and-fly-through attack run: Chris flew that
// as the combat computer and it let go of a crossing target the moment it got
// close (the pass phase steers nowhere on purpose). What a person does instead
// is get on the opponent's six and shoot it up, throttling back to hold the
// track. These are the numbers of that pursuit — feel settings, not fitted, and
// meant to be flown and tuned. See `game/scripted-co-pilot.ts`.

/**
 * The range the co-pilot tries to hold behind its target — close enough that
 * the laser cone is generous, well inside `LASER_RANGE` (3500) and outside
 * `BREAK_OFF_RANGE` (220) so holding station is not ramming. Beyond it the
 * co-pilot closes; inside it drops back.
 */
export const PURSUIT_RANGE = 500;

/**
 * How fast the co-pilot wants to fly per unit of range error, in speed units
 * per world unit (i.e. per second). At 1.0 it asks for full speed about a
 * commander's-top-speed's worth of distance beyond `PURSUIT_RANGE` and for a
 * dead stop the same distance inside it, matching the target's own speed in
 * between — which is what holds station on the six.
 */
export const PURSUIT_CLOSE_GAIN = 1.0;

/**
 * The slowest, as a fraction of the speed it would otherwise want, the co-pilot
 * throttles back to while turning hard onto the target. Unlike a pirate's
 * `MIN_CRUISE_FRACTION`, this may take the ship near a stop: a person hauls the
 * throttle right off to swing the nose round and stay on a crossing target, and
 * the commander's ship (unlike a fighter that would become a turret) is meant
 * to be able to.
 */
export const PURSUIT_TURN_FLOOR = 0.15;

/**
 * Speed deadband, in world units, inside which the co-pilot coasts rather than
 * pumping the throttle. `FlightDemand.throttle` is only a sign, so without this
 * the co-pilot would flip accelerate/brake every frame at its held speed; the
 * band is a few units so holding station reads as a steady throttle.
 */
export const PURSUIT_SPEED_DEADBAND = 6;

/**
 * The nose-to-target angle, in radians, within which the co-pilot counts itself
 * ENGAGED and will not switch targets — it vetoes `ThreatLock`'s distance-based
 * switch (`game/threat-lock.ts`). A pilot lined up on a ship does not drop it
 * because another drifted nearer; it switches only once the current target has
 * run wide or behind (outside this cone) AND the lock's overtake rule fires.
 *
 * 0.6 rad (~34 degrees) is generous on purpose: "engaged" means on the attack,
 * not pinpoint on the crosshair, so a target still being tracked through a turn
 * keeps the lock. Feel, not fit.
 */
export const ENGAGED_CONE = 0.6;

/**
 * How many world units of range weigh as much as one radian of off-nose turn
 * when the co-pilot ranks targets by ease of locking (`game/scripted-co-pilot.ts`).
 *
 * The co-pilot fights the EASIEST target to get guns on — favouring the one
 * needing the least turn, with distance in the balance. At 800 a target 1200
 * units out but 5 degrees off the nose beats one 400 units out but abeam, so
 * alignment genuinely wins among comparable ranges — but it will NOT chase a
 * far dead-ahead ship over a close one, which matters: flying the waves showed
 * that fixating on a distant near-boresight target is exactly what feeds the
 * approach roll-spin (a long straight run at a 3-degree-off target). 800 keeps
 * the longest spin near 1s where a stronger angle preference (3000) stretched
 * it past 3s. Feel, not fit — chosen on the wave harness.
 */
export const TARGET_DIST_WEIGHT = 800;
