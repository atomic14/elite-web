// Turning the world into the numbers the HUD paints.
//
// The HUD itself is a dumb painter: hand it a HudState and it draws. What it
// needs computing — where the scanner blips are, which ship the crosshair is
// over, where the docking slot lands on screen — was 210 lines inside
// game.ts's renderHud, mixed in with the assembly.
//
// These are pure functions over the state they are given. Nothing here mutates
// the game, and the only THREE objects they touch are the scratch vectors
// passed in, because this runs every frame and allocating would show.

import * as THREE from 'three';
import type { HudState, ScannerContact, ScreenTarget } from './hud.ts';
import type { NpcShip } from '../game/npc.ts';
import { isHostileToPlayer } from '../game/npc.ts';
import { PLAYER_INTEREST_RANGE } from '../game/player-interest.ts';
import {
  inSlotChannel, rollAlignedWithSlot, slotRollOffset,
} from '../game/docking.ts';

/** Everything on the scanner: the station, ships, missiles and cargo. */
export function scannerContacts(
  stationPos: THREE.Vector3,
  npcs: readonly NpcShip[],
  missiles: readonly { object: THREE.Object3D }[],
  canisters: readonly { object: THREE.Object3D }[],
  legalStatus: number,
): ScannerContact[] {
  const contacts: ScannerContact[] = [{ position: stationPos, kind: 'station' }];
  for (const npc of npcs) {
    if (!npc.state.alive) continue;
    const kind =
      npc.role === 'asteroid' ? 'asteroid'
      : npc.role === 'thargoid' || npc.role === 'thargon' ? 'thargoid'
      : isHostileToPlayer(npc, legalStatus) ? 'hostile'
      : 'ship';
    contacts.push({ position: npc.object.position, kind });
  }
  for (const m of missiles) contacts.push({ position: m.object.position, kind: 'missile' });
  for (const c of canisters) contacts.push({ position: c.object.position, kind: 'cargo' });
  return contacts;
}

/**
 * Project a world point into the HUD's marker space.
 *
 * Mirrored when the point is behind us, so an off-screen arrow points
 * BACKWARDS rather than at the point's reflection through the camera — project
 * a position behind the viewer and clip space hands you a plausible-looking
 * coordinate on the wrong side.
 *
 * Written once here because the docking-slot marker and the threat arrow both
 * need it, and both had their own copy.
 */
export function projectMarker(
  world: THREE.Vector3,
  playerPos: THREE.Vector3,
  forward: THREE.Vector3,
  camera: THREE.Camera,
  scratch: THREE.Vector3,
): { x: number; y: number; behind: boolean } {
  const behind = scratch.copy(world).sub(playerPos).dot(forward) <= 0;
  scratch.copy(world).project(camera);
  return { x: behind ? -scratch.x : scratch.x, y: behind ? -scratch.y : scratch.y, behind };
}

/** Name the ship nearest the current view axis, for the auto ship-ID line. */
export function shipIdUnderView(
  npcs: readonly NpcShip[],
  playerPos: THREE.Vector3,
  viewDir: THREE.Vector3,
  scratch: THREE.Vector3,
): string {
  let bestAngle = 0.06;
  let id = '';
  for (const npc of npcs) {
    if (!npc.state.alive) continue;
    const to = scratch.copy(npc.object.position).sub(playerPos);
    const dist = to.length();
    if (dist > 4500) continue;
    const angle = viewDir.angleTo(to.normalize());
    if (angle < bestAngle) {
      bestAngle = angle;
      id = `${(npc.object.name || 'ASTEROID').toUpperCase()} ${(dist / 1000).toFixed(1)}KM`;
    }
  }
  return id;
}

/** Nearest hostile within 9km, plus how many there are, for the threat arrow. */
export function nearestHostile(
  npcs: readonly NpcShip[],
  playerPos: THREE.Vector3,
  legalStatus: number,
): { npc: NpcShip; count: number } | null {
  let nearest: NpcShip | null = null;
  let best = Infinity;
  let count = 0;
  for (const npc of npcs) {
    if (!isHostileToPlayer(npc, legalStatus)) continue;
    const d = npc.object.position.distanceTo(playerPos);
    if (d > PLAYER_INTEREST_RANGE) continue;
    count += 1;
    if (d < best) { best = d; nearest = npc; }
  }
  return nearest ? { npc: nearest, count } : null;
}

/**
 * Where the slot is on screen, and how well lined up you are.
 *
 * The marker is deliberately NOT gated on facing the station: "which way is
 * the slot" is exactly the question you have while looking the wrong way, and
 * close in the station fills the view with a blank black face. The alignment
 * aid IS gated, so it only appears once you are actually making an approach —
 * departures launch facing away, and the aid should stay out of the way.
 */
