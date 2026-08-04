// Spending a stated impact: the step from a row of `IMPACT` to a branded,
// whole-point number one of the two damage models will accept.
//
// The numbers themselves are `constants/impact.ts` — Harmless policy, with the
// anchors and the argument beside the values. What this file owns is the UNIT
// DISCIPLINE: an impact row is plain data, and the only way it becomes
// spendable is through one of the two functions below, each minting the brand
// (`damage-units.ts`) for exactly one of the two incomparable banks.
//
// The functions take NO TARGET. That is the structural reason a ram cannot be
// halved by the Constrictor's flag or shrugged off by a station's immunity:
// there is nothing to consult. Both of those ride on the player's LASER only
// (`npc-energy.ts`), and `test/damage-paths.test.ts` holds the separation.
//
// A row with `null` in a column is "there is no such path", not "we did not
// decide": the type system refuses it at the call site, because `null` is not
// a `number`, and the mint refuses it at runtime for anything that gets past.

import {
  npcEnergyPoints, playerPoolPoints,
  type NpcEnergyPoints, type PlayerPoolPoints,
} from './damage-units.ts';

/** An impact that can reach a ship's energy bank. */
interface ShipImpact {
  readonly name: string;
  readonly ship: number;
}

/** An impact that can reach the commander's pools. */
interface CommanderImpact {
  readonly name: string;
  readonly commander: number;
}

/** What one impact takes off a ship's energy bank. */
export function npcImpactDamage(impact: ShipImpact): NpcEnergyPoints {
  return npcEnergyPoints(impact.ship);
}

/** What one impact takes off the commander's pools. */
export function playerImpactDamage(impact: CommanderImpact): PlayerPoolPoints {
  return playerPoolPoints(impact.commander);
}
