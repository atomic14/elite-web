// THE VOCABULARY: the several ways one hostile can fly the one attack run, as
// numbers.
//
// WHICH of them a given ship may fly, and when it re-decides, is `tactic-
// choice.ts` next door. That is a different question and it had grown to half
// of this file — the same seam docs/TODO/67 cut between `break-off.ts`'s phases,
// `pass-aim.ts`'s aim point and `extend-arc.ts`'s run-out, and for the same
// reason: each of those owns its own numbers with its own sweep table, and a
// file that owns two subjects is a file where the next person's table has to
// displace somebody else's.
//
// Chris, after the attack run shipped: *"we should think of these scripted
// behaviours as different strategies that an NPC can pick from randomly. We now
// have a quite good — run at the enemy, fly past and turn, we can have other
// strategies. What might be interesting is that an NPC could switch strategies
// if it is getting damaged."*
//
// The problem this solves is not that the attack run is bad. It is good — 4.45
// passes an episode against a turret's 0.00, and docs/TODO/66 and 67 are the two
// rounds of measurement that got it there. The problem is that EVERY hostile in
// the galaxy flies it, identically, so a player learns one pattern once and the
// whole game is solved.
//
// ## What a tactic IS here
//
// Not a fifth flight model. There is ONE attack run — `break-off.ts`'s phases,
// `pass-aim.ts`'s aim point, `extend-arc.ts`'s run-out — and a tactic is a named
// set of THREE of its numbers. That is the whole design, and it is deliberate:
// a second flight model is a second place for a combat rule to live, which is
// the failure CLAUDE.md is organised against, and every one of the numbers below
// sits inside a range one of those three files has already measured and argued.
//
//   missDistance   how far to the side the pass is aimed (pass-aim.ts)
//   arcAngle       how hard the run-out curves back (extend-arc.ts)
//   throttleFloor  how far back it pulls the throttle to turn (break-off.ts)
//
// What is deliberately NOT varied is the run-out BAND. `EXTEND_RANGE_MIN/MAX`
// is coupled to `PASS_FAR` — the measurement's threshold has to sit below the
// shortest run the model produces — and a tactic that rolled a shorter band
// would silently stop the trainer counting its own attack runs. So the rhythm
// stays one rhythm and the tactics differ in geometry.
//
// ## Why THESE four
//
// Judged against CLAUDE.md's "threat is not fun", which names the two failures
// to design against: a ship that hangs far out sniping, and one that hangs very
// close and pivots. Both are the same failure — a ship that stops flying — and
// every row below keeps flying by construction, because all four are the same
// three-phase run with a different pass.
//
//   run     what ships today. Half of all rolls, so half the sky is the
//           behaviour that was measured, and the vocabulary is an addition
//           rather than a replacement.
//   slash   a wide, fast pass that stays out of knife range and keeps its
//           speed up. It trades the gun for the hull: a wider aim is a wider
//           angle at every range, and `NPC_FIRE_GATE` is an angle, so a slasher
//           gets fewer shots away and takes less back. This is what a fragile
//           hull should do, and it is why a hurt ship is weighted toward it.
//   knife   the opposite trade — a tighter pass, curving back hard. It is the
//           dangerous one, and how far it may be tightened turned out to be a
//           measurement rather than a preference: see the row, where the first
//           draft of this file got it wrong by 30 units.
//   ram     a doomed ship that aims at the hull instead of beside it. Not
//           rollable: it is reachable only from a last stand, only by a hull
//           fast enough to catch a commander, and once taken it is never
//           re-rolled. `pass-aim.ts` measured aiming at the target at 104 points
//           of contact damage an episode and called it "a collision by
//           construction" — which it is, and here that is the point.
//
// ## And why not the others
//
// docs/TODO/68 lists nine candidates. Five are not here and each has a reason:
//
//   standoff            Chris's own named failure mode, and `pirate-attack-g3`
//                       is the measured proof it is not hypothetical (median
//                       range 240, 0.00 passes). Building a deliberate one
//                       needs it to be punishable first, and nothing in the
//                       game punishes it yet.
//   disengage and heal  the strongest of the rejected five, and the one to add
//                       next — there is room for it in this file now. It spends
//                       the PLAYER'S time by design, and the most recent
//                       complaint on record is about exactly that: "they fly
//                       quite far before turning for another run". Adding a
//                       tactic whose whole content is a longer run-out without
//                       flying it first is how that complaint comes back.
//   lag pursuit         a different aim RULE, not a different aim NUMBER, so it
//                       is the first candidate that would put a second steering
//                       law in the closing leg. Worth it, but not on the same
//                       change as the vocabulary itself.
//   scissors            needs "somebody is on my six", which nothing computes.
//   pincer / blocking   need fleet coordination and a station the ship knows
//                       about. Expensive, and stated as such in the item.
//
// EVERYTHING HERE IS DATA. No function, no state, no chance: the table and the
// argument for each number in it, exactly as `break-off.ts` is the ranges and
// the argument for each of those. `npc.ts` reads a row per frame and hands the
// three numbers to the three modules that own them.

import { CLOSING_THROTTLE_MIN } from './break-off.ts';
import { PASS_MISS_DISTANCE } from './pass-aim.ts';
import { EXTEND_ARC_ANGLE } from './extend-arc.ts';

/**
 * Which way a ship flies its attack run. Rolled at spawn and re-rolled on a
 * trigger — `tactic-choice.ts` owns both.
 */
export type TacticId = 'run' | 'slash' | 'knife' | 'ram';

/** Every tactic, in the order a readout should list them: least to most committed. */
export const TACTIC_IDS: readonly TacticId[] = ['slash', 'run', 'knife', 'ram'];

