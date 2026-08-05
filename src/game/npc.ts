import * as THREE from 'three';
import { buildShip, buildAsteroid } from '../ships/geometry.ts';
import { registeredHull } from '../ships/registry.ts';
import {
  ASTEROID_IDENTITY, rosterSpec, shipAccel, type NpcSpec,
} from './ship-specs.ts';
import { TURN } from '../constants/hull-motion.ts';
import type { NpcRole } from './ship-roles.ts';
import type {
  NpcCombatProfileId, ShipDesignId, ShipIdentity,
} from './ship-identity.ts';
import {
  act, makeScratch, PACK_WIDE_OBS_SIZE, type Brain,
} from '../ai-training/policy.ts';
import {
  observeFor, shipView, writeView, type ObservableMate,
} from '../ai-training/observation.ts';
import { pirateBrainFor, defenceBrain } from './brains.ts';
import {
  nextAttackPhase, closingThrottle, rollExtendRange, type AttackPhase,
} from './break-off.ts';
import {
  EXTEND_RANGE_MAX, MIN_CRUISE_FRACTION, UNDER_FIRE_SECONDS,
} from '../constants/attack-run.ts';
import {
  BRAIN_RATE_DECAY, BRAIN_RATE_RAMP, DECISION_INTERVAL,
} from '../constants/brain-flight.ts';
import { leadTime, passMissDistance } from './pass-aim.ts';
import { extendArcAngle } from './extend-arc.ts';
import { TACTICS, type TacticId } from '../constants/tactics.ts';
import { chooseTactic, tacticSwitchReason, type TacticHull } from './tactic-choice.ts';
import { PLAYER_INTEREST_RANGE } from '../constants/player-interest.ts';
import { separationFrom } from './separation.ts';
import { SEPARATION_PUSH } from '../constants/separation.ts';
import type { BrainSelection } from './brain-names.ts';
import { THARGOID_FIRE_RATE } from '../constants/npc-gun.ts';
import { MISSILE_RELOAD } from '../constants/ordnance.ts';
import { npcTriggerPull, npcWeaponByte } from './gunnery.ts';
import { npcMissileEmergency } from './missile-launch.ts';
import {
  energyAfterDamage, isDestroyed, npcEnergyPolicy, playerLaserDamage,
  regeneratedEnergy, type NpcEnergyPolicy,
} from './npc-energy.ts';
import type { NpcEnergyPoints } from './damage-units.ts';
import { rampToward } from '../player.ts';
import { random, randomDirection, randomQuaternion } from './rng.ts';
import { planDocking, makeDockPlan, type DockPlan } from './docking.ts';

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
  /** Pack spread so groups attack from different bearings. */
  packOffset: THREE.Vector3;
  waypoint: THREE.Vector3;
  /** Where the last attack came from; traders flee this. */
  fleeFrom: THREE.Vector3;
  /**
   * The docking computer's reusable outputs and its behavior-driving phase.
   *
   * `phase` latches once a trader commits to the slot run. The vectors remain
   * live scratch objects which `planDocking` rewrites in place each frame, so
   * keeping the whole plan here preserves both replay state and the
   * allocation-free update path.
   */
  dockPlan: DockPlan;
  /** Trader lifecycle. */
  traderPhase: TraderPhase;
  /**
   * The cached trained-brain flight decision, re-taken every brainTimer
   * seconds.
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
   *
   * Decided at spawn: does this one have business at the station?
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
  /**
   * The ship's bank, in SOURCE ENERGY POINTS — a whole number, never a
   * fraction, because a fraction of a point is not a thing the released game
   * can express. It was `hp` on a normalized per-hull scale until TODO 26.
   *
   * Anything that wants 0..1 asks `healthFraction`; anything that wants to hurt
   * it passes points. Those are the only two ways in.
   */
  energy: number;
  /**
   * Regeneration's sub-second remainder, as whole ticks — see
   * ELITE_A_REGEN_TICKS_PER_SECOND. It is state because the step reads it: a
   * ship reloaded mid-tick that started its carry again would recover at a
   * different moment from the run it came from.
   */
  regenCarry: number;
  alive: boolean;
  /** Hit by anything at all — police do NOT read this, see isHostileToPlayer. */
  provoked: boolean;
  /** True when it was specifically the player who attacked us. */
  provokedByPlayer: boolean;
  /** Homing missiles this ship can still launch at the player. */
  missiles: number;
  /** Mission flag: destroying this advances the Constrictor hunt. */
  isMissionTarget: boolean;
  fleeing: boolean;
  /** where this ship is in its attack run — see break-off.ts */
  attackPhase: AttackPhase;
  /**
   * Which flight actually moved this ship last step — a trained policy, or the
   * scripted attack run.
   *
   * Reported, never read by a rule, and it exists because the readout without
   * it LIED. `attackPhase` is only touched inside `attack()`, so a brain-flown
   * pirate left it at whatever it was and the trainer's new "spent its time"
   * column read `closing 45s` for a ship that had not run the closing logic
   * once in 45 seconds. A field that says which flight ran is the honest
   * version, and it costs nothing to snapshot because NpcState is walked
   * generically.
   */
  flownBy: 'brain' | 'scripted';
  /** seconds of evasive flying left after the last hit taken — see break-off.ts */
  underFire: number;
  /**
   * How far out THIS run goes before turning back, rolled from the band in
   * break-off.ts every time the ship starts extending.
   *
   * It is state for the same reason `hasEcm` is: a shake of the dice decides
   * what the ship does next, so it cannot be re-derived on restore — by then
   * the stream is somewhere else entirely.
   */
  extendRange: number;
  /** which side this run passes on, +1 or -1, re-rolled with extendRange */
  passSide: number;
  /**
   * WHICH WAY this ship flies its attack run — see constants/tactics.ts.
   *
   * Rolled once at spawn from the hull's own capability set, and re-rolled only
   * when something happens that a pilot would act on: hurt, a last stand, or a
   * spell with the guns cold. It is state for `hasEcm`'s reason and
   * `extendRange`'s — a shake of the dice decides what the ship does next, so it
   * cannot be re-derived on restore, by which time the stream is somewhere else
   * entirely.
   */
  tactic: TacticId;
  /** seconds on the current tactic — the dwell the switch reads */
  tacticClock: number;
  /**
   * Seconds since this ship last got a shot away.
   *
   * The SLEEPER's clock: "this is not working, try something else". It ticks in
   * `attack()` and only in `attack()`, because a tactic governs the scripted
   * flight and a brain-flown ship's is dormant until it hands over — the same
   * line `flownBy` draws.
   */
  dryFor: number;
  /**
   * Completed attack runs, over this ship's whole life.
   *
   * A missile costs money and there is no resupply, so a ship spends one when
   * the fight is going badly rather than when the geometry is convenient — and
   * "I have flown at this twice and it is still there" is how a ship finds that
   * out. See `npcMissileEmergency`.
   *
   * NOT per-target, and deliberately not: a pirate that harried a trader and
   * then turned on the commander has still spent its afternoon failing to kill
   * things, which is the disposition this is standing in for. Making it
   * per-target would mean carrying the target's identity in the state as well,
   * to reset against — a second field to keep in step for a distinction the
   * rule does not actually draw.
   */
  passesMade: number;
  /** Thargons go inert when their mothership dies. */
  inert: boolean;
  tradeTimer: number;
  /** Set true when this ship has flown off / docked and should be removed. */
  wantsDespawn: boolean;
  /** This trader put in at the station rather than jumping out. */
  docked: boolean;
  /** On final approach into the slot — the station must not shove it away. */
  docking: boolean;
  /**
   * Tier-2 gang member: flies the coordinated pack policy and doesn't scare
   * off. Set by the Game from pirateThreat() when the player looks worth
   * organising against.
   */
  organised: boolean;
  /** Took the jettisoned cargo and lost interest — see isHostileToPlayer. */
  satisfied: boolean;
  /** Threat tier this ship was spawned at — sets what killing it is worth. */
  threatTier: number;
  /** Public so the Game can scrub speed off on a collision. */
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
const UP = new THREE.Vector3(0, 1, 0);

export interface PlayerRef {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** current speed. The brain's observation needs it to lead a shot. */
  speed: number;
}

