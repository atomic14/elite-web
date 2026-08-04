// How long does a PLAYER survive an organised gang?
//
//   node --experimental-strip-types train/survivability.ts [episodes]
//
// This script used to exist to CORRECT a number. An episode's target was a
// stand-in at hp 1.0 with no shields, roughly a third as durable as the
// commander flying it, so every balance figure the tournament produced was
// measured against the wrong ship — and this file divided the game's own
// `durability()` back into the stand-in's units to ask the question properly.
//
// TODO 29 removed the need. The episode's target IS the commander now: three
// 255-point pools from `game/systems.ts`, hit by `applyDamage`, for
// `npcLaserDamageToPlayer` points off the firing build's own packed byte. There
// is no conversion left to make and no hp to override.
//
// So what this asks now is the question the tournament still cannot: how a
// fight ends against a real GANG, at each size and against each shipped
// pirate policy, in the commander's own points. It reports how much of her
// pools a gang can strip in a fight, how often it gets all the way through,
// and what it costs them — because "kill rate" alone stopped being the
// interesting number the moment a kill stopped being cheap.
//
// POOL RECHARGE IS IN IT NOW (docs/TODO/63), and it is the biggest single thing
// these rows ever left out: a shield face recovers 8.9 points a second, which is
// more than a gang of three lands. The header used to say it was left out
// "because an episode with it in has no gradient", which is an argument about
// the fitness made by changing the world; the episode runs `systems.ts`'s
// `regenerate` now, exactly as the game does. **Every figure this tool printed
// before 2026-08-04 is on the old world and is not comparable with one printed
// after it.**
//
// SHE CARRIES AN E.C.M. NOW (docs/TODO/72), and that is the second-biggest
// thing these rows left out: a warhead is 250 of her 765 points, and until
// today no defence policy had an output that could answer one. It is fitted
// rather than rotated for the same reason `train/defence-fight.ts` fits it —
// the commander being modelled here is one with a combat computer flying her
// ship, which is a fitted commander, and a policy fitted in a world with an
// E.C.M. and measured in one without is being scored on a distribution nothing
// trained for. **A row printed before 2026-08-04 is on the old world twice
// over.** A policy with no E.C.M. head is unaffected either way, so this does
// not flatter one: it changes nothing at all for `jameson-defend-g1`.
//
// What the real game still has and this does not, all of it favouring the
// player: the escape capsule, the torus drive and a station to run to. Treat
// every row as a floor.
//
// Not a substitute for flying it. `T` at any station is.

import { Episode, type Controller } from '../src/ai-training/scenario.ts';
import { brainFromFile, type Brain, type BrainFile } from '../src/ai-training/policy.ts';
import { readFileSync } from 'node:fs';
import { durability } from '../src/game/systems.ts';
import { MAX_SHIELD } from '../src/constants/pools.ts';
import { FIXED_DT } from '../src/constants/world-clock.ts';

const BRAINS = new URL('../src/ai-training/brains/', import.meta.url);
const load = (name: string): Brain =>
  brainFromFile(JSON.parse(readFileSync(new URL(`${name}.json`, BRAINS), 'utf8')) as BrainFile);

const N = Number(process.argv[2]) || 200;
const DT = FIXED_DT;
// distinct from the trainer's stream AND from evaluate.ts's held-out base, so
// this is not scoring on seeds anything was selected against
const SEED_BASE = 918_273;
const MAX_TIME = 45;

const BRAIN_NAMES = {
  pack: process.env.PACK_BRAIN ?? 'pirate-pack-r4-selectonly',
  solo: process.env.SOLO_BRAIN ?? 'pirate-attack-g3',
  defend: process.env.DEFEND_BRAIN ?? 'jameson-defend-g2',
};
const pack = load(BRAIN_NAMES.pack);
const solo = load(BRAIN_NAMES.solo);
const jameson = load(BRAIN_NAMES.defend);

interface Result {
  /** share of episodes the commander was destroyed in */
  kill: number;
  /** mean seconds to the kill, of the fights that ended in one */
  ttk: number;
  /**
   * Mean share of her three pools STRIPPED OVER THE FIGHT — cumulative, which
   * is `Episode.targetDamageShare()`. It was `1 - trader.hp` at the end, and
   * once the pools come back that answers "how recently was she hit" instead.
   */
  poolLost: number;
  /**
   * Share of episodes a shield face was flattened AT ANY POINT. Watched every
   * step for the same reason: a face that was taken down and recovered is still
   * a face that was taken down, and the end-of-episode reading would miss it.
   */
  shieldDown: number;
  /** attackers destroyed per episode */
  lost: number;
}

function run(pirateBrain: Brain, gang: number): Result {
  let kills = 0; let ttk = 0; let lost = 0; let poolLost = 0; let shieldDown = 0;
  const pirates: Controller[] = Array.from({ length: gang },
    () => ({ kind: 'policy', brain: pirateBrain }));
  for (let e = 0; e < N; e++) {
    const ep = new Episode({
      seed: SEED_BASE + e * 7919,
      pirates,
      trader: { kind: 'policy', brain: jameson },
      traderArmed: true,
      traderClass: 'playerCobra',
      targetEcm: true,
      maxTime: MAX_TIME,
    });
    let death = MAX_TIME;
    let flattened = false;
    while (!ep.done) {
      ep.step(DT);
      if (!ep.trader.alive && death === MAX_TIME) death = ep.t;
      if (ep.trader.sys.foreShield <= 0 || ep.trader.sys.aftShield <= 0) flattened = true;
    }
    if (!ep.trader.alive) { kills += 1; ttk += death; }
    poolLost += ep.targetDamageShare();
    if (flattened) shieldDown += 1;
    for (const p of ep.pirates) if (!p.alive) lost += 1;
  }
  return {
    kill: kills / N,
    ttk: kills ? ttk / kills : MAX_TIME,
    poolLost: poolLost / N,
    shieldDown: shieldDown / N,
    lost: lost / N,
  };
}

console.log(`\n${N} episodes per row · ${MAX_TIME}s · defender flies ${BRAIN_NAMES.defend}`);
console.log(`the commander's own pools: ${durability(true)} points across two ${MAX_SHIELD}-point`
  + ' shields and the bank, recharging as the game does — see the header\n');
console.log('| gang | brain | destroyed | pools stripped | a shield flattened | they lost |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const gang of [1, 2, 3, 4]) {
  for (const [label, brain] of [
    [`${BRAIN_NAMES.solo} (opportunists)`, solo],
    [`${BRAIN_NAMES.pack} (gangs)`, pack],
  ] as const) {
    const r = run(brain, gang);
    console.log(`| ${gang} | ${label} | ${(r.kill * 100).toFixed(0)}% in `
      + `${r.ttk.toFixed(1)}s | ${(r.poolLost * 100).toFixed(0)}% | `
      + `${(r.shieldDown * 100).toFixed(0)}% | ${r.lost.toFixed(2)}/ep |`);
  }
}
console.log('\npools stripped = mean share of fore + aft + bank gone when the fight ended');
console.log('they lost = attackers destroyed per episode, by her guns or their own flying\n');
