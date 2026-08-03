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
import { MAX_MISSILES } from '../commander.ts';
import type { ExerciseFit } from '../combat-sim.ts';
import {
  SCENARIOS, SIM_BRAINS, clampTier, liveBrainFor, simHulls,
  type BrainId, type ExerciseSpec, type Opposition, type SimMode,
} from '../combat-sim-scenarios.ts';
import {
  AS_SHIPPED, AS_THE_GAME_FLIES, LIVE_BRAIN_IDS, SHIPPED_BRAINS, brainName,
  liveBrainSelection, type BrainSelection, type LiveBrainId,
} from '../brain-names.ts';

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
  /**
   * This row is not about the exercise, and the renderer fences it off.
   *
   * Exactly one row is: LIVE BRAINS (COMMANDER) writes `state.brains`, so it is
   * still set when you undock. It stays IN this list — it is a cell, it is
   * arrowed and clicked like any other — and the renderer paints it apart.
   */
  fenced?: boolean;
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
  /**
   * The line under the fenced row, and whether it is a warning or a status.
   *
   * Structural rather than imported from combat-sim-notes.ts, which already
   * imports this file: the shape is two fields and the arrow points one way.
   */
  careerNote: { text: string; warning: boolean };
  /** the tallest `careerNote` can ever be, held open the same way */
  careerReserve: string;
  /** whether there is a report to go back to */
  hasReport: boolean;
}

export const MODES: readonly SimMode[] = ['scenario', 'sparring', 'waves'];

const TIERS = ['0 OPPORTUNISTS', '1 PROFESSIONALS', '2 ORGANISED GANG'];
const LASERS: readonly LaserType[] = ['pulse', 'beam', 'military'];

/**
 * The exercise picker's vocabulary: any named policy, or `AS_THE_GAME_FLIES` —
 * `liveBrainFor`'s answer, offered as a choice so "leave it alone" is pickable.
 * The sentinel itself lives in `brain-names.ts`, with every other name.
 */
export type BrainChoice = BrainId | typeof AS_THE_GAME_FLIES;
export const BRAIN_CHOICES: readonly BrainChoice[] = [AS_THE_GAME_FLIES, ...SIM_BRAINS];

/** One group in the custom picker, in the terms the picker offers. */
export interface CustomGroup {
  /** index into `simHulls()` */
  hull: number;
  count: number;
  tier: number;
  organised: boolean;
  brain: BrainChoice;
  /** null: whatever the hull carries */
  missiles: number | null;
  /** null: whatever the hull carries. 0..1, as `NpcSpec.ecmChance` */
  ecm: number | null;
}

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
  /** empty: take the opposition from the scenario table */
  groups: CustomGroup[];
  brain: BrainChoice;
  /**
   * Which policy the CAREER flies — `state.brains`, not the exercise's. The one
   * row here that outlives the fight; `null` is a selection only the console
   * could have made, which the row says rather than mislabelling.
   */
  live: LiveBrainId | null;
  /**
   * The furthest wave this commander has ever reached, 0 for never.
   *
   * READ from the commander, never written here: the draft is a picker and the
   * record is the career's (`commander.furthestWave`). Re-read every time the
   * screen opens, exactly as `live` is, because a run since the last open is
   * precisely when it changes.
   */
  furthestWave: number;
  fit: FitDraft;
}

