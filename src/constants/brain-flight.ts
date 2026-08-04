// How a trained policy becomes flight: the rate ramp every shipped brain was
// fitted at, and how often one re-decides.
//
// The rule is `player.ts`'s `rampToward`; these are the arguments an NPC's brain
// flies with. The purchasable combat computer gets the same three, because the
// defence policy was fitted at the NPC ramp (`ccRamp`).
//
// Nothing here is a feel setting. Moving one does not retune the NPCs, it puts
// every shipped genome out of the distribution it was fitted in, and no test can
// see that.

/**
 * How a brain-flown ship's pitch/roll rates ramp up, and how they bleed off.
 *
 * DO NOT FUSE `BRAIN_RATE_RAMP` WITH `player.ts`'s `RATE_RAMP`. That one is also
 * 4.1396 and it is a different rule: both were recalibrated from a flat 4.0 when
 * `rampToward` went exponential, so they agree by history. The decays are the
 * evidence — the commander's went 5.0 to 13.3886 so a light tap would stop when
 * the key did, and this one stayed at 5.2207 because moving it would have
 * changed the world every policy was fitted in.
 *
 * They are in different files so they can move apart. The player's is a feel
 * setting somebody will retune; this one is what the brains were fitted at.
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
