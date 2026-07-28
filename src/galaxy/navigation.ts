// How far apart two systems are, and what it costs to jump between them.
//
// Extracted because this rule had grown THREE implementations, all of them
// correct and none of them the owner:
//
//   ui/screens.ts   distanceTenths       — what the charts and the game used
//   game/contracts.ts chartDistanceTenths — what the campaign simulator used
//   game/game.ts    galacticJump()        — hand-inlined, squared, to pick the
//                                           nearest system in the new galaxy
//
// Byte-identical today, kept so by nothing. That is the same failure mode as
// invariant 2, and it matters more here than it looks: `test/campaign.ts`
// validates the whole economy against its own copy, so a drift would leave the
// balance harness silently measuring a different game from the one shipped.
//
// It lives under galaxy/ because it is a property of the star map, not of the
// UI that draws it or the ship that flies it. Everything above may import it;
// it imports nothing but the system type.

import type { StarSystem } from './galaxy';

/**
 * Chart distance in tenths of a light-year, after the original's asymmetric
 * metric: y counts half (the chart is drawn half-height), scaled so max fuel
 * 70 = the classic 7.0 LY range.
 */
export function distanceTenths(a: StarSystem, b: StarSystem): number {
  const dx = a.x - b.x;
  const dy = (a.y - b.y) / 2;
  return Math.round(4 * Math.sqrt(dx * dx + dy * dy));
}

/**
 * The same metric left squared and unrounded, for "which of these is
 * nearest" comparisons. Avoids 256 square roots and, more usefully, avoids a
 * second hand-rolled copy of the formula at the call site.
 */
export function distanceSq(a: StarSystem, b: StarSystem): number {
  const dx = a.x - b.x;
  const dy = (a.y - b.y) / 2;
  return dx * dx + dy * dy;
}

/**
 * Squared chart distance from a system to a bare chart coordinate.
 *
 * The charts need this for cursor hit-testing, where there is no second
 * StarSystem to measure against — which is exactly why a fourth copy of the
 * formula had grown in ui/screens.ts.
 */
export function distanceSqToPoint(s: StarSystem, x: number, y: number): number {
  const dx = s.x - x;
  const dy = (s.y - y) / 2;
  return dx * dx + dy * dy;
}

/** The system nearest `from` in `systems`, by the chart metric. */
export function nearestSystemTo(from: StarSystem, systems: readonly StarSystem[]): StarSystem {
  let best = systems[0];
  let bestD = Infinity;
  for (const s of systems) {
    const d = distanceSq(from, s);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

/**
 * Days a jump takes. One day to make it, plus one per 2.0 LY covered.
 *
 * Duplicated in game.ts and test/campaign.ts before this existed, which meant
 * the campaign's careers aged at whatever rate its own copy said.
 */
export function daysForJump(tenths: number): number {
  return 1 + Math.ceil(tenths / 20);
}

/** Flat fuel cost, in tenths of a LY, of escaping a mis-jump. */
export const WITCHSPACE_ESCAPE_COST = 10;

/**
 * Chance a jump drops you into witch-space instead.
 *
 * Raised during the Constrictor mission's final stage — the ambush is the
 * point of that leg, so it should not depend on luck alone.
 */
export function witchspaceChance(missionStage: number): number {
  return missionStage === 3 ? 0.22 : 0.09;
}
