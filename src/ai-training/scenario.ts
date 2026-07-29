// Combat scenarios shared by the trainer (batch) and the viewer (real time).
//
// AN EPISODE IS THE REAL GAME, WITH THE SKY EMPTIED.
//
// The pirates are `NpcShip`s flying `NpcShip.brainFly`. The target is a
// `PlayerShip` flown from a `FlightDemand`, exactly as the human's hands and
// the combat computer fly it. The guns are `game/gunnery.ts`, the ramming is
// `game/collisions.ts`, the dice are `game/rng.ts`. There is no second physics
// here at all — this file chooses who fights whom, and scores it.
//
// It used to be a second physics. `ai-training/core.ts` carried its own vector
// and quaternion maths, its own PRNG, a `CLASSES` table mirroring
// ship-specs.ts, `LASER`/`NPC_GUN` mirroring gunnery.ts, `COLLISION` mirroring
// collisions.ts and a `stepShip` mirroring player.ts and npc.ts — about 450
// lines of the game, written again, kept in step by hand under invariant 2.
// It cost six training rounds to an NPC gun firing 5.4x too fast, a player
// model accelerating at 120 against the real 220, and a turn decay that
// differed by 35% between the two at their respective step rates. Every one of
// those was invisible while the two files agreed with THEMSELVES.
//
// What is deliberately KEPT is the methodology, because that part was good:
// the win conditions, the escape range, the engagement and tail-time shaping,
// the opponent pool and the four fitness functions are unchanged.
//
// Erasable-TypeScript only — runs in Node via --experimental-strip-types.

import * as THREE from 'three';

import { PlayerShip, PLAYER_FLIGHT, rampToward, type FlightDemand } from '../player.ts';
import {
  NpcShip, steerQuatToward,
  BRAIN_RATE_RAMP, BRAIN_RATE_DECAY,
  NPC_COOLDOWN_LO, NPC_COOLDOWN_SPREAD, NPC_FIRE_GATE,
} from '../game/npc.ts';
import { SPECS, TURN, shipAccel, type NpcSpec } from '../game/ship-specs.ts';
import {
  LASERS, LASER_RANGE, LASER_CUTOUT, hitCone, npcHitChance, npcShotDamage,
} from '../game/gunnery.ts';
import { RAM_DAMAGE, npcVsNpcs, playerVsNpcs } from '../game/collisions.ts';
import { LASER_COOL_RATE } from '../game/systems.ts';
import { seedWorld, random, randomDirection } from '../game/rng.ts';
import {
  observe, act, makeScratch,
  PACK_OBS_SIZE, PACK_WIDE_OBS_SIZE, type Brain, type Control, type ObservableShip,
} from './policy.ts';

/** One ship in an episode, however it is flown. */
export interface EpisodeShip {
  /** live transform — for a pirate these ARE the mesh's own vectors */
  readonly pos: THREE.Vector3;
  readonly quat: THREE.Quaternion;
  readonly radius: number;
  /** hull name, for the viewer's model choice and the HUD */
  readonly name: string;
  readonly speed: number;
  hp: number;
  alive: boolean;
  /** telemetry the fitness functions and the tournament read */
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  damageTaken: number;
  /** unit vector along the nose, written into `out` */
  forward(out: THREE.Vector3): THREE.Vector3;
}

export interface ShotEvent {
  from: EpisodeShip;
  to: EpisodeShip;
  hit: boolean;
}

export type Controller =
  | { kind: 'policy'; brain: Brain }
  | { kind: 'scripted' }
  /**
   * A target that simply leaves: nose away from the nearest pirate, throttle
   * open. Not clever, and not meant to be — it exists so that "do nothing"
   * stops being a winning pirate policy. No evolved trader has ever learned to
   * run (all of them orbit at ~2100 and die), so the pressure to give chase
   * has to be put into the pool by hand.
   */
  | { kind: 'runner' }
  /**
   * A target that turns hard and barely translates — how a human actually
   * knife-fights. Chris flies at a median of 66 with the pitch pinned near its
   * cap, and stops dead to bring guns to bear.
   *
   * `playerCobraSlow` was meant to cover this and does not: a policy flying it
   * cruises near its 90 maximum, so `target.speed/400` never drops below about
   * 0.22 in training. Measured against a stationary target, the g1 attacker
   * throttles forward on 19% of frames where it manages 85% at speed 300 — it
   * hangs at ~430 units and pivots instead of making attack runs, which is
   * exactly what Chris reported flying it: "they now sit still spinning".
   */
  | { kind: 'holding' };

