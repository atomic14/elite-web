// What the combat trainer sends at you, and when it stops sending it.
//
// The rules half of the training simulator (docs/COMBAT-SIM.md). Two questions
// live here and nothing else does:
//
//   1. WHO you fight — the seven scenarios, as a table rather than seven code
//      paths, plus the wave ramp and the live "as they come" reception.
//   2. WHETHER the round or the exercise is finished — `nextOpposition()` and
//      `roundOutcome()`, which is the whole of the three modes.
//
// Pure: no DOM, no World, no three.js, no brain files. It describes opposition
// as data — role, count, tier, which brain, what fit — and the session spawns
// it. The rng is injectable and defaults to the world's seeded stream, the way
// encounters.ts, population.ts and contracts.ts do, so a test can drive it.
//
// It owns no hulls. There is exactly one roster (ship-specs.ts) and one rule
// for who is a ringleader (contracts.ts `memberTier`), and the live game reads
// both; a second copy here is the bug class this codebase keeps paying for.

import type { StarSystem } from '../galaxy/galaxy.ts';
import {
  SPECS, pirateSpecForTier, CONSTRICTOR_SPEC, type NpcSpec,
} from './ship-specs.ts';
import { markOf, memberTier, pirateThreat, type PirateThreat } from './threat.ts';
import {
  SHIPPED_BRAINS, defenceBrainNameFor, pirateBrainNameFor,
  type BrainSelection, type NamedBrain,
} from './brain-names.ts';
import { hasShipDef, shipDisplayName } from '../ships/registry.ts';
import { random } from './rng.ts';

// --- what an opponent is ----------------------------------------------------

/**
 * The roles that can be sent at you. A subset of NpcRole on purpose: an
 * asteroid, a hermit rock and a generation ship are scenery, and putting them
 * in a fight would be a category error rather than a hard exercise.
 *
 * `trader` is here for the custom picker only — no scenario sends one — because
 * an armed trader flying the Jameson defence brain is a real fight the game
 * contains, and it is the one a would-be pirate should practise.
 */
export type OppositionRole = 'pirate' | 'police' | 'hunter' | 'thargoid' | 'thargon' | 'trader';

/** The same list at runtime, for the picker and for the tests. */
export const OPPOSITION_ROLES: readonly OppositionRole[] =
  ['pirate', 'police', 'hunter', 'thargoid', 'thargon', 'trader'];

/**
 * Which policy an opponent flies, named rather than loaded.
 *
 * A string, not a `Brain`: this module stays pure and the report needs the
 * NAME anyway — "won against g3, lost against e1" is the whole point of the
 * A/B rig, and a weight matrix does not export. The session resolves the id to
 * the loaded policy.
 *
 * `scripted` is the pre-neuroevolution AI, i.e. `window.__scriptedPirates` made
 * a per-opponent choice instead of a global flag. It is the baseline every
 * training run is measured against.
 *
 * The union itself is `brain-names.ts`'s `NamedBrain` — every name a picker may
 * offer, which is the loaded set plus `pirate-attack-g1` — because the character
 * lines have to cover exactly the same list and a second copy of it would drift.
 */
export type BrainId = NamedBrain;

/**
 * The brains the live game flies, DERIVED — ask the rule, do not restate it.
 *
 * These used to be three literals, and the literals were wrong the moment a
 * career set `state.brains`. They are what `brain-names.ts` answers for the
 * shipped selection, so promoting a candidate moves them without an edit here,
 * and `npm test` still checks that the names brains.ts imports are these.
 */
export const SHIPPED_SOLO_BRAIN: BrainId = pirateBrainNameFor(0, false, SHIPPED_BRAINS);
export const SHIPPED_PACK_BRAIN: BrainId = pirateBrainNameFor(0, true, SHIPPED_BRAINS);
export const SHIPPED_DEFENCE_BRAIN: BrainId = defenceBrainNameFor(SHIPPED_BRAINS);

/**
 * Every brain the picker may choose, in the order it should be listed: the
 * three the game ships, TODO 29's three candidates, then the older controls.
 *
 * `pirate-attack-g1` is the one entry with no policy behind it — brains.ts does
 * not import it — and asking for it is refused with a warning on the record
 * rather than silently flying something else.
 */
