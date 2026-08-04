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
//
// The clocks and the thresholds are constants/encounters.ts; the cap on traders
// is constants/population.ts, because it is a property of what a system holds
// rather than of the clock that adds to it.

import { random } from './rng.ts';
import { MAX_TRADERS } from '../constants/population.ts';
import {
  ANARCHY_GOVERNMENT, LAWLESS_GOVERNMENT, MAX_THARGONS, PIRATE_WAVE_GAP,
  PIRATE_WAVE_GAP_JITTER, PIRATE_WAVE_GAP_PER_GOVERNMENT, PRODUCTIVITY_PER_SECOND,
  THARGON_REDEPLOY, TRADER_GAP, TRADER_GAP_BUSY_MAX, TRADER_GAP_FIRST,
  TRADER_GAP_FIRST_JITTER, TRADER_GAP_JITTER,
} from '../constants/encounters.ts';

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

export function freshTimers(rng: () => number = random): EncounterTimers {
  return {
    trader: TRADER_GAP_FIRST + rng() * TRADER_GAP_FIRST_JITTER,
    pirateWave: PIRATE_WAVE_GAP,
    thargon: THARGON_REDEPLOY,
  };
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
      // a productive system discounts off the gap between arrivals
      const busyness = Math.min(TRADER_GAP_BUSY_MAX, c.productivity / PRODUCTIVITY_PER_SECOND);
      timers.trader = TRADER_GAP - busyness + rng() * TRADER_GAP_JITTER;
      if (c.traderCount < MAX_TRADERS) orders.push({ kind: 'trader' });
    }

    // piracy pressure scales with lawlessness: anarchies breed pirate waves,
    // and the gap between them grows for every step up the ladder
    timers.pirateWave -= dt;
    if (timers.pirateWave <= 0) {
      timers.pirateWave = PIRATE_WAVE_GAP + c.government * PIRATE_WAVE_GAP_PER_GOVERNMENT
        + rng() * PIRATE_WAVE_GAP_JITTER;
      if (c.government <= LAWLESS_GOVERNMENT && c.playerFarFromStation) {
        orders.push({ kind: 'pirateWave', count: c.government <= ANARCHY_GOVERNMENT ? 2 : 1 });
      }
    }
  }

  // Thargoid motherships deploy drones, and keep deploying while they live
  if (c.hasThargoidMother) {
    timers.thargon -= dt;
    if (timers.thargon <= 0 && c.activeThargons < MAX_THARGONS) {
      timers.thargon = THARGON_REDEPLOY;
      orders.push({ kind: 'thargon' });
    }
  }

  return orders;
}
