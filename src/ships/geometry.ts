import * as THREE from 'three';

// Ships are defined the way the 1984 originals were: explicit vertex and edge
// lists, so the wireframes stay clean (no triangulation diagonals). Faces are
// filled matte black underneath the edges — the classic "hidden line" look:
// hulls occlude whatever is behind them, including their own far side.
// Convention here matches the original data: +Z is the nose. The builder
// flips Z so ships fly along three.js's forward (-Z); hulls are symmetric so
// the mirror is invisible.

export interface ShipDef {
  name: string;
  vertices: [number, number, number][];
  edges: [number, number][];
  /** Polygons (fan-triangulated) used only for the black occluding fill. */
  faces: number[][];
  scale: number;
}

export const COBRA_MK3: ShipDef = {
  name: 'Cobra Mk III',
  scale: 0.25,
  vertices: [
    [32, 0, 76], [-32, 0, 76],          // 0,1 nose edge
    [0, 26, 24],                        // 2  dorsal hump
    [-120, -3, -8], [120, -3, -8],      // 3,4 wingtips
    [-88, 16, -40], [88, 16, -40],      // 5,6 rear top outer
    [128, -8, -40], [-128, -8, -40],    // 7,8 rear wingtips
    [0, 26, -40],                       // 9  rear top centre
    [-32, -24, -40], [32, -24, -40],    // 10,11 rear bottom
    // rear exhaust octagon
    [-36, 8, -40], [-8, 12, -40], [8, 12, -40], [36, 8, -40],
    [36, -12, -40], [8, -16, -40], [-8, -16, -40], [-36, -12, -40],
  ],
  edges: [
    [0, 1], [0, 4], [1, 3], [3, 8], [4, 7],
    [9, 6], [6, 7], [7, 11], [11, 10], [10, 8], [8, 5], [5, 9],
    [0, 2], [1, 2], [2, 9], [2, 5], [2, 6],
    [0, 11], [1, 10], [3, 10], [4, 11], [3, 5], [4, 6],
    [12, 13], [13, 14], [14, 15], [15, 16], [16, 17], [17, 18], [18, 19], [19, 12],
  ],
  faces: [
    [0, 1, 2],
    [1, 2, 9, 5, 3],
    [0, 4, 6, 9, 2],
    [9, 6, 7, 11, 10, 8, 5],
    [1, 0, 11, 10],
    [1, 3, 10], [3, 8, 10],
    [0, 11, 4], [4, 11, 7],
    [3, 5, 8], [4, 6, 7],
  ],
};

export const SIDEWINDER: ShipDef = {
  name: 'Sidewinder',
  scale: 0.25,
  vertices: [
    [-32, 0, 36], [32, 0, 36],    // 0,1 front edge
    [64, 0, -28], [-64, 0, -28],  // 2,3 rear wingtips
    [0, 16, -28], [0, -16, -28],  // 4,5 rear top / bottom
  ],
  edges: [
    [0, 1], [1, 2], [0, 3],
    [4, 2], [2, 5], [5, 3], [3, 4],
    [0, 4], [1, 4], [0, 5], [1, 5],
  ],
  faces: [
    [0, 1, 4], [1, 2, 4], [0, 4, 3],
    [0, 1, 5], [1, 2, 5], [0, 5, 3],
    [4, 2, 5], [4, 5, 3],
  ],
};

export const VIPER: ShipDef = {
  name: 'Viper',
  scale: 0.25,
  vertices: [
    [0, 0, 72],                     // 0 nose
    [0, 16, 24], [0, -16, 24],      // 1,2 dorsal / ventral ridge
    [48, 0, -24], [-48, 0, -24],    // 3,4 wingtips
    [24, -16, -24], [-24, -16, -24],// 5,6 rear bottom
    [24, 16, -24], [-24, 16, -24],  // 7,8 rear top
  ],
  edges: [
    [0, 3], [0, 4], [0, 1], [0, 2],
    [1, 7], [1, 8], [2, 5], [2, 6],
    [3, 7], [7, 8], [8, 4], [4, 6], [6, 5], [5, 3],
  ],
  faces: [
    [0, 1, 7, 3], [0, 1, 8, 4],
    [0, 2, 5, 3], [0, 2, 6, 4],
    [3, 7, 8, 4, 6, 5],
  ],
};

export const MISSILE: ShipDef = {
  name: 'Missile',
  scale: 1,
  vertices: [
    [0, 0, 16],
    [3, 3, -6], [-3, 3, -6], [-3, -3, -6], [3, -3, -6],
    [6, 6, -8], [-6, 6, -8], [-6, -6, -8], [6, -6, -8], // fins
  ],
  edges: [
    [0, 1], [0, 2], [0, 3], [0, 4],
    [1, 2], [2, 3], [3, 4], [4, 1],
    [1, 5], [2, 6], [3, 7], [4, 8],
  ],
  faces: [
    [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1], [1, 2, 3, 4],
  ],
};

