// One hull per design id, and the one place anything asks for one.
//
// `game/ship-identity.ts` says WHAT a ship is; this says what that looks like
// and how big it is. Keeping the two apart is the point of TODO 23: a caller
// that reached for a `ShipDef` and compared it to decide what it was hit would
// make the geometry table the identity table again, so nothing here hands back
// anything you could usefully compare — it hands back a mesh definition and a
// radius, both derived from the id.
//
// Two answers, because there are two kinds of design. A `elite-a:design:*` id
// resolves to a released hull at the one conversion (`elite-a-hulls.ts`); a
// `harmless:design:*` id resolves to one of ours (`harmless-hulls.ts`), which is
// why the record says which it got rather than pretending they are the same.
//
// THE RADIUS IS A GAMEPLAY NUMBER, and this is now its only home. It used to be
// a hand-tuned field on every roster row in `game/ship-specs.ts`; it is the
// pack's own targetable radius through `sourceGeometryToWorld` instead, which is
// what makes the ray tests in `game/shot.ts` and the hit cone in `game/gunnery.ts`
// agree with the released ships rather than with a guess.

import {
  HARMLESS_OVERLAYS, shipDesign, shipDesignIdOf, type ShipDesignId,
} from '../game/ship-identity.ts';
import {
  eliteAHull, ELITE_A_HULLS, sourceGeometryToWorld, type EliteAHull,
} from './elite-a-hulls.ts';
import {
  GENERATION_SHIP, GENERATION_SHIP_RADIUS, ROCK_HERMIT_RADIUS,
} from './harmless-hulls.ts';
import type { ShipDef } from './geometry.ts';

export { sourceGeometryToWorld };

/** What a design id resolves to: a hull to build, and how big it counts as. */
export interface RegisteredHull {
  readonly designId: ShipDesignId;
  readonly name: string;
  /** Whether the pack supplied this shape or Harmless invented it. */
  readonly source: 'elite-a' | 'harmless';
  /** null when the mesh is generated rather than tabulated — the rock hermit. */
  readonly def: ShipDef | null;
  /** World units. Ray tests, hit cones and collision separation all use it. */
  readonly targetRadius: number;
}

/** The Harmless designs, by id — two of them, and ship-identity.ts says why. */
const OWN: Record<string, RegisteredHull> = {
  [HARMLESS_OVERLAYS.generationShip.designId]: {
    designId: HARMLESS_OVERLAYS.generationShip.designId,
    name: HARMLESS_OVERLAYS.generationShip.name,
    source: 'harmless',
    def: GENERATION_SHIP,
    targetRadius: GENERATION_SHIP_RADIUS,
  },
  [HARMLESS_OVERLAYS.rockHermit.designId]: {
    designId: HARMLESS_OVERLAYS.rockHermit.designId,
    name: HARMLESS_OVERLAYS.rockHermit.name,
    source: 'harmless',
    def: null,
    targetRadius: ROCK_HERMIT_RADIUS,
  },
};

const fromSource = (id: ShipDesignId, hull: EliteAHull): RegisteredHull => ({
  designId: id,
  name: hull.name,
  source: 'elite-a',
  def: hull.def,
  targetRadius: hull.targetRadius,
});

/** The hull behind a design id. Throws on anything that is not one. */
export function registeredHull(id: ShipDesignId): RegisteredHull {
  const record = shipDesign(id);
  if (record.source === 'harmless') return OWN[record.designId];
  return fromSource(record.designId, eliteAHull(record.design.designId));
}

/**
 * The two designs the game names directly rather than through the roster.
 *
 * A canister and a missile are objects, not ships, so `ship-specs.ts` has no row
 * for them — but they are released designs with released geometry like anything
 * else, and `game/cargo.ts` and `game/ordnance.ts` have to say which. Here
 * rather than at those call sites so that "a canister is design 4" is written
 * down once and validated against the catalogue as it is written.
 */
export const OBJECT_DESIGNS = {
  cargoCanister: shipDesignIdOf(4),
  missile: shipDesignIdOf(15),
} as const;

/** The mesh definition for a design that has one. Throws for the generated rock. */
export function requireShipDef(id: ShipDesignId): ShipDef {
  const hull = registeredHull(id);
  if (!hull.def) throw new Error(`ships/registry: ${id} has no tabulated hull`);
  return hull.def;
}

/**
 * What to CALL a design — the released ship name, or the overlay's own.
 *
 * A label, and only a label. It used to be read off `ShipDef.name` at four call
 * sites, which made the mesh the place a ship's name lived; two roster rows
 * sharing a hull then shared a name by accident rather than by identity. Ask
 * here, with the id, and the answer is the design's.
 */
export function shipDisplayName(id: ShipDesignId): string {
  return registeredHull(id).name;
}

/** Whether this design has a tabulated hull at all — false only for the rock hermit. */
export function hasShipDef(id: ShipDesignId): boolean {
  return registeredHull(id).def !== null;
}

/**
 * The radius the guns and the collision loops use, in world units.
 *
 * One number per design, from the catalogue. Ships of the same design are the
 * same size — there is no per-role or per-tier adjustment, and adding one would
 * put this rule back in two places.
 */
export function shipTargetRadius(id: ShipDesignId): number {
  return registeredHull(id).targetRadius;
}

/**
 * Every released hull, in source order — for the viewer and the geometry tests.
 *
 * The full `EliteAHull`, not the trimmed record above, because both callers want
 * what the trim drops: the gun vertex, the source-unit radius and the face
 * reconstruction's report.
 */
export const SOURCE_HULLS: readonly EliteAHull[] = ELITE_A_HULLS;
