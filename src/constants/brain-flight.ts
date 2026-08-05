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

/**
 * Floor under the target speed an attack policy is told — below roughly this,
 * the shipped attack policies stop throttling forward, so a commander who
 * slows to fight gets pirates that hang in space.
 *
 * The floor is a lie, and a bounded one: `observe()` feeds `target.speed/400`
 * to the network, the brains were fitted against targets near freighter speed,
 * and Chris flies at a median of 66 and stops dead to turn — which read as
 * "they now sit still spinning". Measured in the sim, the attacker throttles
 * forward on 19% of frames against a stationary target and 84% against one at
 * 220; adding a stationary knife-fighter to the training pool (g2) moved that
 * to 43%, which is better and still not flying. So the game hands the policy
 * real speed where it is competent and this floor where it is not, preserving
 * the variation that matters — a target running at 400 still reads differently
 * from one turning at 200. Deleting the input entirely is the honest fix and
 * costs a retrain of every brain. How the lie is applied is
 * `BrainChoice.targetSpeed` in game/brains.ts.
 *
 * A DIVERGENCE, RECORDED RATHER THAN RESOLVED: the game applies this floor and
 * the trainer does not — `ai-training/scenario.ts` hands its pirates the
 * trader's raw speed, so against a slow or braking target a training pirate
 * reads observation slot 10 anywhere down to 0.0 where the same brain in the
 * game never reads below 150/400. Either the floor is a real game rule the
 * trainer must apply — in which case every pirate brain was fitted in a world
 * that does not exist below 150 — or it is a patch for the brain being out of
 * distribution at low speed, in which case the fix is the retrain above.
 * Either way it is a behaviour change with a training run attached, so it is a
 * decision and not a refactor. See docs/TODO/90-constants-cleanup.md, Open.
 */
export const TARGET_SPEED_FLOOR = 150;

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
 * distribution with nothing going red. `TARGET_SPEED_FLOOR / OBS_SPEED_SCALE`
 * is the 0.375 the floor's own comment quotes.
 */
export const OBS_SPEED_SCALE = 400;
