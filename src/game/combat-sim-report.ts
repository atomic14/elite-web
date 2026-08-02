// What happened in a training fight, and what it means.
//
// This is the measurement half of the combat simulator (docs/COMBAT-SIM.md):
// something else runs the exercise, this counts it. It absorbs the two console
// harnesses that used to do the counting —
//
//   test/combat-recorder.js  a fight a HUMAN flew: accuracy both ways, damage
//                            by cause, and the geometry that decides whether an
//                            NPC can shoot at all
//   test/arena.js            envelope(): how the commander actually flies,
//                            which is the one human-shaped input the trainer
//                            has. ai-training/scenario.ts's playerCobra and
//                            playerCobraSlow target hulls are fitted to it, so
//                            losing it would cost the trainer that fit
//
// — and it exists as a module rather than as a paste because a harness that is
// monkey-patched onto three Game methods can only measure what the patches
// still line up with, and twice they stopped: the five step phases moved off
// the Game onto WorldStep and every hit silently became `unknown`.
//
// It is PURE, and that is the point of it. No DOM, no globals at module scope,
// no clock of its own — it is fed samples and events, and it derives. So the
// same maths can be asserted in test/run.ts against arrays built by hand, which
// is the only way to know that a median is a median.
//
// One rule, one home, twice over:
//   * "lined up" is `NPC_FIRE_GATE` and the range cut-offs are `NPC_LASER_RANGE`
//     (npc.ts, their gun) and `LASER_RANGE` (gunnery.ts, yours).
//     combat-recorder.js wrote 14.3 degrees and 3500 out by hand, so a balance
//     change to either moved the game and left the measurement behind.
//   * the JSON is VERSIONED (`schema`), as snapshot.ts's SNAPSHOT_VERSION is.
//     A trainer reading the exported records is an external consumer, and the
//     first shape change would otherwise break it in silence.

import * as THREE from 'three';
import { LASER_RANGE, NPC_FIRE_GATE, NPC_LASER_RANGE } from './gunnery.ts';
import type { DamageSource } from './combat.ts';
import type {
  NpcCombatProfileId, PlayerHullId, ShipDesignId,
} from './ship-identity.ts';

/**
 * The shape of an exported record. Bump it when a field changes meaning or
 * leaves, not when one is added — a reader that ignores unknown keys survives
 * additions, which is why SNAPSHOT_VERSION is still 1.
 */
export const COMBAT_SIM_SCHEMA = 1;

/**
 * How often geometry is sampled, in Hz. Every duration this module reports is
 * derived from a count of samples, so this is also the resolution of
 * `engagedSeconds` and the on-six times.
 *
 * 10 was combat-recorder.js's rate and it stays: a fight is decided over
 * seconds, the game steps at 60, and sampling every ship's range and bearing at
 * 60 Hz for a twenty-minute sparring session is a lot of arithmetic for two
 * decimal places nobody reads.
 */
export const SAMPLE_HZ = 10;

/**
 * The rear cone that counts as somebody's six, as a half-angle from directly
 * astern.
 *
 * This one is the measurement's own number rather than a rule read from the
 * game, because the game has no notion of a six — it has a firing gate and aft
 * shields. 60 degrees is the arc a tailing ship holds; wider and "on your six"
 * would start including a ship off your beam, which is a different problem for
 * the pilot.
 */
export const SIX_CONE = Math.PI / 3;

/** How many exercise records the in-memory ring keeps. */
export const SIM_LOG_LIMIT = 20;

/**
 * Samples kept before the buffer closes.
 *
 * Sparring and waves are endless by design, so the buffer is bounded — and it
 * STOPS rather than dropping the oldest sample, because a median over a sliding
 * tail of a fight is a median of the end of the fight while claiming to be a
 * median of the fight. When it fills, the report says so.
 */
export const MAX_SAMPLES = 12_000;

/** Float slack on the sampling cadence. See `tick()`. */
const CADENCE_EPSILON = 1e-9;

/** Which of the three modes produced this record. */
export type SimMode = 'scenario' | 'sparring' | 'waves';

