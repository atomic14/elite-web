import * as THREE from 'three';
import { buildShip, buildAsteroid } from '../ships/geometry.ts';
import {
  SPECS, type NpcSpec, type NpcRole,
} from './ship-specs.ts';
import {
  observe, observePack, act, makeScratch,
  type Brain, type ObservableShip,
} from '../ai-training/policy.ts';
import { pirateBrainFor, defenceBrain } from './brains.ts';
import { npcPrefersMissile, npcMissileLastStand, MISSILE_RELOAD } from './gunnery.ts';
import { TURN } from '../ai-training/core.ts';
import { random, randomDirection, randomQuaternion } from './rng.ts';
import { planDocking, makeDockPlan, type DockPlan } from './docking.ts';



/**
 * Hostiles cannot throttle below this fraction of their top speed. Mirrors
 * `minSpeed` on the pirate hulls in ai-training/core.ts (110/260 and 130/300, both
 * about 0.43) — invariant 2.
 */
const MIN_CRUISE_FRACTION = 0.43;

/**
 * How far an NPC can shoot. Matches the player's LASER_RANGE in game.ts and
 * LASER.range in ai-training/core.ts, and it has to: a brain trained to open fire at
 * 3000 units was silently refused the shot by a 2600 gate, so it would sit
 * there pointing straight at the target and never pull the trigger.
 *
 * Measured before the change, two tier-0 pirates over 45 seconds: pointing at
 * the player 90% of the time, but inside 2600 only 51% of it. Half the fight
 * was spent aiming from out of a range the pirate did not know it had.
 */
export const NPC_LASER_RANGE = 3500;

/**
 * Time between an NPC's shots. The sim gives every ship the player's pulse
 * laser at 0.24s; these are the game's deliberate handicap, and they are NOT
 * what limits an NPC's damage.
 *
 * Tested at sim parity (0.18-0.30s, five times faster): 3.7 shots per minute
 * per ship against the current 4.1, and 3.52 damage against 3.78. No
 * difference, because a pirate is only pointed within the 0.25 rad firing gate
 * for about 5% of a fight. It is not waiting on the cooldown; it is waiting to
 * be aimed at you, and it is busy weaving.
 */
export const NPC_COOLDOWN_LO = 0.9;
export const NPC_COOLDOWN_SPREAD = 0.8;
/** How near the nose a target must be before an NPC pulls the trigger. */
export const NPC_FIRE_GATE = 0.25;
/** Thargoids reload faster than anything else in the galaxy. */
export const THARGOID_FIRE_RATE = 0.7;

/**
 * Everything about a ship that can CHANGE.
 *
 * All of it in one object, which is the point: a snapshot is this, walked
 * generically, so there is no list of fields to keep in step and nothing to
 * forget. Hand-enumerating them cost two rounds of "two reloads agree with
 * each other but not with the run they came from" — first the trigger and
 * trade clocks, then the pack station and the brain's ramped rates.
 *
 * `pos` and `quat` are the SAME THREE objects the mesh uses, not copies. The
 * renderer therefore reads the state rather than being told about it, and
 * there is no sync step to forget either.
 */
export interface NpcState {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  packOffset: THREE.Vector3;
  waypoint: THREE.Vector3;
  fleeFrom: THREE.Vector3;
  traderPhase: TraderPhase;
  /**
   * The cached policy decision, re-taken every brainTimer seconds.
   *
   * I excluded this by hand as "not really state", and it was the last thing
   * keeping a restored world from replaying its original: a ship reloaded
   * mid-decision re-decides immediately where the original was still acting on
   * a choice made up to 0.1s earlier, and six frames of difference compound.
   * If the step reads it, it is state.
   */
  brainControl: { pitch: number; roll: number; throttle: number; fire: boolean } | null;
  /**
   * Derived at spawn FROM THE RNG, so they cannot be re-derived on restore:
   * by then the stream is somewhere else entirely. Chris's rule — a game
   * constant may live outside the state, a value worked out at runtime may
   * not.
   */
  docksHere: boolean;
  tumbleAxis: THREE.Vector3;
  /**
   * Whether this ship carries E.C.M., rolled against its spec's chance at
   * spawn. Chris's example of the rule, almost exactly: a disposition decided
   * by a shake of the dice on warp-in changes what the ship does for the rest
   * of its life, so it is state, not a constant.
   */
  hasEcm: boolean;
  hp: number;
  alive: boolean;
  provoked: boolean;
  provokedByPlayer: boolean;
  missiles: number;
  isMissionTarget: boolean;
  fleeing: boolean;
  inert: boolean;
  tradeTimer: number;
  wantsDespawn: boolean;
  docked: boolean;
  docking: boolean;
  organised: boolean;
  satisfied: boolean;
  threatTier: number;
  speed: number;
  fireCooldown: number;
  /**
   * Time until this ship may launch another missile. Separate from
   * fireCooldown ON PURPOSE: the gun's reload is up to 1.7s and a ship in its
   * last stand does not have that long, so a missile must not queue behind a
   * bolt. It ticks in chooseWeapon.
   */
  missileReload: number;
  waypointTimer: number;
  brainTimer: number;
  brainPitchRate: number;
  brainRollRate: number;
}

