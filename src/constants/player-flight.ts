// The commander's flight envelope: how fast the ship you fly goes, how hard it
// accelerates, how sharply it turns, and how a turn ramps up and bleeds off.
//
// ONE OBJECT, AND IT IS THE ONLY SPELLING. `player.ts` used to hold six
// module-private literals AND a `PLAYER_FLIGHT` assembled out of them: the
// flight model read the literals, everybody else read the object, and the same
// six values were written down twice in one file. The literals are gone and
// `PlayerShip.update` reads this.
//
// It exists at all because two console harnesses that fly the player's ship
// with a trained policy — test/playtest.js and the since-deleted
// test/gang-trial.js — each hand-copied these numbers, and both had drifted to
// roughly HALF the real pitch and roll: 0.7/1.2 against 1.45/2.5, ramping 4/5
// against 4/12. Every "can a commander survive this?" figure they produced was
// measured on a ship that does not ship.
//
// The RULE these are arguments to is `player.ts`'s `rampToward`, which is the
// one copy of the ramp. What an NPC's brain flies the same rule with is
// `brain-flight.ts`, and the two must not be fused — see `rateRamp` below.

/**
 * The player's flight envelope, in one place a harness can read.
 *
 * Training flies THIS ship as the target (`ai-training/scenario.ts` reads
 * `PLAYER_FLIGHT`), so a change to any of these is a change to the world every
 * pirate brain is fitted in. It used to be free — the simulator carried its own
 * copy of the commander, and the copy was wrong (accel 120 against 220) for
 * every brain up to generation 1. Free was worse.
 */
export const PLAYER_FLIGHT = {
  /** Top speed, world units per second. */
  maxSpeed: 400,

  /** Thrust, world units per second per second, in both directions. */
  accel: 220,

  /**
   * The player's Cobra turns at these, and it is a Harmless number rather than
   * a released one. Raised from 1.1/2.0 so you can actually hold a bead on a
   * fighter.
   *
   * A pirate's pitch cap is its roster `turnRate` times `TURN.pitch`
   * (`hull-motion.ts`), so against a commander at 1.1 the small hulls simply
   * turned inside you and combat felt unwinnable. At 1.45 you out-turn a pirate
   * Cobra (0.8 x TURN.pitch = 1.12) and a Krait (1.40), match a Mamba (1.47),
   * and are still edged by a Sidewinder (1.54) — which is as it should be,
   * those are far smaller ships.
   *
   * The comparison originally also named an Asp Mk II at 1.68, and that hull is
   * NO LONGER ROSTERED as a pirate — `ship-specs.ts` states the omission and
   * why. Four figures transcribed out of another file's table, and one of them
   * had quietly stopped being true. `test/combat-model.test.ts` now re-derives
   * all of them from the roster rows they name, so the next one cannot.
   */
  maxRoll: 2.5,
  maxPitch: 1.45,

  /**
   * How fast a turn rate ramps up while a control is held, as a time constant
   * in reciprocal seconds.
   *
   * DO NOT FUSE THIS WITH `brain-flight.ts`'s `BRAIN_RATE_RAMP`. That one is
   * also 4.1396 and it is a DIFFERENT RULE: both were recalibrated from a flat
   * 4.0 when `rampToward` went exponential, so they agree by history and not by
   * design. The decays are the evidence — this one went 5.0 to 12.0 to 13.3886
   * so that a light tap would stop when the key did, and the NPCs' stayed at
   * 5.2207 because moving it would have changed the world every policy was
   * fitted in.
   *
   * THIS ONE IS THE FEEL SETTING, and retuning it is nearly free: nothing was
   * fitted against it. `BRAIN_RATE_RAMP` is what every shipped genome WAS
   * fitted at, and moving that puts all three policies out of distribution with
   * nothing going red — a brain is a save file that does not tell you when you
   * have broken it. They are in different files so they can move apart, and
   * each file names the other so that neither can be moved in ignorance.
   *
   * `test/combat-model.test.ts` pins all four constants of the pair against the
   * linear rule they were re-fitted from. That is the gate; it is in a file
   * about NPCs because the re-fit is one rule and half of it used to live in
   * test/flight.test.ts, which was one rule with two homes again.
   */
  rateRamp: 4.1396,

  /**
   * How fast the turn rate bleeds off when you let go. Was 5.0, which made a
   * light tap far bigger than it should be: most of the movement came AFTER the
   * key was released, not during it. Measured on a 100ms tap at 1/60s, the ship
   * swung 6.9 degrees, of which 5.5 was coast-down — against target hit windows
   * of 1-2.5 degrees. At 12 the same tap is 3.7 degrees and stops when you stop.
   * Peak rates are untouched, so sustained turns are as quick as before; only
   * the tail is tightened.
   */
  rateDecay: 13.3886,
} as const;
