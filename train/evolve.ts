// Neuroevolution self-play trainer.
//
//   npm run train -- attack [--opponent trader-evade] [--out pirate-attack-r2]
//   npm run train -- evade  [--opponent pirate-attack-r2] [--out trader-evade-r2]
//   npm run train -- pack   [--out pirate-pack]
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
import { Episode, type Controller } from '../src/sim/scenario.ts';
import {
  randomBrain, mutate, brainFromFile, OBS_SIZE, PACK_OBS_SIZE,
  type Brain, type BrainFile,
} from '../src/sim/policy.ts';
import { makeRng } from '../src/sim/core.ts';

const args = process.argv.slice(2);
const phase = args[0] === 'evade' ? 'evade' : args[0] === 'pack' ? 'pack' : args[0] === 'defend' ? 'defend' : 'attack';
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
const DT = 1 / 15;
const OUT_NAME = getStrArg('out',
  phase === 'attack' ? 'pirate-attack' : phase === 'evade' ? 'trader-evade' : phase === 'defend' ? 'jameson-defend' : 'pirate-pack');

const BRAINS_DIR = new URL('../src/sim/brains/', import.meta.url).pathname;
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

const OBS = phase === 'pack' ? PACK_OBS_SIZE : OBS_SIZE;

function makeEpisodeFor(genome: Brain, seed: number): Episode {
  if (phase === 'attack') {
    const trader: Controller = opponent
      ? { kind: 'policy', brain: opponent }
      : { kind: 'scripted' };
    return new Episode({ seed, pirates: [{ kind: 'policy', brain: genome }], trader });
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
  // pack: 3 ships, one shared policy, armed scripted trader
  return new Episode({
    seed,
    pirates: [
      { kind: 'policy', brain: genome },
      { kind: 'policy', brain: genome },
      { kind: 'policy', brain: genome },
    ],
    trader: { kind: 'scripted' },
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
  for (let e = 0; e < EPISODES; e++) {
    const ep = makeEpisodeFor(genome, gen * 977 + e * 131 + 7);
    while (!ep.done) ep.step(DT);
    total += fitnessOf(ep);
  }
  return total / EPISODES;
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

for (let gen = 0; gen < GENS; gen++) {
  const scored = population
    .map((g) => ({ g, f: evaluate(g, gen) }))
    .sort((a, b) => b.f - a.f);

  const mean = scored.reduce((s, x) => s + x.f, 0) / scored.length;
  if (scored[0].f > bestFitness) {
    bestFitness = scored[0].f;
    best = scored[0].g;
  }
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
writeFileSync(outPath, JSON.stringify(out));
console.log(`saved ${outPath} (fitness ${bestFitness.toFixed(2)}), log: ${logPath}`);
