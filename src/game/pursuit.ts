// The pursuit dogfighter's shipless decisions: how fast to fly to sit in
// gun range behind a target, and the break-off that keeps a chase from
// becoming a ram.
//
// Two pilots fly these, so they live in ONE place rather than two: the combat
// computer flying the commander's ship (scripted-co-pilot.ts) and — since a
// player can now turn his own pilot on the opposition — a pursuit pirate
// (npc.ts). What is NOT here is the STEERING: the co-pilot points the
// commander's yaw-less ship with `pitch-roll-steer.ts` and an NPC arc-slews
// its quaternion, two different flight models pointed at the same aim. This
// file decides the aim and the speed; each caller flies them its own way.

import * as THREE from 'three';
import {
  PURSUIT_RANGE, PURSUIT_CLOSE_GAIN, PURSUIT_TURN_FLOOR,
  PURSUIT_BREAK_RANGE, PURSUIT_CLEAR_RANGE, PURSUIT_BREAK_CLEARANCE,
} from '../constants/combat-computer.ts';

/**
 * The speed to fly to hold a gun-range standoff behind a target.
 *
 * Match the target's speed, plus close (or open) the gap toward `PURSUIT_RANGE`
 * — and ease off in a hard turn (`PURSUIT_TURN_FLOOR`), because a slower ship
 * turns in a tighter radius and holds its bead. Capped to the chaser's own top
 * speed. The caller turns this into a throttle: the co-pilot into a demand sign,
 * an NPC into an `approach` toward it.
 *
 * @param facing the chaser's nose-to-target angle, in radians.
 */
export function pursuitSpeed(
  targetSpeed: number, dist: number, facing: number, maxSpeed: number,
): number {
  const turnScale = PURSUIT_TURN_FLOOR + (1 - PURSUIT_TURN_FLOOR) * Math.max(0, Math.cos(facing));
  return Math.max(0, Math.min(maxSpeed,
    (targetSpeed + PURSUIT_CLOSE_GAIN * (dist - PURSUIT_RANGE)) * turnScale));
}

/**
 * The break-off a chaser carries between frames — which is all the state a
 * two-phase pursuit needs: whether it is currently veering clear, and which
 * side it committed to for this break.
 */
export interface PursuitBreak {
  breaking: boolean;
  /** the side it banks its break toward, chosen once per break; 0 until then */
  side: -1 | 0 | 1;
}

export function freshPursuitBreak(): PursuitBreak {
  return { breaking: false, side: 0 };
}

const perp = new THREE.Vector3();
const away = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);

/**
 * Where to steer THIS frame: the target itself (pure pursuit, which curves the
 * chaser onto the six as the target turns), or — when a collision is imminent —
 * a point that carries it AWAY and to one side, so it breaks off the run
 * instead of boring in.
 *
 * A two-phase machine on `brk`: inside `PURSUIT_BREAK_RANGE` it commits to a
 * break, holding until the range opens past `PURSUIT_CLEAR_RANGE`, then resumes
 * the chase. The break aim is `away from the target, deflected to one side` — a
 * banking turn-off, not a retreat straight back — so the chaser sheds the
 * closure, swings wide, and comes round again rather than ramming. This is what
 * a pursuit pilot needs that the attack run gets from its pass-and-extend, kept
 * short so the chaser returns to the six quickly. Writes the aim into `out` and
 * returns it; allocates nothing else.
 */
export function pursuitAim(
  brk: PursuitBreak,
  pos: THREE.Vector3,
  targetPos: THREE.Vector3,
  dist: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  if (brk.breaking) {
    if (dist > PURSUIT_CLEAR_RANGE) { brk.breaking = false; brk.side = 0; }
  } else if (dist < PURSUIT_BREAK_RANGE) {
    brk.breaking = true;
  }

  if (!brk.breaking) return out.copy(targetPos);

  // Break: aim away from the target with a lateral deflection, so the chaser
  // turns off and opens the range rather than boring in. `away` is the reverse
  // of the line of sight; `perp` is a stable sideways direction (line of sight
  // crossed with world up). The clearance sets how hard the deflection banks.
  away.copy(pos).sub(targetPos);
  const len = away.length();
  if (len < 1e-6) return out.copy(targetPos); // on top of it — no direction; next frame separates
  away.divideScalar(len);
  perp.crossVectors(away, worldUp);
  if (perp.lengthSq() > 1e-6) {
    perp.normalize();
    if (brk.side === 0) brk.side = perp.dot(pos) >= 0 ? 1 : -1;
  } else {
    perp.set(0, 0, 0);
  }
  return out.copy(pos)
    .addScaledVector(away, PURSUIT_BREAK_CLEARANCE)
    .addScaledVector(perp, brk.side * PURSUIT_BREAK_CLEARANCE);
}
