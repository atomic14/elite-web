// Evaluation tournament: HOW WE TELL THE TRAINING WORKED.
//
//   node --experimental-strip-types train/evaluate.ts
//
// Three principles:
//  1. HELD-OUT SEEDS — training uses seeds derived from gen*977+e*131+7
//     (max ≈ 400k). Evaluation uses seeds starting at 10,000,019, which the
//     optimiser has never seen. Good scores here mean the policy generalises,
//     not that it memorised its training episodes.
//  2. BASELINES — every trained policy is scored alongside the scripted AI
//     and an untrained random policy on the SAME seeds. The interesting
//     number is the gap.
//  3. BEHAVIOUR METRICS, not just fitness — kill rate, time-to-kill,
//     accuracy, survival, pirate losses, and for packs the mean angular
//     spread of attackers at the moments shots land (the flanking measure).

import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { Episode, type Controller, type EpisodeShip } from '../src/ai-training/scenario.ts';
import { randomBrain, brainFromFile, type Brain, type BrainFile } from '../src/ai-training/policy.ts';
import { makeRng } from '../src/game/rng.ts';
import { FIXED_DT } from '../src/game/world-step.ts';

const BRAINS_DIR = new URL('../src/ai-training/brains/', import.meta.url).pathname;
const N = Number(process.argv[2] ?? 60); // episodes per matchup
const HOLD_OUT_BASE = 10_000_019;
const DT = FIXED_DT;

function tryLoad(name: string): Brain | null {
  try {
    return brainFromFile(JSON.parse(readFileSync(`${BRAINS_DIR}${name}.json`, 'utf8')) as BrainFile);
  } catch {
    return null;
  }
}

const brains: Record<string, Brain | null> = {
  'pirate-attack': tryLoad('pirate-attack'),
  'pirate-attack-r2': tryLoad('pirate-attack-r2'),
  'trader-evade': tryLoad('trader-evade'),
  'trader-evade-r2': tryLoad('trader-evade-r2'),
  'pirate-pack': tryLoad('pirate-pack'),
  'pirate-pack-r3': tryLoad('pirate-pack-r3'),
  'pirate-pack-r4': tryLoad('pirate-pack-r4'),
  'pirate-pack-r4-control': tryLoad('pirate-pack-r4-control'),
  'pirate-pack-r4-isolate': tryLoad('pirate-pack-r4-isolate'),
  'pirate-pack-r4-wideonly': tryLoad('pirate-pack-r4-wideonly'),
  'pirate-pack-r4-poolonly': tryLoad('pirate-pack-r4-poolonly'),
  'pirate-pack-r4-selectonly': tryLoad('pirate-pack-r4-selectonly'),
  'pirate-attack-r3': tryLoad('pirate-attack-r3'),
  'jameson-defend': tryLoad('jameson-defend'),
};
const rng = makeRng(0xdead);
const randomPirate = randomBrain(rng);

interface Metrics {
  episodes: number;
  killRate: number; // % episodes the trader died
  meanTimeToKill: number; // seconds, killed episodes only
  accuracy: number; // pirate shot accuracy %
  piratesLost: number; // mean per episode
  traderSurvivalTime: number; // mean seconds trader stayed alive
  flankSpread: number; // mean pairwise angular separation (deg) at hit moments (packs)
}

