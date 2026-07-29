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

import { makeRng } from '../sim/core.ts';

let current: () => number = makeRng(0x9e3779b9);
let currentSeed = 0x9e3779b9;

/**
 * Reseed the world. Called when a commander is loaded or a system entered, so
 * a given save in a given system unfolds the same way twice.
 */
export function seedWorld(seed: number): void {
  currentSeed = seed >>> 0;
  current = makeRng(currentSeed);
}

/** The seed in force, for logging a run you might want to reproduce. */
export function worldSeed(): number {
  return currentSeed;
}

/** 0..1, as Math.random. */
export function random(): number {
  return current();
}

/** An integer in [0, n). */
export function randomInt(n: number): number {
  return Math.floor(current() * n);
}

/** A number in [lo, hi). */
export function randomRange(lo: number, hi: number): number {
  return lo + current() * (hi - lo);
}

/** True with probability `p`. */
export function chance(p: number): boolean {
  return current() < p;
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
  const u = current() * 2 - 1;
  const theta = current() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  out.x = r * Math.cos(theta);
  out.y = r * Math.sin(theta);
  out.z = u;
  return out;
}
