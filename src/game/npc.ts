import * as THREE from 'three';
import {
  buildShip, buildAsteroid, type ShipDef,
  COBRA_MK3, SIDEWINDER, VIPER, ADDER, KRAIT, MAMBA, ASP, FER_DE_LANCE,
  PYTHON, ANACONDA, WORM, THARGOID, THARGON, CONSTRICTOR,
  GECKO, MORAY, BOA, SHUTTLE, TRANSPORTER, GENERATION_SHIP,
} from '../ships/geometry';
import {
  observe, observePack, act, makeScratch, brainFromFile,
  type Brain, type BrainFile, type ObservableShip,
} from '../sim/policy';
import { TURN } from '../sim/core';
import pirateBrainFile from '../sim/brains/pirate-attack-r2.json';
import packBrainFile from '../sim/brains/pirate-pack-r4-selectonly.json';
import defendBrainFile from '../sim/brains/jameson-defend.json';

// The neuroevolution-trained pirate brain (see docs/TRAINING-LOG.md).
// We ship the league round-2 brain: it beats evasive targets 98% of the time
// (round 1 scored 0% vs them) while still taking non-evaders 90% — and human
// players fly evasively.
// Pirates fly with it at a 10 Hz decision rate; set `window.__scriptedPirates
// = true` to compare against the old scripted AI.
const PIRATE_BRAIN: Brain | null = (() => {
  try {
    return brainFromFile(pirateBrainFile as unknown as BrainFile);
  } catch {
    return null;
  }
})();

export const DEFEND_BRAIN: Brain | null = (() => {
  try {
    return brainFromFile(defendBrainFile as unknown as BrainFile);
  } catch {
    return null;
  }
})();

/**
 * The pack-trained brain: 18 inputs (solo 14 + the nearest packmate's bearing
 * and distance). This is round 4's `pirate-pack-r4-selectonly`, the first pack
 * policy to take 100% of held-out episodes against all three test traders
 * (docs/TRAINING-LOG.md, run 7).
 *
 * It is **still not the default**, but no longer because it's worse — it beats
 * the shipped solo trio outright, including 100% vs 41% against a trader that
 * shoots back. It kills a player-like target in 1.5-2.9s where the shipped
 * trio takes 10.8-11.7s, and whether Elite's pirates should be 4-7x more
 * lethal is a game-design decision, not a tournament one.
 *
 * Set `window.__packBrain = true` to fly it and judge for yourself.
 */
const PACK_BRAIN: Brain | null = (() => {
  try {
    return brainFromFile(packBrainFile as unknown as BrainFile);
  } catch {
    return null;
  }
})();

function brainsEnabled(): boolean {
  return !(window as unknown as Record<string, unknown>).__scriptedPirates;
}

/**
 * Range at which trained pilots hand back to the scripted break-off.
 *
 * The sim the policies were trained in has NO collision model — `radius` in
 * sim/core.ts is used only for the laser cone. Flying straight through the
 * target is therefore free in training, so the optimal learned behaviour is to
 * close to zero range and sit there shooting. In the game, where ships are
 * solid, that reads as deliberate ramming: the pirate slides past you and
 * kamikazes.
 *
 * They are not being rewarded for it — a collision deals 0.45 to both, which a
 * shielded player absorbs and a 0.55 hp Sidewinder very nearly dies to. It was
 * simply never taught to be a bad idea.
 *
 * Matches attack()'s existing 220-unit break-off, which brain-flown ships
 * previously never reached because brainFly returns before attack() is called.
 * The real fix is a collision model in sim/core.ts plus a retrain — this is
 * the guard rail until then (docs/TRAINING-LOG.md).
 */
const RAM_GUARD = 220;

function packBrainEnabled(): boolean {
  return !!(window as unknown as Record<string, unknown>).__packBrain;
}

// Test-harness access to the trained policies (used by the autopilot
// commanders in docs/JAMESON-TRIALS.md to fly the *player's* ship).
(window as unknown as Record<string, unknown>).__policyKit = {
  act, observe, observePack, makeScratch,
  pirateBrain: PIRATE_BRAIN, packBrain: PACK_BRAIN, defendBrain: DEFEND_BRAIN,
};

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

export type NpcRole =
  'trader' | 'pirate' | 'police' | 'hunter' | 'thargoid' | 'thargon' | 'asteroid' |
  'hermit' | 'generation';

const ZERO = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export interface PlayerRef {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export type FireEvent = { at: 'player' } | { at: NpcShip };

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
    (npc.role === 'police' && (legalStatus >= 2 || npc.provoked)) ||
    (npc.role === 'hunter' && (legalStatus >= 1 || npc.provoked))
  );
}

