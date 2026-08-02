// What the pilot reads WHILE an exercise is being flown.
//
// The trainer had three views of a fight and only two of them were visible in
// time: the setup panel before it, and the report after it. In between, the
// cockpit was the ordinary cockpit — so the tool whose purpose is judging how a
// fight FEELS handed over its evidence once the feeling had passed, and a pilot
// could not tell a 45-second exercise that was nearly up from one that had just
// begun, or an exercise from real space once the launch banner faded.
//
// This is the third view: a strip of numbers the cockpit paints for as long as
// an exercise is running (docs/TODO/33-exercise-hud.md).
//
// **It counts nothing.** Every figure on it comes from the round's own recorder
// as `SimProgress`, which is the same accumulation `CombatSimRecorder.report()`
// derives the finished record from — so the strip and the report cannot
// disagree, because there is only one set of counters. The one thing this file
// decides is what a mode has instead of a countdown, and it asks `MODES` rather
// than the mode's name: a scenario is on the clock, sparring is scored on kills
// and waves on the wave number, and all three of those are properties of
// `ModeRules`.
//
// Pure, like the two modules it sits between: no DOM, no Game, no World. The
// painter is handed the result (hud/hud.ts) and paints it.

import type { ExerciseSetup, SimProgress } from './combat-sim-report.ts';
import {
  MODES, exerciseTimeout, type ExerciseSpec, type ModeRules, type SimMode,
} from './combat-sim-scenarios.ts';

/**
 * One frame of the exercise strip.
 *
 * Deliberately small: the cockpit is crowded and the fight is the thing being
 * watched. Everything a pilot cannot read at a glance mid-dogfight belongs in
 * the report, which is two seconds away at the end of the exercise.
 */
export interface ExerciseStrip {
  /** the fight, exactly as the report names it — never re-derived here */
  scenario: string;
  mode: SimMode;
  /** seconds flown, as the report will state them */
  elapsed: number;
  /**
   * Seconds left, or null when the mode is endless.
   *
   * `exerciseTimeout` is the same rule `roundOutcome` calls the exercise off
   * with, so the strip counts down to the moment the fight actually ends.
   */
  remaining: number | null;
  /** what this mode is scored on — `MODES[mode].score`, not a guess from its name */
  score: ModeRules['score'];
  /** the standing in that score: the wave you are on, or kills */
  standing: number;
  shots: number;
  hits: number;
  /** hits / shots, or null when the trigger has not been pulled */
  accuracy: number | null;
  /** laser hits they have landed on you */
  hitsTaken: number;
}

/** Seconds, at the resolution the report quotes them. */
const secs = (x: number): number => Math.round(x * 10) / 10;

/**
 * The strip for a round in progress.
 *
 * `setup` is the round's own — it already holds the scenario name, the mode and
 * (in an endless mode) the wave number, because the report quotes all three.
 * Reading them back off it is what keeps the strip and the record saying the
 * same thing about which fight this is.
 */
export function exerciseStrip(
  spec: ExerciseSpec, setup: ExerciseSetup, progress: SimProgress,
): ExerciseStrip {
  const { score } = MODES[setup.mode];
  const limit = exerciseTimeout(spec);
  return {
    scenario: setup.scenario,
    mode: setup.mode,
    elapsed: progress.seconds,
    remaining: limit > 0 ? Math.max(0, secs(limit - progress.seconds)) : null,
    score,
    // Waves are counted by the round, kills by the recorder; `setup.wave` is
    // the number the round's own record will carry, so a strip and the wave's
    // record never quote different waves.
    standing: score === 'waves' ? (setup.wave ?? 1) : progress.kills,
    shots: progress.shots,
    hits: progress.hits,
    accuracy: progress.accuracy,
    hitsTaken: progress.hitsTaken,
  };
}