/** The selection the draft's LIVE row means — what the game will actually fly. */
export function liveSelectionOf(d: SimDraft): BrainSelection {
  return d.live === null ? { ...SHIPPED_BRAINS } : liveBrainSelection(d.live);
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
   * and `game/brain-names.ts` owns the sentence. A group row left on AS THE
   * GAME FLIES reports the brain that resolves to, because that is the one the
   * pilot is about to meet.
   *
   * Both pickers' vocabularies, because both have a brain row: the exercise
   * rows speak `BrainChoice` and the fenced career row speaks `LiveBrainId`.
   */
  brain?: BrainChoice | LiveBrainId;
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
const flies = (id: BrainChoice | LiveBrainId): string => brainName(id) ?? id.toUpperCase();

/**
 * A draft to start from: a single professional pirate, in the ship you own.
 *
 * `single-pirate` rather than the first row of the table, because it is the
 * fight a pilot came to practise and the one every balance figure this project
 * quotes is about.
 */
export function freshDraft(c: CommanderData, live: LiveBrainId | null = AS_SHIPPED): SimDraft {
  return {
    mode: 'scenario',
    scenario: Math.max(0, SCENARIOS.findIndex((s) => s.id === 'single-pirate')),
    tier: 1,
    seed: null,
    lastSeed: null,
    groups: [],
    brain: AS_THE_GAME_FLIES,
    live,
    furthestWave: c.furthestWave ?? 0,
    fit: {
      laser: c.equipment.laser,
      rearLaser: c.equipment.rearLaser,
      ecm: c.equipment.ecm,
      energyUnit: c.equipment.energyUnit,
      energyBomb: c.equipment.energyBomb,
      missiles: c.missiles,
    },
  };
}

/** A new group: one pirate at the picked tier, flying whatever the game flies. */
export function defaultGroup(tier: number): CustomGroup {
  const pirate = simHulls().findIndex((h) => h.role === 'pirate');
  return {
    hull: Math.max(0, pirate),
    count: 1,
    tier: clampTier(tier),
    organised: false,
    brain: AS_THE_GAME_FLIES,
    missiles: null,
    ecm: null,
  };
}

/** Step a number that can also be "whatever the hull carries". */
export function nudgeOrHull(
  n: number | null, d: number, lo: number, hi: number,
): number | null {
  if (n === null) return d > 0 ? lo : hi;
  const next = Math.round(n) + d;
  return next < lo || next > hi ? null : next;
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

/** A picker group, in the terms combat-sim-scenarios.ts states opposition. */
export function oppositionFor(g: CustomGroup, sel: BrainSelection = SHIPPED_BRAINS): Opposition {
  const hulls = simHulls();
  const hull = hulls[g.hull % hulls.length];
  const brain = g.brain === AS_THE_GAME_FLIES
    ? liveBrainFor(hull.role, g.organised, g.tier, sel) : g.brain;
  return {
    role: hull.role,
    count: g.count,
    tier: g.tier,
    organised: g.organised,
    brain,
    mixed: false,
    seed: 0,   // nextOpposition() re-seeds each group from the round's seed
    hull: hull.spec,
    ...(g.missiles === null ? {} : { missiles: g.missiles }),
    ...(g.ecm === null ? {} : { ecm: g.ecm }),
  };
}

/**
 * Which single brain the opposition will fly, if the picker asked for one.
 *
 * The honest answer, and it is narrower than the picker looks. Which policy a
 * pirate flies is one `BrainSelection` for the whole exercise (brain-names.ts),
 * not a field on a ship — so `ExerciseSpec.brain` is the only lever the game
 * actually has, and a per-group choice can only be honoured when every group
 * agrees. (It was five `window.__` flags once; invariant 12 and
 * `test/state.test.ts` keep them gone.) When they do
 * not, no override goes in, the live brains fly, and `draftNotes()` says so on
 * the panel rather than letting the report quietly disagree with the picker.
 */
export function brainOverride(d: SimDraft): BrainId | null {
  if (d.brain !== AS_THE_GAME_FLIES) return d.brain;
  const asked = [...new Set(d.groups
    .filter((g) => g.brain !== AS_THE_GAME_FLIES)
    .map((g) => g.brain as BrainId))];
  return asked.length === 1 ? asked[0] : null;
}

/** The draft as the exercise the session will run. */
export function specFrom(d: SimDraft, seed: number): ExerciseSpec {
  const custom = d.groups.map((g) => oppositionFor(g, liveSelectionOf(d)));
  const brain = brainOverride(d);
  return {
    mode: d.mode,
    scenario: SCENARIOS[d.scenario].id,
    tier: d.tier,
    seed,
    ...(custom.length ? { custom } : {}),
    ...(brain ? { brain } : {}),
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
    },
    missiles: d.fit.missiles,
  };
}

// --- the rows ---------------------------------------------------------------

/**
 * The panel, as a list.
 *
 * Rebuilt on every render because its SHAPE moves: a custom opposition adds
 * seven rows per group. A cell owns its own label, its own reading and what an
 * arrow key does to it, so nothing anywhere switches on a row index — which is
 * the drift the market screen's old parallel click path was.
 *
 * It comes out in three groups and a fence — THE FIGHT, WHO FLIES WHAT, YOUR
 * SHIP, and then the one row that outlives the fight. The groups are `heading`
 * on the row that opens each, not entries in the list, so the list stays
 * exactly the rows the cursor can land on.
 */
export function setupCells(d: SimDraft): SetupCell[] {
  const hulls = simHulls();
  const live = liveSelectionOf(d);
  const scenario = SCENARIOS[d.scenario];
  const custom = d.groups.length > 0;
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
      dim: d.mode === 'waves' || custom,
      change: (n) => { d.scenario = cycle(d.scenario, SCENARIOS.length, n); },
      jump: (n) => { d.scenario = n > 0 ? SCENARIOS.length - 1 : 0; },
    },
    {
      label: 'THREAT TIER',
      value: TIERS[d.tier],
      dim: custom || d.mode === 'waves' || !scenario.tiered,
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
      heading: 'WHO FLIES WHAT',
      // What the row DECIDES, in a pilot's words, finishing the heading's
      // sentence — and it says WHICH FIGHT, because the row at the foot of the
      // panel decides the same thing for the career and the two were told apart
      // only by a fence.
      label: 'THE OPPOSITION FLIES (THIS FIGHT)',
      value: `${position(BRAIN_CHOICES.indexOf(d.brain), BRAIN_CHOICES.length)} `
        + flies(d.brain),
      brain: d.brain,
      change: (n) => { d.brain = step(BRAIN_CHOICES, d.brain, n); },
      jump: (n) => { d.brain = endOf(BRAIN_CHOICES, n); },
    },
    {
      label: 'OPPOSITION',
      value: custom
        ? `CUSTOM — ${d.groups.length} GROUP${d.groups.length === 1 ? '' : 'S'}`
        : 'FROM THE SCENARIO',
      change: (n) => {
        if (n > 0 && !custom) d.groups.push(defaultGroup(d.tier));
        else if (n < 0) d.groups.length = 0;
      },
    },
  ];
  for (const [k, g] of d.groups.entries()) {
    const hull = hulls[g.hull % hulls.length];
    const pad = (s: string): string => `&nbsp;&nbsp;&nbsp;${s}`;
    cells.push(
      {
        label: `GROUP ${k + 1} HULL`,
        // The position is on the front because the roster is 40-odd hulls
        // wide now and one arrow key steps one hull: without it you cannot tell
        // whether you are near the end of the list or the start of it.
        value: `${position(g.hull % hulls.length, hulls.length)}`
          + ` ${hull.name.toUpperCase()} (${hull.role})`,
        change: (n) => { g.hull = cycle(g.hull, hulls.length, n); },
        jump: (n) => { g.hull = n > 0 ? hulls.length - 1 : 0; },
      },
      {
        label: pad('COUNT'),
        value: String(g.count),
        change: (n) => { g.count = clamp(g.count + n, 1, 8); },
      },
      {
        label: pad('THREAT TIER'),
        value: TIERS[g.tier],
        change: (n) => { g.tier = clampTier(g.tier + n); },
      },
      {
        label: pad('ORGANISED — THEY FLY AS A GANG'),
        value: yesNo(g.organised),
        change: () => { g.organised = !g.organised; },
      },
      {
        label: pad('THIS GROUP FLIES'),
        // The VALUE is what you picked, and only that. It used to append what
        // the sentinel resolves to — `SAME AS OUTSIDE — MAKES RUNS
        // (pirate-attack-e1)` — which put a choice, a consequence and a file
        // stem in one cell and read as two selections at once. The consequence
        // is a sentence, so it belongs in the note under the panel with the
        // other sentences; `brain` below is what puts it there.
        value: `${position(BRAIN_CHOICES.indexOf(g.brain), BRAIN_CHOICES.length)} `
          + flies(g.brain),
        // Resolved, not the sentinel: a group left on SAME AS OUTSIDE will fly
        // a real policy and the line under the panel should describe THAT one.
        brain: g.brain === AS_THE_GAME_FLIES
          ? liveBrainFor(hull.role, g.organised, g.tier, live) : g.brain,
        change: (n) => { g.brain = step(BRAIN_CHOICES, g.brain, n); },
        jump: (n) => { g.brain = endOf(BRAIN_CHOICES, n); },
      },
      {
        label: pad('MISSILES'),
        value: g.missiles === null ? `HULL (${hull.spec.missiles ?? 0})` : String(g.missiles),
        change: (n) => { g.missiles = nudgeOrHull(g.missiles, n, 0, 8); },
      },
      {
        label: pad('E.C.M.'),
        value: g.ecm === null
          ? `HULL (${Math.round((hull.spec.ecmChance ?? 0) * 100)}%)`
          : `${Math.round(g.ecm * 100)}%`,
        change: (n) => {
          const next = nudgeOrHull(g.ecm === null ? null : g.ecm * 10, n, 0, 10);
          g.ecm = next === null ? null : next / 10;
        },
      },
    );
  }
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
  );
  // LAST, alone, and fenced. It used to sit sixth, between the exercise brain
  // and the opposition, in the same weight as YOUR MISSILES — and it is the one
  // row here that is still set when you undock: it writes `state.brains`, so the
  // whole galaxy flies what it says, and it is saved with the commander. Read
  // together with the exercise brain it looked like a second override for the
  // same fight, which is exactly what it is not.
  cells.push({
    heading: 'THIS ONE STAYS SET AFTER YOU UNDOCK',
    fenced: true,
    label: 'CHANGE THE DEFAULT ENEMY AI',
    // No position on the console case, because there is no position: a selection
    // the picker cannot name is not one of the eleven it offers.
    value: d.live === null ? 'SET FROM THE CONSOLE'
      : `${position(LIVE_BRAIN_IDS.indexOf(d.live), LIVE_BRAIN_IDS.length)} `
        + flies(d.live),
    brain: d.live ?? undefined,
    change: (n) => {
      const at = d.live === null ? -1 : LIVE_BRAIN_IDS.indexOf(d.live);
      d.live = at < 0 ? LIVE_BRAIN_IDS[0]
        : LIVE_BRAIN_IDS[cycle(at, LIVE_BRAIN_IDS.length, n)];
    },
    jump: (n) => { d.live = endOf(LIVE_BRAIN_IDS, n); },
  });
  return cells;
}
