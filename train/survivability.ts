// How long does a PLAYER survive an organised gang?
//
//   node --experimental-strip-types train/survivability.ts [episodes]
//
// The tournament (train/evaluate.ts) answers a different question than it
// looks like it answers. Its defender is `CLASSES.traderCobra`, hp 1.0, and
// core.ts says so plainly: "The sim has no shields." The player has two.
//
// So the headline "a gang kills a defended target in 0.7s" is measured
// against something roughly a third as durable as the commander flying it.
// That is the right call for *training* — shields would have to exist in both
// the sim and the game to keep invariant 2, and every brain was fitted
// without them — but it is the wrong number to make a balance decision from.
//
// This script leaves the sim alone and corrects only the defender's
// durability, from game.ts's actual damage model (applyPlayerDamage):
//
//   fore/aft shield  1.0 each, absorbed first, by facing
//   energy           max 4, and overflow costs energy at 2 per point
//                    of damage -> 2.0 more raw damage absorbed
//   death            when energy hits 0
//
// A player hit consistently from the front therefore soaks 1.0 + 2.0 = 3.0
// raw damage against the sim trader's 1.0; one manoeuvring so hits land on
// both faces soaks 4.0. Regeneration (0.035/s per shield, 0.1-0.2/s energy)
// is ignored: it is worth under a tenth of a point across a fight this short,
// and ignoring it understates the player, which is the safe direction.
//
// Not a substitute for flying it. The real game also has ECM, an escape pod,
// the torus drive, and RAM_GUARD breaking pirates off at knife range — none
// of which exist here. Treat this as the floor, not the answer.

import { Episode, type Controller } from '../src/sim/scenario.ts';
import { brainFromFile, type Brain, type BrainFile } from '../src/sim/policy.ts';
import { readFileSync } from 'node:fs';

const BRAINS = new URL('../src/sim/brains/', import.meta.url);
const load = (name: string): Brain =>
  brainFromFile(JSON.parse(readFileSync(new URL(`${name}.json`, BRAINS), 'utf8')) as BrainFile);

const N = Number(process.argv[2]) || 200;
const DT = 1 / 15;
// distinct from the trainer's stream AND from evaluate.ts's held-out base, so
// this is not scoring on seeds anything was selected against
const SEED_BASE = 918_273;

const pack = load('pirate-pack-r4-selectonly');
const solo = load('pirate-attack-r2');
const jameson = load('jameson-defend');

interface Result { kill: number; ttk: number; lost: number }

function run(pirateBrain: Brain, hp: number, gang: number): Result {
  let kills = 0; let ttk = 0; let lost = 0;
  const pirates: Controller[] = Array.from({ length: gang },
    () => ({ kind: 'policy', brain: pirateBrain }));
  for (let e = 0; e < N; e++) {
    const ep = new Episode({
      seed: SEED_BASE + e * 7919,
      pirates,
      trader: { kind: 'policy', brain: jameson },
      traderArmed: true,
      maxTime: 45,
    });
    // the whole point: a commander is not a cargo hauler
    ep.trader.hp = hp;
    let death = 45;
    while (!ep.done) {
      ep.step(DT);
      if (!ep.trader.alive && death === 45) death = ep.t;
    }
    if (!ep.trader.alive) { kills += 1; ttk += death; }
    for (const p of ep.pirates) if (!p.alive) lost += 1;
  }
  return { kill: kills / N, ttk: kills ? ttk / kills : 45, lost: lost / N };
}

const HP = [
  [1.0, 'sim trader (what the tournament measures)'],
  [3.0, 'player, hits landing on one face'],
  [4.0, 'player, manoeuvring so both shields work'],
] as const;

console.log(`\n${N} episodes per row, defender flies jameson-defend\n`);
for (const gang of [3, 4]) {
  console.log(`## gang of ${gang}\n`);
  console.log('| defender hp | pack brain (gangs) | solo brain (opportunists) |');
  console.log('| --- | --- | --- |');
  for (const [hp, label] of HP) {
    const p = run(pack, hp, gang);
    const s = run(solo, hp, gang);
    const fmt = (r: Result) => `${(r.kill * 100).toFixed(0)}% in ${r.ttk.toFixed(1)}s`;
    console.log(`| ${hp.toFixed(1)} — ${label} | ${fmt(p)} | ${fmt(s)} |`);
  }
  console.log('');
}
console.log('kill% = commander destroyed within 45s · time = mean, of the fights that ended in a kill\n');