// NPC ships. Behaviour matrix:
//  - traders  fly in from the system edge, do business near the station, and
//    depart; they only fight back (flee + ECM) when attacked
//  - pirates  hunt the player in loose packs, or prey on traders when the
//    player is out of reach
//  - police   protect station space: attack pirates on sight and fugitives
//  - hunters  lone bounty killers; only interested in offender/fugitive players
//  - thargoid/thargon  always hostile; thargons go inert without a mothership
// Everything steers by rotating toward a heading at a capped rate and
// thrusting along its nose, same as the player.

const ZERO = new THREE.Vector3();
/** scratch for the docking gate, module-level to keep update() allocation-free */
/** station half-width; both hulls use 160 (world/system-scene.ts) */
/**
 * Fallback slot depth. The real figure comes from the world (a Coriolis is
 * 160, a Dodo 135), and using this constant for both meant traders at
 * high-tech stations "arrived" 22 units short of the hull and vanished in open
 * space — which, with the docking flash, read as a ship exploding on approach.
 */
const DOCK_Z = 160;
const UP = new THREE.Vector3(0, 1, 0);

export interface PlayerRef {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** current speed. The brain's observation needs it to lead a shot. */
  speed: number;
}

/**
 * A shot this ship has taken, and what it took it with.
 *
 * The weapon is part of the report because choosing it is the SHIP's decision,
 * not the orchestrator's — see `chooseWeapon`. Only the player is ever shot at
 * with a missile: ordnance.ts's hostile missiles home on the player and there
 * is nothing else for one to chase.
 */
export type FireEvent =
  | { at: 'player'; weapon: 'laser' | 'missile' }
  | { at: NpcShip; weapon: 'laser' };

/**
 * The single source of truth for "does this ship attack the player?" —
 * used both by the NPC's own decision loop and by the game's condition/HUD
 * logic. legalStatus: 0 clean, 1 offender, 2 fugitive.
 */
export function isHostileToPlayer(npc: NpcShip, legalStatus: number): boolean {
  if (!npc.alive || npc.inert) return false;
  // A pirate that has taken its payday stops caring about you: this is what
  // makes jettisoning cargo a real escape rather than a donation.
  if (npc.satisfied) return false;
  return (
    npc.role === 'pirate' || npc.role === 'thargoid' || npc.role === 'thargon' ||
    // provokedBY PLAYER, not provoked. takeDamage() flags `provoked` for any
    // damage from any source, so a Viper trading fire with a pirate — or one
    // that clipped an asteroid — used to decide a clean commander was fair
    // game. Chris flew into exactly that: a police ship mid-fight with another
    // NPC turned on him as though he were a fugitive.
    (npc.role === 'police' && (legalStatus >= 2 || npc.provokedByPlayer)) ||
    (npc.role === 'hunter' && (legalStatus >= 1 || npc.provokedByPlayer))
  );
}

export type TraderPhase = 'arriving' | 'trading' | 'departing' | 'docking';

export class NpcShip {
  readonly object: THREE.Object3D;
  readonly role: NpcRole;
  readonly radius: number;
  readonly bounty: number;
  readonly cargoDrop: number;
  readonly maxHp: number;
  /** Set when the player damages this ship. */
  /** hit by anything at all — police do NOT read this, see isHostileToPlayer */
  /** True when it was specifically the player who attacked us. */
  readonly armed: boolean;
  /** Homing missiles this ship can still launch at the player. */
  /** Mission flag: destroying this advances the Constrictor hunt. */

  /** Pack spread so groups attack from different bearings. */
  /** Pirates currently targeting this ship; maintained (and pruned) by the game loop. */
  readonly attackers: NpcShip[] = [];
  /** NPC-vs-NPC target, assigned by the game (pirate→trader, police→pirate). */
  npcTarget: NpcShip | null = null;
  /** Where the last attack came from; traders flee this. */
  /** @internal snapshot */
  /** Thargons go inert when their mothership dies. */

