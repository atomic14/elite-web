// Where a training fight happens, where it starts, and what the record says
// about it.
//
// The eighth combat-trainer file (docs/COMBAT-SIM.md), and the smallest: one
// question, asked once per round. combat-sim-scenarios.ts says WHO turns up,
// spawning.ts puts them in the sky, and this says WHERE — which corner of the
// system is safe to fight in (`arenaCentre`, moved here from spawning.ts, where
// it was the one thing that placed no ship), then the arc, the range and the
// cone the opposition is scattered through.
//
// It exists because an exercise used to open wherever the spawner's own defaults
// put the ships: a 0.5-radian cone about the nose, which the scatter widens to
// 41 degrees, at 3,200 units — inside their gun (`NPC_LASER_RANGE` is 3,500) and
// outside the canopy. The pilot's first sign of a fight was a target bracket at
// the edge of the view, partly under the console, with hits already landing. The
// approach is the most informative part of a fight — it is where a brain shows
// whether it commits or loiters, which is CLAUDE.md's "threat is not fun"
// question — and it was over before the pilot had found the ship making it.
//
// For an ambush in career flight that is correct and stays; `spawning.ts`'s
// `spawnPopulation` is not this file's business and does not change. For a
// TRAINER it throws away the seconds it exists to show, so a training fight
// opens where the pilot can see it — unless the fight is specifically about
// being jumped, in which case the record says ASTERN and NOT IN VIEW, and that
// is the difference between deliberate and broken.
//
// Pure: it states an intent, it measures what came of it, and it decides nothing
// else. The randomness is the spawner's, off the world's seeded stream, so the
// same seed gives the same opening — which is what puts one on the record at all.

import * as THREE from 'three';

import { PASS_FAR, aimAngle, type OpeningGeometry } from './combat-sim-report.ts';
import type { ExerciseSpec, ScenarioId } from './combat-sim-scenarios.ts';
import type { OppositionPlacement } from './spawning.ts';
import type { World } from './world.ts';

// --- where the fight happens -------------------------------------------------

/**
 * Where the arena sits, as a multiple of the planet's radius.
 *
 * 16 is witchpoint distance — the same number `game.ts` arrives you at, though
 * deliberately NOT imported from there: game.ts cannot be loaded without a
 * browser and this file is in the purity block. It is anti-SUNWARD, which is
 * what makes one rule work in all 256 systems of every galaxy: the station
 * orbits at 2.4 radii on the sunward side (system-scene.ts leans `stationDir`
 * 35% into the sun direction), so putting the arena on the far side maximises
 * the distance to the only two things that can end an exercise by themselves.
 *
 * Measured across galaxies 1, 2 and 8 — 768 systems — the worst case is
 * 67,500 units of altitude (mass-lock wants 4,000, the ground is at 80),
 * 392,000 from the sun (SUN_KILL_DIST is 21,000 and SUN_HEAT_START 110,000, so
 * the cabin never warms at all) and 77,704 from the station, whose mass-lock
 * radius is 5,000 and whose docking box is 205 across. It scales with the
 * planet, so there is no system where the margins are thinner in proportion.
 *
 * The mistake to avoid is `test/gang-trial.js`'s hardcoded (90000, 40000,
 * 90000): a fixed offset is an absolute point in a system whose furniture
 * moves with the seed, and it only happens to be empty in the systems it was
 * tried in.
 */
const ARENA_RADII = 16;

/**
 * Somewhere an exercise can be fought without the world interrupting it.
 *
 * Every property that matters is a distance to something the seed placed, so
 * this reads the world rather than assuming a coordinate. See ARENA_RADII for
 * what is guaranteed and what it was measured against.
 */
export function arenaCentre(world: World): THREE.Vector3 {
  return world.sunPos.clone().sub(world.planetPos).normalize()
    .multiplyScalar(-world.planetRadius * ARENA_RADII)
    .add(world.planetPos);
}

// --- where the two sides start ----------------------------------------------

/** Which arc of the sky the opposition is put in, relative to your nose. */
export type OpeningArc =
  /** in front of you, in the canopy — the default, and what a trainer is for */
  | 'ahead'
  /** behind you: the scenario is ABOUT being jumped */
  | 'astern';

/** What a scenario asks for. What it got is `OpeningGeometry`, measured. */
export interface OpeningPlan {
  arc: OpeningArc;
  /** ring radius from the commander, in units */
  range: number;
  /**
   * Half-angle of the cone about the arc's axis, in DEGREES because that is how
   * it is argued and how the record reads it.
   *
   * The spawner scatters within it rather than on it — a ship lands between 0.55
   * and 1.45 of this off the axis (`spawnOpposition`) — so the widest a plan can
   * put one is 1.45 times this, and that product is what has to fit the canopy.
   */
  coneDeg: number;
}

