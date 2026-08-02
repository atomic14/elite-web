// Which released BUILD of a design a role flies — the selection policy.
//
// `ship-roles.ts` says which DESIGNS a role may fly at all. This says which of
// that design's exact S.A-S.W variants it turns up in, and it is the whole of
// that decision: combat never asks who chose, only what the profile says.
//
// ## Why it exists
//
// Every roster row used to fly `recommendedNpcProfile(designId)` — the pack's
// own suggested default for a design, resolved to a real released build. That is
// the right answer for a ship you are looking at and the wrong one for a ship
// that is shooting at you. The default is the ordinary build, and under the
// fidelity contract's clean laser rule (`laserPower << 2`, less the flyable
// hull's per-hit armour) an ordinary build barely bites: a default pirate does 9
// points to a Cobra Mk III's 510-point front-face pool, so it takes 57 hits.
//
// The released sets contain harder builds of the SAME ships. A Sidewinder is
// `D:17` in one set and `V:17` in another — same hull, same geometry, same name,
// one more point of laser power. Selecting `V:17` for a pirate is still one
// hundred per cent released data: it is a different released build of the same
// ship, not a tuned number. So threat is restored by SELECTION, and the oracle,
// the parity matrices and every fixture stay exactly as they were.
//
// ## The rule
//
//   * A COMBAT role (pirate, police, hunter, thargoid, thargon) flies the
//     hardest build of its design that the source itself ever filed under that
//     job — permitted by the role's own slot bands, ranked by clean laser
//     strength, then by energy, then by A-W source order.
//   * Everything else — traders, rocks, the two Harmless overlays — keeps the
//     recommended default. A freighter is not trying to hurt anyone.
//   * A design with no permitted build in the role's bands keeps the
//     recommended default too. That is not a fallback for convenience: it is the
//     answer for the Constrictor, which flies with the `pirate` role and sits in
//     slot 31, a band no ordinary pirate draws from.
//
// PERMISSION IS READ FROM WHAT THE SETS DID, exactly as `ship-roles.ts` reads
// design membership: a variant qualifies when one of the slots it actually
// occupies in its own set is a slot for this job. Nothing is synthesised and no
// stat is ever averaged or invented — every candidate is a real row of the
// vendored pack.
//
// ## Determinism, and the save
//
// The choice is a pure function of (role, design) over generated data, so it is
// the same in every session, on every machine, before and after a reload. A
// ship's `profileId` is in its snapshot (`ship-identity.ts`), so a restored ship
// keeps the exact build it had; a legacy snapshot with no id at all re-derives
// one through this same function and therefore lands on the same build it would
// have spawned with. No rng is drawn either way — which is the rule for anything
// that decides a future frame.

import { eliteAVariantsOf } from './elite-a/catalogue.ts';
import { eliteANpcLaserStrength } from './elite-a/combat-math.ts';
import type { EliteAVariant } from './elite-a/types.ts';
import { roleBandContainsSlot, type NpcRole } from './ship-roles.ts';
import {
  npcCombatProfileIdOf, recommendedProfileIdFor, shipDesign,
  type NpcCombatProfileId, type ShipDesignId,
} from './ship-identity.ts';

/**
 * The roles that are trying to hurt somebody.
 *
 * Stated as a set rather than inferred from "has a laser", because a trader
 * Cobra has one too and is still not a combat ship. These are the roles whose
 * whole job is the fight, and the only ones whose build selection is allowed to
 * ask which build hits hardest.
 */
export const COMBAT_ROLES: ReadonlySet<NpcRole> =
  new Set<NpcRole>(['pirate', 'police', 'hunter', 'thargoid', 'thargon']);

/** Is this a role whose build is chosen for its gun? */
export function isCombatRole(role: NpcRole): boolean {
  return COMBAT_ROLES.has(role);
}

/**
 * Every released build of this design the source ever filed under this job.
 *
 * Empty is a real answer — see the header on the Constrictor.
 */
export function roleCandidateVariants(
  role: NpcRole, sourceDesignId: number,
): readonly EliteAVariant[] {
  return eliteAVariantsOf(sourceDesignId)
    .filter((v) => v.presentInSlots.some((slot) => roleBandContainsSlot(role, slot)));
}

/**
 * Rank two permitted builds. Hardest gun first, then the bigger bank, then the
 * earlier blueprint set — so the answer is total and never depends on array
 * order.
 *
 * The gun is `eliteANpcLaserStrength`, the oracle's own clean rule, rather than
 * the raw `laserPower` column: one rule, one home, and if the encoding ever
 * changes this follows it instead of disagreeing with it.
 */
function harder(a: EliteAVariant, b: EliteAVariant): number {
  const gun = eliteANpcLaserStrength(b.weaponByte) - eliteANpcLaserStrength(a.weaponByte);
  if (gun !== 0) return gun;
  if (b.maxEnergy !== a.maxEnergy) return b.maxEnergy - a.maxEnergy;
  return a.variantId < b.variantId ? -1 : 1;
}

const cache = new Map<string, NpcCombatProfileId>();

/**
 * The exact build a ship of this role and design flies.
 *
 * Deterministic, cached, and the ONLY place the choice is made. `ship-specs.ts`
 * calls it once per roster row at load; `persistence.ts` reaches the same answer
 * for a legacy snapshot through `ship-identity.ts`.
 */
export function roleCombatProfileId(
  role: NpcRole, designId: ShipDesignId,
): NpcCombatProfileId {
  const key = `${role} ${designId}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  const chosen = choose(role, designId);
  cache.set(key, chosen);
  return chosen;
}

function choose(role: NpcRole, designId: ShipDesignId): NpcCombatProfileId {
  const record = shipDesign(designId);
  if (record.source !== 'elite-a' || !isCombatRole(role)) {
    return recommendedProfileIdFor(designId);
  }
  const permitted = [...roleCandidateVariants(role, record.design.designId)].sort(harder);
  return permitted.length === 0
    ? recommendedProfileIdFor(designId)
    : npcCombatProfileIdOf(permitted[0].variantId);
}