export const SIM_BRAINS: readonly BrainId[] = [
  SHIPPED_SOLO_BRAIN, SHIPPED_PACK_BRAIN, SHIPPED_DEFENCE_BRAIN,
  'pirate-attack-t29', 'pirate-pack-t29', 'jameson-defend-t29',
  'pirate-attack-g2', 'pirate-attack-g1', 'pirate-attack-e1', 'pirate-attack-r2',
  'scripted',
];

/**
 * Which brain this role flies in the LIVE game under this selection, so an
 * exercise measures the game rather than a game we might have built.
 *
 * It does not mirror npc.ts — it asks the same function npc.ts asks
 * (`brain-names.ts`), which is the difference between agreeing and happening to
 * agree. This hardcoded the shipped ids and ignored the selection entirely, so a
 * career flying `state.brains.sharp = 'pro'` was reported as flying g3.
 *
 * Only pirates reach the pirate rule (organised gangs get the pack policy,
 * everyone else the solo one), an armed trader turns and fights with the defence
 * brain, and police, bounty hunters and Thargoids are scripted whatever is
 * selected.
 */
export function liveBrainFor(
  role: OppositionRole, organised: boolean, tier: number,
  sel: BrainSelection = SHIPPED_BRAINS,
): BrainId {
  if (role === 'pirate') return pirateBrainNameFor(tier, organised, sel);
  if (role === 'trader') return defenceBrainNameFor(sel);
  return 'scripted';
}

/** One group of opponents: how many, how good, and what they are flying. */
export interface Opposition {
  role: OppositionRole;
  /** at least 1 */
  count: number;
  /** threat tier 0 opportunists · 1 professionals · 2 an organised gang */
  tier: number;
  /** flies the coordinated pack policy and presses the attack */
  organised: boolean;
  brain: BrainId;
  /**
   * True for a group that is ringleaders plus hangers-on — `memberTier` decides
   * who is which, exactly as spawning.ts does it. False for a group the
   * scenario says is uniform (a pair of professionals is a pair, not a
   * professional and an opportunist).
   */
  mixed: boolean;
  /** stable seed for this group: hull variant, and the spawner's scatter */
  seed: number;
  /** fit overrides; omitted means the hull's own */
  missiles?: number;
  ecm?: number;
  /** hull override, from the custom picker. Wins over the role's roster. */
  hull?: NpcSpec;
}

/** One ship, resolved: this is what the spawner needs and the report quotes. */
export interface SimShip {
  role: OppositionRole;
  spec: NpcSpec;
  tier: number;
  organised: boolean;
  brain: BrainId;
  /** `variantSeed` for the spawn, and what made the hull choice above */
  seed: number;
}

/** Ships within a group are seeded this far apart. */
const SHIP_SEED_STRIDE = 7;

/** The roster pick for a non-pirate role — one hull table, and it is not here. */
function rosterHull(role: OppositionRole, seed: number): NpcSpec {
  const options = SPECS[role];
  return options[Math.abs(seed) % options.length];
}

/** Apply the group's fit to a hull without touching the roster's own entry. */
function fitted(spec: NpcSpec, o: Opposition): NpcSpec {
  if (o.missiles === undefined && o.ecm === undefined) return spec;
  return {
    ...spec,
    missiles: o.missiles ?? spec.missiles,
    ecmChance: o.ecm ?? spec.ecmChance,
  };
}

/**
 * Resolve a group into the ships it means.
 *
 * Deterministic in the group's seed, which is why the report can quote a seed
 * and the fight can be flown again.
 */
export function oppositionShips(o: Opposition): SimShip[] {
  const ships: SimShip[] = [];
  for (let i = 0; i < o.count; i++) {
    const seed = o.seed + i * SHIP_SEED_STRIDE;
    const tier = o.mixed ? memberTier(o.tier, i) : o.tier;
    const base = o.hull
      ?? (o.role === 'pirate' ? pirateSpecForTier(tier, seed) : rosterHull(o.role, seed));
    ships.push({
      role: o.role, spec: fitted(base, o), tier, organised: o.organised,
      brain: o.brain, seed,
    });
  }
  return ships;
}

/** Every ship an opposition list means, in order. */
export function allShips(list: readonly Opposition[]): SimShip[] {
  return list.flatMap(oppositionShips);
}

/** How many ships a list is — what the session counts down as they die. */
export function shipCount(list: readonly Opposition[]): number {
  return list.reduce((n, o) => n + o.count, 0);
}