// The Coriolis: front and rear faces are diamonds, the waist is a square,
// with a letterbox docking slot in the front face.
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

const HULL_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x000000,
  side: THREE.DoubleSide,
  polygonOffset: true, // push the fill behind the edges so lines win
  polygonOffsetFactor: 2,
  polygonOffsetUnits: 2,
});

/** Wireframe ship with a black occluding hull under the edges. */
export function buildShip(def: ShipDef, color: THREE.ColorRepresentation): THREE.Group {
  const edgePositions: number[] = [];
  for (const [a, b] of def.edges) {
    const va = def.vertices[a];
    const vb = def.vertices[b];
    edgePositions.push(
      va[0] * def.scale, va[1] * def.scale, -va[2] * def.scale,
      vb[0] * def.scale, vb[1] * def.scale, -vb[2] * def.scale,
    );
  }
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
  const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color }));

  const hullPositions: number[] = [];
  for (const poly of def.faces) {
    for (let i = 1; i < poly.length - 1; i++) {
      for (const idx of [poly[0], poly[i], poly[i + 1]]) {
        const v = def.vertices[idx];
        hullPositions.push(v[0] * def.scale, v[1] * def.scale, -v[2] * def.scale);
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

// --- Extended roster -------------------------------------------------------
// Approximations of the classic hulls, same vertex/edge/face format.

export const ADDER: ShipDef = {
  name: 'Adder',
  scale: 0.25,
  vertices: [
    [16, 0, 40], [-16, 0, 40],
    [28, 8, -8], [-28, 8, -8], [28, -8, -8], [-28, -8, -8],
    [16, 8, -36], [-16, 8, -36], [16, -8, -36], [-16, -8, -36],
  ],
  edges: [
    [0, 1], [0, 2], [0, 4], [1, 3], [1, 5],
    [2, 3], [4, 5], [2, 4], [3, 5],
    [2, 6], [3, 7], [4, 8], [5, 9],
    [6, 7], [7, 9], [9, 8], [8, 6],
  ],
  faces: [
    [0, 1, 3, 2], [2, 3, 7, 6], [0, 1, 5, 4], [4, 5, 9, 8],
    [0, 2, 4], [1, 3, 5], [2, 4, 8, 6], [3, 5, 9, 7], [6, 7, 9, 8],
  ],
};

export const KRAIT: ShipDef = {
  name: 'Krait',
  scale: 0.25,
  vertices: [
    [0, 0, 60], [0, 14, -30], [0, -14, -30], [60, 0, -20], [-60, 0, -20],
  ],
  edges: [
    [0, 1], [0, 2], [0, 3], [0, 4],
    [1, 3], [3, 2], [2, 4], [4, 1],
  ],
  faces: [
    [0, 1, 3], [0, 3, 2], [0, 2, 4], [0, 4, 1], [1, 3, 2], [1, 2, 4],
  ],
};

export const MAMBA: ShipDef = {
  name: 'Mamba',
  scale: 0.25,
  vertices: [
    [0, 4, 64],
    [64, 0, -24], [-64, 0, -24],
    [24, 14, -24], [-24, 14, -24],
    [24, -10, -24], [-24, -10, -24],
  ],
  edges: [
    [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6],
    [1, 3], [3, 4], [4, 2], [2, 6], [6, 5], [5, 1],
  ],
  faces: [
    [0, 1, 3], [0, 3, 4], [0, 4, 2], [0, 1, 5], [0, 5, 6], [0, 6, 2],
    [1, 3, 4, 2, 6, 5],
  ],
};

export const ASP: ShipDef = {
  name: 'Asp Mk II',
  scale: 0.25,
  vertices: [
    [0, 0, 72],
    [44, 0, -8], [-44, 0, -8], [0, 10, -8], [0, -8, -8],
    [0, 8, -40], [30, 0, -40], [-30, 0, -40], [0, -6, -40],
  ],
  edges: [
    [0, 1], [0, 2], [0, 3], [0, 4],
    [1, 3], [2, 3], [1, 4], [2, 4],
    [1, 6], [2, 7], [3, 5], [4, 8],
    [5, 6], [6, 8], [8, 7], [7, 5],
  ],
  faces: [
    [0, 1, 3], [0, 3, 2], [0, 1, 4], [0, 4, 2],
    [1, 3, 5, 6], [2, 3, 5, 7], [1, 4, 8, 6], [2, 4, 8, 7],
    [5, 6, 8, 7],
  ],
};

export const FER_DE_LANCE: ShipDef = {
  name: 'Fer-de-Lance',
  scale: 0.25,
  vertices: [
    [18, -4, 68], [-18, -4, 68],
    [0, 10, 20],
    [52, -4, -36], [-52, -4, -36],
    [20, 10, -36], [-20, 10, -36],
    [28, -12, -36], [-28, -12, -36],
  ],
  edges: [
    [0, 1], [0, 3], [1, 4], [0, 2], [1, 2],
    [2, 5], [2, 6],
    [3, 5], [5, 6], [6, 4], [4, 8], [8, 7], [7, 3],
    [0, 7], [1, 8],
  ],
  faces: [
    [0, 1, 2], [0, 3, 5, 2], [1, 2, 6, 4], [2, 5, 6],
    [3, 5, 6, 4, 8, 7], [0, 1, 8, 7], [0, 7, 3], [1, 4, 8],
  ],
};

export const PYTHON: ShipDef = {
  name: 'Python',
  scale: 0.25,
  vertices: [
    [0, 0, 112],
    [0, 26, -16], [0, -26, -16], [58, 0, -16], [-58, 0, -16],
    [0, 0, -80],
  ],
  edges: [
    [0, 1], [0, 2], [0, 3], [0, 4],
    [5, 1], [5, 2], [5, 3], [5, 4],
    [1, 3], [3, 2], [2, 4], [4, 1],
  ],
  faces: [
    [0, 1, 3], [0, 3, 2], [0, 2, 4], [0, 4, 1],
    [5, 1, 3], [5, 3, 2], [5, 2, 4], [5, 4, 1],
  ],
};

export const WORM: ShipDef = {
  name: 'Worm',
  scale: 0.25,
  vertices: [
    [12, -5, 32], [-12, -5, 32],
    [26, -5, -28], [-26, -5, -28],
    [14, 9, -28], [-14, 9, -28],
  ],
  edges: [
    [0, 1], [0, 2], [1, 3], [2, 3],
    [0, 4], [1, 5], [4, 5], [2, 4], [3, 5],
  ],
  faces: [
    [0, 1, 3, 2], [0, 1, 5, 4], [0, 2, 4], [1, 3, 5], [2, 3, 5, 4],
  ],
};

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

export const ANACONDA = makeSpindle(
  'Anaconda', 0.25,
  [
    { z: 70, r: 26, sides: 6, rot: Math.PI / 6 },
    { z: -20, r: 44, sides: 6, rot: Math.PI / 6 },
    { z: -95, r: 34, sides: 6, rot: Math.PI / 6 },
  ],
  [0, 0, 140],
);

export const THARGOID = makeSpindle(
  'Thargoid Invader', 1,
  [
    { z: 12, r: 48, sides: 8, rot: Math.PI / 8 },
    { z: -10, r: 95, sides: 8, rot: Math.PI / 8 },
  ],
);

export const THARGON = makeSpindle(
  'Thargon', 1,
  [
    { z: 5, r: 11, sides: 8 },
    { z: -5, r: 19, sides: 8 },
  ],
);

export const CONSTRICTOR: ShipDef = {
  name: 'Constrictor',
  scale: 0.3,
  vertices: [
    [0, -4, 90], [24, 4, 40], [-24, 4, 40],
    [50, -4, -30], [-50, -4, -30],
    [20, 12, -30], [-20, 12, -30],
    [26, -12, -30], [-26, -12, -30],
  ],
  edges: [
    [0, 1], [0, 2], [1, 2], [1, 3], [2, 4], [1, 5], [2, 6],
    [3, 5], [5, 6], [6, 4], [4, 8], [8, 7], [7, 3],
    [0, 7], [0, 8],
  ],
  faces: [
    [0, 1, 2], [1, 3, 5], [2, 6, 4], [1, 2, 6, 5],
    [3, 5, 6, 4, 8, 7], [0, 1, 3, 7], [0, 2, 4, 8], [0, 7, 8],
  ],
};

export const CANISTER = makeSpindle(
  'Cargo Canister', 1,
  [
    { z: 9, r: 8, sides: 6 },
    { z: -9, r: 8, sides: 6 },
  ],
);

/** Dodecahedral "Dodo" station for high-tech systems. */
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
  const hull = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0x000000, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
  }));
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 1),
    new THREE.LineBasicMaterial({ color }),
  );
  // docking slot on the front face
  const slot = new THREE.BufferGeometry();
  const z = -(dockZ - 0.5);
  slot.setAttribute('position', new THREE.Float32BufferAttribute([
    48, 10, z, 48, -10, z, 48, -10, z, -48, -10, z,
    -48, -10, z, -48, 10, z, -48, 10, z, 48, 10, z,
  ], 3));
  group.add(hull, edges, new THREE.LineSegments(slot, new THREE.LineBasicMaterial({ color })));
  return { group, dockZ };
}