export interface NpcSpec {
  def: ShipDef | null; // null → asteroid
  color: number;
  hp: number;
  maxSpeed: number;
  turnRate: number;
  bounty: number; // tenths of a credit
  radius: number;
  missiles?: number;
  ecmChance?: number;
  cargoDrop?: number; // max canisters dropped on destruction
  armed?: boolean; // fights back (with the Jameson defence brain) when attacked
}

const SPECS: Record<Exclude<NpcRole, 'asteroid'>, NpcSpec[]> = {
  trader: [
    { def: COBRA_MK3, color: 0xffffff, hp: 1.0, maxSpeed: 220, turnRate: 0.5, bounty: 0, radius: 34, ecmChance: 0.4, cargoDrop: 3, armed: true },
    { def: PYTHON, color: 0xd9e8ff, hp: 1.8, maxSpeed: 160, turnRate: 0.35, bounty: 0, radius: 40, ecmChance: 0.5, cargoDrop: 5, armed: true },
    { def: ANACONDA, color: 0xcfe0d8, hp: 2.6, maxSpeed: 120, turnRate: 0.25, bounty: 0, radius: 55, ecmChance: 0.7, cargoDrop: 6, armed: true },
    { def: ADDER, color: 0xffe28a, hp: 0.5, maxSpeed: 260, turnRate: 0.8, bounty: 0, radius: 18, cargoDrop: 1 },
    { def: WORM, color: 0xbfd8bf, hp: 0.4, maxSpeed: 200, turnRate: 0.9, bounty: 0, radius: 14, cargoDrop: 1 },
    { def: BOA, color: 0xd8d8c0, hp: 2.2, maxSpeed: 140, turnRate: 0.3, bounty: 0, radius: 44, ecmChance: 0.6, cargoDrop: 5, armed: true },
    { def: SHUTTLE, color: 0xc8e8c8, hp: 0.45, maxSpeed: 180, turnRate: 0.7, bounty: 0, radius: 14, cargoDrop: 1 },
    { def: TRANSPORTER, color: 0xc0d0e0, hp: 0.6, maxSpeed: 160, turnRate: 0.5, bounty: 0, radius: 20, cargoDrop: 2 },
  ],
  pirate: [
    { def: SIDEWINDER, color: 0xff9a5c, hp: 0.55, maxSpeed: 300, turnRate: 1.1, bounty: 50, radius: 18 },
    { def: KRAIT, color: 0xffb36c, hp: 0.7, maxSpeed: 290, turnRate: 1.0, bounty: 80, radius: 22 },
    { def: MAMBA, color: 0xff8a4c, hp: 0.65, maxSpeed: 310, turnRate: 1.05, bounty: 70, radius: 24 },
    { def: GECKO, color: 0xffa050, hp: 0.6, maxSpeed: 290, turnRate: 1.0, bounty: 60, radius: 20 },
    { def: MORAY, color: 0xff9a70, hp: 0.6, maxSpeed: 280, turnRate: 1.0, bounty: 65, radius: 18 },
    { def: COBRA_MK3, color: 0xffc46c, hp: 1.1, maxSpeed: 260, turnRate: 0.8, bounty: 100, radius: 34, missiles: 1, cargoDrop: 2 },
  ],
  police: [
    { def: VIPER, color: 0x9ad9ff, hp: 0.9, maxSpeed: 320, turnRate: 1.3, bounty: 0, radius: 20, ecmChance: 1 },
  ],
  hunter: [
    { def: FER_DE_LANCE, color: 0xd8c8ff, hp: 1.3, maxSpeed: 330, turnRate: 1.1, bounty: 0, radius: 26, ecmChance: 0.6 },
    { def: ASP, color: 0xc8d8ff, hp: 1.0, maxSpeed: 340, turnRate: 1.2, bounty: 0, radius: 22, ecmChance: 0.4 },
  ],
  thargoid: [
    { def: THARGOID, color: 0x7cff9a, hp: 2.6, maxSpeed: 300, turnRate: 0.7, bounty: 500, radius: 60, ecmChance: 1 },
  ],
  thargon: [
    { def: THARGON, color: 0x9cffb0, hp: 0.2, maxSpeed: 350, turnRate: 1.8, bounty: 50, radius: 12 },
  ],
  // a hollowed asteroid trading post — inert, but you can dock with it
  hermit: [
    { def: null, color: 0x9a9a8a, hp: 4, maxSpeed: 0, turnRate: 0, bounty: 0, radius: 120 },
  ],
  // derelict colony vessel: vast, slow, defenceless
  generation: [
    { def: GENERATION_SHIP, color: 0xbfc8d8, hp: 8, maxSpeed: 25, turnRate: 0.05, bounty: 0, radius: 340, cargoDrop: 8 },
  ],
};

