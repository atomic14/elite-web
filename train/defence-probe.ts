// Is the defender surviving, or is it just running away? — the shape of a
// defence policy's fight, broken down by what made it hard.
//
//   node --experimental-strip-types train/defence-probe.ts [episodes] [brain...]
//
// The pair to `flight-probe.ts`, which asks the same question of an ATTACKER.
// This one is for the policy that flies armed traders and the commander's own
// combat computer, and it exists because two numbers were hiding a third.
//
// ## Why a breakdown rather than an average
//
// `npm run train -- defend` reports one figure — the fraction of the
// commander's pools left, averaged over the validation seeds — and champions
// are chosen on it. Averaged, `jameson-defend-g1` reads about 76%, and two
// retrained policies read 72-75%, so the retrains looked worse and the obvious
// conclusion was that they needed more search.
//
// Broken down, over 400 held-out episodes (2026-08-03, and see the note below —
// these were measured in a world where the commander's pools never came back):
//
//   by pirate count     pools left      pirates killed
//     1                    91.4%             10.2%
//     2                    81.8%              5.4%
//     3                    72.9%              6.8%
//     4                    60.6%             10.5%
//
//   by hull flown
//     playerCobra          76.1%              7.5%
//     playerCobraSlow      77.0%              4.9%
//     traderCobra          76.6%             12.4%
//
// The count is a real gradient. The hull moves the kill rate by 2.5x and moves
// pools-left by nothing at all — so the metric the champion is chosen on cannot
// see it, and widening the training distribution along that axis added search
// space the selector is blind to. That is docs/TODO/65, and this tool is how it
// was found and how a fix is judged.
//
// ## What the columns mean
//
//   pools left     the commander's three 255-point pools at the end, as a
//                  fraction of what they started at. `Episode.trader.hp`, and
//                  the number `evolve.ts` selects champions on.
//   died           episodes the defender did not survive. It saturates — every
//                  shipped policy survives nearly everything — which is exactly
//                  why it is not the interesting column.
//   killed         the share of attacking pirates destroyed. NOT part of the
//                  selection metric today, which is the finding.
//
// ## The numbers above are on the OLD baseline
//
// docs/TODO/63 gave the target `systems.ts`'s `regenerate` — the same call the
// game makes for the commander every frame — so pools-left now measures recovery
// as well as avoidance, and a figure from before 2026-08-04 is not comparable
// with one from after it. They are kept because they are what was measured and
// what docs/TODO/65 was found from; re-run the tool for a current one.
//
// ## The fight it flies
//
// `train/defence-fight.ts`, which `train/evolve.ts` builds the phase's episodes
// from — the same function rather than the same four lines, so this tool cannot
// come to measure a distribution nothing was fitted to. 1 to 4 pirates, one of
// three hulls, beam or military laser, with or without the extra energy unit,
// against the SCRIPTED attack run that every pirate flies since d563e3d. Held-out
// seed bases by default — never `evolve.ts`'s validation base, because a policy
// is selected on that one and quoting it back is asking a brain how it did on
// its own exam.

import { readFileSync } from 'node:fs';
import { Episode } from '../src/ai-training/scenario.ts';
import { brainFromFile, type Brain, type BrainFile } from '../src/ai-training/policy.ts';
import { FIXED_DT } from '../src/game/world-step.ts';
import { defenceFight } from './defence-fight.ts';

const BRAINS = new URL('../src/ai-training/brains/', import.meta.url);

/**
 * Seed bases the trainer never selects on.
 *
 * `evolve.ts` validates on 5,000,011. Two bases rather than one because a
 * single held-out set is still one sample: a policy that beats another on one
 * and loses on the other has not been shown to be better, and this tool should
 * make that visible rather than average it away.
 */
export const HELD_OUT_BASES = [8_675_309, 1_234_577];

export interface Cell { n: number; pools: number; died: number; killed: number }

const blank = (): Cell => ({ n: 0, pools: 0, died: 0, killed: 0 });

