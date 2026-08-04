import * as THREE from 'three';

import { TORUS_MULTIPLIER } from '../constants/torus.ts';
import { PLAYER_FLIGHT } from '../constants/player-flight.ts';

/** Distant static stars on a sphere so large (400k) that parallax is imperceptible. */
export function createStarfield(count = 2600, radius = 400000): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(radius);
    positions.set([v.x, v.y, v.z], i * 3);
    const b = 0.35 + Math.random() * 0.65;
    const warm = Math.random() < 0.2 ? 0.85 : 1.0;
    colors.set([b, b * warm, b * (warm === 1.0 ? 1.0 : 0.7)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.6,
    sizeAttenuation: false,
    vertexColors: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

/**
 * Near-field space dust that wraps around the player to convey motion.
 *
 * Two layers over the same particles: dots for ordinary flight, and streaks
 * that stretch backwards along your heading as you go faster. The streaks are
 * invisible at cruise and take over under the torus drive, which is what sells
 * "we are moving very fast" — the real starfield sits on a 400k sphere
 * precisely so it *doesn't* move, so it can't do that job.
 */
export class SpaceDust {
  readonly points: THREE.Points;
  /** the streak layer — add this to the scene alongside `points` */
  readonly streaks: THREE.LineSegments;
  private readonly half: number;
  private readonly streakMat: THREE.LineBasicMaterial;
  /** streak length in world units per unit of speed, at full strength */
  private static readonly LENGTH_PER_SPEED = 0.075;
  /**
   * Streaks start above the fastest ordinary cruise so they read as a
   * torus-drive effect and not as normal flight, and reach full strength well
   * inside torus range.
   *
   * BOTH ENDS ARE DERIVED NOW, because both were prose: the comment argued
   * from "max ship speed is 400" and "8 x 400 = 3200", writing out two numbers
   * this file could not see — the commander's top speed, which was
   * module-private in player.ts, and the torus multiplier, which was a 7 in the
   * world step. 1.3x cruise and 0.75 of torus top speed are the shipped 520 and
   * 2400 exactly; they now move with the ship instead of describing one that
   * has been retuned.
   */
  private static readonly FADE_IN = PLAYER_FLIGHT.maxSpeed * 1.3;
  private static readonly FULL = PLAYER_FLIGHT.maxSpeed * TORUS_MULTIPLIER * 0.75;
  /**
   * No dust closer than this. At `size` 3.5 with sizeAttenuation the sprite
   * subtends roughly 3.5/distance of the viewport, so 150 units keeps the
   * worst case at about a 2% square — a dot, which is what it is meant to be.
   */
  private static readonly NEAR_CLIP = 150;

  constructor(count = 500, size = 3000) {
    this.half = size / 2;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
      positions[i] = (Math.random() - 0.5) * size;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x567766,
      size: 3.5,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;

    // one line per particle: head at the particle, tail trailing behind it
    const streakGeo = new THREE.BufferGeometry();
    streakGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
    this.streakMat = new THREE.LineBasicMaterial({
      color: 0x9fd8b8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.streaks = new THREE.LineSegments(streakGeo, this.streakMat);
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
  }

  /**
   * Wrap dust particles into a cube centred on the player, and stretch the
   * streaks along `velocity` (direction × speed in world units per second).
   */
  update(center: THREE.Vector3, velocity?: THREE.Vector3): void {
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const size = this.half * 2;
    for (let i = 0; i < arr.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        const c = a === 0 ? center.x : a === 1 ? center.y : center.z;
        let d = arr[i + a] - c;
        if (d > this.half) arr[i + a] -= size * Math.ceil((d - this.half) / size);
        else if (d < -this.half) arr[i + a] += size * Math.ceil((-d - this.half) / size);
      }
      // Keep dust off the camera. These are untextured point sprites, so they
      // draw as squares, and sizeAttenuation scales them by 1/distance — a
      // mote that drifts through the cockpit becomes a grey-green square
      // filling a chunk of the screen. The wrap above keeps particles inside
      // the cube but nothing stopped one landing on the player's nose.
      //
      // Respawn rather than push aside: shoving it outwards would smear it
      // across the view as you close on it, where a teleport is one frame and
      // one particle in 500.
      const dx = arr[i] - center.x;
      const dy = arr[i + 1] - center.y;
      const dz = arr[i + 2] - center.z;
      if (dx * dx + dy * dy + dz * dz < SpaceDust.NEAR_CLIP * SpaceDust.NEAR_CLIP) {
        // random direction, at a radius that is comfortably outside the hole
        const u = Math.random() * 2 - 1;
        const th = Math.random() * Math.PI * 2;
        const r = Math.sqrt(1 - u * u);
        const dist = SpaceDust.NEAR_CLIP * 2 + Math.random() * (this.half - SpaceDust.NEAR_CLIP * 2);
        arr[i] = center.x + Math.cos(th) * r * dist;
        arr[i + 1] = center.y + Math.sin(th) * r * dist;
        arr[i + 2] = center.z + u * dist;
      }
    }
    pos.needsUpdate = true;
    this.updateStreaks(arr, velocity);
  }

  private updateStreaks(dots: Float32Array, velocity?: THREE.Vector3): void {
    const speed = velocity ? velocity.length() : 0;
    const t = (speed - SpaceDust.FADE_IN) / (SpaceDust.FULL - SpaceDust.FADE_IN);
    const strength = Math.max(0, Math.min(1, t));
    this.streakMat.opacity = 0.42 * strength;
    this.streaks.visible = strength > 0.01;
    // dots dim as the streaks take over, so it reads as one effect
    (this.points.material as THREE.PointsMaterial).opacity = 0.4 * (1 - 0.45 * strength);
    if (!this.streaks.visible || !velocity) return;

    // trail each particle backwards along our heading
    // scale by strength too, so streaks grow out of the dots rather than
    // appearing full-length and merely faint
    const len = speed * SpaceDust.LENGTH_PER_SPEED * strength;
    const ux = (velocity.x / speed) * len;
    const uy = (velocity.y / speed) * len;
    const uz = (velocity.z / speed) * len;
    const line = this.streaks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const out = line.array as Float32Array;
    for (let i = 0, j = 0; i < dots.length; i += 3, j += 6) {
      out[j] = dots[i];
      out[j + 1] = dots[i + 1];
      out[j + 2] = dots[i + 2];
      out[j + 3] = dots[i] - ux;
      out[j + 4] = dots[i + 1] - uy;
      out[j + 5] = dots[i + 2] - uz;
    }
    line.needsUpdate = true;
  }
}