/** A one-line label for the screen and the report. */
export function describeOpposition(list: readonly Opposition[]): string {
  return list.map((o) => {
    const ships = oppositionShips(o);
    const hulls = [...new Set(ships.map((s) => shipDisplayName(s.spec.designId)))];
    return `${o.count} × ${hulls.join('/')}`
      + ` (tier ${o.tier}${o.organised ? ', organised' : ''})`;
  }).join(' + ');
}

/**
 * The hulls the custom picker may choose from — the whole roster that can fly,
 * plus the Constrictor, which the game only ever spawns once per career and is
 * therefore the one fight nobody gets to practise.
 *
 * Derived from `SPECS`, deliberately: adding a hull to the roster adds it here.
 * Scenery (asteroids, hermits, the generation ship) is excluded because it
 * cannot fight, not because of a list of exclusions.
 */
export function simHulls(): { role: OppositionRole; spec: NpcSpec; name: string }[] {
  const out = OPPOSITION_ROLES.flatMap((role) => SPECS[role]
    .filter((spec) => hasShipDef(spec.designId))
    .map((spec) => ({ role, spec, name: shipDisplayName(spec.designId) })));
  out.push({
    role: 'pirate',
    spec: CONSTRICTOR_SPEC,
    name: shipDisplayName(CONSTRICTOR_SPEC.designId),
  });
  return out;
}

// --- the seven scenarios ----------------------------------------------------

export type ScenarioId =
  | 'lone-hunter' | 'single-pirate' | 'pirate-pair' | 'pirate-gang'
  | 'police' | 'thargoids' | 'as-they-come';

/**
 * A group as the TABLE states it: `count` and `tier` may be left to the
 * picked threat tier, so that one row covers "single pirate, tier selectable"
 * without becoming a function.
 */
interface OppositionTemplate {
  role: OppositionRole;
  /** how many at the bottom of the range */
  count: number;
  /**
   * Extra ships when the PICKED tier is 2 — how "3-4 pirates" and "2-3
   * Thargoids" are written without a function. Keyed on what the player picked
   * rather than on the group's own tier, so a row with a fixed tier (Thargoids
   * have one hull) still grows when you ask for a harder fight.
   */
  countAtTopTier?: number;
  /** fixed tier; omitted means the picker's */
  tier?: number;
  organised?: boolean;
  mixed?: boolean;
  brain?: BrainId;
  missiles?: number;
  ecm?: number;
}

export interface Scenario {
  id: ScenarioId;
  /** menu label */
  name: string;
  /** one line for the picker */
  blurb: string;
  /** does the picked threat tier change this fight? */
  tiered: boolean;
  /**
   * The opposition, as data. `null` means it is not ours to state: the galaxy
   * decides — see `asTheyCome`.
   */
  groups: readonly OppositionTemplate[] | null;
}

/**
 * The seven, in picker order. Data, not code paths — every entry goes through
 * the same resolver, so a new fight is a new row.
 */
export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'lone-hunter',
    name: 'Lone bounty hunter',
    blurb: 'One bounty hunter, and it came for you.',
    tiered: false,
    // No hull is named here: the seed picks one out of the roster's `hunter`
    // list, which TODO 25 widened from two (Fer-de-Lance, Asp Mk II) to nine
    // when the recovered designs arrived — and TODO 29 dropped the Asp Mk II
    // from it entirely, because no released build of it can hurt a flyable
    // hull. Naming the hulls in the blurb is how that went stale once already.
    groups: [{ role: 'hunter', count: 1, tier: 1 }],
  },
  {
    id: 'single-pirate',
    name: 'Single pirate',
    blurb: 'One pirate at the tier you choose.',
    tiered: true,
    groups: [{ role: 'pirate', count: 1, mixed: false }],
  },
  {
    id: 'pirate-pair',
    name: 'Pirate pair',
    blurb: 'Two of them, both at your chosen tier.',
    tiered: true,
    // mixed: false is the spec's "same tier" — memberTier would make the second
    // one a hanger-on, which is a gang's rule, not a pair's.
    groups: [{ role: 'pirate', count: 2, mixed: false }],
  },
  {
    id: 'pirate-gang',
    name: 'Pirate gang',
    blurb: 'Three or four, organised, flying the pack policy.',
    tiered: true,
    // Organised, so mixed: two ringleaders and the hangers-on they brought,
    // which is what the live game spawns.
    groups: [{ role: 'pirate', count: 3, countAtTopTier: 1, organised: true, mixed: true }],
  },
  {
    id: 'police',
    name: 'Police interdiction',
    blurb: 'Two Vipers — what shooting a trader actually buys you.',
    tiered: false,
    groups: [{ role: 'police', count: 2, tier: 1, mixed: false }],
  },
  {
    id: 'thargoids',
    name: 'Thargoid ambush',
    blurb: 'The witch-space fight: Thargoids and their Thargons.',
    tiered: true,
    // One Thargoid hull exists, so the tier buys numbers rather than better
    // ships — 2 of them and 3 Thargons, 3 and 5 at the top tier.
    groups: [
      { role: 'thargoid', count: 2, countAtTopTier: 1, tier: 2, mixed: false },
      { role: 'thargon', count: 3, countAtTopTier: 2, tier: 0, mixed: false },
    ],
  },
  {
    id: 'as-they-come',
    name: 'As they come',
    blurb: 'Whatever the galaxy would send at you right now.',
    tiered: false,
    groups: null,
  },
];

