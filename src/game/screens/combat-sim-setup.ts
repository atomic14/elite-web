// What the pilot has picked, and the rows that show it.
//
// The setup half of the combat trainer's screen, and PURE: no DOM, no Input, no
// Game, nothing from three.js. It holds a draft — mode, fight, tier, seed,
// opposition, your fit-out — turns it into a list of rows for the renderer to
// paint, and turns it into the `ExerciseSpec` and `ExerciseFit` that
// combat-sim.ts runs.
//
// Split out of combat-sim.ts because the two halves answer different questions
// and the file was 540 lines answering both. The PROSE under the rows went the
// same way again, to combat-sim-notes.ts: a cell is a closure over the draft and
// has to stay beside it, but a sentence describing a draft only reads it.
//
// This one is also the half worth testing: `npm test` builds a draft, drives
// the same `change()` functions an arrow key drives, and asserts the spec that
// comes out — which is the whole screen minus the keyboard, under node, with no
// browser.

import type { CommanderData, LaserType } from '../commander.ts';
import { MAX_MISSILES } from '../../constants/commander.ts';
import type { ExerciseFit } from '../combat-sim.ts';
import {
  SCENARIOS, clampTier,
  type BrainId, type ExerciseSpec, type SimMode,
} from '../combat-sim-scenarios.ts';
import { brainName } from '../brain-names.ts';

/**
 * One line on the setup panel, as the renderer needs it.
 *
 * Declared here rather than in `ui/screens.ts` so the dependency points the
 * right way: this module produces rows and the renderer paints them, which also
 * keeps this file free of anything that has heard of the DOM.
 */
export interface SimSetupRow {
  label: string;
  value: string;
  /** shown for context, but this fight does not use it */
  dim?: boolean;
  /**
   * A faint group heading painted ABOVE this row.
   *
   * A property of the row it introduces rather than an entry in the list,
   * deliberately: the cursor and every click index THIS list, so a heading that
   * was a list entry would be a selectable row that does nothing, and `this.row`
   * would stop meaning what `setupCells()` says it means.
   */
  heading?: string;
}

/** The whole setup panel, as the renderer needs it. */
export interface SimSetupPanel {
  rows: readonly SimSetupRow[];
  /** index into `rows` — headings are not rows, so this needs no correction */
  selected: number;
  /** the contextual help under the rows */
  notes: readonly string[];
  /** the tallest `notes` can ever be, painted invisibly to hold the height */
  notesReserve: readonly string[];
  /**
   * What the brain on the SELECTED row does in a fight, or null on a row that
   * names no brain. The answer to "PIRATE-ATTACK-T29 — and what is that?".
   */
  brainNote: string | null;
  /** the tallest `brainNote` can ever be, held open the same way */
  brainReserve: string;
  /** whether there is a report to go back to */
  hasReport: boolean;
}

export const MODES: readonly SimMode[] = ['scenario', 'sparring', 'waves'];

const TIERS = ['0 OPPORTUNISTS', '1 PROFESSIONALS', '2 ORGANISED GANG'];
const LASERS: readonly LaserType[] = ['pulse', 'beam', 'military'];

/**
 * What the pirates can be set to fly for a fight — the two CODE pilots a
 * commander can meet: the scripted attack run they fly by default, and the
 * pursuit dogfighter (the combat computer's own pilot, turned on them). This
 * is the whole of "change the brain the pirates fly"; there is no custom
 * opposition builder any more, and no career-persisting brain row — the choice
 * is the fight's, restored when you undock (combat-sim.ts's entry snapshot).
 */
export const PIRATE_CHOICES: readonly BrainId[] = ['attack-run', 'pursuit'];

/**
 * The fit-out lent to the commander for the exercise.
 *
 * Fit-out, NOT hull, and docs/COMBAT-SIM.md says why: the player's hull is four
 * constants in player.ts with no roster, and `ai-training/scenario.ts` reads
 * `PLAYER_FLIGHT` as the target every pirate brain was fitted against. Making
 * the hull selectable would change the world those brains live in.
 */
export interface FitDraft {
  laser: LaserType;
  rearLaser: boolean;
  ecm: boolean;
  energyUnit: boolean;
  energyBomb: boolean;
  /**
   * Whether the exercise lends you the combat computer — the ONE brain the game
   * flies on your behalf rather than at you, and until now the one you could
   * not watch. Fit it, launch, press K.
   */
  combatComputer: boolean;
  missiles: number;
}

/** Everything the picker has been told, and nothing about how it was told. */
export interface SimDraft {
  mode: SimMode;
  /** index into SCENARIOS */
  scenario: number;
  tier: number;
  /** null: roll one at launch, so a fresh fight every time */
  seed: number | null;
  /** the seed the last launch used — quoted so a fight can be flown again */
  lastSeed: number | null;
  /** which brain the PIRATES fly this fight — one of `PIRATE_CHOICES` */
  brain: BrainId;
  /**
   * The furthest wave this commander has ever reached, 0 for never.
   *
   * READ from the commander, never written here: the draft is a picker and the
   * record is the career's (`commander.furthestWave`). Re-read every time the
   * screen opens, because a run since the last open is precisely when it changes.
   */
  furthestWave: number;
  fit: FitDraft;
}