function runMatchup(
  makePirates: () => Controller[],
  trader: Controller,
  traderArmed: boolean,
  maxTime: number,
): Metrics {
  let kills = 0;
  let ttk = 0;
  let shots = 0;
  let hits = 0;
  let lost = 0;
  let survival = 0;
  let spreadSum = 0;
  let spreadCount = 0;

  for (let e = 0; e < N; e++) {
    const ep = new Episode({
      seed: HOLD_OUT_BASE + e * 7919,
      pirates: makePirates(),
      trader,
      traderArmed,
      maxTime,
    });
    let traderDeathTime = maxTime;
    while (!ep.done) {
      const events = ep.step(DT);
      for (const ev of events) {
        if (ev.hit && ev.to === ep.trader) {
          const spread = pairwiseSpread(ep.pirates, ep.trader);
          if (spread !== null) {
            spreadSum += spread;
            spreadCount += 1;
          }
        }
      }
      if (!ep.trader.alive && traderDeathTime === maxTime) traderDeathTime = ep.t;
    }
    if (!ep.trader.alive) {
      kills += 1;
      ttk += traderDeathTime;
    }
    survival += traderDeathTime;
    for (const p of ep.pirates) {
      shots += p.shotsFired;
      hits += p.shotsHit;
      if (!p.alive) lost += 1;
    }
  }
  return {
    episodes: N,
    killRate: (100 * kills) / N,
    meanTimeToKill: kills ? ttk / kills : NaN,
    accuracy: shots ? (100 * hits) / shots : 0,
    piratesLost: lost / N,
    traderSurvivalTime: survival / N,
    flankSpread: spreadCount ? spreadSum / spreadCount : NaN,
  };
}

/** Mean pairwise angle (deg) between attacker bearings as seen from the trader. */
function pairwiseSpread(pirates: EpisodeShip[], trader: EpisodeShip): number | null {
  const dirs = pirates.filter((p) => p.alive)
    .map((p) => new THREE.Vector3().subVectors(p.pos, trader.pos).normalize());
  if (dirs.length < 2) return null;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      sum += (dirs[i].angleTo(dirs[j]) * 180) / Math.PI;
      n += 1;
    }
  }
  return sum / n;
}

function row(name: string, m: Metrics): string {
  const f = (x: number, d = 1) => (Number.isNaN(x) ? '—' : x.toFixed(d));
  return `| ${name.padEnd(34)} | ${f(m.killRate, 0).padStart(4)}% | ${f(m.meanTimeToKill).padStart(6)}s | ` +
    `${f(m.accuracy, 0).padStart(4)}% | ${f(m.traderSurvivalTime).padStart(6)}s | ` +
    `${f(m.piratesLost, 2).padStart(5)} | ${f(m.flankSpread, 0).padStart(5)} |`;
}

const header =
  '| matchup                            | kill | t-kill | acc  | t-surv | lost  | sprd° |\n' +
  '| --- | --- | --- | --- | --- | --- | --- |';

console.log(`\nEvaluation tournament — ${N} held-out episodes per matchup (seed base ${HOLD_OUT_BASE})\n`);

// --- 1v1: pirates vs scripted trader ---------------------------------------
console.log('## 1v1 vs scripted trader\n');
console.log(header);
console.log(row('scripted pirate (baseline)', runMatchup(() => [{ kind: 'scripted' }], { kind: 'scripted' }, false, 45)));
console.log(row('random policy (baseline)', runMatchup(() => [{ kind: 'policy', brain: randomPirate }], { kind: 'scripted' }, false, 45)));
if (brains['pirate-attack']) {
  console.log(row('trained pirate r1', runMatchup(() => [{ kind: 'policy', brain: brains['pirate-attack']! }], { kind: 'scripted' }, false, 45)));
}
if (brains['pirate-attack-r2']) {
  console.log(row('trained pirate r2 (league)', runMatchup(() => [{ kind: 'policy', brain: brains['pirate-attack-r2']! }], { kind: 'scripted' }, false, 45)));
}
if (brains['pirate-attack-r3']) {
  console.log(row('trained pirate r3 (league)', runMatchup(() => [{ kind: 'policy', brain: brains['pirate-attack-r3']! }], { kind: 'scripted' }, false, 45)));
}

// --- 1v1 vs trained evader ---------------------------------------------------
if (brains['trader-evade']) {
  const evader: Controller = { kind: 'policy', brain: brains['trader-evade']! };
  console.log('\n## 1v1 vs trained evader\n');
  console.log(header);
  console.log(row('scripted pirate vs evader', runMatchup(() => [{ kind: 'scripted' }], evader, false, 45)));
  if (brains['pirate-attack']) {
    console.log(row('trained pirate r1 vs evader', runMatchup(() => [{ kind: 'policy', brain: brains['pirate-attack']! }], evader, false, 45)));
  }
  if (brains['pirate-attack-r2']) {
    console.log(row('trained pirate r2 vs evader', runMatchup(() => [{ kind: 'policy', brain: brains['pirate-attack-r2']! }], evader, false, 45)));
  }
  if (brains['pirate-attack-r3']) {
    console.log(row('trained pirate r3 vs evader', runMatchup(() => [{ kind: 'policy', brain: brains['pirate-attack-r3']! }], evader, false, 45)));
  }
}

