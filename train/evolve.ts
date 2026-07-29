// Neuroevolution self-play trainer.
//
//   npm run train -- attack [--opponent trader-evade] [--out pirate-attack-r2]
//   npm run train -- evade  [--opponent pirate-attack-r2] [--out trader-evade-r2]
//   npm run train -- pack   [--out pirate-pack]
//   npm run train -- defend [--opponent pirate-attack-r2] [--out jameson-defend]
//
// WARNING: without --out, each phase writes over the committed brain in
// src/ai-training/brains/ that the game/viewer import. `git checkout src/ai-training/brains`
// restores the shipped ones.
//
// attack: a pirate policy learns to hunt a trader (scripted by default, or a
//         trained evader via --opponent — that's league play).
// evade:  a trader policy learns to survive a trained pirate.
// pack:   3 pirates share one policy (with packmate observations) vs an armed
//         scripted trader — shared reward.
//
// Plain erasable TS — executed with: node --experimental-strip-types
// Population ES: elites survive, offspring are gaussian mutations at mixed
// sigmas, all genomes scored on the same seeds each generation (common
// random numbers keep comparisons fair).

import { mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import {
  Episode, type Controller, type TargetHullId,
} from '../src/ai-training/scenario.ts';
import {
  randomBrain, mutate, brainFromFile, OBS_SIZE, PACK_OBS_SIZE, PACK_WIDE_OBS_SIZE,
  observe, act, makeScratch,
  type Brain, type BrainFile,
} from '../src/ai-training/policy.ts';
import { makeRng } from '../src/game/rng.ts';
import { FIXED_DT } from '../src/game/world-step.ts';

const args = process.argv.slice(2);
const PHASES = ['attack', 'evade', 'pack', 'defend'];
if (!PHASES.includes(args[0])) {
  console.error(`usage: npm run train -- <${PHASES.join('|')}> [--gens N --pop N --eps N --elites N --opponent name --seed-brain name --out name]`);
  process.exit(1);
}
const phase = args[0] as 'attack' | 'evade' | 'pack' | 'defend';
const getArg = (name: string, def: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const getStrArg = (name: string, def: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const GENS = getArg('gens', 300);
const POP = getArg('pop', 48);
const EPISODES = getArg('eps', 3);
const ELITES = getArg('elites', 8);
/**
 * The game's own step. It was 1/15 — chosen when episodes ran in a parallel
 * simulator and four times fewer steps was four times more generations. The
 * episodes now fly the real engine, and the engine's slice is FIXED_DT: at
 * 1/15 a brain re-decides every 0.133s instead of every 0.1, and every
 * `rotateTowards` and collision test is four times coarser. Training at a
 * timestep the game never runs at is the last way left for the trainer to be
 * fitting a world that does not exist.
 *
 * It costs less than it looks: the MLP forward pass dominates and it is
 * capped at 10 Hz by the decision cache, so four times the steps is nothing
 * like four times the work.
 */
const DT = FIXED_DT;
const OUT_NAME = getStrArg('out',
  phase === 'attack' ? 'pirate-attack' : phase === 'evade' ? 'trader-evade' : phase === 'defend' ? 'jameson-defend' : 'pirate-pack');

const BRAINS_DIR = new URL('../src/ai-training/brains/', import.meta.url).pathname;
const LOGS_DIR = new URL('./logs/', import.meta.url).pathname;
mkdirSync(BRAINS_DIR, { recursive: true });
mkdirSync(LOGS_DIR, { recursive: true });

function loadBrain(name: string): Brain {
  const f = JSON.parse(readFileSync(`${BRAINS_DIR}${name}.json`, 'utf8')) as BrainFile;
  console.log(`loaded ${name} (fitness ${f.meta.fitness.toFixed(2)})`);
  return brainFromFile(f);
}

// opponents: evade trains vs a pirate; attack may train vs a trained evader
const opponentName = getStrArg('opponent', phase === 'evade' ? 'pirate-attack' : phase === 'defend' ? 'pirate-attack-r2' : '');
const opponent: Brain | null = opponentName ? loadBrain(opponentName) : null;

// --- round-4 experiment flags -----------------------------------------------
// All three default OFF so runs 4 and 6 rerun bit-identically.
//
//   --wide      pack policies get the 26-input observation (mate health,
//               engagement and flank bearing) instead of the 18-input one.
//   --pool      score each genome against a *rotation* of traders rather than
//               only the scripted one, so it can't specialise into uselessness.
//   --select-kills   rank genomes *within* a generation by kill rate, breaking
//               ties on shaped fitness, instead of ranking by shaped fitness.
//   --validate-select  choose the brain we keep by re-judging every generation
//               champion on one fixed validation seed set, instead of trusting
//               a training score that isn't comparable across generations.
//               Kept separate from --select-kills so an ablation can hold the
//               final-selection method constant while varying only the ranking.
const WIDE = args.includes('--wide');
const POOL = args.includes('--pool');
/**
 * `--pool` rotates the TRADER, so it only means anything when the genome is a
 * pirate.
 *
 * In `evade` the genome IS the trader, and `traderPool` is consumed as the
 * trader controller — so the pool replaces the very candidate being scored.
 * A 300-generation run with it produced a brain that never throttles: every
 * one of 282 champions was rejected by flies(), 0% validation survival. It
 * cost eight minutes and looked like a training failure rather than a
 * misused flag. Refuse it instead.
 */
if (POOL && phase !== 'attack' && phase !== 'pack') {
  console.error(`--pool rotates the trader, so it is meaningless for '${phase}'`
    + ' (the genome under test IS the trader). Use --opponent to vary the'
    + ' pirates, or train attack/pack with --pool.');
  process.exit(1);
}
const SELECT_KILLS = args.includes('--select-kills');
const VALIDATE_SELECT = args.includes('--validate-select');

const OBS = phase === 'pack' ? (WIDE ? PACK_WIDE_OBS_SIZE : PACK_OBS_SIZE) : OBS_SIZE;

interface PoolEntry {
  ctrl: Controller;
  /** does this trader shoot back? */
  armed: boolean;
  /** hull it flies; playerCobra has the commander's speed and agility */
  hull?: TargetHullId;
  label: string;
}

/**
 * The opposition. Run 6 refuted "the reward is wrong"; this tests the other
 * half of that failure, which is that a single opponent produces a
 * counter-brain rather than a pilot.
 *
 * Variety means two different things and the pool needs both. Different
 * BEHAVIOUR: a scripted hauler flies a predictable line, the evaders jink.
 * And different THREAT: a trader that shoots back is a completely different
 * problem from one that only runs, and a pirate that has never been shot at
 * has no reason to learn when to break off.
 *
 * That second axis was missing entirely — the attack phase never set
 * traderArmed, so every opponent in the rotation, jameson-defend included,
 * flew unarmed. The pirate was being trained exclusively against victims.
 */
/**
 * Leave one opponent out of the pool, so it can serve as a genuinely unseen
 * test afterwards. Without this every evaluation is in-distribution: the seeds
 * differ but the opponents do not, and "it beats everything it trained on" is
 * a much weaker claim than it looks.
 */
const HOLD_OUT = getStrArg('pool-hold-out', '');

const traderPool: PoolEntry[] = (() => {
  const scripted: PoolEntry = { ctrl: { kind: 'scripted' }, armed: false, label: 'scripted hauler' };
  if (!POOL) return [scripted];
  const pool: PoolEntry[] = [scripted];
  // an armed scripted trader: predictable flying, but it shoots
  pool.push({ ctrl: { kind: 'scripted' }, armed: true, label: 'scripted, armed' });
  // The last two fly the PLAYER's hull. Every brain in this project was
  // trained against traderCobra, which is 1.8x slower and less than half as
  // agile as the commander it actually hunts, so a pursuit curve fitted to a
  // freighter overshoots a player on every pass. Measured in the game, a
  // Sidewinder is lined up on the player for about 5% of a fight.
  // Two runners, added after the sim was found to be a box. The episode had
  // no escape condition, so the target could neither be lost nor get away:
  // closing the distance was worth nothing and only aiming paid. A pirate that
  // never touched its throttle killed 99% of targets, armed or not, and the
  // trainer duly evolved pirates that stand still and pivot — useless against
  // a player who can simply leave.
  //
  // No evolved trader ever learned to run (all of them orbit at ~2100 and
  // die), so the pressure has to be supplied by hand. The catchable runner
  // teaches pursuit; the one on the player's hull cannot be caught at all
  // (260/300 against 400) and teaches the only lesson that is actually true in
  // this game — make the intercept count, because there will not be another.
  for (const [name, armed, hull] of [
    ['trader-evade', false, 'traderCobra'],       // the one free target left
    ['trader-evade-r2', true, 'playerCobra'],     // player agility, shoots back
    ['jameson-defend', true, 'playerCobra'],      // fights properly
    ['jameson-defend', true, 'playerCobraSlow'],  // slow knife-fight, shoots
  ] as const) {
    if (name === HOLD_OUT) { console.log(`(pool) holding out ${name}`); continue; }
    try {
      pool.push({ ctrl: { kind: 'policy', brain: loadBrain(name) }, armed, hull,
        label: `${name}/${hull}` });
    } catch {
      console.log(`(pool) ${name} unavailable — skipping`);
    }
  }
  for (const hull of ['traderCobra', 'playerCobra'] as const) {
    pool.push({ ctrl: { kind: 'runner' }, armed: false, hull, label: `runner/${hull}` });
  }
  // The knife-fighter, and the reason g1 needed a second pass: nothing in the
  // pool ever went slower than about 90, because a policy flying the slow hull
  // still cruises at its maximum. Chris fights at a median of 66 and stops to
  // turn, and against a stationary target g1 throttled forward on 19% of
  // frames — it hung at ~430 units and pivoted. It looked exactly like the
  // degenerate run-11 brain, and for the same reason: out of distribution.
  pool.push({ ctrl: { kind: 'holding' }, armed: true, hull: 'playerCobra',
    label: 'holding/playerCobra' });
  console.log(`(pool) ${pool.length} opponents: ${pool.map((e) => e.label).join(', ')}`);
  return pool;
})();

function makeEpisodeFor(genome: Brain, seed: number): Episode {
  if (phase === 'attack') {
    // --pool rotates the opponent, and for `attack` that is not a refinement,
    // it is the difference between a brain and a counter-brain. Trained
    // against trader-evade-r2 alone, a pirate reached 100% kills against that
    // evader in 4.6s and then managed 9% against the scripted trader, down
    // from the shipped brain's 86.5%. It had not learned to hunt; it had
    // learned to beat one opponent.
    //
    // --opponent still pins a single trader when you want league play, and
    // --pool takes precedence because a rotation including that opponent is
    // strictly more information.
    const pick: PoolEntry = POOL
      ? traderPool[seed % traderPool.length]
      : opponent
        ? { ctrl: { kind: 'policy', brain: opponent }, armed: false, label: 'opponent' }
        : { ctrl: { kind: 'scripted' }, armed: false, label: 'scripted' };
    return new Episode({
      seed,
      pirates: [{ kind: 'policy', brain: genome }],
      trader: pick.ctrl,
      traderArmed: pick.armed,
      traderClass: pick.hull,
    });
  }
  if (phase === 'evade') {
    return new Episode({
      seed,
      pirates: [{ kind: 'policy', brain: opponent! }],
      trader: { kind: 'policy', brain: genome },
    });
  }
  if (phase === 'defend') {
    // armed Jameson vs two of the shipped attack pirates
    return new Episode({
      seed,
      pirates: [{ kind: 'policy', brain: opponent! }, { kind: 'policy', brain: opponent! }],
      trader: { kind: 'policy', brain: genome },
      traderArmed: true,
    });
  }
  // pack: 2-4 ships sharing one policy vs an armed scripted trader. Pack
  // size varies with the seed so the policy can't overfit to exactly three.
  const packSize = 2 + (seed % 3);
  return new Episode({
    seed,
    pirates: Array.from({ length: packSize }, () => ({ kind: 'policy' as const, brain: genome })),
    trader: traderPool[seed % traderPool.length].ctrl,
    traderArmed: true,
    maxTime: 60,
  });
}

function fitnessOf(ep: Episode): number {
  if (phase === 'attack') return ep.fitnessAttack(0);
  if (phase === 'evade') return ep.fitnessEvade();
  if (phase === 'defend') return ep.fitnessDefend();
  return ep.fitnessPack();
}

function evaluate(genome: Brain, gen: number): number {
  let total = 0;
  let wins = 0;
  // same polarity trap as validate(): in evade/defend the genome IS the trader
  const defending = phase === 'evade' || phase === 'defend';
  for (let e = 0; e < EPISODES; e++) {
    const ep = makeEpisodeFor(genome, gen * 977 + e * 131 + 7);
    while (!ep.done) ep.step(DT);
    total += fitnessOf(ep);
    if (defending ? ep.trader.alive : !ep.trader.alive) wins += 1;
  }
  const shaped = total / EPISODES;
  if (!SELECT_KILLS) return shaped;
  // Rank on the behaviour we actually want. A win rate alone is too coarse to
  // hill-climb (EPISODES+1 distinct values), so shaped fitness breaks ties
  // *within* a win count without ever outranking one more win.
  return (wins / EPISODES) * 1000 + Math.max(-499, Math.min(499, shaped));
}

/** Reference: the scripted AI (or scripted trader for evade) on the same seeds. */
function scriptedReference(gen: number): number {
  let total = 0;
  for (let e = 0; e < EPISODES; e++) {
    const seed = gen * 977 + e * 131 + 7;
    let ep: Episode;
    if (phase === 'evade') {
      ep = new Episode({ seed, pirates: [{ kind: 'policy', brain: opponent! }], trader: { kind: 'scripted' } });
    } else if (phase === 'defend') {
      ep = new Episode({
        seed,
        pirates: [{ kind: 'policy', brain: opponent! }, { kind: 'policy', brain: opponent! }],
        trader: { kind: 'scripted' },
        traderArmed: true,
      });
    } else if (phase === 'pack') {
      ep = new Episode({
        seed,
        pirates: [{ kind: 'scripted' }, { kind: 'scripted' }, { kind: 'scripted' }],
        trader: { kind: 'scripted' },
        traderArmed: true,
        maxTime: 60,
      });
    } else {
      const trader: Controller = opponent ? { kind: 'policy', brain: opponent } : { kind: 'scripted' };
      ep = new Episode({ seed, pirates: [{ kind: 'scripted' }], trader });
    }
    while (!ep.done) ep.step(DT);
    total += fitnessOf(ep);
  }
  return total / EPISODES;
}

// NOTE: defend intentionally left sharing attack's stream offset (0) — the
// documented Run 5 was trained with this seed; changing it would make that
// run non-reproducible.
const rng = makeRng(0xe11e + (phase === 'evade' ? 1 : phase === 'pack' ? 2 : 0));

// seed the population: for league rounds, start from the previous best brain
const seedName = getStrArg('seed-brain', '');
let population: Brain[];
if (seedName) {
  const seedBrain = loadBrain(seedName);
  population = [seedBrain, ...Array.from({ length: POP - 1 }, (_, i) =>
    mutate(seedBrain, rng, i % 2 === 0 ? 0.05 : 0.12))];
} else {
  population = Array.from({ length: POP }, () => randomBrain(rng, OBS));
}

const logPath = `${LOGS_DIR}${OUT_NAME}-${Date.now()}.jsonl`;
const started = Date.now();

console.log(`phase=${phase} out=${OUT_NAME} pop=${POP} gens=${GENS} eps=${EPISODES} obs=${OBS}` +
  (opponentName ? ` opponent=${opponentName}` : '') + (seedName ? ` seed-brain=${seedName}` : ''));

let best: Brain = population[0];
let bestFitness = -Infinity;
/** each generation's champion, re-judged on fixed seeds at the end (--select-kills) */
const champions: Brain[] = [];

for (let gen = 0; gen < GENS; gen++) {
  const scored = population
    .map((g) => ({ g, f: evaluate(g, gen) }))
    .sort((a, b) => b.f - a.f);

  const mean = scored.reduce((s, x) => s + x.f, 0) / scored.length;
  if (scored[0].f > bestFitness) {
    bestFitness = scored[0].f;
    best = scored[0].g;
  }
  champions.push(scored[0].g);
  appendFileSync(logPath, JSON.stringify({
    gen, best: +scored[0].f.toFixed(3), mean: +mean.toFixed(3),
    worst: +scored[scored.length - 1].f.toFixed(3),
  }) + '\n');

  if (gen % 10 === 0 || gen === GENS - 1) {
    const ref = scriptedReference(gen);
    console.log(
      `gen ${String(gen).padStart(4)}  best ${scored[0].f.toFixed(2).padStart(7)}  ` +
      `mean ${mean.toFixed(2).padStart(7)}  scripted-ref ${ref.toFixed(2).padStart(7)}  ` +
      `(${((Date.now() - started) / 1000).toFixed(0)}s)`);
  }

  const next: Brain[] = scored.slice(0, ELITES).map((x) => x.g);
  const sigmas = [0.02, 0.06, 0.15];
  while (next.length < POP) {
    const parent = scored[next.length % ELITES].g;
    next.push(mutate(parent, rng, sigmas[next.length % sigmas.length]));
  }
  population = next;
}

// --- final selection --------------------------------------------------------
// Training scores are not comparable across generations: every generation draws
// fresh seeds, so `bestFitness` latches onto whichever generation happened to be
// easiest. That's tolerable when ranking within a generation, but it's the wrong
// way to choose the brain we keep.
//
// So re-judge every generation's champion on ONE fixed seed set. That set is
// distinct from the training stream *and* from the tournament's held-out base
// (10,000,019) — selecting on the tournament seeds would make the tournament a
// training set and its numbers meaningless.
const VALIDATION_BASE = 5_000_011;
const VALIDATION_EPISODES = 24;

/**
 * The behaviour we actually want, per phase.
 *
 * CRITICAL: in `evade` and `defend` the genome IS the trader, so "the trader
 * died" is a FAILURE, not a success. Scoring every phase by trader deaths —
 * as this did originally — selects the evader and the defender that die most
 * often, and it silently wrecked both: trader-evade fell from 14.44 to 2.09
 * and jameson-defend from 22.43 to 1.34 across four retrains before the
 * inversion was spotted. The physics changes were blamed first; they were
 * innocent.
 */
/**
 * Does this genome actually fly?
 *
 * Run 11 reached an 83% validation kill rate while choosing forward throttle on
 * ZERO percent of frames, against a target at any speed. It sat in space
 * rotating and shooting, and it scored because episodes begin with the ships
 * already closing — a brain that coasts and fires can still kill things.
 * Nothing in the selection noticed, because kill rate cannot see a pirate that
 * never moves, and it went into the game where it was immediately obvious to a
 * human and to nobody else.
 *
 * So: sample the controls the policy actually emits and reject a champion
 * whose throttle is constant. A real pursuer varies it.
 */
function flies(genome: Brain): { forward: number; degenerate: boolean } {
  const obs = new Float32Array(PACK_WIDE_OBS_SIZE);
  const scratch = makeScratch();
  let forward = 0;
  let frames = 0;
  // This asks the POLICY a question, not the world: it wants the controls a
  // brain emits across a spread of geometries, so it needs an observation and
  // nothing else. No ships are flown, so nothing here needs the engine —
  // which is why it survived the simulator's deletion as plain views.
  const view = (maxSpeed: number, turnRate: number, z: number, speed: number) => ({
    pos: { x: 0, y: 0, z }, quat: { x: 0, y: 0, z: 0, w: 1 },
    speed, laserTemp: 0, laserCooldown: 0, pitchRate: 0, rollRate: 0,
    cls: { maxSpeed, turnRate },
  });
  // a spread of geometries and target speeds, not one canned setup
  for (const targetSpeed of [0, 90, 220, 400]) {
    // the freighter and the commander: the two hulls the pool trains against
    for (const [maxSpeed, turnRate] of [[220, 0.5], [400, 1.036]] as const) {
      const me = view(260, 0.8, 1800, 200);
      const tgt = view(maxSpeed, turnRate, 0, targetSpeed);
      for (let i = 0; i < 60; i++) {
        const c = act(genome, observe(me, tgt, obs), scratch);
        if (c.throttle > 0) forward += 1;
        frames += 1;
        me.pos.z -= 25;
      }
    }
  }
  const share = forward / frames;
  // Only the low end. Always accelerating is what a pursuer does — the
  // shipped brain throttles forward 100% of the time and works fine.
  return { forward: share, degenerate: share < 0.05 };
}

function validate(genome: Brain): { win: number; shaped: number } {
  const defending = phase === 'evade' || phase === 'defend';
  let win = 0;
  let shaped = 0;
  for (let e = 0; e < VALIDATION_EPISODES; e++) {
    const ep = makeEpisodeFor(genome, VALIDATION_BASE + e * 7919);
    while (!ep.done) ep.step(DT);
    if (defending ? ep.trader.alive : !ep.trader.alive) win += 1;
    shaped += fitnessOf(ep);
  }
  return { win: win / VALIDATION_EPISODES, shaped: shaped / VALIDATION_EPISODES };
}

if (VALIDATE_SELECT && champions.length) {
  // de-duplicate: elites survive unchanged, so the same champion recurs
  const unique = [...new Set(champions)];
  console.log(`\nfinal selection: re-judging ${unique.length} generation champions ` +
    `on ${VALIDATION_EPISODES} fixed validation seeds (base ${VALIDATION_BASE})`);
  let bestScore = -Infinity;
  let bestWin = 0;
  let bestForward = 0;
  let rejected = 0;
  for (const c of unique) {
    // A champion that never varies its throttle is not a pilot, whatever it
    // scored. Checked before the kill rate is even consulted, because the kill
    // rate is exactly what failed to notice this in run 11.
    const f = flies(c);
    if (f.degenerate) { rejected += 1; continue; }
    const v = validate(c);
    const score = v.win * 1000 + Math.max(-499, Math.min(499, v.shaped));
    if (score > bestScore) {
      bestScore = score;
      bestWin = v.win;
      best = c;
      bestFitness = v.shaped;
      bestForward = f.forward;
    }
  }
  if (rejected) {
    console.log(`rejected ${rejected} of ${unique.length} champions for constant throttle ` +
      `(see flies(): run 11 shipped one of these)`);
  }
  if (bestScore === -Infinity) {
    console.log('EVERY champion was degenerate — nothing worth saving from this run');
  }
  const metric = (phase === 'evade' || phase === 'defend') ? 'survival' : 'kill';
  console.log(`selected champion: ${(bestWin * 100).toFixed(0)}% validation ${metric} rate ` +
    `(shaped ${bestFitness.toFixed(2)}, throttles forward ${(bestForward * 100).toFixed(0)}% of the time)`);
}

const out: BrainFile = {
  meta: {
    name: OUT_NAME,
    phase,
    trainedAt: new Date().toISOString(),
    generations: GENS,
    fitness: +bestFitness.toFixed(3),
    hyperparams: { pop: POP, episodes: EPISODES, elites: ELITES, dt: +DT.toFixed(4) },
    obsSize: best.obsSize,
    hidden: best.hidden,
  },
  weights: Array.from(best.weights).map((w) => +w.toFixed(5)),
};
const outPath = `${BRAINS_DIR}${OUT_NAME}.json`;
try {
  readFileSync(outPath);
  console.log(`NOTE: overwriting existing brain ${OUT_NAME}.json (git checkout src/ai-training/brains restores shipped weights)`);
} catch { /* new file */ }
writeFileSync(outPath, JSON.stringify(out));
console.log(`saved ${outPath} (fitness ${bestFitness.toFixed(2)}), log: ${logPath}`);