/**
 * The hulls a target can fly, and the envelope each one is flown at.
 *
 * NOT a ship table: every number here is READ from the game, and the ones that
 * are not (playerCobraSlow's ceiling) are the deliberate handicap that hull
 * exists to apply. `CLASSES` in the old simulator was a table of hp, speed,
 * turn rate and radius copied out of ship-specs.ts and player.ts, and the copy
 * drifted — accel 120 against the player's real 220 for long enough to fit
 * every pirate brain shipped before generation 1.
 *
 * `gun` says which weapon the hull carries when it is armed, and it is the
 * ROLE's gun: a freighter shoots with an NPC's gun, the commander's hull with
 * the commander's pulse laser. That asymmetry is the game's, not a modelling
 * convenience.
 */
export type TargetHullId = 'traderCobra' | 'playerCobra' | 'playerCobraSlow';

interface TargetHull {
  name: string;
  hp: number;
  radius: number;
  maxSpeed: number;
  accel: number;
  maxPitch: number;
  maxRoll: number;
  rateRamp: number;
  rateDecay: number;
  /** rad/s the scripted controllers may swing the nose at */
  steerRate: number;
  gun: 'player' | 'npc';
}

/** The freighter every brain before generation 1 was trained against. */
const TRADER_COBRA: NpcSpec = SPECS.trader[0];

function traderHull(): TargetHull {
  const s = TRADER_COBRA;
  return {
    name: 'Cobra Mk III',
    hp: s.hp,
    radius: s.radius,
    maxSpeed: s.maxSpeed,
    accel: shipAccel(s),
    maxPitch: s.turnRate * TURN.pitch,
    maxRoll: s.turnRate * TURN.roll,
    rateRamp: BRAIN_RATE_RAMP,
    rateDecay: BRAIN_RATE_DECAY,
    steerRate: s.turnRate,
    gun: 'npc',
  };
}

/**
 * The commander, as a target — the ship a pirate actually hunts.
 *
 * Straight from PLAYER_FLIGHT, which fixes a mismatch the parity tests could
 * only report: the simulator gave the player `turnRate * TURN.roll` = 2.4864
 * where player.ts rolls at 2.5, and stored the pitch cap as a rounded quotient
 * (1.036 x 1.4 = 1.4504 against 1.45). Both are now the same number as the
 * ship, because they are read off it.
 *
 * hp 1.0 with no shields is deliberate and unchanged: `train/survivability.ts`
 * exists to re-run the balance question at the commander's real durability
 * (game/systems.ts `durability()`), and it works by overriding `trader.hp`.
 */
function playerHull(maxSpeed: number, accel: number): TargetHull {
  return {
    name: 'Cobra Mk III (player)',
    hp: 1.0,
    radius: TRADER_COBRA.radius,
    maxSpeed,
    accel,
    maxPitch: PLAYER_FLIGHT.maxPitch,
    maxRoll: PLAYER_FLIGHT.maxRoll,
    rateRamp: PLAYER_FLIGHT.rateRamp,
    rateDecay: PLAYER_FLIGHT.rateDecay,
    steerRate: PLAYER_FLIGHT.maxPitch,
    gun: 'player',
  };
}

