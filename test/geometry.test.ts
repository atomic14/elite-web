// The 38 released hulls: are they all there, closed, the right way round, and
// the right size?
//
// TODO 21's gate (elite-a-catalogue.test.ts) proves the IMPORT is the pack's.
// This is the gate on what the renderer does with it: that the conversion is one
// number, that every count still matches the source header, that every face
// came back as a closed polygon, that nothing was dropped without saying so, and
// that the nose ends up along -Z with no per-ship exception.
//
// The counts below are pinned. They are not magic numbers — they are the pack's
// own header fields, read back through the catalogue — but the ones that ARE
// literal (two normal fallbacks on the Splinter, one whole-hull loop on the
// alloy plate, one coplanar merge on the Adder) are the ambiguities this phase
// found and resolved, and a re-import that changed them should fail here rather
// than be believed.

import * as THREE from 'three';

import { check, eq } from './harness.ts';
import { eliteADesign, eliteADesignIds } from '../src/game/elite-a/catalogue.ts';
import {
  HARMLESS_OVERLAYS, shipDesignIdOf, SHIP_DESIGN_IDS,
} from '../src/game/ship-identity.ts';
import { SPECS, CONSTRICTOR_SPEC } from '../src/game/ship-specs.ts';
import type { NpcRole } from '../src/game/ship-roles.ts';
import { NpcShip } from '../src/game/npc.ts';
import { hitCone } from '../src/game/gunnery.ts';
import { traceShot } from '../src/game/shot.ts';
import { buildShip } from '../src/ships/geometry.ts';
import {
  eliteAHull, ELITE_A_HULLS, SOURCE_UNITS_PER_WORLD_UNIT, sourceGeometryToWorld,
  sourcePointToWorld,
} from '../src/ships/elite-a-hulls.ts';
import {
  OBJECT_DESIGNS, registeredHull, requireShipDef, shipTargetRadius, SOURCE_HULLS,
} from '../src/ships/registry.ts';

console.log('\n--- ship geometry ---');

// --- one conversion ---------------------------------------------------------
//
// The anchor: source design 10 IS the Cobra Mk III, and its table is the one
// ships/geometry.ts shipped by hand with `scale: 0.25`. So the only conversion
// that keeps the Cobra the size it has always been is a quarter, and it applies
// to everything.

eq('one world unit is four source units', SOURCE_UNITS_PER_WORLD_UNIT, 4);
eq('the Cobra keeps its 0.25 scale', eliteAHull(10).def.scale, 0.25);
check('every design is built at the SAME scale — no per-ship factor',
  ELITE_A_HULLS.every((hull) => hull.def.scale === sourceGeometryToWorld(1)));
check('the Cobra nose is still at 76 source units, 19 world units',
  eliteAHull(10).def.vertices[0][2] === 76
  && sourceGeometryToWorld(76) === 19);
check('target radii go through the same conversion',
  ELITE_A_HULLS.every((hull) =>
    hull.targetRadius === sourceGeometryToWorld(hull.targetRadiusSourceUnits)));

// --- counts match the source header -----------------------------------------

const countMismatch = ELITE_A_HULLS.filter((hull) => {
  const design = eliteADesign(hull.designId);
  return hull.def.vertices.length !== design.vertexCount
    || hull.def.edges.length !== design.edgeCount;
});
eq('38 hulls', ELITE_A_HULLS.length, 38);
eq('...one per catalogue design', ELITE_A_HULLS.length, eliteADesignIds().length);
check('every vertex and edge count matches the source header',
  countMismatch.length === 0,
  countMismatch.map((h) => `${h.designId} ${h.name}`).join(', '));

const faceCover = ELITE_A_HULLS.filter((hull) => {
  const covered = hull.topology.loops.reduce((n, loop) => n + loop.faces.length, 0);
  return covered !== eliteADesign(hull.designId).faceCount;
});
check('every source face is covered by exactly one reconstructed polygon',
  faceCover.length === 0,
  faceCover.map((h) => `${h.designId} ${h.name}`).join(', '));

const unresolved = ELITE_A_HULLS.filter((h) => h.topology.unresolved.length > 0);
check('no face was left unresolved', unresolved.length === 0,
  unresolved.map((h) => `${h.designId} ${h.name}: ${h.topology.unresolved}`).join(' · '));

// --- every index resolves ----------------------------------------------------

const badIndex = ELITE_A_HULLS.filter((hull) => {
  const n = hull.def.vertices.length;
  const inRange = (i: number): boolean => Number.isInteger(i) && i >= 0 && i < n;
  return hull.def.edges.some(([a, b]) => !inRange(a) || !inRange(b))
    || hull.def.faces.some((poly) => poly.some((i) => !inRange(i)));
});
check('every edge and face index points at a real vertex', badIndex.length === 0,
  badIndex.map((h) => h.name).join(', '));

