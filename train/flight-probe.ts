// Is it flying, or is it a turret? — the shape of a brain's fight.
//
//   node --experimental-strip-types train/flight-probe.ts [episodes]
//   (also printed by `npm run evaluate`)
//
// CLAUDE.md states the problem this exists for, and it is the one thing every
// score in this project is blind to:
//
//   > A well-optimised pirate is a turret that hangs in space and snipes, and
//   > evolution will find it. We want a dogfight the player can win — attack
//   > runs, weaving, overshoots. Lethality is a proxy for threat, and a brain
//   > that wins every measurement can still be the wrong brain.
//
// Generations 1 and 2 won every measurement in docs/TRAINING-LOG.md and were
// rolled back the day they shipped, because stopping really IS the optimal way
// to hold a firing line. The tournament could not see it. This can:
//
//   speed        a turret cruises slowly. Pirate hulls have a floor
//                (MIN_CRUISE_FRACTION) so it cannot stop dead any more, but it
//                can still sit at the floor and pivot.
//   passes       an attack run is a closure and a break. Counted as a
//                hysteresis crossing — in past PASS_CLOSE, out past PASS_FAR —
//                so a ship loitering at 600 units scores none however long it
//                stays.
//   range spread the p10-to-p90 gap. An attack run sweeps through it; a turret
//                holds one range and the spread collapses.
//   on-six       time spent astern of the target AND pointed at it, which is
//                the manoeuvre that is actually threatening.
//   rams         contact per episode, against an UNARMED target so that every
//                point the pirate loses is something it flew into. Threat is
//                not "flew into you".
//
// NONE OF THESE IS A GATE. They are a description, for a human deciding whether
// to promote a brain, and the decision is made by flying it — `T` at any
// station, see docs/BROWSER-TRIALS.md.
//
// ## It does not do its own arithmetic any more (TODO 34)
//
// The three measurements above that a pilot also sees in the game — their
// speed, the range spread they held and the passes they made — are now taken by
// `CombatSimRecorder` itself: this file builds a recorder per episode, feeds it
// the fight, and reads `report().opposition`. So the tool and the combat
// trainer's report cannot disagree about what a pass is, because there is one
// `countPasses` and one `PASS_CLOSE`/`PASS_FAR` and they live in
// `src/game/combat-sim-report.ts` beside `SIX_CONE` and `SAMPLE_HZ`, each with
// the reason it is the measurement's own number. This file used to hold a
// second copy of all three, which is one rule with two homes — the failure
// CLAUDE.md is organised against — waiting for somebody to move one of them.
//
// The one thing that IS this file's own is the CADENCE. The trainer samples at
// SAMPLE_HZ because a twenty-minute sparring session at 60 Hz is a lot of
// arithmetic nobody reads; a batch of 45-second episodes can afford every step,
// and sampling every step is what the archived probe rows
// (train/logs/todo32/flight-probe.txt) were taken at. It is declared through
// the recorder's own `sampleHz`, so every duration the recorder derives still
// agrees with the clock — not a second cadence bolted on the side.

import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { Episode, type Controller, type TargetHullId } from '../src/ai-training/scenario.ts';
import { brainFromFile, type Brain, type BrainFile } from '../src/ai-training/policy.ts';
import {
  CombatSimRecorder, aimAngle, mean, quantile,
  type CombatSimReport, type FrameSample, type SimOutcome,
} from '../src/game/combat-sim-report.ts';
import { PASS_CLOSE, PASS_FAR } from '../src/constants/combat-record.ts';
import { NO_OPENING } from '../src/game/combat-sim-opening.ts';
import { IMPACT } from '../src/constants/impact.ts';
import { FIXED_DT } from '../src/constants/world-clock.ts';
import { describeFlight } from '../src/game/break-off.ts';

const BRAINS = new URL('../src/ai-training/brains/', import.meta.url);

/**
 * Held-out, and distinct from every other base in the project.
 *
 * Exported so episode `n` of a table can be flown again on its own — which is
 * how the figures here are checked against the ones the game prints, rather
 * than assumed to agree.
 */
export const PROBE_BASE = 30_000_007;

/** How long one probe episode runs. */
const EPISODE_SECONDS = 45;

export interface FlightShape {
  brain: string;
  episodes: number;
  meanSpeed: number;
  /** share of sampled frames with the throttle open */
  forwardShare: number;
  rangeP10: number;
  rangeMedian: number;
  rangeP90: number;
  closest: number;
  /** completed close-then-break cycles per episode */
  passesPerEpisode: number;
  onSixSeconds: number;
  ramsPerEpisode: number;
  poolShare: number;
}

