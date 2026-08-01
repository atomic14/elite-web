// Browser implementation of the sun's optional corona texture.
//
// The world only knows a `CoronaTextureFactory` and defaults it to no texture.
// Keeping the canvas here means `sun.ts`, `system-scene.ts` and `World` all
// build unchanged in a headless or non-browser port.

import * as THREE from 'three';

/** Paint the additive radial halo used by the browser presentation. */
export function createCoronaTexture(): THREE.Texture | null {
  if (typeof document === 'undefined'
      || typeof document.createElement !== 'function') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0.0, 'rgba(255, 240, 210, 0.9)');
  gradient.addColorStop(0.25, 'rgba(255, 170, 80, 0.45)');
  gradient.addColorStop(0.55, 'rgba(255, 110, 40, 0.14)');
  gradient.addColorStop(1.0, 'rgba(255, 80, 20, 0.0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