const TARGET_HULLS: Record<TargetHullId, () => TargetHull> = {
  traderCobra: traderHull,
  /**
   * It exists because every pirate brain up to generation 1 was trained
   * against traderCobra, a ship 1.8x slower and less than half as agile as the
   * commander it actually hunts. A pursuit curve fitted to a freighter
   * overshoots a player on every pass, and the pirate spends the fight
   * re-acquiring instead of shooting — measured in the game, a Sidewinder is
   * lined up on the player for 5% of a fight.
   */
  playerCobra: () => playerHull(PLAYER_FLIGHT.maxSpeed, PLAYER_FLIGHT.accel),
  /**
   * How a human actually flies in a dogfight, from Chris's recorded envelope:
   * median speed 66, pitch held at 1.36 of a possible 1.45. He turns almost on
   * the spot and stops dead to bring guns to bear.
   *
   * It exists because run 10, trained only against targets doing 220 to 400,
   * simply stops when the target does: 99 units flown in 20 seconds against a
   * stationary player, where the same brain flies 1145 and closes to 225 if
   * the player is doing 300. A pursuer that has never seen a slow target has
   * no policy for one. The ceiling is the handicap; everything else is the
   * commander's own ship.
   */
  playerCobraSlow: () => {
    const h = playerHull(90, 120);
    h.name = 'Cobra Mk III (player, knife-fighting)';
    return h;
  },
};

/** Which hull a pirate flies. Both are read from the roster. */
const PIRATE_COBRA: NpcSpec = SPECS.pirate[5];
const PIRATE_SIDEWINDER: NpcSpec = SPECS.pirate[0];

/**
 * What the *victim* of a ram takes, against the rammer's RAM_DAMAGE.
 *
 * In the game the player's fore/aft shields absorb collision damage before the
 * hull sees any (world-step.ts bills `applyPlayerDamage`), so ramming is
 * heavily asymmetric against the pirate. The target here has raw hp and no
 * shields — see `playerHull` — so the asymmetry is modelled directly.
 * Symmetric damage punished the trader for being hit, which is not what
 * happens in the game.
 */
const VICTIM_RAM_DAMAGE = 0.12;

export interface EpisodeOptions {
  seed: number;
  /** one brain per pirate; scripted pirates use the game's chase AI */
  pirates: Controller[];
  trader: Controller;
  /**
   * Hull for the trader. Defaults to `traderCobra`, the freighter every brain
   * has ever been trained against. `playerCobra` gives it the commander's own
   * speed and agility, which is the thing pirates actually have to track.
   */
  traderClass?: TargetHullId;
  /** armed traders shoot back (used for pack scenarios) */
  traderArmed?: boolean;
  maxTime?: number;
  /**
   * How far the target has to get before it is gone for good. Without this the
   * episode is a box: the trader could neither be lost nor escape, so closing
   * the distance was worth nothing and only aiming paid. A pirate that never
   * touched its throttle killed 99% of targets, armed or not — and the trainer
   * duly evolved pirates that stand still and pivot, which is useless in a game
   * where the player can simply leave.
   */
  escapeRange?: number;
}

/** A pirate: a real NpcShip, plus the tally the fitness functions read. */
class PirateShip implements EpisodeShip {
  readonly npc: NpcShip;
  readonly radius: number;
  readonly name: string;
  shotsFired = 0;
  shotsHit = 0;
  damageDealt = 0;
  damageTaken = 0;

  constructor(spec: NpcSpec, position: THREE.Vector3, variantSeed: number) {
    this.npc = new NpcShip('pirate', position, variantSeed, spec);
    this.radius = spec.radius;
    this.name = spec.def?.name ?? 'ship';
  }

  get pos(): THREE.Vector3 { return this.npc.object.position; }
  get quat(): THREE.Quaternion { return this.npc.object.quaternion; }
  get speed(): number { return this.npc.speed; }
  get hp(): number { return this.npc.hp; }
  set hp(v: number) { this.npc.hp = v; }
  get alive(): boolean { return this.npc.alive; }
  set alive(v: boolean) { this.npc.alive = v; }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.quat);
  }
}

/**
 * The target: the player's own flight model, flown from a FlightDemand.
 *
 * `PlayerShip.update` takes what the pilot WANTS and asks nothing about who
 * the pilot is — which is the seam this whole merge turns on. A human's hands,
 * the combat computer and a training scenario all produce the same four
 * numbers, and the ship cannot tell them apart.
 */
