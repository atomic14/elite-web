// Everything that needs a GPU: the renderer, the post chain, the camera, and
// the cockpit beams drawn in camera space.
//
// Pulled out of Game's constructor because it is the one thing keeping the
// game from being constructed without a browser. Every rule the world step
// needs now lives in a module that imports nothing but maths — three.js itself
// runs happily under node, with no canvas and no WebGL, and the tests prove it
// by building hulls and firing rays at them. What does NOT run headless is
// WebGLRenderer, and this is where it is confined.
//
// Keeping the beams here is deliberate: they are children of the camera, so
// they belong to whatever owns the camera.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CAMERA_FOV, CAMERA_NEAR, CAMERA_FAR } from '../constants/camera.ts';
import { SIGHT_Y } from '../constants/console.ts';

/**
 * Where the cockpit beams converge, in camera space.
 *
 * They meet ON THE CAMERA AXIS (0, 0, -z) because that is where the shot goes
 * and where the sight sits. They used to meet at y = +0.21 at z = -2.6 —
 * atan(0.21/2.6) = 4.6 degrees high — which lined them up with a mis-placed
 * crosshair (`#crosshair` was top: 42% against an unshifted projection). With
 * the sight corrected the beams had to come down to match.
 */
export const BEAM_Z = 2.6;


export interface RenderStack {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  camera: THREE.PerspectiveCamera;
  /** cockpit laser beams, parented to the camera */
  beams: THREE.LineSegments;
  /** call on resize; returns the pixels-per-radian the HUD needs */
  resize(width: number, height: number): number;
}

export function createRenderStack(canvas: HTMLCanvasElement, scene: THREE.Scene): RenderStack {
  // No logarithmic depth buffer: it would defeat the polygonOffset trick that
  // keeps hull fills behind wireframe edges (docs/INVARIANTS.md invariant 6).
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.15));

  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.85, -0.75, -1.2, 0, 0, -BEAM_Z,
    0.85, -0.75, -1.2, 0, 0, -BEAM_Z,
  ], 3));
  const beams = new THREE.LineSegments(
    beamGeo,
    new THREE.LineBasicMaterial({ color: 0xd8ffcc, transparent: true, opacity: 0.9 }),
  );
  beams.frustumCulled = false;
  beams.visible = false;
  camera.add(beams);

  const resize = (width: number, height: number): number => {
    renderer.setSize(width, height);
    composer.setSize(width, height);
    camera.aspect = width / height;
    // Lift the gun axis to SIGHT_Y BEFORE building the projection: the eye's
    // centre is above the canvas centre. setViewOffset shifts the frustum (a
    // lens shift) rather than the sight, which keeps the crosshair, the beams
    // and the shot on one axis — moving the *crosshair* up instead is what put
    // the sight 4.6 degrees above the shot for so long.
    // +lift: the view window starts BELOW the virtual image top, which pushes
    // the frustum centre up the screen. (Negative moves it down — measured.)
    camera.setViewOffset(width, height, 0, (0.5 - SIGHT_Y) * height, width, height);
    camera.updateProjectionMatrix();
    return (height / 2) / Math.tan((camera.fov * Math.PI) / 360);
  };

  return { renderer, composer, camera, beams, resize };
}
