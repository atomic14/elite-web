// The phases of an attack run: which leg a ship is flying, how hard it throttles
// back to turn, and what to call what it is doing.
//
// The RANGES these read are `constants/attack-run.ts`. Where the closing leg
// aims is `pass-aim.ts`; how the run-out curves is `extend-arc.ts`.
//
// STEERING AND FIRING ARE TWO DECISIONS. `attack()` used to `return null` the
// moment it broke off, so breaking off and holding fire were one statement, and
// every police ship, bounty hunter, Thargoid and knife-range pirate went silent
// inside 220 units — Chris's "it feels almost like they stop shooting when they
// get close". A ship turning away that has you in its gate should shoot, so
// `attack()` steers away AND runs `npcTriggerPull`.
//
// The rule is the same for every hostile: all of them reach `attack()` and all
// break off at the same distance. WHICH of the ranges a given ship uses is
// `constants/tactics.ts`. The type is imported for `describeFlight` alone and is
// erased at build, so nothing here depends on that file at run time.

import type { TacticId } from '../constants/tactics.ts';
import {
  BREAK_OFF_RANGE, CLOSING_THROTTLE_MIN, EXTEND_RANGE,
  EXTEND_RANGE_MAX, EXTEND_RANGE_MIN,
} from '../constants/attack-run.ts';

/**
 * Turn a 0..1 roll into a turn-back range.
 *
 * Takes the roll rather than calling `random()` so it stays pure and the whole
 * band is assertable without seeding anything — `rng.ts` is the only source of
 * chance in the program and the caller in npc.ts is where that lives.
 */
export function rollExtendRange(roll: number): number {
  return EXTEND_RANGE_MIN + (EXTEND_RANGE_MAX - EXTEND_RANGE_MIN) * roll;
}

/**
 * Where an attack run is in its cycle.
 *
 * `closing` — nose on the target, throttle up, shooting when the gate allows.
 * `passing` — inside `BREAK_OFF_RANGE`: hold the heading and go THROUGH, still
 *   shooting. This is the half that was missing.
 * `extending` — past the target and opening the range; turn back at
 *   `EXTEND_RANGE` and close again.
 */
export type AttackPhase = 'closing' | 'passing' | 'extending';

/**
 * How hard a closing ship pulls the throttle back, given how far off its nose
 * is — 1 when it is pointed at the target, `CLOSING_THROTTLE_MIN` when it is
 * 90 degrees or more off.
 *
 * Chris: "if an NPC needs to turn quickly, it should slow down? And then speed
 * up?" — which is right, but NOT for the usual reason, and the difference
 * decides whether the rule does anything.
 *
 * **Slowing does not raise the turn rate.** `steerToward` rotates by
 * `turnRate * dt` and `turnRate` is a constant off the ship's spec; speed
 * appears nowhere in it. A Krait pitches at 1.4 rad/s stopped and 1.4 rad/s
 * flat out. So if this rule were an attempt to buy angular velocity it would
 * buy exactly none.
 *
 * What it buys is the other two, and both matter here:
 *
 *   - **Turn radius.** r = v/omega. Half the speed is half the radius, so a
 *     slow ship comes round inside its own turn instead of sailing wide of it.
 *     This is the whole reason the turn-in at EXTEND_RANGE works.
 *   - **Relative angular rate.** The rate a ship must MATCH to hold its nose on
 *     something is v_rel/range, so its own speed is part of the number it is
 *     chasing. Backing off does not make it turn faster, it makes the thing it
 *     is tracking sweep slower — which is why Chris found a low throttle let
 *     him hold NPCs at close range and full throttle did not.
 *
 * Cosine rather than a distance band because the quantity that decides it is an
 * angle: a ship 900 units out and dead on its line has no reason to slow down,
 * and one 300 out and 80 degrees off has every reason. The band this replaced
 * (`dist > 700 ? max : max * 0.45`) got both of those backwards.
 *
 * @param floor the slowest this ship's TACTIC lets it get, defaulting to the
 * constant. A tactic is a choice of how much speed to trade for turn radius, and
 * every value it may pass stays above `MIN_CRUISE_FRACTION`.
 */
export function closingThrottle(
  headingErrorRad: number, floor: number = CLOSING_THROTTLE_MIN,
): number {
  const aligned = Math.max(0, Math.cos(headingErrorRad));
  return floor + (1 - floor) * aligned;
}

