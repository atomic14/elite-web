// The four cockpit views, and which way each one faces.
//
// Front, rear, left, right — the original's four windows. This is a small file
// on purpose: `viewDirection` is needed by the step (the missile lock), by
// combat.ts (a rear-view shot hits what is behind you, not what the nose points
// at), and by the Game (the gun, the sight, the camera). It lived in
// world-step.ts, which made combat.ts import the step and the step import
// combat.ts's DamageSource — the project's last import cycle, over a function
// that belongs to neither of them.
//
// One home, and now a home that depends on nothing.

import * as THREE from 'three';

/** Yaw for each view: front, rear, left, right. */
export const VIEW_QUATS = [0, Math.PI, Math.PI / 2, -Math.PI / 2].map((a) =>
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a));

/**
 * Direction the given view faces, in world space.
 *
 * Not where the NOSE points — that difference is the whole reason rear lasers
 * are worth fitting.
 */
export function viewDirection(
  quaternion: THREE.Quaternion, view: number, out: THREE.Vector3,
): THREE.Vector3 {
  return out.set(0, 0, -1).applyQuaternion(VIEW_QUATS[view]).applyQuaternion(quaternion);
}
