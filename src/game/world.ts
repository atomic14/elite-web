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
import type { NpcSpec } from './ship-specs.ts';
import type { NpcRole } from './ship-roles.ts';
import { savedShipIdentity, type ShipIdentity } from './ship-identity.ts';
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

  spawn(
    role: NpcRole, position: THREE.Vector3, seed: number,
    spec?: NpcSpec, identity?: ShipIdentity,
  ): NpcShip {
    const npc = new NpcShip(role, position, seed, spec, identity);
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

  /**
   * The ships, as plain data.
   *
   * The state is walked generically (serialiseState), so adding a field to
   * NpcState saves it — there is no list here to keep in step. The spec is
   * NOT stored: threatTier and isMissionTarget are in the state, and the hull
   * is derivable from them plus the seed.
   *
   * The IDENTITY is stored, and is the exception that proves that rule. It is
   * immutable, so it is not in the state; and it is derivable today only
   * because the roster's recommended variant is the only variant anything
   * picks. Saving the id rather than re-deriving it is what lets a later
   * blueprint loader choose a different exact build without every old save
   * quietly turning back into the recommended one.
   */
  captureNpcs(): NpcSnapshot[] {
    return this.npcs.map((n) => ({
      role: n.role,
      seed: n.variantSeed,
      designId: n.designId,
      profileId: n.profileId,
      targetIndex: n.npcTarget ? this.npcs.indexOf(n.npcTarget) : -1,
      state: serialiseState(n.state as unknown as Record<string, unknown>),
    }));
  }

  /**
   * Rebuild the fleet. `specFor` decides which hull each one gets — that is a
   * game rule (tier tables, the Constrictor), not a world one.
   *
   * Every saved ship states what it is, and `savedShipIdentity` throws for one
   * that does not — so a snapshot this build cannot read comes apart here, and
   * `Persistence.resume` catches it and boots the commander normally. The fleet
   * this leaves behind is whatever was rebuilt before the bad ship: the restore
   * as a whole is already not atomic (the galaxy and the scene are rebuilt
   * above it), so the guarantee is the boot's, not this loop's.
   *
   * Rebuilding a ship DOES draw, because the constructor rolls the things a
   * fresh ship needs — but every one of them is then overwritten by the save,
   * so nothing a restore rolls reaches the restored fleet. `Persistence.restore`
   * puts the generator back last for the same reason.
   */
  restoreNpcs(
    saved: readonly NpcSnapshot[],
    specFor: (s: NpcSnapshot) => NpcSpec | undefined,
  ): void {
    this.clearNpcs();
    for (const n of saved) {
      const role = n.role as NpcRole;
      const spec = specFor(n);
      const npc = this.spawn(role, new THREE.Vector3(), n.seed, spec, savedShipIdentity(n));
      restoreState(npc.state as unknown as Record<string, unknown>, n.state);
    }
    // second pass: the hunting links, now that every ship exists
    saved.forEach((n, i) => {
      if (n.targetIndex < 0) return;
      const hunter = this.npcs[i];
      const prey = this.npcs[n.targetIndex];
      if (!hunter || !prey) return;
      hunter.npcTarget = prey;
      // The same verb the live path calls, on the same terms: only a pirate
      // registers, because npc-targeting.ts registers pirates and NOT police
      // or hunters, which set npcTarget alone. Registering everyone invented
      // links the live run never had, and a reloaded fleeing ship turned and
      // duelled the police chasing it where before it just ran.
      if (hunter.role === 'pirate') prey.addAttacker(hunter);
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