/**
 * One episode, measured by the game's own recorder.
 *
 * `report.opposition` is the block the combat trainer shows a pilot after an
 * exercise — their speed, the range spread they held, and their completed
 * attack runs — so a figure printed by this tool and the same figure printed in
 * the game are the same code over the same rule. The three extras beside it are
 * the episode's own and have no counterpart in a real fight: `onSix` comes from
 * the scenario's tail timer, and `rams` and `hurt` need an unarmed target.
 */
export interface EpisodeShape {
  report: CombatSimReport;
  /** the pirate's range and speed at every sampled step, in order */
  ranges: number[];
  speeds: number[];
  onSix: number;
  rams: number;
  hurt: number;
}

/** The episode's ending, in the terms a report states it — from the TARGET's seat. */
function outcomeOf(ep: Episode): SimOutcome {
  const how = ep.report().outcome;
  // The target stands in for the commander, so "the target was destroyed" is
  // `destroyed` and "the pirates all died" is `cleared`. An escape has no
  // equivalent — nobody quit, but the fight stopped being one.
  return how === 'escaped' ? 'quit' : how;
}

/**
 * Fly one episode and measure it.
 *
 * Exported so the agreement between this tool and the in-game report can be
 * checked directly rather than asserted: the same episode, one recorder, and
 * both sets of figures out of it.
 */
export function probeEpisode(
  name: string, brain: Brain | null, seed: number, hull: TargetHullId = 'playerCobra',
): EpisodeShape {
  const ep = new Episode({
    seed,
    // `null` means the SCRIPTED attack run, which is what every pirate flies
    // since d563e3d. This file could not measure the shipped AI at all until
    // that was true: `probe()` loaded a weights file per name, so `scripted`
    // threw, and `printFlightShapes` swallowed it in a `catch` and printed a
    // table with the row silently missing.
    pirates: [(brain === null ? { kind: 'scripted' } : { kind: 'policy', brain }) as Controller],
    // A target that stops and turns — how a human knife-fights, and the one
    // opponent that separates a pursuer from a turret.
    //
    // UNARMED, deliberately: with the target shooting back, a pirate's
    // `damageTaken` is laser damage plus contact and the ram count below
    // becomes a guess. Against an unarmed target every point it loses is
    // something it flew into, which is the number this table wants.
    trader: { kind: 'holding' },
    traderArmed: false,
    traderClass: hull,
    maxTime: EPISODE_SECONDS,
  });
  const setup = ep.setup();
  const rec = new CombatSimRecorder({
    seed,
    scenario: `flight probe: ${hull}, target holds`,
    mode: 'scenario',
    // Every step, declared: see the header. The recorder's durations follow it.
    sampleHz: 1 / FIXED_DT,
    player: {
      shipId: setup.target.shipId,
      laser: setup.target.laser,
      missiles: 0, ecm: false, energyUnit: false, energyBomb: false,
    },
    opponents: setup.pirates.map((p) => ({
      hull: p.name,
      designId: p.designId,
      profileId: p.profileId,
      brain: name,
      role: 'pirate',
    })),
    // An episode is not a trainer exercise: where its ships start is
    // ai-training/scenario.ts's business, so this record does not claim one.
    opening: NO_OPENING,
  });

  const target = ep.trader;
  const gap = new THREE.Vector3();
  const sample = (): FrameSample => ({
    speed: target.speed,
    pitch: target.pitchRate,
    roll: target.rollRate,
    foreShield: target.sys.foreShield,
    aftShield: target.sys.aftShield,
    energy: target.sys.energy,
    contacts: ep.pirates.flatMap((p, i) => (p.alive ? [{
      opponent: i,
      dist: gap.copy(target.pos).sub(p.pos).length(),
      speed: p.speed,
      theirAim: aimAngle(p.pos, p.quat, target.pos),
      doing: describeFlight(
        p.npc.state.attackPhase, p.npc.state.underFire, p.npc.state.fleeing,
        p.npc.state.flownBy, p.npc.state.tactic),
      yourAim: aimAngle(target.pos, target.quat, p.pos),
    }] : [])),
  });

  while (!ep.done) {
    ep.step(FIXED_DT);
    // A dead pirate has no flight to describe, and the episode is over for this
    // tool's purposes — the same stopping point the probe has always used.
    if (!ep.pirates[0].alive) break;
    rec.tick(FIXED_DT, sample);
  }

  const ranges: number[] = [];
  const speeds: number[] = [];
  for (const f of rec.raw) {
    for (const c of f.contacts) { ranges.push(c.dist); speeds.push(c.speed); }
  }
  return {
    report: rec.report(outcomeOf(ep)),
    ranges,
    speeds,
    onSix: ep.tailTime.reduce((a, b) => a + b, 0),
    rams: ep.pirates.reduce((a, p) => a + p.damageTaken, 0) / IMPACT.ram.ship,
    hurt: ep.targetDamageShare(),
  };
}

