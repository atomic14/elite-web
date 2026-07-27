// Project tests — plain Node, no framework.
//
//   npm test
//
// These guard the invariants listed in CLAUDE.md: the 1984 galaxy must stay
// byte-accurate, the market model must match the original's tables, the sim
// must stay deterministic, and the shipped brains must still beat their
// baselines. Everything here is headless (no three.js, no DOM).

import { readFileSync } from 'node:fs';
import {
  generateGalaxy, generateMarket, speciesName, describeSystem, COMMODITIES,
} from '../src/galaxy/galaxy.ts';
import { planetDescription } from '../src/galaxy/goatsoup.ts';
import { LivingGalaxy } from '../src/galaxy/living.ts';
import { Episode } from '../src/sim/scenario.ts';
import { brainFromFile, randomBrain, type BrainFile } from '../src/sim/policy.ts';
import { makeRng } from '../src/sim/core.ts';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// --- the canonical universe -------------------------------------------------

console.log('\ngalaxy generation (1984 fidelity)');
const g1 = generateGalaxy(1);
eq('galaxy 1 has 256 systems', g1.length, 256);
eq('system 7 is Lave', g1[7].name, 'Lave');
eq('Lave is a Rich Agricultural Dictatorship TL:5',
  describeSystem(g1[7]), 'LAVE  TL:5  Rich Agricultural  Dictatorship');
eq('Lave chart position', `${g1[7].x},${g1[7].y}`, '20,173');
eq('system 0 is Tibedied', g1[0].name, 'Tibedied');
eq('Lave inhabitants', speciesName(g1[7]), 'Human Colonials');
eq('Diso inhabitants', speciesName(g1.find((s) => s.name === 'Diso')!), 'Black Furry Felines');
for (const name of ['Diso', 'Leesti', 'Riedquat', 'Zaonce', 'Orerve', 'Reorte', 'Ususor']) {
  check(`canonical system present: ${name}`, g1.some((s) => s.name === name));
}
check('all 8 galaxies generate 256 named systems',
  [1, 2, 3, 4, 5, 6, 7, 8].every((n) => {
    const g = generateGalaxy(n);
    return g.length === 256 && g.every((s) => s.name.length > 0);
  }));
check('galaxy 2 differs from galaxy 1', generateGalaxy(2)[7].name !== g1[7].name);

// --- planet descriptions (goat soup) ----------------------------------------

console.log('\nplanet descriptions');
eq("Lave's canonical description",
  planetDescription(g1[7]),
  'Lave is most famous for its vast rain forests and the Lavian tree grub.');
check('descriptions are deterministic',
  planetDescription(g1[42]) === planetDescription(g1[42]));
check('every system in galaxy 1 gets a sentence',
  g1.every((s) => {
    const d = planetDescription(s);
    return d.length > 12 && d.endsWith('.') && !d.includes('undefined');
  }));
check('descriptions vary across systems',
  new Set(g1.slice(0, 40).map(planetDescription)).size > 25);

// --- living galaxy ----------------------------------------------------------

console.log('\nliving galaxy');
{
  const gradients = COMMODITIES.map((c) => c.gradient);
  const rngA = makeRng(12345);
  const living = new LivingGalaxy(g1);
  living.advance(60, gradients, rngA);
  check('convoys are in flight after two months', living.convoys.length > 0);
  check('convoy list stays bounded', living.convoys.length <= 400);
  check('some systems have drifted from baseline', living.states.size > 0);

  let priceOk = true;
  let anyDrift = false;
  for (const [index] of living.states) {
    for (let i = 0; i < COMMODITIES.length; i++) {
      const m = living.priceMultiplier(index, i);
      if (m < 0.74 || m > 1.26) priceOk = false;
      if (m !== 1) anyDrift = true;
    }
  }
  check('price multipliers stay within ±25% of the 1984 baseline', priceOk);
  check('prices actually move', anyDrift);
  check('danger stays in 0..1',
    [...living.states.values()].every((s) => s.danger >= 0 && s.danger <= 1));

  // determinism + persistence
  const livingB = new LivingGalaxy(g1);
  livingB.advance(60, gradients, makeRng(12345));
  eq('same seed → same day', livingB.day, living.day);
  eq('same seed → same convoy count', livingB.convoys.length, living.convoys.length);

  const restored = new LivingGalaxy(g1);
  restored.load(living.save());
  eq('save/load round-trips the day', restored.day, living.day);
  eq('save/load round-trips convoys', restored.convoys.length, living.convoys.length);
  const sample = [...living.states.keys()][0];
  check('save/load round-trips prices',
    Math.abs(restored.priceMultiplier(sample, 0) - living.priceMultiplier(sample, 0)) < 0.002);

  // piracy must concentrate in lawless space, not merely busy space
  const lawless = new LivingGalaxy(g1);
  lawless.advance(365, gradients, makeRng(999));
  const entries = [...lawless.states.entries()];
  const risky = entries.filter(([, s]) => s.danger > 0.15);
  const avgGovRisky = risky.reduce((sum, [i]) => sum + g1[i].government, 0) / (risky.length || 1);
  check(`dangerous systems are lawless (mean government ${avgGovRisky.toFixed(2)} vs galaxy 3.50)`,
    risky.length >= 5 && avgGovRisky < 2.5);
  const anarchy = entries.filter(([i]) => g1[i].government === 0).map(([, s]) => s.danger);
  const corporate = entries.filter(([i]) => g1[i].government === 7).map(([, s]) => s.danger);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  check('anarchies are more dangerous than corporate states',
    mean(anarchy) > mean(corporate) + 0.05);
  check('Lave stays safe for new commanders', lawless.danger(7) < 0.35);

  // pressure decays back toward baseline when trade stops
  const quiet = new LivingGalaxy(g1);
  const st = quiet.state(7);
  st.pressure[0] = 0.9;
  quiet.advance(40, gradients, () => 1); // rng()=1 → no new convoys
  check('pressure decays back toward the baseline', Math.abs(st.pressure[0]) < 0.01);
}

