// The shapes that are OURS — no source record, and labelled so.
//
// Everything the released catalogue supplies is generated and exact
// (`ships/elite-a-hulls.ts`). What is in here is not, and the separation is a
// requirement rather than a courtesy: the generation ship is a Harmless
// encounter and must never be presented as a recovered Elite-A design. Their
// ids live in `game/ship-identity.ts` under `harmless:`, which is the same
// bargain from the other end.
//
// THE TWO STATIONS ARE HERE ON PURPOSE, and it is the one thing in this phase
// that did not convert. The released Coriolis is 160 source units across the
// half-diagonal, which is 40 world units through the one conversion — against
// the 160 the Harmless scene has always placed it at. In the source a station is
// 1.7 Cobras wide; here it is 4.7, and everything about docking is built on the
// wider one: `game/docking.ts` gates at five station half-widths, tests a
// 124x52 slot channel and rolls the ship against the slot's long axis, which is
// horizontal here and VERTICAL in the released table (the source slot is 20
// wide by 60 tall). Swapping the hull in would shrink the station fourfold and
// turn the letterbox on its side, which is a docking change, not a geometry one.
// So the exact stations are built and shown in the viewer, the scene keeps
// these, and re-tuning the approach belongs with the rebalance.

import * as THREE from 'three';

import { hullMaterial, type ShipDef } from './geometry.ts';

/** Ring-based hull generator: rings of vertices plus optional nose/tail points. */
function makeSpindle(
  name: string,
  scale: number,
  rings: { z: number; r: number; sides: number; ry?: number; rot?: number }[],
  nose?: [number, number, number],
  tail?: [number, number, number],
): ShipDef {
  const vertices: [number, number, number][] = [];
  const edges: [number, number][] = [];
  const faces: number[][] = [];
  const ringStart: number[] = [];
  for (const ring of rings) {
    ringStart.push(vertices.length);
    for (let i = 0; i < ring.sides; i++) {
      const a = (i / ring.sides) * Math.PI * 2 + (ring.rot ?? 0);
      vertices.push([Math.cos(a) * ring.r, Math.sin(a) * (ring.ry ?? ring.r), ring.z]);
    }
  }
  for (let ri = 0; ri < rings.length; ri++) {
    const n = rings[ri].sides;
    const s = ringStart[ri];
    for (let i = 0; i < n; i++) edges.push([s + i, s + ((i + 1) % n)]);
    if (ri > 0 && rings[ri - 1].sides === n) {
      const p = ringStart[ri - 1];
      for (let i = 0; i < n; i++) {
        edges.push([p + i, s + i]);
        faces.push([p + i, p + ((i + 1) % n), s + ((i + 1) % n), s + i]);
      }
    }
  }
  const cap = (point: [number, number, number], ri: number) => {
    const idx = vertices.length;
    vertices.push(point);
    const n = rings[ri].sides;
    const s = ringStart[ri];
    for (let i = 0; i < n; i++) {
      edges.push([idx, s + i]);
      faces.push([idx, s + i, s + ((i + 1) % n)]);
    }
  };
  if (nose) cap(nose, 0);
  else faces.push(Array.from({ length: rings[0].sides }, (_, i) => ringStart[0] + i));
  if (tail) cap(tail, rings.length - 1);
  else faces.push(Array.from({ length: rings[rings.length - 1].sides }, (_, i) => ringStart[rings.length - 1] + i));
  return { name, scale, vertices, edges, faces };
}

/**
 * A generation ship: enormous, slow, ancient, and ours.
 *
 * Built from rings so the hull reads as a vast cylinder with a habitat drum
 * amidships. The source roster has no design for a derelict colony vessel, which
 * is exactly why this one carries a `harmless:` id.
 */
export const GENERATION_SHIP = makeSpindle(
  'Generation Ship', 1,
  [
    { z: 900, r: 90, sides: 8, rot: Math.PI / 8 },
    { z: 400, r: 150, sides: 8, rot: Math.PI / 8 },
    { z: 100, r: 340, sides: 8, rot: Math.PI / 8 },  // habitat drum
    { z: -200, r: 340, sides: 8, rot: Math.PI / 8 },
    { z: -500, r: 150, sides: 8, rot: Math.PI / 8 },
    { z: -900, r: 110, sides: 8, rot: Math.PI / 8 },
  ],
);

