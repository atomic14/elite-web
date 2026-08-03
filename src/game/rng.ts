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

// There are two shapes of generator here and only ONE algorithm (mulberry32).
//
// The world's own stream is module state, because a snapshot needs to READ that
// state: a save taken mid-flight has to resume the same stream it was on, or
// the reception waiting for you changes the moment you reload — which is the
// difference between a snapshot and a rough approximation. A closure cannot be
// read, so the world's stream cannot be one.
//
// `makeRng` is the other shape: an INDEPENDENT stream, for a harness that wants
// chance of its own without disturbing the world's — the campaign playtest, an
// episode's opponent draw. It used to live in ai-training/core.ts as a second
// copy of the same eight lines, which is exactly the duplication this file's
// header complains about. One algorithm, one home, two shapes.

/** One mulberry32 advance. */
function nextState(s: number): number {
  return (s + 0x6d2b79f5) >>> 0;
}

/** The value at a given state. */
function valueOf(s: number): number {
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * A private stream, seeded and closed over.
 *
 * Use it when the chance is the HARNESS's rather than the world's: test seeds,
 * an opponent rotation, a tournament draw. World code uses `random()`.
 */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = nextState(s);
    return valueOf(s);
  };
}

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
  state = nextState(state);
  return valueOf(state);
}

/** An integer in [0, n). */
export function randomInt(n: number): number {
  return Math.floor(random() * n);
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