/**
 * One way of flying the run — three numbers, each of them a number one of the
 * three attack-run modules already owns.
 */
export interface Tactic {
  readonly id: TacticId;
  /**
   * How far to the side of its target the pass is aimed, before `pass-aim.ts`
   * stretches it for the geometry. `run`'s is `PASS_MISS_DISTANCE` itself.
   */
  readonly missDistance: number;
  /**
   * The angle the run-out holds off the outward radial at its tightest —
   * `extend-arc.ts`'s `EXTEND_ARC_ANGLE` for `run`.
   *
   * The two departures below are small on the clock and large in the sky, and
   * that combination is why this is the third number rather than the run-out
   * band. extend-arc.ts swept the angle and published the table: over 40
   * episodes the median merge-to-merge gap is 7.47s at 45 degrees, 7.22 at 60
   * and 7.32 at 70, with contact per merge flat across all three. So a ship
   * that curves back flat and one that whips round hard cost the player the
   * same seconds and look nothing alike, which is the trade a feel change
   * wants — and it is why the angle can be spent where the run-out's LENGTH
   * cannot.
   */
  readonly arcAngle: number;
  /**
   * The slowest fraction of top speed it throttles back to in order to turn —
   * `break-off.ts`'s `CLOSING_THROTTLE_MIN` for `run`.
   *
   * Every value here MUST stay above `MIN_CRUISE_FRACTION` (0.43), for the
   * reason break-off.ts gives: that floor is a backstop against a fighter that
   * can stop dead, which is how you hold a firing line and become the turret
   * this whole cycle exists to avoid. A tactic that reached it would put the
   * rule and the backstop in an argument. `test/tactics.test.ts` holds the
   * table to it.
   */
  readonly throttleFloor: number;
  /**
   * Whether the pass is MEANT to connect.
   *
   * True for `ram` and nothing else, and it is a field rather than an
   * `id === 'ram'` check because it is what `tactic-choice.ts`'s clearance gate
   * reads: a tactic that aims to hit is exempt from having to clear the hull,
   * and that exemption should be stated by the row rather than by a special
   * case in another file.
   */
  readonly aimsToHit: boolean;
}

export const TACTICS: Record<TacticId, Tactic> = {
  // The shipped attack run, named. Every constant is the one its own module
  // already exports, imported rather than repeated, so this row cannot drift
  // away from the behaviour it is supposed to BE.
  run: {
    id: 'run',
    missDistance: PASS_MISS_DISTANCE,
    arcAngle: EXTEND_ARC_ANGLE,
    throttleFloor: CLOSING_THROTTLE_MIN,
    aimsToHit: false,
  },
  // 175 is 1.6x the standard pass, which is one more width of hull-plus-
  // commander further out (see `PASS_CLEARANCE`) — far enough that the player
  // never gets a point-blank shot at it and it never gets one at them. It holds
  // 0.72 of its top speed because a slash does not slow down to turn, it uses
  // the room it has bought instead; and 45 degrees of arc flattens the run-out
  // so it goes out wide and comes back on a long curve.
  //
  // Measured on the fixture in `knife` below, this is the only row that NEVER
  // touches anything: 0.00 contacts an episode against `run`'s 0.33, and a
  // third of the ship-on-ship with it. It pays 39.6% of the commander's pools
  // against `run`'s 57.9% — which is the trade stated as a number, and the
  // reason a hurt ship is weighted toward it rather than away. Narrowing it to
  // 150 was measured too and buys 5 points of that damage back for 0.10
  // contacts; the zero is worth more, because it is what makes the vocabulary
  // AS A WHOLE cost the player nothing it did not already cost them.
  slash: {
    id: 'slash',
    missDistance: 175,
    arcAngle: (45 * Math.PI) / 180,
    throttleFloor: 0.72,
    aimsToHit: false,
  },
  // 100, and the first draft of this file said 70 — which was WRONG in a way
  // worth keeping written down, because it is the same lesson pass-aim.ts
  // learnt arriving from the other side. LETHALITY AND CONTACT ARE ONE AXIS in
  // this flight model: a tighter pass is more dangerous because it is closer to
  // a collision, and past a point it IS one. Five pirates, a holding
  // commander's Cobra, 40 episodes of 70s, this tactic pinned on every hull
  // offered it:
  //
  //   intended pass     70     85    100    110
  //   contact/episode  1.35   1.10   0.60   0.30
  //   share of pools   72.8%  71.9%  61.2%  55.9%
  //
  // ...against 0.33 and 57.9% for a sky flying nothing but `run`. So 70 buys a
  // fifth more damage for four times the ramming, which is this tactic being a
  // `ram` with extra steps, and CLAUDE.md is explicit that threat is not "flew
  // into you". 100 is the knee: still the most lethal row in the table when it
  // is the only thing flying, and in a MIXED sky it costs nothing at all — 0.33
  // contacts an episode, exactly the number a sky of pure `run` produces,
  // because `slash` never touches anything and pays for it.
  //
  // 70 degrees of arc is the tightest angle extend-arc.ts measured without the
  // mid-range loiter its table shows at 85.
  knife: {
    id: 'knife',
    missDistance: 100,
    arcAngle: (70 * Math.PI) / 180,
    throttleFloor: CLOSING_THROTTLE_MIN,
    aimsToHit: false,
  },
  // No offset at all and no throttling back — the aim point IS the lead point,
  // and the ship holds full power into it. Everything else about the run is
  // unchanged, which is what makes this cheap: it is the same three phases, and
  // pass-aim.ts already measured what aiming at the target does.
  ram: {
    id: 'ram',
    missDistance: 0,
    arcAngle: EXTEND_ARC_ANGLE,
    throttleFloor: 1,
    aimsToHit: true,
  },
};
