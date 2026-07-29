// Headless combat simulation core.
//
// Self-contained (no three.js, no DOM) so the same code runs at full speed in
// Node worker training loops AND drives the in-browser combat viewer. The
// numbers mirror the live game (src/game/npc.ts, src/game/game.ts): ship
// classes, laser model, steering behaviour. Keep them in sync — this is the
// training environment, and a policy is only as good as the sim it learned in.
//
// Erasable-TypeScript only (no enums/namespaces): Node runs this directly via
// --experimental-strip-types.

// --- minimal vector / quaternion math --------------------------------------

export type V3 = { x: number; y: number; z: number };
export type Q4 = { x: number; y: number; z: number; w: number };

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const q4 = (): Q4 => ({ x: 0, y: 0, z: 0, w: 1 });

export function vAdd(a: V3, b: V3): V3 { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
export function vSub(a: V3, b: V3): V3 { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
export function vScale(a: V3, s: number): V3 { return v3(a.x * s, a.y * s, a.z * s); }
export function vDot(a: V3, b: V3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function vCross(a: V3, b: V3): V3 {
  return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}
export function vLen(a: V3): number { return Math.sqrt(vDot(a, a)); }
export function vNorm(a: V3): V3 {
  const l = vLen(a) || 1;
  return v3(a.x / l, a.y / l, a.z / l);
}

export function qMul(a: Q4, b: Q4): Q4 {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function qAxisAngle(axis: V3, angle: number): Q4 {
  const h = angle / 2;
  const s = Math.sin(h);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(h) };
}

export function qNormalize(q: Q4): Q4 {
  const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

/** Rotate vector by quaternion. */
export function qRotate(q: Q4, p: V3): V3 {
  const u = v3(q.x, q.y, q.z);
  const t = vScale(vCross(u, p), 2);
  return vAdd(vAdd(p, vScale(t, q.w)), vCross(u, t));
}

// --- deterministic RNG (mulberry32) ----------------------------------------

export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randDir(rng: () => number): V3 {
  // uniform on the sphere
  const z = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return v3(r * Math.cos(a), r * Math.sin(a), z);
}

// --- ship classes (mirror the game's specs) --------------------------------

/**
 * How fast a released turn bleeds off — and the game has TWO of these, which
 * this file had one of.
 *
 * player.ts decays at 12.0 (deliberately tightened from 5.0, so a light tap
 * stops when you stop). npc.ts's brainFly still decays at 5.0. One constant
 * here cannot be right for both, and both models are stepped by this function.
 *
 * The history is worth keeping: an audit found the sim at 5.0 against the
 * player's 12.0, this file was "corrected" to 12.0 — and that silently broke
 * the NPC side, which had been the one that matched. It is per-class now, so
 * neither half can be wrong without the other being visibly wrong too.
 */
export const PLAYER_RATE_DECAY = 12.0;
export const NPC_RATE_DECAY = 5.0;

export interface ShipClass {
  name: string;
  hp: number;
  maxSpeed: number;
  /** pitch rate cap, rad/s; roll cap is 2x this */
  turnRate: number;
  radius: number;
  accel: number;
  /**
   * Turn-rate decay for this hull. Defaults to NPC_RATE_DECAY; only the player
   * model overrides it, because only the player's ship decays at 12.0.
   */
  rateDecay?: number;
  /**
   * Floor under this hull's speed: it cannot be throttled below this.
   *
   * Fighters have one, targets do not. Without it, evolution finds the
   * genuinely optimal pirate — a turret that stops dead and pivots, because
   * standing still is how you hold a firing line (you stop translating past
   * the target). Correct, lethal, and no fun at all to fly against: Chris
   * played a generation of brains that did exactly this and asked for the old
   * ones back. A pirate that must keep moving has to solve the interesting
   * problem instead — get behind the target and stay there.
   */
  minSpeed?: number;
  /**
   * Which weapon this hull carries. 'npc' is the game's pirate gun (NPC_GUN);
   * 'player' is the commander's pulse laser (LASER). Defaults to 'player' for
   * hulls that predate the split.
   */
  gun?: 'player' | 'npc';
}

export const CLASSES: Record<string, ShipClass> = {
  pirateCobra: { name: 'Cobra Mk III', hp: 1.1, maxSpeed: 260, turnRate: 0.8, radius: 34, accel: 120, gun: 'npc', minSpeed: 110 },
  pirateSidewinder: { name: 'Sidewinder', hp: 0.55, maxSpeed: 300, turnRate: 1.1, radius: 18, accel: 140, gun: 'npc', minSpeed: 130 },
  traderCobra: { name: 'Cobra Mk III', hp: 1.0, maxSpeed: 220, turnRate: 0.5, radius: 34, accel: 100, gun: 'npc' },
  /**
   * The player, as a target. Mirrors player.ts: MAX_SPEED 400, MAX_PITCH 1.45
   * and MAX_ROLL 2.5, which at TURN.pitch 1.4 works out as turnRate 1.036.
   *
   * accel 220, matching player.ts ACCEL. It said 120 — the comment claimed to
   * mirror player.ts and every other field did, so the pool trained against a
   * commander who took nearly twice as long to reach speed as the real one.
   *
   * It exists because every pirate brain was trained against traderCobra, a
   * ship 1.8x slower and less than half as agile as the commander it actually
   * hunts. A pursuit curve fitted to a freighter overshoots a player on every
   * pass, and the pirate spends the fight re-acquiring instead of shooting —
   * measured in the game, a Sidewinder is lined up on the player for 5% of a
   * fight. Keep in step with player.ts (invariant 2).
   */
  playerCobra: { name: 'Cobra Mk III (player)', hp: 1.0, maxSpeed: 400, turnRate: 1.036, radius: 34, accel: 220, rateDecay: PLAYER_RATE_DECAY },
  /**
   * How a human actually flies in a dogfight, from Chris's recorded envelope:
   * median speed 66, pitch held at 1.36 of a possible 1.45. He turns almost on
   * the spot and stops dead to bring guns to bear.
   *
   * It exists because run 10, trained only against targets doing 220 to 400,
   * simply stops when the target does: 99 units flown in 20 seconds against a
   * stationary player, where the same brain flies 1145 and closes to 225 if
   * the player is doing 300. A pursuer that has never seen a slow target has
   * no policy for one.
   */
  playerCobraSlow: { name: 'Cobra Mk III (player, knife-fighting)', hp: 1.0, maxSpeed: 90, turnRate: 1.036, radius: 34, accel: 120, rateDecay: PLAYER_RATE_DECAY },
};

// laser model — mirrors the player's pulse laser in game/gunnery.ts
/**
 * Ships are solid. Mirrors game/collisions.ts's ramming rule (0.45 to both, shoved
 * apart, most of the speed scrubbed off).
 *
 * Added in the collision round: without this, flying *through* the target was
 * free in training, so the policies learned to close to zero range and sit
 * there — which in the game reads as deliberate kamikaze. See
 * docs/TRAINING-LOG.md. Damage lands in `damageTaken`, which every fitness
 * function already penalises, so ramming becomes costly without any reward
 * reshaping.
 */
export const COLLISION = {
  /** what the ship that flew into someone takes — as game.ts deals to an NPC */
  damage: 0.45,
  /**
   * What the *victim* takes. In game.ts the player's fore/aft shields absorb
   * collision damage before the hull sees any, so ramming is heavily
   * asymmetric against the pirate. The sim has no shields, so model that
   * asymmetry directly — symmetric 0.45 punished the trader for being hit,
   * which is not what happens in the game.
   */
  victimDamage: 0.12,
  /** fraction of speed kept after a shunt */
  speedRetained: 0.3,
  /**
   * Extra separation after contact. Kept small: at 120 the shunt threw ships
   * ~190 apart, which combined with the damage taught the attacker to keep a
   * huge margin and stop pressing at all (kill rate fell to 33%).
   */
  separation: 40,
};

/**
 * turnRate → max pitch/roll. Mirrors game.ts's NpcShip.brainFly.
 *
 * These are deliberately UNCHANGED. Pirates being harder to track than the
 * player was fixed by making the *player* more agile (MAX_PITCH/MAX_ROLL in
 * player.ts), not by slowing everyone down. Cutting these to 1.15/2.0 was
 * tried and reverted: it left the pirate/trader agility *ratio* identical
 * while lowering absolute turn rates, and evasion needs absolute agility far
 * more than aggression does — the Jameson defence went from dying in 10% of
 * 2v1 fights to 92%, i.e. no better than an unarmed scripted trader.
 */
export const TURN = { pitch: 1.4, roll: 2.4 };

export const LASER = {
  damage: 0.16,
  cooldown: 0.24,
  heat: 0.055,
  coolRate: 0.22,
  range: 3500,
  /**
   * Hit cone half-angle = atan(target.radius * aim / dist), for NPC gunnery.
   *
   * Do NOT widen this to make the *player's* shots more forgiving: it governs
   * every NPC in training too. Raising it to 2.4 once collapsed the evader
   * (fitness 14.44 → 2.74) and the Jameson defence (22.43 → -0.14), because
   * running away stops working when everyone is 50% more accurate.
   * The player's own gunnery is a ray test in game.ts and is not modelled here.
   */
  aim: 1.6,
};

/**
 * The gun the game's NPCs actually carry — which is not the one above.
 *
 * `LASER` is the player's pulse laser, and the sim was handing it to pirates
 * too. That made training a different problem from the game in both directions
 * at once. In the sim a pirate needed to aim inside atan(34*1.6/2000) = 0.027
 * rad and then hit every time, firing every 0.24s. In the game it needs only
 * facing < 0.25 rad — nine times looser — fires every 1.30s on average, and
 * then rolls dice on range. Lined up, the sim's gun does 0.667 damage/second
 * and the game's does 0.041.
 *
 * So the sim paid for precision aim the game never asks for, and the game
 * needed patience the sim never modelled. Every attack run since round 1 was
 * fitted to a weapon that does not exist, which is the likeliest reason none
 * of them transferred (docs/TRAINING-LOG.md runs 9-14).
 *
 * Mirrors npc.ts (NPC_COOLDOWN_LO/SPREAD, the 0.25 gate, NPC_LASER_RANGE) and
 * game.ts resolveNpcFire (the hit roll and 0.1 + rand*0.12 damage). Invariant
 * 2: change one, change the other.
 */
export const NPC_GUN = {
  cooldownLo: 0.9,
  cooldownSpread: 0.8,
  /** npc.ts refuses to shoot outside this, and does not spend its cooldown */
  gate: 0.25,
  range: 3500,
  damageLo: 0.1,
  damageSpread: 0.12,
  hitBase: 0.9,
  hitFalloff: 3500,
  hitCap: 0.85,
  hitFloor: 0.15,
};

// --- ship state -------------------------------------------------------------

export interface SimShip {
  cls: ShipClass;
  pos: V3;
  quat: Q4;
  speed: number;
  pitchRate: number;
  rollRate: number;
  hp: number;
  laserTemp: number;
  laserCooldown: number;
  alive: boolean;
  /** stats for fitness/telemetry */
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  damageTaken: number;
}

export function makeShip(cls: ShipClass, pos: V3, quat: Q4): SimShip {
  return {
    cls, pos, quat,
    speed: cls.maxSpeed * 0.5,
    pitchRate: 0, rollRate: 0,
    hp: cls.hp, laserTemp: 0, laserCooldown: 0, alive: true,
    shotsFired: 0, shotsHit: 0, damageDealt: 0, damageTaken: 0,
  };
}

export function forward(s: SimShip): V3 {
  return qRotate(s.quat, v3(0, 0, -1));
}

/** Discrete control input — matches the keyboard model. */
export interface Control {
  pitch: -1 | 0 | 1;
  roll: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  fire: boolean;
}

const RATE_RAMP = 4.0;
/**
 * MUST equal RATE_DECAY in player.ts — invariant 2, and `npm test` asserts it.
 *
 * This was 5.0 while the game moved to 12.0, so every brain shipped so far was
 * fitted against a player who coasts 2.4x longer after releasing a key than
 * the real one. It is the `accel: 120` bug (docs/TRAINING-LOG.md) repeated in
 * the very next field, and the parity test asserted ACCEL and MAX_SPEED on
 * either side of it without asserting this. Found by audit, not by CI.
 */

function ramp(
  current: number, target: number, active: boolean, dt: number, decay: number,
): number {
  const rate = active ? RATE_RAMP : decay;
  const next = current + (target - current) * Math.min(1, rate * dt);
  return Math.abs(next) < 0.001 && !active ? 0 : next;
}

/** Integrate one ship one step under a discrete control. */
export function stepShip(s: SimShip, c: Control, dt: number): void {
  const maxPitch = s.cls.turnRate * TURN.pitch;
  const maxRoll = s.cls.turnRate * TURN.roll;
  const decay = s.cls.rateDecay ?? NPC_RATE_DECAY;
  s.pitchRate = ramp(s.pitchRate, c.pitch * maxPitch, c.pitch !== 0, dt, decay);
  s.rollRate = ramp(s.rollRate, c.roll * maxRoll, c.roll !== 0, dt, decay);
  if (c.throttle > 0) s.speed = Math.min(s.cls.maxSpeed, s.speed + s.cls.accel * dt);
  if (c.throttle < 0) s.speed = Math.max(s.cls.minSpeed ?? 0, s.speed - s.cls.accel * dt);

  if (s.rollRate !== 0) s.quat = qMul(s.quat, qAxisAngle(v3(0, 0, 1), s.rollRate * dt));
  if (s.pitchRate !== 0) s.quat = qMul(s.quat, qAxisAngle(v3(1, 0, 0), s.pitchRate * dt));
  s.quat = qNormalize(s.quat);

  s.pos = vAdd(s.pos, vScale(forward(s), s.speed * dt));
  s.laserCooldown -= dt;
  s.laserTemp = Math.max(0, s.laserTemp - LASER.coolRate * dt);
}

/**
 * Fire the laser at a target: same cone test as the game's player laser.
 * Deterministic — a policy can genuinely learn to aim.
 * @returns damage dealt (0 on miss / not able to fire)
 */
export function fireLaser(
  s: SimShip,
  target: SimShip,
  dt: number,
  rng: () => number = () => 0.5,
): number {
  void dt;
  if (s.cls.gun === 'npc') return fireNpcLaser(s, target, rng);
  if (s.laserCooldown > 0 || s.laserTemp >= 0.98) return 0;
  s.laserCooldown = LASER.cooldown;
  s.laserTemp = Math.min(1, s.laserTemp + LASER.heat);
  s.shotsFired += 1;
  const to = vSub(target.pos, s.pos);
  const dist = vLen(to);
  if (dist > LASER.range || !target.alive) return 0;
  const cone = Math.max(0.02, Math.atan((target.cls.radius * LASER.aim) / dist));
  const angle = Math.acos(Math.min(1, Math.max(-1, vDot(forward(s), vNorm(to)))));
  if (angle >= cone) return 0;
  s.shotsHit += 1;
  s.damageDealt += LASER.damage;
  target.damageTaken += LASER.damage;
  target.hp -= LASER.damage;
  if (target.hp <= 0) target.alive = false;
  return LASER.damage;
}

/**
 * The NPC gun: loose gate, slow cadence, probabilistic hit by range.
 *
 * `rng` is the episode's seeded stream, not Math.random, so episodes stay
 * reproducible — the shots are stochastic, the *run* is not.
 */
function fireNpcLaser(s: SimShip, target: SimShip, rng: () => number): number {
  if (s.laserCooldown > 0) return 0;
  const to = vSub(target.pos, s.pos);
  const dist = vLen(to);
  const angle = Math.acos(Math.min(1, Math.max(-1, vDot(forward(s), vNorm(to)))));
  // as in npc.ts: outside the gate or out of range it never pulls the trigger,
  // so it does not spend the cooldown either
  if (angle >= NPC_GUN.gate || dist > NPC_GUN.range || !target.alive) return 0;

  s.laserCooldown = NPC_GUN.cooldownLo + rng() * NPC_GUN.cooldownSpread;
  s.shotsFired += 1;
  const chance = Math.min(NPC_GUN.hitCap,
    Math.max(NPC_GUN.hitFloor, NPC_GUN.hitBase - dist / NPC_GUN.hitFalloff));
  if (rng() >= chance) return 0;

  const damage = NPC_GUN.damageLo + rng() * NPC_GUN.damageSpread;
  s.shotsHit += 1;
  s.damageDealt += damage;
  target.damageTaken += damage;
  target.hp -= damage;
  if (target.hp <= 0) target.alive = false;
  return damage;
}

/**
 * Resolve one pair of ships overlapping. Both take damage and are shoved
 * apart — symmetric, unlike the game where the player's shields absorb it.
 * @returns true if they were touching
 */
export function resolveCollision(
  a: SimShip,
  b: SimShip,
  damageA = COLLISION.damage,
  damageB = COLLISION.damage,
): boolean {
  if (!a.alive || !b.alive) return false;
  const delta = vSub(a.pos, b.pos);
  const gap = vLen(delta);
  const contact = a.cls.radius + b.cls.radius;
  if (gap >= contact) return false;

  const away = gap > 1e-3 ? vScale(delta, 1 / gap) : v3(1, 0, 0);
  const push = (contact + COLLISION.separation) / 2;
  const mid = vScale(vAdd(a.pos, b.pos), 0.5);
  a.pos = vAdd(mid, vScale(away, push));
  b.pos = vSub(mid, vScale(away, push));
  a.speed *= COLLISION.speedRetained;
  b.speed *= COLLISION.speedRetained;
  for (const [s, dmg] of [[a, damageA], [b, damageB]] as [SimShip, number][]) {
    s.hp -= dmg;
    s.damageTaken += dmg;
    if (s.hp <= 0) s.alive = false;
  }
  return true;
}

/** Steer a scripted ship toward a point (axis-angle limited, like rotateTowards). */
export function steerToward(s: SimShip, point: V3, dt: number): void {
  const desired = vNorm(vSub(point, s.pos));
  const fwd = forward(s);
  const d = Math.min(1, Math.max(-1, vDot(fwd, desired)));
  const angle = Math.acos(d);
  if (angle < 1e-4) return;
  const axis = vNorm(vCross(fwd, desired));
  const step = Math.min(angle, s.cls.turnRate * dt);
  s.quat = qNormalize(qMul(qAxisAngle(axis, step), s.quat));
}

/** Angle between a ship's nose and the direction to a point. */
export function facingAngle(s: SimShip, point: V3): number {
  const d = Math.min(1, Math.max(-1, vDot(forward(s), vNorm(vSub(point, s.pos)))));
  return Math.acos(d);
}