export function scenarioById(id: ScenarioId): Scenario {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`no such scenario: ${id}`);
  return s;
}

/** Threat tiers run 0..2, as `PirateThreat.tier` does. */
export const MAX_TIER = 2;

export function clampTier(tier: number): number {
  return Math.max(0, Math.min(MAX_TIER, Math.round(tier)));
}

/** Turn a table row into a group. */
function resolve(t: OppositionTemplate, pickedTier: number, seed: number): Opposition {
  const picked = clampTier(pickedTier);
  const tier = clampTier(t.tier ?? picked);
  const organised = t.organised ?? false;
  const count = Math.max(1, t.count + (picked >= MAX_TIER ? (t.countAtTopTier ?? 0) : 0));
  return {
    role: t.role,
    count,
    tier,
    organised,
    brain: t.brain ?? liveBrainFor(t.role, organised, tier),
    mixed: t.mixed ?? organised,
    seed,
    missiles: t.missiles,
    ecm: t.ecm,
  };
}

// --- as they come -----------------------------------------------------------

/**
 * What the live galaxy knows about you when it decides who to send.
 *
 * The commander is the CAREER commander, passed in by the caller — the
 * exercise flies a clone with no cargo and no reputation (docs/COMBAT-SIM.md,
 * "the one rule"), and asking the clone what you are worth robbing would send
 * Sidewinders at a Dangerous commander in a full Python.
 */
export interface ThreatContext {
  sys: StarSystem;
  /** what the living galaxy has seen happen here lately, 0..1 */
  danger: number;
  commander: Parameters<typeof markOf>[0];
  /** regional heat, 0..1 */
  notoriety: number;
}

/**
 * The reception `pirateThreat` would send, as opposition.
 *
 * The one deviation, and it is the only one: a reception of nobody is a
 * legitimate answer for an empty hold in a well-governed system, but you came
 * here to fight, so the count is floored at 1. Tier, organisation and the
 * ringleader split are untouched — this is the fight the live game would build.
 */
export function oppositionFromThreat(threat: PirateThreat, seed: number): Opposition[] {
  return [{
    role: 'pirate',
    count: Math.max(1, threat.count),
    tier: threat.tier,
    organised: threat.organised,
    brain: liveBrainFor('pirate', threat.organised, threat.tier),
    mixed: true,
    seed,
  }];
}

/**
 * Ask the galaxy what it would send at this commander, right here, right now.
 *
 * The most valuable scenario for balance, because it is the only way to sample
 * the real fight without flying until one happens. It reads the commander with
 * `markOf` and sizes the reception with `pirateThreat`, exactly as game.ts does
 * on arrival.
 */
export function asTheyCome(
  ctx: ThreatContext, seed: number, rng: () => number = random,
): Opposition[] {
  const threat = pirateThreat(ctx.sys, ctx.danger, markOf(ctx.commander, ctx.notoriety), rng);
  return oppositionFromThreat(threat, seed);
}

// --- waves ------------------------------------------------------------------

/**
 * The wave ramp: the human-flown counterpart to `npm run survivability`, and
 * the answer to "how many can I actually take?".
 *
 * It must RAMP and then SATURATE, never diverge. A ramp that keeps going turns
 * the answer into a number about arithmetic — wave 40 is 40 Fer-de-Lances and
 * nobody learns anything from that — where a ramp that stops means the late
 * waves are all the same fight and surviving three of them is a fact about
 * flying. Both properties are asserted in `npm test`.
 *
 *   wave   1  2  3  4  5  6  7  8  9 10 11 12+
 *   count  1  1  2  2  3  3  4  4  5  5  6  6
 *   tier   0  0  0  1  1  1  2  2  2  2  2  2
 *
 * Organised from wave 7, when the tier tops out and there are enough of them to
 * bother forming a gang — the same rule `pirateThreat` uses.
 */