class TargetShip implements EpisodeShip {
  readonly ship: PlayerShip;
  readonly hull: TargetHull;
  readonly radius: number;
  readonly name: string;
  hp: number;
  alive = true;
  shotsFired = 0;
  shotsHit = 0;
  damageDealt = 0;
  damageTaken = 0;
  /** ramped turn rates — the pilot's, not the hull's (see FlightDemand) */
  pitchRate = 0;
  rollRate = 0;
  laserTemp = 0;
  laserCooldown = 0;

  constructor(hull: TargetHull) {
    this.hull = hull;
    this.radius = hull.radius;
    this.name = hull.name;
    this.hp = hull.hp;
    this.ship = new PlayerShip(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
    this.ship.speed = hull.maxSpeed * 0.5;
  }

  get pos(): THREE.Vector3 { return this.ship.position; }
  get quat(): THREE.Quaternion { return this.ship.quaternion; }
  get speed(): number { return this.ship.speed; }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return this.ship.getForward(out);
  }

  /** Fly one step of a discrete control, ramping to this hull's envelope. */
  step(dt: number, c: Control): void {
    const h = this.hull;
    this.pitchRate = rampToward(
      this.pitchRate, c.pitch * h.maxPitch, c.pitch !== 0, dt, h.rateRamp, h.rateDecay);
    this.rollRate = rampToward(
      this.rollRate, c.roll * h.maxRoll, c.roll !== 0, dt, h.rateRamp, h.rateDecay);
    this.fly(dt, {
      pitchRate: this.pitchRate,
      rollRate: this.rollRate,
      throttle: c.throttle,
      fire: false,
      limits: { accel: h.accel, maxSpeed: h.maxSpeed },
    });
  }

  /**
   * Fly one step of a demand whose ROTATION has already happened — the
   * scripted controllers swing the nose with `steerQuatToward`, as every
   * scripted ship in the game does, rather than through pitch and roll.
   */
  fly(dt: number, demand: FlightDemand): void {
    this.ship.update(dt, demand);
    // the gun's half of systems.ts `regenerate` — the only half a target has
    this.laserCooldown -= dt;
    this.laserTemp = Math.max(0, this.laserTemp - LASER_COOL_RATE * dt);
  }

  takeDamage(amount: number): void {
    this.damageTaken += amount;
    this.hp -= amount;
    if (this.hp <= 0) this.alive = false;
  }
}

export class Episode {
  readonly pirates: PirateShip[] = [];
  readonly trader: TargetShip;
  t = 0;
  readonly maxTime: number;
  done = false;
  /** the target got clear — the pirates lost it, and no one gets paid */
  escaped = false;
  readonly escapeRange: number;
  /** proximity shaping accumulator per pirate */
  readonly engagedTime: number[];
  /**
   * Time each pirate spent ON THE TARGET'S SIX — behind it, and pointed at
   * it. Chris's ask, and the thing neither generation of brain does: r2
   * weaves without ever converging, g2 converges by parking. Paying for the
   * tail position asks for the manoeuvre that is actually threatening, rather
   * than for damage by whatever route.
   */
  readonly tailTime: number[];

  private readonly opts: EpisodeOptions;
  private readonly fleet: NpcShip[] = [];
  private readonly obs = new Float32Array(PACK_WIDE_OBS_SIZE);
  private readonly scratch = makeScratch();
  private readonly meView = blankView();
  private readonly threatView = blankView();
  private readonly scratchVecs = { a: new THREE.Vector3(), b: new THREE.Vector3() };
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly traderWaypoint = new THREE.Vector3();
  private traderWaypointTimer = 0;
  private traderFireCooldown = 1.5;

