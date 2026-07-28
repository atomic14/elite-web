// Project tests — plain Node, no framework.
//
//   npm test
//
// These guard the invariants listed in CLAUDE.md: the 1984 galaxy must stay
// byte-accurate, the market model must match the original's tables, the sim
// must stay deterministic, and the shipped brains must still beat their
// baselines. Everything here is headless (no three.js, no DOM).

import { readFileSync, readdirSync } from 'node:fs';
import {
  generateGalaxy, generateMarket, speciesName, describeSystem, COMMODITIES,
} from '../src/galaxy/galaxy.ts';
import { planetDescription } from '../src/galaxy/goatsoup.ts';
import { LivingGalaxy } from '../src/galaxy/living.ts';
import { pirateThreat, markOf, memberTier } from '../src/game/contracts.ts';
import { killValue } from '../src/game/commander.ts';
import { Episode, type Controller } from '../src/sim/scenario.ts';
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

// --- who's worth robbing ----------------------------------------------------

console.log('\npirate economics');
{
  const fixed = () => 0.5; // take the rng out of it
  const mk = (cargo: Record<number, number>, kills = 0, laser = 'pulse', largeBay = false) => {
    const c = new Array(17).fill(0);
    for (const [i, q] of Object.entries(cargo)) c[+i] = q;
    return { cargo: c, kills, equipment: { laser, largeBay } };
  };
  const lave = g1[7];
  const at = (c: ReturnType<typeof mk>, noto = 0) =>
    pirateThreat(lave, 0.1, markOf(c, noto), fixed);

  const broke = at(mk({}));
  const laden = at(mk({ 7: 35 }, 0, 'pulse', true)); // 35t computers, large bay
  check(`an empty hold is not worth robbing (appeal ${broke.appeal.toFixed(2)})`,
    broke.appeal < 0.1 && broke.tier === 0);
  check(`a full hold of computers draws a gang (appeal ${laden.appeal.toFixed(2)})`,
    laden.appeal > 0.8 && laden.tier === 2);
  check('cheap cargo is not a prize',
    at(mk({ 0: 20 })).tier === 0); // 20t of food

  // the deterrence lever: looking dangerous makes you less worth the trouble
  const armed = at(mk({ 7: 35 }, 150, 'military', true));
  check(`a military laser and a reputation lower the tier (${laden.tier} → ${armed.tier})`,
    armed.appeal < laden.appeal - 0.3 && armed.tier < laden.tier);

  // contraband and notoriety both raise it
  check('contraband is worth more than its price alone',
    at(mk({ 6: 10 })).appeal > at(mk({ 5: 10 })).appeal * 0.9);
  check('notoriety raises the reception',
    at(mk({ 7: 10 }), 0.6).appeal > at(mk({ 7: 10 })).appeal + 0.2);

  // the anti-rubber-band rule: threat must grow far slower than the player does
  check(`threat is sub-linear in wealth (${broke.count} → ${laden.count} attackers)`,
    laden.count <= broke.count + 2);
  check('a gang needs the numbers to form',
    !at(mk({ 7: 35 }, 0, 'pulse', true), 0).organised
      || at(mk({ 7: 35 }, 0, 'pulse', true), 0).count >= 3);

  // a gang is ringleaders plus hangers-on, not five Fer-de-Lances — this is
  // what lets gangs be common without being overwhelming
  check('a gang has exactly two ringleaders',
    memberTier(2, 0) === 2 && memberTier(2, 1) === 2 && memberTier(2, 2) === 1);
  check('hangers-on fly a tier below their leaders',
    memberTier(2, 4) === 1 && memberTier(1, 3) === 0);
  check('opportunist groups stay opportunists',
    [0, 1, 2, 3].every((i) => memberTier(0, i) === 0));

  // fame draws challengers: at Dangerous, a share of receptions are people
  // coming for the reputation rather than the cargo
  {
    const famous = { cargo: new Array(17).fill(0), kills: 3000, combatScore: 3000,
      equipment: { laser: 'military', largeBay: false } };
    // empty hold, so nothing here is worth robbing — only the name is
    const rolls = Array.from({ length: 200 }, (_, i) =>
      pirateThreat(lave, 0.1, markOf(famous), () => (i % 100) / 100));
    const challenges = rolls.filter((r) => r.challenged).length;
    check(`a famous commander gets challenged even flying empty (${challenges}/200)`,
      challenges > 30 && challenges < 120);
    const unknown = { ...famous, kills: 0, combatScore: 0 };
    check('an unknown commander with an empty hold is left alone',
      pirateThreat(lave, 0.1, markOf(unknown), fixed).tier === 0);
    check('challengers arrive as an organised gang, not a mugging',
      rolls.filter((r) => r.challenged).every((r) => r.tier === 2));
  }

  // ratings count difficulty, not bodies
  check('a gang leader is worth five Sidewinders', killValue(2) === 5 * killValue(0));
  check('a professional is worth two', killValue(1) === 2);

  // notoriety: spreads to jump-range neighbours, and fades
  const heat = new LivingGalaxy(g1);
  heat.addNotoriety(7, 0.8);
  check('notoriety lands where you sold', heat.notoriety(7) > 0.7);
  const neighbourHeat = [...heat.states.entries()].filter(([i]) => i !== 7 && heat.notoriety(i) > 0);
  check(`word spreads to neighbours (${neighbourHeat.length} systems)`, neighbourHeat.length > 0);
  check('but more faintly than at the source',
    neighbourHeat.every(([, st]) => st.heat < heat.notoriety(7)));
  heat.advance(30, COMMODITIES.map((c) => c.gradient), makeRng(4));
  check('lying low cools you off', heat.notoriety(7) === 0);
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

// --- collision rates --------------------------------------------------------

// The collision round concluded the shipped brains "already fly clear of the
// target, so a rule that punishes contact costs them nothing", from a table
// covering the scripted trader and the Jameson matchups. It did not cover
// pirate versus trained EVADER, and there the claim is false: those two brains
// were both trained before collisions existed, and they ram each other in more
// than half of all fights. Against an unarmed evader the pirate destroys itself
// 17% of the time, which is the evader winning by being flown into.
//
// Asserted here so the numbers are enforced rather than assumed, and so the
// known-bad matchup cannot quietly get worse. Bounds are ceilings on today's
// measured behaviour, not aspirations.

console.log('\ncollision rates');
{
  const COLLISION_DAMAGE = 0.45;
  const rams = (make: () => { pirates: Controller[]; trader: Controller; traderArmed?: boolean },
                episodes: number): number => {
    let total = 0;
    for (let e = 0; e < episodes; e++) {
      const ep = new Episode({ seed: 7000 + e * 11, ...make(), maxTime: 45 });
      while (!ep.done) ep.step(1 / 15);
      // an unarmed trader deals no laser damage, so all pirate damage is contact
      for (const p of ep.pirates) total += p.damageTaken / COLLISION_DAMAGE;
    }
    return total / episodes;
  };

  const pirate = pirateR2;                 // already loaded above
  const evader = load('trader-evade-r2');
  {
    const vScripted = rams(() => ({
      pirates: [{ kind: 'policy', brain: pirate }], trader: { kind: 'scripted' },
    }), 40);
    check(`pirate vs scripted trader rarely collides (${vScripted.toFixed(2)}/episode)`,
      vScripted < 0.3);
  }
  {
    // KNOWN BAD. Kept as a ceiling so it cannot worsen unnoticed; a retrain
    // that fixes it should tighten this number, not delete the check.
    const vEvader = rams(() => ({
      pirates: [{ kind: 'policy', brain: pirate }], trader: { kind: 'policy', brain: evader },
    }), 40);
    check(`pirate vs trained evader collisions no worse than known (${vEvader.toFixed(2)}/episode)`,
      vEvader < 1.6);
  }
}

// --- sim/game combat parity (invariant 2) -----------------------------------

// The combat numbers exist twice — src/sim/core.ts and src/game/{npc,game}.ts
// — and CLAUDE.md asks you to change both together. That has been a manual
// promise until now, and it is exactly the kind nobody keeps: the two files
// are edited months apart, drift is silent, and every trained brain was
// fitted to the sim's copy. A balance conclusion drawn from the tournament is
// only as good as this parity.
//
// Read as text rather than imported: npc.ts pulls in three.js and touches
// window, neither of which belongs in this test.

console.log('\nsim/game combat parity');
{
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const core = read('../src/sim/core.ts');
  const npc = read('../src/game/npc.ts');
  const game = read('../src/game/game.ts');

  const num = (src: string, re: RegExp): number | null => {
    const m = src.match(re);
    return m ? Number(m[1]) : null;
  };

  // laser: the sim fires a flat 0.16; the game rolls 0.1 + rand*0.12, whose
  // MEAN must be the same or every trained policy was fitted to a different
  // weapon than the one it flies.
  const simLaser = num(core, /damage:\s*([\d.]+),[\s\S]{0,80}?cooldown/);
  const lo = num(game, /applyPlayerDamage\(([\d.]+) \+ Math\.random\(\)/);
  const spread = num(game, /applyPlayerDamage\([\d.]+ \+ Math\.random\(\) \* ([\d.]+)/);
  check(`laser damage: sim ${simLaser} == game mean ${lo! + spread! / 2}`,
    simLaser !== null && Math.abs(simLaser - (lo! + spread! / 2)) < 1e-9);

  // NPC FIRE RATE — the largest sim/game divergence in the project, and the
  // reason sim lethality numbers overstate NPC threat by roughly five times.
  //
  // The sim gives every ship the player's pulse laser: cooldown 0.24s. The
  // game gates an NPC to `0.9 + random*0.8`, a mean of 1.3s, so a trained
  // brain fires 5.4x slower in the game than in the world it was trained in.
  // Two Sidewinders shooting a stationary player for 30 seconds land 0.75
  // damage, against 1.05 of shield regeneration over the same period: they
  // cannot out-damage the shields they are shooting at.
  //
  // Asserted as a RATIO rather than equality, because the handicap looks
  // deliberate (NPCs are meant to be less dangerous than the player's own
  // gun). The point is that changing either side becomes visible instead of
  // silent, since every brain's behaviour is fitted to the sim's number.
  const simCooldown = num(core, /LASER = \{[\s\S]{0,200}?cooldown:\s*([\d.]+)/);
  // Read the named constants, not the expression. This used to parse
  // `this.fireCooldown = 0.9 + Math.random() * 0.8` directly and broke the
  // moment those numbers were given names — which is the test working, but a
  // constant is the more stable thing to read.
  const npcLo = num(npc, /const NPC_COOLDOWN_LO = ([\d.]+);/);
  const npcSpread = num(npc, /const NPC_COOLDOWN_SPREAD = ([\d.]+);/);
  const npcMean = npcLo! + npcSpread! / 2;
  const ratio = npcMean / simCooldown!;
  check(`NPC fire rate is ${ratio.toFixed(1)}x slower than the sim trains for `
    + `(sim ${simCooldown}s, NPC mean ${npcMean.toFixed(2)}s) — known gap`,
    ratio > 4 && ratio < 7);

  const simCollision = num(core, /COLLISION = \{[\s\S]{0,400}?damage:\s*([\d.]+)/);
  check(`collision damage: sim ${simCollision} appears in game.ts`,
    simCollision !== null && game.includes(`applyPlayerDamage(${simCollision}`));

  // hulls the sim models, and their game counterparts
  for (const [simKey, gameDef, role] of [
    ['pirateCobra', 'COBRA_MK3', 'pirate'],
    ['pirateSidewinder', 'SIDEWINDER', 'pirate'],
    ['traderCobra', 'COBRA_MK3', 'trader'],
  ] as const) {
    const simRow = core.match(new RegExp(`${simKey}:\\s*\\{([^}]+)\\}`))?.[1] ?? '';
    const simHp = Number(simRow.match(/hp:\s*([\d.]+)/)?.[1]);
    const simSpeed = Number(simRow.match(/maxSpeed:\s*([\d.]+)/)?.[1]);
    const simTurn = Number(simRow.match(/turnRate:\s*([\d.]+)/)?.[1]);
    // the game's table is grouped by role, so search within that group
    const group = npc.match(new RegExp(`${role}:\\s*\\[([\\s\\S]*?)\\n  \\]`))?.[1] ?? '';
    const row = group.split('\n').find((l) => l.includes(`def: ${gameDef},`)) ?? '';
    const hp = Number(row.match(/hp:\s*([\d.]+)/)?.[1]);
    const speed = Number(row.match(/maxSpeed:\s*([\d.]+)/)?.[1]);
    const turn = Number(row.match(/turnRate:\s*([\d.]+)/)?.[1]);
    check(`${simKey}: hp ${simHp}/${hp}, speed ${simSpeed}/${speed}, turn ${simTurn}/${turn} match`,
      simHp === hp && simSpeed === speed && simTurn === turn);
  }
}

// --- inhabitant portraits ---------------------------------------------------

// The game builds these paths at runtime from a system's index and name
// (screens.ts portraitUrl), while the files are written offline by
// tools/generate-species.py. That is a filename convention shared by two
// programs with nothing connecting them: rename a system, change the padding,
// or regenerate half a galaxy, and the portraits silently stop appearing —
// there is no error, just the old text-only page. So assert the mapping.

console.log('\ninhabitant portraits');
{
  const dir = new URL('../public/species/', import.meta.url);
  const url = (s: { index: number; name: string }) =>
    `${String(s.index).padStart(3, '0')}-${s.name.toLowerCase()}.png`;
  const have = new Set(readdirSync(dir).filter((f) => f.endsWith('.png')));
  const missing = g1.filter((s) => !have.has(url(s)));
  const stray = [...have].filter((f) => !g1.some((s) => url(s) === f));
  check(`every galaxy 1 system has a portrait (${g1.length - missing.length}/${g1.length})`,
    missing.length === 0);
  check(`no unreferenced portrait files (${stray.length} stray)`, stray.length === 0);
}

// --- result -----------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
