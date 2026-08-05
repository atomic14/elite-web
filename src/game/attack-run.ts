// The three-phase attack run — close, pass, extend — as a shipless decision:
// where to point the nose, and how fast to fly.
//
// The RULES were already one-home and pure: the phase machine and throttle
// curve (break-off.ts), the lead and pass-width arithmetic (pass-aim.ts), the
// run-out curve (extend-arc.ts), the tactic profiles (constants/tactics.ts).
// What lived in `NpcShip.attack` was the vector composition that turns those
// numbers into an aim point, and that composition is behaviour too: written
// out a second time for the commander's scripted co-pilot it would drift from
// the run every pirate flies, which is exactly the fight the co-pilot is
// supposed to replicate. So the composition moved here, and npc.ts and the
// co-pilot both call it.
//
// What is deliberately NOT here: wingman separation (a gang concern, composed
// on top by npc.ts), the trigger (the NPC gun and the commander's laser are
// different instruments), and the tactic SWITCH (it reads a ship's own hull
// and hurt — the caller chooses the tactic, this flies it).
//
// The steer decision and the speed decision are two calls because they happen
// either side of the steering itself: the closing throttle reads the heading
// error AFTER the nose has moved this frame's step, and folding the two into
// one call was measurably not the same fight.

import * as THREE from 'three';
import {
  nextAttackPhase, rollExtendRange, closingThrottle, type AttackPhase,
} from './break-off.ts';
import { leadTime, passMissDistance } from './pass-aim.ts';
import { extendArcAngle } from './extend-arc.ts';
import type { Tactic } from '../constants/tactics.ts';

/**
 * The per-run dice a ship carries between frames — a subset of `NpcState`,
 * which is how it is saved; the co-pilot keeps its own copy per engagement.
 */
export interface AttackRunState {
  attackPhase: AttackPhase;
  /** how far out THIS run goes before turning back — re-rolled per run */
  extendRange: number;
  /** which side this run passes on, +1 or -1, re-rolled with extendRange */
  passSide: number;
  /** completed runs over the ship's life — read by the missile rules */
  passesMade: number;
}

const tmpTo = new THREE.Vector3();
const tmpSide = new THREE.Vector3();
const tmpOut = new THREE.Vector3();
const tmpMark = new THREE.Vector3();
const tmpAim = new THREE.Vector3();

/**
 * A unit vector to one side of the run in — THE SIDE THE SHIP IS ALREADY
 * STEPPING TO.
 *
 * It is the part of the ship's own heading that is not along the line of
 * sight, normalized: "keep going the way you are going, only more so." A
 * correction rather than a preference.
 *
 * IT USED TO BE THE SHIP'S LOCAL +X, deprojected the same way. That puts the
 * aim point to one side of the SHIP regardless of which side of the target it
 * is actually passing — half the time the far side, reachable only through
 * the hull it is trying to miss — and it runs away: steering toward a point
 * defined by your own +X rotates +X, so the ship chases its own right hand
 * (docs/TODO/66 measured an intended 110-unit miss delivered as 75, with 29%
 * of a Python's merges inside 70 units). Taking the side off the HEADING
 * makes the loop negative feedback: a ship wide of the line turns in, one
 * inside it turns out, neither crosses the target. Same 60 episodes, contact
 * per episode 0.10 -> 0.00.
 *
 * `passSide` is the tie-break and only the tie-break: a ship pointed dead at
 * its target has no side yet, and that is when the coin is tossed. Derived
 * rather than stored, so nothing new is snapshotted.
 */
function passOffset(
  pos: THREE.Vector3, quat: THREE.Quaternion, targetPos: THREE.Vector3, passSide: number,
): THREE.Vector3 {
  const to = tmpTo.copy(targetPos).sub(pos).normalize();
  const side = tmpSide.set(0, 0, -1).applyQuaternion(quat);
  side.addScaledVector(to, -side.dot(to));
  const len = side.length();
  if (len > 1e-3) return side.divideScalar(len);
  const tie = tmpSide.set(1, 0, 0).applyQuaternion(quat);
  tie.addScaledVector(to, -tie.dot(to));
  const tieLen = tie.length();
  return tieLen > 1e-4 ? tie.multiplyScalar(passSide / tieLen) : tie.set(0, 0, 0);
}

