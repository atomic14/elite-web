// THE CHOICE: may this hull fly that tactic, which one does it take, and what
// makes it re-decide mid-fight.
//
// `tactics.ts` next door is the VOCABULARY — what a knife pass IS, in numbers,
// with the sweep that chose each of them. This is the other question entirely:
// may this Python fly one, and should it start now? They were one file and it
// reached the 400-line ceiling with `disengage and heal` already named as the
// next tactic to add, which is the shape CLAUDE.md warns about — a file where
// the next person's measured table has to displace somebody else's to fit.
//
// Three rules live here and they are genuinely separate:
//
//   the GATE      `tacticsFor` — what this hull, in this condition, is
//                 physically able to execute. The Python making 0 passes while
//                 loitering at 739 units in Chris's wave-9 record is what a
//                 missing gate looks like: it had been given a behaviour it
//                 could not fly and defaulted to doing nothing.
//   the WEIGHTS   `chooseTactic` — how likely each offered tactic is, per
//                 reason for asking.
//   the TRIGGER   `tacticSwitchReason` — "what might be interesting is that an
//                 NPC could switch strategies if it is getting damaged", plus
//                 the anti-degeneracy rule that catches a ship failing for a
//                 reason nothing has a name for.
//
// WHAT THE VOCABULARY COSTS, measured, because a feel change that quietly moves
// a balance number is the thing to be honest about. On
// `test/selection.test.ts`'s defence fixture — 96 held-out fights, 1-4 scripted
// pirates against an armed commander — a gang takes 257 -> 234 points off a
// defender that shoots back and 276 -> 257 off one that only evades. About 8%
// less either way, and the same direction as the 1v1 flight probe's 14.7% ->
// 11.2% share of pools. `slash` is where it goes: it is a third less lethal
// than `run` by design, and it is a quarter of every spawn.
//
// THE ASYMMETRY IS NOT THE STORY, and it is written down here because a
// 24-episode read of the same fixture said it was. The triggers below only fire
// when somebody is shooting — a commander who never returns fire gets the
// undiluted spawn roll — so "fighting back pays" is a mechanism that genuinely
// exists, but at 9% against 7% it is far too small to claim as a design
// property. It was 11% against a gain at n=24, and that was sampling.
//
// EVERYTHING HERE IS PURE. It takes the hull as three numbers and the roll as a
// number, exactly as `pass-aim.ts` and `extend-arc.ts` take their geometry, so
// every gate, weight and switch is assertable without flying anything.
// `rng.ts` is the only source of chance in the program and the caller in
// `npc.ts` is where that lives.

import { TACTICS, type TacticId } from './tactics.ts';
import { COMMANDER_HULL_RADIUS } from './collisions.ts';
import { PLAYER_FLIGHT } from '../player.ts';

/**
 * What a tactic needs to know about the hull flying it.
 *
 * Three numbers rather than an `NpcShip`, so the gates are testable against a
 * roster row directly and a training episode's ships have nothing extra to
 * supply. `turnRate` is here because it was the first thing checked and the
 * honest answer was that it does not bind — see `PASS_CLEARANCE`.
 */
export interface TacticHull {
  /** the hull's contact radius, `NpcShip.radius` */
  readonly radius: number;
  readonly maxSpeed: number;
  readonly turnRate: number;
}

/**
 * How much wider than contact a pass has to be AIMED to actually clear.
 *
 * A ship does not miss by the distance it aims at; it misses by however much
 * its path has diverged from its target's by the time the two arrive, and
 * `pass-aim.ts` exists because that used to be a great deal less. With the
 * correction in place its measurement over 60 one-on-one episodes is that at an
 * intended 110 not one merge on any hull in the roster closed inside 70 units —
 * so the delivered floor is about 0.64 of the intent, and an intent therefore
 * has to be about 1.6x contact to be safe. `contact` is this hull's radius plus
 * the commander's 25 (collisions.ts).
 *
 * That is where the number comes from: a measurement, not a margin somebody
 * liked the look of.
 *
 * IT RARELY BINDS, and that is the honest state of it rather than a defect. At
 * `knife`'s 100 only the three largest hulls in the roster are excluded,
 * because the pass width where this WOULD exclude many is a width the flight
 * model rams at — see the sweep on `TACTICS.knife`. The gate with teeth is
 * `RAM_MIN_SPEED`, which stops about half the roster.
 *
 * AND THE AGILITY TERM DOES NOT BIND AT ALL, which is worth writing down
 * because it is the first thing a reader will ask for. To sit on a line offset
 * by `m` at range `d` a ship has to hold `asin(m/d)` off the line of sight, and
 * the rate it must generate to keep holding it as it closes is about `m·v/d²`,
 * worst at the merge — 0.16 rad/s for a Python flying the tightest tactic here
 * (100 x 160 / 220²) against the 0.35 rad/s it actually has, and lower for
 * every other hull because the fast ones turn faster too. So size is the
 * constraint and speed is not, and `turnRate` is carried on `TacticHull` to
 * make that checkable rather than assumed.
 */