/** How the exercise ended. */
export type SimOutcome =
  /** every opponent destroyed */
  | 'cleared'
  /** the commander's hull failed — in the simulator, so it costs nothing */
  | 'destroyed'
  /** the pilot ended it */
  | 'quit'
  /** the exercise ran out of time */
  | 'timeout';

/** Where the source of a hit could not be named. See `taken()`. */
const UNKNOWN = 'unknown';
type SourceKey = DamageSource | typeof UNKNOWN;
const SOURCES: readonly DamageSource[] = ['laser', 'missile', 'ram', 'station', 'cargo'];

/** Damage from one cause, and how many times it landed. */
export interface SourceTally {
  damage: number;
  count: number;
}

/** A statistic that exists for both sides of the fight. */
export interface BothSides {
  you: number;
  them: number;
}

// --- what the caller feeds in ------------------------------------------------

/**
 * One hostile, at one sample instant.
 *
 * Both bearings, because half the statistics in the report are symmetric and
 * the recorder only ever took theirs. `aimAngle()` below computes either.
 */
export interface ContactSample {
  /** index into `ExerciseSetup.opponents` */
  opponent: number;
  dist: number;
  /** radians off THEIR nose to you — the angle `NPC_FIRE_GATE` gates their gun on */
  theirAim: number;
  /** radians off YOUR nose to them */
  yourAim: number;
}

/** The commander, and everything hostile, at one sample instant. */
export interface FrameSample {
  speed: number;
  /** pitch rate in use; the sign is not interesting, the magnitude is */
  pitch: number;
  roll: number;
  foreShield: number;
  aftShield: number;
  energy: number;
  contacts: ContactSample[];
}

/** One opponent, as the exercise was set up. */
export interface OpponentSetup {
  /** the hull's display name, from ship-specs.ts */
  hull: string;
  /**
   * What it was, in ids — see ship-identity.ts.
   *
   * The display name is for a human reading the record; these are for a record
   * read by something else. "Moray" is a name two projects spell differently
   * and a later TODO may re-hull entirely; `elite-a:variant:A:25` is the exact
   * released build the fight was against, and stays true.
   */
  designId: ShipDesignId;
  profileId: NpcCombatProfileId;
  /**
   * Which policy it flies — a brain id, or the scripted baseline. This is the
   * field that turns the report into an A/B rig: the same scenario against
   * `pirate-attack-r2` and against `e1`, and the numbers side by side.
   */
  brain: string;
  role?: string;
  tier?: number;
}

/**
 * What the commander flew.
 *
 * Description, not simulation: the report carries it through to the JSON so a
 * record can be read months later without guessing what "you" had fitted. The
 * hull is RECORDED but not overridden — v1 of the simulator changes the fit-out
 * only (docs/COMBAT-SIM.md), because the player's hull is four constants in
 * player.ts and every pirate brain was fitted against them.
 */
export interface PlayerLoadout {
  /**
   * Which hull the commander flew, as a `PlayerHullId`.
   *
   * Description, like everything else here: the exercise does not change your
   * hull, and this phase does not fly its stats. It is recorded because a
   * report compared across a shipyard's arrival is worthless without it.
   */
  shipId: PlayerHullId;
  /** the front mount: 'pulse' | 'beam' | 'military' */
  laser: string;
  rearLaser?: boolean;
  missiles: number;
  ecm: boolean;
  energyUnit: boolean;
  energyBomb: boolean;
  /** whatever else the fit-out screen grows */
  extra?: Record<string, string | number | boolean>;
}

/** Everything fixed about an exercise before it starts. */
export interface ExerciseSetup {
  /** the seed the exercise ran on, so the same fight can be flown again */
  seed: number;
  scenario: string;
  mode: SimMode;
  player: PlayerLoadout;
  opponents: OpponentSetup[];
  /** which wave this record covers, in the waves mode */
  wave?: number;
  /** override the sampling rate; every derived duration follows it */
  sampleHz?: number;
}

