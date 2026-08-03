// What the combat trainer sends at you, and when it stops sending it.
//
// The rules half of the training simulator (docs/COMBAT-SIM.md). Two questions
// live here and nothing else does:
//
//   1. WHO you fight — the seven scenarios, as a table rather than seven code
//      paths, plus the wave ramp (which ramps twice: the numbers, and then the
//      fight) and the live "as they come" reception.
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
  type BrainName, type BrainSelection,
} from './brain-names.ts';
import { hasShipDef, shipDisplayName } from '../ships/registry.ts';
// The SHAPE of the record is combat-sim-report.ts's, as `OpeningGeometry` is —
// this module fills one in and nothing here reads one back. A type, so there is
// no runtime edge and no cycle.
import type { WaveEscalation } from './combat-sim-report.ts';
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
 * The union itself is `brain-names.ts`'s `BrainName` — every policy the game
 * loads, plus the scripted AI — because the character lines have to cover
 * exactly the same list and a second copy of it would drift. It used to be one
 * name WIDER than that (`pirate-attack-g1`, offered and then refused on the
 * record); TODO 57 deleted the weights and with them the reason for the gap.
 */
export type BrainId = BrainName;

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
 * Every brain the picker may choose, in the order it should be listed: the three
 * the game ships, and then the control.
 *
 * It was eleven, and seven of those were experiments the game loaded and did not
 * fly. `scripted` is the one entry here that is not a shipped policy and it is
 * not a rival to one either — it is the pre-neuroevolution AI, i.e. what the
 * game did BEFORE any of this, which is the comparison every training run in
 * docs/TRAINING-LOG.md is measured against. A future candidate joins this list
 * by having its weights put back and its name added, which is one row.
 *
 * There is no candidate today. `pirate-attack-e1` was one, restored to be
 * compared against the shipped solo policy, and TODO 61 deleted it: the job it
 * was a candidate for stopped existing when `d563e3d` made the scripted attack
 * run what ships for solo pirates and gangs alike. The rule it left behind is
 * BOTH PICKERS OR NEITHER — adding it to the career row and not here was a real
 * bug for the two commits it lasted, because the two pickers are separate lists
 * and the candidate could then only be flown from the fenced row that changes
 * the whole career, which is the one thing a scoped A/B must not touch.
 */