/** How far out the generation ship's drum reaches — its collision radius. */
export const GENERATION_SHIP_RADIUS = 340;

/** The hollowed asteroid the player can dock with. Procedural, so no ShipDef. */
export const ROCK_HERMIT_RADIUS = 120;

/**
 * The Coriolis, at the size the Harmless scene is built around.
 *
 * The twelve hull vertices are the released ones; the scale and the letterbox
 * are not, and the header above says why. Front and rear faces are diamonds, the
 * waist is a square, with a horizontal docking slot in the front face.
 */
export const CORIOLIS: ShipDef = {
  name: 'Coriolis Station',
  scale: 1,
  vertices: [
    [160, 0, 160], [0, 160, 160], [-160, 0, 160], [0, -160, 160],   // 0-3 front diamond
    [160, 160, 0], [-160, 160, 0], [-160, -160, 0], [160, -160, 0], // 4-7 waist square
    [160, 0, -160], [0, 160, -160], [-160, 0, -160], [0, -160, -160], // 8-11 rear diamond
    [48, 10, 160], [48, -10, 160], [-48, -10, 160], [-48, 10, 160], // 12-15 docking slot
  ],
  edges: [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [8, 9], [9, 10], [10, 11], [11, 8],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [0, 7], [1, 4], [1, 5], [2, 5], [2, 6], [3, 6], [3, 7],
    [8, 4], [8, 7], [9, 4], [9, 5], [10, 5], [10, 6], [11, 6], [11, 7],
    [12, 13], [13, 14], [14, 15], [15, 12],
  ],
  faces: [
    [0, 1, 2, 3], [8, 9, 10, 11],
    [0, 1, 4], [1, 5, 4], [1, 2, 5], [2, 6, 5],
    [2, 3, 6], [3, 7, 6], [3, 0, 7], [0, 4, 7],
    [8, 9, 4], [9, 5, 4], [9, 10, 5], [10, 6, 5],
    [10, 11, 6], [11, 7, 6], [11, 8, 7], [8, 4, 7],
  ],
};

/** Distance from the Coriolis's centre to the slot face plane. */
export const CORIOLIS_DOCK_Z = 160;

/** Dodecahedral "Dodo" station for high-tech systems — also at scene scale. */
export function buildDodoStation(color: THREE.ColorRepresentation): {
  group: THREE.Group; dockZ: number;
} {
  const geo = new THREE.DodecahedronGeometry(170);
  // orient the first face's normal along -Z so the slot faces forward
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const a = new THREE.Vector3().fromBufferAttribute(pos, 0);
  const b = new THREE.Vector3().fromBufferAttribute(pos, 1);
  const c = new THREE.Vector3().fromBufferAttribute(pos, 2);
  const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(normal, new THREE.Vector3(0, 0, -1));
  geo.applyQuaternion(q);
  const dockZ = Math.abs(a.clone().applyQuaternion(q).dot(new THREE.Vector3(0, 0, 1)));

  const group = new THREE.Group();
  group.name = 'Dodo Station';
  const hull = new THREE.Mesh(geo, hullMaterial());
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 1),
    new THREE.LineBasicMaterial({ color }),
  );
  // Docking port on the front face, sitting just PROUD of it.
  //
  // This was -(dockZ - 0.5), which put it half a unit inside the hull — and
  // the hull is an opaque black mesh, so from outside the station the port was
  // simply not there. On a 170-unit station half a unit out is invisible as an
  // offset and guarantees the lines draw in front of the fill.
  const slot = new THREE.BufferGeometry();
  const z = -(dockZ + 0.5);
  slot.setAttribute('position', new THREE.Float32BufferAttribute([
    48, 10, z, 48, -10, z, 48, -10, z, -48, -10, z,
    -48, -10, z, -48, 10, z, -48, 10, z, 48, 10, z,
  ], 3));
  group.add(hull, edges, new THREE.LineSegments(slot, new THREE.LineBasicMaterial({ color })));
  return { group, dockZ };
}
