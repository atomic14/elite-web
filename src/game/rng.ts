// The world's only source of randomness.
//
// Everything the simulation does with chance goes through here: where pirates
// spawn, what cargo a wreck drops, whether an NPC's shot connects, how long
// until the next trader arrives. `Math.random()` is banned in world code and
// `test/run.ts` enforces it.
//
// WHY: a variable timestep and an unseeded PRNG are the two things that make a
// run unrepeatable, and an unrepeatable run cannot be replayed, regression
// tested, or trained against. The timestep is fixed (see FIXED_DT); this is
// the other half.
//
// It is module state, deliberately. The alternative is threading an rng
// parameter through NpcShip, every spawn helper and every damage path — about
// fifty signatures — for a value that is genuinely global to a session. The
// seam that matters is that there is exactly ONE of these and it is seeded on
// purpose, not that it is passed by hand.
//
// The extracted rule modules (encounters.ts, population.ts, systems.ts) take
// an injectable rng instead, because they are pure and their tests want to
// control it directly. Both are right for what they are.

// The generator is written out here rather than reusing ai-training/core.ts's
// makeRng, for one reason: makeRng closes over its state, and a snapshot needs
// to READ that state. A save taken mid-flight has to resume the same stream it
// was on, or the reception waiting for you changes the moment you reload —
// which is the difference between a snapshot and a rough approximation.
//
// Same algorithm (mulberry32), so streams are identical to the trainer's.

let state = 0x9e3779b9;
let currentSeed = 0x9e3779b9;

/**
 * Reseed the world. Called on arrival, so a given save entering a given system
 * on a given day unfolds the same way twice.
 */
export function seedWorld(seed: number): void {
  currentSeed = seed >>> 0;
  state = currentSeed;
}

/** The seed in force, for logging a run you might want to reproduce. */
export function worldSeed(): number {
  return currentSeed;
}

/** Exact generator state, for a snapshot. */
export function rngState(): { seed: number; state: number } {
  return { seed: currentSeed, state };
}

/** Resume a stream exactly where a snapshot left it. */
export function restoreRng(saved: { seed: number; state: number }): void {
  currentSeed = saved.seed >>> 0;
  state = saved.state >>> 0;
}

/** 0..1, as Math.random. */
export function random(): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** An integer in [0, n). */
export function randomInt(n: number): number {
  return Math.floor(random() * n);
}

/** A number in [lo, hi). */
export function randomRange(lo: number, hi: number): number {
  return lo + random() * (hi - lo);
}

/** True with probability `p`. */
export function chance(p: number): boolean {
  return random() < p;
}

/** One of `items`, uniformly. */
export function pick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)];
}

/**
 * A unit vector pointing anywhere, written into `out`.
 *
 * Replaces `THREE.Vector3.randomDirection()`, which reaches for Math.random
 * internally and would have quietly punched a hole in every seeded run.
 * Marsaglia's method, same as three.js uses.
 */
export function randomDirection<T extends { x: number; y: number; z: number }>(out: T): T {
  const u = random() * 2 - 1;
  const theta = random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  out.x = r * Math.cos(theta);
  out.y = r * Math.sin(theta);
  out.z = u;
  return out;
}

/**
 * A uniformly random orientation, written into `out`.
 *
 * Replaces `THREE.Quaternion.random()`, which reaches for Math.random inside
 * three.js. Shoemake's method, same as three.js uses.
 */
export function randomQuaternion<T extends { x: number; y: number; z: number; w: number }>(out: T): T {
  const u1 = random(), u2 = random(), u3 = random();
  const sq1 = Math.sqrt(1 - u1), sq2 = Math.sqrt(u1);
  const t1 = Math.PI * 2 * u2, t2 = Math.PI * 2 * u3;
  out.x = sq1 * Math.sin(t1);
  out.y = sq1 * Math.cos(t1);
  out.z = sq2 * Math.sin(t2);
  out.w = sq2 * Math.cos(t2);
  return out;
}
