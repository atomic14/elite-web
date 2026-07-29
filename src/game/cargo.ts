// Cargo adrift: canisters and escape capsules, their drift, and being scooped.
//
// The field owns the objects and moves them. It does NOT decide what picking
// one up means — whether you have the scoops, whether the hold is full,
// whether an occupant becomes inventory — because those are commander rules
// with consequences (legal status, messages, damage), and the Game owns
// consequences. So `update` reports a REACHED event and stops there.
//
// Escape capsules are modelled as a canister with `kind: 'capsule'`, which is
// the shortcut behind a known complaint: scooping one reads as picking up a
// cargo pod that happens to contain a person. They should be their own object
// with their own model — see the project's task list. This file is where that
// change belongs, and the `kind` field is the seam.

import * as THREE from 'three';
import { buildShip, CANISTER } from '../ships/geometry.ts';
import { random, randomDirection, randomInt } from './rng.ts';
import type { CanisterSnapshot } from './snapshot.ts';

export interface Canister {
  object: THREE.Object3D;
  /** commodity index for cargo; ignored for capsules */
  commodity: number;
  velocity: THREE.Vector3;
  spinAxis: THREE.Vector3;
  kind: 'cargo' | 'capsule';
}

/** How close the player must get to scoop. */
export const SCOOP_RANGE = 45;
/** Tumble rate, radians per second. */
const SPIN_RATE = 0.8;

/** The player reached this one — the Game decides what that costs or gains. */
export interface CargoReached {
  canister: Canister;
}

export class CargoField {
  readonly items: Canister[] = [];
  private readonly scene: THREE.Object3D;

  constructor(scene: THREE.Object3D) {
    this.scene = scene;
  }

  /** Scatter `count` canisters of the given commodities from a wreck. */
  spawn(at: THREE.Vector3, count: number, commodities: number[]): void {
    for (let i = 0; i < count; i++) {
      const object = buildShip(CANISTER, 0x8ad0ff);
      object.position.copy(at)
        .add(randomDirection(new THREE.Vector3()).multiplyScalar(20 + i * 15));
      this.add(object, {
        commodity: commodities[randomInt(commodities.length)],
        velocity: randomDirection(new THREE.Vector3()).multiplyScalar(15 + random() * 30),
        spinAxis: randomDirection(new THREE.Vector3()),
        kind: 'cargo',
      });
    }
  }

  /**
   * "Most wily traders, and many pirates, have this device fitted" — a
   * destroyed ship may eject its crew.
   */
  spawnCapsule(at: THREE.Vector3): void {
    const object = buildShip(CANISTER, 0xffd24d);
    object.scale.setScalar(0.8);
    object.position.copy(at);
    this.add(object, {
      commodity: 3,
      velocity: randomDirection(new THREE.Vector3()).multiplyScalar(40 + random() * 30),
      spinAxis: randomDirection(new THREE.Vector3()),
      kind: 'capsule',
    });
  }

  /** Rebuild one from a snapshot, exactly as it was. */
  restore(
    pos: THREE.Vector3, velocity: THREE.Vector3, spinAxis: THREE.Vector3,
    kind: 'cargo' | 'capsule', commodity: number,
  ): void {
    const object = buildShip(CANISTER, kind === 'capsule' ? 0xffd24d : 0x8ad0ff);
    if (kind === 'capsule') object.scale.setScalar(0.8);
    object.position.copy(pos);
    this.add(object, { commodity, velocity, spinAxis, kind });
  }

  private add(object: THREE.Object3D, rest: Omit<Canister, 'object'>): void {
    this.items.push({ object, ...rest });
    this.scene.add(object);
  }

  /**
   * Drift and tumble everything, and report whatever the player reached.
   *
   * Reaching one REMOVES it from the field — you cannot scoop it twice — but
   * what it is worth is the caller's business.
   */
  update(dt: number, playerPos: THREE.Vector3): CargoReached[] {
    const reached: CargoReached[] = [];
    for (const c of [...this.items]) {
      c.object.position.addScaledVector(c.velocity, dt);
      c.object.rotateOnAxis(c.spinAxis, dt * SPIN_RATE);
      if (c.object.position.distanceTo(playerPos) > SCOOP_RANGE) continue;
      this.remove(c);
      reached.push({ canister: c });
    }
    return reached;
  }

  /** Shot, rather than scooped — the Game draws the burst and pays the cost. */
  destroy(c: Canister): void {
    this.remove(c);
  }

  private remove(c: Canister): void {
    this.scene.remove(c.object);
    const i = this.items.indexOf(c);
    if (i >= 0) this.items.splice(i, 1);
  }

  /** The field as plain data. */
  capture(): CanisterSnapshot[] {
    return this.items.map((c) => ({
      pos: [c.object.position.x, c.object.position.y, c.object.position.z],
      velocity: [c.velocity.x, c.velocity.y, c.velocity.z],
      spinAxis: [c.spinAxis.x, c.spinAxis.y, c.spinAxis.z],
      kind: c.kind,
      commodity: c.commodity,
    } satisfies CanisterSnapshot));
  }

  /** Replace the field with a captured one. */
  restoreAll(saved: readonly CanisterSnapshot[]): void {
    this.clear();
    for (const c of saved) {
      this.restore(
        new THREE.Vector3(...c.pos), new THREE.Vector3(...c.velocity),
        new THREE.Vector3(...c.spinAxis), c.kind, c.commodity);
    }
  }

  /** Wipe the field — a new system, or a restored snapshot. */
  clear(): void {
    for (const c of [...this.items]) this.remove(c);
  }
}
