// Combat scenarios shared by the trainer (batch) and the viewer (real time).
// An Episode owns its ships and steps them; the caller chooses the pace.
//
// Erasable-TypeScript only — runs in Node via --experimental-strip-types.

import {
  CLASSES, makeShip, stepShip, fireLaser, steerToward, facingAngle, resolveCollision, COLLISION,
  makeRng, randDir, vAdd, vSub, vScale, vLen, vNorm, vDot, forward, v3, q4,
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

export interface EpisodeOptions {
  seed: number;
  /** one brain per pirate; scripted pirates use game-style chase AI */
  pirates: Controller[];
  trader: Controller;
  /**
   * Hull for the trader. Defaults to `traderCobra`, the freighter every brain
   * has ever been trained against. `playerCobra` gives it the commander's own
   * speed and agility, which is the thing pirates actually have to track.
   */
  traderClass?: keyof typeof CLASSES;
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

const IDLE: Control = { pitch: 0, roll: 0, throttle: 0, fire: false };

export class Episode {
  readonly pirates: SimShip[] = [];
  readonly trader: SimShip;
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
  private readonly rng: () => number;
  private readonly obs = new Float32Array(PACK_WIDE_OBS_SIZE);
  private readonly scratch = makeScratch();
  private traderWaypoint: V3 = v3();
  private traderWaypointTimer = 0;
  private traderFireCooldown = 1.5;

  constructor(opts: EpisodeOptions) {
    this.opts = opts;
    this.maxTime = opts.maxTime ?? 45;
    // 6000 against a 3500 laser and a 1500-2700 spawn: comfortably outside
    // weapons reach, and reachable in a few seconds of running flat out.
    this.escapeRange = opts.escapeRange ?? 6000;
    this.rng = makeRng(opts.seed);

    this.trader = makeShip(CLASSES[opts.traderClass ?? 'traderCobra'], v3(0, 0, 0), q4());
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
        fireLaser(p, this.trader, dt, this.rng);
        if (p.shotsFired > beforeShots) {
          events.push({ from: p, to: this.trader, hit: this.trader.hp < hpBefore });
        }
      }
      const toTarget = vSub(this.trader.pos, p.pos);
      const range = vLen(toTarget);
      if (range < 1500) this.engagedTime[i] += dt;
      // on its six: behind the target's tail AND nose-on to it
      if (range < 1800 && range > 120) {
        const dir = vNorm(toTarget);
        const behind = vDot(forward(this.trader), dir) > 0.35;   // we are astern
        const pointed = vDot(forward(p), dir) > 0.9;             // and lined up
        if (behind && pointed) this.tailTime[i] += dt;
      }
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
      } else if (tCtrl.kind === 'runner') {
        control = this.runningTrader(dt);
      } else if (tCtrl.kind === 'holding') {
        control = this.holdingTrader(dt);
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
            fireLaser(this.trader, threat, dt, this.rng);
            if (this.trader.shotsFired > beforeShots) {
              events.push({ from: this.trader, to: threat, hit: threat.hp < hpBefore });
            }
          }
        } else {
          this.traderFireCooldown -= dt;
          if (threat && this.traderFireCooldown <= 0 && facingAngle(this.trader, threat.pos) < 0.15) {
            this.traderFireCooldown = 1.2;
            const hpBefore = threat.hp;
            fireLaser(this.trader, threat, dt, this.rng);
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

    const nearest = this.nearestPirate();
    if (this.trader.alive && nearest
        && vLen(vSub(this.trader.pos, nearest.pos)) > this.escapeRange) {
      this.escaped = true;
    }
    if (this.t >= this.maxTime || !this.trader.alive || this.escaped
        || this.pirates.every((p) => !p.alive)) {
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

  /** Turn to face the threat, and stay put doing it. See `holding`. */
  private holdingTrader(dt: number): Control {
    const threat = this.nearestPirate();
    if (threat) steerToward(this.trader, threat.pos, dt);
    // brake toward a crawl rather than a dead stop: a human bleeds speed off
    // and drifts, and a hard zero is a corner the physics never otherwise hits
    return { pitch: 0, roll: 0, throttle: this.trader.speed > 60 ? -1 : 0, fire: false };
  }

  /** Nose away from the nearest threat, throttle open, and keep going. */
  private runningTrader(dt: number): Control {
    const threat = this.nearestPirate();
    if (!threat) return { pitch: 0, roll: 0, throttle: 1, fire: false };
    const away = vAdd(this.trader.pos, vSub(this.trader.pos, threat.pos));
    steerToward(this.trader, away, dt);
    return { pitch: 0, roll: 0, throttle: 1, fire: false };
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
      0.05 * this.engagedTime[i] +
      0.6 * this.tailTime[i] -
      0.03 * p.shotsFired -
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
    const distBonus = this.trader.alive
      ? Math.min(2, vLen(vSub(this.trader.pos, (this.nearestPirate() ?? this.pirates[0]).pos)) / 3000)
      : 0;
    return (survived / this.maxTime) * 10 + this.trader.hp * 5 + distBonus
      + (this.escaped ? 6 : 0);
  }
}
