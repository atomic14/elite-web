// How long does a PLAYER survive an organised gang?
//
//   node --experimental-strip-types train/survivability.ts [episodes]
//
// The tournament (train/evaluate.ts) answers a different question than it
// looks like it answers. Its defender flies the trader Cobra's hull at hp 1.0
// with no shields; the player has two, plus four points of energy behind them.
//
// So the headline "a gang kills a defended target in 0.7s" is measured
// against something roughly a third as durable as the commander flying it.
// That is deliberate: an episode's target carries raw hp so that this script
// can set it (see `playerHull` in ai-training/scenario.ts), and every brain
// was fitted that way. It is still the wrong number to make a balance
// decision from.
//
// This script leaves the episode alone and corrects only the defender's
// durability, IMPORTED from the game's own damage model (game/systems.ts).
//
// It used to be transcribed here by hand, in a comment: "fore/aft shield 1.0
// each, absorbed first by facing; energy max 4, overflow at 2 per point". Every
// balance figure this project has quoted rested on that transcription still
// matching the code. It now calls durability() instead, so it cannot drift.
//
// TWO SCALES MEET HERE, and the conversion is named rather than assumed. The
// commander's banks are 255-point pools since TODO 27; an episode's target is
// still the pre-TODO-27 normalized stand-in (`ai-training/scenario.ts`), and so
// is the damage the episode's pirates roll at it. So the game's durability is
// divided back by PLAYER_ENERGY_PER_LEGACY_POINT — the same constant the TODO
// 28 bridge multiplies by — to say what it is worth in the units this episode
// actually speaks. TODO 29 moves the episode and this division goes with it.
//
// The commander soaks one shield plus the whole bank from the front, two
// shields plus the bank when manoeuvring. Regeneration is ignored: it is worth
// a few points across a fight this short, and ignoring it understates the
// player, which is the safe direction.
//
// Not a substitute for flying it. The real game also has ECM, an escape pod,
// the torus drive, and RAM_GUARD breaking pirates off at knife range — none
// of which exist here. Treat this as the floor, not the answer.

import { Episode, type Controller } from '../src/ai-training/scenario.ts';
import { brainFromFile, type Brain, type BrainFile } from '../src/ai-training/policy.ts';
import { readFileSync } from 'node:fs';
import { durability, PLAYER_ENERGY_PER_LEGACY_POINT } from '../src/game/systems.ts';
import { FIXED_DT } from '../src/game/world-step.ts';

const BRAINS = new URL('../src/ai-training/brains/', import.meta.url);
const load = (name: string): Brain =>
  brainFromFile(JSON.parse(readFileSync(new URL(`${name}.json`, BRAINS), 'utf8')) as BrainFile);

const N = Number(process.argv[2]) || 200;
const DT = FIXED_DT;
// distinct from the trainer's stream AND from evaluate.ts's held-out base, so
// this is not scoring on seeds anything was selected against
const SEED_BASE = 918_273;

const pack = load(process.env.PACK_BRAIN ?? 'pirate-pack-r4-selectonly');
const solo = load(process.env.SOLO_BRAIN ?? 'pirate-attack-r2');
const jameson = load(process.env.DEFEND_BRAIN ?? 'jameson-defend');

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

// From game/systems.ts, not from a comment: change the shield or energy model
// and this table follows it. The division is the scale seam described above.
const inEpisodeUnits = (poolPoints: number): number =>
  poolPoints / PLAYER_ENERGY_PER_LEGACY_POINT;
const HP = [
  [1.0, 'sim trader (what the tournament measures)'],
  [inEpisodeUnits(durability(false)), 'player, hits landing on one face'],
  [inEpisodeUnits(durability(true)), 'player, manoeuvring so both shields work'],
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
