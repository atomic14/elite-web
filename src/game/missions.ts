// The Navy mission: find the Constrictor, kill it, carry the plans home.
//
// A five-stage state machine that was spread across three private methods of
// game.ts and one branch of destroyNpc, with the only piece that had escaped
// — the raised mis-jump chance during the courier run — already living in
// galaxy/navigation.ts. That stray was the clue that the rest belonged
// somewhere.
//
// Pure: it takes the commander and the galaxy, and returns what happened. The
// Game announces it and pays it, because credits and legal status are its
// business. That also means the headless campaign can score the mission,
// which it could not before.
//
//   stage 0  not started — needs 16 kills, and galaxy 1
//   stage 1  hunting the Constrictor at a known system
//   stage 2  destroyed; report back for the next orders
//   stage 3  carrying the plans to a named system
//   stage 4  done

import type { CommanderData } from './commander.ts';
import type { StarSystem } from '../galaxy/galaxy.ts';
import { distanceTenths } from '../galaxy/navigation.ts';
import { playerLaser } from './gunnery.ts';
import { npcEnergyPolicy, playerLaserDamage } from './npc-energy.ts';
import { random } from './rng.ts';
import { CONSTRICTOR_SPEC } from './ship-specs.ts';
import type { LaserType } from './commander.ts';

/** Kills before the Navy considers you worth talking to. */
export const MISSION_KILL_THRESHOLD = 16;
/** The Constrictor hides this far from where you are briefed, in tenths of a LY. */
export const HUNT_RANGE = { min: 30, max: 80 };
/** The courier run is longer. */
export const COURIER_RANGE = { min: 50, max: 90 };
export const CONSTRICTOR_BOUNTY = 25_000;
export const COURIER_PAYMENT = 15_000;

export type MissionEvent =
  | { kind: 'briefed'; target: number }
  | { kind: 'courierOrders'; target: number }
  | { kind: 'delivered'; payment: number }
  | { kind: 'constrictorDestroyed'; bounty: number };

/** A system between `min` and `max` tenths away, or null if the galaxy has none. */
function pickTarget(
  systems: readonly StarSystem[], here: StarSystem, currentIndex: number,
  range: { min: number; max: number }, rng: () => number,
): number | null {
  const candidates = systems.filter((s) => {
    const d = distanceTenths(here, s);
    return s.index !== currentIndex && d >= range.min && d <= range.max;
  });
  if (!candidates.length) return null;
  return candidates[Math.floor(rng() * candidates.length)].index;
}

/**
 * Advance the mission on docking. Mutates `commander.mission`, and reports
 * what changed so the Game can announce and pay it.
 */
export function stepMissionAtDock(
  commander: CommanderData,
  systems: readonly StarSystem[],
  rng: () => number = random,
): MissionEvent[] {
  const m = commander.mission;
  const here = systems[commander.systemIndex];
  const events: MissionEvent[] = [];

  if (m.stage === 0 && commander.kills >= MISSION_KILL_THRESHOLD && commander.galaxy === 1) {
    const target = pickTarget(systems, here, commander.systemIndex, HUNT_RANGE, rng);
    if (target !== null) {
      m.targetIndex = target;
      m.stage = 1;
      events.push({ kind: 'briefed', target });
    }
  } else if (m.stage === 2) {
    const target = pickTarget(systems, here, commander.systemIndex, COURIER_RANGE, rng);
    if (target !== null) {
      m.targetIndex = target;
      m.stage = 3;
      events.push({ kind: 'courierOrders', target });
    }
  } else if (m.stage === 3 && m.targetIndex === commander.systemIndex) {
    m.stage = 4;
    m.targetIndex = null;
    commander.credits += COURIER_PAYMENT;
    events.push({ kind: 'delivered', payment: COURIER_PAYMENT });
  }
  return events;
}

