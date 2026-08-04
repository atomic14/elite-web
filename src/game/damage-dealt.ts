// What the commander landed on a ship — the four causes, and the measurement.
//
// The other direction has had a home since TODO 28: `DamageSource` in combat.ts
// names the five things that can hurt YOU, and every `applyPlayerDamage` call
// carries one. Outbound had nothing. The laser measured itself inside the
// exercise, and the missile, the ram and the energy bomb went straight to
// `takeDamage` and then to the kill — so a record of a fight won with ordnance
// read `damageDealt: 0` beside `kills: 1`, which is the report saying nothing
// happened (TODO 47).
//
// Two things live here, and they are the same rule seen twice:
//
//   * `DealtSource` — the causes. NOT `DamageSource`: you cannot deal a canister
//     on the hull or a Coriolis scrape, and nothing can drop an energy bomb on
//     you. The three words the two lists share are the same words by
//     construction (`Extract`), so a rename of one cannot leave the report
//     printing two spellings of `ram`.
//   * `dealToNpc()` — spend the points and say what they COST. What it reports is
//     the reduction in the target's own bank, not the number spent on it: a
//     250-point warhead into a Sidewinder with 73 energy left did 73 points of
//     damage, and crediting 250 would put more damage on that opponent's line
//     than the ship ever had. That is also exactly what the laser path already
//     measures (combat-sim.ts `pullTrigger` reads the bank either side of the
//     discharge), so the four buckets are comparable.
//
// It applies and reports; it decides nothing else. Who is billed, whether a
// bounty is paid and whether anyone was watching are the caller's — the ram and
// the warhead go on to `StepHost.destroyNpc` through a returned event, the way
// `npcFired` already reaches a measuring caller (docs/INVARIANTS.md invariant 15).

import type * as THREE from 'three';

import type { DamageSource } from './combat.ts';
import type { NpcEnergyPoints } from './damage-units.ts';
import type { NpcShip } from './npc.ts';

/**
 * What the commander can hurt a ship WITH.
 *
 * `Extract` rather than a fresh list of strings: `laser`, `missile` and `ram`
 * are the same three words in both directions, and writing them out twice is
 * how a report grows two spellings of one cause.
 */
export type DealtSource = Extract<DamageSource, 'laser' | 'missile' | 'ram'> | 'bomb';

/**
 * A ship took damage from the commander — reported, never a side effect.
 *
 * Carried in `StepEvent` so the world step can say it without knowing whether
 * anybody is counting: the career drops it, an exercise credits it to the
 * record (combat-sim.ts).
 */
export interface DealtEvent {
  kind: 'playerDealt';
  npc: NpcShip;
  /** source energy points, as they came OFF the bank — see the header */
  damage: number;
  source: DealtSource;
}

/** What `dealToNpc` did: the report, and whether that was the end of the ship. */
export interface DealtOutcome {
  event: DealtEvent;
  /** true if this is the hit that finished it — the caller decides who is credited */
  destroyed: boolean;
}

/**
 * Spend `points` on `npc` on the commander's behalf, and measure what it cost.
 *
 * @param points already minted by the module that owns the rule — a ram, a
 * warhead or the energy bomb from `impact-damage.ts`. Nothing is minted here.
 * @param from the attacker's position, which is how a trader decides where to
 * flee to and what marks the ship as provoked BY THE PLAYER.
 */
export function dealToNpc(
  npc: NpcShip, points: NpcEnergyPoints, from: THREE.Vector3, source: DealtSource,
): DealtOutcome {
  const before = npc.state.energy;
  const destroyed = npc.takeDamage(points, from, true);
  return {
    event: { kind: 'playerDealt', npc, damage: before - npc.state.energy, source },
    destroyed,
  };
}
