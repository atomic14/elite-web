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
//
// A CANISTER IS ALSO A TARGET, and since TODO 28 it is a source-profiled one.
// Shooting one used to delete it whatever the laser was; it now carries the
// pack's own energy for its design — the cargo canister (4) and the escape pod
// (2), eight points each, no defence — and the shot is resolved through the
// same oracle a ship's is. Every laser a flyable hull can carry still breaks one
// with a single hit, so nothing about shooting cargo has changed today; what
// changed is that "one hit" is now a consequence of the catalogue rather than a
// line of code that could not be wrong.

import * as THREE from 'three';
import { buildShip } from '../ships/geometry.ts';
import { OBJECT_DESIGNS, requireShipDef } from '../ships/registry.ts';
import {
  energyAfterDamage, isDestroyed, npcEnergyPolicy, playerLaserDamage,
  type NpcEnergyPolicy,
} from './npc-energy.ts';
import { recommendedProfileIdFor } from './ship-identity.ts';
import { random, randomDirection, randomInt } from './rng.ts';
import type { CanisterSnapshot } from './snapshot.ts';

export interface Canister {
  object: THREE.Object3D;
  /** commodity index for cargo; ignored for capsules */
  commodity: number;
  velocity: THREE.Vector3;
  spinAxis: THREE.Vector3;
  kind: 'cargo' | 'capsule';
  /** what is left of its released bank — 8 points, and it does not regenerate */
  energy: number;
}

/** The released cargo canister — one hull, resolved once. */
const CANISTER_HULL = requireShipDef(OBJECT_DESIGNS.cargoCanister);

/** What each kind of drifting object can absorb. The pack's, not ours. */
const POLICY: Record<Canister['kind'], NpcEnergyPolicy> = {
  cargo: npcEnergyPolicy(recommendedProfileIdFor(OBJECT_DESIGNS.cargoCanister)),
  capsule: npcEnergyPolicy(recommendedProfileIdFor(OBJECT_DESIGNS.escapePod)),
};

/** A fresh object of this kind, at full energy. */
export function canisterMaxEnergy(kind: Canister['kind']): number {
  return POLICY[kind].maxEnergy;
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
      const object = buildShip(CANISTER_HULL, 0x8ad0ff);
      object.position.copy(at)
        .add(randomDirection(new THREE.Vector3()).multiplyScalar(20 + i * 15));
      this.add(object, {
        commodity: commodities[randomInt(commodities.length)],
        velocity: randomDirection(new THREE.Vector3()).multiplyScalar(15 + random() * 30),
        spinAxis: randomDirection(new THREE.Vector3()),
        kind: 'cargo',
        energy: canisterMaxEnergy('cargo'),
      });
    }
  }

  /**
   * "Most wily traders, and many pirates, have this device fitted" — a
   * destroyed ship may eject its crew.
   */
  spawnCapsule(at: THREE.Vector3): void {
    const object = buildShip(CANISTER_HULL, 0xffd24d);
    object.scale.setScalar(0.8);
    object.position.copy(at);
    this.add(object, {
      commodity: 3,
      velocity: randomDirection(new THREE.Vector3()).multiplyScalar(40 + random() * 30),
      spinAxis: randomDirection(new THREE.Vector3()),
      kind: 'capsule',
      energy: canisterMaxEnergy('capsule'),
    });
  }

  /** Rebuild one from a snapshot, exactly as it was. */
  restore(
    pos: THREE.Vector3, velocity: THREE.Vector3, spinAxis: THREE.Vector3,
    kind: 'cargo' | 'capsule', commodity: number, energy: number,
  ): void {
    const object = buildShip(CANISTER_HULL, kind === 'capsule' ? 0xffd24d : 0x8ad0ff);
    if (kind === 'capsule') object.scale.setScalar(0.8);
    object.position.copy(pos);
    // The bank is taken from the snapshot like everything else here. It used to
    // default to full for a save written before canisters had one; that
    // tolerance went with the rest of the legacy handling (2026-08-04).
    this.add(object, { commodity, velocity, spinAxis, kind, energy });
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

  /**
   * A registered player-laser hit of `hit` strength lands on one.
   *
   * The same call a ship takes (`NpcShip.takeLaserHit`), against the same
   * oracle: the object's own bank and its own defence decide, so nothing here
   * knows what a canister is made of. @returns true if it broke up.
   */
  takeLaserHit(c: Canister, hit: number): boolean {
    c.energy = energyAfterDamage(c.energy, playerLaserDamage(POLICY[c.kind], hit));
    if (!isDestroyed(c.energy)) return false;
    this.remove(c);
    return true;
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
      energy: c.energy,
    } satisfies CanisterSnapshot));
  }

  /** Replace the field with a captured one. */
  restoreAll(saved: readonly CanisterSnapshot[]): void {
    this.clear();
    for (const c of saved) {
      this.restore(
        new THREE.Vector3(...c.pos), new THREE.Vector3(...c.velocity),
        new THREE.Vector3(...c.spinAxis), c.kind, c.commodity, c.energy);
    }
  }

  /** Wipe the field — a new system, or a restored snapshot. */
  clear(): void {
    for (const c of [...this.items]) this.remove(c);
  }
}
