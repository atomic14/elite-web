// How busy a system is when you arrive in it.
//
// Who is already here — traders on their runs, police on patrol, rocks, and
// the reception waiting for you — is decided by the government, by what the
// living galaxy has recorded happening around here lately, and by what you are
// visibly worth. Those are rules; putting ships in the scene is not.
//
// So this returns a PLAN and the Game builds it, which is the same split used
// by encounters.ts for the arrivals that happen while you fly.
//
// The counts and chances themselves are constants/population.ts. What stayed
// here is `policeFor`, whose two thresholds are the branches of the ladder
// rather than values anything outside this file can act on, and the coin
// between one trader and two when the living galaxy has no convoy due — the
// tie-break inside an expression whose real rule is MIN_TRADERS/MAX_TRADERS.

import type { StarSystem } from '../galaxy/galaxy.ts';
import { random } from './rng.ts';
import type { PirateThreat } from './threat.ts';
import {
  ASTEROIDS_MIN, ASTEROIDS_VARIATION, GENERATION_SHIP_CHANCE, HERMIT_CHANCE,
  HUNTER_CHANCE_ARRIVAL, HUNTER_CHANCE_LAUNCH, MAX_TRADERS, MIN_TRADERS,
} from '../constants/population.ts';

export interface PopulationPlan {
  traders: number;
  police: number;
  asteroids: number;
  /** the reception committee — arrivals only; launching from a station is safe */
  pirates: number;
  /** a lone bounty hunter working the system */
  hunter: boolean;
  /** a hollowed-out rock that trades ore and asks no questions */
  hermit: boolean;
  /** centuries under way, still shedding cargo — arrivals only */
  generationShip: boolean;
  /** null when launching, since nobody organised for you */
  threat: PirateThreat | null;
}

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
  rng: () => number = random,
): PopulationPlan {
  return {
    traders: Math.max(MIN_TRADERS,
      Math.min(MAX_TRADERS, arrivalCount || (rng() < 0.5 ? 2 : 1))),
    police: policeFor(sys.government),
    asteroids: ASTEROIDS_MIN + Math.floor(rng() * ASTEROIDS_VARIATION),
    pirates: situation === 'arrival' && threat ? threat.count : 0,
    threat: situation === 'arrival' ? threat : null,
    // These three were rolled inline in game.ts, outside the plan — so the
    // headless campaign measured a galaxy with no bounty hunters and no
    // hermits, while the game spawned both. A hunter is hostile to any
    // offender, so that was not cosmetic.
    hunter: rng() < (situation === 'arrival' ? HUNTER_CHANCE_ARRIVAL : HUNTER_CHANCE_LAUNCH),
    hermit: rng() < HERMIT_CHANCE,
    generationShip: situation === 'arrival' && rng() < GENERATION_SHIP_CHANCE,
  };
}
