// The clock the world advances on: the size of one slice, and the two limits
// that stop a stalled tab trying to catch up on all of them at once.
//
// The slice is the game's; the two limits are the browser's frame loop's. They
// are one subject because they are the same clock read from two ends — the
// simulation asks "how much time is one step" and the loop asks "how many of
// those may one animation frame run". A reader who changes either without
// seeing the other has changed how far behind real time the ship can get.
//
// The loop itself is `Game.loop` in game/game.ts and the step is
// `WorldStep.step` in game/world-step.ts; neither is a rule this file states.

/**
 * The world advances in slices of exactly this. 60Hz, matching the rate the
 * NPC brains decide at (10Hz, every sixth step) and the rate every combat
 * number in this project was measured against.
 *
 * It lived in game.ts, which cannot be imported without a browser — so the
 * training scenarios, which now fly this very step, could not ask what a slice
 * of the world is and picked 1/15 instead. That is a different world: at 1/15
 * a brain re-decides every 0.133s rather than every 0.1, and every discrete
 * `rotateTowards` step is four times as coarse.
 *
 * It moved on from world-step.ts for the same shape of reason it left game.ts:
 * eight files in `train/` and fifteen tests import it, and every one of them
 * was reaching into the step — a 700-line module with a three.js dependency —
 * to ask a number.
 */
export const FIXED_DT = 1 / 60;

/**
 * Longest real interval the loop will try to simulate, before dropping the
 * backlog.
 *
 * A backgrounded tab, a breakpoint or a slow first paint can hand the loop
 * seconds of elapsed time. Simulating them is worse than skipping them: the
 * ship arrives somewhere it was never flown to, and at 60Hz a quarter of a
 * second is already fifteen steps.
 */
export const MAX_FRAME_TIME = 0.25;

/**
 * ...and the most steps one frame may run, so a stall cannot spiral.
 *
 * The death spiral is the reason both numbers exist: if catching up costs more
 * real time than it buys, the backlog grows every frame and the game freezes
 * solid rather than merely stuttering. At the cap the loop gives up on the
 * backlog entirely (`accumulator = 0`) instead of carrying it.
 *
 * `engine/input.ts`'s `CARRY_LIMIT` is chosen against this — three unread taps
 * of one key is well inside one recovered frame's catch-up budget — and its
 * comment used to say "MAX_STEPS_PER_FRAME is 5" by writing the number out,
 * from a file that could not see it.
 */
export const MAX_STEPS_PER_FRAME = 5;
