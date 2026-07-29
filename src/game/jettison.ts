// Buying your way out of a fight.
//
// Pirates came for cargo, not for you. Give them enough of it and the
// opportunists break off to go collect, which turns "I can't win this fight"
// from a death into a decision — the most interesting thing you can do with a
// full hold and failing shields.
//
// Two rules, and they were braided together inside a 65-line method of
// game.ts: WHAT you dump (the most valuable thing first, because that is what
// buys peace) and WHETHER it is enough (an appetite that scales with what you
// arrived carrying, so a fat trader is asked for more than a poor one).
//
// Both pure. The Game spawns the canisters and says the lines.

import { COMMODITIES } from '../galaxy/galaxy.ts';

/**
 * A pirate wants this share of your arrival cargo value — an organised gang
 * considerably more than an opportunist who happened to be passing.
 */
export const OPPORTUNIST_SHARE = 0.12;
export const GANG_SHARE = 0.3;
/** ...but never less than this, so a near-empty hold is not a free pass. */
export const OPPORTUNIST_FLOOR = 400;
export const GANG_FLOOR = 1500;

/**
 * The market values a tonne at 4x its base price in tenths of a credit — the
 * same multiplier markOf() uses to size you up, so the toll and the assessment
 * agree about what your hold is worth.
 */
export const VALUE_PER_TONNE = 4;

export interface Dumped {
  /** commodity indices, one entry per tonne, most valuable first */
  tonnes: number[];
  /** total worth in tenths of a credit */
  value: number;
  /** the last thing dumped, for the message */
  lastName: string;
}

/**
 * Take `tonnes` off the hold, most valuable first. Mutates `cargo`.
 *
 * Most-valuable-first is the rule that makes jettisoning a real choice: it
 * costs you the good stuff, so it is never free to try.
 */
export function dumpCargo(cargo: number[], tonnes: number): Dumped {
  const out: Dumped = { tonnes: [], value: 0, lastName: '' };
  for (let t = 0; t < tonnes; t++) {
    let best = -1;
    let bestPrice = 0;
    for (let i = 0; i < cargo.length; i++) {
      if (cargo[i] <= 0) continue;
      if (COMMODITIES[i].basePrice > bestPrice) {
        bestPrice = COMMODITIES[i].basePrice;
        best = i;
      }
    }
    if (best < 0) break;
    cargo[best] -= 1;
    out.tonnes.push(best);
    out.value += bestPrice * VALUE_PER_TONNE;
    out.lastName = COMMODITIES[best].name.toUpperCase();
  }
  return out;
}

/** What it takes to buy off one pirate. */
export function appetiteOf(organised: boolean, arrivalCargoValue: number): number {
  return Math.max(
    organised ? GANG_FLOOR : OPPORTUNIST_FLOOR,
    arrivalCargoValue * (organised ? GANG_SHARE : OPPORTUNIST_SHARE));
}

export interface Bribe {
  /** how many broke off this time */
  bought: number;
  /** the smallest extra amount that would buy off one more, or null */
  stillWant: number | null;
}

/**
 * Who is satisfied now? Sets `satisfied` on the ones who are.
 *
 * @param jettisonedValue everything dumped this encounter, not just this dump
 * — the toll accumulates, so a second handful can finish what the first started.
 */
export function offerBribe(
  pirates: readonly { alive: boolean; organised: boolean; satisfied: boolean }[],
  jettisonedValue: number,
  arrivalCargoValue: number,
): Bribe {
  let bought = 0;
  let stillWant = Infinity;
  for (const npc of pirates) {
    if (!npc.alive || npc.satisfied) continue;
    const appetite = appetiteOf(npc.organised, arrivalCargoValue);
    if (jettisonedValue >= appetite) {
      npc.satisfied = true;
      bought += 1;
    } else {
      stillWant = Math.min(stillWant, appetite - jettisonedValue);
    }
  }
  return { bought, stillWant: Number.isFinite(stillWant) ? stillWant : null };
}
