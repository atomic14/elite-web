// The shape of the released-Elite-A reference catalogue.
//
// Hand-written, and the only file here that is. Everything beside it ending
// `.generated.ts` is written by `npm run generate:elite-a` from the vendored
// pack in `reference/elite-a/source`, so these interfaces are the contract the
// importer emits against — `tools/elite-a/build.mjs` asserts the pack still
// splits into exactly these fields and stops if it does not.
//
// Three identities, because three future features move independently:
//
//   PlayerHullId       which of the 15 flyable hulls the commander is in
//   ShipDesignId       which of the 38 hulls is on screen — geometry lives here
//   NpcVariantId       which exact S.A-S.W build of that design this one is
//
// The split is the point. A design's geometry, size, speed and cargo never vary
// between its variants, so they are stored ONCE on the design; energy, defence,
// weapon byte and bounty do vary, so they are what a variant record holds. A
// variant is therefore ten numbers, not thirty-two, and there is exactly one
// copy of each hull.
//
// This file describes DATA. It contains no combat arithmetic and must not grow
// any: the rules that read these numbers belong to the combat module.

/** One of the 15 flyable hulls, 0-14, in the pack's own order (0 is Adder). */
export type EliteAPlayerHullId = number;

/** One of the 38 NPC/object designs, 0-37. Addresses shared geometry. */
export type EliteADesignId = number;

/** An exact variant, as `` `${blueprintSet}:${designId}` `` — e.g. `"G:28"`. */
export type EliteAVariantId = string;

/** The four fitted player lasers the pack tabulates. */
export type EliteALaserType = 'pulse' | 'beam' | 'military' | 'mining';

/** A fitted laser's raw byte and what it decodes to. */
export interface EliteALaser {
  readonly rawByte: number;
  /** The high bit: a continuous (beam) laser rather than a pulse. */
  readonly continuousFlag: boolean;
  /** `rawByte & 0x7f`. */
  readonly power: number;
  /** `power >> 1` — the hit strength before the target's defence. */
  readonly baseDamagePerHit: number;
}

export interface EliteAPlayerHull {
  readonly playerShipId: EliteAPlayerHullId;
  readonly name: string;
  readonly lasers: Readonly<Record<EliteALaserType, EliteALaser>>;
  readonly laserMounts: number;
  readonly laserMountDescription: string;
  readonly maxMissiles: number;
  /** Subtracted once from every NPC laser hit. Not the size of a shield bar. */
  readonly perHitShieldArmour: number;
  readonly energyRechargeRating: number;
  readonly maxSpeed: number;
  readonly cargoHoldCapacity: number;
  readonly hyperspaceRangeLightYears: number;
  readonly equipmentPriceGroup: number;
  readonly maxPitchRollRate: number;
  readonly minPitchRollRate: number;
  readonly frontShieldCapacity: number;
  readonly aftShieldCapacity: number;
  readonly energyBankCapacity: number;
}

/** The pack's suggested per-design stat block, before it is resolved. */
export interface EliteARecommendedDefault {
  readonly maxEnergy: number;
  readonly perHitDefence: number;
  readonly maxSpeed: number;
  readonly laserPower: number;
  readonly missileCount: number;
  readonly weaponByte: number;
  readonly canFireLaser: boolean;
  readonly npcLaserDamageOriginalBeforeArmour: number;
  readonly npcLaserDamageCleanBeforeArmour: number;
  readonly bountyRawTenthsOfCredit: number;
  readonly maxCargoCanistersOnDestruction: number;
}

export interface EliteADesign {
  readonly designId: EliteADesignId;
  readonly shipSymbol: string;
  readonly shipName: string;
  readonly variantCount: number;
  /** The sets this design actually appears in, in A-W order. */
  readonly blueprintSets: readonly string[];
  /** Slots it MAY occupy — wider than the slots it happens to fill. */
  readonly allowedBlueprintSlots: readonly number[];
  readonly spawnInstallProbabilityRaw: number;
  readonly spawnInstallProbabilityPercent: number;
  readonly standardEscapePod: boolean;

  // --- how player lasers treat it, solved from the 15,600-row oracle --------
  /** Stations only: player lasers never reduce its energy. */
  readonly laserImmune: boolean;
  /** Multiplies player hit strength before defence. 0.5 is the Constrictor. */
  readonly playerLaserMultiplier: number;
  /** The exact variant the recommended default resolves to. */
  readonly recommendedVariantId: EliteAVariantId;