/**
 * The opening range for a fight you are meant to see coming, and every term of
 * it is load-bearing:
 *
 *  * **Outside their gun.** `NPC_LASER_RANGE` is 3,500 and a spawned ship is
 *    already pointed at you, so anything closer than 3,500 / 0.85 = 4,118 lets
 *    the nearest of them open fire on the first frame. That is the bug: being
 *    shot before you have found what is shooting.
 *  * **Inside their interest.** `PLAYER_INTEREST_RANGE` is 9,000 — an NPC does not
 *    care about you at all beyond it — so a longer opening would buy a stare
 *    rather than an approach.
 *  * **Clear of the attack-run thresholds.** TODO 34 counts a pass as closing
 *    inside `PASS_CLOSE` (400) and opening back out past `PASS_FAR` (900), so
 *    where a fight STARTS decides whether the first run is counted honestly:
 *    start inside 400 and `countPasses` begins the fight already "inside" and
 *    scores a free pass the first time anybody leaves; start in the 400-900 dead
 *    band and the first approach is half-measured. The nearest ship here starts
 *    at 0.85 x 4,500 = 3,825, which is four times PASS_FAR, so every run in the
 *    record is a run somebody actually flew.
 *
 * At a quarter throttle (`ENTRY_THROTTLE`) against a pirate's own speed this is
 * ten seconds of approach — the ten seconds the trainer exists to show.
 */
export const OPENING_RANGE = 4500;

/**
 * An ambush opens INSIDE their gun, because that is what an ambush is.
 *
 * Still well clear of `PASS_FAR`: 0.85 x 2,400 = 2,040, so even the fight that
 * starts behind you counts its attack runs from a clean standing start.
 */
export const AMBUSH_RANGE = 2400;

/**
 * No opening may be closer than this.
 *
 * Twice `PASS_FAR`, which after the spawner's -15% scatter still leaves the
 * nearest ship well outside it. Stated as a rule rather than checked by eye
 * because the coupling is invisible: a range picked for how a fight FEELS would
 * silently change what the attack-run count MEANS, and `npm test` holds every
 * plan to it.
 */
export const MIN_OPENING_RANGE = 2 * PASS_FAR;

/**
 * The cone a visible opening is scattered through, half-angle in degrees.
 *
 * 8, so the widest a ship can land is 1.45 x 8 = 11.6 degrees off the nose and
 * the nearest 4.4 — inside the canopy with room to spare, and off-centre enough
 * that a gang is a spread rather than a stack. Dead ahead would be free target
 * practice; the old 0.5-radian cone reached 41 degrees, which is off-screen.
 */
export const OPENING_CONE_DEG = 8;

/** An ambush spreads wide behind you: 16 to 43 degrees off your tail. */
export const AMBUSH_CONE_DEG = 30;

/**
 * How far off the nose still counts as "the pilot can see it".
 *
 * The trainer's own number, like `SIX_CONE` and the pass thresholds, and for the
 * same reason: the game has no notion of the canopy, only a camera. That camera
 * is a 60-degree vertical field of view (`engine/render-stack.ts`), so half of it
 * is 30 degrees and the console eats the bottom of that — 20 is the arc a
 * contact is genuinely IN, rather than technically on screen at the corner of it,
 * which is the state the pilot reported as "off-screen".
 */
export const IN_VIEW_DEG = 20;

const AHEAD: OpeningPlan = {
  arc: 'ahead', range: OPENING_RANGE, coneDeg: OPENING_CONE_DEG,
};

/**
 * Every scenario's opening, as a table — and an exhaustive one, so a new
 * `ScenarioId` does not compile until it has said where its fight starts.
 *
 * Six of the seven open AHEAD, at one range, on purpose: the argument for the
 * range (outside their gun, inside their interest, clear of the pass
 * thresholds) is the same argument for all six, and a per-scenario number with
 * no reason behind it would be decoration that later reads as a rule.
 */