/**
 * Pirate hulls by threat tier (see pirateThreat() in contracts.ts). Tier is
 * decided by how attractive a target the player looks — a poor Cobra full of
 * food draws opportunists in Sidewinders; a fat, notorious one draws a gang in
 * Fer-de-Lances. Passed to spawnNpc as a specOverride, so these stay ordinary
 * pirates for every other purpose (bounty, legality, police response).
 */
const PIRATE_TIERS: NpcSpec[][] = [
  // 0 — opportunists: cheap, fast, easily discouraged
  [
    { def: SIDEWINDER, color: 0xff9a5c, hp: 0.55, maxSpeed: 300, turnRate: 1.1, bounty: 50, radius: 18 },
    { def: GECKO, color: 0xffa050, hp: 0.6, maxSpeed: 290, turnRate: 1.0, bounty: 60, radius: 20 },
    { def: WORM, color: 0xffbb80, hp: 0.4, maxSpeed: 200, turnRate: 0.9, bounty: 40, radius: 14 },
  ],
  // 1 — professionals: the existing pirate mix
  [
    { def: KRAIT, color: 0xffb36c, hp: 0.7, maxSpeed: 290, turnRate: 1.0, bounty: 80, radius: 22 },
    { def: MAMBA, color: 0xff8a4c, hp: 0.65, maxSpeed: 310, turnRate: 1.05, bounty: 70, radius: 24 },
    { def: MORAY, color: 0xff9a70, hp: 0.6, maxSpeed: 280, turnRate: 1.0, bounty: 65, radius: 18 },
    { def: COBRA_MK3, color: 0xffc46c, hp: 1.1, maxSpeed: 260, turnRate: 0.8, bounty: 100, radius: 34, missiles: 1, cargoDrop: 2 },
  ],
  // 2 — an organised gang: they brought the good ships, and missiles
  [
    { def: FER_DE_LANCE, color: 0xff7a4c, hp: 1.3, maxSpeed: 330, turnRate: 1.1, bounty: 180, radius: 26, missiles: 1, ecmChance: 0.5, cargoDrop: 2 },
    { def: ASP, color: 0xff8f5c, hp: 1.0, maxSpeed: 340, turnRate: 1.2, bounty: 150, radius: 22, missiles: 1, ecmChance: 0.3, cargoDrop: 1 },
    { def: PYTHON, color: 0xffa878, hp: 1.8, maxSpeed: 160, turnRate: 0.35, bounty: 200, radius: 40, missiles: 2, ecmChance: 0.6, cargoDrop: 4 },
  ],
];

/** Pick a hull for a pirate of the given threat tier. */
export function pirateSpecForTier(tier: number, variantSeed: number): NpcSpec {
  const tiers = PIRATE_TIERS[Math.max(0, Math.min(PIRATE_TIERS.length - 1, tier))];
  return tiers[Math.abs(variantSeed) % tiers.length];
}

export const CONSTRICTOR_SPEC: NpcSpec = {
  def: CONSTRICTOR, color: 0xffd24d, hp: 3.2, maxSpeed: 370, turnRate: 1.2,
  bounty: 2500, radius: 24, missiles: 2, ecmChance: 1,
};

export type TraderPhase = 'arriving' | 'trading' | 'departing';

export class NpcShip {
  readonly object: THREE.Object3D;
  readonly role: NpcRole;
  readonly radius: number;
  readonly bounty: number;
  readonly cargoDrop: number;
  hp: number;
  readonly maxHp: number;
  alive = true;
  /** Set when the player damages this ship. */
  provoked = false;
  /** True when it was specifically the player who attacked us. */
  provokedByPlayer = false;
  readonly armed: boolean;
  /** Homing missiles this ship can still launch at the player. */
  missiles = 0;
  readonly hasEcm: boolean;
  /** Mission flag: destroying this advances the Constrictor hunt. */
  isMissionTarget = false;

  /** Pack spread so groups attack from different bearings. */
  readonly packOffset = new THREE.Vector3();
  /** Pirates currently targeting this ship; maintained (and pruned) by the game loop. */
  readonly attackers: NpcShip[] = [];
  /** NPC-vs-NPC target, assigned by the game (pirate→trader, police→pirate). */
  npcTarget: NpcShip | null = null;
  /** Where the last attack came from; traders flee this. */
  private readonly fleeFrom = new THREE.Vector3();
  private fleeing = false;
  /** Thargons go inert when their mothership dies. */
  inert = false;