  constructor(opts: EpisodeOptions) {
    this.opts = opts;
    this.maxTime = opts.maxTime ?? 45;
    // 6000 against a 3500 laser and a 1500-2700 spawn: comfortably outside
    // weapons reach, and reachable in a few seconds of running flat out.
    this.escapeRange = opts.escapeRange ?? 6000;
    // The world's own PRNG, seeded per episode. Everything with a die in it —
    // where the pirates spawn, which way they face, whether a shot connects —
    // is drawn from it, because that is what the game draws from (game/rng.ts,
    // and Math.random is banned). One consequence, and it is the same one the
    // game lives with: episodes must be RUN one at a time, not interleaved.
    seedWorld(opts.seed >>> 0);

    this.trader = new TargetShip(TARGET_HULLS[opts.traderClass ?? 'traderCobra']());
    // random initial trader orientation
    steerQuatToward(
      this.trader.quat, randomDirection(this.tmp).multiplyScalar(1000), Math.PI);

    for (let i = 0; i < opts.pirates.length; i++) {
      const dir = randomDirection(this.tmp);
      const dist = 1500 + random() * 1200;
      const p = new PirateShip(
        opts.pirates.length > 1 && i % 2 === 1 ? PIRATE_SIDEWINDER : PIRATE_COBRA,
        this.tmp2.copy(dir).multiplyScalar(dist),
        i * 7 + 1);
      p.npc.faceToward(this.trader.pos); // roughly face the prey
      this.pirates.push(p);
      this.fleet.push(p.npc);
    }
    this.engagedTime = this.pirates.map(() => 0);
    this.tailTime = this.pirates.map(() => 0);
  }

  /** @returns shot events for this step (for the viewer's tracers) */
  step(dt: number): ShotEvent[] {
    if (this.done) return [];
    this.t += dt;
    const events: ShotEvent[] = [];

    // --- pirates ---
    for (let i = 0; i < this.pirates.length; i++) {
      const p = this.pirates[i];
      if (!p.alive) continue;
      const ctrl = this.opts.pirates[i];
      const toTarget = this.tmp.copy(this.trader.pos).sub(p.pos);
      const range = toTarget.length();
      // The policy's trigger is NOT consulted, and neither is a scripted
      // pirate's — brainFly and attack() both gate the gun themselves, on
      // range, the 0.25 rad cone and their own cooldown. That is the game's
      // rule and it is now literally the same code: a pirate shoots exactly as
      // often as being lined up allows.
      const shot = ctrl.kind === 'policy'
        ? p.npc.brainFly(
          ctrl.brain, dt, this.trader.pos, this.trader.quat, this.trader.speed,
          range, 'player',
          ctrl.brain.obsSize >= PACK_OBS_SIZE ? this.fleet : null)
        : p.npc.attack(dt, this.trader.pos, range, true);
      if (shot && this.trader.alive) {
        events.push(this.resolveNpcShot(p, range));
      }
      // geometry AFTER the step, as the shaping terms always measured it
      const after = this.tmp.copy(this.trader.pos).sub(p.pos);
      const gap = after.length();
      if (gap < 1500) this.engagedTime[i] += dt;
      // on its six: behind the target's tail AND nose-on to it
      if (gap < 1800 && gap > 120) {
        const dir = after.divideScalar(gap);
        const behind = this.trader.forward(this.tmp2).dot(dir) > 0.35; // we are astern
        const pointed = p.forward(this.tmp2).dot(dir) > 0.9;           // and lined up
        if (behind && pointed) this.tailTime[i] += dt;
      }
    }

    // --- trader ---
    if (this.trader.alive) {
      const tCtrl = this.opts.trader;
      let policyWantsFire = false;
      if (tCtrl.kind === 'policy') {
        const threat = this.nearestPirate() ?? this.pirates[0];
        const c = act(tCtrl.brain, this.observeTrader(threat), this.scratch);
        policyWantsFire = c.fire && !!this.opts.traderArmed; // armed policies may shoot
        this.trader.step(dt, { ...c, fire: false });
      } else if (tCtrl.kind === 'runner') {
        this.runningTrader(dt);
      } else if (tCtrl.kind === 'holding') {
        this.holdingTrader(dt);
      } else {
        this.scriptedTrader(dt);
      }

      if (this.opts.traderArmed) {
        const threat = this.nearestPirate();
        if (tCtrl.kind === 'policy') {
          if (policyWantsFire && threat) {
            const e = this.fireTraderGun(threat);
            if (e) events.push(e);
          }
        } else {
          // A scripted trader's trigger discipline: a slow, deliberate shot
          // when it is properly lined up, on top of whatever its gun allows.
          this.traderFireCooldown -= dt;
          if (threat && this.traderFireCooldown <= 0
              && this.facingAngle(this.trader, threat.pos) < 0.15) {
            this.traderFireCooldown = 1.2;
            const e = this.fireTraderGun(threat);
            if (e) events.push(e);
          }
        }
      }
    }

    this.resolveCollisions();

    const nearest = this.nearestPirate();
    if (this.trader.alive && nearest
        && this.tmp.copy(this.trader.pos).sub(nearest.pos).length() > this.escapeRange) {
      this.escaped = true;
    }
    if (this.t >= this.maxTime || !this.trader.alive || this.escaped
        || this.pirates.every((p) => !p.alive)) {
      this.done = true;
    }
    return events;
  }

