// Combat scenarios shared by the trainer (batch) and the viewer (real time).
// An Episode owns its ships and steps them; the caller chooses the pace.
//
// Erasable-TypeScript only — runs in Node via --experimental-strip-types.

import {
  CLASSES, makeShip, stepShip, fireLaser, steerToward, facingAngle, resolveCollision, COLLISION,
  makeRng, randDir, vAdd, vSub, vScale, vLen, v3, q4,
  type SimShip, type Control, type V3,
} from './core.ts';
import {
  observe, observePack, observePackWide, act, makeScratch,
  PACK_OBS_SIZE, PACK_WIDE_OBS_SIZE, type Brain,
} from './policy.ts';

export interface ShotEvent {
  from: SimShip;
  to: SimShip;
  hit: boolean;
}

export type Controller =
  | { kind: 'policy'; brain: Brain }
  | { kind: 'scripted' };

export interface EpisodeOptions {
  seed: number;
  /** one brain per pirate; scripted pirates use game-style chase AI */
  pirates: Controller[];
  trader: Controller;
  /** armed traders shoot back (used for pack scenarios) */
  traderArmed?: boolean;
  maxTime?: number;
}

const IDLE: Control = { pitch: 0, roll: 0, throttle: 0, fire: false };

export class Episode {
  readonly pirates: SimShip[] = [];
  readonly trader: SimShip;
  t = 0;
  readonly maxTime: number;
  done = false;
  /** proximity shaping accumulator per pirate */
  readonly engagedTime: number[];

  private readonly opts: EpisodeOptions;
  private readonly rng: () => number;
  private readonly obs = new Float32Array(PACK_WIDE_OBS_SIZE);
  private readonly scratch = makeScratch();
  private traderWaypoint: V3 = v3();
  private traderWaypointTimer = 0;
  private traderFireCooldown = 1.5;

  constructor(opts: EpisodeOptions) {
    this.opts = opts;
    this.maxTime = opts.maxTime ?? 45;
    this.rng = makeRng(opts.seed);

    this.trader = makeShip(CLASSES.traderCobra, v3(0, 0, 0), q4());
    // random initial trader orientation
    steerToward(this.trader, vScale(randDir(this.rng), 1000), 10);

    for (let i = 0; i < opts.pirates.length; i++) {
      const dir = randDir(this.rng);
      const dist = 1500 + this.rng() * 1200;
      const ship = makeShip(
        opts.pirates.length > 1 && i % 2 === 1 ? CLASSES.pirateSidewinder : CLASSES.pirateCobra,
        vScale(dir, dist),
        q4(),
      );
      steerToward(ship, this.trader.pos, 10); // roughly face the prey
      this.pirates.push(ship);
    }
    this.engagedTime = this.pirates.map(() => 0);
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
      let control: Control = IDLE;
      let wantsFire = false;
      if (ctrl.kind === 'policy') {
        const obs = ctrl.brain.obsSize >= PACK_WIDE_OBS_SIZE
          ? observePackWide(p, this.trader, this.pirates, this.obs)
          : ctrl.brain.obsSize >= PACK_OBS_SIZE
            ? observePack(p, this.trader, this.pirates, this.obs)
            : observe(p, this.trader, this.obs);
        control = act(ctrl.brain, obs, this.scratch);
        wantsFire = control.fire;
      } else {
        control = this.scriptedPirate(p, dt);
        wantsFire = control.fire;
      }
      stepShip(p, control, dt);
      if (wantsFire && this.trader.alive) {
        const hpBefore = this.trader.hp;
        const beforeShots = p.shotsFired;
        fireLaser(p, this.trader, dt);
        if (p.shotsFired > beforeShots) {
          events.push({ from: p, to: this.trader, hit: this.trader.hp < hpBefore });
        }
      }
      if (vLen(vSub(this.trader.pos, p.pos)) < 1500) this.engagedTime[i] += dt;
    }

