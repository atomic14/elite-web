// The console seam: the ONE file that puts anything on `globalThis`.
//
// Same bargain as storage.ts, which is the only file that knows a save lives in
// localStorage. Swap this for a no-op and the engine is unchanged; a desktop
// port simply does not call it.
//
// The distinction it draws is the useful one. There are two kinds of global and
// only one of them is a design fault:
//
//   a FLAG is READ by game code to change what the game does. There were five
//   — `__scriptedPirates`, `__legacyPirates`, `__packBrain`, `__sharpPirates`
//   and `__cheat` — and they are all gone, because a rule read from ambient
//   state is a rule with no home: not in the snapshot, so a reload changed the
//   game; not an argument, so a test could only set it and hope to clear up.
//   They are fields of GameState now (see BrainSelection, GameState.cheat).
//
//   a HANDLE is WRITTEN by the game so a human or an agent can reach in from a
//   console. Nothing reads it, nothing branches on it, and removing it removes
//   the entire verification workflow in CLAUDE.md rather than a behaviour. So
//   handles stay — but they live here, published through one function, so that
//   "does the engine touch globals?" has a one-word answer.
//
// `npm test` enforces the split: no file outside this one may assign to
// globalThis, and no game rule may read from it. That is what stops the flags
// growing back one convenience at a time.

import { policyKit } from './brains.ts';
import { makeSimLog, SIM_LOG_LIMIT, type SimLog } from './combat-sim-report.ts';

/**
 * Publish a debug handle for a console session or an automated agent.
 *
 * `globalThis`, not `window`: these are called from module bodies and from the
 * Game's constructor, and reaching for `window` made every one of them throw
 * the moment the engine was asked to run under node — which is what kept the
 * headless tests reduced to grepping source text for years.
 */
export function publish(name: string, value: unknown): void {
  (globalThis as unknown as Record<string, unknown>)[name] = value;
}

/** Read one back. For a harness checking its own wiring, not for game rules. */
export function handle(name: string): unknown {
  return (globalThis as unknown as Record<string, unknown>)[name];
}

/**
 * Publish test-harness access to the trained policies. This is platform
 * publication, deliberately kept out of the pure brain-selection module.
 */
export function installPolicyKit(): void {
  publish('__policyKit', policyKit());
}

/**
 * Put the recent-exercise ring on the console handle. A second Game in the
 * same host inherits the ring rather than throwing its records away.
 */
export function installSimLog(limit = SIM_LOG_LIMIT): SimLog {
  const existing = handle('__simLog') as SimLog | undefined;
  if (existing && Array.isArray(existing.records) && typeof existing.push === 'function') {
    return existing;
  }
  const log = makeSimLog(limit);
  publish('__simLog', log);
  return log;
}
