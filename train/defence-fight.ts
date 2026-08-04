// WHAT A DEFENDER MEETS, and what it is flying when it meets it.
//
// One seed in, one fight out. `train/evolve.ts` builds the defend phase's
// episodes from this, and `train/defence-probe.ts` measures a policy over the
// same derivation on held-out seeds — which only means anything if the two agree
// exactly. They used to be two copies of the same four lines, each with a
// comment telling the next person to keep them in step by hand; adding a fourth
// axis to that was going to be the run where they quietly stopped agreeing and
// the probe reported on a distribution nothing was fitted to.
//
// Chris: "we should train against all the different scenarios and ships. Let's
// make sure our combat computer sees everything that could be thrown at it."
//
// `jameson-defend-g1` and the first g2 both trained against EXACTLY two pirates
// flying at EXACTLY one hull, so what they were fitted for was a single scenario
// repeated with different dice. The game does not do that: a wave is one ship or
// six, the tiers climb, and the same policy flies the combat computer in
// whatever the commander happens to be sitting in.
//
// Erasable-TypeScript only — runs in Node via --experimental-strip-types.

import type { TargetHullId } from '../src/ai-training/scenario.ts';
import type { LaserType } from '../src/game/commander.ts';

const HULLS: TargetHullId[] = ['playerCobra', 'traderCobra', 'playerCobraSlow'];

/**
 * Pulse is deliberately NOT in the rotation. A commander who has bought the
 * combat computer has bought a gun to go with it, and pulse reloads at 0.24s
 * against 0.09 for the other two — a policy fitted at that rate learns a trigger
 * discipline that is wrong for the ship it will actually be flying.
 */
const LASERS: LaserType[] = ['beam', 'military'];

export interface DefenceFight {
  /** how many pirates: one is a duel, four is a gang, and they differ */
  count: number;
  /** which of the flyable envelopes the commander is in */
  hull: TargetHullId;
  /** which gun she answers with */
  laser: LaserType;
  /**
   * ...and whether she has the extra energy unit, which DOUBLES how fast the
   * bank comes back (systems.ts `ENERGY_UNIT_MULTIPLIER`).
   *
   * It is in the rotation for the same reason the laser is — the same commander
   * is being fitted out, and it is 15,000 credits at TL8 next to the combat
   * computer — and for one the laser does not have: since docs/TODO/63 the
   * target's pools recharge at all, so this is the axis that decides whether
   * breaking off to heal is a strategy or a waste of the clock. Fitted at one
   * recovery rate, a policy has learned the wrong answer to that for half the
   * ships that will fly it.
   */
  energyUnit: boolean;
  /**
   * ...and her E.C.M., which is FITTED IN EVERY DEFENCE FIGHT rather than
   * rotated, and that is a decision (docs/TODO/72).
   *
   * The argument is the one that keeps pulse out of `LASERS` above, only
   * stronger. A commander who has bought a 20,000-credit combat computer has
   * bought the 600-credit E.C.M., and a policy fitted in a world where a
   * warhead cannot be answered has learned to fly a game harder than the one
   * the player plays — the opposite of docs/TODO/62's failure and just as
   * wrong.
   *
   * And rotating it would repeat docs/TODO/65's mistake in a new place. There
   * is no "E.C.M. fitted" input in `observeDefend`, deliberately (17 slots, and
   * the split is written down there), so a policy could not tell which world it
   * was in — half its episodes would reward pressing a button that did nothing,
   * and the variance would land on exactly the two columns the promotion turns
   * on, `died` and pools kept.
   *
   * It is a constant FIELD rather than a constant at the call sites because
   * this function is the one home for what a defender meets, and the two
   * callers — `train/evolve.ts` and `train/defence-probe.ts` — must not be able
   * to disagree about it. Making it an axis later is one line here.
   */
  ecm: boolean;
}

/**
 * The fight a seed describes.
 *
 * The shifts are what keep the axes independent: taken off the same bits they
 * would move in lockstep with each other and with `pirateSpecFor`'s own
 * `seed % 3` tier, and "varied by seed" would mean four axes with one value. The
 * ones here come out even over the seed strides actually used — `>>> 5` gave the
 * hulls a 44/38/38 lean over 120 episodes.
 *
 * Bit 6 for the energy unit, and it was chosen by counting rather than picked:
 * over the training stream, `evolve.ts`'s 24 validation seeds and both of
 * `defence-probe.ts`'s held-out bases it splits 50/54/50/50, and it is the bit
 * with the least lean inside any one count/hull/laser cell (14%). The obvious
 * next free bit — 21, above the laser's 15 — is CONSTANT over a 240-episode
 * probe run, because 2^21 is 265 strides of 7919 wide: the axis would have read
 * as varied and been one value for a whole measurement.
 */
export function defenceFight(seed: number): DefenceFight {
  return {
    count: 1 + ((seed >>> 3) % 4),
    hull: HULLS[(seed >>> 9) % HULLS.length]!,
    laser: LASERS[(seed >>> 15) % LASERS.length]!,
    energyUnit: ((seed >>> 6) & 1) === 1,
    ecm: true,
  };
}