export function probe(
  name: string, episodes: number, hull: TargetHullId = 'playerCobra',
): FlightShape {
  const brain: Brain | null = name === 'scripted' ? null : brainFromFile(
    JSON.parse(readFileSync(new URL(`${name}.json`, BRAINS), 'utf8')) as BrainFile);
  const ranges: number[] = [];
  const speeds: number[] = [];
  let passes = 0;
  let onSix = 0;
  let rams = 0;
  let hurt = 0;

  for (let e = 0; e < episodes; e++) {
    const shape = probeEpisode(name, brain, PROBE_BASE + e * 7919, hull);
    // Pooled, so the quantiles below describe the whole batch rather than
    // averaging thirty medians — but the PASSES are summed per episode, because
    // the hysteresis has to start over when the fight does.
    for (const d of shape.ranges) ranges.push(d);
    for (const s of shape.speeds) speeds.push(s);
    passes += shape.report.opposition.passes;
    onSix += shape.onSix;
    rams += shape.rams;
    hurt += shape.hurt;
  }
  return {
    brain: name,
    episodes,
    meanSpeed: mean(speeds) ?? 0,
    forwardShare: speeds.filter((s) => s > 0).length / Math.max(1, speeds.length),
    rangeP10: quantile(ranges, 0.1) ?? 0,
    rangeMedian: quantile(ranges, 0.5) ?? 0,
    rangeP90: quantile(ranges, 0.9) ?? 0,
    closest: ranges.reduce((m, d) => Math.min(m, d), Infinity) || 0,
    passesPerEpisode: passes / episodes,
    onSixSeconds: onSix / episodes,
    ramsPerEpisode: rams / episodes,
    poolShare: hurt / episodes,
  };
}

export function printFlightShapes(names: string[], episodes: number): void {
  console.log(`\n## the shape of the fight — ${episodes} held-out episodes,`
    + ' target stops and turns to fight\n');
  console.log('| brain | speed | throttle | range p10/med/p90 | closest | passes | on-six | rams | hurt |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const name of names) {
    let s: FlightShape;
    try {
      s = probe(name, episodes);
    } catch (err) {
      // SAY SO. This used to `continue`, so a name that could not be loaded
      // vanished from the table with no row and no message, and the reader had
      // no way to tell "flew badly" from "was never flown".
      console.log(`| ${name.padEnd(26)} | could not be probed: ${(err as Error).message}`);
      continue;
    }
    console.log(`| ${name.padEnd(26)} | ${s.meanSpeed.toFixed(0).padStart(5)} | `
      + `${(s.forwardShare * 100).toFixed(0).padStart(7)}% | `
      + `${`${s.rangeP10.toFixed(0)}/${s.rangeMedian.toFixed(0)}/${s.rangeP90.toFixed(0)}`.padStart(17)} | `
      + `${s.closest.toFixed(0).padStart(7)} | ${s.passesPerEpisode.toFixed(2).padStart(6)} | `
      + `${s.onSixSeconds.toFixed(1).padStart(5)}s | ${s.ramsPerEpisode.toFixed(2).padStart(4)} | `
      + `${(s.poolShare * 100).toFixed(1).padStart(4)}% |`);
  }
  console.log('\npasses = closed inside ' + PASS_CLOSE + ' and broke back out past ' + PASS_FAR
    + ', per episode — a loiter scores none');
  console.log('a TURRET reads: low speed, few passes, a collapsed range spread, low on-six');
}

// --- the command line the header has always documented ------------------------
//
// It did not exist. The header said
//   node --experimental-strip-types train/flight-probe.ts [episodes]
// and the file had no entry point, so running it printed nothing and exited 0 —
// which is the worst possible failure for a measuring tool, and it is why
// docs/TODO/66 quoted a verification step that could not be run.

/**
 * The trained policies still in the bundle, for comparison against what ships.
 * Named rather than derived from `SHIPPED_BRAINS`, for the same reason
 * `SIM_BRAINS` is: what ships is now `scripted`, so deriving this would collapse
 * the list and quietly drop the things the probe exists to compare against.
 */
const TRAINED_ALTERNATIVES = ['pirate-attack-g3', 'pirate-pack-r4-selectonly'];

const isMain = process.argv[1]?.endsWith('flight-probe.ts') ?? false;
if (isMain) {
  const episodes = Number(process.argv[2] ?? 40);
  // What SHIPS first, then the trained alternatives it is compared against.
  // `scripted` is the shipped pirate AI since d563e3d, not a curiosity.
  printFlightShapes(
    ['scripted', ...TRAINED_ALTERNATIVES], Number.isFinite(episodes) ? episodes : 40);
}