// --- the hulls are closed ----------------------------------------------------
//
// A closed surface uses each of its boundary edges exactly twice, once from
// each side. That is the property the black fill needs: an odd edge is a hole,
// and a hole is a hull you can see through.

const openHull: string[] = [];
for (const hull of ELITE_A_HULLS) {
  const used = new Map<string, number>();
  for (const poly of hull.def.faces) {
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      used.set(key, (used.get(key) ?? 0) + 1);
    }
  }
  const odd = [...used.values()].filter((n) => n !== 2).length;
  // The alloy plate is a single flat quad and cannot be closed — it is a plate.
  if (odd > 0 && hull.designId !== 3) openHull.push(`${hull.name} (${odd} edges)`);
}
check('every hull but the alloy plate is closed — each edge used twice',
  openHull.length === 0, openHull.join(', '));

const plate = eliteAHull(3);
check('...and the alloy plate is the one open surface: one quad, four edges',
  plate.def.faces.length === 1 && plate.def.faces[0].length === 4
  && plate.topology.loops[0].method === 'whole-hull');

// --- winding and orientation -------------------------------------------------

const outward = ELITE_A_HULLS.flatMap((hull) =>
  hull.topology.normalMismatch.map((face) => `${hull.name} f${face}`));
check('exactly three faces could not be wound by their stored normal'
  + ` — ${outward.join(', ')}`,
outward.length === 3
  && outward.every((f) => f.startsWith('Splinter') || f.startsWith('Alloy plate')));
check('...the alloy plate because its stored normal is (0,0,0)',
  eliteAHull(3).topology.loops[0].winding === 'outward');
check('...and the Splinter because two of its released normals sit past 60 degrees'
  + ' off its own geometry',
eliteAHull(7).topology.loops.filter((l) => l.winding === 'outward').length === 2);
check('every other polygon agrees with its stored normal to within 60 degrees',
  ELITE_A_HULLS.every((hull) => hull.topology.loops.every((loop) =>
    loop.winding === 'outward' || loop.skewDegrees < 60)));

// --- what was deliberately not folded into a face ----------------------------

const decorative = ELITE_A_HULLS.reduce(
  (n, hull) => n + hull.topology.decorativeEdges.length, 0);
check(`${decorative} decorative edges bound no face and are still drawn`,
  decorative > 0
  && ELITE_A_HULLS.every((hull) =>
    hull.topology.decorativeEdges.every((i) => i < hull.def.edges.length)));
check('...including the Coriolis and Dodo docking slots (four edges each)',
  eliteAHull(1).topology.decorativeEdges.length === 4
  && eliteAHull(0).topology.decorativeEdges.length === 4);
check('...and the Cobra\'s exhaust ring and nose laser (15 edges)',
  eliteAHull(10).topology.decorativeEdges.length === 15);
eq('the Adder\'s flat back is one coplanar merge of three faces',
  eliteAHull(20).topology.loops.filter((l) => l.method === 'coplanar-merge').length, 1);

// --- the nose points along -Z, for every design ------------------------------
//
// buildShip turns a +Z-nose definition by a HALF TURN about Y, not a Z mirror.
// The two agree for a symmetric hull and differ for the eight released designs
// that are not; the test is that the built mesh really is the source hull
// turned round, which is what a mirror would fail.

const nosedWrong: string[] = [];
const mirrored: string[] = [];
for (const hull of ELITE_A_HULLS) {
  const group = buildShip(hull.def, 0xffffff);
  const line = group.children.find(
    (c) => c instanceof THREE.LineSegments) as THREE.LineSegments;
  const position = line.geometry.getAttribute('position');
  let minZ = Infinity;
  for (let i = 0; i < position.count; i += 1) minZ = Math.min(minZ, position.getZ(i));
  // the source's furthest-forward vertex must be the mesh's furthest -Z point
  const sourceNose = Math.max(...hull.def.vertices.map((v) => v[2]));
  if (Math.abs(-sourceGeometryToWorld(sourceNose) - minZ) > 1e-4) {
    nosedWrong.push(`${hull.name} nose ${minZ}`);
  }
  // The buffer is two points per edge, in order, so each one can be checked
  // against the ROTATION of its source vertex. A mirror would place the eight
  // asymmetric hulls' x the other way round and be caught here.
  let wrong = 0;
  hull.def.edges.forEach(([a, b], edge) => {
    for (const [slot, index] of [[0, a], [1, b]] as const) {
      const [x, y, z] = hull.def.vertices[index];
      const want = sourcePointToWorld(x, y, z);
      const at = edge * 2 + slot;
      if (Math.abs(position.getX(at) - want[0]) > 1e-4
        || Math.abs(position.getY(at) - want[1]) > 1e-4
        || Math.abs(position.getZ(at) - want[2]) > 1e-4) wrong += 1;
    }
  });
  if (wrong > 0) mirrored.push(`${hull.name} (${wrong} points)`);
}
check('every design comes out -Z nose-forward, with no per-ship exception',
  nosedWrong.length === 0, nosedWrong.join(', '));
