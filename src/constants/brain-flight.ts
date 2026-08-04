// How a trained policy becomes flight: the rate ramp every shipped brain was
// fitted at, and how often one re-decides.
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