// --- what comes out ---------------------------------------------------------

export interface SimEvent {
  t: number;
  what: string;
  opponent?: number;
}

export interface OpponentReport {
  index: number;
  hull: string;
  /** what it was, in ids — carried through from the setup, see OpponentSetup */
  designId: ShipDesignId;
  profileId: NpcCombatProfileId;
  brain: string;
  role?: string;
  tier?: number;
  /** seconds it lasted — until it died, or the whole exercise if it did not */
  livedSeconds: number;
  destroyed: boolean;
  killedByYou: boolean;
  /** what it landed: laser shots, hits, and every point of damage it did */
  shots: number;
  hits: number;
  missiles: number;
  damageToYou: number;
  /**
   * ...in SOURCE ENERGY POINTS since TODO 26 — and `damageToYou` above is in
   * the commander's 255-point pool points since TODO 27, so both sides are now
   * whole source-scale numbers. They are still not the same UNIT (a ship's bank
   * is 32-253 points, a commander's is 255 plus two shields), so a ratio of the
   * two is meaningless; each is comparable with itself across fights.
   */
  damageFromYou: number;
  /** the median range it held, and the nearest it ever got */
  medianRange: number | null;
  closestRange: number | null;
  /** share of ITS sampled frames spent lined up on you, inside its own range */
  linedUpShare: number | null;
}

/**
 * How the commander flies — arena.js's `envelope()`, unchanged in meaning.
 *
 * Read it beside `traderCobra` in ai-training/scenario.ts (220 speed, 0.70
 * pitch, 1.20 roll): the gap between that freighter and these numbers is why
 * pirates weave instead of shooting (docs/TRAINING-LOG.md run 10).
 */
export interface EnvelopeReport {
  samples: number;
  speed: { median: number; p90: number; max: number } | null;
  pitchRate: { median: number; p90: number } | null;
  rollRate: { median: number; p90: number } | null;
  /**
   * Range to the NEAREST hostile, per sampled frame — which is not `range`
   * below. This one answers "what range does this pilot fight at", so a frame
   * counts once however many ships are in it.
   */
  engagementRange: { median: number; p10: number; p90: number } | null;
}

export interface CombatSimReport {
  schema: number;
  seed: number;
  scenario: string;
  mode: SimMode;
  wave?: number;
  outcome: SimOutcome;
  seconds: number;
  /** seconds with at least one hostile in the sky */
  engagedSeconds: number;
  player: PlayerLoadout;
  you: {
    shots: number;
    hits: number;
    /** hits / shots, or null when the trigger was never pulled */
    accuracy: number | null;
    damageDealt: number;
    damageBySource: Partial<Record<SourceKey, SourceTally>>;
    kills: number;
  };
  them: {
    /** laser shots only — a missile launch is not a shot that could have missed */
    shots: number;
    missiles: number;
    hits: number;
    accuracy: number | null;
    damageToYou: number;
    damageBySource: Partial<Record<SourceKey, SourceTally>>;
    /** the figure docs/TRAINING-LOG.md quotes: shots per minute per ship */
    shotsPerMinutePerShip: number | null;
  };
  kills: {
    /** credited to you */
    yours: number;
    /** opponents that left the sky by any means */
    total: number;
    /** seconds to your first and last kill */
    firstAt: number | null;
    lastAt: number | null;
  };
  /**
   * Engagement range over every ship in every sampled frame — so a fight
   * against three ships contributes three ranges a frame. MEDIAN, where
   * combat-recorder.js reported a mean: one ship breaking off to 8000 while two
   * knife-fight at 400 drags the mean out to a range nobody was at.
   */
  range: { median: number | null; closest: number | null };
  /** share of ship-frames each side spent lined up on the other, and in range */
  linedUpShare: BothSides;
  inRangeShare: BothSides;
  /** mean bearing error in DEGREES — a mean on purpose: it is an average error */
  meanAimErrorDeg: BothSides;
  /**
   * Seconds spent on the other's six. Per FRAME, not per ship-frame: two
   * pirates on your tail at once is one bad second, not two.
   */
  onSixSeconds: BothSides;
  /** the worst it got */
  lowWater: {
    foreShield: number | null;
    aftShield: number | null;
    energy: number | null;
  };
  opponents: OpponentReport[];
  envelope: EnvelopeReport;
  events: SimEvent[];
  /**
   * Anything the report knows it does not know. A harness that admits it has
   * stopped understanding beats one that is confidently wrong — which is why
   * combat-recorder.js keeps an `unknown` damage bucket at all.
   */
  warnings: string[];
}

