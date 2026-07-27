// Flying a ship into the station slot — the one piece of piloting that needs
// roll control, and therefore the one thing neither the scripted NPC steering
// nor the player's docking computer could previously do.
//
// Shared deliberately. Traders putting in at the station and the player's
// docking computer are the same problem: get onto the slot axis, match the
// slot's rotation, and run in. Solving it twice would mean two things to get
// wrong, and the hard part — roll — is identical for both.
//
// Why roll is the crux: `NpcShip.steerToward` builds orientation from
// `lookAt(dir, WORLD_UP)`, so roll is whatever falls out of pointing at a
// target. The Coriolis slot is a 96x20 letterbox on a station spinning at
// 0.26 rad/s, so a ship that cannot choose its roll cannot fit through it.
// The fix is to take the up-hint from the STATION rather than the world, which
// matches the slot's rotation for free as it turns.

import * as THREE from 'three';

export type DockPhase =
  /** off the axis or too far out — fly to the gate, a point straight out from the slot */
  | 'gate'
  /** lined up: run down the axis, rolled with the slot */
  | 'run';

export interface DockPlan {
  /** unit vector the ship should be pointing along */
  heading: THREE.Vector3;
  /** up-hint for the orientation — the station's own up, so roll matches the slot */
  up: THREE.Vector3;
  /** speed to fly at */
  speed: number;
  phase: DockPhase;
  /** inside the slot far enough to count as docked */
  arrived: boolean;
  /** distance off the slot axis, for HUD and tests */
  lateral: number;
}

/** How far out the approach gate sits, in multiples of the station half-width. */
const GATE = 5;
/** Off-axis error we insist on before committing to the run in. */
const LINED_UP = 45;

const _rel = new THREE.Vector3();
const _slotN = new THREE.Vector3();
const _aim = new THREE.Vector3();

/**
 * One frame of a docking approach.
 *
 * @param pos       the ship's position
 * @param station   the station object (its quaternion carries the slot's roll)
 * @param dockZ     station half-width — the slot sits on the local -Z face
 * @param maxSpeed  the ship's top speed
 * @param out       reused plan object, so this allocates nothing per frame
 */
export function planDocking(
  pos: THREE.Vector3,
  station: THREE.Object3D,
  dockZ: number,
  maxSpeed: number,
  out: DockPlan,
): DockPlan {
  // the slot faces along the station's local -Z, pointing outwards
  _slotN.set(0, 0, -1).applyQuaternion(station.quaternion);
  _rel.copy(pos).sub(station.position);
  const along = _rel.dot(_slotN);
  // perpendicular distance from the axis
  const lateral = _rel.addScaledVector(_slotN, -along).length();
  out.lateral = lateral;
  out.up.set(0, 1, 0).applyQuaternion(station.quaternion);

  const gateDist = dockZ * GATE;
  // Commit to the run only when actually on the axis. Skipping the lateral
  // test is the obvious mistake: a ship that reaches the gate 150 units
  // off-axis and then flies straight carries that error into the hull instead
  // of the slot.
  //
  // The phase LATCHES once committed (out.phase is per-ship state, reused
  // across frames). Re-testing every frame looks harmless but isn't: as the
  // ship runs in, `along` shrinks past any outside-the-hull guard, the test
  // flips back to 'gate', and it turns round and flies out again — an
  // oscillation that never docks, which is exactly what the first version did.
  const committed = out.phase === 'run' && along > 0 && lateral < LINED_UP * 2;
  const linedUp = committed || (lateral < LINED_UP && along > dockZ && along < gateDist * 1.5);

  if (linedUp) {
    out.phase = 'run';
    _aim.copy(station.position);
    out.heading.copy(_aim).sub(pos).normalize();
    // slow enough that the roll has time to settle before the letterbox
    out.speed = Math.min(110, maxSpeed * 0.7);
  } else {
    out.phase = 'gate';
    const range = pos.distanceTo(station.position);
    if (range < gateDist * 0.95 && along < dockZ * 2) {
      // Too close and on the wrong side: heading straight for the gate would
      // cut across the hull, which is how the autopilot used to scrape its way
      // in. Stand off first, then come round.
      _aim.copy(pos).sub(station.position).normalize()
        .multiplyScalar(gateDist * 1.15).add(station.position);
    } else {
      _aim.copy(station.position).addScaledVector(_slotN, gateDist);
    }
    out.heading.copy(_aim).sub(pos).normalize();
    // ease off approaching the gate, or the ship sails past and has to loop
    const toGate = _aim.distanceTo(pos);
    out.speed = Math.max(25, Math.min(maxSpeed * 0.55, toGate * 0.45));
  }

  // inside the slot mouth and still on the axis
  out.arrived = along < dockZ && lateral < LINED_UP;
  return out;
}

/** A fresh plan object to hand to planDocking each frame. */
export function makeDockPlan(): DockPlan {
  return {
    heading: new THREE.Vector3(0, 0, -1),
    up: new THREE.Vector3(0, 1, 0),
    speed: 0,
    phase: 'gate',
    arrived: false,
    lateral: 0,
  };
}