/**
 * The world facts an NPC may inspect during one simulation step.
 *
 * `dockZ` is required because it belongs to the live station: a Coriolis uses
 * 160 while a Dodo uses 135. Keeping it in this per-step view means a ship
 * cannot accidentally remember a value supplied by an earlier caller.
 */
export interface WorldView {
  station: THREE.Object3D;
  dockZ: number;
  fleet: readonly NpcShip[];
  /** 0 clean, 1 offender, 2 fugitive */
  playerLegal: number;
  /**
   * Is a hostile missile ALREADY homing on the player?
   *
   * One in the air at a time, across the whole gang. E.C.M. destroys every
   * missile in flight in one burst for a quarter of the bank, so it is a
   * complete answer to one missile and no answer at all to five — which is how
   * a wave-13 gang put three through in nine seconds. Capping the air makes the
   * counterplay the player already owns actually work, and it costs the gang
   * nothing it can see: a ship that would have launched fires its gun instead.
   *
   * It lives on the view rather than being read off the world because a ship
   * decides and reports; `game.ts` supplies what the ship is allowed to know.
   */
  missileInbound: boolean;
  brains: BrainSelection;
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
  if (!npc.state.alive || npc.state.inert) return false;
  // A pirate that has taken its payday stops caring about you: this is what
  // makes jettisoning cargo a real escape rather than a donation.
  if (npc.state.satisfied) return false;
  return (
    npc.role === 'pirate' || npc.role === 'thargoid' || npc.role === 'thargon' ||
    // provokedBY PLAYER, not provoked. takeDamage() flags `provoked` for any
    // damage from any source, so a Viper trading fire with a pirate — or one
    // that clipped an asteroid — used to decide a clean commander was fair
    // game. Chris flew into exactly that: a police ship mid-fight with another
    // NPC turned on him as though he were a fugitive.
    (npc.role === 'police' && (legalStatus >= 2 || npc.state.provokedByPlayer)) ||
    (npc.role === 'hunter' && (legalStatus >= 1 || npc.state.provokedByPlayer))
  );
}

/**
 * Is anything close enough and cross enough to turn the condition light red?
 *
 * The same range the ship itself engages at, from `constants/player-interest.ts` — the
 * light reports the rule rather than restating it, which is what stops the
 * console going red at a ship that has not decided anything.
 */
export function hostilesNear(
  npcs: readonly NpcShip[], playerPos: THREE.Vector3, legalStatus: number,
): boolean {
  return npcs.some((npc) =>
    isHostileToPlayer(npc, legalStatus)
    && npc.object.position.distanceTo(playerPos) < PLAYER_INTEREST_RANGE);
}

export type TraderPhase = 'arriving' | 'trading' | 'departing' | 'docking';

/**
 * Rotate `quat` so its −Z points along `dir`, by at most `maxStep` radians.
 *
 * The scripted steering rule, as a free function, because the training
 * scenarios steer the TARGET with it too and it is not the target's own rule —
 * it is this one. Mutates `quat` in place and allocates nothing.
 */
export function steerQuatToward(
  quat: THREE.Quaternion, dir: THREE.Vector3, maxStep: number,
): void {
  if (dir.lengthSq() < 1) return;
  steerMat.lookAt(ZERO, dir, UP); // -Z ends up along dir
  steerQuat.setFromRotationMatrix(steerMat);
  quat.rotateTowards(steerQuat, maxStep);
}

const steerMat = new THREE.Matrix4();
const steerQuat = new THREE.Quaternion();

export class NpcShip {
  readonly object: THREE.Object3D;
  readonly role: NpcRole;
  readonly radius: number;
  readonly bounty: number;
  readonly cargoDrop: number;
  /**
   * The full bank, in source energy points, from this ship's exact released
   * build. Not a roster number: two ships of the same design are as tough as
   * the pack says that design is, and `ship-specs.ts` has no say in it.
   */
  readonly maxEnergy: number;
  /**
   * How player lasers treat this ship, and whether it recovers — resolved once
   * from `profileId`. Immunity and the Constrictor's halving live in here, so
   * nothing that shoots at a ship has to know which ship it is.
   */
  readonly energyPolicy: NpcEnergyPolicy;
  /**
   * The packed weapon byte this ship's exact released build carries — what its
   * gun is worth against the commander, resolved once from `profileId`.
   *
   * A number the ship KNOWS, not a rule it applies: an NPC returns a FireEvent
   * and the Game resolves what the shot costs (world-step.ts), exactly as
   * `energyPolicy` is what the ship knows about incoming fire rather than
   * something it does with it.
   */
  readonly weaponByte: number;
  readonly armed: boolean;

  /**
   * The pirates hunting this ship — the ships whose `npcTarget` is this one.
   *
   * Private, and the invariant belongs to the three verbs below. It used to be
   * a public array that two other modules spliced by hand and a third repaired
   * on restore, which is a rule with three homes and a mirror of `npcTarget`
   * kept in step by hope.
   */
  private readonly attackers: NpcShip[] = [];
  /** NPC-vs-NPC target, assigned by the game (pirate→trader, police→pirate). */
  npcTarget: NpcShip | null = null;

  private readonly maxSpeed: number;
  private readonly turnRate: number;
  /**
   * Thrust, units/s — per hull, from the roster (ship-specs.ts shipAccel).
   *
   * It was one flat 120 for every brain-flown ship in the galaxy, which is
   * the omission the trainer merge exposed: a Sidewinder tops out 15% quicker
   * than a Cobra and used to reach it no faster.
   */
  readonly accel: number;
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpDir2 = new THREE.Vector3();
  private readonly tmpSide = new THREE.Vector3();
  private readonly tmpAway = new THREE.Vector3();
  private readonly tmpLead = new THREE.Vector3();
  private readonly tmpVel = new THREE.Vector3();
  private readonly mateSlots: THREE.Vector3[] = [];
  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();

  // sized for PACK_WIDE_OBS_SIZE (26); solo brains read the first 14 slots
  private static readonly obsBuf = new Float32Array(PACK_WIDE_OBS_SIZE);
  /** scratch packmate list, reused so the 10 Hz decision stays allocation-light */
  private static readonly mateView: ObservableMate[] = [];
  /** …backed by a pool that is never truncated, so growth allocates once */
  private static readonly matePool: ObservableMate[] = [];
  private static readonly scratch = makeScratch();
  /**
   * The observation views, refilled per decision — see policy.ts `shipView`.
   *
   * ONE of these numbers is load-bearing and it is a field brainFly never
   * writes: `meView.laserTemp` stays 0, so obs slot 1 (our laser heat) is
   * always 0 in the game. Every shipped brain was fitted against exactly that,
   * so feeding it a real number moves the observation out of the distribution
   * the weights were trained in: a retrain, not a one-line fix.
   *
   * `hp` USED TO BE THE SECOND ONE and is filled truthfully now (docs/TODO/71).
   * Nothing shipped reads it on this path — the solo encoder does not have the
   * slot, `observePack` (18, what the gang policy is) does not reach it, and
   * only `observePackWide`'s slot 25 and `observeDefend`'s slot 14 do. The
   * armed trader that flies the defence policy is exactly the ship the item is
   * about, and it could not see how hurt it was either. A 26-input pack brain
   * must now be TRAINED against a real number rather than a constant 1.0; none
   * is in the tree, and `npm test` holds the directory to the three that are.
   *
   * The rest are inert, and measurably so — brainFly overwrites the me
   * envelope and the target's pos/quat/speed on every decision, and no encoder
   * reads a TARGET's `cls` at all. They are the values that were here before,
   * kept because a view with a plausible envelope is easier to read in a
   * debugger than one full of zeroes.
   */
  private static readonly meView = shipView(0, 0);
  private static readonly targetView = shipView(400, 1.1, 300);

  /** the seed its hull and stats were generated from — kept so a snapshot can rebuild it */
  readonly variantSeed: number;

  /**
   * What this ship IS — see ship-identity.ts.
   *
   * Immutable, so it is not in `NpcState`: the state is what can CHANGE, and a
   * ship does not become another design mid-flight. It is saved beside the role
   * and the seed instead (`NpcSnapshot`), because a save must carry the id
   * rather than re-derive it: today the roster's recommended variant is the
   * only answer, and the moment a blueprint loader picks by system it will not
   * be.
   */
  readonly designId: ShipDesignId;
  readonly profileId: NpcCombatProfileId;