/** One defence policy, flown over `episodes` fights from each held-out base. */
export function probeDefence(brain: Brain, episodes: number): {
  overall: Cell;
  byCount: Map<number, Cell>;
  byHull: Map<string, Cell>;
  byLaser: Map<string, Cell>;
  byEnergyUnit: Map<string, Cell>;
} {
  const overall = blank();
  const byCount = new Map<number, Cell>();
  const byHull = new Map<string, Cell>();
  const byLaser = new Map<string, Cell>();
  const byEnergyUnit = new Map<string, Cell>();
  const put = <K>(m: Map<K, Cell>, k: K, c: Cell): void => {
    const cell = m.get(k) ?? blank();
    cell.n += 1; cell.pools += c.pools; cell.died += c.died; cell.killed += c.killed;
    m.set(k, cell);
  };

  for (const base of HELD_OUT_BASES) {
    for (let e = 0; e < episodes; e++) {
      const seed = base + e * 7919;
      const { count, hull, laser, energyUnit } = defenceFight(seed);
      const ep = new Episode({
        seed,
        pirates: Array.from({ length: count }, () => ({ kind: 'scripted' as const })),
        trader: { kind: 'policy', brain },
        traderArmed: true,
        traderClass: hull,
        traderLaser: laser,
        targetEnergyUnit: energyUnit,
      });
      ep.setup();
      while (!ep.done) ep.step(FIXED_DT);

      const one: Cell = {
        n: 1,
        pools: Math.max(0, ep.trader.hp) * 100,
        died: ep.trader.alive ? 0 : 1,
        // as a SHARE of the ships sent, so four pirates and one are comparable
        killed: (ep.pirates.filter((p) => !p.alive).length / count) * 100,
      };
      overall.n += 1; overall.pools += one.pools;
      overall.died += one.died; overall.killed += one.killed;
      put(byCount, count, one);
      put(byHull, hull, one);
      put(byLaser, laser, one);
      put(byEnergyUnit, energyUnit ? 'energy unit' : 'no energy unit', one);
    }
  }
  return { overall, byCount, byHull, byLaser, byEnergyUnit };
}

function row(label: string, c: Cell): string {
  return `  ${label.padEnd(18)}pools ${(c.pools / c.n).toFixed(1).padStart(5)}%`
    + `   died ${String(c.died).padStart(3)}/${String(c.n).padEnd(4)}`
    + `   killed ${(c.killed / c.n).toFixed(1).padStart(5)}%`;
}

export function printDefenceShape(names: string[], episodes: number): void {
  const total = episodes * HELD_OUT_BASES.length;
  console.log(`\n## the shape of a defence — ${total} held-out episodes each`);
  console.log(`   (1-4 scripted pirates · 3 hulls · beam/military · bases `
    + `${HELD_OUT_BASES.join(', ')})`);
  for (const name of names) {
    let brain: Brain;
    try {
      brain = brainFromFile(
        JSON.parse(readFileSync(new URL(`${name}.json`, BRAINS), 'utf8')) as BrainFile);
    } catch (err) {
      console.log(`\n${name}: could not be probed: ${(err as Error).message}`);
      continue;
    }
    const r = probeDefence(brain, episodes);
    console.log(`\n${name}`);
    console.log(row('OVERALL', r.overall));
    console.log('  --- by pirate count (the axis the selection metric CAN see)');
    for (const k of [...r.byCount.keys()].sort()) row2(String(k), r.byCount.get(k)!);
    console.log('  --- by hull flown (moves kills, not pools — see docs/TODO/65)');
    for (const k of [...r.byHull.keys()].sort()) row2(k, r.byHull.get(k)!);
    console.log('  --- by laser');
    for (const k of [...r.byLaser.keys()].sort()) row2(k, r.byLaser.get(k)!);
    // The axis docs/TODO/63 added, and the one the selection metric CAN see:
    // it doubles the bank's recharge, so it moves pools-left directly.
    console.log('  --- by energy unit (recovery rate — see docs/TODO/63)');
    for (const k of [...r.byEnergyUnit.keys()].sort()) row2(k, r.byEnergyUnit.get(k)!);
  }
  console.log('\npools left is what `evolve.ts` selects champions on; killed is not.');
  console.log('a policy that survives by never engaging tops the first column and');
  console.log('bottoms the third — which is the whole of docs/TODO/65.');
}

function row2(label: string, c: Cell): void {
  console.log(row(`  ${label}`, c));
}

const isMain = process.argv[1]?.endsWith('defence-probe.ts') ?? false;
if (isMain) {
  const episodes = Number(process.argv[2] ?? 120);
  const names = process.argv.slice(3);
  printDefenceShape(
    names.length ? names : ['jameson-defend-g1'],
    Number.isFinite(episodes) ? episodes : 120,
  );
}
