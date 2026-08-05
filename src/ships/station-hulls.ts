// The two stations: released geometry, at a size Harmless chose.
//
// Both hulls are exact — the Coriolis is design 1 and the Dodo design 0, read
// out of the same generated catalogue as every ship — and both are drawn FOUR
// TIMES the one geometry conversion. That factor is the only per-object scale
// in the project and it is OURS, not a source value:
//
//     STATION_PRESENTATION_SCALE = 4
//
// Why it exists. `sourceGeometryToWorld` puts one world unit at four source
// units, anchored on the Cobra Mk III, and through it the released Coriolis is
// 40 world units across the half-diagonal — 1.7 Cobras wide. The Harmless scene
// has always placed a 160-unit station, 4.7 Cobras wide, and `game/docking.ts`
// is built on that width: the approach gate is five station half-widths out,
// the launch standoff and the Vipers' stack are absolute distances, and the
// slot channel is a tolerance in world units. Shrinking the station fourfold
// would move all of them at once and turn a 900-unit approach into a 225-unit
// one, which is a docking change and not a geometry one. So the SHAPE is the
// released table and the SIZE is the scene's: a station is drawn at one world
// unit per source unit, which is where the familiar 160 comes from.
//
// Nothing else may reach for this. A hull that looks wrong at the ship scale is
// wrong in the source or wrong in the scene; this is not a knob, it is one
// stated decision about two objects, recorded in docs/GAP-ANALYSIS.md.

import * as THREE from 'three';

import { shipDesignIdOf, type ShipDesignId } from '../game/ship-identity.ts';
import { buildShip, type ShipDef } from './geometry.ts';
import { requireShipDef, shipDisplayName } from './registry.ts';
import { SOURCE_UNITS_PER_WORLD_UNIT } from './elite-a-hulls.ts';

/**
 * How much larger than the one geometry conversion a station is drawn.
 *
 * AN EXPRESSION, not a coincidence: it was a second `4` whose comment said "4
 * is exactly the factor that cancels the conversion" in English while nothing
 * enforced it. Written this way, a station is 1:1 with its source units — 160
 * for the Coriolis, 196 for the Dodo — whatever the ship conversion becomes,
 * which is what every absolute docking distance above is built on. It cannot
 * live in src/constants/ because its meaning IS this product over the ships'
 * own anchor, which that directory may not import — the
 * `WORLD_SPEED_PER_SOURCE_SPEED` shape (docs/TODO/90-constants-cleanup.md).
 */
export const STATION_PRESENTATION_SCALE = SOURCE_UNITS_PER_WORLD_UNIT;

/** The two released stations, by design id. */
export const STATION_DESIGNS = {
  /** dodecahedral, and what a high-tech system gets */
  dodo: shipDesignIdOf(0),
  coriolis: shipDesignIdOf(1),
} as const;

/** A built station: the mesh, and how far its slot face is from its centre. */
export interface StationHull {
  readonly designId: ShipDesignId;
  readonly name: string;
  readonly object: THREE.Object3D;
  /**
   * Distance from the centre to the slot face plane, in world units.
   *
   * Derived from the hull rather than written down: the slot sits on the face
   * furthest along the source's +Z, which `buildShip`'s half turn puts on local
   * -Z. 160 for the Coriolis — the number the scene and docking.ts have always
   * used — and 196 for the Dodo.
   */
  readonly dockZ: number;
}

/** The released def at the station scale. A copy: the registry's is shared. */
function presented(designId: ShipDesignId): ShipDef {
  const def = requireShipDef(designId);
  return { ...def, scale: def.scale * STATION_PRESENTATION_SCALE };
}

/** How far the slot face is from the centre, for a def already at scale. */
function slotFaceDistance(def: ShipDef): number {
  return def.vertices.reduce((far, v) => Math.max(far, v[2]), 0) * def.scale;
}

/** Build one of the two stations. Nothing else in the project may scale a hull. */
export function buildStation(
  designId: ShipDesignId, color: THREE.ColorRepresentation,
): StationHull {
  const def = presented(designId);
  return {
    designId,
    name: shipDisplayName(designId),
    object: buildShip(def, color),
    dockZ: slotFaceDistance(def),
  };
}

/** What a station of this design measures, without building one. */
export function stationDockZ(designId: ShipDesignId): number {
  return slotFaceDistance(presented(designId));
}
