// Which hull, which design, which exact build — and the one way to say so.
//
// Three identities, because three things move independently (the fidelity
// contract in docs/TODO/ELITE-A-COMBAT-PLAN.md says the same):
//
//   PlayerHullId         which of the 15 flyable hulls the commander is in
//   ShipDesignId         which hull is on screen — geometry hangs off this
//   NpcCombatProfileId   which exact S.A-S.W build of that design this one is
//
// They are STRINGS, and namespaced ones, for two reasons. A save file that
// reads `"elite-a:variant:B:10"` says what it means years later, where a bare
// `10` does not; and the two Harmless inventions — the derelict generation ship
// and the rock hermit — carry `harmless:` ids that can never be mistaken for a
// recovered Elite-A design. That separation is a requirement, not a courtesy:
// the generation ship is ours and must not be presented as source data.
//
// WHAT GOES IN A SAVE IS AN ID. Never an expanded record, never a geometry
// object, never a copied stat block. An id resolves to exactly one immutable
// record here; a record copied into a save is a second home for a rule that the
// catalogue already owns, and it goes stale the day the pack is re-imported.
//
// And identity is never INFERRED. Comparing `spec.def === COBRA_MK3` or reading
// a mesh's name to work out what a ship is makes the geometry table the
// identity table, so a shared or replaced hull silently changes what a ship IS.
// The roster states its ids (ship-specs.ts) and everything else asks here.
//
// This file is data lookup and validation. There is no combat arithmetic in it
// — that is `elite-a/combat-math.ts` — and no selection policy: which variant a
// system offers is a future blueprint loader's business, and the only choice
// made here is the deterministic recommended one the current roster flies.

import {
  eliteADesign, eliteADesignIds, eliteAPlayerHull, eliteAPlayerHullIds,
  eliteAVariantIds, npcCombatProfile, recommendedNpcProfile,
} from './elite-a/catalogue.ts';
import type {
  EliteACombatProfile, EliteADesign, EliteAPlayerHull, EliteAVariantId,
} from './elite-a/types.ts';

/** One of the 15 flyable hulls, as `elite-a:player:<0-14>`. */
export type PlayerHullId = string;

/** One hull's geometry and shared header: `elite-a:design:<0-37>`, or a `harmless:` overlay. */
export type ShipDesignId = string;

/** One exact released build: `elite-a:variant:<set>:<design>`, or a `harmless:` overlay. */
export type NpcCombatProfileId = string;

/** What a ship IS: its design, and the exact build of that design it flies as. */
export interface ShipIdentity {
  readonly designId: ShipDesignId;
  readonly profileId: NpcCombatProfileId;
}

const PLAYER_PREFIX = 'elite-a:player:';
const DESIGN_PREFIX = 'elite-a:design:';
const VARIANT_PREFIX = 'elite-a:variant:';

/**
 * A Harmless invention with no source record behind it.
 *
 * Two of them, and there must not quietly be a third: `why` is here so that
 * adding one means writing down the reason it is not a recovered design.
 */
export interface HarmlessOverlay extends ShipIdentity {
  readonly name: string;
  readonly why: string;
}

const overlay = (slug: string, name: string, why: string): HarmlessOverlay => ({
  designId: `harmless:design:${slug}`,
  profileId: `harmless:profile:${slug}`,
  name,
  why,
});

/**
 * The generation ship and the rock hermit: ours, and labelled as ours.
 *
 * The derelict colony vessel is a Harmless encounter with no Elite-A design,
 * and the hermit is a hollowed asteroid the player can dock with rather than
 * one of the two source stations. Giving them source ids would put invented
 * numbers into the catalogue's namespace, which is exactly the mislabelling the
 * combat plan forbids.
 */
export const HARMLESS_OVERLAYS = {
  generationShip: overlay('generation-ship', 'Generation ship',
    'a Harmless encounter — a derelict colony vessel the source roster has no design for'),
  rockHermit: overlay('rock-hermit', 'Rock hermit',
    'a Harmless dockable asteroid — not the Coriolis or Dodo the source stations describe'),
} as const;

const OVERLAYS: readonly HarmlessOverlay[] = Object.values(HARMLESS_OVERLAYS);

