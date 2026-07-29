// The jump: what it costs, whether you can make it, and where you come out.
//
// The countdown, the fuel, the days that pass and the roll that drops you into
// witch-space were four separate concerns interleaved across two methods of
// game.ts, sharing one `if (this.witchspace)` between them. Witch-space is the
// awkward case — the target is *retained* for an escape jump that costs a flat
// rate instead of the chart distance — and having it stated once, here, is
// most of the reason this file exists.
//
// The metric itself is galaxy/navigation.ts; this is the transaction.

import type { CommanderData } from './commander.ts';
import type { StarSystem } from '../galaxy/galaxy.ts';
import {
  distanceTenths, daysForJump, witchspaceChance, WITCHSPACE_ESCAPE_COST,
} from '../galaxy/navigation.ts';
import { random } from './rng.ts';

/** Seconds of warning before the drive engages. */
export const COUNTDOWN = 5;

export type Refusal = 'alreadyJumping' | 'noTarget' | 'noFuel';

/** Fuel for a jump, in tenths of a LY. Escaping a mis-jump is a flat rate. */
export function jumpCost(
  from: StarSystem, to: StarSystem, witchspace: boolean,
): number {
  return witchspace ? WITCHSPACE_ESCAPE_COST : distanceTenths(from, to);
}

/**
 * May the drive spin up? Pure — it answers, it does not start anything.
 *
 * @param target the chart's selected system, or null
 */
export function checkJump(
  commander: CommanderData,
  systems: readonly StarSystem[],
  target: number | null,
  witchspace: boolean,
  countdownRunning: boolean,
): { ok: true; cost: number } | { ok: false; reason: Refusal } {
  if (countdownRunning) return { ok: false, reason: 'alreadyJumping' };
  if (target === null || target === commander.systemIndex) {
    return { ok: false, reason: 'noTarget' };
  }
  const cost = jumpCost(systems[commander.systemIndex], systems[target], witchspace);
  if (cost > commander.fuel) return { ok: false, reason: 'noFuel' };
  return { ok: true, cost };
}

export function refusalMessage(reason: Refusal, witchspace: boolean): string {
  if (reason === 'noTarget') return 'NO HYPERSPACE TARGET SET';
  return witchspace
    ? 'INSUFFICIENT FUEL — STRANDED IN WITCH-SPACE'
    : 'TARGET OUT OF FUEL RANGE';
}

export interface JumpResult {
  /** the drive threw you into limbo; the target is retained for the escape */
  misjump: boolean;
  /** days that passed — zero for a mis-jump, which gets you nowhere */
  days: number;
}

/**
 * Spend the fuel and make the jump. Mutates the commander's fuel, day and
 * system; the caller advances the living galaxy by `days` and rebuilds the
 * world, because those are its own.
 *
 * A mis-jump still charges full fare. That is the original's cruelty and it is
 * the point: the fuel is gone and you are nowhere.
 */
export function resolveJump(
  commander: CommanderData,
  systems: readonly StarSystem[],
  target: number,
  witchspace: boolean,
  rng: () => number = random,
): JumpResult {
  const here = systems[commander.systemIndex];

  if (witchspace) {
    // escaping limbo costs a flat rate, and cannot itself mis-jump
    commander.fuel -= Math.min(commander.fuel, WITCHSPACE_ESCAPE_COST);
  } else {
    commander.fuel -= distanceTenths(here, systems[target]);
    if (rng() < witchspaceChance(commander.mission.stage)) {
      return { misjump: true, days: 0 };
    }
  }

  const days = daysForJump(distanceTenths(here, systems[target]));
  commander.day += days;
  commander.systemIndex = target;
  return { misjump: false, days };
}
