// WHEN A MISSILE LEAVES THE RAIL — and nothing about where it goes afterwards.
//
// The pair to `ordnance.ts`, which owns missiles IN FLIGHT: spawn, homing,
// E.C.M. defeat, impact. This file owns the decision that precedes all of that,
// and it is a rule rather than a simulation, so it is pure and it is here where
// a test can reach it without a world.
//
// It was the last third of `gunnery.ts`, which is otherwise entirely about the
// LASER — the firing cone, the hit chance, the trigger pull, the ranges. Two
// subsystems in one file, and the file crossed 400 lines when the launch rule
// grew a reason for existing. "It is long" is not a reason to allowlist, and
// "what is this file FOR" had an `and` in the answer, so it split at the seam
// that was already there.
//
// The gates it reads are constants/ordnance.ts, together with the flight
// numbers of the warhead they let off the rail: the code splits the decision
// from the simulation because they are different KINDS of thing, but a missile's
// envelope is one weapon's and reads as one.

import {
  MISSILE_COMMIT_PASSES, MISSILE_LAST_STAND_GATE, MISSILE_LAST_STAND_HULL,
  MISSILE_LAST_STAND_MIN_RANGE, MISSILE_MAX_RANGE,
} from '../constants/ordnance.ts';

/**
 * Is this ship in enough trouble to spend a missile?
 *
 * THE OPPORTUNISTIC LAUNCH IS GONE, and deleting it is the point rather than a
 * side effect. It was `dist > 1200 && dist < 3200 && roll < 0.3` — a dice roll
 * in a distance band — and the band was the whole problem: a ship only
 * "preferred" a missile when it was 1,200 to 3,200 units out, which is exactly
 * when it is NOT engaging. Six organised pirates therefore sat at a median of
 * 2,705 units, made ZERO passes between them, and killed a commander in 9.1
 * seconds with five launches. He never fired a shot. 94% of the damage was
 * missiles and the fight never happened, because the rule paid ships to stand
 * off and the attack run they were flying paid them to come in.
 *
 * Two ways in, and each is a REASON rather than a roll:
 *
 *   - `hull <= MISSILE_LAST_STAND_HULL` — about to die, spend it or lose it.
 *     This is the original desperation launch and it is unchanged.
 *   - `passes >= MISSILE_COMMIT_PASSES` — it has flown at the target twice and
 *     the target is still flying. This is Chris's "tougher than you thought",
 *     and it is what makes a missile something a ship EARNS by engaging.
 *
 * A ship that has done neither has no business launching, however good the
 * geometry is. The range and bearing gates still apply on top: `dist` inside
 * the seeker's envelope, and a bearing the ship could plausibly launch on.
 *
 * THERE WAS A THIRD — `matesLost > 0`, "the gang is losing, one of us is
 * already gone" — and it is deleted rather than repaired (docs/TODO/75). It
 * could never fire in the live game: it counted `!alive` ships in `world.npcs`,
 * and every path that kills an NPC despawns it inside the same statement
 * (`Combat.destroy` opens with `wreck`, which splices the array), so no NPC has
 * ever run a decision in a frame where a dead mate was still in the list. It
 * DID fire in a training episode, whose fleet is never pruned — one rule, two
 * worlds, opposite answers. Rebuilding it as a counter on the world or a latch
 * on the ship was the alternative and was rejected: nobody had decided the gang
 * should be more dangerous, and turning it on would have added warheads to
 * exactly the fights already going badly for the player. If a gang's losses
 * should escalate it, that is a balance decision to make deliberately, and it
 * starts from a world counter rather than from this.
 */
export function npcMissileEmergency(
  hull: number, passes: number, dist: number, bearing: number,
): boolean {
  if (dist <= MISSILE_LAST_STAND_MIN_RANGE || dist >= MISSILE_MAX_RANGE) return false;
  if (bearing >= MISSILE_LAST_STAND_GATE) return false;
  return hull <= MISSILE_LAST_STAND_HULL
    || passes >= MISSILE_COMMIT_PASSES;
}

/*
 * `npcMissileLastStand` used to live here — the desperation launch, hull <= 0.4.
 * It is not gone as a RULE, it is the first of the two reasons inside
 * `npcMissileEmergency`. Keeping it as a second entry point would have been one
 * rule with two homes, which is the failure this codebase is organised against:
 * both would have had to keep the same range and bearing gates in step by hope.
 */