// --- the three enumerations --------------------------------------------------

/** Every flyable hull, in the pack's own order (0 is the Adder). */
export const PLAYER_HULL_IDS: readonly PlayerHullId[] =
  eliteAPlayerHullIds().map((id) => `${PLAYER_PREFIX}${id}`);

/** Every design: the 38 source hulls, then the two Harmless overlays. */
export const SHIP_DESIGN_IDS: readonly ShipDesignId[] = [
  ...eliteADesignIds().map((id) => `${DESIGN_PREFIX}${id}`),
  ...OVERLAYS.map((o) => o.designId),
];

/** Every exact variant: the 260 released builds, then the two overlays. */
export const NPC_COMBAT_PROFILE_IDS: readonly NpcCombatProfileId[] = [
  ...eliteAVariantIds().map((id) => `${VARIANT_PREFIX}${id}`),
  ...OVERLAYS.map((o) => o.profileId),
];

const PLAYER_HULL_SET = new Set(PLAYER_HULL_IDS);
const DESIGN_SET = new Set(SHIP_DESIGN_IDS);
const PROFILE_SET = new Set(NPC_COMBAT_PROFILE_IDS);
const OVERLAY_BY_DESIGN = new Map(OVERLAYS.map((o) => [o.designId, o]));
const OVERLAY_BY_PROFILE = new Map(OVERLAYS.map((o) => [o.profileId, o]));

/**
 * What a career with no recorded hull was flying: the Cobra Mk III.
 *
 * Every commander before this phase flew one, and this phase does not offer a
 * shipyard — so it is both the migration target for a legacy save and what
 * `newCommander()` starts you in.
 */
export const COBRA_MK_3_HULL_ID: PlayerHullId = `${PLAYER_PREFIX}7`;

// --- minting an id from the catalogue ---------------------------------------

/** The id of one flyable hull, checked against the catalogue as it is made. */
export function playerHullIdOf(sourceId: number): PlayerHullId {
  eliteAPlayerHull(sourceId);
  return `${PLAYER_PREFIX}${sourceId}`;
}

/** The id of one design, checked against the catalogue as it is made. */
export function shipDesignIdOf(sourceId: number): ShipDesignId {
  eliteADesign(sourceId);
  return `${DESIGN_PREFIX}${sourceId}`;
}

/** The id of one exact variant, from the catalogue's own `"B:10"` form. */
export function npcCombatProfileIdOf(variantId: EliteAVariantId): NpcCombatProfileId {
  npcCombatProfile(variantId);
  return `${VARIANT_PREFIX}${variantId}`;
}

// --- asking what an id is ----------------------------------------------------

export function isPlayerHullId(value: unknown): value is PlayerHullId {
  return typeof value === 'string' && PLAYER_HULL_SET.has(value);
}

export function isShipDesignId(value: unknown): value is ShipDesignId {
  return typeof value === 'string' && DESIGN_SET.has(value);
}

export function isNpcCombatProfileId(value: unknown): value is NpcCombatProfileId {
  return typeof value === 'string' && PROFILE_SET.has(value);
}

/** True for the two Harmless inventions, false for anything the pack supplied. */
export function isHarmlessOverlayId(id: ShipDesignId | NpcCombatProfileId): boolean {
  return OVERLAY_BY_DESIGN.has(id) || OVERLAY_BY_PROFILE.has(id);
}

const reject = (what: string, value: unknown): never => {
  throw new Error(`ship-identity: ${JSON.stringify(value)} is not a ${what}`);
};

/** Rejects anything that is not one of the 15. Use at a serialization boundary. */
export function requirePlayerHullId(value: unknown): PlayerHullId {
  return isPlayerHullId(value) ? value : reject('player hull id', value);
}

export function requireShipDesignId(value: unknown): ShipDesignId {
  return isShipDesignId(value) ? value : reject('ship design id', value);
}

export function requireNpcCombatProfileId(value: unknown): NpcCombatProfileId {
  return isNpcCombatProfileId(value) ? value : reject('npc combat profile id', value);
}

// --- resolving an id to its one record ---------------------------------------

/** The flyable hull's full profile: lasers, armour, rack, hold, turn limits. */
export function playerHull(id: PlayerHullId): EliteAPlayerHull {
  return eliteAPlayerHull(Number(requirePlayerHullId(id).slice(PLAYER_PREFIX.length)));
}