const OPENINGS: Record<ScenarioId, OpeningPlan> = {
  // A hunter that came for you. You get to watch it come.
  'lone-hunter': AHEAD,
  'single-pirate': AHEAD,
  'pirate-pair': AHEAD,
  // A gang is a formation, and seeing it form up is half of what makes the
  // pack policy worth watching.
  'pirate-gang': AHEAD,
  // Vipers vectoring in on you: an interdiction announces itself.
  police: AHEAD,
  // THE EXCEPTION, and the reason the arc is on the record. The witch-space
  // fight is an ambush in the fiction and in the 1984 game: you are dropped
  // among them. It opens astern, inside their gun, and the report says NOT IN
  // VIEW so nobody mistakes it for the bug this file fixed.
  thargoids: { arc: 'astern', range: AMBUSH_RANGE, coneDeg: AMBUSH_CONE_DEG },
  // The galaxy's own reception, which in career flight is scattered down the
  // corridor to the station. What this scenario samples is WHO it sends, not
  // how long the commute was, so it opens like every other exercise.
  'as-they-come': AHEAD,
};

/**
 * A fight the pilot authored, in the custom picker.
 *
 * Ahead: you built this fight to watch it. Nobody assembles four Fer-de-Lances
 * by hand in order to be surprised by them.
 */
export const CUSTOM_OPENING: OpeningPlan = AHEAD;

/**
 * An opening nobody placed.
 *
 * For a record whose fight this file did not set up: `train/flight-probe.ts`
 * counts its passes through the game's own recorder, but its episodes are
 * `ai-training/scenario.ts`'s and their geometry is the EPISODE's, not this
 * table's — and the report's unit tests build setups by hand to state a
 * statistic's answer independently. A zero range with three nulls reads as "not
 * stated" instead of inventing a geometry, and `inView: false` is the safe
 * reading of a fight nobody has claimed opened in front of the pilot.
 */
export const NO_OPENING: OpeningGeometry = {
  arc: 'ahead',
  range: 0,
  coneDeg: 0,
  nearest: null,
  furthest: null,
  widestBearingDeg: null,
  inView: false,
};

/** Where this exercise opens. */
export function openingFor(spec: ExerciseSpec): OpeningPlan {
  return spec.custom ? CUSTOM_OPENING : OPENINGS[spec.scenario];
}

/** Every plan there is, for a test that has to hold all of them to one rule. */
export function openingPlans(): OpeningPlan[] {
  return [...Object.values(OPENINGS), CUSTOM_OPENING];
}

const DEG = Math.PI / 180;

/**
 * The plan as the spawner takes it.
 *
 * `forward` is the commander's nose and is CONSUMED — negated in place for an
 * astern opening — so pass a scratch vector, which is what the exercise has.
 */
export function openingPlacement(
  plan: OpeningPlan, forward: THREE.Vector3,
): OppositionPlacement {
  return {
    facing: plan.arc === 'astern' ? forward.negate() : forward,
    range: plan.range,
    cone: plan.coneDeg * DEG,
  };
}

/**
 * What the opening actually came out as — the record's half of the bargain.
 *
 * Measured from the ships as they landed rather than restated from the plan,
 * because the plan is an intent and the scatter is a draw: a report that quoted
 * the intent could not tell a fight that opened where it meant to from one that
 * did not. Bearings are off YOUR nose, so 0 is dead ahead and 180 is dead astern
 * whatever arc was asked for.
 */
export function measureOpening(
  plan: OpeningPlan,
  from: THREE.Vector3,
  quat: THREE.Quaternion,
  at: readonly THREE.Vector3[],
): OpeningGeometry {
  const ranges = at.map((p) => p.distanceTo(from));
  const bearings = at.map((p) => aimAngle(from, quat, p) / DEG);
  const widest = bearings.length ? Math.max(...bearings) : null;
  return {
    arc: plan.arc,
    range: plan.range,
    coneDeg: plan.coneDeg,
    nearest: ranges.length ? Math.round(Math.min(...ranges)) : null,
    furthest: ranges.length ? Math.round(Math.max(...ranges)) : null,
    widestBearingDeg: widest === null ? null : Math.round(widest),
    // Every one of them, not most: one ship off the corner of the canopy is the
    // exact complaint this answers.
    inView: widest !== null && widest <= IN_VIEW_DEG,
  };
}

/**
 * `AHEAD 4500 · 3900-5100 OUT · WIDEST 9° · IN VIEW` — one line, for a screen or
 * a log.
 *
 * Here rather than in the renderer because the trainer has two of those (the
 * report and its JSON) and the report's own screen is a dumb painter.
 */
export function describeOpening(o: OpeningGeometry): string {
  const spread = o.nearest === null ? 'nothing placed' : `${o.nearest}-${o.furthest} out`;
  const widest = o.widestBearingDeg === null ? '-' : `${o.widestBearingDeg}°`;
  return `${o.arc} ${o.range} · ${spread} · widest ${widest} off your nose`
    + ` · ${o.inView ? 'in view' : 'NOT in view'}`;
}
