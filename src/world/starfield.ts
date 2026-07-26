import * as THREE from 'three';

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

/** Near-field space dust that wraps around the player to convey motion. */
export class SpaceDust {
  readonly points: THREE.Points;
  private readonly half: number;

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
  }

  /** Wrap dust particles into a cube centred on the player. */
  update(center: THREE.Vector3): void {
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
    }
    pos.needsUpdate = true;
  }
}
