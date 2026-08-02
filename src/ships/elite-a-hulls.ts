// The 38 released hulls, at the one scale, ready to render.
//
// This is where source data becomes something the renderer can take: the flat
// generated arrays in game/elite-a/geometry.generated.ts come in, a `ShipDef`
// with closed face loops goes out, and `sourceGeometryToWorld` is the single
// conversion between the two coordinate systems. Nothing else in the project
// may scale a hull.
//
// THE ANCHOR. Source design 10 is the Cobra Mk III, and its vertex table is the
// table `ships/geometry.ts` shipped by hand — (32,0,76), (-32,0,76), (0,26,24),
// (-120,-3,-8) and so on, byte for byte — carried with `scale: 0.25`. So the
// Cobra keeps the size it has always had if and only if one world unit is four
// source units, and that is the whole derivation:
//
//     world = source / 4          SOURCE_UNITS_PER_WORLD_UNIT = 4
//
// It is applied to every one of the 38 designs and to their target radii, and
// there is deliberately no per-ship factor to reach for: a hull that looks wrong
// at this scale is wrong in the source or wrong in the scene, and both of those
// are somewhere else's problem.
//
// A CONSEQUENCE WORTH KNOWING. The released Coriolis is 160 source units — 40
// world units, against the 160 the Harmless scene places it at and the docking
// rules in game/docking.ts are written against. In the source a station is only
// 1.7 Cobras across; in Harmless it is 4.7. That gap is a scene decision, not a
// geometry one, so the two station designs are built here and shown in the
// viewer, and world/system-scene.ts still flies the Harmless station — see
// ships/harmless-hulls.ts.

import {
  eliteADesign, eliteADesignIds, eliteAGeometry, eliteATargetRadius,
} from '../game/elite-a/catalogue.ts';
import { reconstructFaces, readSourceHull, type HullTopology } from './elite-a-faces.ts';
import type { ShipDef } from './geometry.ts';

/** One world unit is four source units. See the anchor in the header. */
export const SOURCE_UNITS_PER_WORLD_UNIT = 4;

/** Source units to world units. The only conversion between the two. */
export function sourceGeometryToWorld(sourceUnits: number): number {
  return sourceUnits / SOURCE_UNITS_PER_WORLD_UNIT;
}

/**
 * One released design, converted.
 *
 * `def` is what the renderer builds; everything beside it is the source header
 * a caller might legitimately want — the target radius the guns use, the gun
 * vertex a muzzle flash would leave from, the distance the original stopped
 * drawing it at, and the report of how the face loops came out.
 */
export interface EliteAHull {
  readonly designId: number;
  readonly name: string;
  readonly def: ShipDef;
  /** Target radius in WORLD units: the catalogue's, through the one scale. */
  readonly targetRadius: number;
  /** The same radius in source units, for comparing against the pack. */
  readonly targetRadiusSourceUnits: number;
  /**
   * Where the guns sit, in world units and already nose-forward.
   *
   * `gunVertexIndex` is a real index and 0 is a real answer — the pack's byte
   * is 0 for thirty of the designs, which points at vertex 0, usually the nose.
   * Only five ships (Transporter, Cobra Mk III, Anaconda, Cobra Mk I, Asp Mk II,
   * Thargoid) name a later vertex, so there is nothing here to treat as absent.
   */
  readonly gunVertex: readonly [number, number, number];
  /** Source range at which the original stopped drawing it, in world units. */
  readonly visibilityDistance: number;
  /** The divisor the source applied to its face normals. */
  readonly normalScaleDivisor: number;
  /** What the face reconstruction found, and what it could not. */
  readonly topology: HullTopology;
}

/**
 * The nose points along -Z in world space, and `buildShip` turns it there.
 *
 * Defs are stated +Z-nose, as the source states them (CLAUDE.md invariant 7).
 * The builder used to mirror Z alone, which is a REFLECTION: identical to a half
 * turn for a left/right symmetric hull, and a mirror image for anything else.
 * Thirty of the thirty-eight released designs are symmetric and never noticed;
 * the Transporter, Thargoid, Thargon, escape pod, alloy plate, boulder,
 * asteroid and splinter are not, so the builder turns hulls now instead of
 * flipping them. This helper says where a source point ends up, for anything
 * that needs to agree with the mesh — the gun vertex below, and the tests.
 */
export function sourcePointToWorld(
  x: number, y: number, z: number,
): [number, number, number] {
  return [sourceGeometryToWorld(-x), sourceGeometryToWorld(y), sourceGeometryToWorld(-z)];
}

function buildHull(designId: number): EliteAHull {
  const design = eliteADesign(designId);
  const hull = readSourceHull(eliteAGeometry(designId));
  const topology = reconstructFaces(hull);
  const radiusSource = eliteATargetRadius(design);
  const gun = hull.vertices[design.gunVertexIndex];
  return {
    designId,
    name: design.shipName,
    def: {
      name: design.shipName,
      scale: sourceGeometryToWorld(1),
      vertices: hull.vertices.map((v) => [v.x, v.y, v.z] as [number, number, number]),
      edges: hull.edges.map((e) => [e.a, e.b] as [number, number]),
      faces: topology.loops.map((loop) => [...loop.vertices]),
    },
    targetRadius: sourceGeometryToWorld(radiusSource),
    targetRadiusSourceUnits: radiusSource,
    gunVertex: sourcePointToWorld(gun.x, gun.y, gun.z),
    visibilityDistance: sourceGeometryToWorld(design.visibilityDistance),
    normalScaleDivisor: design.normalScaleDivisor,
    topology,
  };
}

/**
 * Every released hull, converted once at load.
 *
 * Eager and immutable, so it is a constant rather than a cache: 38 hulls of a
 * few dozen edges each is microseconds, and a lazy memo would be module-level
 * mutable state for no gain (CLAUDE.md's rule on globals applies to caches too).
 */
export const ELITE_A_HULLS: readonly EliteAHull[] = eliteADesignIds().map(buildHull);

const byDesignId = new Map(ELITE_A_HULLS.map((hull) => [hull.designId, hull]));

/** One released hull by its source design id, 0-37. */
export function eliteAHull(designId: number): EliteAHull {
  const hull = byDesignId.get(designId);
  if (!hull) throw new Error(`elite-a hull: no design ${designId}`);
  return hull;
}
