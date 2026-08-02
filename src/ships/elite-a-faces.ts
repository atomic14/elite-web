// Closed polygons, worked back out of the source's face/edge adjacency.
//
// The released tables never stored a polygon. A face is a normal and a
// visibility distance; an edge says which two faces it lies BETWEEN. That was
// enough for the original renderer, which drew lines and hid them with a
// per-face facing test, and it is not enough for Harmless, which fills the hull
// matte black under the wireframe so a ship occludes what is behind it. So the
// boundary of each face has to be reconstructed, and this is the only place
// that happens.
//
// Three passes, narrowing:
//
//   1. BOUNDARY. A face's boundary is the edges that name it on exactly one
//      side. Some of those are decorative spurs — the Cobra's nose laser is an
//      edge given two real face ids purely so it disappears with them — so
//      dangling ends are pruned until every vertex has two neighbours, and the
//      result must be one cycle covering every remaining edge.
//   2. COPLANAR MERGE. A flat back split into several faces with the SAME
//      normal has no closed boundary of its own: the Adder's rear hexagon is
//      three faces contributing two edges each. Faces that failed pass 1 and
//      share a normal are retried as one region.
//   3. WHOLE HULL. A design whose face is named by no edge at all — the alloy
//      plate, one face and four edges that all say "no face" — is a single
//      polygon, so its own edge cycle is the loop.
//
// Nothing is dropped quietly. A face that survives all three unresolved is
// REPORTED, as are the edges that end up in no loop and the faces whose stored
// normal disagrees with the polygon that was found. `test/geometry.test.ts`
// reads those reports and pins the counts, so a re-import that changed the
// topology could not slip past as "it still renders".

import { ELITE_A_NO_FACE } from '../game/elite-a/catalogue.ts';
import type { EliteAGeometry } from '../game/elite-a/types.ts';

/** Column strides in the generated flat arrays — the columns are in types.ts. */
export const VERTEX_STRIDE = 8;
export const EDGE_STRIDE = 5;
export const FACE_STRIDE = 4;

export interface SourceVertex {
  readonly x: number; readonly y: number; readonly z: number;
  /** the four face slots; `ELITE_A_NO_FACE` means "none", never an index */
  readonly faces: readonly number[];
  readonly visibility: number;
}

export interface SourceEdge {
  readonly a: number; readonly b: number;
  readonly face1: number; readonly face2: number;
  readonly visibility: number;
}

export interface SourceFace {
  readonly nx: number; readonly ny: number; readonly nz: number;
  readonly visibility: number;
}

/** One hull, unpacked from the flat arrays. Source units, +Z nose. */
export interface SourceHull {
  readonly designId: number;
  readonly vertices: readonly SourceVertex[];
  readonly edges: readonly SourceEdge[];
  readonly faces: readonly SourceFace[];
}

/** Unpack the generated strides into records. Pure; allocates a fresh hull. */
export function readSourceHull(geometry: EliteAGeometry): SourceHull {
  const vertices: SourceVertex[] = [];
  for (let i = 0; i < geometry.vertices.length; i += VERTEX_STRIDE) {
    const v = geometry.vertices;
    vertices.push({
      x: v[i], y: v[i + 1], z: v[i + 2],
      faces: [v[i + 3], v[i + 4], v[i + 5], v[i + 6]],
      visibility: v[i + 7],
    });
  }
  const edges: SourceEdge[] = [];
  for (let i = 0; i < geometry.edges.length; i += EDGE_STRIDE) {
    const e = geometry.edges;
    edges.push({
      a: e[i], b: e[i + 1], face1: e[i + 2], face2: e[i + 3], visibility: e[i + 4],
    });
  }
  const faces: SourceFace[] = [];
  for (let i = 0; i < geometry.faces.length; i += FACE_STRIDE) {
    const f = geometry.faces;
    faces.push({ nx: f[i], ny: f[i + 1], nz: f[i + 2], visibility: f[i + 3] });
  }
  return { designId: geometry.designId, vertices, edges, faces };
}

/** Which pass found this loop — see the header. */
export type LoopMethod = 'boundary' | 'coplanar-merge' | 'whole-hull';

/** How the polygon was wound: by the stored normal, or away from the hull. */
export type Winding = 'face-normal' | 'outward';