/**
 * The next phase of an attack run, from the range and whether the ship is being
 * shot at.
 *
 * A pure function, so the whole cycle can be asserted without flying anything —
 * `test/npc.test.ts` walks a ship in and out and checks it comes back round.
 *
 * WHY A FLY-PAST RATHER THAN A REVERSAL. The scripted chase used to steer to
 * `own * 2 - target` the moment it came inside 220: directly away, a 180 turn.
 * That is the slowest turn there is and the range does not allow it. A Krait
 * pitches at 1.4 rad/s, so a reversal takes 2.24s and covers 651 units of
 * travel — begun at 220 units from a target it is pointed straight at. It flies
 * through. A Python, at 0.49 rad/s, needs 1,026 units to turn around inside 220.
 * Chris: "the correct thing would be to do an attack run and fly past, then turn
 * for another attack run."
 *
 * Extending is the only phase being hit changes, and the only one where being
 * hit makes no sense to ignore: `closing` is already turning and `passing` is
 * over in a fraction of a second, but a ship opening the range is committed to
 * going out for as long as its rolled turn-back takes. That also makes the fight
 * answer the player — getting on its six and landing shots is what breaks the
 * pattern.
 */
export function nextAttackPhase(
  phase: AttackPhase, dist: number, underFire = false, extendRange = EXTEND_RANGE,
): AttackPhase {
  // Knife range wins over everything, and it is FIRST for a reason: a ship
  // extending from one pass that finds the target on top of it again — because
  // the target chased it down — commits to another pass rather than holding a
  // straight line at someone sitting on its six.
  if (dist < BREAK_OFF_RANGE) return 'passing';
  // Cleared it. The pass is over the moment the range opens at all.
  if (phase === 'passing') return 'extending';
  // Still opening: hold the run out until there is room to turn in — UNLESS
  // somebody is landing shots, in which case cut it short and come round now.
  // The run-out curves (extend-arc.ts), so a ship cut short here has already
  // done as much of its turn as the range it reached had earned it.
  if (phase === 'extending') return dist > extendRange || underFire ? 'closing' : 'extending';
  return 'closing';
}

/**
 * What a ship is doing, as a phrase for a record or a readout.
 *
 * Its own function because three surfaces ask — the trainer's SPENT ITS TIME
 * column, the live cockpit strip beside it, and `train/flight-probe.ts` — and a
 * phrase invented three times is a phrase that drifts. It reads the SAME fields
 * the flight reads, so it cannot describe a ship doing something the ship is not
 * doing.
 *
 * TWO WORDS SINCE docs/TODO/68: the tactic, then the leg. `slash closing`,
 * `knife extending`, `ram closing`. The tactic is repeated in every bucket
 * rather than hoisted into a column of its own, and that repetition is the whole
 * point of the readout — the column counts SECONDS per phrase, so a ship that
 * changed its mind after being hit reads
 *
 *   RUN CLOSING 8.2s · RUN EXTENDING 6.9s · SLASH CLOSING 5.1s · SLASH EVADING 1.2s
 *
 * and the switch is visible as a fact about time rather than as a label that
 * only ever shows what the ship is doing now.
 *
 * `evading` outranks the phase because it is the answer to "why has it stopped
 * flying the run". `fleeing` and `own policy` carry NO tactic: a trader running
 * for the system edge is not flying an attack run at all, and a brain-flown
 * ship's tactic is dormant until it hands over at `BRAIN_HANDOVER_RANGE`. The
 * pursuit dogfighter is a third case with no tactic and no phase — `on your
 * six` while it chases, `breaking off` while it veers clear of a ram — because
 * it never runs the attack-run machine those words describe.
 */
export function describeFlight(
  phase: AttackPhase, underFire: number, fleeing: boolean,
  flownBy: 'brain' | 'scripted' | 'pursuit' = 'scripted',
  tactic: TacticId = 'run',
  breaking = false,
): string {
  if (fleeing) return 'fleeing';
  // The pursuit dogfighter is not in an attack-run phase either — it has no
  // `closing`/`passing`/`extending`, only "on the six" and "veering off to
  // avoid a ram". Reporting `attackPhase` here quoted a word it never set, so
  // the strip read the same "KNIFE CLOSING" as a jousting pirate. It reads its
  // own two states instead, and NOT `evading`: a pursuit pirate under fire
  // keeps chasing rather than breaking the way the attack run does.
  if (flownBy === 'pursuit') return breaking ? 'breaking off' : 'on your six';
  // A brain-flown ship is not IN a phase — `attackPhase` is only touched by the
  // scripted run, so reporting it here would quote a stale word. It flies its
  // own policy and that is the name for what it is doing. This is not a
  // hypothetical: the first cut of this readout said `closing 45s` for a g3
  // pirate that never ran the closing logic at all. Being shot at is the one
  // thing that is true of it either way.
  if (flownBy === 'brain') return underFire > 0 ? 'evading' : 'own policy';
  if (underFire > 0) return `${tactic} evading`;
  return `${tactic} ${phase}`;
}