  /** All serialisable mutable state, exposed through this one public path. */
  readonly state: NpcState;

  /** Private aliases keep the flight code readable without duplicating the public API. */
  private get tumbleAxis(): THREE.Vector3 { return this.state.tumbleAxis; }

  private get brainControl(): { pitch: number; roll: number; throttle: number; fire: boolean } | null {
    return this.state.brainControl;
  }

  private set brainControl(v: { pitch: number; roll: number; throttle: number; fire: boolean } | null) {
    this.state.brainControl = v;
  }

  /**
   * @param identity what a RESTORED ship was — omitted for a fresh spawn, which
   * takes the roster's. Every restore supplies one: a snapshot that names no
   * ids is refused at `savedShipIdentity` rather than arriving here without
   * them. Deterministic either way: nothing here draws from the rng to decide
   * it.
   */
  constructor(
    role: NpcRole, position: THREE.Vector3, variantSeed: number,
    specOverride?: NpcSpec, identity?: ShipIdentity,
  ) {
    this.role = role;
    this.variantSeed = variantSeed;
    // The roster entry this ship flies, resolved once: the hull branches below
    // read it, and so does its identity. An asteroid has no roster entry —
    // ASTEROID_IDENTITY is the roster's answer for it.
    const rostered = rosterSpec(role, variantSeed, specOverride);
    this.designId = identity?.designId ?? rostered?.designId ?? ASTEROID_IDENTITY.designId;
    this.profileId = identity?.profileId ?? rostered?.profileId ?? ASTEROID_IDENTITY.profileId;
    // How tough it is comes from what it IS, not from the row that picked it.
    this.energyPolicy = npcEnergyPolicy(this.profileId);
    this.maxEnergy = this.energyPolicy.maxEnergy;
    // ...and what its own gun is worth comes from the same place, for the same
    // reason: two ships of one released build shoot as hard as the pack says.
    this.weaponByte = npcWeaponByte(this.profileId);
    // Built before anything else. `pos` and `quat` are filled in once the mesh
    // exists — they are the
    // mesh's own vectors, so the renderer reads this state rather than being
    // handed a copy of it.
    this.state = {
      pos: null as unknown as THREE.Vector3,
      quat: null as unknown as THREE.Quaternion,
      packOffset: new THREE.Vector3(),
      waypoint: new THREE.Vector3(),
      fleeFrom: new THREE.Vector3(),
      dockPlan: makeDockPlan(),
      traderPhase: 'trading',
      brainControl: null,
      docksHere: random() < 0.5,
      hasEcm: false,   // set from the spec once it is known, below
      tumbleAxis: randomDirection(new THREE.Vector3()),
      energy: this.maxEnergy, regenCarry: 0,
      alive: true, provoked: false, provokedByPlayer: false, missiles: 0,
      isMissionTarget: false, fleeing: false, attackPhase: 'closing', underFire: 0, flownBy: 'scripted',
      extendRange: EXTEND_RANGE_MAX, passSide: 1, passesMade: 0,
      tactic: 'run', tacticClock: 0, dryFor: 0,
      inert: false, tradeTimer: 0,
      wantsDespawn: false, docked: false, docking: false, organised: false,
      satisfied: false, threatTier: 0, speed: 0, fireCooldown: 0, missileReload: 0,
      waypointTimer: 0, brainTimer: 0, brainPitchRate: 0, brainRollRate: 0,
    };
    if (role === 'hermit') {
      // The one rostered ship with no tabulated hull: a hollowed rock, so its
      // mesh is generated at the registry's radius for it.
      const hermitRadius = registeredHull(this.designId).targetRadius;
      this.object = buildAsteroid(hermitRadius, variantSeed * 977 + 3, 0xb9b9a5);
      this.radius = hermitRadius;
      this.bounty = 0;
      this.cargoDrop = 0;
      this.maxSpeed = 0;
      this.turnRate = 0;
      this.accel = 0;
      this.state.speed = 0;
      this.state.hasEcm = false;
      this.armed = false;
      this.bindTransform(position);
      return;
    }
    if (role === 'asteroid') {
      const radius = 25 + (variantSeed % 45);
      this.object = buildAsteroid(radius, variantSeed * 131 + 7, 0x9a9a8a);
      this.radius = radius;
      this.bounty = 4;
      this.cargoDrop = 0;
      this.maxSpeed = 0;
      this.turnRate = 0;
      this.accel = 0;
      this.state.speed = 0;
      this.state.hasEcm = false;
      this.armed = false;
    } else {
      const spec = rostered!;
      // The hull and its size come from the DESIGN, not from the roster row —
      // `ships/registry.ts` is the only way to either, so two roster rows of the
      // same design cannot disagree about what it looks like or how big it is.
      const hull = registeredHull(this.designId);
      this.object = buildShip(hull.def!, spec.color);
      this.radius = hull.targetRadius;
      this.bounty = spec.bounty;
      this.cargoDrop = spec.cargoDrop ?? 0;
      this.maxSpeed = spec.maxSpeed;
      this.turnRate = spec.turnRate;
      this.accel = shipAccel(spec);
      this.state.speed = spec.maxSpeed * 0.5;
      this.state.missiles = spec.missiles ?? 0;
      this.state.hasEcm = random() < (spec.ecmChance ?? 0);
      this.armed = spec.armed ?? false;
    }
    randomDirection(this.state.packOffset).multiplyScalar(250 + random() * 500);
    // WHICH WAY THIS ONE FIGHTS, decided by a shake of the dice on warp-in —
    // Chris's own example of the rule that makes something state. A rock has no
    // attack run to fly and never reaches `attack()`, so it does not draw: the
    // roll is taken here, last, so that adding it moved every existing draw in
    // the constructor by nothing.
    if (role !== 'asteroid') {
      this.state.tactic = chooseTactic(this.tacticHull, 1, 'spawn', random());
    }
    this.bindTransform(position);
  }

