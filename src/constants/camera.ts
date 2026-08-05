// The one camera, and the pretend viewport a headless run sees.
//
// Both stacks build the same camera — `engine/render-stack.ts` for the
// browser and `engine/shell.ts` for a headless run — and the headless shell
// EXISTS to prove the platform seam is real, so the two constructions
// agreeing is not a nicety: each pair below was written out verbatim in two
// files, and a drift would have made the proof false while every test stayed
// green (the survey's duplicated-pairs list, both entries closed here).

/**
 * Vertical field of view, in degrees.
 *
 * Load-bearing beyond looks: the combat trainer's `IN_VIEW_DEG` argues its
 * 20-degree arc from this 60 (half of it is 30, and the console eats the
 * bottom), so a camera change moves what "the pilot can see it" means.
 */
export const CAMERA_FOV = 60;

/** Near plane — 1 unit, about a wingtip. */
export const CAMERA_NEAR = 1;

/**
 * Far plane — a million units, which is what keeps the banished witch-space
 * furniture (`BANISHED`, 1e8) genuinely invisible rather than a distant dot.
 */
export const CAMERA_FAR = 1_000_000;

/**
 * The viewport a run with no window pretends to have.
 *
 * One shape in two places — `inert-dom.ts`'s fallback and the headless
 * shell's `size()` — and the VALUE matters less than the agreement: aspect
 * ratio reaches the projection matrix, so two different pretend viewports
 * would have the browser and a headless test disagreeing about what is on
 * screen.
 */
export const HEADLESS_WIDTH = 1280;
export const HEADLESS_HEIGHT = 720;