  /** Trader lifecycle. */
  /** Set true when this ship has flown off / docked and should be removed. */
  /** this trader put in at the station rather than jumping out */
  /** on final approach into the slot — the station must not shove it away */
  /** the live station's slot depth, handed down by the Game each frame */
  private stationDockZ = DOCK_Z;
  private readonly dockPlan: DockPlan = makeDockPlan();
  /** decided at spawn: does this one have business at the station? */

  /**
   * Tier-2 gang member: flies the coordinated pack policy and doesn't scare
   * off. Set by the Game from pirateThreat() when the player looks worth
   * organising against.
   */
  /** took the jettisoned cargo and lost interest — see isHostileToPlayer */
  /** threat tier this ship was spawned at — sets what killing it is worth */

  private readonly maxSpeed: number;
  private readonly turnRate: number;
  /** @internal exposed so a snapshot can resume mid-reload */
  /** @internal snapshot */


  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();

  // trained-brain flight state (pirates)  private brainControl: { pitch: number; roll: number; throttle: number; fire: boolean } | null = null;  /** @internal snapshot */
  // sized for PACK_OBS_SIZE (18); solo brains only read the first 14 slots
  private static readonly obsBuf = new Float32Array(18);
  /** scratch packmate list, reused so the 10 Hz decision stays allocation-light */
  private static readonly mateView: { pos: THREE.Vector3; alive: boolean }[] = [];
  private static readonly scratch = makeScratch();
  private static readonly meView = {
    pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 },
    speed: 0, cls: { maxSpeed: 0, turnRate: 0 },
    laserTemp: 0, laserCooldown: 0, pitchRate: 0, rollRate: 0,
  };
  private static readonly targetView = {
    pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 },
    speed: 300, cls: { maxSpeed: 400, turnRate: 1.1 },
    laserTemp: 0, laserCooldown: 0, pitchRate: 0, rollRate: 0,
  };

  /** the seed its hull and stats were generated from — kept so a snapshot can rebuild it */
  readonly variantSeed: number;

  get docksHere(): boolean { return this.state.docksHere; }
  get hasEcm(): boolean { return this.state.hasEcm; }
  private set hasEcm(v: boolean) { this.state.hasEcm = v; }
  private get tumbleAxis(): THREE.Vector3 { return this.state.tumbleAxis; }

  /**
   * All mutable state, in one object — see NpcState.
   *
   * The accessors below exist so the ~80 places that say `npc.hp` or
   * `npc.alive` keep saying it. The state having ONE home is the property that
   * matters; making every caller spell out `.state.` is not.
   */
  readonly state: NpcState;
  private get brainControl(): { pitch: number; roll: number; throttle: number; fire: boolean } | null {
    return this.state.brainControl;
  }

  private set brainControl(v: { pitch: number; roll: number; throttle: number; fire: boolean } | null) {
    this.state.brainControl = v;
  }

  get hp(): number { return this.state.hp; }
  set hp(v: number) { this.state.hp = v; }
  get alive(): boolean { return this.state.alive; }
  set alive(v: boolean) { this.state.alive = v; }
  get provoked(): boolean { return this.state.provoked; }
  set provoked(v: boolean) { this.state.provoked = v; }
  get provokedByPlayer(): boolean { return this.state.provokedByPlayer; }
  set provokedByPlayer(v: boolean) { this.state.provokedByPlayer = v; }
  get missiles(): number { return this.state.missiles; }
  set missiles(v: number) { this.state.missiles = v; }
  get isMissionTarget(): boolean { return this.state.isMissionTarget; }
  set isMissionTarget(v: boolean) { this.state.isMissionTarget = v; }
  get fleeing(): boolean { return this.state.fleeing; }
  set fleeing(v: boolean) { this.state.fleeing = v; }
  get inert(): boolean { return this.state.inert; }
  set inert(v: boolean) { this.state.inert = v; }
  get tradeTimer(): number { return this.state.tradeTimer; }
  set tradeTimer(v: number) { this.state.tradeTimer = v; }
  get wantsDespawn(): boolean { return this.state.wantsDespawn; }
  set wantsDespawn(v: boolean) { this.state.wantsDespawn = v; }
  get docked(): boolean { return this.state.docked; }
  set docked(v: boolean) { this.state.docked = v; }
  get docking(): boolean { return this.state.docking; }
  set docking(v: boolean) { this.state.docking = v; }
  get organised(): boolean { return this.state.organised; }
  set organised(v: boolean) { this.state.organised = v; }
  get satisfied(): boolean { return this.state.satisfied; }
  set satisfied(v: boolean) { this.state.satisfied = v; }
  get threatTier(): number { return this.state.threatTier; }
  set threatTier(v: number) { this.state.threatTier = v; }
  get speed(): number { return this.state.speed; }
  set speed(v: number) { this.state.speed = v; }
  get fireCooldown(): number { return this.state.fireCooldown; }
  set fireCooldown(v: number) { this.state.fireCooldown = v; }
  get missileReload(): number { return this.state.missileReload; }
  set missileReload(v: number) { this.state.missileReload = v; }
  get waypointTimer(): number { return this.state.waypointTimer; }
  set waypointTimer(v: number) { this.state.waypointTimer = v; }
  get brainTimer(): number { return this.state.brainTimer; }
  set brainTimer(v: number) { this.state.brainTimer = v; }
  get brainPitchRate(): number { return this.state.brainPitchRate; }
  set brainPitchRate(v: number) { this.state.brainPitchRate = v; }
  get brainRollRate(): number { return this.state.brainRollRate; }
  set brainRollRate(v: number) { this.state.brainRollRate = v; }
  get packOffset(): THREE.Vector3 { return this.state.packOffset; }
  get waypoint(): THREE.Vector3 { return this.state.waypoint; }
  get fleeFrom(): THREE.Vector3 { return this.state.fleeFrom; }
  get traderPhase(): TraderPhase { return this.state.traderPhase; }
  set traderPhase(v: TraderPhase) { this.state.traderPhase = v; }

  constructor(role: NpcRole, position: THREE.Vector3, variantSeed: number, specOverride?: NpcSpec) {
    this.role = role;
    this.variantSeed = variantSeed;
    // Built before anything else, because the accessors below write through
    // it. `pos` and `quat` are filled in once the mesh exists — they are the
    // mesh's own vectors, so the renderer reads this state rather than being
    // handed a copy of it.
    this.state = {
      pos: null as unknown as THREE.Vector3,
      quat: null as unknown as THREE.Quaternion,
      packOffset: new THREE.Vector3(),
      waypoint: new THREE.Vector3(),
      fleeFrom: new THREE.Vector3(),
      traderPhase: 'trading',
      brainControl: null,
      docksHere: random() < 0.5,
      hasEcm: false,   // set from the spec once it is known, below
      tumbleAxis: randomDirection(new THREE.Vector3()),
      hp: 0, alive: true, provoked: false, provokedByPlayer: false, missiles: 0,
      isMissionTarget: false, fleeing: false, inert: false, tradeTimer: 0,
      wantsDespawn: false, docked: false, docking: false, organised: false,
      satisfied: false, threatTier: 0, speed: 0, fireCooldown: 0, missileReload: 0,
      waypointTimer: 0, brainTimer: 0, brainPitchRate: 0, brainRollRate: 0,
    };
    if (role === 'hermit') {
      this.object = buildAsteroid(120, variantSeed * 977 + 3, 0xb9b9a5);
      this.radius = 120;
      this.hp = this.maxHp = 4;
      this.bounty = 0;
      this.cargoDrop = 0;
      this.maxSpeed = 0;
      this.turnRate = 0;
      this.speed = 0;
      this.hasEcm = false;
      this.armed = false;
      this.bindTransform(position);
      return;
    }
    if (role === 'asteroid') {
      const radius = 25 + (variantSeed % 45);
      this.object = buildAsteroid(radius, variantSeed * 131 + 7, 0x9a9a8a);
      this.radius = radius;
      this.hp = this.maxHp = 0.6;
      this.bounty = 4;
      this.cargoDrop = 0;
      this.maxSpeed = 0;
      this.turnRate = 0;
      this.speed = 0;
      this.hasEcm = false;
      this.armed = false;
    } else {
      const options = SPECS[role];
      const spec = specOverride ?? options[variantSeed % options.length];
      this.object = buildShip(spec.def!, spec.color);
      this.radius = spec.radius;
      this.hp = this.maxHp = spec.hp;
      this.bounty = spec.bounty;
      this.cargoDrop = spec.cargoDrop ?? 0;
      this.maxSpeed = spec.maxSpeed;
      this.turnRate = spec.turnRate;
      this.speed = spec.maxSpeed * 0.5;
      this.missiles = spec.missiles ?? 0;
      this.hasEcm = random() < (spec.ecmChance ?? 0);
      this.armed = spec.armed ?? false;
    }
    randomDirection(this.packOffset).multiplyScalar(250 + random() * 500);
    this.bindTransform(position);
  }

  /**
   * Point the state's transform AT the mesh's own vectors, rather than copying
   * between them.
   *
   * This is what makes the renderer read-only over the state: there is one
   * position in memory, the step writes it, and three.js reads it when it
   * builds the matrix. No sync pass, and none to forget.
   */
  private bindTransform(position: THREE.Vector3): void {
    this.object.position.copy(position);
    // NOT quaternion.random(): THREE reaches for Math.random inside it, so
    // every ship in the galaxy was pointing a direction the seed knew nothing
    // about. Two arrivals in the same system agreed on where the ships were
    // and disagreed on which way they faced.
    randomQuaternion(this.object.quaternion);
    this.state.pos = this.object.position;
    this.state.quat = this.object.quaternion;
  }

  /**
   * @param playerLegal 0 clean, 1 offender, 2 fugitive
   * @returns a fire event if this ship shot at something this frame
   */
  update(
    dt: number,
    player: PlayerRef,
    playerLegal: number,
    station: THREE.Object3D,
    fleet: readonly NpcShip[] = [],
    stationDockZ?: number,
  ): FireEvent | null {
    if (stationDockZ !== undefined) this.stationDockZ = stationDockZ;
    if (!this.alive) return null;

    if (this.role === 'asteroid' || this.role === 'hermit') {
      this.object.rotateOnAxis(this.tumbleAxis, dt * (this.role === 'hermit' ? 0.06 : 0.4));
      return null;
    }
    if (this.role === 'generation') {
      // ancient, blind, and utterly indifferent to you
      this.object.rotateOnAxis(this.tumbleAxis, dt * 0.02);
      this.speed = this.maxSpeed;
      this.advance(dt);
      return null;
    }
    if (this.inert) {
      this.object.rotateOnAxis(this.tumbleAxis, dt * 0.2);
      return null;
    }

    const toPlayer = this.tmpDir.copy(player.position).sub(this.object.position);
    const distPlayer = toPlayer.length();

    const aggressiveToPlayer = isHostileToPlayer(this, playerLegal) && distPlayer < 9000;

    if (aggressiveToPlayer) {
      // Which brain, and the two numbers that come with it — see brains.ts.
      const choice = this.role === 'pirate'
        ? pirateBrainFor(this.threatTier, this.organised) : null;
      const shot = choice && distPlayer >= choice.guard
        ? this.brainFly(choice.brain, dt,
          player.position, player.quaternion,
          choice.targetSpeed(player.speed),
          distPlayer, 'player',
          choice.pack ? fleet : null)
        // Inside knife range the scripted break-off takes over — see RAM_GUARD.
        : this.attack(dt, player.position, distPlayer, true);
      return this.chooseWeapon(shot, dt, distPlayer, player.position);
    }

    if (this.npcTarget && this.npcTarget.alive) {
      const d = this.npcTarget.object.position.distanceTo(this.object.position);
      if (d < 7000) return this.attack(dt, this.npcTarget.object.position, d, false, this.npcTarget);
      this.npcTarget = null;
    }

    if (this.fleeing) {
      // armed traders turn and fight with the trained Jameson defence brain
      const defence = this.armed ? defenceBrain() : null;
      if (defence) {
        if (this.provokedByPlayer && distPlayer < 6000) {
          return this.brainFly(defence, dt,
            player.position, player.quaternion, 300, distPlayer, 'player');
        }
        const attacker = this.nearestAttacker();
        if (attacker) {
          const d = attacker.object.position.distanceTo(this.object.position);
          return this.brainFly(defence, dt,
            attacker.object.position, attacker.object.quaternion, 260, d, attacker);
        }
      }
      this.steerToward(
        this.tmpDir.copy(this.object.position).multiplyScalar(2).sub(this.fleeFrom), dt);
      this.speed = approach(this.speed, this.maxSpeed, 150 * dt);
      this.advance(dt);
      return null;
    }

    if (this.role === 'trader') {
      this.updateTrader(dt, station);
      this.advance(dt);
      return null;
    }

    // amble between waypoints near home
    this.waypointTimer -= dt;
    if (this.waypointTimer <= 0) {
      this.waypointTimer = 12 + random() * 15;
      this.waypoint
        .copy(station.position)
        .add(randomDirection(new THREE.Vector3()).multiplyScalar(800 + random() * 2500));
    }
    this.steerToward(this.waypoint, dt);
    const arrived = this.object.position.distanceTo(this.waypoint) < 200;
    this.speed = approach(this.speed, arrived ? 0 : this.maxSpeed * 0.4, 80 * dt);
    this.advance(dt);
    return null;
  }

  /** Traders arrive from deep space, potter about the station, then leave. */
  private updateTrader(dt: number, station: THREE.Object3D): void {
    const home = station.position;
    switch (this.traderPhase) {
      case 'arriving': {
        this.steerToward(home, dt);
        this.speed = approach(this.speed, this.maxSpeed * 0.85, 90 * dt);
        if (this.object.position.distanceTo(home) < 900) {
          this.traderPhase = 'trading';
        }
        break;
      }
      case 'trading': {
        this.tradeTimer -= dt;
        this.waypointTimer -= dt;
        if (this.waypointTimer <= 0) {
          this.waypointTimer = 10 + random() * 12;
          // Work the lane between station and planet. The planet sits at the
          // world origin, so scaling `home` walks that line — but the station
          // orbits at 2.4 planet radii (world/system-scene.ts), which puts the
          // planet surface at 1/2.4 = 0.42 of the way out. A minimum of 0.35
          // aimed traders *inside the planet*, and with nothing stopping them
          // they flew through it. 0.62 keeps the waypoint clear even when the
          // random offset below happens to point straight down.
          this.waypoint
            .copy(station.position)
            .multiplyScalar(0.62 + random() * 0.38)
            .add(randomDirection(new THREE.Vector3()).multiplyScalar(600 + random() * 1200));
        }
        this.steerToward(this.waypoint, dt);
        this.speed = approach(this.speed, this.maxSpeed * 0.35, 60 * dt);
        if (this.tradeTimer <= 0) {
          // about half put in at the station; the rest jump out from here
          if (this.docksHere) {
            this.traderPhase = 'docking';
          } else {
            this.traderPhase = 'departing';
            this.waypoint
              .copy(station.position)
              .add(randomDirection(new THREE.Vector3()).multiplyScalar(30000));
          }
        }
        break;
      }
      case 'docking': {
        // Shared with the player's docking computer — see game/docking.ts.
        const plan = planDocking(
          this.object.position, station, this.stationDockZ, this.maxSpeed, this.dockPlan);
        this.docking = plan.phase === 'run';
        this.speed = approach(this.speed, plan.speed, 90 * dt);
        // orientation from the plan's heading AND the station's up, so the
        // wings roll into line with the slot as it spins
        this.tmpMat.lookAt(ZERO, plan.heading, plan.up);
        this.tmpQ.setFromRotationMatrix(this.tmpMat);
        this.object.quaternion.rotateTowards(this.tmpQ, this.turnRate * 2.2 * dt);
        if (plan.arrived) {
          this.docked = true;
          this.wantsDespawn = true; // the Game plays the flash
        }
        break;
      }
      case 'departing': {
        this.steerToward(this.waypoint, dt);
        this.speed = approach(this.speed, this.maxSpeed, 90 * dt);
        if (this.object.position.distanceTo(this.waypoint) < 2500) {
          this.wantsDespawn = true; // jumps out — game plays the flash
        }
        break;
      }
    }
  }

  private nearestAttacker(): NpcShip | null {
    // whoever is hunting us (pirates with us as their target) — game assigns
    return this.attackers.find((a) => a.alive) ?? null;
  }

  /**
   * The other pirates this ship is hunting with, in the shape observePack
   * wants. Rebuilt per decision (10 Hz) rather than cached, because ships die
   * mid-fight and a stale mate would be observed as still flying.
   */
  private packmates(fleet: readonly NpcShip[]): { pos: THREE.Vector3; alive: boolean }[] {
    const out = NpcShip.mateView;
    out.length = 0;
    for (const m of fleet) {
      if (m === this || m.role !== 'pirate' || !m.alive) continue;
      out.push({ pos: m.object.position, alive: true });
    }
    return out;
  }

  /**
   * Fly with a trained policy: refresh the discrete control at 10 Hz, then
   * integrate it exactly like the sim (and the player's keyboard model).
   * targetSpeed and targetView.cls are approximations (the policies were
   * trained against fixed opponent classes, so precise values matter little).
   */
  private brainFly(
    brain: Brain,
    dt: number,
    targetPos: THREE.Vector3,
    targetQuat: THREE.Quaternion,
    targetSpeed: number,
    dist: number,
    fireAt: 'player' | NpcShip | null,
    /** non-null only for the 18-input pack brain, which observes its mates */
    fleet: readonly NpcShip[] | null = null,
  ): FireEvent | null {
    this.brainTimer -= dt;
    if (!this.brainControl || this.brainTimer <= 0) {
      this.brainTimer = 0.1;
      const me = NpcShip.meView;
      const tv = NpcShip.targetView;
      const p = this.object.position;
      const q = this.object.quaternion;
      me.pos.x = p.x; me.pos.y = p.y; me.pos.z = p.z;
      me.quat.x = q.x; me.quat.y = q.y; me.quat.z = q.z; me.quat.w = q.w;
      me.speed = this.speed;
      me.cls.maxSpeed = this.maxSpeed;
      me.cls.turnRate = this.turnRate;
      me.laserCooldown = this.fireCooldown;
      me.pitchRate = this.brainPitchRate;
      me.rollRate = this.brainRollRate;
      tv.pos.x = targetPos.x; tv.pos.y = targetPos.y; tv.pos.z = targetPos.z;
      tv.quat.x = targetQuat.x; tv.quat.y = targetQuat.y;
      tv.quat.z = targetQuat.z; tv.quat.w = targetQuat.w;
      tv.speed = targetSpeed;
      this.brainControl = act(
        brain,
        fleet
          ? observePack(me as ObservableShip, tv as ObservableShip,
            this.packmates(fleet), NpcShip.obsBuf)
          : observe(me as ObservableShip, tv as ObservableShip, NpcShip.obsBuf),
        NpcShip.scratch,
      );
    }
    const c = this.brainControl;

    // integrate the discrete control (mirrors sim stepShip)
    // must match TURN in ai-training/core.ts — invariant 2
    const maxPitch = this.turnRate * TURN.pitch;
    const maxRoll = this.turnRate * TURN.roll;
    const rampTo = (cur: number, target: number, active: boolean): number => {
      const rate = active ? 4.0 : 5.0;
      const next = cur + (target - cur) * Math.min(1, rate * dt);
      return Math.abs(next) < 0.001 && !active ? 0 : next;
    };
    this.brainPitchRate = rampTo(this.brainPitchRate, c.pitch * maxPitch, c.pitch !== 0);
    this.brainRollRate = rampTo(this.brainRollRate, c.roll * maxRoll, c.roll !== 0);
    if (c.throttle > 0) this.speed = Math.min(this.maxSpeed, this.speed + 120 * dt);
    // Floor, mirroring ShipClass.minSpeed in ai-training/core.ts — invariant 2. A
    // fighter that can stop dead becomes a turret, because standing still is
    // how you hold a firing line. Only hostiles get it; traders and haulers
    // are allowed to come to rest.
    if (c.throttle < 0) {
      const floor = this.role === 'pirate' || this.role === 'thargoid' || this.role === 'thargon'
        ? this.maxSpeed * MIN_CRUISE_FRACTION : 0;
      this.speed = Math.max(floor, this.speed - 120 * dt);
    }
    if (this.brainRollRate !== 0) this.object.rotateZ(this.brainRollRate * dt);
    if (this.brainPitchRate !== 0) this.object.rotateX(this.brainPitchRate * dt);
    this.advance(dt);

    this.fireCooldown -= dt;
    // The policy's own `fire` output is deliberately NOT consulted.
    //
    // An NPC needed two independent yeses to shoot: the geometric gate below,
    // which is the game's balance lever, and the brain's trigger, which is an
    // artifact of training nobody ever tuned. r2 is lined up on the player 38%
    // of the time and fires 0.6 shots an engagement, because it was fitted
    // when firing required a 0.027 rad cone and it learned never to trust a
    // loose line. That is the "they point right at me and never shoot" bug.
    //
    // So: the brain decides where to be, the gun decides when to shoot. Rate
    // is now exactly what NPC_COOLDOWN_LO/SPREAD and the 0.25 gate say it is,
    // which makes it a number that can be tuned instead of an emergent one.
    if (fireAt && this.fireCooldown <= 0 && dist < NPC_LASER_RANGE
        && this.facing(targetPos) < NPC_FIRE_GATE) {
      this.fireCooldown = NPC_COOLDOWN_LO + random() * NPC_COOLDOWN_SPREAD;
      return fireAt === 'player'
        ? { at: 'player', weapon: 'laser' }
        : { at: fireAt, weapon: 'laser' };
    }
    return null;
  }

  private attack(
    dt: number,
    targetPos: THREE.Vector3,
    dist: number,
    isPlayer: boolean,
    npcTarget?: NpcShip,
  ): FireEvent | null {
    if (dist < 220) {
      // break off before ramming
      this.steerToward(
        this.tmpDir.copy(this.object.position).multiplyScalar(2).sub(targetPos), dt);
      this.speed = approach(this.speed, this.maxSpeed * 0.8, 150 * dt);
      this.advance(dt);
      return null;
    }
    // pack ships approach offset bearings until close, then converge
    const aim = dist > 900
      ? this.tmpDir.copy(targetPos).add(this.packOffset)
      : this.tmpDir.copy(targetPos);
    this.steerToward(aim, dt);
    this.speed = approach(this.speed, dist > 700 ? this.maxSpeed : this.maxSpeed * 0.45, 120 * dt);
    this.advance(dt);
    this.fireCooldown -= dt;
    // The SAME gun brainFly uses. This was a second one: a 0.22 gate and a
    // 1.4 + rand*1.8 cooldown (mean 2.30s against 1.30s), i.e. 77% slower
    // through a tighter aperture — and this is the path every police ship,
    // bounty hunter, thargoid and knife-range pirate actually fires on, so
    // most of the hostiles in the game used numbers the trainer never saw.
    // The parity test missed it because it reads the FIRST match in the file
    // and brainFly happens to come first.
    //
    // Thargoids keep their edge as a multiplier on the shared cooldown rather
    // than as a separate literal.
    if (this.fireCooldown <= 0 && dist < NPC_LASER_RANGE
        && this.facing(targetPos) < NPC_FIRE_GATE) {
      this.fireCooldown = (NPC_COOLDOWN_LO + random() * NPC_COOLDOWN_SPREAD)
        * (this.role === 'thargoid' ? THARGOID_FIRE_RATE : 1);
      return isPlayer
        ? { at: 'player', weapon: 'laser' }
        : { at: npcTarget!, weapon: 'laser' };
    }
    return null;
  }

  /**
   * WHICH weapon leaves the rail — and the one case where something leaves it
   * that the flight above did not ask for.
   *
   * The rules are gunnery.ts's; this is the only place that applies them, so a
   * missile is decided once and reported once. It used to be decided in
   * game.ts, off the back of a FireEvent the ship had already produced, which
   * meant a missile could only ever leave at the moment its owner was lined up
   * for a LASER shot: inside 0.25 rad, with the gun loaded. A pirate that is
   * about to die is rarely either, so it died with the missile still on the
   * rail. That is what `npcMissileLastStand` fixes, and it is why it does not
   * consult the gun's cooldown or its firing gate.
   */
  private chooseWeapon(
    shot: FireEvent | null, dt: number, dist: number, targetPos: THREE.Vector3,
  ): FireEvent | null {
    if (this.missiles <= 0) return shot;
    this.missileReload = Math.max(0, this.missileReload - dt);
    if (this.missileReload > 0) return shot;
    // Fall back to 1 (untouched), not 0. A divide-by-zero guard that reports
    // "nearly dead" would make a hull-less ship empty its rack; unreachable
    // today, since everything that carries a missile has hp, but it is the
    // wrong way round.
    const hull = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    if (npcMissileLastStand(hull, dist, this.facing(targetPos))
        // ...or the old opportunistic launch, taken instead of a bolt it was
        // about to fire anyway.
        || (shot !== null && shot.at === 'player' && npcPrefersMissile(dist, random()))) {
      this.missileReload = MISSILE_RELOAD;
      return { at: 'player', weapon: 'missile' };
    }
    return shot;
  }

  private advance(dt: number): void {
    this.tmpDir.set(0, 0, -1).applyQuaternion(this.object.quaternion);
    this.object.position.addScaledVector(this.tmpDir, this.speed * dt);
  }

  /**
   * The muzzle: where a bolt or missile should visually leave this ship.
   * Lasers are nose-mounted, so this is the hull's front, not its centre —
   * without it a big hull (Anaconda 55, Thargoid 60) appears to fire from
   * inside itself.
   */
  nosePosition(out: THREE.Vector3): THREE.Vector3 {
    return out
      .set(0, 0, -1)
      .applyQuaternion(this.object.quaternion)
      .multiplyScalar(this.radius * 0.9)
      .add(this.object.position);
  }

  /** Angle (radians) between our nose and the direction to a point. */
  facing(point: THREE.Vector3): number {
    const forward = this.tmpDir.set(0, 0, -1).applyQuaternion(this.object.quaternion);
    const to = point.clone().sub(this.object.position).normalize();
    return forward.angleTo(to);
  }

  private steerToward(point: THREE.Vector3, dt: number): void {
    const dir = this.tmpDir.copy(point).sub(this.object.position);
    if (dir.lengthSq() < 1) return;
    this.tmpMat.lookAt(ZERO, dir, UP); // -Z ends up along dir
    this.tmpQ.setFromRotationMatrix(this.tmpMat);
    this.object.quaternion.rotateTowards(this.tmpQ, this.turnRate * dt);
  }

  /** @returns true if the ship was destroyed. */
  takeDamage(amount: number, from?: THREE.Vector3, byPlayer = false): boolean {
    this.provoked = true;
    if (byPlayer) this.provokedByPlayer = true;
    if (from && this.role === 'trader') {
      this.fleeFrom.copy(from);
      this.fleeing = true;
    }
    this.hp -= amount;
    if (this.hp <= 0 && this.alive) {
      this.alive = false;
      return true;
    }
    return false;
  }
}

function approach(current: number, target: number, step: number): number {
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}
