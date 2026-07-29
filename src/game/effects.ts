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

import * as THREE from 'three';
import { Explosion, Tracer } from './npc.ts';

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
