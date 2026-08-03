// Does the attack run miss a target that MOVES? — contact per engagement.
//
//   node --experimental-strip-types train/ram-probe.ts [episodes]
//
// `train/flight-probe.ts` flies ONE pirate against a target that holds still,
// because that isolates the shape of a brain's flying. It is therefore blind to
// the thing docs/TODO/66 exists for: an attack run aims a fixed 110 units to
// one side of where the target is AT THAT INSTANT, and against a target that is
// itself travelling, the geometry eats most of that offset before the merge.
// Chris's wave-10 record (`seed1227898432`) took 460 points of ram damage over
// four events, 29% of everything he took, from a flight model whose whole
// purpose is that ships no longer fly into you.
//
// So this is the other probe: FIVE pirates, the wave shape, and the same fight
// flown against three different target behaviours.
//
//   holds    the control, and what flight-probe measures — turns hard, barely
//            translates. Chris's own recorded envelope is close to this
//            (median speed 66, pitch near its cap), so it is not a strawman.
//   evades   the shipped defence policy flying the commander's own Cobra —
//            `train/survivability.ts`'s model of a piloted commander.
//   weaves   flat out across the arena, indifferent to the pirates. The
//            instrument the item actually needs, and the reason it had to be
//            added: NOTHING in the training world both translated and stayed in
//            the fight. See `weaving` in ai-training/scenario.ts.
//
// The three that were tried and are not measurements: `scripted` ambles until
// something shoots it and then flees flat out, `runner` flees from the first
// frame — both settle at ~397 against a pirate's ~240 and are never caught
// again (0.01 passes a pirate, median range 3,200) — and the defence policy
// turns out to translate at a mean of 4, so `evades` is LESS mobile than
// `holds`, not more. It stays in the table because that is worth knowing and
// because it is the pilot `survivability.ts` reports against.
//
// WHAT IT COUNTS. `Episode.traderRams` — the count taken where the ram is
// billed, so it cannot disagree with the damage. flight-probe's `rams` column
// is `damageTaken / IMPACT.ram.ship`, which is exact for one pirate against an
// unarmed target and wrong here: with five, ship-on-ship contact is in the same
// total. Both are reported below, so the difference between them is visible
// rather than assumed.
//
// The target is UNARMED, for flight-probe's reason: it keeps all five pirates
// alive for the whole episode, so every run measures the same amount of flying.
// `escapeRange` is opened up for the same reason — a runner that gets clear at
// 12 seconds would otherwise report "no rams" for a fight that never happened.

import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { Episode, type Controller, type TargetHullId } from '../src/ai-training/scenario.ts';
import { brainFromFile, type BrainFile } from '../src/ai-training/policy.ts';
import { defenceBrainNameFor } from '../src/game/brain-names.ts';
import { countPasses, quantile } from '../src/game/combat-sim-report.ts';
import { IMPACT } from '../src/game/impact-damage.ts';
import { FIXED_DT } from '../src/game/world-step.ts';

/** Held-out, and distinct from `flight-probe.ts`'s PROBE_BASE. */
export const RAM_PROBE_BASE = 40_000_009;

/** The wave shape the item is measured from. */
export const PIRATES = 5;
const EPISODE_SECONDS = 45;
/**
 * Far enough that nothing escapes inside the episode.
 *
 * The default 6,000 exists so that "stand still and pivot" stops being a
 * winning pirate policy, which is a TRAINING pressure. This is a measurement:
 * an episode that ends early has flown less, and comparing a before to an after
 * across different amounts of flying is comparing nothing.
 */
const NO_ESCAPE = 200_000;

/** How the target flies, and the label the table prints. */
export type TargetBehaviour = 'holds' | 'evades' | 'weaves';

const BRAINS_DIR = new URL('../src/ai-training/brains/', import.meta.url);

/**
 * The commander's pilot, for the `evades` row — the SHIPPED defence policy,
 * named through `brain-names.ts` so this file cannot quietly fly a different
 * one from the game.
 */
function defencePilot(): Controller {
  const name = defenceBrainNameFor();
  return {
    kind: 'policy',
    brain: brainFromFile(
      JSON.parse(readFileSync(new URL(`${name}.json`, BRAINS_DIR), 'utf8')) as BrainFile),
  };
}

function pilotFor(b: TargetBehaviour): Controller {
  if (b === 'holds') return { kind: 'holding' };
  if (b === 'weaves') return { kind: 'weaving' };
  return defencePilot();
}

export interface RamShape {
  behaviour: TargetBehaviour;
  episodes: number;
  /** contacts with the TARGET per episode, counted where they are billed */
  ramsPerEpisode: number;
  /** what those cost the commander — `damageBySource.ram` in a report */
  ramPointsPerEpisode: number;
  /** episodes in which the target was hit at least once */
  episodesWithARam: number;
  /** contacts between two pirates per episode — a different failure */
  shipOnShipPerEpisode: number;
  /** completed attack runs, per pirate per episode, so it compares to flight-probe */
  passesPerPirate: number;
  rangeP10: number;
  rangeMedian: number;
  rangeP90: number;
  /** how fast the target actually went, so "moving" is not taken on trust */
  targetMeanSpeed: number;
}

