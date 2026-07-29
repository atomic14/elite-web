// Explosions and tracer bolts: the things that are only ever seen.
//
// They have no effect on anything. Nothing reads them, nothing collides with
// them, and they are deliberately absent from the snapshot — reloading into a
// world without the last half-second of sparks costs nothing.
//
// They were four fragments of game.ts: two add methods a thousand lines apart,
// and two filter loops in the flight step wedged between the missiles and the
// laser. Small, but this is exactly the kind of thing that should be findable
// by its name rather than by remembering where it happened to be written.
//
// The classes themselves lived in npc.ts until now, which made the point
// twice over: this file was NAMED for them and had to import them from a ship
// behaviour module 1200 lines long. They have nothing to do with NPCs — the
// player explodes too, and so do canisters.

import * as THREE from 'three';
import { random, randomDirection } from './rng.ts';

export class Effects {
  private explosions: Explosion[] = [];
  private tracers: Tracer[] = [];
  private readonly scene: THREE.Object3D;

  constructor(scene: THREE.Object3D) {
    this.scene = scene;
  }

  /** A burst of sparks at `at`. */
  explosion(
    at: THREE.Vector3,
    color: THREE.ColorRepresentation = 0xffe9a8,
    opts?: { count?: number; speed?: number; duration?: number },
  ): void {
    const e = new Explosion(at, color, opts);
    this.explosions.push(e);
    this.scene.add(e.object);
  }

  /** A visible bolt, drawn from `from` to `to`. */
  tracer(
    from: THREE.Vector3,
    to: THREE.Vector3,
    color: THREE.ColorRepresentation,
    duration = 0.18,
  ): void {
    const t = new Tracer(from, to, color, duration);
    this.tracers.push(t);
    this.scene.add(t.object);
  }

  /** Age everything, and dispose whatever has finished. */
  update(dt: number): void {
    this.explosions = this.explosions.filter((e) => {
      if (e.update(dt)) return true;
      this.scene.remove(e.object);
      e.dispose();
      return false;
    });
    this.tracers = this.tracers.filter((t) => {
      if (t.update(dt)) return true;
      this.scene.remove(t.object);
      t.dispose();
      return false;
    });
  }

  /** Wipe the lot — a new system, or a restored snapshot. */
  clear(): void {
    for (const e of this.explosions) {
      this.scene.remove(e.object);
      e.dispose();
    }
    for (const t of this.tracers) {
      this.scene.remove(t.object);
      t.dispose();
    }
    this.explosions = [];
    this.tracers = [];
  }

  /** @internal for tests and the HUD's contact list */
  get counts(): { explosions: number; tracers: number } {
    return { explosions: this.explosions.length, tracers: this.tracers.length };
  }
}


// --- Explosions ------------------------------------------------------------
// Classic line-debris burst: a handful of short segments flying apart.

export interface ExplosionOpts {
  count?: number;
  speed?: number;
  duration?: number;
}

export class Explosion {
  readonly object: THREE.LineSegments;
  private readonly velocities: THREE.Vector3[] = [];
  private life = 0;
  private readonly duration: number;
  private readonly material: THREE.LineBasicMaterial;

  constructor(
    center: THREE.Vector3,
    color: THREE.ColorRepresentation = 0xffe9a8,
    opts: ExplosionOpts = {},
  ) {
    const count = opts.count ?? 26;
    const speed = opts.speed ?? 220;
    this.duration = opts.duration ?? 1.6;
    const positions = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const dir = randomDirection(new THREE.Vector3());
      const seg = randomDirection(new THREE.Vector3()).multiplyScalar(4 + random() * 8);
      positions.set([-seg.x, -seg.y, -seg.z, seg.x, seg.y, seg.z], i * 6);
      this.velocities.push(dir.multiplyScalar(speed * (0.3 + random())));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.material = new THREE.LineBasicMaterial({ color, transparent: true });
    this.object = new THREE.LineSegments(geo, this.material);
    this.object.position.copy(center);
    this.object.frustumCulled = false;
  }

  /** @returns false when burnt out. */
  update(dt: number): boolean {
    this.life += dt;
    const pos = this.object.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < this.velocities.length; i++) {
      const v = this.velocities[i];
      for (const off of [0, 3]) {
        arr[i * 6 + off] += v.x * dt;
        arr[i * 6 + off + 1] += v.y * dt;
        arr[i * 6 + off + 2] += v.z * dt;
      }
    }
    pos.needsUpdate = true;
    this.material.opacity = Math.max(0, 1 - this.life / this.duration);
    return this.life < this.duration;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}

// --- Laser tracers ---------------------------------------------------------
// A brief bright bolt between two points so fire is actually visible.

export class Tracer {
  readonly object: THREE.Line;
  private life = 0;
  private readonly duration: number;
  private readonly material: THREE.LineBasicMaterial;

  constructor(
    from: THREE.Vector3,
    to: THREE.Vector3,
    color: THREE.ColorRepresentation,
    duration = 0.18,
  ) {
    this.duration = duration;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([from.x, from.y, from.z, to.x, to.y, to.z], 3),
    );
    this.material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.object = new THREE.Line(geo, this.material);
    this.object.frustumCulled = false;
  }

  /** @returns false when expired. */
  update(dt: number): boolean {
    this.life += dt;
    this.material.opacity = Math.max(0, 1 - this.life / this.duration);
    return this.life < this.duration;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