// --- geometry ---------------------------------------------------------------

const tmpForward = new THREE.Vector3();
const tmpTo = new THREE.Vector3();

/**
 * The angle between a ship's nose and the direction to a point, in radians.
 *
 * `NpcShip.facing()` is the same rule serving the NPC's own gate; this one takes
 * loose arguments so the measurement can also be taken from the cockpit, which
 * has no `facing()`. Forward is −Z (ARCHITECTURE.md), and the scratch vectors
 * are module-scope so sampling four ships at 10 Hz allocates nothing.
 */
export function aimAngle(
  from: THREE.Vector3, quat: THREE.Quaternion, to: THREE.Vector3,
): number {
  tmpForward.set(0, 0, -1).applyQuaternion(quat);
  tmpTo.copy(to).sub(from);
  if (tmpTo.lengthSq() === 0) return 0;
  return tmpForward.angleTo(tmpTo.normalize());
}

// --- statistics -------------------------------------------------------------

/**
 * The p-quantile of a set of samples, by arena.js's definition — sort, and
 * index at `floor(n * p)` clamped to the last element. Not interpolated: with
 * hundreds of samples the difference is below the rounding, and an exact element
 * is a number the pilot actually flew.
 *
 * Returns null for an empty set rather than 0, because 0 is a speed.
 */
