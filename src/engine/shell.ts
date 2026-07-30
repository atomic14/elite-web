// The shell: everything the game needs from the machine it is running on.
//
// This is the seam a desktop port would reimplement, and it is deliberately
// small — seven members, the same bargain as `StepHost` and `SimHost`. The
// Game asks for a shell, not for a browser, so `game.ts` names no DOM API at
// all.
//
// Before this existed, `game.ts` was 1,757 lines of which ELEVEN mentioned the
// browser: a canvas in the constructor, a resize listener, a click listener,
// the rAF loop, a CSS custom property, and two `getElementById` calls. Those
// eleven lines made the whole file unportable AND unconstructible under node,
// which is why the largest file in the project had zero test coverage. A thin
// shell was welded to the orchestrator and both were stuck.
//
// `browser-shell.ts` is the real one. `headlessShell()` at the bottom of this
// file is the other one, and it is not a stub for tests to tolerate: it is the
// proof the seam is real, because a Game built on it runs the actual game loop
// with no DOM in the process.

import * as THREE from 'three';

/**
 * What the Game needs in order to be SEEN.
 *
 * Narrower than the render stack on purpose. The Game never touches
 * `WebGLRenderer` — it reads the camera, toggles the cockpit beams and calls
 * one draw — so requiring a GPU type here would have made a headless
 * implementation impossible for no reason.
 */
export interface Presentation {
  /** the player's eye; pure maths, so it works with or without a GPU */
  readonly camera: THREE.PerspectiveCamera;
  /**
   * Cockpit laser beams, parented to the camera.
   *
   * `LineSegments` rather than `Object3D` because the Game writes the
   * convergence point straight into the position attribute every frame — and
   * that is pure maths, so a headless shell can hand over a real one.
   */
  readonly beams: THREE.LineSegments;
  /** put the current scene on screen */
  draw(): void;
  /** returns pixels-per-radian, which the sight needs to size itself */
  resize(width: number, height: number): number;
}

export interface Shell {
  readonly view: Presentation;
  /** the window changed size; the Game re-derives the sight from it */
  onResize(fn: () => void): void;
  /** a click landed on the screen overlay — clicks are input (invariant 13) */
  onScreenClick(fn: (target: unknown, event: unknown) => void): void;
  /** drive the frame loop; `now` is a monotonic clock in milliseconds */
  runLoop(frame: (now: number) => void): void;
  /** the sight is drawn to the aim-assist envelope, in pixels */
  setSightRadius(px: number): void;
  /** light the sight when the shot in front of you would actually land */
  setSightLit(on: boolean): void;
  /** the `?` panel */
  toggleHelp(): void;
  /** white-out for an energy bomb */
  flashBomb(): void;
  /** current viewport, for the first resize */
  size(): { width: number; height: number };
}

/**
 * Four vertices in the same layout the real beams use — two emitters and two
 * convergence points. `aimBeams` writes indices 3-5 and 9-11 every frame, so a
 * shorter buffer would fail silently rather than loudly.
 */
function headlessBeams(): THREE.LineSegments {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(12).fill(0), 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial());
}

/**
 * A shell with no machine behind it.
 *
 * Everything here is either pure maths (the camera) or nothing at all. It
 * exists so a Game can be constructed and STEPPED under node — the 1,757-line
 * hole in the coverage report — and so the claim "only the shell is
 * platform-bound" is checkable rather than asserted.
 *
 * `runLoop` deliberately does NOT run: a test drives `step()` itself, which is
 * the reliable way (CLAUDE.md: background tabs throttle rAF).
 */
export function headlessShell(): Shell {
  const camera = new THREE.PerspectiveCamera(60, 1, 1, 1_000_000);
  return {
    view: {
      camera,
      beams: headlessBeams(),
      draw: () => {},
      // the real one returns pixels per radian; 1 keeps the sight maths finite
      resize: () => 1,
    },
    onResize: () => {},
    onScreenClick: () => {},
    runLoop: () => {},
    setSightRadius: () => {},
    setSightLit: () => {},
    toggleHelp: () => {},
    flashBomb: () => {},
    size: () => ({ width: 1280, height: 720 }),
  };
}

/** How a Game gets its shell: it builds its world first, then asks for one. */
export type ShellFactory = (scene: THREE.Scene) => Shell;
