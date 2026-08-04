// How long between one ship's attack runs? — the RHYTHM of a gang fight.
//
//   node --experimental-strip-types train/gap-probe.ts [episodes] [holds|evades|weaves]
//
// Chris, having flown it: *"I think one thing I'm observing they fly quite far
// before turning for another run."* That is a complaint about a CLOCK, and none
// of the three probes beside this one can see it.
//
//   `train/flight-probe.ts`  counts passes per episode for ONE pirate, which is
//                            a rate over a whole fight and says nothing about
//                            the spacing between two of them.
//   `train/ram-probe.ts`     counts contact for FIVE, which is the failure mode
//                            a shorter cycle risks, not the cycle itself.
//
// So this is the third question, and it is docs/TODO/67's: from the moment a
// ship merges to the moment it merges again, how many seconds does the player
// spend watching it fly away? A merge is the ship coming inside
// `BREAK_OFF_RANGE` — the game's own number for "this is knife range now", read
// from break-off.ts rather than re-picked, so the tool cannot come to mean
// something the flight model does not.
//
// TWO numbers, because one of them alone is a trap:
//
//   gap    seconds between consecutive merges by the SAME ship. This is the
//          rhythm the player feels.
//   apex   how far out it got in between. A gap can be shortened by a ship that
//          simply flies slower, and the apex is what says whether the run got
//          shorter or the ship got lazier. It is also the reading that catches
//          the failure the whole cycle exists to avoid: a ship that stops
//          leaving at all has a very short gap and is a turret.
//
// FIVE pirates and a holding target, which is `train/ram-probe.ts`'s wave shape
// rather than flight-probe's duel, because the rhythm the complaint is about is
// the one a gang produces. The target is UNARMED for both probes' reason: it
// keeps all five alive for the whole episode, so every run measures the same
// amount of flying.
//
// Per SHIP, not per fight. Five pirates that merge in turn produce a merge
// every two seconds between them and each still takes nine to come round, and
// the second number is the one the player is watching.

import * as THREE from 'three';
import { Episode, type Controller } from '../src/ai-training/scenario.ts';
import { BREAK_OFF_RANGE } from '../src/constants/attack-run.ts';
import { quantile } from '../src/game/combat-sim-report.ts';
import { FIXED_DT } from '../src/game/world-step.ts';
import { PIRATES, pilotFor, type TargetBehaviour } from './ram-probe.ts';

/**
 * The seeds, and they are `train/flight-probe.ts`'s.
 *
 * IMPORTED rather than re-picked so that the numbers docs/TODO/67 quotes — the
 * ones this file was written to reproduce — can be flown again exactly. Five
 * pirates against flight-probe's one is a different world from the same seed,
 * so nothing is shared except the arithmetic that generates them.
 */
export const GAP_PROBE_BASE = 30_000_007;

/**
 * Long enough that a ship gets several runs in.
 *
 * The other two probes run 45s. A gap is measured BETWEEN merges, so a fight
 * that fits three merges yields two readings; the item's own snippet used 70
 * and this is that number, kept so its table stays comparable.
 */
const EPISODE_SECONDS = 70;

export interface GapShape {
  behaviour: TargetBehaviour;
  episodes: number;
  /** merge-to-merge intervals, seconds */
  gapP10: number;
  gapMedian: number;
  gapP90: number;
  /** how far out the ship got between those two merges */
  apexP10: number;
  apexMedian: number;
  apexP90: number;
  /** how many intervals the batch produced — a small n is a loud one */
  samples: number;
  /** merges per pirate per episode, so a collapsed cycle is visible as a rate */
  mergesPerPirate: number;
}