export function quantile(xs: readonly number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

/** Arithmetic mean, or null when there is nothing to average. */
export function mean(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

const round = (x: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};
const roundOrNull = (x: number | null, dp: number): number | null =>
  (x === null ? null : round(x, dp));

// --- the recorder -----------------------------------------------------------

interface OppTally {
  shots: number;
  hits: number;
  missiles: number;
  damageToYou: number;
  damageFromYou: number;
  dists: number[];
  linedUp: number;
  frames: number;
  diedAt: number | null;
  killedByYou: boolean;
}

const newTally = (): OppTally => ({
  shots: 0, hits: 0, missiles: 0, damageToYou: 0, damageFromYou: 0,
  dists: [], linedUp: 0, frames: 0, diedAt: null, killedByYou: false,
});

/**
 * Accumulates a fight, then derives a report.
 *
 * It holds counters and samples and nothing else — no Game, no World, no
 * opinion about when the exercise ends. Everything it knows, it was told:
 * `tick()` for the clock and the sampling cadence, and one method per thing that
 * can happen.
 */
export class CombatSimRecorder {
  readonly setup: ExerciseSetup;
  private readonly hz: number;
  private readonly tally: OppTally[];
  private readonly samples: FrameSample[] = [];
  private readonly log: SimEvent[] = [];
  private readonly warnings: string[] = [];
  private readonly damageOut = new Map<SourceKey, SourceTally>();
  private readonly damageIn = new Map<SourceKey, SourceTally>();

  private t = 0;
  private accum = 0;
  private playerShots = 0;
  private playerHits = 0;
  private npcShots = 0;
  private npcMissiles = 0;
  private npcHits = 0;
  private killsByYou = 0;
  private deaths = 0;
  private firstKill: number | null = null;
  private lastKill: number | null = null;
  private full = false;

  constructor(setup: ExerciseSetup) {
    this.setup = setup;
    this.hz = setup.sampleHz ?? SAMPLE_HZ;
    this.tally = setup.opponents.map(newTally);
  }

  /** Seconds of exercise so far. */
  get elapsed(): number { return this.t; }

  /** Every sample taken, for a caller that wants the raw log and not the report. */
  get raw(): readonly FrameSample[] { return this.samples; }

  /**
   * Advance the clock by one step, and take a sample if one is due.
   *
   * `probe` is called only when one is, so the caller pays for the geometry at
   * `SAMPLE_HZ` rather than at 60 — which is why the cadence lives here and not
   * in the exercise.
   *
   * Expects `dt` smaller than the sample interval, which `FIXED_DT` is; a
   * caller stepping more slowly than the sample rate gets one sample per tick
   * rather than a burst of identical ones, and durations it derives will be
   * short. Feed `frame()` directly if you want to own the cadence.
   */
  tick(dt: number, probe: () => FrameSample): void {
    this.t += dt;
    this.accum += dt;
    const interval = 1 / this.hz;
    // The tolerance is not decoration: six steps of FIXED_DT sum to
    // 0.09999999999999999, so an exact comparison loses one sample in every ten
    // and `engagedSeconds` comes out 2% short of a clock that agrees with it.
    if (this.accum < interval - CADENCE_EPSILON) return;
    // Subtract the interval rather than zeroing the accumulator. Zeroing is
    // what combat-recorder.js did, and at a 1/60 step it took a sample every
    // SEVEN steps — 8.6 Hz calling itself 10 — because the remainder was
    // thrown away each time. Every duration in this report is derived from a
    // count of samples, so that drift would come out as wrong seconds.
    this.accum -= interval;
    if (this.accum > interval) this.accum = 0;
    this.frame(probe());
  }

  /** Take a sample now, whatever the cadence says. */
  frame(sample: FrameSample): void {
    if (this.full) return;
    if (this.samples.length >= MAX_SAMPLES) {
      this.full = true;
      this.warn(`sample buffer full at ${MAX_SAMPLES} samples `
        + `(${round(MAX_SAMPLES / this.hz, 0)}s) — the distributions and medians `
        + 'cover that much of the exercise and no more');
      return;
    }
    this.samples.push(sample);
    for (const c of sample.contacts) {
      const o = this.tally[c.opponent];
      if (!o) { this.unknownOpponent(c.opponent); continue; }
      o.frames += 1;
      o.dists.push(c.dist);
      if (c.dist < NPC_LASER_RANGE && c.theirAim < NPC_FIRE_GATE) o.linedUp += 1;
    }
  }

  /**
   * One DISCHARGE of the commander's gun, and what it landed — null for a miss.
   *
   * Discharges, not trigger polls: `firePlayerLaser` is called every frame the
   * trigger is held and refuses internally while the laser is hot, so counting
   * calls reported 14 shots a second from a pulse laser that manages 4.2, and
   * turned a 12% hit rate into 3%. The exercise is what knows the difference —
   * a `fired` event came back — so the exercise says.
   */
  playerShot(landed: { opponent: number; damage: number } | null): void {
    this.playerShots += 1;
    if (!landed) return;
    this.playerHits += 1;
    this.dealt(landed.opponent, landed.damage, 'laser');
  }

  /**
   * Damage the commander did, by cause. `playerShot` routes its own through here
   * as `laser`; a missile or a collision comes straight in.
   */
  dealt(opponent: number, amount: number, source: DamageSource): void {
    add(this.damageOut, this.key(source), amount);
    const o = this.tally[opponent];
    if (!o) { this.unknownOpponent(opponent); return; }
    o.damageFromYou += amount;
  }

  /**
   * Damage the commander took, by cause — the cause ASKED, not guessed from the
   * size of the number.
   *
   * combat-recorder.js used to classify by magnitude (0.1-0.221 a laser, 0.45 a
   * ram, 1.3 a missile), which cannot error, only be quietly wrong, and was:
   * `NPC_VS_NPC_DAMAGE` at 0.11 sits inside the laser window, so a ship that
   * rammed the commander read as several perfect shots and the enemy accuracy
   * came out at the hit cap. `DamageSource` is a static fact at each of the five
   * places world-step.ts bills the player, and only the laser counts against
   * their accuracy.
   *
   * @param opponent who did it, when the caller knows — a station or a canister
   * does not have one.
   */
  taken(amount: number, source: DamageSource, opponent?: number): void {
    const key = this.key(source);
    add(this.damageIn, key, amount);
    if (key === 'laser') this.npcHits += 1;
    if (opponent !== undefined) {
      const o = this.tally[opponent];
      if (!o) this.unknownOpponent(opponent);
      else {
        o.damageToYou += amount;
        if (key === 'laser') o.hits += 1;
      }
    }
    if (key === 'ram') this.event('a ship rammed you', opponent);
    if (key === 'missile') this.event('a missile got through', opponent);
  }

  /** An opponent pulled its trigger at you. Lasers and missiles counted apart. */
  npcShot(opponent: number, weapon: 'laser' | 'missile'): void {
    if (weapon === 'missile') this.npcMissiles += 1; else this.npcShots += 1;
    const o = this.tally[opponent];
    if (!o) { this.unknownOpponent(opponent); return; }
    if (weapon === 'missile') {
      o.missiles += 1;
      this.event('missile launched at you', opponent);
    } else o.shots += 1;
  }

  /**
   * An opponent has left the sky. `byPlayer` is whether it was credited to the
   * commander — which in the simulator credits nothing, but is still the
   * difference between a kill and a pirate flying into the station.
   */
  opponentDown(opponent: number, byPlayer: boolean): void {
    const o = this.tally[opponent];
    if (!o) { this.unknownOpponent(opponent); return; }
    if (o.diedAt !== null) return;
    o.diedAt = this.t;
    o.killedByYou = byPlayer;
    this.deaths += 1;
    if (byPlayer) {
      this.killsByYou += 1;
      if (this.firstKill === null) this.firstKill = this.t;
      this.lastKill = this.t;
    }
    const hull = this.setup.opponents[opponent]?.hull ?? `opponent ${opponent}`;
    this.event(byPlayer ? `you destroyed ${hull}` : `${hull} was destroyed`, opponent);
  }

  /** Note something worth reading back, e.g. a wave starting. */
  event(what: string, opponent?: number): void {
    this.log.push({ t: round(this.t, 1), what, ...(opponent === undefined ? {} : { opponent }) });
    if (this.log.length > 200) this.log.shift();
  }

  warn(text: string): void {
    if (!this.warnings.includes(text)) this.warnings.push(text);
  }

  // --- deriving ------------------------------------------------------------

  /** The report. Pure: asking twice gives the same answer. */
  report(outcome: SimOutcome): CombatSimReport {
    const s = this.samples;
    const secs = (n: number) => round(n / this.hz, 1);

    // Two populations, and confusing them is the mistake this file exists to
    // avoid. `rows` is one ship in one frame — the right denominator for "how
    // much of the fight was somebody aimed at me", because two ships aiming is
    // twice the trouble. Frames are wall-clock — the right one for a duration.
    const rows: ContactSample[] = [];
    let engagedFrames = 0;
    let yourSixFrames = 0;
    let theirSixFrames = 0;
    for (const f of s) {
      if (!f.contacts.length) continue;
      engagedFrames += 1;
      let onYours = false;
      let onTheirs = false;
      for (const c of f.contacts) {
        rows.push(c);
        if (theyAreOnYourSix(c)) onYours = true;
        if (youAreOnTheirSix(c)) onTheirs = true;
      }
      if (onYours) yourSixFrames += 1;
      if (onTheirs) theirSixFrames += 1;
    }

    const share = (n: number) => (rows.length ? round(n / rows.length, 3) : 0);
    const dists = rows.map((r) => r.dist);
    const nearest = s.map((f) => f.contacts.reduce(
      (m, c) => Math.min(m, c.dist), Infinity)).filter((d) => d !== Infinity);

    const shipSeconds = rows.length / this.hz;
    return {
      schema: COMBAT_SIM_SCHEMA,
      seed: this.setup.seed,
      scenario: this.setup.scenario,
      mode: this.setup.mode,
      ...(this.setup.wave === undefined ? {} : { wave: this.setup.wave }),
      outcome,
      seconds: round(this.t, 1),
      engagedSeconds: secs(engagedFrames),
      player: this.setup.player,
      you: {
        shots: this.playerShots,
        hits: this.playerHits,
        accuracy: ratio(this.playerHits, this.playerShots),
        damageDealt: round(total(this.damageOut), 2),
        damageBySource: tallies(this.damageOut),
        kills: this.killsByYou,
      },
      them: {
        shots: this.npcShots,
        missiles: this.npcMissiles,
        hits: this.npcHits,
        accuracy: ratio(this.npcHits, this.npcShots),
        damageToYou: round(total(this.damageIn), 2),
        damageBySource: tallies(this.damageIn),
        shotsPerMinutePerShip: shipSeconds
          ? round(this.npcShots / (shipSeconds / 60), 1) : null,
      },
      kills: {
        yours: this.killsByYou,
        total: this.deaths,
        firstAt: roundOrNull(this.firstKill, 1),
        lastAt: roundOrNull(this.lastKill, 1),
      },
      range: {
        median: roundOrNull(quantile(dists, 0.5), 0),
        closest: dists.length ? round(Math.min(...dists), 0) : null,
      },
      linedUpShare: {
        you: share(rows.filter(
          (r) => r.dist < LASER_RANGE && r.yourAim < NPC_FIRE_GATE).length),
        them: share(rows.filter(
          (r) => r.dist < NPC_LASER_RANGE && r.theirAim < NPC_FIRE_GATE).length),
      },
      inRangeShare: {
        you: share(rows.filter((r) => r.dist < LASER_RANGE).length),
        them: share(rows.filter((r) => r.dist < NPC_LASER_RANGE).length),
      },
      meanAimErrorDeg: {
        you: round(deg(mean(rows.map((r) => r.yourAim)) ?? 0), 1),
        them: round(deg(mean(rows.map((r) => r.theirAim)) ?? 0), 1),
      },
      onSixSeconds: { you: secs(theirSixFrames), them: secs(yourSixFrames) },
      lowWater: {
        foreShield: roundOrNull(low(s.map((f) => f.foreShield)), 2),
        aftShield: roundOrNull(low(s.map((f) => f.aftShield)), 2),
        energy: roundOrNull(low(s.map((f) => f.energy)), 2),
      },
      opponents: this.setup.opponents.map((o, i) => this.opponentLine(o, i)),
      envelope: this.envelope(nearest),
      events: [...this.log],
      warnings: [...this.warnings],
    };
  }

  private opponentLine(setup: OpponentSetup, i: number): OpponentReport {
    const o = this.tally[i] ?? newTally();
    return {
      index: i,
      hull: setup.hull,
      designId: setup.designId,
      profileId: setup.profileId,
      brain: setup.brain,
      ...(setup.role === undefined ? {} : { role: setup.role }),
      ...(setup.tier === undefined ? {} : { tier: setup.tier }),
      livedSeconds: round(o.diedAt ?? this.t, 1),
      destroyed: o.diedAt !== null,
      killedByYou: o.killedByYou,
      shots: o.shots,
      hits: o.hits,
      missiles: o.missiles,
      damageToYou: round(o.damageToYou, 2),
      damageFromYou: round(o.damageFromYou, 2),
      medianRange: roundOrNull(quantile(o.dists, 0.5), 0),
      closestRange: o.dists.length ? round(Math.min(...o.dists), 0) : null,
      linedUpShare: o.frames ? round(o.linedUp / o.frames, 3) : null,
    };
  }

  /** arena.js's envelope(): how this pilot flies, for the trainer to fit against. */
  private envelope(nearest: number[]): EnvelopeReport {
    const s = this.samples;
    const speeds = s.map((f) => f.speed);
    const pitch = s.map((f) => Math.abs(f.pitch));
    const roll = s.map((f) => Math.abs(f.roll));
    const band = (xs: number[]) => (xs.length ? {
      median: round(quantile(xs, 0.5) ?? 0, 2),
      p90: round(quantile(xs, 0.9) ?? 0, 2),
    } : null);
    return {
      samples: s.length,
      speed: speeds.length ? {
        median: round(quantile(speeds, 0.5) ?? 0, 0),
        p90: round(quantile(speeds, 0.9) ?? 0, 0),
        max: Math.round(Math.max(...speeds)),
      } : null,
      pitchRate: band(pitch),
      rollRate: band(roll),
      engagementRange: nearest.length ? {
        median: round(quantile(nearest, 0.5) ?? 0, 0),
        p10: round(quantile(nearest, 0.1) ?? 0, 0),
        p90: round(quantile(nearest, 0.9) ?? 0, 0),
      } : null,
    };
  }

  private key(source: DamageSource): SourceKey {
    if (SOURCES.includes(source)) return source;
    this.warn(`a hit arrived with the source '${String(source)}', which `
      + 'DamageSource does not name — the game has grown a new way to hurt you. '
      + 'Do not read damageBySource as complete.');
    return UNKNOWN;
  }

  private unknownOpponent(i: number): void {
    this.warn(`something was attributed to opponent ${i}, which this exercise `
      + 'does not have — the per-opponent lines are incomplete.');
  }
}

/**
 * They are behind you AND pointed at you: you cannot see them and they can
 * shoot. `yourAim` near π means they are astern of your nose.
 */
function theyAreOnYourSix(c: ContactSample): boolean {
  return c.dist < NPC_LASER_RANGE
    && c.yourAim > Math.PI - SIX_CONE
    && c.theirAim < NPC_FIRE_GATE;
}

/** The mirror: you are astern of them, and lined up. */
function youAreOnTheirSix(c: ContactSample): boolean {
  return c.dist < LASER_RANGE
    && c.theirAim > Math.PI - SIX_CONE
    && c.yourAim < NPC_FIRE_GATE;
}

const deg = (rad: number): number => rad * 180 / Math.PI;

/** hits / shots, or null when nobody fired — 0% and "never tried" are different. */
function ratio(n: number, d: number): number | null {
  return d ? round(n / d, 3) : null;
}

function add(m: Map<SourceKey, SourceTally>, key: SourceKey, amount: number): void {
  const t = m.get(key) ?? { damage: 0, count: 0 };
  t.damage += amount;
  t.count += 1;
  m.set(key, t);
}

const total = (m: Map<SourceKey, SourceTally>): number => {
  let sum = 0;
  for (const t of m.values()) sum += t.damage;
  return sum;
};

/** Only the causes that actually happened, rounded — as DAMAGE_BY_CAUSE was. */
function tallies(m: Map<SourceKey, SourceTally>): Partial<Record<SourceKey, SourceTally>> {
  const out: Partial<Record<SourceKey, SourceTally>> = {};
  for (const [k, t] of m) {
    if (t.count > 0) out[k] = { damage: round(t.damage, 2), count: t.count };
  }
  return out;
}

const low = (xs: number[]): number | null => (xs.length ? Math.min(...xs) : null);

/** The report as JSON, ready for the clipboard or a file. */
export function combatSimJson(report: CombatSimReport): string {
  return JSON.stringify(report, null, 1);
}

// --- the ring of recent exercises -------------------------------------------

export interface SimLog {
  readonly limit: number;
  /** oldest first */
  records: CombatSimReport[];
  push(report: CombatSimReport): void;
  last(): CombatSimReport | null;
  json(): string;
  clear(): void;
}

/** A ring of recent records, with no global anywhere near it. */
export function makeSimLog(limit = SIM_LOG_LIMIT): SimLog {
  const records: CombatSimReport[] = [];
  return {
    limit,
    records,
    push(report) {
      records.push(report);
      while (records.length > limit) records.shift();
    },
    last() { return records.length ? records[records.length - 1] : null; },
    json() { return JSON.stringify(records, null, 1); },
    clear() { records.length = 0; },
  };
}
