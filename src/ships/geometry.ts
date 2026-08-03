import * as THREE from 'three';

// How a hull becomes a mesh — the contract and the two builders, and nothing
// else.
//
// Ships are drawn the way the 1984 originals were defined: explicit vertex and
// edge lists, so the wireframes stay clean (no triangulation diagonals), with
// the faces filled matte black underneath the edges. That is the classic
// "hidden line" look — a hull occludes whatever is behind it, including its own
// far side.
//
// THE HULLS THEMSELVES LIVE ELSEWHERE. This file used to hold twenty-odd
// hand-written approximations of the Elite ships, and every one of them is gone:
// the released tables are exact and generated, so `ships/elite-a-hulls.ts` turns
// them into `ShipDef`s and `ships/registry.ts` is how anything asks for one.
// What is left here is the format they all share. `ships/harmless-hulls.ts`
// holds the shapes that are ours and have no source record.

export interface ShipDef {
  name: string;
  /** Source-unit vertices, +Z nose. `scale` and the builder do the rest. */
  vertices: [number, number, number][];
  edges: [number, number][];
  /** Polygons (fan-triangulated) used only for the black occluding fill. */
  faces: number[][];
  scale: number;
}

const HULL_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x000000,
  side: THREE.DoubleSide,
  polygonOffset: true, // push the fill behind the edges so lines win
  polygonOffsetFactor: 2,
  polygonOffsetUnits: 2,
});

/**
 * Turn a +Z-nose definition to face three.js's forward, -Z.
 *
 * A HALF TURN about Y — both x and z negate — not the Z mirror this used to be.
 * The two agree exactly for a left/right symmetric hull, which every
 * hand-written ship here was, so nothing that existed before changes shape. The
 * released catalogue is not so tidy: eight of its thirty-eight designs
 * (Transporter, Thargoid, Thargon, escape pod, alloy plate, boulder, asteroid,
 * splinter) are asymmetric, and for those a mirror is a different ship. A
 * rotation is what "point the nose the other way" actually means, so that is
 * what the builder does. See CLAUDE.md invariant 7.
 */
function toWorld(v: [number, number, number], scale: number): [number, number, number] {
  return [-v[0] * scale, v[1] * scale, -v[2] * scale];
}

/** Wireframe ship with a black occluding hull under the edges. */
export function buildShip(def: ShipDef, color: THREE.ColorRepresentation): THREE.Group {
  const edgePositions: number[] = [];
  for (const [a, b] of def.edges) {
    edgePositions.push(...toWorld(def.vertices[a], def.scale));
    edgePositions.push(...toWorld(def.vertices[b], def.scale));
  }
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
  const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color }));

  const hullPositions: number[] = [];
  for (const poly of def.faces) {
    for (let i = 1; i < poly.length - 1; i++) {
      for (const idx of [poly[0], poly[i], poly[i + 1]]) {
        hullPositions.push(...toWorld(def.vertices[idx], def.scale));
      }
    }
  }
  const hullGeo = new THREE.BufferGeometry();
  hullGeo.setAttribute('position', new THREE.Float32BufferAttribute(hullPositions, 3));
  const hull = new THREE.Mesh(hullGeo, HULL_MATERIAL);

  const group = new THREE.Group();
  group.name = def.name;
  group.add(hull, edges);
  return group;
}

/** Seeded lumpy rock: jittered icosahedron, edges over a black hull. */
export function buildAsteroid(radius: number, seed: number, color: THREE.ColorRepresentation): THREE.Group {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const geo = new THREE.IcosahedronGeometry(radius, 0);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  // Icosahedron faces are unindexed; jitter identical vertices identically.
  const jitter = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!jitter.has(key)) jitter.set(key, 0.65 + rand() * 0.7);
    v.multiplyScalar(jitter.get(key)!);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 1),
    new THREE.LineBasicMaterial({ color }),
  );
  const hull = new THREE.Mesh(geo, HULL_MATERIAL);
  const group = new THREE.Group();
  group.add(hull, edges);
  return group;
}