export interface FaceLoop {
  /** the source faces this polygon covers — more than one after a merge */
  readonly faces: readonly number[];
  /** vertex indices in order, wound so the polygon faces outwards */
  readonly vertices: readonly number[];
  readonly method: LoopMethod;
  readonly winding: Winding;
  /** decorative spurs pruned while closing it (see pass 1) */
  readonly spurs: number;
  /** degrees between the wound polygon and the stored normal — 0 is exact */
  readonly skewDegrees: number;
}

export interface HullTopology {
  readonly loops: readonly FaceLoop[];
  /** faces no closed polygon could be found for, reported rather than hidden */
  readonly unresolved: readonly number[];
  /** faces whose stored normal disagrees with the polygon that was found */
  readonly normalMismatch: readonly number[];
  /** edge indices in no loop: decorative, still drawn, bounding nothing */
  readonly decorativeEdges: readonly number[];
}

/**
 * Below this |cos| the stored normal is not trusted to wind the polygon, and
 * the loop is wound away from the hull's centroid instead. Only the Splinter
 * needs it: its four stored normals sit 31-134 degrees off its own geometry,
 * which is the released data's, not ours. Perpendicular is 0, so half is a
 * generous line — anything above it agrees on which side is out.
 */
const NORMAL_TRUSTED = 0.5;

/** Edges that name `faces` on exactly one side: the region's candidate boundary. */
function candidates(hull: SourceHull, faces: ReadonlySet<number>): number[] {
  const out: number[] = [];
  hull.edges.forEach((e, i) => {
    if (faces.has(e.face1) !== faces.has(e.face2)) out.push(i);
  });
  return out;
}

/**
 * One closed cycle through these edges, or null.
 *
 * Prunes dangling ends first — an edge given a face id for visibility rather
 * than because it bounds anything leaves a vertex with one neighbour — then
 * insists that what is left is a single cycle using every edge. Two disjoint
 * rings, or a vertex with three neighbours, means the region is not one
 * polygon and the caller must widen it or report it.
 */
function closeLoop(
  hull: SourceHull, edgeIds: readonly number[],
): { vertices: number[]; spurs: number } | null {
  let live = [...edgeIds];
  let spurs = 0;
  for (;;) {
    const degree = new Map<number, number>();
    for (const id of live) {
      const e = hull.edges[id];
      degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
      degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
    }
    const dangling = new Set([...degree].filter(([, d]) => d < 2).map(([v]) => v));
    if (dangling.size === 0) break;
    const kept = live.filter((id) =>
      !dangling.has(hull.edges[id].a) && !dangling.has(hull.edges[id].b));
    if (kept.length === live.length) break; // nothing shrank: give up rather than spin
    spurs += live.length - kept.length;
    live = kept;
  }
  if (live.length < 3) return null;

  const neighbours = new Map<number, number[]>();
  const link = (from: number, to: number): void => {
    const list = neighbours.get(from);
    if (list) list.push(to); else neighbours.set(from, [to]);
  };
  for (const id of live) {
    link(hull.edges[id].a, hull.edges[id].b);
    link(hull.edges[id].b, hull.edges[id].a);
  }
  for (const list of neighbours.values()) if (list.length !== 2) return null;

  const start = hull.edges[live[0]].a;
  const vertices = [start];
  let previous = -1;
  let current = start;
  for (;;) {
    const [first, second] = neighbours.get(current)!;
    const next = first === previous ? second : first;
    if (next === start) break;
    if (vertices.length > live.length) return null;
    vertices.push(next);
    previous = current;
    current = next;
  }
  return vertices.length === live.length ? { vertices, spurs } : null;
}

/** Newell's normal for a polygon: robust for the slightly non-planar hulls here. */
function polygonNormal(
  hull: SourceHull, loop: readonly number[],
): [number, number, number] {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const a = hull.vertices[loop[i]];
    const b = hull.vertices[loop[(i + 1) % loop.length]];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  return [nx, ny, nz];
}

const dot = (a: readonly number[], b: readonly number[]): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const length = (v: readonly number[]): number => Math.hypot(v[0], v[1], v[2]);

/** The mean of every vertex: "outwards" is away from here. */
function centroid(hull: SourceHull): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (const v of hull.vertices) { x += v.x; y += v.y; z += v.z; }
  const n = Math.max(1, hull.vertices.length);
  return [x / n, y / n, z / n];
}

/** The mean of a loop's vertices. */
function loopCentre(
  hull: SourceHull, loop: readonly number[],
): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (const i of loop) { x += hull.vertices[i].x; y += hull.vertices[i].y; z += hull.vertices[i].z; }
  return [x / loop.length, y / loop.length, z / loop.length];
}