  // --- guns ------------------------------------------------------------------

  /**
   * A pirate pulled the trigger. Resolving it is world-step.ts's
   * `resolveNpcFire`, minus the tracer and the sound: roll against the range
   * curve, roll the damage.
   */
  private resolveNpcShot(p: PirateShip, dist: number): ShotEvent {
    p.shotsFired += 1;
    const hit = random() < npcHitChance(dist);
    if (hit) {
      const damage = npcShotDamage(random());
      p.shotsHit += 1;
      p.damageDealt += damage;
      this.trader.takeDamage(damage);
    }
    return { from: p, to: this.trader, hit };
  }

  /**
   * The target shoots back, with the gun its hull carries.
   *
   * A freighter fires an NPC's gun — loose gate, slow cadence, dice on range.
   * The commander's hull fires the commander's pulse laser: a cone test
   * (gunnery.ts `hitCone`, the same allowance the player's ring sight is drawn
   * to) and a cooldown and heat budget, which is deterministic on purpose so a
   * policy can genuinely learn to aim.
   */
  private fireTraderGun(threat: PirateShip): ShotEvent | null {
    const t = this.trader;
    const to = this.tmp.copy(threat.pos).sub(t.pos);
    const dist = to.length();
    const angle = this.facingAngle(t, threat.pos);

    if (t.hull.gun === 'npc') {
      if (t.laserCooldown > 0) return null;
      // as in npc.ts: outside the gate or out of range it never pulls the
      // trigger, so it does not spend the cooldown either
      if (angle >= NPC_FIRE_GATE || dist > LASER_RANGE) return null;
      t.laserCooldown = NPC_COOLDOWN_LO + random() * NPC_COOLDOWN_SPREAD;
      t.shotsFired += 1;
      if (random() >= npcHitChance(dist)) return { from: t, to: threat, hit: false };
      const damage = npcShotDamage(random());
      t.shotsHit += 1;
      t.damageDealt += damage;
      this.hurtPirate(threat, damage);
      return { from: t, to: threat, hit: true };
    }

    const pulse = LASERS.pulse;
    if (t.laserCooldown > 0 || t.laserTemp >= LASER_CUTOUT) return null;
    t.laserCooldown = pulse.cooldown;
    t.laserTemp = Math.min(1, t.laserTemp + pulse.heat);
    t.shotsFired += 1;
    if (dist > LASER_RANGE || angle >= hitCone(threat.radius, dist)) {
      return { from: t, to: threat, hit: false };
    }
    t.shotsHit += 1;
    t.damageDealt += pulse.damage;
    this.hurtPirate(threat, pulse.damage);
    return { from: t, to: threat, hit: true };
  }

  private hurtPirate(p: PirateShip, amount: number): void {
    p.damageTaken += amount;
    p.npc.takeDamage(amount, this.trader.pos, true);
  }

  // --- ramming ---------------------------------------------------------------