/** A row on the setup panel, and what &larr;&rarr; does to it. */
export interface SetupCell extends SimSetupRow {
  change?: (d: number) => void;
  /**
   * HOME / END: go to the first or the last value without walking there.
   *
   * Only rows over a finite ordered LIST have one. Twelve brains and forty-odd
   * hulls at one value per key press is a list you cannot get to the end of,
   * and a number row (seed, count, missiles) has no end to go to.
   */
  jump?: (d: number) => void;
  /**
   * The brain this row currently names, for the line that says what it DOES.
   *
   * An id, never prose: `screens/combat-sim-notes.ts` turns it into a sentence
   * and `game/brain-names.ts` owns the sentence. Only the PIRATES FLY row
   * carries one now.
   */
  brain?: BrainId;
}

const cycle = (n: number, len: number, d: number): number => (n + d + len) % len;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const yesNo = (b: boolean): string => (b ? 'YES' : 'NO');

/** The next value round a list, and the value at one end of it. */
const step = <T>(xs: readonly T[], v: T, d: number): T => xs[cycle(xs.indexOf(v), xs.length, d)];
const endOf = <T>(xs: readonly T[], d: number): T => (d > 0 ? xs[xs.length - 1] : xs[0]);

/**
 * `4/12` — where you are in a list you cannot see.
 *
 * The hull row has carried one since the roster went to 40-odd entries, for the
 * reason every long row needs it: one arrow key steps one value, so without a
 * position you cannot tell whether the next press wraps or walks. Now that both
 * brain rows are a dozen values long they carry one too.
 */
/**
 * `(1 OF 6)` — where you are in a list you can arrow through.
 *
 * It was `1/6`, which a pilot reads as a fraction or a ratio before they read
 * it as a position. The keyline says the arrows change a row; this says how
 * many there are to change it to.
 */
const position = (at: number, len: number): string => `(${at + 1} OF ${len})`;

/**
 * `HOLDS OFF` — how it flies, and only that.
 *
 * The row's value used to BE the file stem, which made a pilot choose between
 * build artefacts; that was fixed by putting the name first and the stem second
 * in a quieter face. The stem is out of the value entirely now. It was kept for
 * anyone cross-referencing docs/TRAINING-LOG.md — a developer's need, on a
 * pilot's screen, in the column the pilot reads to make the choice. It moved to
 * the note underneath, where the rest of the prose already lives and where
 * nobody has to read past it.
 */
const flies = (id: BrainId): string => brainName(id) ?? id.toUpperCase();

/**
 * A draft to start from: a single professional pirate, in the ship you own.
 *
 * `single-pirate` rather than the first row of the table, because it is the
 * fight a pilot came to practise and the one every balance figure this project
 * quotes is about.
 */
export function freshDraft(c: CommanderData): SimDraft {
  return {
    mode: 'scenario',
    scenario: Math.max(0, SCENARIOS.findIndex((s) => s.id === 'single-pirate')),
    tier: 1,
    seed: null,
    lastSeed: null,
    brain: 'attack-run',
    furthestWave: c.furthestWave ?? 0,
    fit: {
      laser: c.equipment.laser,
      rearLaser: c.equipment.rearLaser,
      ecm: c.equipment.ecm,
      energyUnit: c.equipment.energyUnit,
      energyBomb: c.equipment.energyBomb,
      combatComputer: c.equipment.combatComputer,
      missiles: c.missiles,
    },
  };
}

/**
 * A seed for a fight nobody asked to repeat.
 *
 * The clock, NOT the seeded rng — and not `Math.random`, which is banned across
 * `src/game` and enforced by `npm test`. Drawing from `game/rng.ts` here would
 * advance the CAREER's stream one step before `begin()` captures its snapshot,
 * and docs/COMBAT-SIM.md's rule is that an exercise costs the career nothing.
 * The clock is outside the world entirely.
 */
export function freshSeed(now = Date.now()): number {
  return now & 0x7fffffff;
}

// --- the draft, as an exercise ----------------------------------------------

/**
 * The draft as the exercise the session will run.
 *
 * The pirate brain is the only override the game has: which policy a pirate
 * flies is one `BrainSelection` for the whole exercise (brain-names.ts), not a
 * field on a ship, and `combat-sim.ts` applies `spec.brain` to `state.brains`
 * for the fight and restores it on undock. `attack-run` is the default — the
 * scripted run every pirate flies — so it goes in as NO override, leaving the
 * scenario table and the report to name it `scripted`; only a real change
 * (`pursuit`) is sent.
 */