  /** Trader lifecycle. */
  traderPhase: TraderPhase = 'trading';
  tradeTimer = 20 + Math.random() * 40;
  /** Set true when this ship has flown off / docked and should be removed. */
  wantsDespawn = false;
  /**
   * Tier-2 gang member: flies the coordinated pack policy and doesn't scare
   * off. Set by the Game from pirateThreat() when the player looks worth
   * organising against.
   */
  organised = false;
  /** took the jettisoned cargo and lost interest — see isHostileToPlayer */
  satisfied = false;
  /** threat tier this ship was spawned at — sets what killing it is worth */
  threatTier = 0;

  /** public so the Game can scrub speed off on a collision */
  speed: number;
  private readonly maxSpeed: number;
  private readonly turnRate: number;
  private fireCooldown = 2 + Math.random() * 2;
  private readonly waypoint = new THREE.Vector3();
  private waypointTimer = 0;
  private readonly tumbleAxis = new THREE.Vector3().randomDirection();

  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();

  // trained-brain flight state (pirates)
  private brainTimer = 0;
  private brainControl: { pitch: number; roll: number; throttle: number; fire: boolean } | null = null;
  private brainPitchRate = 0;
  private brainRollRate = 0;
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

  constructor(role: NpcRole, position: THREE.Vector3, variantSeed: number, specOverride?: NpcSpec) {
    this.role = role;
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
      this.object.position.copy(position);
      this.object.quaternion.random();
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
      this.hasEcm = Math.random() < (spec.ecmChance ?? 0);
      this.armed = spec.armed ?? false;
    }
    this.packOffset.randomDirection().multiplyScalar(250 + Math.random() * 500);
    this.object.position.copy(position);
    this.object.quaternion.random();
  }

  /**
   * @param playerLegal 0 clean, 1 offender, 2 fugitive
   * @returns a fire event if this ship shot at something this frame
   */
  update(
    dt: number,
    player: PlayerRef,
    playerLegal: number,
    home: THREE.Vector3,
    fleet: readonly NpcShip[] = [],
  ): FireEvent | null {
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
      if (this.role === 'pirate' && PIRATE_BRAIN && brainsEnabled()
          && distPlayer >= RAM_GUARD) {
        // organised gangs fly the pack policy; opportunists fly solo
        const pack = PACK_BRAIN && (this.organised || packBrainEnabled());
        return this.brainFly(pack ? PACK_BRAIN : PIRATE_BRAIN, dt,
          player.position, player.quaternion, 300, distPlayer, 'player',
          pack ? fleet : null);
      }
      // Inside knife range the scripted break-off takes over — see RAM_GUARD.
      return this.attack(dt, player.position, distPlayer, true);
    }

    if (this.npcTarget && this.npcTarget.alive) {
      const d = this.npcTarget.object.position.distanceTo(this.object.position);
      if (d < 7000) return this.attack(dt, this.npcTarget.object.position, d, false, this.npcTarget);
      this.npcTarget = null;
    }

    if (this.fleeing) {
      // armed traders turn and fight with the trained Jameson defence brain
      if (this.armed && DEFEND_BRAIN && brainsEnabled()) {
        if (this.provokedByPlayer && distPlayer < 6000) {
          return this.brainFly(DEFEND_BRAIN, dt,
            player.position, player.quaternion, 300, distPlayer, 'player');
        }
        const attacker = this.nearestAttacker();
        if (attacker) {
          const d = attacker.object.position.distanceTo(this.object.position);
          return this.brainFly(DEFEND_BRAIN, dt,
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
      this.updateTrader(dt, home);
      this.advance(dt);
      return null;
    }

    // amble between waypoints near home
    this.waypointTimer -= dt;
    if (this.waypointTimer <= 0) {
      this.waypointTimer = 12 + Math.random() * 15;
      this.waypoint
        .copy(home)
        .add(new THREE.Vector3().randomDirection().multiplyScalar(800 + Math.random() * 2500));
    }
    this.steerToward(this.waypoint, dt);
    const arrived = this.object.position.distanceTo(this.waypoint) < 200;
    this.speed = approach(this.speed, arrived ? 0 : this.maxSpeed * 0.4, 80 * dt);
    this.advance(dt);
    return null;
  }

  /** Traders arrive from deep space, potter about the station, then leave. */
  private updateTrader(dt: number, home: THREE.Vector3): void {
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
          this.waypointTimer = 10 + Math.random() * 12;
          // work the lane between station and planet (the planet sits at
          // the world origin, so scaling `home` walks that line)
          this.waypoint
            .copy(home)
            .multiplyScalar(0.35 + Math.random() * 0.65)
            .add(new THREE.Vector3().randomDirection().multiplyScalar(600 + Math.random() * 1200));
        }
        this.steerToward(this.waypoint, dt);
        this.speed = approach(this.speed, this.maxSpeed * 0.35, 60 * dt);
        if (this.tradeTimer <= 0) {
          this.traderPhase = 'departing';
          this.waypoint
            .copy(home)
            .add(new THREE.Vector3().randomDirection().multiplyScalar(30000));
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
    // must match TURN in sim/core.ts — invariant 2
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
    if (c.throttle < 0) this.speed = Math.max(0, this.speed - 120 * dt);
    if (this.brainRollRate !== 0) this.object.rotateZ(this.brainRollRate * dt);
    if (this.brainPitchRate !== 0) this.object.rotateX(this.brainPitchRate * dt);
    this.advance(dt);

    this.fireCooldown -= dt;
    if (c.fire && fireAt && this.fireCooldown <= 0 && dist < 2600 && this.facing(targetPos) < 0.25) {
      this.fireCooldown = 0.9 + Math.random() * 0.8;
      return fireAt === 'player' ? { at: 'player' } : { at: fireAt };
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
    if (this.fireCooldown <= 0 && dist < 2600 && this.facing(targetPos) < 0.22) {
      this.fireCooldown = (this.role === 'thargoid' ? 1.0 : 1.4) + Math.random() * 1.8;
      return isPlayer ? { at: 'player' } : { at: npcTarget! };
    }
    return null;
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

// --- Explosions ------------------------------------------------------------
// Classic line-debris burst: a handful of short segments flying apart.

export interface ExplosionOpts {
  count?: number;
  speed?: number;
  duration?: number;
}

export class Explosion {
  readonly object: THREE.LineSegments;
  private readonly velocities: THREE.Vector3[] = [];
  private life = 0;
  private readonly duration: number;
  private readonly material: THREE.LineBasicMaterial;

  constructor(
    center: THREE.Vector3,
    color: THREE.ColorRepresentation = 0xffe9a8,
    opts: ExplosionOpts = {},
  ) {
    const count = opts.count ?? 26;
    const speed = opts.speed ?? 220;
    this.duration = opts.duration ?? 1.6;
    const positions = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3().randomDirection();
      const seg = new THREE.Vector3().randomDirection().multiplyScalar(4 + Math.random() * 8);
      positions.set([-seg.x, -seg.y, -seg.z, seg.x, seg.y, seg.z], i * 6);
      this.velocities.push(dir.multiplyScalar(speed * (0.3 + Math.random())));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.material = new THREE.LineBasicMaterial({ color, transparent: true });
    this.object = new THREE.LineSegments(geo, this.material);
    this.object.position.copy(center);
    this.object.frustumCulled = false;
  }

  /** @returns false when burnt out. */
  update(dt: number): boolean {
    this.life += dt;
    const pos = this.object.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < this.velocities.length; i++) {
      const v = this.velocities[i];
      for (const off of [0, 3]) {
        arr[i * 6 + off] += v.x * dt;
        arr[i * 6 + off + 1] += v.y * dt;
        arr[i * 6 + off + 2] += v.z * dt;
      }
    }
    pos.needsUpdate = true;
    this.material.opacity = Math.max(0, 1 - this.life / this.duration);
    return this.life < this.duration;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}

// --- Laser tracers ---------------------------------------------------------
// A brief bright bolt between two points so fire is actually visible.

export class Tracer {
  readonly object: THREE.Line;
  private life = 0;
  private readonly duration: number;
  private readonly material: THREE.LineBasicMaterial;

  constructor(
    from: THREE.Vector3,
    to: THREE.Vector3,
    color: THREE.ColorRepresentation,
    duration = 0.18,
  ) {
    this.duration = duration;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([from.x, from.y, from.z, to.x, to.y, to.z], 3),
    );
    this.material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.object = new THREE.Line(geo, this.material);
    this.object.frustumCulled = false;
  }

  /** @returns false when expired. */
  update(dt: number): boolean {
    this.life += dt;
    this.material.opacity = Math.max(0, 1 - this.life / this.duration);
    return this.life < this.duration;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