  /**
   * Ships are solid. The geometry is collisions.ts's — the same call
   * world-step.ts makes — and what it costs is decided here, as it is there.
   */
  private resolveCollisions(): void {
    if (this.trader.alive) {
      const pos = this.trader.pos;
      for (const npc of playerVsNpcs(
        pos, (k) => { this.trader.ship.speed *= k; }, this.fleet, this.scratchVecs)) {
        const p = this.pirates.find((x) => x.npc === npc)!;
        this.trader.takeDamage(VICTIM_RAM_DAMAGE);
        this.hurtSelf(p, RAM_DAMAGE);
      }
    }
    for (const [a, b] of npcVsNpcs(this.fleet, this.scratchVecs)) {
      for (const npc of [a, b]) {
        this.hurtSelf(this.pirates.find((x) => x.npc === npc)!, RAM_DAMAGE);
      }
    }
  }

  /** Damage with nobody to credit — a ram, which the fitness already punishes. */
  private hurtSelf(p: PirateShip, amount: number): void {
    p.damageTaken += amount;
    p.npc.takeDamage(amount);
  }

  // --- the target's pilots ----------------------------------------------------

  /** Turn to face the threat, and stay put doing it. See `holding`. */
  private holdingTrader(dt: number): void {
    const threat = this.nearestPirate();
    if (threat) this.steerTrader(threat.pos, dt);
    // brake toward a crawl rather than a dead stop: a human bleeds speed off
    // and drifts, and a hard zero is a corner the physics never otherwise hits
    this.coast(dt, this.trader.speed > 60 ? -1 : 0);
  }

  /** Nose away from the nearest threat, throttle open, and keep going. */
  private runningTrader(dt: number): void {
    const threat = this.nearestPirate();
    if (threat) {
      this.steerTrader(
        this.tmp2.copy(this.trader.pos).multiplyScalar(2).sub(threat.pos), dt);
    }
    this.coast(dt, 1);
  }

  /** The pre-RL scripted hauler: amble to waypoints, run when shot at. */
  private scriptedTrader(dt: number): void {
    if (this.trader.damageTaken > 0) {
      const threat = this.nearestPirate();
      if (threat) {
        this.steerTrader(
          this.tmp2.copy(this.trader.pos).multiplyScalar(2).sub(threat.pos), dt);
      }
      this.coast(dt, 1);
      return;
    }
    this.traderWaypointTimer -= dt;
    if (this.traderWaypointTimer <= 0) {
      this.traderWaypointTimer = 8 + random() * 8;
      this.traderWaypoint.copy(this.trader.pos)
        .add(randomDirection(this.tmp2).multiplyScalar(2000));
    }
    this.steerTrader(this.traderWaypoint, dt);
    this.coast(dt, this.trader.speed < this.trader.hull.maxSpeed * 0.4 ? 1 : 0);
  }

  /** Swing the nose toward a place at the hull's turn rate. */
  private steerTrader(point: THREE.Vector3, dt: number): void {
    steerQuatToward(
      this.trader.quat, this.tmp2.copy(point).sub(this.trader.pos),
      this.trader.hull.steerRate * dt);
  }

  /** Throttle only: the nose has already been pointed. */
  private coast(dt: number, throttle: number): void {
    this.trader.pitchRate = 0;
    this.trader.rollRate = 0;
    this.trader.fly(dt, {
      pitchRate: 0, rollRate: 0, throttle, fire: false,
      limits: { accel: this.trader.hull.accel, maxSpeed: this.trader.hull.maxSpeed },
    });
  }

  // --- observation -------------------------------------------------------------

  /** What the trader's policy sees. Same encoder the game feeds an NPC. */
  private observeTrader(threat: PirateShip): Float32Array {
    const me = this.meView;
    const t = this.threatView;
    copyView(me, this.trader.pos, this.trader.quat);
    me.speed = this.trader.speed;
    me.cls.maxSpeed = this.trader.hull.maxSpeed;
    me.cls.turnRate = this.trader.hull.maxPitch / TURN.pitch;
    me.laserTemp = this.trader.laserTemp;
    me.laserCooldown = this.trader.laserCooldown;
    me.pitchRate = this.trader.pitchRate;
    me.rollRate = this.trader.rollRate;
    copyView(t, threat.pos, threat.quat);
    t.speed = threat.speed;
    return observe(me as ObservableShip, t as ObservableShip, this.obs);
  }