export const WAVE_MAX_COUNT = 6;
const WAVE_COUNT_EVERY = 2;
const WAVE_TIER_EVERY = 3;

/** From this wave on, every wave is identical. Quoted in the report. */
export const WAVE_SATURATION = Math.max(
  (WAVE_MAX_COUNT - 1) * WAVE_COUNT_EVERY, MAX_TIER * WAVE_TIER_EVERY) + 1;

export function waveCount(n: number): number {
  return Math.min(WAVE_MAX_COUNT, 1 + Math.floor(Math.max(0, n - 1) / WAVE_COUNT_EVERY));
}

export function waveTier(n: number): number {
  return Math.min(MAX_TIER, Math.floor(Math.max(0, n - 1) / WAVE_TIER_EVERY));
}

/** Wave `n`, 1-based. */
export function waveOpposition(n: number, seed = 0): Opposition[] {
  const count = waveCount(n);
  const tier = waveTier(n);
  const organised = tier >= MAX_TIER && count >= 3;
  return [{
    role: 'pirate',
    count,
    tier,
    organised,
    brain: liveBrainFor('pirate', organised, tier),
    mixed: organised,
    seed,
  }];
}

// --- the three modes --------------------------------------------------------

export type SimMode = 'scenario' | 'sparring' | 'waves';

/**
 * What a mode IS, as properties rather than branches.
 *
 * The differences between the three are small and all of them are facts about
 * the mode: does another round follow, is the round on a clock, does the player
 * get patched up in between, and what a record covers. Stated here, the session
 * has no mode switch in it at all.
 */
export interface ModeRules {
  /** rounds keep coming until the player quits or dies */
  endless: boolean;
  /** the round ends on a timeout as well as on a wipeout */
  timed: boolean;
  /**
   * Player hull, shields, energy and ordnance restored between rounds.
   *
   * Sparring: yes — it is for learning what a hull does, and attrition just
   * ends the lesson early. Waves: no — attrition IS the question, and a wave
   * count you reach with a fresh ship each time measures nothing.
   */
  restoreBetweenRounds: boolean;
  /** what the exercise is scored on */
  score: 'outcome' | 'kills' | 'waves';
  /** a record is exported per… */
  record: 'exercise' | 'kill' | 'wave';
}

export const MODES: Record<SimMode, ModeRules> = {
  scenario: {
    endless: false, timed: true, restoreBetweenRounds: false,
    score: 'outcome', record: 'exercise',
  },
  sparring: {
    endless: true, timed: false, restoreBetweenRounds: true,
    score: 'kills', record: 'kill',
  },
  waves: {
    endless: true, timed: false, restoreBetweenRounds: false,
    score: 'waves', record: 'wave',
  },
};

/** A fight that has gone this long is a stalemate, not a fight. */
export const SCENARIO_TIMEOUT = 120;

/** Everything the picker chose. Goes into the report verbatim. */
export interface ExerciseSpec {
  mode: SimMode;
  /** which fight; sparring takes its lone opponent from it too */
  scenario: ScenarioId;
  /** the picked threat tier, for the scenarios that take one */
  tier: number;
  /** the exercise seed — quoted in the report, and enough to rebuild the fight */
  seed: number;
  /** scenario mode only; defaults to SCENARIO_TIMEOUT */
  timeoutSeconds?: number;
  /** the custom picker's opposition; wins over the scenario table */
  custom?: readonly Opposition[];
  /** A/B override: everyone flies this brain, whatever the table says */
  brain?: BrainId;
}

/**
 * The facts the rules need about a running exercise.
 *
 * Plain readonly data on purpose — no callbacks, nothing Game-shaped. The
 * session holds these fields and hands itself to the two functions below; the
 * rules never reach back.
 */
export interface ExerciseSession {
  readonly spec: ExerciseSpec;
  /** 0-based index of the round in progress */
  readonly round: number;
  /** opponents spawned for this round; 0 means it has not been built yet */
  readonly spawned: number;
  /** opponents still alive */
  readonly alive: number;
  /** seconds this round has been running */
  readonly roundElapsed: number;
  readonly playerAlive: boolean;
  /** the player asked to leave */
  readonly quitting?: boolean;
  /** required by the as-they-come scenario, ignored by the rest */
  readonly threat?: ThreatContext;
}