  // --- header fields that never vary across this design's variants ----------
  readonly cargoByte: number;
  readonly maxCargoCanistersOnDestruction: number;
  readonly scoopedMarketItemId: number | null;
  /** Target area in source units; the radius is its square root. */
  readonly targetableArea: number;
  /** The radius when it is a whole number, else null — use `targetRadius()`. */
  readonly targetableRadiusSourceUnits: number | null;
  readonly maxLineHeapBytes: number;
  readonly maxVisibleEdges: number;
  readonly gunVertexIndex: number;
  readonly gunVertexByte: number;
  readonly explosionByte: number;
  readonly explosionCloudOriginCount: number;
  readonly vertexCount: number;
  readonly vertexBytes: number;
  readonly edgeCount: number;
  readonly faceCount: number;
  readonly faceBytes: number;
  readonly visibilityDistance: number;
  readonly maxSpeed: number;
  readonly normalScaleExponent: number;
  readonly normalScaleDivisor: number;
  readonly missileCount: number;

  readonly recommendedDefault: EliteARecommendedDefault;
}

/** The ten header fields that differ between builds of the same design. */
export interface EliteAVariant {
  readonly variantId: EliteAVariantId;
  readonly blueprintSet: string;
  readonly designId: EliteADesignId;
  /** The slots this build occupies in its own set. */
  readonly presentInSlots: readonly number[];
  readonly maxEnergy: number;
  readonly perHitDefence: number;
  readonly weaponByte: number;
  readonly laserPower: number;
  readonly canFireLaser: boolean;
  /** The released diagnostic `weaponByte >> 1`. Never drives gameplay. */
  readonly weaponByteShiftedHalf: number;
  readonly npcLaserDamageOriginalBeforeArmour: number;
  readonly npcLaserDamageCleanBeforeArmour: number;
  /** Money, in the game's own unit: integer tenths of a credit. */
  readonly bountyRawTenthsOfCredit: number;
}

/** Which design fills which role in one blueprint set. */
export interface EliteASlot {
  readonly blueprintSet: string;
  readonly slot: number;
  readonly slotCategory: string;
  /** Null where the released set leaves the slot empty. */
  readonly designId: EliteADesignId | null;
  readonly shipSymbol: string | null;
  /** The raw NEWB byte; `eliteANewbFlags()` decodes it. */
  readonly newbRaw: number;
}

/** The decoded NEWB byte: what a ship spawned into this slot believes it is. */
export interface EliteANewbFlags {
  readonly trader: boolean;
  readonly bountyHunter: boolean;
  readonly hostile: boolean;
  readonly pirate: boolean;
  readonly docking: boolean;
  readonly innocent: boolean;
  readonly cop: boolean;
  readonly escapePodFitted: boolean;
}

/**
 * One hull, flat. Strides are fixed and the columns are:
 *
 *   vertices  8 · x, y, z, face1, face2, face3, face4, visibility
 *   edges     5 · vertex1, vertex2, face1, face2, visibility
 *   faces     4 · normalX, normalY, normalZ, visibility
 *
 * A face slot is four bits wide, so `15` there means "no face", never an index
 * — `ELITE_A_NO_FACE`. Vertex indices are always real.
 */
export interface EliteAGeometry {
  readonly designId: EliteADesignId;
  readonly vertices: readonly number[];
  readonly edges: readonly number[];
  readonly faces: readonly number[];
}

/** A design and one of its exact variants, merged — what combat needs to know. */
export interface EliteACombatProfile {
  readonly variantId: EliteAVariantId;
  readonly blueprintSet: string;
  readonly designId: EliteADesignId;
  readonly shipName: string;
  readonly maxEnergy: number;
  readonly perHitDefence: number;
  readonly maxSpeed: number;
  readonly laserPower: number;
  readonly missileCount: number;
  readonly weaponByte: number;
  readonly canFireLaser: boolean;
  readonly npcLaserDamageCleanBeforeArmour: number;
  readonly npcLaserDamageOriginalBeforeArmour: number;
  readonly bountyRawTenthsOfCredit: number;
  readonly maxCargoCanistersOnDestruction: number;
  readonly laserImmune: boolean;
  readonly playerLaserMultiplier: number;
  readonly targetableArea: number;
  readonly targetRadius: number;
}
