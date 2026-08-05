// How a trained policy becomes flight: the rate ramp every shipped brain was
// fitted at, how often one re-decides, and the one correction the game applies
// to what a brain is told on the way in.
//
// The rule is `player.ts`'s `rampToward` — one copy, shared; these are the
// arguments an NPC's brain
// flies with. The purchasable combat computer gets the same three, because the
// defence policy was fitted at the NPC ramp (`ccRamp`).
//
// Nothing here is a feel setting. Moving one does not retune the NPCs, it puts
// every shipped genome out of the distribution it was fitted in, and no test can
// see that.

/**
 * How a brain-flown ship's pitch/roll rates ramp up, and how they bleed off.
 *
 * DO NOT FUSE `BRAIN_RATE_RAMP` WITH `player-flight.ts`'s
 * `PLAYER_FLIGHT.rateRamp`. That one is also 4.1396 and it is a DIFFERENT RULE:
 * both were recalibrated from a flat 4.0 when `rampToward` went exponential, so
 * they agree by history and not by design. The decays are the evidence — the
 * commander's went 5.0 to 12.0 to 13.3886 so that a light tap would stop when
 * the key did, and this one stayed at 5.2207 because moving it would have
 * changed the world every policy was fitted in.
 *
 * THIS ONE IS WHAT THE BRAINS WERE FITTED AT. Moving it puts all three shipped
 * policies out of distribution with nothing going red. The commander's is the
 * feel setting somebody will retune, and retuning it is nearly free. They are
 * in different files so they can move apart, and each file names the other so
 * that neither can be moved in ignorance.
 *
 * `test/combat-model.test.ts` pins all four constants of the pair against the
 * linear rule they were re-fitted from. That is the gate on exactly this.
 */
export const BRAIN_RATE_RAMP = 4.1396;
export const BRAIN_RATE_DECAY = 5.2207;

/**
 * How long a brain holds a decision before taking another — 10 Hz. The
 * integration runs every frame regardless, so the ship still flies smoothly
 * between decisions.
 *
 * One home, and it had two: `combat-computer.ts` named it and `brainFly` wrote
 * `0.1` out again.
 */
export const DECISION_INTERVAL = 0.1;

// `TARGET_SPEED_FLOOR` lived here until docs/TODO/91: the game clamped the
// target speed a brain was told at 150 while the trainer passed it raw, on
// the one input brains.ts said the policy had latched onto. Chris chose to
// delete the input rather than close the divergence, so the floor went with
// the observation slot it existed to protect.

/**
 * The speed scale every observation is normalized by, in world units a second:
 * `observe()` writes `target.speed / OBS_SPEED_SCALE` to slot 10 and the
 * closing rate over the same scale to slot 7, and `shipView()`'s default class
 * max is this too.
 *
 * DO NOT FUSE IT WITH `PLAYER_FLIGHT.maxSpeed`. Both are 400 and they are not
 * one rule — the same trap as `BRAIN_RATE_RAMP` and the commander's
 * `RATE_RAMP`, at a different number. This is the scale every shipped genome
 * was FITTED at: slot 10 at 0.5 means 200 units a second to every brain in the
 * bundle, forever. The commander's top speed is a feel setting that a redesign
 * may retune; if the two were one constant, retuning the engine would silently
 * rescale every observation and put all three shipped policies out of
 * distribution with nothing going red.
 */
export const OBS_SPEED_SCALE = 400;
