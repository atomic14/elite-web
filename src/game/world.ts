// The world: the scene, and everything in it.
//
// One place that owns the ships, the cargo, the effects and the system's
// scenery — so a module that needs "what is out there" takes a World instead
// of inventing its own view of the Game. Every extraction before this one had
// to define its own context interface (OrdnanceContext, TradeContext,
// ChartContext…) because there was nothing else to hand it. Those are all
// gone now: a module that needs the sky takes a World, and a module that
// needs nothing takes plain data.
//
// It owns objects and their lifetimes. It does NOT own rules: what a system
// should contain lives in population.ts, what turns up later in encounters.ts,
// and what any of it COSTS stays with the Game, which is the only thing that
// may pay a bounty or move your legal status.

import * as THREE from 'three';
import { NpcShip } from './npc.ts';
import type { NpcRole, NpcSpec } from './ship-specs.ts';
import { buildSystemScene, type SystemScene } from '../world/system-scene.ts';
import { CargoField } from './cargo.ts';
import { Effects } from './effects.ts';
import type { StarSystem } from '../galaxy/galaxy.ts';
import { serialiseState, restoreState, type NpcSnapshot } from './snapshot.ts';

/** How far out a fresh trader warps in. */
export const TRADER_ARRIVAL_RANGE = 22_000;
/** Witch-space banishes the scenery to here, out of reach of every check. */
const BANISHED = 1e8;

export class World {
  /** the three.js root everything is added to */
  readonly scene = new THREE.Scene();
  readonly npcs: NpcShip[] = [];
  readonly cargo: CargoField;
  readonly effects: Effects;
  /** the current system's sun, planet and station */
  scene3d!: SystemScene;

  constructor() {
    this.cargo = new CargoField(this.scene);
    this.effects = new Effects(this.scene);
  }

  /** Tear down the current system and build `system` in its place. */
  build(system: StarSystem): void {
    if (this.scene3d) {
      this.scene.remove(this.scene3d.root);
      this.scene3d.dispose();
    }
    this.clearNpcs();
    this.effects.clear();
    this.cargo.clear();
    this.scene3d = buildSystemScene(system);
    this.scene.add(this.scene3d.root);
  }

  /**
   * Witch-space: mis-jump limbo. The system scene is reused, but the planet,
   * station and sun are banished beyond reach of every distance check — just
   * stars, and Thargoids. Cheaper than a nullable world type, and every
   * subsystem keeps working.
   */
  banishScenery(): void {
    this.scene3d.planet.mesh.position.set(BANISHED, BANISHED, 0);
    this.scene3d.station.position.set(BANISHED, -BANISHED, 0);
    this.scene3d.sun.group.position.set(-BANISHED, BANISHED, 0);
  }

  /**
   * Put a loose object in the sky — a missile, a canister. The World owns the
   * scene, so nothing else needs a handle on it.
   */
  attach(object: THREE.Object3D): void { this.scene.add(object); }
  detach(object: THREE.Object3D): void { this.scene.remove(object); }

  spawn(role: NpcRole, position: THREE.Vector3, seed: number, spec?: NpcSpec): NpcShip {
    const npc = new NpcShip(role, position, seed, spec);
    this.npcs.push(npc);
    this.scene.add(npc.object);
    return npc;
  }

  /** Take one out of the sky. The caller has already decided why. */
  despawn(npc: NpcShip): void {
    this.scene.remove(npc.object);
    const i = this.npcs.indexOf(npc);
    if (i >= 0) this.npcs.splice(i, 1);
  }

  clearNpcs(): void {
    for (const npc of this.npcs) this.scene.remove(npc.object);
    this.npcs.length = 0;
  }

  /** Everything the world is made of, gone. */
  clear(): void {
    this.clearNpcs();
    this.cargo.clear();
    this.effects.clear();
  }

  /**
   * The ships, as plain data.
   *
   * The state is walked generically (serialiseState), so adding a field to
   * NpcState saves it — there is no list here to keep in step. The spec is
   * NOT stored: threatTier and isMissionTarget are in the state, and the hull
   * is derivable from them plus the seed.
   */
  captureNpcs(): NpcSnapshot[] {
    return this.npcs.map((n) => ({
      role: n.role,
      seed: n.variantSeed,
      targetIndex: n.npcTarget ? this.npcs.indexOf(n.npcTarget) : -1,
      state: serialiseState(n.state as unknown as Record<string, unknown>),
    }));
  }

  /**
   * Rebuild the fleet. `specFor` decides which hull each one gets — that is a
   * game rule (tier tables, the Constrictor), not a world one.
   */
  restoreNpcs(
    saved: readonly NpcSnapshot[],
    specFor: (s: NpcSnapshot) => NpcSpec | undefined,
  ): void {
    this.clearNpcs();
    for (const n of saved) {
      const npc = this.spawn(n.role as NpcRole, new THREE.Vector3(), n.seed, specFor(n));
      restoreState(npc.state as unknown as Record<string, unknown>, n.state);
    }
    // second pass: the hunting links, now that every ship exists
    saved.forEach((n, i) => {
      if (n.targetIndex < 0) return;
      const hunter = this.npcs[i];
      const prey = this.npcs[n.targetIndex];
      if (!hunter || !prey) return;
      hunter.npcTarget = prey;
      // Only a pirate registers itself as an attacker — npc-targeting.ts does
      // this for pirates and NOT for police or hunters, which set npcTarget
      // alone. Pushing for everyone invented links the live run never had, and
      // `attackers` drives nearestAttacker(), so a reloaded fleeing ship turned
      // and duelled the police chasing it where before it just ran.
      if (hunter.role === 'pirate' && !prey.attackers.includes(hunter)) {
        prey.attackers.push(hunter);
      }
    });
  }

  // --- the bits of the scenery that the simulation reads ------------------

  get station(): THREE.Object3D { return this.scene3d.station; }
  get stationDockZ(): number { return this.scene3d.stationDockZ; }
  get planetPos(): THREE.Vector3 { return this.scene3d.planet.mesh.position; }
  get planetRadius(): number { return this.scene3d.planetRadius; }
  get sunPos(): THREE.Vector3 { return this.scene3d.sun.group.position; }
  /** where a launching ship is parked, just outside the slot */
  get spawnPosition(): THREE.Vector3 { return this.scene3d.spawnPosition; }

  /** Advance the scenery — the sun's shader clock and the station's spin. */
  update(dt: number, elapsed: number): void {
    this.scene3d.update(dt, elapsed);
  }
}