export const SIM_BRAINS: readonly BrainId[] = [
  // NAMED, not derived from what ships — and that is the correction rather than
  // a style choice. This list used to be built from `SHIPPED_SOLO_BRAIN` and
  // `SHIPPED_PACK_BRAIN`, on the reasoning that promoting a candidate should
  // move the picker without an edit here. It does the opposite when the thing
  // promoted is `scripted`: both constants resolve to the same word, the list
  // collapses to two entries, and the trained policies disappear from the only
  // surface that can fly them. "We changed the default" silently became "we
  // deleted the alternative", which is the one outcome a comparison tool must
  // never produce. A policy is offered here because it EXISTS, and
  // `SHIPPED_*_BRAIN` still says which of them the game currently flies.
  'pirate-attack-g3',
  'pirate-pack-r4-selectonly',
  'jameson-defend-g1',
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
  /**
   * Fit FLOORS: at least this much, whatever the hull carries.
   *
   * A second pair rather than a reading of the pair above, because they are
   * different claims and the picker needs the first one. `missiles: 0` from the
   * custom picker means an unarmed ship and has to win over a hull that carries
   * two; the wave ramp's "everyone is carrying a missile now" must NOT take the
   * Python's second one away. One field cannot mean both.
   */
  minMissiles?: number;
  minEcm?: number;
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

/**
 * Apply the group's fit to a hull without touching the roster's own entry.
 *
 * The override is applied first and the floor second, which is the only order
 * that lets both mean what they say: a picker asking for no missiles gets none,
 * and a wave arming everybody cannot disarm the hull that already had two.
 */
function fitted(spec: NpcSpec, o: Opposition): NpcSpec {
  const missiles = Math.max(o.missiles ?? spec.missiles ?? 0, o.minMissiles ?? 0);
  const ecm = Math.max(o.ecm ?? spec.ecmChance ?? 0, o.minEcm ?? 0);
  if (missiles === (spec.missiles ?? 0) && ecm === (spec.ecmChance ?? 0)) return spec;
  return { ...spec, missiles, ecmChance: ecm };
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
 * THE NUMBERS RAMP FIRST, and this half is unchanged:
 *
 *   wave   1  2  3  4  5  6  7  8  9 10 11 12+
 *   count  1  1  2  2  3  3  4  4  5  5  6  6
 *   tier   0  0  0  1  1  1  2  2  2  2  2  2
 *
 * Organised from wave 7, when the tier tops out and there are enough of them to
 * bother forming a gang — the same rule `pirateThreat` uses.
 *
 * From wave 12 the numbers stop and the FIGHT keeps going: `WAVE_STEPS` below.
 */
export const WAVE_MAX_COUNT = 6;
const WAVE_COUNT_EVERY = 2;
const WAVE_TIER_EVERY = 3;

/**
 * From this wave on, count and tier stop growing — six of them, all at the top
 * tier, in a gang. It is NOT where the ramp stops any more; see
 * `WAVE_SATURATION`.
 */
export const WAVE_COUNT_SATURATION = Math.max(
  (WAVE_MAX_COUNT - 1) * WAVE_COUNT_EVERY, MAX_TIER * WAVE_TIER_EVERY) + 1;

export function waveCount(n: number): number {
  return Math.min(WAVE_MAX_COUNT, 1 + Math.floor(Math.max(0, n - 1) / WAVE_COUNT_EVERY));
}

export function waveTier(n: number): number {
  return Math.min(MAX_TIER, Math.floor(Math.max(0, n - 1) / WAVE_TIER_EVERY));
}

// --- what a wave adds once the numbers have stopped -------------------------
//
// Wave 11 is six professionals in a gang, and until TODO 39 so was wave 40. The
// argument for stopping the COUNT is still right — a ramp that keeps adding
// ships makes the score a fact about arithmetic — but "harder" and "bigger" are
// not the same axis, and only the second one had a ceiling on it.
//
// So past wave 11 the wave stops growing and starts CHANGING. Each step below is
// one stated thing, it is a pure function of the wave number, and it is chosen
// against the standard CLAUDE.md sets for the AI: it has to make the pilot fly
// better, not make the fight longer. A wave that is harder because it is more
// annoying is a failure, and two candidates were dropped on exactly that test —
// see the note under `WAVE_STEPS`.

/** Ships in a wave that are not pirates, taking a pirate's place in the count. */
export interface WaveEscort {
  role: OppositionRole;
  count: number;
  tier: number;
}

/**
 * One stated step of the escalation, stated as what it ADDS.
 *
 * Deltas rather than a full description per stage, because a table that
 * restated "everyone carries a missile" on three rows is a table that will
 * eventually disagree with itself. `waveFit` folds them; `waveEscort`
 * concatenates them.
 */
export interface WaveStep {
  /** what the banner, the strip and the record call it */
  name: string;
  /** why this step, and why here — quoted on the record */
  why: string;
  /** from here on every ship in the wave carries at least this many missiles */
  missiles?: number;
  /** ...and carries E.C.M. with at least this chance (1 is certainly) */
  ecm?: number;
  /** ships that join, and take a pirate's place rather than adding to the count */
  joined?: readonly WaveEscort[];
}

/** One new thing every this many waves — the count ramp's own cadence. */
export const WAVE_STEP_EVERY = 2;

/**
 * The four steps, in order. Each is argued at its own entry.
 *
 * DROPPED, and why, because the list of what is not here is the more useful
 * half:
 *
 *   * A HARDER RELEASED BUILD of the same hull — the first axis TODO 39 asked
 *     for, and it is already spent. `role-variants.ts` picks the hardest build
 *     the source ever filed as a pirate, so every pirate in the game is already
 *     flying it: the Sidewinder is `V:17` and not `D:17`, the Krait is `W:19`.
 *     There is nothing above it to escalate TO without either flying a build the
 *     source never filed as a pirate or inventing a number, and the second is
 *     forbidden by the fidelity contract. The axis is real; TODO 29 spent it.
 *   * MORE SHIPS, or a ship the count ramp would not have sent. That is the
 *     ceiling this deliberately does not raise.
 *   * A TIGHTER OPENING — starting the late waves inside their gun. It reads as
 *     being cheated rather than as being outclassed, and it would silently
 *     change what the attack-run count MEANS (combat-sim-opening.ts).
 */
export const WAVE_STEPS: readonly WaveStep[] = [
  {
    name: 'MISSILES',
    why: 'the numbers have topped out, so the wave brings ordnance instead. A '
      + 'missile is the one weapon that makes a pilot fly rather than shoot — '
      + 'break the lock, spend the E.C.M., or take the warhead — and it ends a '
      + 'fight sooner rather than dragging one out.',
    // A FLOOR, not a rack size: the tier-2 hulls that already carry two keep
    // two. This arms the Sidewinders and the Geckos that never carried any.
    missiles: 1,
  },
  {
    name: 'E.C.M.',
    why: 'now they can swat yours. Not a wall: an E.C.M. defeats a missile at '
      + '45% a second inside 2,800 units, so one fired close still arrives — the '
      + 'answer is to fire late, not to stop firing.',
    ecm: 1,
  },
  {
    name: 'A BOUNTY HUNTER',
    why: 'one of them is not a pirate. It flies a hunter-grade released build '
      + 'off a different roster, it is not in the gang and it does not weave '
      + 'with them — a second kind of ship to read, for the same number of ships.',
    joined: [{ role: 'hunter', count: 1, tier: 1 }],
  },
  {
    name: 'THARGOIDS',
    why: 'two of the pirates stand down and something else takes their place. '
      + 'The Thargoid is the toughest hull in the game and its Thargon goes '
      + 'INERT the moment the mothership dies, so the last wave is a fight with '
      + 'a priority target in it rather than a bigger crowd.',
    joined: [
      { role: 'thargoid', count: 1, tier: MAX_TIER },
      { role: 'thargon', count: 1, tier: 0 },
    ],
  },
];

/**
 * From this wave on, every wave is identical — the whole wave, not just its
 * arithmetic. Quoted on the record and on the strip.
 *
 * DERIVED from the two things that decide it: four stated steps, two waves
 * apart. Two waves is the count ramp's own cadence and it is the point of the
 * spacing — you meet a new thing, and then you meet it again knowing it is
 * coming, which is the difference between learning it and being surprised by it
 * twice. Past the fourth step there is nothing left to add that is not simply
 * more ships, and more ships is the axis this ramp exists to have stopped.
 */
export const WAVE_SATURATION = waveOfStage(WAVE_STEPS.length);

/** The wave a given step arrives at — the inverse of `waveStage`. */
export function waveOfStage(stage: number): number {
  return WAVE_COUNT_SATURATION + (Math.max(1, stage) - 1) * WAVE_STEP_EVERY + 1;
}

/** How many of the steps wave `n` has taken: 0 while only the numbers ramp. */
export function waveStage(n: number): number {
  return Math.max(0, Math.min(WAVE_STEPS.length,
    Math.ceil((n - WAVE_COUNT_SATURATION) / WAVE_STEP_EVERY)));
}

/** The fit every ship in wave `n` carries at least. Cumulative over the steps. */
function waveFit(stage: number): { minMissiles?: number; minEcm?: number } {
  const taken = WAVE_STEPS.slice(0, stage);
  const minMissiles = taken.reduce((m, s) => Math.max(m, s.missiles ?? 0), 0);
  const minEcm = taken.reduce((m, s) => Math.max(m, s.ecm ?? 0), 0);
  return {
    ...(minMissiles > 0 ? { minMissiles } : {}),
    ...(minEcm > 0 ? { minEcm } : {}),
  };
}

/** Who has joined the wave by stage `stage`, in the order they arrived. */
function waveEscort(stage: number): WaveEscort[] {
  return WAVE_STEPS.slice(0, stage).flatMap((s) => s.joined ?? []);
}

/**
 * What wave `n` has that wave `n - 1` did not, for the banner and the record.
 *
 * Pure in `n`, like everything else here, so the line the pilot reads at the
 * start of a wave is the line the record carries at the end of it.
 */
export function waveEscalation(n: number): WaveEscalation {
  const stage = waveStage(n);
  const added = stage > 0 && waveStage(n - 1) < stage ? WAVE_STEPS[stage - 1] : null;
  return {
    wave: n,
    stage,
    active: WAVE_STEPS.slice(0, stage).map((s) => s.name),
    added: added?.name ?? null,
    why: added?.why
      ?? (stage === 0
        ? 'the count and the tier are still climbing — see the table in '
          + 'combat-sim-scenarios.ts.'
        : 'nothing new this wave: fly the one before it again, knowing what is '
          + 'in it.'),
    saturatesAt: WAVE_SATURATION,
  };
}

/**
 * Wave `n`, 1-based.
 *
 * Waves 1 to `WAVE_COUNT_SATURATION` are exactly what they always were — the
 * escort is empty and the fit floors are absent, so the group this returns is
 * the same object it returned before the steps existed.
 */
export function waveOpposition(n: number, seed = 0): Opposition[] {
  const count = waveCount(n);
  const tier = waveTier(n);
  const fit = waveFit(waveStage(n));
  const escort = waveEscort(waveStage(n));
  // The escort takes a pirate's PLACE. `waveCount` is the whole wave, and the
  // floor of 1 is belt and braces: the steps only start once the count has
  // saturated at six, so the escort can never be more than half of it.
  const pirates = Math.max(1, count - escort.reduce((k, e) => k + e.count, 0));
  const organised = tier >= MAX_TIER && pirates >= 3;
  return [
    {
      role: 'pirate',
      count: pirates,
      tier,
      organised,
      brain: liveBrainFor('pirate', organised, tier),
      mixed: organised,
      seed,
      ...fit,
    },
    // Each on its own seed, the same 101 stride `resolve()` gives a table's
    // groups, so the hunter and the Thargon do not draw the pirates' hull.
    ...escort.map((e, i) => ({
      role: e.role,
      count: e.count,
      tier: e.tier,
      // Not in the gang: a hunter came for you on its own account, and a
      // Thargoid does not fly a pirate's pack policy.
      organised: false,
      brain: liveBrainFor(e.role, false, e.tier),
      mixed: false,
      seed: seed + (i + 1) * 101,
      ...fit,
    })),
  ];
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
