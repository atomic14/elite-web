// THE CHOICE: may this hull fly that tactic, which one does it take, and what
// makes it re-decide mid-fight.
//
// `constants/tactics.ts` is the VOCABULARY — what a knife pass IS, in numbers.
// The thresholds and weights here are `constants/tactic-choice.ts`.
//
// Three rules live in this file and they are genuinely separate:
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
// EVERYTHING HERE IS PURE. It takes the hull as three numbers and the roll as a
// number, so every gate, weight and switch is assertable without flying
// anything. `rng.ts` is the only source of chance in the program and the caller
// in `npc.ts` is where that lives.

import { TACTICS, type TacticId } from '../constants/tactics.ts';
import { COMMANDER_HULL_RADIUS } from '../constants/collision.ts';
import {
  PASS_CLEARANCE, RAM_MIN_SPEED, TACTIC_HURT_HEALTH, TACTIC_LAST_STAND_HEALTH,
  TACTIC_MIN_DWELL, TACTIC_SLEEPER_SECONDS, TACTIC_WEIGHTS,
} from '../constants/tactic-choice.ts';

/**
 * What a tactic needs to know about the hull flying it.
 *
 * Three numbers rather than an `NpcShip`, so the gates are testable against a
 * roster row directly and a training episode's ships have nothing extra to
 * supply. `turnRate` is here because it was the first thing checked and the
 * answer was that it does not bind — see `PASS_CLEARANCE`.
 */
export interface TacticHull {
  /** the hull's contact radius, `NpcShip.radius` */
  readonly radius: number;
  readonly maxSpeed: number;
  readonly turnRate: number;
}

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
  // healthy ship however the weights are edited.
  if (health <= TACTIC_LAST_STAND_HEALTH && hull.maxSpeed >= RAM_MIN_SPEED) out.push('ram');
  return out;
}

/** Why a ship is picking a tactic. */
export type TacticReason = 'spawn' | 'hurt' | 'lastStand' | 'sleeper';

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
  const w = TACTIC_WEIGHTS[reason];
  const total = offered.reduce((sum, id) => sum + w[id], 0);
  // Nothing on offer with any weight — a hull with only `run` that is already
  // flying it, asked to try something else. Keeping what it has is the only
  // answer there is.
  if (total <= 0) return current;
  let x = roll * total;
  for (const id of offered) {
    x -= w[id];
    if (x < 0) return id;
  }
  return offered[offered.length - 1];
}

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