export function dockingAid(
  station: THREE.Object3D,
  stationDockZ: number,
  playerPos: THREE.Vector3,
  playerQuat: THREE.Quaternion,
  playerForward: THREE.Vector3,
  camera: THREE.Camera,
  scratch: { a: THREE.Vector3; b: THREE.Vector3; q: THREE.Quaternion },
): { dockAid: HudState['dockAid']; slotMarker: HudState['slotMarker'] } {
  const none = { dockAid: null, slotMarker: null };
  const dist = playerPos.distanceTo(station.position);
  const slotN = scratch.a.set(0, 0, -1).applyQuaternion(station.quaternion);
  const onSlotSide = scratch.b.copy(playerPos).sub(station.position).dot(slotN) > 0;
  if (dist >= 3000 || !onSlotSide) return none;

  const slotWorld = scratch.a.set(0, 0, -stationDockZ);
  station.localToWorld(slotWorld);
  const slotMarker = projectMarker(
    slotWorld.clone(), playerPos, playerForward, camera, scratch.b);

  const facingStation = playerForward
    .dot(scratch.b.copy(station.position).sub(playerPos).normalize()) > 0.35;
  if (!facingStation) return { dockAid: null, slotMarker };

  const local = scratch.b.copy(playerPos);
  station.worldToLocal(local);
  scratch.q.copy(station.quaternion).invert().multiply(playerQuat);
  const right = scratch.a.set(1, 0, 0).applyQuaternion(scratch.q);
  return {
    slotMarker,
    dockAid: {
      x: local.x,
      y: local.y,
      // The slot's own rules, not a copy of them: this used to hardcode the
      // channel and the roll tolerance, so the aid and the dock test could —
      // and, when the letterbox turned upright, would — disagree.
      roll: slotRollOffset(right.x, right.y),
      inSlot: inSlotChannel(local.x, local.y),
      rollOk: rollAlignedWithSlot(right.x, right.y),
    },
  };
}

/**
 * Target brackets: ships in front of the current view, plus a lead marker on
 * the locked one.
 *
 * Laser bolts are instant, but the target keeps moving while you line up, so
 * the lead point shows where it will be after the bolt's flight time. Assumes
 * the target holds its current heading at cruise — which is wrong the moment
 * it turns, and is exactly why it is an aid rather than an autoaim.
 */
export function screenTargets(
  npcs: readonly NpcShip[],
  playerPos: THREE.Vector3,
  viewDir: THREE.Vector3,
  camera: THREE.Camera,
  legalStatus: number,
  locked: NpcShip | null,
  scratch: THREE.Vector3,
): ScreenTarget[] {
  const out: ScreenTarget[] = [];
  for (const npc of npcs) {
    if (!npc.state.alive) continue;
    const to = scratch.copy(npc.object.position).sub(playerPos);
    const dist = to.length();
    if (dist > TARGET_BRACKET_RANGE) continue;
    if (viewDir.dot(to.normalize()) < 0.3) continue;   // behind, or far off-view
    const ndc = npc.object.position.clone().project(camera);
    if (ndc.z > 1) continue;

    const isLocked = locked === npc;
    const target: ScreenTarget = {
      x: ndc.x,
      y: ndc.y,
      size: Math.min(0.5, (npc.radius * 2.2) / dist),
      hostile: isHostileToPlayer(npc, legalStatus),
      locked: isLocked,
      // NORMALIZED at the boundary: the bracket paints a 0..1 bar, and combat
      // stores whole source energy points — see NpcShip.healthFraction.
      hp: npc.healthFraction,
      label: `${(npc.object.name || 'ASTEROID').toUpperCase()}  ${(dist / 1000).toFixed(1)}KM`,
    };
    if (isLocked && npc.role !== 'asteroid') {
      const flight = dist / BOLT_SPEED;
      const vel = scratch.set(0, 0, -1)
        .applyQuaternion(npc.object.quaternion).multiplyScalar(ASSUMED_TARGET_SPEED);
      const lead = npc.object.position.clone().addScaledVector(vel, flight).project(camera);
      if (lead.z <= 1) target.lead = { x: lead.x, y: lead.y };
    }
    out.push(target);
  }
  return out;
}

/** Ships further out than this get no bracket — the HUD would be a mess. */
export const TARGET_BRACKET_RANGE = 5000;
/** Notional bolt speed, for the lead marker only; real shots are instant. */
const BOLT_SPEED = 8000;
/** Assumed target cruise, for the same purpose. */
const ASSUMED_TARGET_SPEED = 220;