/** The Constrictor died. @returns the event, or null if it was not the target. */
export function constrictorDestroyed(
  commander: CommanderData,
): { kind: 'constrictorDestroyed'; bounty: number } | null {
  if (commander.mission.stage !== 1) return null;
  commander.mission.stage = 2;
  commander.mission.targetIndex = null;
  commander.credits += CONSTRICTOR_BOUNTY;
  return { kind: 'constrictorDestroyed', bounty: CONSTRICTOR_BOUNTY };
}

/** Is the Constrictor lurking in this system right now? */
export function constrictorLurksHere(commander: CommanderData): boolean {
  return commander.mission.stage === 1
    && commander.mission.targetIndex === commander.systemIndex;
}

/**
 * What each laser this hull can mount is worth against the Constrictor.
 *
 * DERIVED, every time, through the same two functions a live shot goes through:
 * the fitted laser's byte (`playerLaser`) and what a hit off it is worth against
 * the target's own profile (`playerLaserDamage`, which is the oracle). Nothing
 * here restates a rule and nothing here CHANGES one — TODO 29 rules the
 * Constrictor's source-exact halving untouchable and calls this a signposting
 * problem instead.
 *
 * It is a signposting problem with teeth. The Constrictor halves a player hit
 * BEFORE its three points of defence subtract, so a BEAM laser's 7 becomes 3
 * and does exactly nothing, a pulse laser scores 1 and needs 115 unbroken hits,
 * and only the military laser's 3 kills it in a reasonable time — as in the
 * original. The one thing a commander must not do is fly forty light years to
 * find that out, and the beam laser is the trap, because it is the upgrade and
 * it is worse here than the gun it replaced.
 */
export function constrictorGunCheck(
  commander: CommanderData,
): { fitted: LaserType; perHit: number; best: LaserType; bestPerHit: number } {
  const policy = npcEnergyPolicy(CONSTRICTOR_SPEC.profileId);
  const bite = (type: LaserType): number =>
    playerLaserDamage(policy, playerLaser(commander.shipId, type).hit);
  const MOUNTS: LaserType[] = ['pulse', 'beam', 'military'];
  const best = MOUNTS.reduce((a, b) => (bite(b) > bite(a) ? b : a));
  return {
    fitted: commander.equipment.laser,
    perHit: bite(commander.equipment.laser),
    best,
    bestPerHit: bite(best),
  };
}

/**
 * What the Navy tells you about the job, beyond where to go.
 *
 * It states the two NUMBERS and lets the commander decide, rather than issuing
 * an instruction: the figure her gun scores against this hull, and the figure
 * the best gun she could fit scores. Both come from the oracle.
 *
 * '' when she is already carrying the best gun for it — so the line means
 * something the day it appears, instead of being one the player learns to skip.
 */
export function constrictorWarning(commander: CommanderData): string {
  const g = constrictorGunCheck(commander);
  if (g.fitted === g.best) return '';
  return `NAVY: TARGET ARMOUR HALVES LASER FIRE — YOUR ${g.fitted.toUpperCase()} LASER`
    + ` SCORES ${g.perHit} A HIT, A ${g.best.toUpperCase()} LASER ${g.bestPerHit}`;
}

/** The mission line for the docked menu, or '' when there is nothing to say. */
export function missionHeadline(
  commander: CommanderData, systems: readonly StarSystem[],
): string {
  const m = commander.mission;
  if (m.stage === 1 && m.targetIndex !== null) {
    const warning = constrictorWarning(commander);
    return `NAVY MISSION: DESTROY THE CONSTRICTOR — LAST SEEN AT ${systems[m.targetIndex].name.toUpperCase()}`
      + (warning ? ` · ${warning.replace('NAVY: ', '')}` : '');
  }
  if (m.stage === 3 && m.targetIndex !== null) {
    return `NAVY MISSION: DELIVER THE PLANS TO ${systems[m.targetIndex].name.toUpperCase()}`;
  }
  return '';
}
