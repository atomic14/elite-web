// Ships are solid: who is overlapping whom, and how to separate them.
//
// The three collision loops used to sit inside updateFlight, interleaved with
// spawning, energy regeneration and cabin temperature. They are the most
// purely physical thing the game does — geometry in, positions out — so they
// come out first.
//
// The split follows the house rule that NpcShip already uses for firing: this
// module resolves the OVERLAP and reports what happened; the Game decides what
// it costs. That line matters, because the cost is not symmetric or even
// consistent — the player's shields absorb a ram, two NPCs colliding must NOT
// credit the player with anything (see wreckNpc vs destroyNpc), and a ship
// bouncing off the station takes no damage at all.

import * as THREE from 'three';
import type { NpcShip } from './npc';

/** How much the ship that flew into something loses, and takes. */
export const RAM_DAMAGE = 0.45;
/** Speed retained after a collision — a ram should cost you your run. */
const PLAYER_SPEED_KEPT = 0.3;
const NPC_SPEED_KEPT = 0.3;
const STATION_SPEED_KEPT = 0.4;

/** Scratch vectors, so a per-frame call allocates nothing. */
export interface CollisionScratch {
  a: THREE.Vector3;
  b: THREE.Vector3;
}

/** A ship that is not a solid body: scenery, wrecks, and the docking traffic. */
function isPhantom(npc: NpcShip): boolean {
  return !npc.alive || npc.inert || npc.role === 'hermit' || npc.role === 'generation';
}

/**
 * Push the player out of any ship they are inside.
 *
 * @returns the ships that were hit, for the Game to bill.
 */
export function playerVsNpcs(
  playerPos: THREE.Vector3,
  setPlayerSpeed: (scale: number) => void,
  npcs: readonly NpcShip[],
  scratch: CollisionScratch,
): NpcShip[] {
  const hits: NpcShip[] = [];
  for (const npc of npcs) {
    if (!npc.alive) continue;
    const gap = npc.object.position.distanceTo(playerPos);
    if (gap >= npc.radius + 25) continue;
    const away = scratch.a.copy(playerPos).sub(npc.object.position).normalize();
    playerPos.copy(npc.object.position).addScaledVector(away, npc.radius + 120);
    setPlayerSpeed(PLAYER_SPEED_KEPT);
    hits.push(npc);
  }
  return hits;
}

/**
 * Ships are solid to each other, not just to the player. Without this they
 * visibly fly through one another in a dogfight.
 *
 * Symmetric, because neither party has the player's shields.
 *
 * @returns each touching pair, for the Game to bill. It must bill them with
 * `wreckNpc`, NOT `destroyNpc`: two NPCs colliding has nothing to do with the
 * player, and destroyNpc credits the kill, pays a bounty and calls
 * raiseLegal(2) when the casualty is a trader, police or bounty hunter. Two
 * ships bumping in a dogfight was making the player a FUGITIVE and scrambling
 * the station's Vipers at them for something they had no part in.
 */
export function npcVsNpcs(
  npcs: readonly NpcShip[],
  scratch: CollisionScratch,
): [NpcShip, NpcShip][] {
  const pairs: [NpcShip, NpcShip][] = [];
  for (let i = 0; i < npcs.length; i++) {
    const a = npcs[i];
    if (isPhantom(a)) continue;
    for (let j = i + 1; j < npcs.length; j++) {
      const b = npcs[j];
      if (isPhantom(b)) continue;
      const contact = a.radius + b.radius;
      if (a.object.position.distanceTo(b.object.position) >= contact) continue;

      // shove them apart around their midpoint
      scratch.a.copy(a.object.position).sub(b.object.position);
      if (scratch.a.lengthSq() < 1e-6) scratch.a.set(1, 0, 0);
      scratch.a.normalize();
      scratch.b.copy(a.object.position).add(b.object.position).multiplyScalar(0.5);
      const push = (contact + 40) / 2;
      a.object.position.copy(scratch.b).addScaledVector(scratch.a, push);
      b.object.position.copy(scratch.b).addScaledVector(scratch.a, -push);
      a.speed *= NPC_SPEED_KEPT;
      b.speed *= NPC_SPEED_KEPT;
      pairs.push([a, b]);
    }
  }
  return pairs;
}

/**
 * Ships are solid to the station too, which they used to fly straight through.
 *
 * A bounce only, deliberately: damaging them here would kill traffic at random
 * right outside the docking slot, and the problem being fixed is only that
 * ships passed visibly through the hull. Nothing is returned because nothing
 * is owed.
 */
export function npcsVsStation(
  npcs: readonly NpcShip[],
  station: THREE.Object3D,
  halfBox: number,
  scratch: CollisionScratch,
): void {
  for (const npc of npcs) {
    if (!npc.alive || npc.inert || npc.role === 'hermit') continue;
    if (npc.docking) continue; // a trader on final approach is *meant* to go in
    const local = scratch.a.copy(npc.object.position);
    station.worldToLocal(local);
    if (Math.abs(local.x) > halfBox || Math.abs(local.y) > halfBox
        || Math.abs(local.z) > halfBox) continue;
    scratch.b.copy(npc.object.position).sub(station.position);
    if (scratch.b.lengthSq() < 1e-6) scratch.b.set(0, 1, 0);
    npc.object.position.copy(station.position)
      .addScaledVector(scratch.b.normalize(), halfBox + npc.radius);
    npc.speed *= STATION_SPEED_KEPT;
  }
}