/**
 * A design, resolved. Source-backed or ours — the caller is made to notice,
 * because "no source record" is a fact about the ship, not a missing value.
 */
export type ShipDesignRecord =
  | { readonly source: 'elite-a'; readonly designId: ShipDesignId; readonly design: EliteADesign }
  | { readonly source: 'harmless'; readonly designId: ShipDesignId; readonly overlay: HarmlessOverlay };

export function shipDesign(id: ShipDesignId): ShipDesignRecord {
  const designId = requireShipDesignId(id);
  const own = OVERLAY_BY_DESIGN.get(designId);
  if (own) return { source: 'harmless', designId, overlay: own };
  return {
    source: 'elite-a',
    designId,
    design: eliteADesign(Number(designId.slice(DESIGN_PREFIX.length))),
  };
}

/** An exact build, resolved — the block combat reads, or the overlay that has none. */
export type NpcCombatProfileRecord =
  | { readonly source: 'elite-a'; readonly profileId: NpcCombatProfileId; readonly profile: EliteACombatProfile }
  | { readonly source: 'harmless'; readonly profileId: NpcCombatProfileId; readonly overlay: HarmlessOverlay };

export function npcCombatProfileById(id: NpcCombatProfileId): NpcCombatProfileRecord {
  const profileId = requireNpcCombatProfileId(id);
  const own = OVERLAY_BY_PROFILE.get(profileId);
  if (own) return { source: 'harmless', profileId, overlay: own };
  return {
    source: 'elite-a',
    profileId,
    profile: npcCombatProfile(profileId.slice(VARIANT_PREFIX.length)),
  };
}

// --- what today's roster flies ----------------------------------------------

/**
 * The identity a source design flies with today.
 *
 * The profile is the pack's recommended default, which the importer already
 * resolved to an ACTUAL exact variant with that combat tuple (catalogue.ts) —
 * so a roster hull is a real released build rather than an average of them.
 * Selection policy stays outside: a later blueprint loader that picks a variant
 * by system hands in a different `profileId` and nothing else changes.
 */
export function eliteAShipIdentity(sourceDesignId: number): ShipIdentity {
  const designId = shipDesignIdOf(sourceDesignId);
  return { designId, profileId: recommendedProfileIdFor(designId) };
}

/** The deterministic profile for a design — the one a legacy ship migrates onto. */
export function recommendedProfileIdFor(designId: ShipDesignId): NpcCombatProfileId {
  const record = shipDesign(designId);
  return record.source === 'harmless'
    ? record.overlay.profileId
    : npcCombatProfileIdOf(recommendedNpcProfile(record.design.designId).variantId);
}

// --- the two serialization boundaries ---------------------------------------

/**
 * The hull a saved commander flies.
 *
 * Missing means a career written before ships had ids, and every one of those
 * was a Cobra Mk III. INVALID means the same thing for our purposes — a value
 * we cannot resolve is not a ship — and a career must never fail to load over
 * it, so both migrate rather than throw. This is the only place that decision
 * is made (`storage.ts` and `persistence.ts` both call it).
 */
export function migratedPlayerHullId(value: unknown): PlayerHullId {
  return isPlayerHullId(value) ? value : COBRA_MK_3_HULL_ID;
}

/**
 * The identity a saved ship comes back with — or `undefined` for a save written
 * before ships had one, which the caller then derives from hull, role and seed
 * through `recommendedProfileIdFor`. That derivation is deterministic, so a
 * reload never rerolls what a ship is and never draws from the rng to find out.
 *
 * An id that is PRESENT and not in the catalogue is rejected rather than
 * quietly migrated: a legacy save has no id at all, so a bad one is corruption,
 * and `Persistence.resume` already treats a corrupt world as no world.
 */
export function savedShipIdentity(
  saved: { designId?: unknown; profileId?: unknown },
): ShipIdentity | undefined {
  if (saved.designId === undefined && saved.profileId === undefined) return undefined;
  return {
    designId: requireShipDesignId(saved.designId),
    profileId: requireNpcCombatProfileId(saved.profileId),
  };
}