// --- market model -----------------------------------------------------------

console.log('\nmarket model');
const laveMarket = generateMarket(g1[7], 0);
eq('17 commodities', laveMarket.length, COMMODITIES.length);
check('agricultural food is cheap (< 6.0 Cr)', laveMarket[0].price < 6);
check('agricultural computers are dear (> 80 Cr)', laveMarket[7].price > 80);
const leesti = g1.find((s) => s.name === 'Leesti')!;
const leestiMarket = generateMarket(leesti, 0);
check('industrial computers cheaper than agricultural',
  leestiMarket[7].price < laveMarket[7].price);
check('industrial food dearer than agricultural',
  leestiMarket[0].price > laveMarket[0].price);
check('quantities stay within a byte-masked range',
  laveMarket.every((m) => m.quantity >= 0 && m.quantity <= 63));

// --- simulation determinism -------------------------------------------------

console.log('\nsimulation');
const DT = 1 / 15;
function runEpisode(seed: number): string {
  const ep = new Episode({
    seed,
    pirates: [{ kind: 'scripted' }],
    trader: { kind: 'scripted' },
  });
  while (!ep.done) ep.step(DT);
  return `${ep.t.toFixed(4)}|${ep.trader.hp.toFixed(4)}|${ep.pirates[0].shotsFired}`;
}
eq('identical seeds produce identical episodes', runEpisode(4242), runEpisode(4242));
check('different seeds produce different episodes', runEpisode(1) !== runEpisode(2));

// --- the shipped brains still beat their baselines ---------------------------

console.log('\ntrained policies (held-out seeds)');
const BRAINS = new URL('../src/sim/brains/', import.meta.url).pathname;
const load = (n: string) =>
  brainFromFile(JSON.parse(readFileSync(`${BRAINS}${n}.json`, 'utf8')) as BrainFile);
const pirateR2 = load('pirate-attack-r2');
const jameson = load('jameson-defend');
const HOLD_OUT = 10_000_019;
const N = 12;

function killRate(makeEp: (seed: number) => Episode): number {
  let kills = 0;
  for (let e = 0; e < N; e++) {
    const ep = makeEp(HOLD_OUT + e * 7919);
    while (!ep.done) ep.step(DT);
    if (!ep.trader.alive) kills += 1;
  }
  return kills / N;
}

const shippedPirateKills = killRate((seed) => new Episode({
  seed, pirates: [{ kind: 'policy', brain: pirateR2 }], trader: { kind: 'scripted' },
}));
const randomPirateKills = killRate((seed) => new Episode({
  seed, pirates: [{ kind: 'policy', brain: randomBrain(makeRng(seed)) }], trader: { kind: 'scripted' },
}));
check(`shipped pirate kills most targets (${(shippedPirateKills * 100).toFixed(0)}%)`,
  shippedPirateKills >= 0.7);
check(`untrained policy kills almost nothing (${(randomPirateKills * 100).toFixed(0)}%)`,
  randomPirateKills <= 0.1);
check('shipped pirate beats the untrained baseline',
  shippedPirateKills > randomPirateKills + 0.5);

const twoPirates = () => [
  { kind: 'policy' as const, brain: pirateR2 },
  { kind: 'policy' as const, brain: pirateR2 },
];
const jamesonDeaths = killRate((seed) => new Episode({
  seed, pirates: twoPirates(), trader: { kind: 'policy', brain: jameson }, traderArmed: true,
}));
const scriptedDeaths = killRate((seed) => new Episode({
  seed, pirates: twoPirates(), trader: { kind: 'scripted' }, traderArmed: true,
}));
check(`Jameson defence survives most 2v1 fights (dies ${(jamesonDeaths * 100).toFixed(0)}%)`,
  jamesonDeaths <= 0.35);
check(`scripted trader dies far more often (${(scriptedDeaths * 100).toFixed(0)}%)`,
  scriptedDeaths > jamesonDeaths + 0.3);

// --- brain files are well-formed --------------------------------------------

console.log('\nbrain files');
for (const name of ['pirate-attack', 'pirate-attack-r2', 'trader-evade',
  'trader-evade-r2', 'pirate-pack', 'jameson-defend']) {
  const f = JSON.parse(readFileSync(`${BRAINS}${name}.json`, 'utf8')) as BrainFile;
  const obs = f.meta.obsSize ?? 14;
  const hidden = f.meta.hidden ?? 32;
  const expected = obs * hidden + hidden + hidden * hidden + hidden + hidden * 11 + 11;
  check(`${name}: ${f.weights.length} weights match its declared shape`,
    f.weights.length === expected && f.weights.every((w) => Number.isFinite(w)));
}

// --- result -----------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