/**
 * How fast the RANGE is shutting: our speed, less however much of the
 * target's motion is carrying it away down the same line. The one number the
 * aim is built from — `leadTime` turns it into when the ships meet,
 * `passMissDistance` into how wide to step.
 */
function closingRate(
  pos: THREE.Vector3, speed: number,
  targetPos: THREE.Vector3, targetVel: THREE.Vector3 | null, dist: number,
): number {
  if (!targetVel || dist < 1e-3) return speed;
  const to = tmpTo.copy(targetPos).sub(pos).divideScalar(dist);
  return speed - targetVel.dot(to);
}

/**
 * One frame of the run: advance the phase (rolling the next run's dice at the
 * moment a pass completes), and return the point to steer toward — or null to
 * hold the committed line, which is what a pass IS.
 *
 * @param packOffset the gang's approach bearing for this ship, applied while
 * still outside its own turn-back range — or null for a ship flying alone.
 * @param rng the caller's stream. npc.ts passes the world's seeded `random`
 * so a pirate's rolls stay exactly where they were; the co-pilot passes the
 * same stream for the same reason.
 * @returns a scratch vector valid until the next call — steer, then let go.
 */
export function attackRunSteer(
  state: AttackRunState,
  pos: THREE.Vector3, quat: THREE.Quaternion, speed: number,
  targetPos: THREE.Vector3, targetVel: THREE.Vector3 | null, dist: number,
  underFire: boolean,
  packOffset: THREE.Vector3 | null,
  tactic: Tactic,
  rng: () => number,
): THREE.Vector3 | null {
  const wasPhase = state.attackPhase;
  state.attackPhase = nextAttackPhase(state.attackPhase, dist, underFire, state.extendRange);
  if (state.attackPhase === 'extending' && wasPhase !== 'extending') {
    // A NEW run: re-roll how far this one goes and which side the next pass
    // steps off to. Rolling here rather than at spawn is what destaggers a
    // gang — see break-off.ts. Reaching `extending` is what it MEANS to have
    // completed a pass.
    state.extendRange = rollExtendRange(rng());
    state.passSide = rng() < 0.5 ? -1 : 1;
    state.passesMade += 1;
  }
  if (state.attackPhase === 'passing') {
    // GO THROUGH. The heading that got here is already the one that carries
    // it past, and turning now is what caused the collisions.
    return null;
  }
  if (state.attackPhase === 'extending') {
    // Past it and opening the range — on a curve, `psi` off the outward
    // radial, bending toward the side the next run-in wants. extend-arc.ts
    // has the ramp; this is the geometry it takes as numbers.
    const side = passOffset(pos, quat, targetPos, state.passSide);
    const out = tmpOut.copy(pos).sub(targetPos);
    const outLen = out.length();
    if (outLen <= 1e-4) return null;
    out.divideScalar(outLen);
    const psi = extendArcAngle(dist, state.extendRange, tactic.arcAngle);
    return tmpAim.copy(pos)
      .addScaledVector(out, Math.cos(psi) * dist)
      .addScaledVector(side, Math.sin(psi) * dist);
  }
  // CLOSING: aim beside where it WILL be. The offset keeps the run off the
  // hull, the lead keeps the offset from being spent on the target's own
  // travel — pass-aim.ts argues both. One closing speed feeds both halves.
  const closing = closingRate(pos, speed, targetPos, targetVel, dist);
  const mark = tmpMark.copy(targetPos);
  if (targetVel) mark.addScaledVector(targetVel, leadTime(dist, closing));
  if (dist > state.extendRange) {
    // still inbound from far out: approach on the gang's offset bearing
    const aim = tmpAim.copy(targetPos);
    return packOffset ? aim.add(packOffset) : aim;
  }
  return tmpAim.copy(mark).addScaledVector(
    passOffset(pos, quat, mark, state.passSide),
    passMissDistance(dist, closing, speed, tactic.missDistance));
}

/**
 * The speed this frame of the run wants — flat out except in the closing
 * leg, where the throttle comes off the HEADING ERROR so a ship coming round
 * halves its turn radius (break-off.ts has the arithmetic).
 *
 * @param facing the nose-to-target angle AFTER this frame's steering — the
 * honest reading, and the reason this is a second call.
 */
export function attackRunSpeed(
  phase: AttackPhase, facing: number, maxSpeed: number, tactic: Tactic,
): number {
  return phase === 'closing'
    ? maxSpeed * closingThrottle(facing, tactic.throttleFloor)
    : maxSpeed;
}
