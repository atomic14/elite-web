// Looking things up in the Elite-A catalogue — the only way in.
//
// The generated modules are flat arrays in source order, which is what makes
// their diffs reviewable and their emission deterministic. Nothing outside this
// file should scan them: ask here by id and get one record, or a merged combat
// profile, back.
//
// `recommendedNpcProfile(designId)` is the one that matters today. The pack
// suggests a stat block per design; the importer resolved it to an ACTUAL exact
// variant with that combat tuple — first in A-W order where several matched —
// and stored the id. So the current roster flies a real released build of the
// ship rather than an average of them, and when a later feature picks a variant
// by system instead, combat does not notice: it was already reading a variant.
//
// Everything here is data lookup. There is no combat arithmetic in this file
// and there must not be: how a hit resolves is the combat module's rule, and
// this is where it gets its numbers.

import { ELITE_A_DESIGNS } from './designs.generated.ts';
import { ELITE_A_GEOMETRY } from './geometry.generated.ts';
import { ELITE_A_PLAYER_HULLS } from './player-hulls.generated.ts';
import { ELITE_A_NEWB_BITS } from './provenance.generated.ts';
import { ELITE_A_SLOTS } from './slots.generated.ts';
import { ELITE_A_VARIANTS } from './variants.generated.ts';
import type {
  EliteACombatProfile, EliteADesign, EliteADesignId, EliteAGeometry, EliteANewbFlags,
  EliteAPlayerHull, EliteAPlayerHullId, EliteASlot, EliteAVariant, EliteAVariantId,
} from './types.ts';

/** A four-bit face slot set to 15 means "no face", never an index. */
export const ELITE_A_NO_FACE = 15;

const designById = new Map(ELITE_A_DESIGNS.map((d) => [d.designId, d]));
const variantById = new Map(ELITE_A_VARIANTS.map((v) => [v.variantId, v]));
const geometryById = new Map(ELITE_A_GEOMETRY.map((g) => [g.designId, g]));
const hullById = new Map(ELITE_A_PLAYER_HULLS.map((h) => [h.playerShipId, h]));

const missing = (what: string, id: string | number): never => {
  throw new Error(`elite-a: no ${what} for ${JSON.stringify(id)}`);
};

/** One of the 15 flyable hulls. */
export function eliteAPlayerHull(id: EliteAPlayerHullId): EliteAPlayerHull {
  return hullById.get(id) ?? missing('player hull', id);
}

/** One of the 38 designs — identity, geometry counts and shared header. */
export function eliteADesign(id: EliteADesignId): EliteADesign {
  return designById.get(id) ?? missing('design', id);
}

/** One exact S.A-S.W build. */
export function eliteAVariant(id: EliteAVariantId): EliteAVariant {
  return variantById.get(id) ?? missing('variant', id);
}

/** The hull for a design. Every variant of a design shares it. */
export function eliteAGeometry(id: EliteADesignId): EliteAGeometry {
  return geometryById.get(id) ?? missing('geometry', id);
}

/**
 * Target radius in source units.
 *
 * The pack stores the target AREA, and most designs have a whole-number root;
 * the eight that do not (Dragon, Monitor, Ophidian and the other recovered
 * hulls) store null and take the square root here. One home for that choice.
 */
export function eliteATargetRadius(design: EliteADesign): number {
  return design.targetableRadiusSourceUnits ?? Math.sqrt(design.targetableArea);
}

/** Decode a slot's NEWB byte. The bit positions were solved from the pack. */
export function eliteANewbFlags(newbRaw: number): EliteANewbFlags {
  const bit = (position: number): boolean => ((newbRaw >> position) & 1) === 1;
  return {
    trader: bit(ELITE_A_NEWB_BITS.trader),
    bountyHunter: bit(ELITE_A_NEWB_BITS.bountyHunter),
    hostile: bit(ELITE_A_NEWB_BITS.hostile),
    pirate: bit(ELITE_A_NEWB_BITS.pirate),
    docking: bit(ELITE_A_NEWB_BITS.docking),
    innocent: bit(ELITE_A_NEWB_BITS.innocent),
    cop: bit(ELITE_A_NEWB_BITS.cop),
    escapePodFitted: bit(ELITE_A_NEWB_BITS.escapePodFitted),
  };
}

/**
 * Every id there is, in source order — the three enumerations.
 *
 * Here rather than at the call site because the flat arrays are this file's
 * secret: a caller that wanted "all the variants" would otherwise import
 * `ELITE_A_VARIANTS` and map it, which is the one thing the header asks nobody
 * to do. Copies, so a caller cannot reorder the catalogue by accident.
 */
export function eliteAPlayerHullIds(): EliteAPlayerHullId[] {
  return ELITE_A_PLAYER_HULLS.map((hull) => hull.playerShipId);
}

export function eliteADesignIds(): EliteADesignId[] {
  return ELITE_A_DESIGNS.map((design) => design.designId);
}

export function eliteAVariantIds(): EliteAVariantId[] {
  return ELITE_A_VARIANTS.map((variant) => variant.variantId);
}

/** Every slot in one blueprint set, in slot order. */
export function eliteASlotsForSet(blueprintSet: string): EliteASlot[] {
  return ELITE_A_SLOTS.filter((slot) => slot.blueprintSet === blueprintSet);
}

/** Every exact variant of one design, in A-W source order. */
export function eliteAVariantsOf(designId: EliteADesignId): EliteAVariant[] {
  return ELITE_A_VARIANTS.filter((variant) => variant.designId === designId);
}

/** A design and one of its variants, merged into the block combat reads. */
export function npcCombatProfile(id: EliteAVariantId): EliteACombatProfile {
  const variant = eliteAVariant(id);
  const design = eliteADesign(variant.designId);
  return {
    variantId: variant.variantId,
    blueprintSet: variant.blueprintSet,
    designId: design.designId,
    shipName: design.shipName,
    maxEnergy: variant.maxEnergy,
    perHitDefence: variant.perHitDefence,
    maxSpeed: design.maxSpeed,
    laserPower: variant.laserPower,
    missileCount: design.missileCount,
    weaponByte: variant.weaponByte,
    canFireLaser: variant.canFireLaser,
    npcLaserDamageCleanBeforeArmour: variant.npcLaserDamageCleanBeforeArmour,
    npcLaserDamageOriginalBeforeArmour: variant.npcLaserDamageOriginalBeforeArmour,
    bountyRawTenthsOfCredit: variant.bountyRawTenthsOfCredit,
    maxCargoCanistersOnDestruction: design.maxCargoCanistersOnDestruction,
    laserImmune: design.laserImmune,
    playerLaserMultiplier: design.playerLaserMultiplier,
    targetableArea: design.targetableArea,
    targetRadius: eliteATargetRadius(design),
  };
}

/**
 * The deterministic exact variant to fly for a design today.
 *
 * Resolved at import time against the pack's recommended default, never
 * averaged. Selection policy stays outside combat: swap this for a
 * system-driven chooser later and nothing downstream changes shape.
 */
export function recommendedNpcProfile(designId: EliteADesignId): EliteACombatProfile {
  return npcCombatProfile(eliteADesign(designId).recommendedVariantId);
}