// --- packs of 3 --------------------------------------------------------------
// Every pack brain, against three different traders. The candidate list is
// data so ablations slot in without copy-pasted blocks.
const PACK_CANDIDATES: { label: string; key: string | null }[] = [
  { label: '3x scripted pirates', key: null },
  { label: '3x solo r1 brains (no pack obs)', key: 'pirate-attack' },
  { label: '3x solo r2 brains (SHIPPED)', key: 'pirate-attack-r2' },
  { label: 'pack r2 (alpha strike)', key: 'pirate-pack' },
  { label: 'pack r3 (sustained fire)', key: 'pirate-pack-r3' },
  { label: 'run-4 config, fixed selection', key: 'pirate-pack-r4-isolate' },
  { label: 'r4 control (none of the 3)', key: 'pirate-pack-r4-control' },
  { label: 'r4 +wide obs only', key: 'pirate-pack-r4-wideonly' },
  { label: 'r4 +opponent pool only', key: 'pirate-pack-r4-poolonly' },
  { label: 'r4 +kill-rate ranking only', key: 'pirate-pack-r4-selectonly' },
  { label: 'r4 ALL THREE', key: 'pirate-pack-r4' },
];

function packSection(title: string, trader: Controller): void {
  console.log(`\n## pack of 3 vs ${title}\n`);
  console.log(header);
  for (const c of PACK_CANDIDATES) {
    if (c.key === null) {
      console.log(row(c.label, runMatchup(
        () => [{ kind: 'scripted' }, { kind: 'scripted' }, { kind: 'scripted' }],
        trader, true, 60)));
      continue;
    }
    const b = brains[c.key];
    if (!b) continue;
    console.log(row(c.label, runMatchup(
      () => [
        { kind: 'policy', brain: b },
        { kind: 'policy', brain: b },
        { kind: 'policy', brain: b },
      ], trader, true, 60)));
  }
}

// The training target for every pack brain in the table.
packSection('armed scripted trader (all packs trained on this)', { kind: 'scripted' });

// r4's pool contained jameson-defend and trader-evade-r2, so these two rows
// flatter r4 relative to r2/r3 — seen opponent, unseen seeds.
if (brains['jameson-defend']) {
  packSection('armed jameson-defend trader (in r4\'s pool)',
    { kind: 'policy', brain: brains['jameson-defend']! });
}
// trader-evade r1 is in NOBODY's training pool — the clean generalisation test.
if (brains['trader-evade']) {
  packSection('armed trader-evade r1 (unseen by every pack)',
    { kind: 'policy', brain: brains['trader-evade']! });
}

// --- Commander Jameson: armed trader vs 2x shipped pirates -------------------
if (brains['pirate-attack-r2']) {
  const r2 = brains['pirate-attack-r2']!;
  const twoPirates = () => [
    { kind: 'policy', brain: r2 } as Controller,
    { kind: 'policy', brain: r2 } as Controller,
  ];
  console.log('\n## Commander Jameson: armed trader vs 2x pirate-r2\n');
  console.log(header);
  console.log(row('scripted armed trader (baseline)', runMatchup(twoPirates, { kind: 'scripted' }, true, 45)));
  if (brains['jameson-defend']) {
    console.log(row('JAMESON defence policy', runMatchup(twoPirates, { kind: 'policy', brain: brains['jameson-defend']! }, true, 45)));
  }
  console.log('(here "kill"/"t-surv" describe the TRADER: low kill% + high t-surv = Jameson wins)');
}

console.log('\nkill = trader destroyed · t-kill = mean time to kill · acc = pirate accuracy');
console.log('t-surv = trader survival · lost = pirates lost/episode · sprd° = attacker spread at hits');
