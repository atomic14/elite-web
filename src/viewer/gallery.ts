// Every released design on one screen — the dev tool for looking at geometry.
//
// It exists because "the hull is right" is not something a test can tell you.
// The counts, the closed loops and the winding are asserted in
// `test/geometry.test.ts`; whether the Ghavial looks like a Ghavial, whether a
// hull occludes its own far side, and whether the target radius is a sane sphere
// around the ship are things you have to see. So: all thirty-eight, labelled,
// at either their true relative sizes or normalised to a common one, each inside
// a wireframe sphere at its catalogue target radius.
//
// Keyboard-driven and deliberately plain. It is not part of the game bundle —
// gallery.html is its own Vite entry — and nothing in `src/game` imports it. The
// keys are gallery-main.ts's, beside the page they drive; they used to be in the
// combat viewer's handler behind a `G` toggle, which is why `/viewer` opened on
// this grid.

import * as THREE from 'three';

import { buildShip } from '../ships/geometry.ts';
import { SOURCE_HULLS } from '../ships/registry.ts';
import type { EliteAHull } from '../ships/elite-a-hulls.ts';

/** How the hulls are sized against each other. */
export type GalleryScale = 'relative' | 'common';

/** Which way every hull is turned. `spin` rotates them all together. */
export type GalleryView = 'spin' | 'front' | 'rear' | 'top' | 'side';

const COLUMNS = 8;
/** Cell pitch in world units — the Dodo station is the widest thing shown. */
const CELL = 190;
const HULL_COLOUR = 0x9ad9ff;
const RADIUS_COLOUR = 0xffb444;
const LABEL_COLOUR = '#4dff5c';

/** The furthest any vertex of a hull sits from its origin, in world units. */
function hullReach(hull: EliteAHull): number {
  let reach = 0;
  for (const [x, y, z] of hull.def.vertices) {
    reach = Math.max(reach, Math.hypot(x, y, z) * hull.def.scale);
  }
  return Math.max(reach, hull.targetRadius, 1);
}

/** Three orthogonal circles: a sphere you can see the ship through. */
function radiusSphere(radius: number, segments = 48): THREE.LineSegments {
  const points: number[] = [];
  for (let ring = 0; ring < 3; ring += 1) {
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      const b = ((i + 1) / segments) * Math.PI * 2;
      for (const t of [a, b]) {
        const c = Math.cos(t) * radius;
        const s = Math.sin(t) * radius;
        if (ring === 0) points.push(c, s, 0);
        else if (ring === 1) points.push(c, 0, s);
        else points.push(0, c, s);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color: RADIUS_COLOUR, transparent: true, opacity: 0.5,
  }));
}

/** A text label as a camera-facing sprite, so nothing has to be laid out. */
function label(text: string, width: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '30px monospace';
  ctx.fillStyle = LABEL_COLOUR;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 34);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthWrite: false,
  }));
  sprite.scale.set(width, width / 8, 1);
  return sprite;
}

interface Cell {
  hull: EliteAHull;
  /** turned by the view mode; the sphere and the label do not turn with it */
  ship: THREE.Group;
  /** carries the per-cell scale, so `relative` and `common` are one number */
  sized: THREE.Group;
  root: THREE.Group;
  centre: THREE.Vector3;
}

export interface Gallery {
  readonly root: THREE.Group;
  readonly count: number;
  scale: GalleryScale;
  view: GalleryView;
  /** null shows the whole grid; otherwise the index of the design in view */
  focus: number | null;
  /** Advance the spin and place the camera. */
  update(dt: number, camera: THREE.PerspectiveCamera): void;
  /** What the HUD should say about the current selection. */
  hudLines(): string[];
}

/**
 * Build the grid.
 *
 * Every hull is built ONCE, through `buildShip`, exactly as the game builds it —
 * a viewer that drew hulls its own way would be free to be wrong in a way the
 * game is not.
 */
export function createGallery(): Gallery {
  // Visible from the start: it was hidden here because the combat viewer shared
  // the scene and toggled it on `G`. Its page shows nothing else now.
  const root = new THREE.Group();
  const cells: Cell[] = SOURCE_HULLS.map((hull, index) => {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const centre = new THREE.Vector3(
      (column - (COLUMNS - 1) / 2) * CELL, -row * CELL, 0);

    const ship = buildShip(hull.def, HULL_COLOUR);
    const sized = new THREE.Group();
    sized.add(ship, radiusSphere(hull.targetRadius));

    const cellRoot = new THREE.Group();
    cellRoot.position.copy(centre);
    const caption = label(`${hull.designId} ${hull.name}`, CELL * 0.9);
    caption.position.set(0, -CELL * 0.36, 0);
    cellRoot.add(sized, caption);
    root.add(cellRoot);
    return { hull, ship, sized, root: cellRoot, centre };
  });

  const gallery: Gallery = {
    root,
    count: cells.length,
    scale: 'common',
    view: 'spin',
    focus: null,
    update(dt, camera) {
      const spin = performance.now() / 1000 * 0.35;
      for (const cell of cells) {
        const fit = this.scale === 'common'
          ? (CELL * 0.30) / hullReach(cell.hull) : 1;
        cell.sized.scale.setScalar(fit);
        const q = cell.ship.quaternion;
        switch (this.view) {
          case 'spin': q.setFromAxisAngle(UP, spin); break;
          case 'front': q.setFromAxisAngle(UP, Math.PI); break;
          case 'rear': q.identity(); break;
          case 'top': q.setFromAxisAngle(RIGHT, -Math.PI / 2); break;
          case 'side': q.setFromAxisAngle(UP, Math.PI / 2); break;
        }
      }
      const target = this.focus === null ? null : cells[this.focus];
      const look = target ? target.centre : GRID_CENTRE(cells);
      const back = target ? CELL * 0.9 : CELL * (Math.ceil(cells.length / COLUMNS) + 2);
      camera.position.lerp(
        new THREE.Vector3(look.x, look.y, back), Math.min(1, dt * 4));
      camera.lookAt(look);
    },
    hudLines() {
      const head = [
        `GALLERY    ${cells.length} released designs · scale ${this.scale} · view ${this.view}`,
        'KEYS       S scale · V view · ←/→ focus · 0 all',
      ];
      if (this.focus === null) return head;
      const { hull } = cells[this.focus];
      const t = hull.topology;
      return [
        ...head,
        '',
        `DESIGN ${hull.designId}  ${hull.name}`,
        `GEOMETRY   ${hull.def.vertices.length} vertices · ${hull.def.edges.length} edges`
        + ` · ${t.loops.length} loops over ${hull.def.faces.length} faces`,
        `RADIUS     ${hull.targetRadiusSourceUnits.toFixed(2)} source`
        + ` = ${hull.targetRadius.toFixed(2)} world`,
        `RECONSTRUCT ${t.unresolved.length} unresolved · ${t.normalMismatch.length} normal`
        + ` mismatch · ${t.decorativeEdges.length} decorative edges`,
        `GUN VERTEX ${hull.gunVertex.map((n) => n.toFixed(1)).join(', ')}`,
      ];
    },
  };
  return gallery;
}

const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

const GRID_CENTRE = (cells: Cell[]): THREE.Vector3 => new THREE.Vector3(
  0, -((Math.ceil(cells.length / COLUMNS) - 1) / 2) * CELL, 0);
