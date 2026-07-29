// What turns up, and when.
//
// The rules that keep a system feeling inhabited: traders arriving from deep
// space, pirate waves in lawless space, and Thargon drones peeling off a
// mothership. All three ran inline in updateFlight as timers interleaved with
// collision resolution and shield regeneration.
//
// The split is the one used throughout: this decides WHETHER something should
// appear and what it should be, the Game makes it exist. Nothing here can
// reach the scene, so the rules are testable — and these particular rules had
// none, despite deciding how dangerous every system in the galaxy feels.

import { random } from './rng.ts';

/** Countdowns, owned by the caller so they survive across frames. */
export interface EncounterTimers {
  trader: number;
  pirateWave: number;
  thargon: number;
}

/** What the system looks like right now. */
export interface SystemConditions {
  /** nothing spawns in witch-space except what is already hunting you */
  witchspace: boolean;
  /** 1984 productivity: busier economies run busier space lanes */
  productivity: number;
  /** 0 = anarchy … 7 = corporate state */
  government: number;
  traderCount: number;
  activeThargons: number;
  hasThargoidMother: boolean;
  /** pirates do not jump a commander sitting on the station's doorstep */
  playerFarFromStation: boolean;
}

export type SpawnOrder =
  | { kind: 'trader' }
  | { kind: 'pirateWave'; count: number }
  | { kind: 'thargon' };

/** Traders already in the system, above which no more arrive. */
export const MAX_TRADERS = 4;
export const MAX_THARGONS = 4;
/** Governments at or below this breed pirate waves; anarchies (0-1) send two. */
export const LAWLESS_GOVERNMENT = 3;
export const ANARCHY_GOVERNMENT = 1;
/** A commander closer than this to the station is not worth ambushing. */
export const AMBUSH_STANDOFF = 7000;

export function freshTimers(rng: () => number = random): EncounterTimers {
  return { trader: 20 + rng() * 40, pirateWave: 60, thargon: 5 };
}

/**
 * Advance the timers and report anything that should now appear.
 *
 * @param rng injectable, so the gating can be tested without waiting for luck.
 */
export function stepEncounters(
  timers: EncounterTimers,
  dt: number,
  c: SystemConditions,
  rng: () => number = random,
): SpawnOrder[] {
  const orders: SpawnOrder[] = [];

  if (!c.witchspace) {
    timers.trader -= dt;
    if (timers.trader <= 0) {
      // a productive system discounts up to 50s off the gap between arrivals
      const busyness = Math.min(50, c.productivity / 1200);
      timers.trader = 100 - busyness + rng() * 60;
      if (c.traderCount < MAX_TRADERS) orders.push({ kind: 'trader' });
    }

    // piracy pressure scales with lawlessness: anarchies breed pirate waves,
    // and the gap between them grows by 40s for every step up the ladder
    timers.pirateWave -= dt;
    if (timers.pirateWave <= 0) {
      timers.pirateWave = 60 + c.government * 40 + rng() * 90;
      if (c.government <= LAWLESS_GOVERNMENT && c.playerFarFromStation) {
        orders.push({ kind: 'pirateWave', count: c.government <= ANARCHY_GOVERNMENT ? 2 : 1 });
      }
    }
  }

  // Thargoid motherships deploy drones, and keep deploying while they live
  if (c.hasThargoidMother) {
    timers.thargon -= dt;
    if (timers.thargon <= 0 && c.activeThargons < MAX_THARGONS) {
      timers.thargon = 5;
      orders.push({ kind: 'thargon' });
    }
  }

  return orders;
}
