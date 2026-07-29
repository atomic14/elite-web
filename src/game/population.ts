// How busy a system is when you arrive in it.
//
// Who is already here — traders on their runs, police on patrol, rocks, and
// the reception waiting for you — is decided by the government, by what the
// living galaxy has recorded happening around here lately, and by what you are
// visibly worth. Those are rules; putting ships in the scene is not.
//
// So this returns a PLAN and the Game builds it, which is the same split used
// by encounters.ts for the arrivals that happen while you fly.

import type { StarSystem } from '../galaxy/galaxy.ts';
import type { PirateThreat } from './contracts.ts';

export interface PopulationPlan {
  traders: number;
  police: number;
  asteroids: number;
  /** the reception committee — arrivals only; launching from a station is safe */
  pirates: number;
  /** null when launching, since nobody organised for you */
  threat: PirateThreat | null;
}

/** Never fewer than one trader, never more than four. */
export const MIN_TRADERS = 1;
export const MAX_TRADERS = 4;

/**
 * Police presence by government. Anarchies (0) have none at all, which is what
 * makes them worth the risk and dangerous to linger in; a feudal or multi-gov
 * system (1) manages a single patrol; anything more organised runs two.
 */
export function policeFor(government: number): number {
  if (government >= 2) return 2;
  if (government >= 1) return 1;
  return 0;
}

/**
 * @param arrivalCount convoys the living galaxy says are due here — this is
 * the level-1 simulation showing up as traffic you can actually see.
 * @param threat the reception, already computed by contracts.ts (it is a
 * shared rule: the headless campaign runs the same function).
 */
export function planPopulation(
  sys: StarSystem,
  situation: 'launch' | 'arrival',
  arrivalCount: number,
  threat: PirateThreat | null,
  rng: () => number = Math.random,
): PopulationPlan {
  return {
    traders: Math.max(MIN_TRADERS,
      Math.min(MAX_TRADERS, arrivalCount || (rng() < 0.5 ? 2 : 1))),
    police: policeFor(sys.government),
    asteroids: 2 + Math.floor(rng() * 3),
    pirates: situation === 'arrival' && threat ? threat.count : 0,
    threat: situation === 'arrival' ? threat : null,
  };
}