check('...as a half turn, not a mirror — the eight asymmetric hulls included',
  mirrored.length === 0, mirrored.slice(0, 4).join(', '));

// --- the registry is the only way in -----------------------------------------

check('every design id resolves to a hull', SHIP_DESIGN_IDS.every((id) => {
  const hull = registeredHull(id);
  return hull.targetRadius > 0 && typeof hull.name === 'string';
}));
eq('the 38 source designs report as source', SOURCE_HULLS.length, 38);
check('the two Harmless designs report as ours',
  registeredHull(HARMLESS_OVERLAYS.generationShip.designId).source === 'harmless'
  && registeredHull(HARMLESS_OVERLAYS.rockHermit.designId).source === 'harmless');
check('the rock hermit is generated, so it has no tabulated hull',
  registeredHull(HARMLESS_OVERLAYS.rockHermit.designId).def === null);
check('the canister and the missile are released designs 4 and 15',
  OBJECT_DESIGNS.cargoCanister === shipDesignIdOf(4)
  && OBJECT_DESIGNS.missile === shipDesignIdOf(15)
  && requireShipDef(OBJECT_DESIGNS.missile).name === 'Missile');

// --- the ray/hit radius is the catalogue's ------------------------------------
//
// This is the phase's one deliberate behaviour change: `game/gunnery.ts`'s hit
// cone and `game/collisions.ts`'s separation both read `spec.radius`, and that
// number is no longer hand-tuned per roster row.

// There is nowhere left for a row to state a size: `NpcSpec` has no `radius`
// field, so the number a ship is shot at with is the design's or it is nothing.
// This checks the ship the game actually builds, not the table.
const built = [
  ...Object.entries(SPECS).flatMap(([role, list]) => list.map(
    (spec) => new NpcShip(role as NpcRole, new THREE.Vector3(), 0, spec))),
  new NpcShip('pirate', new THREE.Vector3(), 0, CONSTRICTOR_SPEC),
];
const offRadius = built.filter(
  (npc) => npc.radius !== shipTargetRadius(npc.designId));
check('every roster hull uses its design\'s catalogue radius', offRadius.length === 0,
  offRadius.map((n) => n.designId).join(', '));
check('...which for the roster Cobra Mk III is 95 source units = 23.75 world',
  shipTargetRadius(shipDesignIdOf(10)) === 23.75);
check('no two roster rows of the same design disagree about size',
  new Set(built.map((n) => `${n.designId}:${n.radius}`)).size
  === new Set(built.map((n) => n.designId)).size);

// --- and a shot really is traced against it ----------------------------------
//
// Two halves of the same claim. The squarely-on ray proves the RECONSTRUCTED
// FILL is what stops a shot — before this phase the Cobra's fill was eleven
// hand-written polygons, and a hull with a hole in it is a hull you can shoot
// through. The grazing ray proves the new radius is the one in force: 34 world
// units bought a 0.096 rad cone at 500, and the catalogue's 23.75 buys 0.078,
// so there is a band that used to hit and now does not. That narrowing is this
// TODO's one deliberate behaviour change (rebalancing it is TODO 29's).

const target = {
  object: buildShip(requireShipDef(shipDesignIdOf(10)), 0xffffff),
  state: { alive: true },
  radius: shipTargetRadius(shipDesignIdOf(10)),
};
target.object.position.set(0, 0, -500);
const ray = new THREE.Raycaster();
const scratch = new THREE.Vector3();
const shootAt = (angle: number) => traceShot(
  new THREE.Vector3(),
  new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle)),
  [target], [], null, ray, scratch);

check('a shot straight at a Cobra stops against the reconstructed hull',
  shootAt(0).kind === 'ship');
const nowCone = hitCone(23.75, 500);
const thenCone = hitCone(34, 500);
check(`the hit cone narrowed from ${thenCone.toFixed(4)} to ${nowCone.toFixed(4)} rad at 500`,
  nowCone < thenCone);
check('...a graze inside the new cone still connects',
  shootAt(nowCone * 0.97).kind === 'ship');
check('...and one that only the old radius would have caught now misses',
  shootAt((nowCone + thenCone) / 2).kind === 'miss');
