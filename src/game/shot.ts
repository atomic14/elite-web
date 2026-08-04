// What the player's shot hit.
//
// Two passes, in this order:
//
//   1. the honest test — does the beam actually pass through a hull?
//   2. a grazing cone, consulted ONLY if the ray missed everything, so a
//      near-miss that clips a silhouette still counts (see gunnery.ts)
//
// I nearly left this in game.ts on the grounds that "there is no honest way to
// test a raycast without the hulls". That was wrong, and worth recording: this
// project already proved three.js maths runs under node with no canvas and no
// WebGL, so the hulls can simply be BUILT in a test. Which they are.

import * as THREE from 'three';
import { LASER_RANGE } from '../constants/player-gun.ts';
import { hitCone, canisterCone } from './gunnery.ts';

/** Anything the beam can stop against. */
export interface Solid {
  object: THREE.Object3D;
}

/** A ship, which additionally has a silhouette to graze. */
export interface ShootableShip extends Solid {
  state: { alive: boolean };
  radius: number;
}

export type ShotHit<S extends ShootableShip, C extends Solid> =
  | { kind: 'ship'; ship: S; distance: number }
  | { kind: 'cargo'; cargo: C; distance: number }
  | { kind: 'station'; distance: number }
  | { kind: 'miss' };

/**
 * Trace a shot from `origin` along `forward`.
 *
 * The station is checked last and wins ties, because it is enormous: anything
 * "behind" it at a shorter ray distance is inside it.
 *
 * @param station null in witch-space, where there isn't one.
 */
export function traceShot<S extends ShootableShip, C extends Solid>(
  origin: THREE.Vector3,
  forward: THREE.Vector3,
  ships: readonly S[],
  cargo: readonly C[],
  station: THREE.Object3D | null,
  ray: THREE.Raycaster,
  scratch: THREE.Vector3,
): ShotHit<S, C> {
  ray.set(origin, forward);
  ray.far = LASER_RANGE;

  let bestDist = LASER_RANGE;
  let hit: ShotHit<S, C> = { kind: 'miss' };

  for (const ship of ships) {
    if (!ship.state.alive) continue;
    const dist = ship.object.position.distanceTo(origin);
    if (dist > bestDist + ship.radius) continue; // cheap reject before triangles
    // Raycaster reads matrixWorld, which three.js only refreshes during
    // render — without this the shot is tested against the ship's position one
    // frame ago, and against the ORIGIN for anything spawned this frame.
    ship.object.updateMatrixWorld(true);
    for (const h of ray.intersectObject(ship.object, true)) {
      if (h.distance < bestDist) {
        bestDist = h.distance;
        hit = { kind: 'ship', ship, distance: h.distance };
      }
    }
  }

  // Drifting cargo is solid too, and was once in the same blind spot as the
  // station: canisters are not in the ship list, so shots passed straight
  // through them and nothing happened at all.
  for (const c of cargo) {
    c.object.updateMatrixWorld(true);
    for (const h of ray.intersectObject(c.object, true)) {
      if (h.distance < bestDist) {
        bestDist = h.distance;
        hit = { kind: 'cargo', cargo: c, distance: h.distance };
      }
    }
  }

  if (station) {
    station.updateMatrixWorld(true);
    for (const h of ray.intersectObject(station, true)) {
      if (h.distance < bestDist) {
        bestDist = h.distance;
        hit = { kind: 'station', distance: h.distance };
      }
    }
  }

  if (hit.kind !== 'miss') return hit;

  // Nothing was struck squarely. Now allow the graze — the beam has width, and
  // the aim assist adds to it at close range.
  for (const ship of ships) {
    if (!ship.state.alive) continue;
    const to = scratch.copy(ship.object.position).sub(origin);
    const dist = to.length();
    if (dist > bestDist) continue;
    if (forward.angleTo(to.normalize()) < hitCone(ship.radius, dist)) {
      bestDist = dist;
      hit = { kind: 'ship', ship, distance: dist };
    }
  }
  for (const c of cargo) {
    const to = scratch.copy(c.object.position).sub(origin);
    const dist = to.length();
    if (dist > bestDist) continue;
    if (forward.angleTo(to.normalize()) < canisterCone(dist)) {
      bestDist = dist;
      hit = { kind: 'cargo', cargo: c, distance: dist };
    }
  }
  return hit;
}
