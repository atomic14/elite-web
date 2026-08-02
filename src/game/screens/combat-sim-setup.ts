// What the pilot has picked, and the rows that show it.
//
// The setup half of the combat trainer's screen, and PURE: no DOM, no Input, no
// Game, nothing from three.js. It holds a draft — mode, fight, tier, seed,
// opposition, your fit-out — turns it into a list of rows for the renderer to
// paint, and turns it into the `ExerciseSpec` and `ExerciseFit` that
// combat-sim.ts runs.
//
// Split out of combat-sim.ts because the two halves answer different questions
// and the file was 540 lines answering both. This one is also the half worth
// testing: `npm test` builds a draft, drives the same `change()` functions an
// arrow key drives, and asserts the spec that comes out — which is the whole
// screen minus the keyboard, under node, with no browser.

import type { CommanderData, LaserType } from '../commander.ts';
import { MAX_MISSILES } from '../commander.ts';
import type { ExerciseFit } from '../combat-sim.ts';
import {
  SCENARIOS, SIM_BRAINS, clampTier, liveBrainFor, simHulls,
  type BrainId, type ExerciseSpec, type Opposition, type SimMode,
} from '../combat-sim-scenarios.ts';
import {
  AS_SHIPPED, LIVE_BRAIN_IDS, SHIPPED_BRAINS, liveBrainSelection,
  type BrainSelection, type LiveBrainId,
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
}

export const MODES: readonly SimMode[] = ['scenario', 'sparring', 'waves'];

const MODE_BLURB: Record<SimMode, string> = {
  scenario: 'ONE NAMED FIGHT, SCORED, ENDS BY ITSELF',
  sparring: 'ONE OPPONENT, RESPAWNING, PATCHED UP BETWEEN ROUNDS',
  waves: 'ESCALATING WAVES UNTIL YOU DIE — HOW MANY CAN YOU TAKE?',
};
const TIERS = ['0 OPPORTUNISTS', '1 PROFESSIONALS', '2 ORGANISED GANG'];
const LASERS: readonly LaserType[] = ['pulse', 'beam', 'military'];

/** `liveBrainFor`'s answer, offered as a choice so "no override" is pickable. */
export const AS_THE_GAME_FLIES = 'live';
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
  fit: FitDraft;
}

/** The selection the draft's LIVE row means — what the game will actually fly. */
export function liveSelectionOf(d: SimDraft): BrainSelection {
  return d.live === null ? { ...SHIPPED_BRAINS } : liveBrainSelection(d.live);
}

/** A row on the setup panel, and what &larr;&rarr; does to it. */
export interface SetupCell extends SimSetupRow {
  change?: (d: number) => void;
}

const cycle = (n: number, len: number, d: number): number => (n + d + len) % len;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const yesNo = (b: boolean): string => (b ? 'YES' : 'NO');

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
 * pirate flies is a GLOBAL flag in brains.ts — `window.__legacyPirates` and
 * friends — so `ExerciseSpec.brain` is the only lever the game actually has, and
 * a per-group choice can only be honoured when every group agrees. When they do
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

/** What the panel says under the rows: the mode, the fight, and any warning. */
export function draftNotes(d: SimDraft): string[] {
  const out: string[] = [MODE_BLURB[d.mode]];
  if (d.mode !== 'waves' && d.groups.length === 0) {
    out.push(SCENARIOS[d.scenario].blurb.toUpperCase());
  }
  const asked = new Set(d.groups
    .filter((g) => g.brain !== AS_THE_GAME_FLIES).map((g) => g.brain));
  if (d.live === null) {
    out.push('LIVE BRAINS WERE SET FROM THE CONSOLE TO SOMETHING THIS PICKER CANNOT NAME — '
      + 'ARROW THE LIVE BRAINS ROW TO TAKE IT BACK.');
  } else if (d.live !== AS_SHIPPED) {
    out.push(`LIVE BRAINS: THE WHOLE GALAXY FLIES ${d.live.toUpperCase()} UNTIL YOU SET `
      + 'THAT ROW BACK TO AS SHIPPED. IT IS SAVED WITH THE COMMANDER.');
  }
  if (d.brain === AS_THE_GAME_FLIES && asked.size > 1) {
    out.push('MIXED BRAINS CANNOT FLY: THE GAME LOADS ONE POLICY PER ROLE, SO THE '
      + 'LIVE BRAINS WILL. SET THE EXERCISE BRAIN ROW INSTEAD.');
  }
  return out;
}

// --- the rows ---------------------------------------------------------------

/**
 * The panel, as a list.
 *
 * Rebuilt on every render because its SHAPE moves: a custom opposition adds
 * seven rows per group. A cell owns its own label, its own reading and what an
 * arrow key does to it, so nothing anywhere switches on a row index — which is
 * the drift the market screen's old parallel click path was.
 */
export function setupCells(d: SimDraft): SetupCell[] {
  const hulls = simHulls();
  const live = liveSelectionOf(d);
  const scenario = SCENARIOS[d.scenario];
  const custom = d.groups.length > 0;
  const cells: SetupCell[] = [
    {
      label: 'MODE',
      value: d.mode.toUpperCase(),
      change: (n) => { d.mode = MODES[cycle(MODES.indexOf(d.mode), MODES.length, n)]; },
    },
    {
      label: 'FIGHT',
      value: scenario.name.toUpperCase(),
      dim: d.mode === 'waves' || custom,
      change: (n) => { d.scenario = cycle(d.scenario, SCENARIOS.length, n); },
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
      label: 'EXERCISE BRAIN',
      value: d.brain === AS_THE_GAME_FLIES ? 'AS THE GAME FLIES' : d.brain,
      change: (n) => {
        d.brain = BRAIN_CHOICES[cycle(BRAIN_CHOICES.indexOf(d.brain), BRAIN_CHOICES.length, n)];
      },
    },
    {
      // Beside the exercise brain because the two are read together: this one
      // says what "AS THE GAME FLIES" means and outlives the fight, the one
      // above overrides it for one fight. Set it, leave, and the galaxy flies it.
      label: 'LIVE BRAINS (CAREER)',
      value: d.live === null ? 'SET FROM THE CONSOLE'
        : d.live === AS_SHIPPED ? 'AS SHIPPED' : d.live.toUpperCase(),
      change: (n) => {
        const at = d.live === null ? -1 : LIVE_BRAIN_IDS.indexOf(d.live);
        d.live = at < 0 ? LIVE_BRAIN_IDS[0]
          : LIVE_BRAIN_IDS[cycle(at, LIVE_BRAIN_IDS.length, n)];
      },
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
        value: `${(g.hull % hulls.length) + 1}/${hulls.length}`
          + ` ${hull.name.toUpperCase()} (${hull.role})`,
        change: (n) => { g.hull = cycle(g.hull, hulls.length, n); },
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
        label: pad('ORGANISED (PACK POLICY)'),
        value: yesNo(g.organised),
        change: () => { g.organised = !g.organised; },
      },
      {
        label: pad('BRAIN'),
        value: g.brain === AS_THE_GAME_FLIES
          ? `AS THE GAME FLIES (${liveBrainFor(hull.role, g.organised, g.tier, live)})`
          : g.brain,
        change: (n) => {
          g.brain = BRAIN_CHOICES[cycle(BRAIN_CHOICES.indexOf(g.brain), BRAIN_CHOICES.length, n)];
        },
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
      label: 'YOUR LASER',
      value: f.laser.toUpperCase(),
      change: (n) => { f.laser = LASERS[cycle(LASERS.indexOf(f.laser), LASERS.length, n)]; },
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
  return cells;
}
