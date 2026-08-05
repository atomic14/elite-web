// Neuroevolution self-play trainer.
//
//   npm run train -- attack [--opponent trader-evade] [--out pirate-attack-g4]
//   npm run train -- evade  [--opponent pirate-attack-g3] [--out trader-evade-r3]
//   npm run train -- pack   [--out pirate-pack-r5]
//   npm run train -- defend [--opponent pirate-attack-g3] [--out jameson-defend-g2]
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
  randomBrain, mutate, brainFromFile, widenBrain, act, makeScratch,
  OBS_SIZE, DEFEND_OBS_SIZE, PACK_OBS_SIZE, PACK_WIDE_OBS_SIZE,
  OUT_SIZE, DEFEND_OUT_SIZE, HIDDEN,
  type Brain, type BrainFile,
} from '../src/ai-training/policy.ts';
import { observeFor, shipView, type ShipView } from '../src/ai-training/observation.ts';
import { makeRng } from '../src/game/rng.ts';
import { FIXED_DT } from '../src/constants/world-clock.ts';
import { defenceFight } from './defence-fight.ts';
// WHAT A CHAMPION IS CHOSEN BY is `train/selection.ts` — the outcome per phase,
// the shaping term and the stated ratio between them. It is a separate file
// because the rule has to be assertable and this one trains on import;
// `test/selection.test.ts` is what asks it questions (docs/TODO/65).
import {
  championScore, outcomeOf, defenceTerms, shapedContribution,
  SHAPED_SHARE, type Phase,
} from './selection.ts';

const args = process.argv.slice(2);
const PHASES = ['attack', 'evade', 'pack', 'defend'];
if (!PHASES.includes(args[0])) {
  console.error(`usage: npm run train -- <${PHASES.join('|')}> [--gens N --pop N --eps N --elites N --opponent name --seed-brain name --out name]`);
  process.exit(1);
}
const phase = args[0] as Phase;
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
/**
 * Where the run lands, and by default that is THE SHIPPED BRAIN — which is what
 * CLAUDE.md has always warned it was, and what it did not do.
 *
 * The defaults were `pirate-attack`, `jameson-defend` and `pirate-pack`: three
 * names the game has not flown since generation 3, so a run with no `--out`
 * quietly produced a fourth weights file rather than the loud overwrite the
 * warning describes. Since TODO 57 the directory IS the shipped set and
 * `npm test` says so, so a stray file is now caught rather than accumulated —
 * but the honest default is still the file the phase is FOR. `git checkout
 * src/ai-training/brains` restores, and the run prints a note before it writes.
 *
 * `evade` is the exception and has no shipped counterpart: nothing in the game
 * flies a trader-evade policy, it exists to produce training opponents, and a
 * run of it is expected to leave a file the guard will ask you to decide about.
 */
const OUT_NAME = getStrArg('out',
  phase === 'attack' ? 'pirate-attack-g3'
    : phase === 'evade' ? 'trader-evade'
      : phase === 'defend' ? 'jameson-defend-g2' : 'pirate-pack-r4-selectonly');

const BRAINS_DIR = new URL('../src/ai-training/brains/', import.meta.url).pathname;
const LOGS_DIR = new URL('./logs/', import.meta.url).pathname;
mkdirSync(BRAINS_DIR, { recursive: true });
mkdirSync(LOGS_DIR, { recursive: true });

function loadBrain(name: string): Brain {
  const f = JSON.parse(readFileSync(`${BRAINS_DIR}${name}.json`, 'utf8')) as BrainFile;
  console.log(`loaded ${name} (fitness ${f.meta.fitness.toFixed(2)})`);
  return brainFromFile(f);
}

// Opponents: evade and defend train against a PIRATE, and the default is the one
// the game ships — it was `pirate-attack` and `pirate-attack-r2`, two policies
// nobody flies, and TODO 57 deleted their weights along with the other 29. A
// default naming a file that is not there is a training run that dies on line
// one, and training a defender against a pirate no player meets was the older
// and quieter bug.
//
// `scripted` IS THE DEFAULT NOW, and by that same argument. What a pirate flies
// since d563e3d is the scripted attack run: it closes, goes through the pass,
// extends to a range it rolls per run and comes back. `pirate-attack-g3` holds
// a median range of 240 and makes 0.00 passes, so a defender fitted against it
// was fitted against a threat that no longer exists — the quiet bug above,
// wearing the name of the brain that used to be the fix for it.
//
// It is a NAME rather than a file, so it loads nothing; `opponentController`
// below is the one place that turns either kind into an Episode controller.
const opponentName = getStrArg('opponent',
  phase === 'evade' || phase === 'defend' ? 'scripted' : '');
