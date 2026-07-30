// Which way the station's docking slot faces.
//
// Three lines, and they had two homes: `station.ts` exported this while
// `world/system-scene.ts` recomputed it inline to place the launch marker. That
// is the failure this project is organised against, in miniature — and it only
// surfaced because importing the station's version into `spawning.ts` created
// an import cycle that ran spawning -> station -> screens -> combat-sim.
//
// It lives in `world/` because `world/` never imports `game/`: this is geometry
// about an object in the sky, not a rule about docking with it.

import * as THREE from 'three';

/**
 * The slot's outward normal, in world space.
 *
 * The station model's mouth faces -Z, so this is -Z rotated into the station's
 * frame. Ships launch along it, dock against it, and the station's own Vipers
 * are stacked down it.
 */
export function slotNormal(
  station: THREE.Object3D, out = new THREE.Vector3(),
): THREE.Vector3 {
  return out.set(0, 0, -1).applyQuaternion(station.quaternion);
}
