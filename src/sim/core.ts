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

export interface ShipClass {
  name: string;
  hp: number;
  maxSpeed: number;
  /** pitch rate cap, rad/s; roll cap is 2x this */
  turnRate: number;
  radius: number;
  accel: number;
}

export const CLASSES: Record<string, ShipClass> = {
  pirateCobra: { name: 'Cobra Mk III', hp: 1.1, maxSpeed: 260, turnRate: 0.8, radius: 34, accel: 120 },
  pirateSidewinder: { name: 'Sidewinder', hp: 0.55, maxSpeed: 300, turnRate: 1.1, radius: 18, accel: 140 },
  traderCobra: { name: 'Cobra Mk III', hp: 1.0, maxSpeed: 220, turnRate: 0.5, radius: 34, accel: 100 },
};

// laser model — mirrors the player's pulse laser in game.ts
export const LASER = {
  damage: 0.16,
  cooldown: 0.24,
  heat: 0.055,
  coolRate: 0.22,
  range: 3500,
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
const RATE_DECAY = 5.0;

function ramp(current: number, target: number, active: boolean, dt: number): number {
  const rate = active ? RATE_RAMP : RATE_DECAY;
  const next = current + (target - current) * Math.min(1, rate * dt);
  return Math.abs(next) < 0.001 && !active ? 0 : next;
}

/** Integrate one ship one step under a discrete control. */
export function stepShip(s: SimShip, c: Control, dt: number): void {
  const maxPitch = s.cls.turnRate * 1.4;
  const maxRoll = s.cls.turnRate * 2.4;
  s.pitchRate = ramp(s.pitchRate, c.pitch * maxPitch, c.pitch !== 0, dt);
  s.rollRate = ramp(s.rollRate, c.roll * maxRoll, c.roll !== 0, dt);
  if (c.throttle > 0) s.speed = Math.min(s.cls.maxSpeed, s.speed + s.cls.accel * dt);
  if (c.throttle < 0) s.speed = Math.max(0, s.speed - s.cls.accel * dt);

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
export function fireLaser(s: SimShip, target: SimShip, dt: number): number {
  void dt;
  if (s.laserCooldown > 0 || s.laserTemp >= 0.98) return 0;
  s.laserCooldown = LASER.cooldown;
  s.laserTemp = Math.min(1, s.laserTemp + LASER.heat);
  s.shotsFired += 1;
  const to = vSub(target.pos, s.pos);
  const dist = vLen(to);
  if (dist > LASER.range || !target.alive) return 0;
  const cone = Math.max(0.02, Math.atan((target.cls.radius * 1.6) / dist));
  const angle = Math.acos(Math.min(1, Math.max(-1, vDot(forward(s), vNorm(to)))));
  if (angle >= cone) return 0;
  s.shotsHit += 1;
  s.damageDealt += LASER.damage;
  target.damageTaken += LASER.damage;
  target.hp -= LASER.damage;
  if (target.hp <= 0) target.alive = false;
  return LASER.damage;
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