const SCRIPTED = 'scripted';
const opponent: Brain | null =
  opponentName && opponentName !== SCRIPTED ? loadBrain(opponentName) : null;
if (opponentName === SCRIPTED) console.log('opponent: the scripted attack run (what ships)');

// WHAT A DEFENDER MEETS is `train/defence-fight.ts`, and it is one function
// because three callers must field the same fight: the episode builder, the
// `scriptedReference` this run is judged against, and `train/defence-probe.ts`,
// which measures the finished policy on held-out seeds. It lived here and was
// copied there, with a comment in each telling the reader to keep them in step.
//
/** The opponent as an Episode controller — a policy, or the scripted run. */
const opponentController = (): Controller =>
  (opponentName === SCRIPTED ? { kind: 'scripted' } : { kind: 'policy', brain: opponent! });

// --- round-4 experiment flags -----------------------------------------------
// All three default OFF so runs 4 and 6 rerun bit-identically.
//
//   --wide      pack policies get the 26-input observation (mate health,
//               engagement and flank bearing) instead of the 18-input one.
//   --pool      score each genome against a *rotation* of traders rather than
//               only the scripted one, so it can't specialise into uselessness.
//   --select-kills   rank genomes *within* a generation by the phase's OUTCOME
//               (`selection.ts`), with shaped fitness breaking ties inside it,
//               instead of ranking by shaped fitness alone. It was "by kill
//               rate"; the outcome has been a share rather than a kill since
//               TODO 29 and is a stated composite since docs/TODO/65, and this
//               flag has always been whatever `championScore` is.
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

/**
 * The shape of the genomes this run searches over.
 *
 * `defend` is its own pair since docs/TODO/71 and /72: seventeen inputs, because
 * a defender needs to see how hurt it is and whether a warhead is coming, and
 * thirteen outputs, because it needs a button to answer one with. Nothing else
 * moved — attack and pack search exactly the shapes they always did, which is
 * what keeps the two shipped pirate brains valid.
 */
const OBS = phase === 'pack' ? (WIDE ? PACK_WIDE_OBS_SIZE : PACK_OBS_SIZE)
  : phase === 'defend' ? DEFEND_OBS_SIZE : OBS_SIZE;