  /**
   * What `constants/tactics.ts` needs to know about this hull: how big it is, how fast it
   * goes, how hard it turns.
   *
   * A getter over the three fields rather than a stored object, because none of
   * them can change — the ship is the hull it was built as — and a second copy
   * of an immutable fact is a second copy to keep in step.
   */
  private get tacticHull(): TacticHull {
    return { radius: this.radius, maxSpeed: this.maxSpeed, turnRate: this.turnRate };
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

  /** @returns a fire event if this ship shot at something this frame */
  update(
    dt: number,
    player: PlayerRef,
    view: WorldView,
  ): FireEvent | null {
    if (!this.state.alive) return null;
    // Before anything decides: elapsed time does not care what the ship is
    // doing, and the roles that return early below are exactly the ones every
    // clock in here gives a rate of 0 to anyway. See `tickClocks`.
    this.tickClocks(dt);

    const { station, fleet, playerLegal, brains } = view;

    if (this.role === 'asteroid' || this.role === 'hermit') {
      this.object.rotateOnAxis(this.tumbleAxis, dt * (this.role === 'hermit' ? 0.06 : 0.4));
      return null;
    }
    if (this.role === 'generation') {
      // ancient, blind, and utterly indifferent to you
      this.object.rotateOnAxis(this.tumbleAxis, dt * 0.02);
      this.state.speed = this.maxSpeed;
      this.advance(dt);
      return null;
    }
    if (this.state.inert) {
      this.object.rotateOnAxis(this.tumbleAxis, dt * 0.2);
      return null;
    }

    const toPlayer = this.tmpDir.copy(player.position).sub(this.object.position);
    const distPlayer = toPlayer.length();

    const aggressiveToPlayer =
      isHostileToPlayer(this, playerLegal) && distPlayer < PLAYER_INTEREST_RANGE;

    if (aggressiveToPlayer) {
      // Which brain, and the two numbers that come with it — see brains.ts.
      const choice = this.role === 'pirate'
        ? pirateBrainFor(this.state.threatTier, this.state.organised, brains) : null;
      const shot = choice && distPlayer >= choice.guard
        // The RAW speed: the clamp the game used to apply here
        // (TARGET_SPEED_FLOOR) died with the target-speed slot it protected
        // (docs/TODO/91) — the encoder reads speed only through the closing
        // rate now, which the trainer always fed honestly.
        ? this.brainFly(choice.brain, dt,
          player.position, player.quaternion,
          player.speed,
          distPlayer, 'player',
          choice.pack ? fleet : null)
        // Inside knife range the scripted break-off takes over the FLYING — and
        // only the flying, since attack() keeps its gun. See break-off.ts.
        : this.attack(dt, player.position, distPlayer, true, undefined, view.fleet,
          this.velocityOf(player.quaternion, player.speed));
      return this.chooseWeapon(shot, distPlayer, player.position,
        view.missileInbound);
    }

    if (this.npcTarget && this.npcTarget.state.alive) {
      const d = this.npcTarget.object.position.distanceTo(this.object.position);
      if (d < 7000) {
        return this.attack(
          dt, this.npcTarget.object.position, d, false, this.npcTarget, view.fleet,
          this.velocityOf(this.npcTarget.object.quaternion, this.npcTarget.state.speed));
      }
      this.npcTarget = null;
    }

    if (this.state.fleeing) {
      // armed traders turn and fight with the trained Jameson defence brain
      const defence = this.armed ? defenceBrain(brains) : null;
      if (defence) {
        if (this.state.provokedByPlayer && distPlayer < 6000) {
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
        this.tmpDir.copy(this.object.position).multiplyScalar(2).sub(this.state.fleeFrom), dt);
      this.state.speed = approach(this.state.speed, this.maxSpeed, 150 * dt);
      this.advance(dt);
      return null;
    }

    if (this.role === 'trader') {
      this.updateTrader(dt, view);
      this.advance(dt);
      return null;
    }

    // amble between waypoints near home
    this.state.waypointTimer -= dt;
    if (this.state.waypointTimer <= 0) {
      this.state.waypointTimer = 12 + random() * 15;
      this.state.waypoint
        .copy(station.position)
        .add(randomDirection(new THREE.Vector3()).multiplyScalar(800 + random() * 2500));
    }
    this.steerToward(this.state.waypoint, dt);
    const arrived = this.object.position.distanceTo(this.state.waypoint) < 200;
    this.state.speed = approach(this.state.speed, arrived ? 0 : this.maxSpeed * 0.4, 80 * dt);
    this.advance(dt);
    return null;
  }

  /** Traders arrive from deep space, potter about the station, then leave. */
  private updateTrader(dt: number, view: WorldView): void {
    const { station } = view;
    const home = station.position;
    switch (this.state.traderPhase) {
      case 'arriving': {
        this.steerToward(home, dt);
        this.state.speed = approach(this.state.speed, this.maxSpeed * 0.85, 90 * dt);
        if (this.object.position.distanceTo(home) < 900) {
          this.state.traderPhase = 'trading';
        }
        break;
      }
      case 'trading': {
        this.state.tradeTimer -= dt;
        this.state.waypointTimer -= dt;
        if (this.state.waypointTimer <= 0) {
          this.state.waypointTimer = 10 + random() * 12;
          // Work the lane between station and planet. The planet sits at the
          // world origin, so scaling `home` walks that line — but the station
          // orbits at 2.4 planet radii (world/system-scene.ts), which puts the
          // planet surface at 1/2.4 = 0.42 of the way out. A minimum of 0.35
          // aimed traders *inside the planet*, and with nothing stopping them
          // they flew through it. 0.62 keeps the waypoint clear even when the
          // random offset below happens to point straight down.
          this.state.waypoint
            .copy(station.position)
            .multiplyScalar(0.62 + random() * 0.38)
            .add(randomDirection(new THREE.Vector3()).multiplyScalar(600 + random() * 1200));
        }
        this.steerToward(this.state.waypoint, dt);
        this.state.speed = approach(this.state.speed, this.maxSpeed * 0.35, 60 * dt);
        if (this.state.tradeTimer <= 0) {
          // about half put in at the station; the rest jump out from here
          if (this.state.docksHere) {
            this.state.traderPhase = 'docking';
          } else {
            this.state.traderPhase = 'departing';
            this.state.waypoint
              .copy(station.position)
              .add(randomDirection(new THREE.Vector3()).multiplyScalar(30000));
          }
        }
        break;
      }
      case 'docking': {
        // Shared with the player's docking computer — see game/docking.ts.
        const plan = planDocking(
          this.object.position, station, view.dockZ, this.maxSpeed, this.state.dockPlan);
        this.state.docking = plan.phase === 'run';
        this.state.speed = approach(this.state.speed, plan.speed, 90 * dt);
        // orientation from the plan's heading AND the station's up, so the
        // wings roll into line with the slot as it spins
        this.tmpMat.lookAt(ZERO, plan.heading, plan.up);
        this.tmpQ.setFromRotationMatrix(this.tmpMat);
        this.object.quaternion.rotateTowards(this.tmpQ, this.turnRate * 2.2 * dt);
        if (plan.arrived) {
          this.state.docked = true;
          this.state.wantsDespawn = true; // the Game plays the flash
        }
        break;
      }
      case 'departing': {
        this.steerToward(this.state.waypoint, dt);
        this.state.speed = approach(this.state.speed, this.maxSpeed, 90 * dt);
        if (this.object.position.distanceTo(this.state.waypoint) < 2500) {
          this.state.wantsDespawn = true; // jumps out — game plays the flash
        }
        break;
      }
    }
  }

  /**
   * Note that `a` is hunting this ship. Idempotent, so a caller never has to
   * ask whether the link is already there.
   *
   * Only PIRATES register: police and hunters set `npcTarget` and stop there.
   * That asymmetry is deliberate — a fleeing trader reads this list to decide
   * who to run from, and registering the law made a reloaded ship turn and
   * duel the police chasing it where before it just ran (world.ts).
   */
  addAttacker(a: NpcShip): void {
    if (!this.attackers.includes(a)) this.attackers.push(a);
  }

  /**
   * Drop the links that have gone stale: the invariant is `alive` and still
   * pointed at us. Order is preserved, because `nearestAttacker` takes the
   * first one and that is the one this ship has been running from.
   */
  pruneAttackers(): void {
    let n = 0;
    for (const a of this.attackers) {
      if (a.state.alive && a.npcTarget === this) this.attackers[n++] = a;
    }
    this.attackers.length = n;
  }

  /** Is `a` on our list? The read that replaces reaching into the array. */
  hasAttacker(a: NpcShip): boolean { return this.attackers.includes(a); }

  private nearestAttacker(): NpcShip | null {
    // whoever is hunting us — see addAttacker; the game keeps the list current
    return this.attackers.find((a) => a.state.alive) ?? null;
  }

  /**
   * The other pirates this ship is hunting with, in the shape the pack
   * observations want. Rebuilt per decision (10 Hz) rather than cached,
   * because ships die mid-fight and a stale mate would be observed as still
   * flying.
   *
   * The entries are pooled and refilled, not allocated: a gang of four
   * re-deciding at 10 Hz otherwise churns 40 objects a second for nothing.
   */
  private packmates(fleet: readonly NpcShip[]): ObservableMate[] {
    const out = NpcShip.mateView;
    const pool = NpcShip.matePool;
    let n = 0;
    for (const m of fleet) {
      if (m === this || m.role !== 'pirate' || !m.state.alive) continue;
      const slot = pool[n] ?? (pool[n] = {
        pos: m.object.position, quat: m.object.quaternion,
        hp: m.healthFraction, cls: { hp: 1 }, alive: true,
      });
      out[n] = slot;
      slot.pos = m.object.position;
      slot.quat = m.object.quaternion;
      // NORMALIZED at the boundary: the encoder divides `hp` by `cls.hp`, so a
      // fraction over 1 is the same observation the brains were fitted against
      // when both were raw hull points. Feeding it energy points would be too —
      // right up until a mate's max differed from the divisor.
      slot.hp = m.healthFraction;
      slot.cls.hp = 1;
      slot.alive = true;
      n += 1;
    }
    out.length = n;
    return out;
  }

  /** The slowest this ship may fly under power. See MIN_CRUISE_FRACTION. */
  private get speedFloor(): number {
    return this.role === 'pirate' || this.role === 'thargoid' || this.role === 'thargon'
      ? this.maxSpeed * MIN_CRUISE_FRACTION : 0;
  }

  /**
   * Fly with a trained policy: refresh the discrete control at 10 Hz, then
   * integrate it with the same ramp the player's ship uses.
   *
   * PUBLIC because this is the flight model the trainer optimises against.
   * `update()` picks the shipped brain from brains.ts, which is the last thing
   * a training episode wants — it is scoring a candidate genome. So the
   * scenario drives this directly with the genome and its own target, and
   * there is exactly one implementation of "how a brain-flown ship moves"
   * rather than the two that invariant 5 used to police.
   */
  brainFly(
    brain: Brain,
    dt: number,
    targetPos: THREE.Vector3,
    targetQuat: THREE.Quaternion,
    targetSpeed: number,
    dist: number,
    fireAt: 'player' | NpcShip | null,
    /**
     * The ships this one is hunting with, or null if it flies alone. Pass it
     * whenever it exists — `observeFor` decides whether this brain can read it.
     */
    fleet: readonly NpcShip[] | null = null,
  ): FireEvent | null {
    this.state.flownBy = 'brain';
    this.state.brainTimer -= dt;
    if (!this.brainControl || this.state.brainTimer <= 0) {
      this.state.brainTimer = DECISION_INTERVAL;
      const me = NpcShip.meView;
      const tv = NpcShip.targetView;
      writeView(me, this.object.position, this.object.quaternion);
      me.speed = this.state.speed;
      me.cls.maxSpeed = this.maxSpeed;
      me.cls.turnRate = this.turnRate;
      me.laserCooldown = this.state.fireCooldown;
      // HOW HURT IT IS. An NPC has ONE pool where the commander has three, so
      // its bank is both its overall condition and its energy — the same
      // fraction in both slots, because for this ship they are the same fact.
      // `cls.hp` is 1 because `healthFraction` is already normalized, which is
      // the same conversion `packmates()` makes for a mate's health.
      me.hp = this.healthFraction;
      me.cls.hp = 1;
      me.energy = this.healthFraction;
      // ...and nothing is homing on it. A hostile warhead in this game flies at
      // the COMMANDER (`Missile.target === null` is what makes it hostile), and
      // an NPC's own E.C.M. is `state.hasEcm`, rolled at spawn and applied by
      // ordnance.ts with nothing deciding. So a defence policy flown by an
      // armed trader never sees slot 16 set and its E.C.M. head is not read
      // here at all — the button belongs to the ship that has one to press
      // (docs/TODO/72).
      me.missileInbound = false;
      me.pitchRate = this.state.brainPitchRate;
      me.rollRate = this.state.brainRollRate;
      writeView(tv, targetPos, targetQuat);
      tv.speed = targetSpeed;
      // Which observation this brain wants is policy.ts's question — see
      // `observeFor`. All this file owes it is the pack, in the shape the wide
      // encoder reads, and nothing if this ship flies alone.
      this.brainControl = act(
        brain,
        observeFor(brain, me, tv, fleet ? this.packmates(fleet) : null, NpcShip.obsBuf),
        NpcShip.scratch,
      );
    }
    const c = this.brainControl;

    // integrate the discrete control, with the player's ramp rule and the
    // policies' own constants
    const maxPitch = this.turnRate * TURN.pitch;
    const maxRoll = this.turnRate * TURN.roll;
    const rampTo = (cur: number, target: number, active: boolean): number =>
      rampToward(cur, target, active, dt, BRAIN_RATE_RAMP, BRAIN_RATE_DECAY);
    this.state.brainPitchRate = rampTo(this.state.brainPitchRate, c.pitch * maxPitch, c.pitch !== 0);
    this.state.brainRollRate = rampTo(this.state.brainRollRate, c.roll * maxRoll, c.roll !== 0);
    if (c.throttle > 0) this.state.speed = Math.min(this.maxSpeed, this.state.speed + this.accel * dt);
    // A fighter that can stop dead becomes a turret — see MIN_CRUISE_FRACTION.
    if (c.throttle < 0) {
      this.state.speed = Math.max(this.speedFloor, this.state.speed - this.accel * dt);
    }
    if (this.state.brainRollRate !== 0) this.object.rotateZ(this.state.brainRollRate * dt);
    if (this.state.brainPitchRate !== 0) this.object.rotateX(this.state.brainPitchRate * dt);
    this.advance(dt);

    this.state.fireCooldown -= dt;
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
    // is now exactly what gunnery.ts's npcTriggerPull says it is, which makes
    // it a number that can be tuned instead of an emergent one.
    if (fireAt !== null) {
      const reload = npcTriggerPull(
        this.state.fireCooldown, this.facing(targetPos), dist, random);
      if (reload !== null) {
        this.state.fireCooldown = reload;
        return fireAt === 'player'
          ? { at: 'player', weapon: 'laser' }
          : { at: fireAt, weapon: 'laser' };
      }
    }
    return null;
  }

  /**
   * The pre-RL scripted chase, one step.
   *
   * PUBLIC for the same reason as brainFly: it is the baseline every training
   * table is read against ("scripted pirate"), and a baseline that is a second
   * implementation of the thing it baselines is worth nothing.
   *
   * It is also the path every police ship, bounty hunter, Thargoid and
   * knife-range pirate fires on, so it has ONE flight decision (close, or break
   * off — see break-off.ts) and then ONE gun, taken on every frame either way.
   */
  attack(
    dt: number,
    targetPos: THREE.Vector3,
    dist: number,
    isPlayer: boolean,
    npcTarget?: NpcShip,
    /**
     * The ships around this one, for keeping out of their way.
     *
     * Optional and defaulting to nothing, so every existing caller — the
     * trainer among them — keeps working and simply flies without wingman
     * avoidance, which is exactly right for a one-on-one episode.
     */
    fleet: readonly NpcShip[] = [],
    /**
     * How the target is MOVING, if the caller knows.
     *
     * Optional because the aim below degrades to what it always did without it
     * — a run laid on where the target is now — and because a stationary
     * fixture has nothing to say. Every live caller passes it: the aim point is
     * the thing docs/TODO/66 is about, and a pass laid on a stale position is
     * mostly spent before the hulls meet. See `leadTime`.
     */
    targetVel?: THREE.Vector3,
  ): FireEvent | null {
    // WHERE TO BE and WHETHER TO SHOOT are two decisions, and this used to be
    // one. Inside the break-off the ship turned away and `return null`ed, so
    // steering away and holding fire were the same statement — and every police
    // ship, bounty hunter, Thargoid and knife-range pirate went silent at the
    // range a human actually fights at. See break-off.ts, which owns the
    // distance and the argument.
    // An attack run has three parts and this used to have two. The missing one
    // was the pass itself: inside BREAK_OFF_RANGE the ship steered to
    // `own * 2 - target` — directly away, a 180 — which no hull in the roster
    // can complete in the room 220 units leaves, so it flew through instead.
    // break-off.ts has the arithmetic and Chris's account of flying it.
    this.state.flownBy = 'scripted';
    // `underFire` is NOT decayed here. It used to be, and this was the only
    // place it decayed, so it was a decay for a scripted ship and a latch for
    // every brain-flown one — see `tickClocks` (docs/TODO/77).
    // WHICH WAY IT IS FIGHTING, before anything reads the numbers that follow
    // from it. `tacticSwitchReason` is roll-free on purpose — a switch that
    // drew from the stream to decide whether to switch would burn a number per
    // hostile per frame — so the dice come out only when the answer is yes.
    const tactic = TACTICS[this.updateTactic(dt)];
    const wasPhase = this.state.attackPhase;
    this.state.attackPhase = nextAttackPhase(
      this.state.attackPhase, dist, this.state.underFire > 0, this.state.extendRange);
    if (this.state.attackPhase === 'extending' && wasPhase !== 'extending') {
      // A NEW run, so re-roll how far this one goes and which side the next
      // pass steps off to. Rolling here rather than at spawn is the difference
      // between a gang that destaggers and a gang of individually predictable
      // ships — see break-off.ts.
      this.state.extendRange = rollExtendRange(random());
      this.state.passSide = random() < 0.5 ? -1 : 1;
      // Reaching `extending` is what it MEANS to have completed a pass: the
      // ship closed, went through, and came out the other side.
      this.state.passesMade += 1;
    }
    if (this.state.attackPhase === 'passing') {
      // GO THROUGH. No steering toward or away from the TARGET: the heading
      // that got here is already the one that carries it past, and turning now
      // is what caused the collision. Throttle up so the pass is short and it
      // is not a sitting target on the way out. The gun below still fires.
      //
      // The one exception is a WINGMAN about to be hit, and it is the reason
      // separation.ts exists: a phase that steers for nothing is blind to
      // everything, and several ships converging on one target arrive in the
      // same volume at the same moment by construction. Measured, the only
      // ship-on-ship collision in 40 eight-ship engagements had both of them
      // here. The nudge is scaled by urgency, so it is nothing at all until a
      // mate is genuinely close and the committed line survives.
      const near = separationFrom(this.object.position, this.matePositions(fleet), this.tmpAway);
      if (near > 0) {
        this.steerToward(
          this.tmpDir.copy(this.object.position)
            .addScaledVector(this.tmpAway, SEPARATION_PUSH * near), dt);
      }
      this.state.speed = approach(this.state.speed, this.maxSpeed, this.accel * dt);
    } else if (this.state.attackPhase === 'extending') {
      // Past it and opening the range — ON A CURVE. This phase used to steer
      // for nothing at all, which meant the whole 180 had to happen in the
      // closing leg and short runs were unflyable. extend-arc.ts has the rule
      // and the arithmetic; what is here is the geometry it takes as numbers.
      //
      // The heading asked for is `psi` off the OUTWARD radial: cos(psi) along
      // the way out, sin(psi) along `passOffset` — the same side vector the
      // closing leg aims off, which during a run-out is the lateral part of the
      // heading the pass left the ship with. So the curve continues the pass
      // rather than arguing with it, it bends toward the side the next run-in
      // is going to want instead of across it, and it is one rule doing both
      // jobs rather than two that have to agree.
      //
      // It is taken FIRST because it borrows the scratch `out` is about to use.
      // And it is `passOffset` rather than the raw heading because that one has
      // a tie-break for a ship with no side yet: a plane derived from a heading
      // collapses the moment the ship points dead radial, which is exactly what
      // the ramp asks for at the start of a run-out. Measured with the raw
      // heading, the median error at the turn-back was 179 degrees: no arc.
      const side = this.passOffset(targetPos);
      const out = this.tmpDir2.copy(this.object.position).sub(targetPos);
      const outLen = out.length();
      if (outLen > 1e-4) {
        out.divideScalar(outLen);
        const psi = extendArcAngle(dist, this.state.extendRange, tactic.arcAngle);
        const arc = this.tmpLead.copy(this.object.position)
          .addScaledVector(out, Math.cos(psi) * dist)
          .addScaledVector(side, Math.sin(psi) * dist);
        // A steered phase can see its wingmen, and this one could not before it
        // was steered: five ships curving back toward one target converge by
        // construction. Same push the closing leg uses — separation.ts.
        const crowd = separationFrom(this.object.position, this.matePositions(fleet), this.tmpAway);
        if (crowd > 0) arc.addScaledVector(this.tmpAway, SEPARATION_PUSH * crowd);
        this.steerToward(arc, dt);
      }
      this.state.speed = approach(this.state.speed, this.maxSpeed, this.accel * dt);
    } else {
      // AIM BESIDE WHERE IT WILL BE, not beside where it is. Two rules, and
      // they compose: the offset is what stops the run being aimed at the hull
      // (104 points of contact damage an episode when it was — see
      // PASS_MISS_DISTANCE), and the lead is what stops the offset being spent
      // on the target's own travel before the two ships meet.
      //
      // The offset is perpendicular to the run and lies in the attacker's own
      // roll plane, so it is a sidestep from the pilot's point of view rather
      // than a world-axis one, and it turns with the ship instead of swapping
      // sides as the geometry crosses an axis. It is taken against the
      // PREDICTED point for the same reason the aim is: perpendicular to the
      // line the ship is actually going to fly.
      //
      // ONE closing speed feeds both halves — how far ahead to aim, and how
      // wide — because they are two answers to the same question and reading it
      // twice is how one rule grows two homes.
      const closing = this.closingRate(targetPos, targetVel, dist);
      const mark = this.tmpLead.copy(targetPos);
      if (targetVel) mark.addScaledVector(targetVel, leadTime(dist, closing));
      // pack ships approach offset bearings until close, then converge
      const aim = dist > this.state.extendRange
        ? this.tmpDir.copy(targetPos).add(this.state.packOffset)
        : this.tmpDir.copy(mark).addScaledVector(
          this.passOffset(mark),
          passMissDistance(dist, closing, this.state.speed, tactic.missDistance));
      // ...and bend that line away from any wingman in the way, so a gang picks
      // different runs in rather than discovering each other at the merge.
      // Prevention; the nudge in `passing` above is the cure.
      const crowd = separationFrom(this.object.position, this.matePositions(fleet), this.tmpAway);
      if (crowd > 0) aim.addScaledVector(this.tmpAway, SEPARATION_PUSH * crowd);
      this.steerToward(aim, dt);
      // Throttle off the HEADING ERROR, not off the range. A ship pointed at
      // what it is attacking runs in flat out; one that has to come round —
      // the turn-in at EXTEND_RANGE is exactly that — backs off, which halves
      // its turn radius and slows the rate it has to track. break-off.ts has
      // the arithmetic, including why this buys no extra rad/s.
      //
      // The angle is to `targetPos` and NOT to `aim`, for two reasons. It is
      // the honest question — how far off is my nose from the thing I am
      // attacking — and `aim` is `this.tmpDir`, which `facing()` also uses as
      // its scratch, so passing it in would zero the very vector being read.
      this.state.speed = approach(
        this.state.speed,
        this.maxSpeed * closingThrottle(this.facing(targetPos), tactic.throttleFloor),
        this.accel * dt);
    }
    this.advance(dt);
    this.state.fireCooldown -= dt;
    // The SAME gun brainFly uses — and now literally the same call, so it
    // cannot be a second one again. It was: a 0.22 gate and a 1.4 + rand*1.8
    // cooldown (mean 2.30s against 1.30s), i.e. 77% slower through a tighter
    // aperture — and this is the path every police ship, bounty hunter,
    // thargoid and knife-range pirate actually fires on, so most of the
    // hostiles in the game used numbers the trainer never saw. The parity test
    // missed it because it reads the FIRST match in the file and brainFly
    // happens to come first.
    //
    // Thargoids keep their edge as a multiplier on the shared cooldown rather
    // than as a separate literal.
    const reload = npcTriggerPull(
      this.state.fireCooldown, this.facing(targetPos), dist, random,
      this.role === 'thargoid' ? THARGOID_FIRE_RATE : 1);
    if (reload !== null) {
      this.state.fireCooldown = reload;
      // It got one away, so whatever it is doing is working. The sleeper's
      // clock is reset by the TRIGGER rather than by the hit, because "did my
      // plan give me a shot" is the question, and whether the bolt connected is
      // gunnery.ts's coin and not this ship's doing.
      this.state.dryFor = 0;
      return isPlayer
        ? { at: 'player', weapon: 'laser' }
        : { at: npcTarget!, weapon: 'laser' };
    }
    return null;
  }

  /**
   * Advance the tactic clocks and, if something happened that a pilot would act
   * on, take a new tactic. @returns the one to fly this step.
   *
   * The DECISION is `tactic-choice.ts`'s and all of it: this reads the ship's own
   * fields into a situation, asks whether there is a reason, and applies the
   * answer. A module decides and reports; the ship applies — the same bargain
   * `attack()` has with `break-off.ts` and `gunnery.ts`.
   */
  private updateTactic(dt: number): TacticId {
    this.state.tacticClock += dt;
    this.state.dryFor += dt;
    const why = tacticSwitchReason({
      tactic: this.state.tactic,
      health: this.healthFraction,
      underFire: this.state.underFire,
      sinceChosen: this.state.tacticClock,
      sinceShot: this.state.dryFor,
    });
    if (why !== null) {
      this.state.tactic = chooseTactic(
        this.tacticHull, this.healthFraction, why, random(), this.state.tactic);
      this.state.tacticClock = 0;
      // A new plan starts with a clean sleeper clock, or a ship that switched
      // BECAUSE its guns were cold would be judged on the old tactic's silence
      // and switch again on the next frame it was allowed to.
      this.state.dryFor = 0;
    }
    return this.state.tactic;
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
   *
   * PUBLIC, and taking a scalar rather than a `WorldView`, for the same reason
   * `brainFly`, `attack` and `regenerate` are public: `update()` runs it for
   * the live sky, and a training episode drives the flight directly, so the
   * episode owes the ship this call too. It was private and view-shaped, and the
   * consequence was that **no pirate in a training episode had ever decided to
   * launch** — 1,374 laser requests and 0 missile requests across 200 armed,
   * hurt pirates (docs/TODO/62). `missileInbound` is the one fact left that is
   * not on the ship: whether the air is already occupied. It was two, and the
   * other was how many of the gang were gone — see `npcMissileEmergency` for
   * why that reason is deleted rather than repaired (docs/TODO/75). This is the
   * seam docs/TODO/64 widened; what it REPORTS is resolved by
   * `fire-resolution.ts`, the one home both worlds call.
   *
   * IT DECIDES; IT DOES NOT KEEP TIME. This used to tick `missileReload` itself
   * and carry a "CALL IT ONCE PER FRAME" warning, which the one caller that
   * matters did not honour: `update()` reaches it only down the
   * `aggressiveToPlayer` branch, so a rack stopped reloading the moment the
   * pirate stopped being hostile-and-in-range and the gap between two launches
   * measured time spent hunting rather than time. The clock is `tickClocks`
   * now, which every frame runs (docs/TODO/77), and there is no `dt` here to
   * tempt a second one. Asking twice in a frame is now merely wasteful rather
   * than wrong.
   */
  chooseWeapon(
    shot: FireEvent | null, dist: number, targetPos: THREE.Vector3,
    missileInbound: boolean,
  ): FireEvent | null {
    if (this.state.missiles <= 0) return shot;
    if (this.state.missileReload > 0) return shot;
    // A FRACTION, not points: `npcMissileLastStand` asks "how much of this
    // hull is left", and `healthFraction` is the one place that division
    // happens. It falls back to 1 (untouched) rather than 0 for a bankless
    // ship, because a divide-by-zero guard that reported "nearly dead" would
    // make it empty its rack.
    // ONE IN THE AIR AT A TIME, gang-wide. Checked before the reasons so a ship
    // that would have launched keeps its missile AND fires its gun — the gang
    // loses nothing except the ability to saturate a countermeasure that only
    // gets one press.
    if (missileInbound) return shot;
    if (npcMissileEmergency(
      this.healthFraction, this.state.passesMade, dist, this.facing(targetPos),
    )) {
      this.state.missileReload = MISSILE_RELOAD;
      return { at: 'player', weapon: 'missile' };
    }
    return shot;
  }

  private advance(dt: number): void {
    this.tmpDir.set(0, 0, -1).applyQuaternion(this.object.quaternion);
    this.object.position.addScaledVector(this.tmpDir, this.state.speed * dt);
  }

  /**
   * How something with this attitude and this speed is travelling.
   *
   * Nose and thrust are the same direction for everything that flies in this
   * game — `advance()` above is the same two lines, and the commander's
   * `update()` is a third — so a target's velocity is not a thing anybody has
   * to store. Written into this ship's own scratch and handed straight to
   * `attack()`, which is the only caller.
   */
  private velocityOf(quat: THREE.Quaternion, speed: number): THREE.Vector3 {
    return this.tmpVel.set(0, 0, -1).applyQuaternion(quat).multiplyScalar(speed);
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

  /**
   * Where this ship's neighbours are, as a reused array.
   *
   * Everything solid and alive except itself and the thing it is attacking:
   * a hull is a hull, so a trader minding its own business is as much of an
   * obstacle as a wingman. The array is an instance field rather than a fresh
   * one because this runs per ship per frame.
   *
   * THE TARGET IS NOT AN OBSTACLE. That is what the line above always claimed
   * and what the code did not do until docs/TODO/76 found the two disagreeing,
   * so it is a behaviour change and it is argued rather than assumed.
   *
   * A pirate attacking the PLAYER never saw the difference either way — the
   * commander is not in the fleet. It is a police ship on a pirate, or a pirate
   * on a trader, where the target IS a fleet member, and only ever inside
   * `passing`: `SEPARATION_RANGE` (200) is inside `BREAK_OFF_RANGE` (220), so a
   * ship is already committed to the pass before its target can be near enough
   * to push it. Holding the committed line THROUGH the merge is that phase's
   * whole job, and turning away in it is the 180 break-off.ts deleted.
   *
   * Two things measured it, over 160 seeded engagements of each pairing against
   * a target that holds still, target-in-the-list -> target-out-of-it:
   *
   *   - IT WAS DELETING THE `ram` TACTIC. `constants/tactics.ts` has a doomed ship aim at
   *     the hull rather than beside it (`missDistance: 0`, `aimsToHit: true`),
   *     and `tactic-choice.ts` goes to the trouble of exempting it from the
   *     clearance gate. Pinned to `ram`, a hunter connected 5 times and 0 times
   *     in 160 engagements; without the push it connects 13.3 and 11.0 times
   *     per engagement. One file exempted the tactic and this one vetoed it.
   *   - IT WAS THE SECOND HOME OF A DISTANCE. How far a run passes what it is
   *     attacking is `pass-aim.ts`'s `passMissDistance`, swept; separation.ts is
   *     "keeping wingmen out of each other's way" by its own title. With both
   *     deciding, the delivered merge sat at a 149.7/149.6 median against the
   *     110 the aim asked for; with one, 115.2/113.5.
   *
   * The price is contact, and it is small: 0 -> 0.031 and 0 -> 0.125 per
   * engagement in a sky flying the whole tactic vocabulary, against the 0.33 an
   * episode that constants/tactics.ts already measured and accepted for the commander.
   */
  private matePositions(fleet: readonly NpcShip[]): readonly THREE.Vector3[] {
    const out = this.mateSlots;
    out.length = 0;
    for (const m of fleet) {
      if (m === this || m === this.npcTarget || !m.state.alive || m.state.inert) continue;
      out.push(m.object.position);
    }
    return out;
  }

  /**
   * How fast the RANGE to the target is shutting.
   *
   * Our own speed, less however much of the target's motion is carrying it away
   * down the same line — so a target crossing the nose contributes nothing to
   * this and everything to where it will be, which is the case the old aim
   * point got worst. It is the one number the attack run's aim is built from:
   * `leadTime` turns it into when the two meet, `passMissDistance` into how far
   * that leaves to step aside in.
   *
   * With no velocity from the caller, and at zero range where there is no line
   * of sight to resolve along, it is our own speed — which is what a target
   * standing still gives, so the aim degrades to exactly the one that shipped.
   */
  private closingRate(
    targetPos: THREE.Vector3, targetVel: THREE.Vector3 | undefined, dist: number,
  ): number {
    if (!targetVel || dist < 1e-3) return this.state.speed;
    const to = this.tmpDir2.copy(targetPos).sub(this.object.position).divideScalar(dist);
    return this.state.speed - targetVel.dot(to);
  }

  /**
   * A unit vector to one side of the run in — THE SIDE THE SHIP IS ALREADY
   * STEPPING TO.
   *
   * It is the part of the ship's own heading that is not along the line of
   * sight, normalized: "keep going the way you are going, only more so." Which
   * is the whole rule, and it is a correction rather than a preference.
   *
   * IT USED TO BE THE SHIP'S LOCAL +X, deprojected the same way, on the
   * reasoning that an offset in the attacker's own roll plane turns WITH the
   * ship instead of flipping sides as the world geometry crosses an axis. That
   * is true and it is not the problem. The problem is that +X is 90 degrees off
   * the nose, so the aim point sits to one side of the ship REGARDLESS of which
   * side of the target the ship is actually passing — and half the time that is
   * the far side, which the ship can only reach by flying through the target it
   * is trying to miss.
   *
   * Worse, it runs away. Steering toward a point defined by the ship's own +X
   * rotates +X, which moves the point, so the ship chases its own right hand
   * around: measured on the run-in, the angle between the nose and the aim
   * point sat at 25-60 degrees for seconds at a stretch while the ship turned
   * at its cap — an equilibrium, not a convergence. The miss distance a pass
   * delivered was therefore whatever fell out of that chase, which is why
   * docs/TODO/66 measured an intended 110 delivered as 75, and why the tail of
   * it was inside the hull: over 60 one-on-one episodes, 29% of a Python's
   * merges closed inside 70 units.
   *
   * Taking the side off the HEADING makes the same loop negative feedback. The
   * demanded angle is `atan(m/d)` from the line of sight on the side the ship
   * is already on, so a ship wide of it turns in and a ship inside it turns
   * out, and neither has to cross the target to get there. Measured over the
   * same 60 episodes, with everything else identical: not one merge inside 70
   * units on any hull in the roster, contact per episode 0.10 -> 0.00
   * one-on-one and 0.018 -> 0.007 per merge in a five-ship gang.
   *
   * `passSide` is the tie-break and only the tie-break: a ship pointed dead at
   * its target has no side yet, and that is exactly when a coin has to be
   * tossed. It falls back to the old local-+X construction for it, so the roll
   * that varies a gang's runs still varies them.
   *
   * Still derived rather than stored, so nothing new has to be snapshotted for
   * a reload to fly the same run.
   */
  private passOffset(targetPos: THREE.Vector3): THREE.Vector3 {
    const to = this.tmpDir2.copy(targetPos).sub(this.object.position).normalize();
    const side = this.tmpSide.set(0, 0, -1).applyQuaternion(this.object.quaternion);
    side.addScaledVector(to, -side.dot(to));
    const len = side.length();
    // 1e-3 rather than 1e-4: this is "the ship has no side yet", not "this
    // vector would divide badly", and a heading a thousandth off the line of
    // sight is dead on for the purposes of choosing one.
    if (len > 1e-3) return side.divideScalar(len);
    const tie = this.tmpSide.set(1, 0, 0).applyQuaternion(this.object.quaternion);
    tie.addScaledVector(to, -tie.dot(to));
    const tieLen = tie.length();
    return tieLen > 1e-4 ? tie.multiplyScalar(this.state.passSide / tieLen) : tie.set(0, 0, 0);
  }

  /**
   * Angle (radians) between our nose and the direction to a point.
   *
   * Allocation-free: it used to `point.clone()`, which is a Vector3 per call
   * on a path the firing gate takes every frame for every ship — and now, per
   * ship-step of every training episode.
   */
  facing(point: THREE.Vector3): number {
    const forward = this.tmpDir.set(0, 0, -1).applyQuaternion(this.object.quaternion);
    const to = this.tmpDir2.copy(point).sub(this.object.position).normalize();
    return forward.angleTo(to);
  }

  private steerToward(point: THREE.Vector3, dt: number): void {
    steerQuatToward(
      this.object.quaternion,
      this.tmpDir.copy(point).sub(this.object.position),
      this.turnRate * dt);
  }

  /**
   * Point the nose at a place, ignoring the turn rate.
   *
   * Only for placing a ship: the training scenarios spawn a pirate and want it
   * roughly facing its prey before the first frame. Flight uses steerToward.
   */
  faceToward(point: THREE.Vector3): void {
    steerQuatToward(
      this.object.quaternion,
      this.tmpDir.copy(point).sub(this.object.position),
      Math.PI);
  }

  /**
   * How much of its bank is left, 0..1.
   *
   * THE NORMALIZED BOUNDARY, and the only one. Runtime combat stores whole
   * source energy points; the HUD's target bar, the AI's health observation and
   * the missile last-stand rule all want a fraction, and every one of them
   * comes through here rather than dividing by a max it fetched itself.
   */
  get healthFraction(): number {
    return this.maxEnergy > 0 ? this.state.energy / this.maxEnergy : 1;
  }

  /**
   * A registered player-laser hit of `hit` strength lands.
   *
   * The ship works out what that costs IT — immunity, the Constrictor's
   * halving and its own per-hit defence are all inside its policy — so the gun
   * never has to know what it is shooting at. @returns true if it was destroyed.
   */
  takeLaserHit(hit: number, from?: THREE.Vector3, byPlayer = true): boolean {
    return this.takeDamage(playerLaserDamage(this.energyPolicy, hit), from, byPlayer);
  }

  /**
   * @param points source energy points, minted by whichever module owns the
   * rule: `playerLaserDamage` and `npcCrossfireDamage` (npc-energy.ts) for the
   * two guns, `npcImpactDamage` (impact-damage.ts) for a ram, a warhead or the
   * energy bomb. The type is branded, so a number from any other scale — or a
   * bare literal — will not compile.
   * @returns true if the ship was destroyed.
   */
  takeDamage(points: NpcEnergyPoints, from?: THREE.Vector3, byPlayer = false): boolean {
    this.state.provoked = true;
    // Being hit is being hit, whatever hit it — this is the one place every
    // source funnels through (damage-dealt.ts routes lasers, ordnance and rams
    // here), so the attack run reacts to all of them and not just to gunfire.
    this.state.underFire = UNDER_FIRE_SECONDS;
    if (byPlayer) this.state.provokedByPlayer = true;
    if (from && this.role === 'trader') {
      this.state.fleeFrom.copy(from);
      this.state.fleeing = true;
    }
    this.state.energy = energyAfterDamage(this.state.energy, points);
    if (isDestroyed(this.state.energy) && this.state.alive) {
      this.state.alive = false;
      return true;
    }
    return false;
  }

  /**
   * EVERYTHING THAT RUNS ON ELAPSED TIME, whatever the ship is doing.
   *
   * One home for the clocks, because each of them used to tick inside the one
   * branch that happened to read it — which quietly redefined "seconds since"
   * as "seconds spent doing a particular thing":
   *
   * - `underFire` ticked only in `attack()`. For anything flying a trained
   *   policy it was therefore a LATCH, not the decay `UNDER_FIRE_SECONDS`
   *   documents: one hit and it stayed at 1.2 for the rest of the ship's life.
   *   The armed trader flying the defence brain never calls `attack()` at all,
   *   so it read `evading` forever and handed a permanently-set flag to
   *   `nextAttackPhase` and `tacticSwitchReason` whenever it did hand over
   *   (docs/TODO/77).
   * - `missileReload` ticked only inside `chooseWeapon`, which `update()` calls
   *   only when the ship is hostile and in range. Same defect, smaller blast
   *   radius: a rack froze mid-reload whenever the pirate was doing anything
   *   else, so the 2s gap between launches was 2s of hunting.
   * - `regenerate` was already correct, and is here rather than beside the
   *   others at the call site because a caller that pays one of these debts and
   *   forgets another is exactly what this method exists to prevent.
   *
   * PUBLIC, and the one call a training episode owes the ship per frame — see
   * `brainFly` for why an episode drives the ship directly. `Episode.step`
   * calls this where it used to call `regenerate` alone.
   */
  tickClocks(dt: number): void {
    this.regenerate(dt);
    this.state.underFire = Math.max(0, this.state.underFire - dt);
    this.state.missileReload = Math.max(0, this.state.missileReload - dt);
  }

  /**
   * Recover from elapsed simulation time. Stations, rocks and the derelict get
   * a rate of 0 and never move.
   *
   * PUBLIC because the Elite-A energy oracle measures the recharge on its own
   * (test/elite-a-live-combat.test.ts); everything that FLIES reaches it
   * through `tickClocks`, which is the one per-frame entry point.
   */
  regenerate(dt: number): void {
    const next = regeneratedEnergy(
      { energy: this.state.energy, carryTicks: this.state.regenCarry },
      this.energyPolicy, dt);
    this.state.energy = next.energy;
    this.state.regenCarry = next.carryTicks;
  }
}

function approach(current: number, target: number, step: number): number {
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}