export const PASS_CLEARANCE = 1.6;

/**
 * The slowest hull that may be offered a ram.
 *
 * A commander's Cobra tops out at 400 and NOTHING in the roster is faster — the
 * quickest pirate is a Constrictor at 370 — so a gate of "faster than the
 * player" would offer this to nobody. The honest question is a different one:
 * can this hull force contact on a commander who is FIGHTING rather than
 * fleeing? 0.7 of the commander's top speed is the answer, and it binds where
 * it should — half the roster is too slow, including the Monitor at 152 and the
 * Python at 160, and the Python making 0 passes while loitering at 739 units is
 * the exact record docs/TODO/68 was written against. A ship that cannot arrive
 * should never be given a tactic whose entire content is arriving.
 */
export const RAM_MIN_SPEED = PLAYER_FLIGHT.maxSpeed * 0.7;

/**
 * How hurt a ship has to be before being hit makes it rethink.
 *
 * Not "took a hit", which is the trigger docs/TODO/68 names first and the wrong
 * one on its own: every ship in a firefight is hit within seconds, so a bare
 * damage trigger re-rolls the whole sky immediately and the spawn roll means
 * nothing. Damage AND a hull that is going the wrong way is the signal a pilot
 * would actually act on, and 0.6 is where half the bank has become a trend.
 */
export const TACTIC_HURT_HEALTH = 0.6;

/**
 * ...and how hurt before it is out of options. Below this a ram is on the
 * table, and nothing else new is.
 */
export const TACTIC_LAST_STAND_HEALTH = 0.25;

/** Does a pass aimed this wide clear this hull and the commander together? */
function clears(hull: TacticHull, missDistance: number): boolean {
  return missDistance >= (hull.radius + COMMANDER_HULL_RADIUS) * PASS_CLEARANCE;
}

/**
 * Which tactics this hull, in this condition, is physically able to fly.
 *
 * `run` is the FLOOR and is not gated, and that is a claim rather than a
 * convenience: it is what every hostile in the game flies today, so it is the
 * one tactic whose flyability is established by having shipped. Everything else
 * has to earn its place on a hull, which is what stops this being a table of
 * behaviours ships cannot execute — the failure the Python's 22-second loiter
 * actually was.
 */
export function tacticsFor(hull: TacticHull, health: number): readonly TacticId[] {
  const out: TacticId[] = ['run'];
  if (clears(hull, TACTICS.slash.missDistance)) out.push('slash');
  if (clears(hull, TACTICS.knife.missDistance)) out.push('knife');
  // Gated twice: a last stand is a condition rather than a disposition, and a
  // hull that cannot catch anything has no last stand to make. Both halves are
  // here rather than in the caller, so `chooseTactic` cannot hand a ram to a
  // healthy ship however the weights below are edited.
  if (health <= TACTIC_LAST_STAND_HEALTH && hull.maxSpeed >= RAM_MIN_SPEED) out.push('ram');
  return out;
}

/** Why a ship is picking a tactic. */
export type TacticReason = 'spawn' | 'hurt' | 'lastStand' | 'sleeper';

/**
 * How likely each tactic is, per reason. Relative, and renormalised over
 * whatever the hull is actually offered.
 *
 * `run` at half of every spawn is the load-bearing number: half the sky keeps
 * flying the behaviour docs/TODO/66 and 67 measured, so this change widens the
 * distribution instead of replacing it, and the probe rows stay readable
 * against the ones they are compared with.
 *
 * The `hurt` row is Chris's request as arithmetic: a ship that is losing backs
 * off about as often as it presses. `slash` was 55 of it in the first draft,
 * and 40/40 is a DESIGN choice rather than a measured one — a gang that
 * systematically retreats when hurt has swapped one learnable pattern for
 * another, which is the whole thing this module exists to stop, and it also
 * makes shooting first strictly better than it should be. It is stated as a
 * design choice because the measurement does not support a stronger claim: over
 * 96 held-out defence fights, 20/55/25 and 20/40/40 take 236 and 234 points off
 * an armed commander, which is the same number. (A 24-episode read said 11%,
 * and that was sampling — see `EPISODES` in test/selection.test.ts.)
 *
 * `ram` is zero everywhere but the last stand, on TOP of the health gate in
 * `tacticsFor`, because a rule this consequential should be impossible from two
 * directions rather than one.
 */