    // --- trader ---
    if (this.trader.alive) {
      const tCtrl = this.opts.trader;
      let control: Control;
      let policyWantsFire = false;
      if (tCtrl.kind === 'policy') {
        const threat = this.nearestPirate() ?? this.pirates[0];
        control = act(tCtrl.brain, observe(this.trader, threat, this.obs), this.scratch);
        policyWantsFire = control.fire && !!this.opts.traderArmed; // armed policies may shoot
        control = { ...control, fire: false };
      } else {
        control = this.scriptedTrader(dt);
      }
      stepShip(this.trader, control, dt);

      if (this.opts.traderArmed) {
        const threat = this.nearestPirate();
        if (tCtrl.kind === 'policy') {
          // policy gunnery: same laser model as the pirates get
          if (policyWantsFire && threat) {
            const hpBefore = threat.hp;
            const beforeShots = this.trader.shotsFired;
            fireLaser(this.trader, threat, dt);
            if (this.trader.shotsFired > beforeShots) {
              events.push({ from: this.trader, to: threat, hit: threat.hp < hpBefore });
            }
          }
        } else {
          this.traderFireCooldown -= dt;
          if (threat && this.traderFireCooldown <= 0 && facingAngle(this.trader, threat.pos) < 0.15) {
            this.traderFireCooldown = 1.2;
            const hpBefore = threat.hp;
            fireLaser(this.trader, threat, dt);
            events.push({ from: this.trader, to: threat, hit: threat.hp < hpBefore });
          }
        }
      }
    }

    // ships are solid — every pairing, so packs can't stack in one point
    // either. Damage lands in damageTaken, which the fitness already punishes.
    for (let i = 0; i < this.pirates.length; i++) {
      // the rammer pays; the target is shielded, as the player is in game.ts
      resolveCollision(this.pirates[i], this.trader,
        COLLISION.damage, COLLISION.victimDamage);
      for (let j = i + 1; j < this.pirates.length; j++) {
        resolveCollision(this.pirates[i], this.pirates[j]);
      }
    }

    if (this.t >= this.maxTime || !this.trader.alive || this.pirates.every((p) => !p.alive)) {
      this.done = true;
    }
    return events;
  }

  private nearestPirate(): SimShip | null {
    let best: SimShip | null = null;
    let bestD = Infinity;
    for (const p of this.pirates) {
      if (!p.alive) continue;
      const d = vLen(vSub(p.pos, this.trader.pos));
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Game-style chase AI (the pre-RL scripted tier), as a discrete control. */
  private scriptedPirate(p: SimShip, dt: number): Control {
    const dist = vLen(vSub(this.trader.pos, p.pos));
    steerToward(p, this.trader.pos, dt); // scripted ships steer directly
    const wantSpeed = dist > 700 ? p.cls.maxSpeed : p.cls.maxSpeed * 0.45;
    return {
      pitch: 0, roll: 0, // steering handled by steerToward above
      throttle: p.speed < wantSpeed ? 1 : -1,
      fire: dist < 2500 && facingAngle(p, this.trader.pos) < 0.12,
    };
  }

  private scriptedTrader(dt: number): Control {
    const threatened = this.trader.damageTaken > 0;
    if (threatened) {
      const threat = this.nearestPirate();
      if (threat) {
        const away = vAdd(this.trader.pos, vSub(this.trader.pos, threat.pos));
        steerToward(this.trader, away, dt);
      }
      return { pitch: 0, roll: 0, throttle: 1, fire: false };
    }
    this.traderWaypointTimer -= dt;
    if (this.traderWaypointTimer <= 0) {
      this.traderWaypointTimer = 8 + this.rng() * 8;
      this.traderWaypoint = vAdd(this.trader.pos, vScale(randDir(this.rng), 2000));
    }
    steerToward(this.trader, this.traderWaypoint, dt);
    return { pitch: 0, roll: 0, throttle: this.trader.speed < this.trader.cls.maxSpeed * 0.4 ? 1 : 0, fire: false };
  }

  // --- fitness -------------------------------------------------------------

  /** Fitness for pirate index i, attack phase. */
  fitnessAttack(i = 0): number {
    const p = this.pirates[i];
    const killed = !this.trader.alive;
    return (
      6 * p.damageDealt +
      (killed ? 8 + 4 * (1 - this.t / this.maxTime) : 0) +
      0.05 * this.engagedTime[i] -
      0.03 * p.shotsFired -
      2 * p.damageTaken
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
    const survived = this.t; // episode ends at death, so t IS time survived
    const distBonus = this.trader.alive
      ? Math.min(2, vLen(vSub(this.trader.pos, (this.nearestPirate() ?? this.pirates[0]).pos)) / 3000)
      : 0;
    return (survived / this.maxTime) * 10 + this.trader.hp * 5 + distBonus;
  }
}
