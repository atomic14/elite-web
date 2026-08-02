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
//                hysteresis crossing — in past CLOSE, out past FAR — so a ship
//                loitering at 600 units scores none however long it stays.
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

import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { Episode, type Controller, type TargetHullId } from '../src/ai-training/scenario.ts';
import { brainFromFile, type Brain, type BrainFile } from '../src/ai-training/policy.ts';
import { IMPACT } from '../src/game/impact-damage.ts';
import { FIXED_DT } from '../src/game/world-step.ts';

const BRAINS = new URL('../src/ai-training/brains/', import.meta.url);

/** Held-out, and distinct from every other base in the project. */
const PROBE_BASE = 30_000_007;

/** An attack run is a closure past CLOSE and a break back out past FAR. */
const CLOSE = 400;
const FAR = 900;

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

const quantile = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

export function probe(
  name: string, episodes: number, hull: TargetHullId = 'playerCobra',
): FlightShape {
  const brain: Brain = brainFromFile(
    JSON.parse(readFileSync(new URL(`${name}.json`, BRAINS), 'utf8')) as BrainFile);
  const ranges: number[] = [];
  const speeds: number[] = [];
  let forward = 0;
  let frames = 0;
  let passes = 0;
  let onSix = 0;
  let rams = 0;
  let hurt = 0;
  let closest = Infinity;
  const gap = new THREE.Vector3();

  for (let e = 0; e < episodes; e++) {
    const ep = new Episode({
      seed: PROBE_BASE + e * 7919,
      pirates: [{ kind: 'policy', brain } as Controller],
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
      maxTime: 45,
    });
    // Hysteresis, per episode: 'out' until it closes, 'in' until it breaks.
    let inside = false;
    while (!ep.done) {
      ep.step(FIXED_DT);
      const p = ep.pirates[0];
      if (!p.alive) break;
      const d = gap.copy(ep.trader.pos).sub(p.pos).length();
      ranges.push(d);
      speeds.push(p.speed);
      frames += 1;
      if (p.speed > 0) forward += 1;
      closest = Math.min(closest, d);
      if (!inside && d < CLOSE) inside = true;
      else if (inside && d > FAR) { inside = false; passes += 1; }
    }
    onSix += ep.tailTime.reduce((a, b) => a + b, 0);
    rams += ep.pirates.reduce((a, p) => a + p.damageTaken, 0) / IMPACT.ram.ship;
    hurt += ep.targetDamageShare();
  }
  return {
    brain: name,
    episodes,
    meanSpeed: speeds.reduce((a, b) => a + b, 0) / Math.max(1, speeds.length),
    forwardShare: forward / Math.max(1, frames),
    rangeP10: quantile(ranges, 0.1),
    rangeMedian: quantile(ranges, 0.5),
    rangeP90: quantile(ranges, 0.9),
    closest: closest === Infinity ? 0 : closest,
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
    try { s = probe(name, episodes); } catch { continue; }
    console.log(`| ${name.padEnd(26)} | ${s.meanSpeed.toFixed(0).padStart(5)} | `
      + `${(s.forwardShare * 100).toFixed(0).padStart(7)}% | `
      + `${`${s.rangeP10.toFixed(0)}/${s.rangeMedian.toFixed(0)}/${s.rangeP90.toFixed(0)}`.padStart(17)} | `
      + `${s.closest.toFixed(0).padStart(7)} | ${s.passesPerEpisode.toFixed(2).padStart(6)} | `
      + `${s.onSixSeconds.toFixed(1).padStart(5)}s | ${s.ramsPerEpisode.toFixed(2).padStart(4)} | `
      + `${(s.poolShare * 100).toFixed(1).padStart(4)}% |`);
  }
  console.log('\npasses = closed inside ' + CLOSE + ' and broke back out past ' + FAR
    + ', per episode — a loiter scores none');
  console.log('a TURRET reads: low speed, few passes, a collapsed range spread, low on-six');
}
