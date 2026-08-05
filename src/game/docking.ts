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
// target. The station's slot is a letterbox on a hull spinning at
// `STATION_SPIN`, so a ship that cannot choose its roll cannot fit through it.
// The fix is to take the up-hint from the STATION rather than the world, which
// matches the slot's rotation for free as it turns.
//
// The letterbox itself — which way up it stands, how wide the channel is, and
// the roll tolerance — is constants/docking.ts, with the released slot
// measurements beside the values. `test/world.test.ts` and
// `test/docking.test.ts` pin the geometry.

import * as THREE from 'three';

import {
  GATE_HALF_WIDTHS, LINED_UP_LATERAL, HULL_BOX_MARGIN,
  SLOT_HALF_ACROSS, SLOT_HALF_ALONG, SLOT_DEPTH, ROLL_TOLERANCE,
} from '../constants/docking.ts';

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
  // The station's local X, not its Y: `lookAt(heading, up)` puts the ship's
  // RIGHT perpendicular to the up-hint, and the wings have to lie along the
  // slot's LONG axis, which is the station's local Y (see the header). Handing
  // it the Y put every trader through the letterbox side-on.
  out.up.set(1, 0, 0).applyQuaternion(station.quaternion);

  const gateDist = dockZ * GATE_HALF_WIDTHS;
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
  const committed = out.phase === 'run' && along > 0 && lateral < LINED_UP_LATERAL * 2;
  const linedUp = committed ||
    (lateral < LINED_UP_LATERAL && along > dockZ && along < gateDist * 1.5);

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
  out.arrived = along < dockZ && lateral < LINED_UP_LATERAL;
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


// --- who is actually docked ------------------------------------------------
//
// This lived twice: `arrived` above, which NPC traders dock on and which has
// NO roll test at all, and a re-implementation in game.ts checkStation() with
// a bounding box, a slot channel and a roll test. So an NPC could thread a
// letterbox the player could not, and only the NPC's half was testable.
//
// One rule, one home. The consequence — bounce, damage, message, or actually
// docking — stays with the Game, because that is what it costs.

/**
 * Is a point in the slot channel? `x` and `y` are station-LOCAL.
 *
 * Exported because the HUD's alignment aid asks the same question and used to
 * answer it with its own copy of the numbers (`hud/hud-model.ts`), which is the
 * rule-with-two-homes this project is organised against — and which would have
 * silently kept the old horizontal channel through this change.
 */
export function inSlotChannel(localX: number, localY: number): boolean {
  return Math.abs(localX) < SLOT_HALF_ACROSS && Math.abs(localY) < SLOT_HALF_ALONG;
}

/**
 * Are the wings lined up with the slot's long axis?
 *
 * `right` is the ship's own +X in the STATION's frame. The slot runs along the
 * station's local Y, so alignment is measured against Y and the tolerance is
 * the angle away from it. Both magnitudes are absolute: a ship upside down in
 * the slot still fits through it.
 */
export function rollAlignedWithSlot(rightX: number, rightY: number): boolean {
  return slotRollOffset(rightX, rightY) < ROLL_TOLERANCE;
}

/** How far off the slot's long axis the wings are, in radians. */
export function slotRollOffset(rightX: number, rightY: number): number {
  return Math.atan2(Math.abs(rightX), Math.abs(rightY));
}

export type DockingOutcome =
  /** nothing near enough to matter */
  | 'clear'
  /** through the slot, lined up — you are down */
  | 'docked'
  /** in the channel but rolled wrong */
  | 'slotMiss'
  /** flew into the hull */
  | 'hull';

/**
 * Where a ship is relative to the slot.
 *
 * @param scratch a Vector3 and a Quaternion to work in; this runs every frame.
 */
export function dockingOutcome(
  pos: THREE.Vector3,
  quat: THREE.Quaternion,
  station: THREE.Object3D,
  dockZ: number,
  scratch: { v: THREE.Vector3; q: THREE.Quaternion; r: THREE.Vector3 },
): DockingOutcome {
  const box = dockZ + HULL_BOX_MARGIN;
  const local = scratch.v.copy(pos);
  station.worldToLocal(local);
  // deliberately cheap: an axis-aligned cube
  if (Math.abs(local.x) > box || Math.abs(local.y) > box || Math.abs(local.z) > box) {
    return 'clear';
  }
  const inSlot = local.z < -(dockZ - SLOT_DEPTH) && inSlotChannel(local.x, local.y);
  if (!inSlot) return 'hull';

  scratch.q.copy(station.quaternion).invert().multiply(quat);
  const right = scratch.r.set(1, 0, 0).applyQuaternion(scratch.q);
  return rollAlignedWithSlot(right.x, right.y) ? 'docked' : 'slotMiss';
}
