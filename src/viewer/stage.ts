// The canvas, the camera and the bloom — the part both dev pages share.
//
// There are two of them now (TODO 57): `/viewer` is the combat viewer and
// `/gallery` is the 38 released hulls. They used to be one page with a `G` key
// between them, which meant `/viewer` opened on the gallery with a combat
// dropdown underneath it and the combat viewer read as deleted.
//
// What they genuinely share is the scaffolding: a WebGL context, a bloom pass at
// one strength, a starfield and a resize handler. That is here so there is one
// answer to "what does a dev page look like" rather than two that drift — and it
// is ALL that is here. Neither page's controls, HUD or keys live in this file;
// each owns its own, which is the whole point of the split.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { createStarfield } from '../world/starfield.ts';

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** draw one frame at the current window size */
  render(): void;
}

/** A lit, starfielded scene sized to the window, on the `#scene` canvas. */
export function createStage(): Stage {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 1, 200000);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.15));

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  scene.add(createStarfield(2200, 90000));

  return { scene, camera, render: () => composer.render() };
}