  // --- geometry ----------------------------------------------------------------

  private nearestPirate(): PirateShip | null {
    let best: PirateShip | null = null;
    let bestD = Infinity;
    for (const p of this.pirates) {
      if (!p.alive) continue;
      const d = p.pos.distanceTo(this.trader.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Angle between a ship's nose and the direction to a point. */
  private facingAngle(s: EpisodeShip, point: THREE.Vector3): number {
    const fwd = s.forward(this.tmp2);
    return fwd.angleTo(this.tmp.copy(point).sub(s.pos).normalize());
  }

  // --- fitness -------------------------------------------------------------

  /** Fitness for pirate index i, attack phase. */
  fitnessAttack(i = 0): number {
    const p = this.pirates[i];
    const killed = !this.trader.alive;
    return (
      6 * p.damageDealt +
      (killed ? 8 + 4 * (1 - this.t / this.maxTime) : 0) +
      0.05 * this.engagedTime[i] +
      0.6 * this.tailTime[i] -
      2 * p.damageTaken -
      (this.escaped ? 6 : 0)
    );
  }

  /**
   * Shared fitness for a policy pack (all pirates one policy).
   *
   * Round 3 (see docs/TRAINING-LOG.md): round 2 learned an all-in alpha
   * strike that killed fastest but only 70% of the time, because the
   * survivor bonus and shot penalty together rewarded a single decisive
   * gamble over sustained pressure. So: reward damage-per-second of
   * engagement, drop the shot penalty entirely, and shrink the survivor
   * term so staying alive is worth less than keeping the target under fire.
   */
  fitnessPack(): number {
    let damage = 0;
    let taken = 0;
    let alive = 0;
    for (const p of this.pirates) {
      damage += p.damageDealt;
      taken += p.damageTaken;
      if (p.alive) alive += 1;
    }
    const killed = !this.trader.alive;
    const pressure = damage / Math.max(4, this.t); // damage per second on target
    return (
      5 * damage +
      30 * pressure +
      (killed ? 12 + 5 * (1 - this.t / this.maxTime) : 0) +
      0.5 * alive -
      1.5 * taken
    );
  }

  /** Fitness for an armed policy trader defending itself (Jameson phase). */
  fitnessDefend(): number {
    const killedPirates = this.pirates.filter((p) => !p.alive).length;
    return (
      (this.t / this.maxTime) * 8 +
      this.trader.hp * 4 +
      4 * this.trader.damageDealt +
      3 * killedPirates -
      0.02 * this.trader.shotsFired
    );
  }

  /** Fitness for a policy trader, evade phase. */
  fitnessEvade(): number {
    // Escaping ends the episode, so counting raw `t` would pay a runner LESS
    // than one that dawdles for the full 45s. Getting clear is a win: credit
    // it with the whole episode, or the escape bonus below is self-defeating.
    const survived = this.escaped ? this.maxTime : this.t;
    const nearest = this.nearestPirate() ?? this.pirates[0];
    const distBonus = this.trader.alive
      ? Math.min(2, this.trader.pos.distanceTo(nearest.pos) / 3000)
      : 0;
    return (survived / this.maxTime) * 10 + this.trader.hp * 5 + distBonus
      + (this.escaped ? 6 : 0);
  }
}

interface MutableView {
  pos: { x: number; y: number; z: number };
  quat: { x: number; y: number; z: number; w: number };
  speed: number;
  laserTemp: number;
  laserCooldown: number;
  pitchRate: number;
  rollRate: number;
  cls: { maxSpeed: number; turnRate: number };
}

function blankView(): MutableView {
  return {
    pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 },
    speed: 0, laserTemp: 0, laserCooldown: 0, pitchRate: 0, rollRate: 0,
    cls: { maxSpeed: 400, turnRate: 1 },
  };
}

function copyView(v: MutableView, p: THREE.Vector3, q: THREE.Quaternion): void {
  v.pos.x = p.x; v.pos.y = p.y; v.pos.z = p.z;
  v.quat.x = q.x; v.quat.y = q.y; v.quat.z = q.z; v.quat.w = q.w;
}
