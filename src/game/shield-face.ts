// Which of the commander's two shields a hit lands on.
//
// One line of geometry, and it had two homes. `Combat.hitPlayer` turned the
// attacker's position into the ship's own frame and read the sign of z; a
// training episode dotted the nose against the direction to the shooter. They
// are the same rule written twice — `forward · v > 0` IS `v_local.z < 0`, for
// exactly the reason `forward` is `(0,0,-1)` rotated by the same quaternion —
// and "the same rule written twice, agreeing" is what this project is organised
// against rather than what it settles for. Neither copy could be changed without
// someone remembering the other: which face a shot lands on decides which pool
// it spends, and the commander has two of them (docs/TODO/64).
//
// HERS, and only hers. A ship carries one bank and has no facing at all
// (npc.ts `takeDamage`), so there is nothing here for an NPC to ask.
//
// No allocation: the two scratch objects are the caller's, because this is on
// the path every hit in the game takes.

import type * as THREE from 'three';

/**
 * Did it come from ahead?
 *
 * @param from where the hit came from — the shooter, the warhead, the canister.
 * @param pos where the ship taking it is, and `quat` which way it is pointing.
 * @param v scratch vector and `q` scratch quaternion, both overwritten.
 */
export function hitFromAhead(
  from: THREE.Vector3,
  pos: THREE.Vector3,
  quat: THREE.Quaternion,
  v: THREE.Vector3,
  q: THREE.Quaternion,
): boolean {
  return v.copy(from).sub(pos).applyQuaternion(q.copy(quat).invert()).z < 0;
}