export function ramProbe(
  behaviour: TargetBehaviour, episodes: number,
  pirates = PIRATES, hull: TargetHullId = 'playerCobra',
): RamShape {
  let rams = 0;
  let withARam = 0;
  let shipOnShip = 0;
  let passes = 0;
  let pirateEpisodes = 0;
  const ranges: number[] = [];
  const speeds: number[] = [];
  const pilot = pilotFor(behaviour);

  for (let e = 0; e < episodes; e++) {
    // One at a time: the episode seeds the world's PRNG in its constructor, so
    // interleaving two of them would braid their dice.
    const ep = new Episode({
      seed: RAM_PROBE_BASE + e * 7919,
      pirates: Array.from({ length: pirates }, () => ({ kind: 'scripted' }) as Controller),
      trader: pilot,
      traderArmed: false,
      traderClass: hull,
      maxTime: EPISODE_SECONDS,
      escapeRange: NO_ESCAPE,
    });
    ep.setup();
    const gap = new THREE.Vector3();
    // One distance series per pirate: `countPasses` is a hysteresis and has to
    // see one ship's whole approach, not five ships' interleaved.
    const track: number[][] = ep.pirates.map(() => []);
    while (!ep.done) {
      ep.step(FIXED_DT);
      ep.pirates.forEach((p, i) => {
        if (!p.alive) return;
        const d = gap.copy(ep.trader.pos).sub(p.pos).length();
        track[i].push(d);
        ranges.push(d);
      });
      speeds.push(ep.trader.speed);
    }
    rams += ep.traderRams;
    if (ep.traderRams > 0) withARam += 1;
    // Everything the pirates lost, less what the target's own hull cost them:
    // with the target unarmed, contact is the only thing that can hurt a
    // pirate, so the remainder is ship-on-ship.
    const contacts = ep.pirates.reduce((a, p) => a + p.damageTaken, 0) / IMPACT.ram.ship;
    shipOnShip += Math.max(0, contacts - ep.traderRams);
    for (const t of track) { passes += countPasses(t); pirateEpisodes += 1; }
  }

  return {
    behaviour,
    episodes,
    ramsPerEpisode: rams / episodes,
    ramPointsPerEpisode: (rams / episodes) * IMPACT.ram.commander,
    episodesWithARam: withARam,
    shipOnShipPerEpisode: shipOnShip / episodes,
    passesPerPirate: passes / Math.max(1, pirateEpisodes),
    rangeP10: quantile(ranges, 0.1) ?? 0,
    rangeMedian: quantile(ranges, 0.5) ?? 0,
    rangeP90: quantile(ranges, 0.9) ?? 0,
    targetMeanSpeed: speeds.reduce((a, b) => a + b, 0) / Math.max(1, speeds.length),
  };
}

export function printRamShapes(episodes: number): void {
  console.log(`\n## contact against a moving target — ${episodes} held-out episodes,`
    + ` ${PIRATES} scripted pirates, unarmed commander's Cobra\n`);
  console.log('| target | its speed | rams/ep | ram points/ep | eps with a ram |'
    + ' ship-on-ship/ep | passes/pirate | range p10/med/p90 |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const b of ['holds', 'evades', 'weaves'] as TargetBehaviour[]) {
    const s = ramProbe(b, episodes);
    console.log(`| ${b.padEnd(7)} | ${s.targetMeanSpeed.toFixed(0).padStart(9)} | `
      + `${s.ramsPerEpisode.toFixed(2).padStart(7)} | `
      + `${s.ramPointsPerEpisode.toFixed(0).padStart(13)} | `
      + `${`${s.episodesWithARam}/${s.episodes}`.padStart(14)} | `
      + `${s.shipOnShipPerEpisode.toFixed(2).padStart(15)} | `
      + `${s.passesPerPirate.toFixed(2).padStart(13)} | `
      + `${`${s.rangeP10.toFixed(0)}/${s.rangeMedian.toFixed(0)}/${s.rangeP90.toFixed(0)}`.padStart(17)} |`);
  }
  console.log(`\nram points = contacts x IMPACT.ram.commander (${IMPACT.ram.commander}),`
    + ' the figure a CombatSimReport calls damageBySource.ram');
  console.log('the passes column must NOT fall: a run that misses so widely it never'
    + ' threatens has fixed the wrong thing');
}

const isMain = process.argv[1]?.endsWith('ram-probe.ts') ?? false;
if (isMain) {
  const episodes = Number(process.argv[2] ?? 40);
  printRamShapes(Number.isFinite(episodes) ? episodes : 40);
}