/**
 * Wind the polygon outwards and say how that was decided.
 *
 * The stored normal is the authority where it agrees with the geometry at all;
 * where it does not (or is zero, as the alloy plate's is) the loop is wound
 * away from the hull's centroid, which is right for every convex region and is
 * only reached by rocks. The FILL is double-sided either way, so winding is a
 * correctness claim about the data rather than something the frame depends on
 * — which is exactly why it is asserted instead of assumed.
 */
function orient(
  hull: SourceHull, loop: number[], stored: readonly number[],
): { winding: Winding; agrees: boolean; skewDegrees: number } {
  const normal = polygonNormal(hull, loop);
  const magnitudes = length(normal) * length(stored);
  const cos = magnitudes > 0 ? dot(normal, stored) / magnitudes : 0;
  const skew = (value: number): number =>
    (Math.acos(Math.min(1, Math.max(-1, Math.abs(value)))) * 180) / Math.PI;
  if (Math.abs(cos) >= NORMAL_TRUSTED) {
    if (cos < 0) loop.reverse();
    return { winding: 'face-normal', agrees: true, skewDegrees: skew(cos) };
  }
  const hullCentre = centroid(hull);
  const face = loopCentre(hull, loop);
  const outward: [number, number, number] = [
    face[0] - hullCentre[0], face[1] - hullCentre[1], face[2] - hullCentre[2]];
  if (dot(polygonNormal(hull, loop), outward) < 0) loop.reverse();
  return { winding: 'outward', agrees: false, skewDegrees: skew(cos) };
}

/**
 * Every closed polygon in a hull, plus what could not be resolved.
 *
 * Deterministic and allocation-heavy — it runs once per design at module load,
 * never per frame.
 */
export function reconstructFaces(hull: SourceHull): HullTopology {
  const loops: FaceLoop[] = [];
  const unresolved: number[] = [];
  const normalMismatch: number[] = [];
  const used = new Set<number>();

  const record = (
    faces: number[], found: { vertices: number[]; spurs: number },
    stored: readonly number[], method: LoopMethod,
  ): void => {
    const { winding, agrees, skewDegrees } = orient(hull, found.vertices, stored);
    if (!agrees) normalMismatch.push(...faces);
    loops.push({
      faces: [...faces], vertices: found.vertices, method, winding,
      spurs: found.spurs, skewDegrees,
    });
    // Exactly the edges the polygon walks along — not every edge whose ends it
    // happens to contain, which would count a chord as bounding something.
    const ring = found.vertices;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      hull.edges.forEach((e, id) => {
        if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) used.add(id);
      });
    }
  };

  // 1 — each face's own boundary
  const failed: number[] = [];
  hull.faces.forEach((face, index) => {
    const found = closeLoop(hull, candidates(hull, new Set([index])));
    if (found) record([index], found, [face.nx, face.ny, face.nz], 'boundary');
    else failed.push(index);
  });

  // 2 — faces that failed and share a normal are one flat region
  const byNormal = new Map<string, number[]>();
  for (const index of failed) {
    const f = hull.faces[index];
    const key = `${f.nx},${f.ny},${f.nz}`;
    const group = byNormal.get(key);
    if (group) group.push(index); else byNormal.set(key, [index]);
  }
  const stillFailed: number[] = [];
  for (const group of byNormal.values()) {
    const found = group.length > 1
      ? closeLoop(hull, candidates(hull, new Set(group))) : null;
    const f = hull.faces[group[0]];
    if (found) record(group, found, [f.nx, f.ny, f.nz], 'coplanar-merge');
    else stillFailed.push(...group);
  }

  // 3 — one face, named by nothing: the hull IS the polygon
  const namesNoFace = hull.edges.every(
    (e) => e.face1 === ELITE_A_NO_FACE && e.face2 === ELITE_A_NO_FACE);
  if (stillFailed.length === hull.faces.length && namesNoFace) {
    const all = hull.edges.map((_, i) => i);
    const found = closeLoop(hull, all);
    if (found) {
      const f = hull.faces[stillFailed[0]];
      record(stillFailed, found, [f.nx, f.ny, f.nz], 'whole-hull');
      stillFailed.length = 0; // `record` copied the list before this
    }
  }
  unresolved.push(...stillFailed);

  const decorativeEdges = hull.edges
    .map((_, i) => i)
    .filter((i) => !used.has(i));
  return { loops, unresolved, normalMismatch, decorativeEdges };
}