const OUT = phase === 'defend' ? DEFEND_OUT_SIZE : OUT_SIZE;

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
  //
  // The POLICY half of the pool is the shipped defence brain on two hulls. It
  // was four rows — two `trader-evade` rounds and `jameson-defend` — and TODO 57
  // deleted three of those weights files as policies nothing flies. They were
  // loaded through the try/catch below, so their absence would have been a
  // silent thinning of the pool rather than an error, which is the worst of the
  // three outcomes: a training run that looks the same and trains against less.
  // Retrain a `trader-evade` brain (`npm run train -- evade`) and add it back
  // here if the variety is wanted.
  for (const [name, armed, hull] of [
    ['jameson-defend-g2', true, 'playerCobra'],      // fights properly
    ['jameson-defend-g2', true, 'playerCobraSlow'],  // slow knife-fight, shoots
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
      pirates: [opponentController()],
      trader: { kind: 'policy', brain: genome },
    });
  }
  if (phase === 'defend') {
    // an armed Jameson against whatever the seed throws at it
    const { count, hull, laser, energyUnit, ecm } = defenceFight(seed);
    return new Episode({
      seed,
      pirates: Array.from({ length: count }, () => opponentController()),
      trader: { kind: 'policy', brain: genome },
      traderArmed: true,
      traderClass: hull,
      traderLaser: laser,
      targetEnergyUnit: energyUnit,
      targetEcm: ecm,
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
  let outcome = 0;
  for (let e = 0; e < EPISODES; e++) {
    const ep = makeEpisodeFor(genome, gen * 977 + e * 131 + 7);
    while (!ep.done) ep.step(DT);
    total += fitnessOf(ep);
    outcome += outcomeOf(phase, ep);
  }
  const shaped = total / EPISODES;
  if (!SELECT_KILLS) return shaped;
  // Rank on the behaviour we actually want, with shaped fitness breaking ties
  // *within* an outcome band rather than ever outranking a better outcome —
  // the same `championScore` the final selection uses, because "the rule that
  // ranks a generation" and "the rule that picks the champion" being two
  // expressions of the same intent is how one of them came to be broken while
  // the other looked fine (docs/TODO/65). The flag still decides WHETHER the
  // outcome ranks a generation at all; it no longer decides how.
  return championScore(phase, outcome / EPISODES, shaped);
}

/** Reference: the scripted AI (or scripted trader for evade) on the same seeds. */
function scriptedReference(gen: number): number {
  let total = 0;
  for (let e = 0; e < EPISODES; e++) {
    const seed = gen * 977 + e * 131 + 7;
    let ep: Episode;
    if (phase === 'evade') {
      ep = new Episode({ seed, pirates: [opponentController()], trader: { kind: 'scripted' } });
    } else if (phase === 'defend') {
      const { count, hull, laser, energyUnit, ecm } = defenceFight(seed);
      ep = new Episode({
        seed,
        pirates: Array.from({ length: count }, () => opponentController()),
        trader: { kind: 'scripted' },
        traderArmed: true,
        traderClass: hull,
        traderLaser: laser,
        targetEnergyUnit: energyUnit,
        targetEcm: ecm,
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
  const loaded = loadBrain(seedName);
  // A seed brain from BEFORE the phase's shape changed is widened rather than
  // refused: the extra weights are zero, so generation 0 flies exactly the
  // policy on disk and the new inputs and the new head start inert. Without
  // this, docs/TODO/71 and /72 would have made `--seed-brain jameson-defend-g1`
  // impossible — and that command is where the only defence policy that has
  // ever fought came from, so the retrain would have changed the search's
  // starting point in the same run it changed the observation.
  const seedBrain = loaded.obsSize === OBS && loaded.outSize === OUT
    ? loaded : widenBrain(loaded, OBS, OUT);
  if (seedBrain !== loaded) {
    console.log(`widened ${seedName} from ${loaded.obsSize} inputs / ${loaded.outSize} `
      + `outputs to ${OBS} / ${OUT} — the new weights are zero, so it starts as itself`);
  }
  population = [seedBrain, ...Array.from({ length: POP - 1 }, (_, i) =>
    mutate(seedBrain, rng, i % 2 === 0 ? 0.05 : 0.12))];
} else {
  population = Array.from({ length: POP }, () => randomBrain(rng, OBS, HIDDEN, 0.5, OUT));
}

const logPath = `${LOGS_DIR}${OUT_NAME}-${Date.now()}.jsonl`;
const started = Date.now();

console.log(`phase=${phase} out=${OUT_NAME} pop=${POP} gens=${GENS} eps=${EPISODES} obs=${OBS} heads=${OUT}` +
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
  const view = (maxSpeed: number, turnRate: number, z: number, speed: number): ShipView => {
    const v = shipView(maxSpeed, turnRate, speed);
    v.pos.z = z;
    return v;
  };
  // A spread of geometries and target speeds, not one canned setup. Since
  // docs/TODO/91 a genome cannot SEE the target's speed directly — the slot is
  // gone — but the speed still reaches slot 7 as the closing rate, so the
  // sweep stays: it asks whether the emitted controls vary across closures,
  // which is precisely the degeneracy this gate exists to catch.
  for (const targetSpeed of [0, 90, 220, 400]) {
    // the freighter and the commander: the two hulls the pool trains against
    for (const [maxSpeed, turnRate] of [[220, 0.5], [400, 1.036]] as const) {
      // ...and, since docs/TODO/71, HEALTHY AND HURT. A defence genome's
      // observation includes its own pools, and this guard would otherwise
      // sample every candidate at whatever was left in the buffer — judging a
      // pilot on an observation the trainer never gives it, which is the exact
      // failure the item warns about. It changes NOTHING for attack and pack:
      // `observeFor` hands them the solo encoder, which does not read these
      // fields, so both passes produce identical observations and identical
      // shares.
      for (const health of [1, 0.35]) {
        const me = view(260, 0.8, 1800, 200);
        me.hp = health;
        me.energy = health;
        const tgt = view(maxSpeed, turnRate, 0, targetSpeed);
        for (let i = 0; i < 60; i++) {
          const c = act(genome, observeFor(genome, me, tgt, null, obs), scratch);
          if (c.throttle > 0) forward += 1;
          frames += 1;
          me.pos.z -= 25;
        }
      }
    }
  }
  const share = forward / frames;
  // Only the low end. Always accelerating is what a pursuer does — the
  // shipped brain throttles forward 100% of the time and works fine.
  return { forward: share, degenerate: share < 0.05 };
}

interface Validation {
  /** the phase's outcome, 0..1 — `selection.ts` */
  outcome: number;
  shaped: number;
  /** the defender's two halves, so a run says WHICH half it won on */
  kept: number;
  broken: number;
  /** episodes the genome did not come out of alive (evade and defend) */
  died: number;
}

function validate(genome: Brain): Validation {
  const v: Validation = { outcome: 0, shaped: 0, kept: 0, broken: 0, died: 0 };
  for (let e = 0; e < VALIDATION_EPISODES; e++) {
    const ep = makeEpisodeFor(genome, VALIDATION_BASE + e * 7919);
    while (!ep.done) ep.step(DT);
    v.outcome += outcomeOf(phase, ep);
    v.shaped += fitnessOf(ep);
    const t = defenceTerms(ep);
    v.kept += t.kept;
    v.broken += t.broken;
    if (!ep.trader.alive) v.died += 1;
  }
  const n = VALIDATION_EPISODES;
  return {
    outcome: v.outcome / n, shaped: v.shaped / n,
    kept: v.kept / n, broken: v.broken / n, died: v.died,
  };
}

if (VALIDATE_SELECT && champions.length) {
  // de-duplicate: elites survive unchanged, so the same champion recurs
  const unique = [...new Set(champions)];
  console.log(`\nfinal selection: re-judging ${unique.length} generation champions ` +
    `on ${VALIDATION_EPISODES} fixed validation seeds (base ${VALIDATION_BASE})`);
  let bestScore = -Infinity;
  let bestValidation: Validation | null = null;
  let bestForward = 0;
  let rejected = 0;
  for (const c of unique) {
    // A champion that never varies its throttle is not a pilot, whatever it
    // scored. Checked before the kill rate is even consulted, because the kill
    // rate is exactly what failed to notice this in run 11.
    const f = flies(c);
    if (f.degenerate) { rejected += 1; continue; }
    const v = validate(c);
    const score = championScore(phase, v.outcome, v.shaped);
    if (score > bestScore) {
      bestScore = score;
      bestValidation = v;
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
  if (bestValidation) {
    const v = bestValidation;
    const metric = (phase === 'evade' || phase === 'defend')
      ? 'of her pools kept' : 'of her pools taken';
    // WHAT THE SCORE IS MADE OF, because the whole of docs/TODO/65 was a term
    // nobody could see contributing 1.9% of a number everybody could.
    console.log(`selected champion: score ${bestScore.toFixed(4)} = outcome `
      + `${v.outcome.toFixed(4)} x ${(1 - SHAPED_SHARE).toFixed(2)} + shaped `
      + `${v.shaped.toFixed(2)} (${(shapedContribution(phase, v.outcome, v.shaped) * 100)
        .toFixed(0)}% of the score)`);
    if (phase === 'defend') {
      console.log(`  she kept ${(v.kept * 100).toFixed(1)}% ${metric}, broke `
        + `${(v.broken * 100).toFixed(1)}% of the attacking force, died ${v.died}/`
        + `${VALIDATION_EPISODES}`);
    } else {
      console.log(`  ${(v.outcome * 100).toFixed(1)}% ${metric}`);
    }
    console.log(`  throttles forward ${(bestForward * 100).toFixed(0)}% of the time`);
  }
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
    outSize: best.outSize,
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