/** Seconds before a round is called off, or 0 for untimed. */
export function exerciseTimeout(spec: ExerciseSpec): number {
  return MODES[spec.mode].timed ? (spec.timeoutSeconds ?? SCENARIO_TIMEOUT) : 0;
}

/** Rounds within one exercise get their own seed, so a hull can change. */
export function roundSeed(seed: number, round: number): number {
  return (seed + round * 1013) | 0;
}

/** The opposition a scenario means, given the picked tier and a seed. */
export function scenarioOpposition(
  spec: ExerciseSpec, seed: number, threat?: ThreatContext, rng: () => number = random,
): Opposition[] {
  const scenario = scenarioById(spec.scenario);
  if (!scenario.groups) {
    if (!threat) throw new Error('as-they-come needs a ThreatContext');
    return asTheyCome(threat, seed, rng);
  }
  return scenario.groups.map((t, i) => resolve(t, spec.tier, seed + i * 101));
}

/**
 * Sparring's single opponent: the chosen fight, reduced to one ship.
 *
 * Alone, so not organised — a pack policy with no pack to observe is a
 * degenerate thing to learn a hull against, and the brain falls back to the
 * solo one it would fly if it had turned up on its own.
 *
 * The HULL is pinned, and that is the mode's whole point: sparring is for
 * learning what a Fer-de-Lance does differently from a Sidewinder, so rotating
 * the hull every round would teach you nothing about either. The round's fresh
 * seed goes to the spawn instead, so the fight starts differently each time
 * against the same ship.
 */
function loneOpponent(list: readonly Opposition[], seed: number): Opposition[] {
  const first = list[0];
  const organised = false;
  const solo: Opposition = {
    ...first,
    count: 1,
    mixed: false,
    organised,
    brain: first.brain === SHIPPED_PACK_BRAIN
      ? liveBrainFor(first.role, organised, first.tier) : first.brain,
  };
  // resolved against the EXERCISE seed, which is why it does not move
  return [{ ...solo, hull: solo.hull ?? oppositionShips(solo)[0].spec, seed }];
}

/**
 * Who to spawn for the coming round, or null when the exercise has no more
 * rounds in it.
 *
 * The three modes, and they are three lines: a scenario is one round, sparring
 * is the same opponent again on a fresh seed, waves is the ramp.
 */
export function nextOpposition(
  s: ExerciseSession, rng: () => number = random,
): Opposition[] | null {
  const { spec } = s;
  const seed = roundSeed(spec.seed, s.round);
  const chosen = (base: number): Opposition[] => (spec.custom
    ? spec.custom.map((o, i) => ({ ...o, seed: base + i * 101 }))
    : scenarioOpposition(spec, base, s.threat, rng));

  let list: Opposition[];
  switch (spec.mode) {
    case 'scenario':
      if (s.round > 0) return null;
      list = chosen(seed);
      break;
    case 'sparring':
      // resolved from the exercise seed so the opponent is the same one each
      // round; the round seed is what varies, and it varies the spawn
      list = loneOpponent(chosen(spec.seed), seed);
      break;
    case 'waves':
      list = waveOpposition(s.round + 1, seed);
      break;
  }
  // The A/B override is the last word: fly the same fight against two brains
  // and the report answers which one is more fun, which is the question
  // CLAUDE.md says the numbers cannot.
  return spec.brain ? list.map((o) => ({ ...o, brain: spec.brain! })) : list;
}

export type RoundOutcome = 'running' | 'roundOver' | 'over';

/**
 * Where the exercise has got to.
 *
 * `roundOver` means ask `nextOpposition` again; `over` means tear down. Death
 * and quitting end every mode; a cleared round ends only a scenario, because
 * the other two are endless by definition.
 */
export function roundOutcome(s: ExerciseSession): RoundOutcome {
  if (!s.playerAlive || s.quitting) return 'over';
  // Nothing spawned yet: the round is about to be built, not finished.
  if (s.spawned === 0) return 'running';
  if (s.alive > 0) {
    const limit = exerciseTimeout(s.spec);
    return limit > 0 && s.roundElapsed >= limit ? 'over' : 'running';
  }
  return MODES[s.spec.mode].endless ? 'roundOver' : 'over';
}