export function gapProbe(
  behaviour: TargetBehaviour, episodes: number, pirates = PIRATES,
): GapShape {
  const gaps: number[] = [];
  const apexes: number[] = [];
  let merges = 0;
  let pirateEpisodes = 0;
  const pilot = pilotFor(behaviour);

  for (let e = 0; e < episodes; e++) {
    // One at a time: an Episode seeds the world's PRNG in its constructor, so
    // interleaving two of them would braid their dice.
    const ep = new Episode({
      seed: GAP_PROBE_BASE + e * 7919,
      pirates: Array.from({ length: pirates }, () => ({ kind: 'scripted' }) as Controller),
      trader: pilot,
      traderArmed: false,
      traderClass: 'playerCobra',
      maxTime: EPISODE_SECONDS,
    });
    ep.setup();
    const gap = new THREE.Vector3();
    // Per ship: when it last merged, whether it is inside now, and how far out
    // it has been since. `inside` is what makes this a crossing rather than a
    // count of frames spent close.
    const last = new Map<number, number>();
    const inside = new Map<number, boolean>();
    const peak = new Map<number, number>();
    let t = 0;
    while (!ep.done) {
      ep.step(FIXED_DT);
      t += FIXED_DT;
      ep.pirates.forEach((p, i) => {
        if (!p.alive) return;
        const d = gap.copy(ep.trader.pos).sub(p.pos).length();
        peak.set(i, Math.max(peak.get(i) ?? 0, d));
        const now = d < BREAK_OFF_RANGE;
        if (now && !inside.get(i)) {
          merges += 1;
          if (last.has(i)) {
            gaps.push(t - last.get(i)!);
            apexes.push(peak.get(i)!);
          }
          last.set(i, t);
          peak.set(i, 0);
        }
        inside.set(i, now);
      });
    }
    pirateEpisodes += ep.pirates.length;
  }

  return {
    behaviour,
    episodes,
    gapP10: quantile(gaps, 0.1) ?? 0,
    gapMedian: quantile(gaps, 0.5) ?? 0,
    gapP90: quantile(gaps, 0.9) ?? 0,
    apexP10: quantile(apexes, 0.1) ?? 0,
    apexMedian: quantile(apexes, 0.5) ?? 0,
    apexP90: quantile(apexes, 0.9) ?? 0,
    samples: gaps.length,
    mergesPerPirate: merges / Math.max(1, pirateEpisodes),
  };
}

export function printGapShapes(
  episodes: number, behaviours: TargetBehaviour[] = ['holds'],
): void {
  console.log(`\n## the rhythm of an attack run — ${episodes} held-out episodes,`
    + ` ${PIRATES} scripted pirates, unarmed commander's Cobra,`
    + ` a merge is inside ${BREAK_OFF_RANGE}\n`);
  console.log('| target | gap p10/med/p90 (s) | apex p10/med/p90 | merges/pirate | intervals |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const b of behaviours) {
    const s = gapProbe(b, episodes);
    const g = `${s.gapP10.toFixed(2)}/${s.gapMedian.toFixed(2)}/${s.gapP90.toFixed(2)}`;
    const a = `${s.apexP10.toFixed(0)}/${s.apexMedian.toFixed(0)}/${s.apexP90.toFixed(0)}`;
    console.log(`| ${b.padEnd(6)} | ${g.padStart(19)} | ${a.padStart(16)} | `
      + `${s.mergesPerPirate.toFixed(2).padStart(13)} | ${String(s.samples).padStart(9)} |`);
  }
  console.log('\nthe APEX is the guard on the gap: a shorter cycle that stops sweeping'
    + ' is a turret with a faster clock');
}

const isMain = process.argv[1]?.endsWith('gap-probe.ts') ?? false;
if (isMain) {
  const episodes = Number(process.argv[2] ?? 40);
  const arg = process.argv[3];
  const behaviours: TargetBehaviour[] = arg === 'all'
    ? ['holds', 'evades', 'weaves'] : [(arg as TargetBehaviour) ?? 'holds'];
  printGapShapes(Number.isFinite(episodes) ? episodes : 40, behaviours);
}
