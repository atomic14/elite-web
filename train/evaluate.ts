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
import {
  Episode, type Controller, type EpisodeShip, type TargetHullId,
} from '../src/ai-training/scenario.ts';
import { randomBrain, brainFromFile, type Brain, type BrainFile } from '../src/ai-training/policy.ts';
import { makeRng } from '../src/game/rng.ts';
import { FIXED_DT } from '../src/constants/world-clock.ts';
import { printDesignSweep, printPlayerHullSweep } from './profile-sweep.ts';
import { printFlightShapes } from './flight-probe.ts';

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

const SHIPPED_PIRATE = 'pirate-attack-g3';
const SHIPPED_PACK = 'pirate-pack-r4-selectonly';
const SHIPPED_DEFEND = 'jameson-defend-g2';

/**
 * Every policy this tool will score, if its weights are on disk.
 *
 * THE SHIPPED THREE, and then whatever a candidate run has left in
 * `src/ai-training/brains/`. It listed twenty names when twenty-odd experiments
 * were committed; TODO 57 deleted all but the three the game flies, and the
 * `tryLoad`-plus-`if` shape is what makes that a non-event — a name with no file
 * behind it is skipped rather than fatal, and comparing a new candidate is
 * putting its file back and adding one line here.
 *
 * `CANDIDATES` is that line. Drop `pirate-attack-x.json` in the directory, add
 * the stem, and every solo table below grows a row.
 *
 * It is EMPTY, and that is the resting state rather than an oversight. It held
 * `pirate-attack-e1` while TODO 61 was open; TODO 61 deleted that candidate, so
 * there is nothing under comparison and the tool scores the shipped three.
 */
const CANDIDATES: readonly string[] = [];

const brains: Record<string, Brain | null> = {
  [SHIPPED_PIRATE]: tryLoad(SHIPPED_PIRATE),
  [SHIPPED_DEFEND]: tryLoad(SHIPPED_DEFEND),
  [SHIPPED_PACK]: tryLoad(SHIPPED_PACK),
  ...Object.fromEntries(CANDIDATES.map((n) => [n, tryLoad(n)])),
};

const rng = makeRng(0xdead);
const randomPirate = randomBrain(rng);

interface Metrics {
  episodes: number;
  /**
   * THE HEADLINE, and it used to be a kill rate.
   *
   * TODO 29 put the episode's target on the commander's own three 255-point
   * pools, hit for the source rule's 9 to 21 points a time. Nothing kills her
   * inside forty-five seconds any more, so a kill rate reads 0 for every
   * policy including the scripted aimbot, and a column that is always zero
   * ranks nothing. This is the same quantity with the granularity restored:
   * the mean share of her pools an attacker took.
   */
  poolShare: number;
  killRate: number; // % episodes the trader died — kept, and now usually 0
  accuracy: number; // pirate shot accuracy %
  shots: number; // mean laser shots per episode, all attackers
  onSix: number; // mean seconds attackers spent on the target's six
  piratesLost: number; // mean per episode
  traderSurvivalTime: number; // mean seconds trader stayed alive
  flankSpread: number; // mean pairwise angular separation (deg) at hit moments (packs)
}

