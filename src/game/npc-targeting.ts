// Who is hunting whom, among the NPCs.
//
// Part of the world step: it decides the fights the player is not in. Pirates
// prey on traders, the law hunts pirates, and bounty hunters join in only when
// the player is clean — a hunter with a fugitive in the system has better
// things to do.
//
// Pure logic over the fleet, so it is unit-testable: no scene, no renderer,
// nothing but positions and roles. It ran inline in updateFlight on a 2-second
// timer, which is also why it never had a test.

import type { NpcShip } from './npc.ts';
import type { NpcRole } from './ship-roles.ts';
import type * as THREE from 'three';
// A pirate this close to the player has a better prospect in front of it and
// will not wander off after a trader. It is the SAME 9,000 the ship engages at
// and the condition light reports, so it is imported rather than restated —
// see constants/player-interest.ts for what a second copy of it costs.
import { PLAYER_INTEREST_RANGE } from '../constants/player-interest.ts';
import {
  HUNTER_RANGE, PIRATE_HUNT_RANGE, POLICE_HUNT_RANGE,
} from '../constants/hunt-ranges.ts';

/** Nearest living NPC of `role` to `from`, within `range`. */
function nearest(
  from: NpcShip, npcs: readonly NpcShip[], role: NpcRole, range: number,
): NpcShip | null {
  let best: NpcShip | null = null;
  let bestD = range;
  for (const other of npcs) {
    if (!other.state.alive || other.role !== role) continue;
    const d = other.object.position.distanceTo(from.object.position);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

/**
 * Give every idle NPC something to hunt.
 *
 * Ships keep a target while it is alive, so this only fills in the gaps. It
 * also prunes stale attacker links first: a trader tracks who is shooting at
 * it (that is what makes it flee and call for help), and those entries go
 * stale when the attacker dies or picks someone else. The list belongs to the
 * ship — this asks for it to be pruned rather than splicing it from outside.
 */
export function assignNpcTargets(
  npcs: readonly NpcShip[],
  playerPos: THREE.Vector3,
  playerLegalStatus: number,
): void {
  for (const npc of npcs) npc.pruneAttackers();

  for (const npc of npcs) {
    if (!npc.state.alive || (npc.npcTarget && npc.npcTarget.state.alive)) continue;
    if (npc.role === 'pirate') {
      // a pirate with the player in reach is already busy
      if (npc.object.position.distanceTo(playerPos) <= PLAYER_INTEREST_RANGE) continue;
      npc.npcTarget = nearest(npc, npcs, 'trader', PIRATE_HUNT_RANGE);
      npc.npcTarget?.addAttacker(npc);
    } else if (npc.role === 'police') {
      npc.npcTarget = nearest(npc, npcs, 'pirate', POLICE_HUNT_RANGE);
    } else if (npc.role === 'hunter' && playerLegalStatus === 0) {
      // a bounty hunter with a fugitive in the system is coming for you instead
      npc.npcTarget = nearest(npc, npcs, 'pirate', HUNTER_RANGE);
    }
  }
}