const WEIGHTS: Record<TacticReason, Record<TacticId, number>> = {
  spawn: { run: 50, slash: 25, knife: 25, ram: 0 },
  sleeper: { run: 40, slash: 30, knife: 30, ram: 0 },
  hurt: { run: 20, slash: 40, knife: 40, ram: 0 },
  lastStand: { run: 15, slash: 40, knife: 0, ram: 45 },
};

/**
 * Which tactic a ship takes — pure, and the whole of the choice.
 *
 * It takes the roll rather than calling `random()` for `rollExtendRange`'s
 * reason: `rng.ts` is the only source of chance in the program, `npc.ts` is
 * where that lives, and every weight and every gate here is then assertable
 * without seeding anything.
 *
 * @param current what it is flying now — read only by `sleeper`, which means
 * "this is not working, try something else" and would be a no-op if it were
 * allowed to pick the thing that is not working.
 */
export function chooseTactic(
  hull: TacticHull, health: number, reason: TacticReason, roll: number,
  current: TacticId = 'run',
): TacticId {
  const offered = tacticsFor(hull, health)
    .filter((id) => reason !== 'sleeper' || id !== current);
  const w = WEIGHTS[reason];
  const total = offered.reduce((sum, id) => sum + w[id], 0);
  // Nothing on offer with any weight — a hull with only `run` that is already
  // flying it, asked to try something else. Keeping what it has is the honest
  // answer; there is no other one.
  if (total <= 0) return current;
  let x = roll * total;
  for (const id of offered) {
    x -= w[id];
    if (x < 0) return id;
  }
  return offered[offered.length - 1];
}

/**
 * The least time a ship keeps a tactic before it may take another.
 *
 * 5 seconds, and it is bracketed on both sides. It is longer than one pass —
 * `passing` is over in a fraction of a second — so a tactic always survives long
 * enough to be seen in a record. It is shorter than one full cycle, whose median
 * merge-to-merge gap is 7.2s (`train/gap-probe.ts`), so a ship being hammered
 * can change its mind more than once in a fight rather than once per lifetime.
 */
export const TACTIC_MIN_DWELL = 5;

/**
 * How long a ship goes without getting a shot away before it concludes that
 * whatever it is doing is not working.
 *
 * THE SLEEPER, and it is the general anti-degeneracy rule: "this is not
 * working, try something else". It is the one trigger that does not need
 * anything to have gone wrong in a way the code can name — a ship 700 units out
 * with its guns cold for a quarter of a minute is failing, whatever the reason,
 * and the reason in Chris's wave-9 record was a Python that never got a run in
 * and loitered for 22 seconds.
 *
 * 12 seconds, which is comfortably past a whole attack run: the merge-to-merge
 * gap is 7.2s at the median and 9.98 at the ninetieth, so a ship that has flown
 * an entire cycle without a shot has genuinely failed rather than been unlucky.
 */
export const TACTIC_SLEEPER_SECONDS = 12;

/** Everything the switch reads. All of it is `NpcState`, and all of it saves. */
export interface TacticSituation {
  readonly tactic: TacticId;
  /** 0..1 of its bank — `NpcShip.healthFraction` */
  readonly health: number;
  /** seconds of evasive flying left after the last hit — `NpcState.underFire` */
  readonly underFire: number;
  /** seconds on the current tactic */
  readonly sinceChosen: number;
  /** seconds since it last got a shot away */
  readonly sinceShot: number;
}

/**
 * Why this ship should pick a new tactic, or null to carry on.
 *
 * Pure and ROLL-FREE on purpose, and the split from `chooseTactic` is not
 * cosmetic: a switch that drew from `rng.ts` to decide whether to switch would
 * burn a number for every hostile on every frame, which is a stream cost
 * nothing asked for. This decides; the caller draws only when the answer is yes.
 */
export function tacticSwitchReason(s: TacticSituation): TacticReason | null {
  // A last stand is a commitment. Nothing re-rolls a ram — it is the one tactic
  // a ship has decided to die flying, and a ship that changed its mind halfway
  // through would read as a bug rather than as a decision.
  if (s.tactic === 'ram') return null;
  if (s.sinceChosen < TACTIC_MIN_DWELL) return null;
  if (s.underFire > 0 && s.health <= TACTIC_LAST_STAND_HEALTH) return 'lastStand';
  if (s.underFire > 0 && s.health <= TACTIC_HURT_HEALTH) return 'hurt';
  if (s.sinceShot >= TACTIC_SLEEPER_SECONDS) return 'sleeper';
  return null;
}