function runMatchup(
  makePirates: () => Controller[],
  trader: Controller,
  traderArmed: boolean,
  maxTime: number,
  traderClass?: TargetHullId,
): Metrics {
  let kills = 0;
  let hurt = 0;
  let shots = 0;
  let hits = 0;
  let lost = 0;
  let survival = 0;
  let tail = 0;
  let spreadSum = 0;
  let spreadCount = 0;

  for (let e = 0; e < N; e++) {
    const ep = new Episode({
      seed: HOLD_OUT_BASE + e * 7919,
      pirates: makePirates(),
      trader,
      traderArmed,
      traderClass,
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
    if (!ep.trader.alive) kills += 1;
    hurt += ep.targetDamageShare();
    tail += ep.tailTime.reduce((a, b) => a + b, 0);
    survival += traderDeathTime;
    for (const p of ep.pirates) {
      shots += p.shotsFired;
      hits += p.shotsHit;
      if (!p.alive) lost += 1;
    }
  }
  return {
    episodes: N,
    poolShare: (100 * hurt) / N,
    killRate: (100 * kills) / N,
    accuracy: shots ? (100 * hits) / shots : 0,
    shots: shots / N,
    onSix: tail / N,
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
  return `| ${name.padEnd(34)} | ${f(m.poolShare).padStart(5)}% | ${f(m.killRate, 0).padStart(4)}% | ` +
    `${f(m.accuracy, 0).padStart(4)}% | ${f(m.shots).padStart(5)} | ${f(m.onSix).padStart(6)}s | ` +
    `${f(m.piratesLost, 2).padStart(5)} | ${f(m.flankSpread, 0).padStart(5)} |`;
}

const header =
  '| matchup                            | hurt  | kill | acc  | shots | on-six | lost  | sprd° |\n' +
  '| --- | --- | --- | --- | --- | --- | --- | --- |';

console.log(`\nEvaluation tournament — ${N} held-out episodes per matchup (seed base ${HOLD_OUT_BASE})\n`);

// --- 1v1: pirates vs scripted trader ---------------------------------------
//
// The two BASELINES every figure in docs/TRAINING-LOG.md is read against — the
// scripted aimbot and an untrained network — and the shipped brain between them.
// It used to carry four more rows, one per superseded training round; the rounds
// are the log's business and their weights went in TODO 57.
console.log('## 1v1 vs scripted trader\n');
console.log(header);
console.log(row('scripted pirate (baseline)', runMatchup(() => [{ kind: 'scripted' }], { kind: 'scripted' }, false, 45)));
console.log(row('random policy (baseline)', runMatchup(() => [{ kind: 'policy', brain: randomPirate }], { kind: 'scripted' }, false, 45)));
if (brains[SHIPPED_PIRATE]) {
  console.log(row(`${SHIPPED_PIRATE} (SHIPPED)`, runMatchup(() => [{ kind: 'policy', brain: brains[SHIPPED_PIRATE]! }], { kind: 'scripted' }, false, 45)));
}

// --- packs of 3 --------------------------------------------------------------
// The gang against the trader every pack brain was trained on. The list is data
// so a candidate ablation slots in without a copy-pasted block.
const PACK_CANDIDATES: { label: string; key: string | null }[] = [
  { label: '3x scripted pirates', key: null },
  { label: `3x ${SHIPPED_PIRATE} (solo trio)`, key: SHIPPED_PIRATE },
  { label: `${SHIPPED_PACK} (SHIPPED)`, key: SHIPPED_PACK },
  ...CANDIDATES.filter((n) => n.startsWith('pirate-pack'))
    .map((key) => ({ label: `${key} (candidate)`, key })),
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

// --- shipped against candidate ----------------------------------------------
//
// The promotion decision, on one screen. Every row is the same fight on the
// same held-out seeds; the only thing that changes is the policy.
{
  const solo: [string, string][] = [
    [`${SHIPPED_PIRATE} (SHIPPED)`, SHIPPED_PIRATE],
    ...CANDIDATES.filter((n) => n.startsWith('pirate-attack'))
      .map((key) => [`${key} (candidate)`, key] as [string, string]),
  ];
  for (const [title, trader, armed, hull] of [
    ['scripted hauler', { kind: 'scripted' } as Controller, false, undefined],
    ['a commander who fights back', { kind: 'holding' } as Controller, true, 'playerCobra'],
    ['a commander who runs', { kind: 'runner' } as Controller, false, 'playerCobra'],
  ] as const) {
    console.log(`\n## one pirate vs ${title}\n`);
    console.log(header);
    console.log(row('scripted pirate (aimbot ceiling)', runMatchup(
      () => [{ kind: 'scripted' }], trader, armed, 45, hull)));
    for (const [label, key] of solo) {
      const b = brains[key];
      if (b) {
        console.log(row(label, runMatchup(
          () => [{ kind: 'policy', brain: b }], trader, armed, 45, hull)));
      }
    }
  }
  console.log('\n## a gang of three vs a commander who fights back\n');
  console.log(header);
  for (const [label, key] of [
    [`${SHIPPED_PACK} (SHIPPED)`, SHIPPED_PACK],
    [`3x ${SHIPPED_PIRATE} (solo trio)`, SHIPPED_PIRATE],
    ...CANDIDATES.filter((n) => n.startsWith('pirate-pack'))
      .map((key) => [`${key} (candidate)`, key] as [string, string]),
  ] as [string, string][]) {
    const b = brains[key];
    if (!b) continue;
    console.log(row(label, runMatchup(
      () => [0, 1, 2].map(() => ({ kind: 'policy', brain: b }) as Controller),
      { kind: 'holding' }, true, 60, 'playerCobra')));
  }
  console.log('\n## the defence policy: two shipped pirates on her tail\n');
  console.log(header);
  const twoShipped = (): Controller[] => [0, 1].map(
    () => ({ kind: 'policy', brain: brains[SHIPPED_PIRATE]! }) as Controller);
  if (brains[SHIPPED_PIRATE]) {
    console.log(row('scripted armed trader (floor)', runMatchup(
      twoShipped, { kind: 'scripted' }, true, 45, 'playerCobra')));
    for (const [label, key] of [
      [`${SHIPPED_DEFEND} (SHIPPED)`, SHIPPED_DEFEND],
      ...CANDIDATES.filter((n) => n.startsWith('jameson-defend'))
        .map((key) => [`${key} (candidate)`, key] as [string, string]),
    ] as [string, string][]) {
      const b = brains[key];
      if (b) {
        console.log(row(label, runMatchup(
          twoShipped, { kind: 'policy', brain: b }, true, 45, 'playerCobra')));
      }
    }
    console.log('(here LOW "hurt" is the defender winning — it is her pools being spent)');
  }
}

// --- how it FLIES, which no score above can see ------------------------------
//
// `printFlightShapes` skips a name whose weights are not on disk, so adding a
// candidate to CANDIDATES gives it a row here as well as in the tables above.
printFlightShapes([
  SHIPPED_PIRATE, SHIPPED_PACK, ...CANDIDATES,
], Math.max(12, Math.round(N / 2)));

// --- the catalogue, not the policies ----------------------------------------
printDesignSweep();
printPlayerHullSweep(SHIPPED_PIRATE);

console.log('\nhurt = share of the commander\'s three pools taken · kill = she was destroyed');
console.log('acc = attacker accuracy · shots/on-six per episode · lost = attackers lost/episode');