export function specFrom(d: SimDraft, seed: number): ExerciseSpec {
  return {
    mode: d.mode,
    scenario: SCENARIOS[d.scenario].id,
    tier: d.tier,
    seed,
    ...(d.brain === 'attack-run' ? {} : { brain: d.brain }),
  };
}

/** The fit-out the exercise lends the CLONE. */
export function fitFrom(d: SimDraft): ExerciseFit {
  return {
    equipment: {
      laser: d.fit.laser,
      rearLaser: d.fit.rearLaser,
      ecm: d.fit.ecm,
      energyUnit: d.fit.energyUnit,
      energyBomb: d.fit.energyBomb,
      combatComputer: d.fit.combatComputer,
    },
    missiles: d.fit.missiles,
  };
}

// --- the rows ---------------------------------------------------------------

/**
 * The panel, as a list.
 *
 * A cell owns its own label, its own reading and what an arrow key does to it,
 * so nothing anywhere switches on a row index — which is the drift the market
 * screen's old parallel click path was.
 *
 * Three groups — THE FIGHT, WHO YOU FIGHT, YOUR SHIP. The custom-opposition
 * builder is gone (Chris: too complex): who you fight is the scenario/mode, and
 * the one lever over the opposition is which brain the pirates fly. The
 * combat computer is one thing now, a fit YES/NO like the laser — there is one
 * co-pilot pilot, so there is nothing to pick and no career-brain row. The
 * groups are `heading` on the row that opens each, not entries in the list.
 */
export function setupCells(d: SimDraft): SetupCell[] {
  const scenario = SCENARIOS[d.scenario];
  const cells: SetupCell[] = [
    {
      heading: 'THE FIGHT',
      label: 'MODE',
      value: d.mode.toUpperCase(),
      change: (n) => { d.mode = step(MODES, d.mode, n); },
      jump: (n) => { d.mode = endOf(MODES, n); },
    },
    {
      label: 'FIGHT',
      value: scenario.name.toUpperCase(),
      dim: d.mode === 'waves',
      change: (n) => { d.scenario = cycle(d.scenario, SCENARIOS.length, n); },
      jump: (n) => { d.scenario = n > 0 ? SCENARIOS.length - 1 : 0; },
    },
    {
      label: 'THREAT TIER',
      value: TIERS[d.tier],
      dim: d.mode === 'waves' || !scenario.tiered,
      change: (n) => { d.tier = clampTier(d.tier + n); },
    },
    {
      label: 'SEED',
      value: d.seed === null
        ? `RANDOM${d.lastSeed === null ? '' : ` (LAST ${d.lastSeed})`}`
        : String(d.seed),
      change: (n) => {
        if (d.seed === null) d.seed = d.lastSeed ?? 1;
        else if (d.seed + n < 0) d.seed = null;
        else d.seed += n;
      },
    },
    {
      heading: 'WHO YOU FIGHT',
      // The one lever over the opposition: which brain the pirates fly. The
      // scripted attack run by default, or the pursuit dogfighter — the combat
      // computer's own pilot turned on them. Training-fight only: it sets the
      // exercise brain, which combat-sim.ts restores when you undock.
      label: 'PIRATES FLY',
      value: `${position(PIRATE_CHOICES.indexOf(d.brain), PIRATE_CHOICES.length)} `
        + flies(d.brain),
      brain: d.brain,
      change: (n) => { d.brain = step(PIRATE_CHOICES, d.brain, n); },
      jump: (n) => { d.brain = endOf(PIRATE_CHOICES, n); },
    },
  ];
  const f = d.fit;
  cells.push(
    {
      heading: 'YOUR SHIP',
      label: 'YOUR LASER',
      value: f.laser.toUpperCase(),
      change: (n) => { f.laser = step(LASERS, f.laser, n); },
      jump: (n) => { f.laser = endOf(LASERS, n); },
    },
    {
      label: 'YOUR REAR LASER',
      value: yesNo(f.rearLaser),
      change: () => { f.rearLaser = !f.rearLaser; },
    },
    { label: 'YOUR E.C.M.', value: yesNo(f.ecm), change: () => { f.ecm = !f.ecm; } },
    {
      label: 'YOUR ENERGY UNIT',
      value: yesNo(f.energyUnit),
      change: () => { f.energyUnit = !f.energyUnit; },
    },
    {
      label: 'YOUR ENERGY BOMB',
      value: yesNo(f.energyBomb),
      change: () => { f.energyBomb = !f.energyBomb; },
    },
    {
      label: 'YOUR MISSILES',
      value: String(f.missiles),
      change: (n) => { f.missiles = clamp(f.missiles + n, 0, MAX_MISSILES); },
    },
    {
      // Fitted here so the co-pilot can be WATCHED: it is the one pilot the game
      // flies on the commander's behalf rather than against him. Fit it, launch,
      // press K. One thing now — YES or NO — because there is one co-pilot.
      label: 'YOUR COMBAT COMPUTER',
      value: yesNo(f.combatComputer),
      change: () => { f.combatComputer = !f.combatComputer; },
    },
  );
  return cells;
}
