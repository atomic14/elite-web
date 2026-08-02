// The shapes that are OURS — no source record, and labelled so.
//
// Everything the released catalogue supplies is generated and exact
// (`ships/elite-a-hulls.ts`). What is in here is not, and the separation is a
// requirement rather than a courtesy: the generation ship is a Harmless
// encounter and must never be presented as a recovered Elite-A design. Their
// ids live in `game/ship-identity.ts` under `harmless:`, which is the same
// bargain from the other end.
//
// THE STATIONS USED TO BE HERE, and they are not any more. They are exact
// released hulls now, drawn at a size Harmless chose — the one per-object scale
// in the project, and `ships/station-hulls.ts` states it. What is left in this
// file has no source record at all, which is the only thing that belongs here.

import type { ShipDef } from './geometry.ts';

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
