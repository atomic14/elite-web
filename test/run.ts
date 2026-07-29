// Project tests — plain Node, no framework.
//
//   npm test
//
// These guard the invariants listed in CLAUDE.md: the 1984 galaxy must stay
// byte-accurate, the market model must match the original's tables, the sim
// must stay deterministic, and the shipped brains must still beat their
// baselines. Everything here is headless (no three.js, no DOM).

import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three';
import { traceShot } from '../src/game/shot.ts';
import { dockingOutcome, ROLL_TOLERANCE } from '../src/game/docking.ts';
import {
  checkJump, resolveJump, jumpCost, refusalMessage,
} from '../src/game/hyperspace.ts';
import {
  Ordnance, ordnanceMessage, ECM_ENERGY_COST,
} from '../src/game/ordnance.ts';
import { World } from '../src/game/world.ts';
import {
  WorldStep, massLocked, type StepEvent, type StepHost,
} from '../src/game/world-step.ts';
import { freshState } from '../src/game/state.ts';
import { Persistence, type PersistenceHost } from '../src/game/persistence.ts';
import type { WorldSnapshot } from '../src/game/snapshot.ts';
import {
  newCommander, cargoCapacity, MAX_FUEL, type Contract,
} from '../src/game/commander.ts';
import {
  FUEL_PRICE, fuelNeeded, refuelCost, fuelQuote,
} from '../src/game/shop.ts';
import { equipRows, renderMarket } from '../src/ui/screens.ts';
import { cargoTonnes } from '../src/game/commander.ts';
import { pirateBrainFor, defenceBrain } from '../src/game/brains.ts';
import { compassTarget, hasLaserInView } from '../src/hud/hud-binding.ts';
import {
  dumpCargo, offerBribe, appetiteOf, OPPORTUNIST_FLOOR, GANG_FLOOR,
} from '../src/game/jettison.ts';
import { breachLoss, CARGO_LOSS_CHANCE } from '../src/game/systems.ts';
import { Combat } from '../src/game/combat.ts';
import {
  CONTRABAND, isContraband, contrabandTonnes, carryingContraband,
  fineFor, offenceFor, LEGAL_NAMES,
  CLEAN, OFFENDER, FUGITIVE, OFFENDER_FINE, FUGITIVE_FINE,
} from '../src/game/law.ts';
import {
  WITCHSPACE_ESCAPE_COST, witchspaceChance, distanceTenths,
} from '../src/galaxy/navigation.ts';
import type { CommanderData } from '../src/game/commander.ts';
import {
  stepTrumbles, trumbleMessage, BREED_INTERVAL, MAX_TRUMBLES,
} from '../src/game/trumbles.ts';
import {
  npcHitChance, NPC_HIT_CAP, NPC_HIT_FLOOR, NPC_HIT_BASE, NPC_HIT_FALLOFF,
  NPC_DAMAGE_LO, NPC_DAMAGE_SPREAD,
} from '../src/game/gunnery.ts';
import { seedWorld, random, rngState, restoreRng } from '../src/game/rng.ts';
import { serialiseState, restoreState } from '../src/game/snapshot.ts';
import { ScreenHost, type Screen, type ScreenOutcome } from '../src/ui/screen-host.ts';
import {
  isHostileToPlayer, NpcShip,
  NPC_COOLDOWN_LO, NPC_COOLDOWN_SPREAD, NPC_FIRE_GATE, NPC_LASER_RANGE,
  BRAIN_ACCEL, MIN_CRUISE_FRACTION, BRAIN_RATE_RAMP, BRAIN_RATE_DECAY,
} from '../src/game/npc.ts';
import { PLAYER_SPEED_KEPT, NPC_SPEED_KEPT, RAM_DAMAGE } from '../src/game/collisions.ts';
import { assignNpcTargets } from '../src/game/npc-targeting.ts';
import { SPECS, pirateSpecForTier } from '../src/game/ship-specs.ts';
import { PlayerShip, PLAYER_FLIGHT, rampFlightRate, type FlightDemand } from '../src/player.ts';
import { flightDemand, type FlightControls } from '../src/engine/flight-controls.ts';
import { keymap } from '../src/engine/keymap.ts';
import {
  CombatComputer, CC_ACCEL, CC_MAX_SPEED, CC_MAX_PITCH, CC_MAX_ROLL,
} from '../src/game/combat-computer.ts';
import { COBRA_MK3, SIDEWINDER } from '../src/ships/geometry.ts';

/** Named hulls the sim/game parity check compares, by the name it uses. */
const SHIP_DEFS = { COBRA_MK3, SIDEWINDER };
import { stepEncounters } from '../src/game/encounters.ts';
import {
  stepMissionAtDock, constrictorDestroyed, constrictorLurksHere, missionHeadline,
} from '../src/game/missions.ts';
import { planPopulation, policeFor } from '../src/game/population.ts';
import {
  laserForView, canFire, chargeShot, assistAt, hitCone, canisterCone, LASERS, AIM_ASSIST,
  LASER_RANGE,
  npcPrefersMissile, npcMissileLastStand,
  MISSILE_MIN_RANGE, MISSILE_MAX_RANGE, MISSILE_CHANCE,
  MISSILE_LAST_STAND_HULL, MISSILE_LAST_STAND_GATE, MISSILE_LAST_STAND_MIN_RANGE,
} from '../src/game/gunnery.ts';
import {
  freshSystems, applyDamage, regenerate, durability, updateCabinTemp, scoopFuel,
  LASER_COOL_RATE,
} from '../src/game/systems.ts';
import {
  generateGalaxy, generateMarket, speciesName, describeSystem, COMMODITIES,
} from '../src/galaxy/galaxy.ts';
import { planetDescription } from '../src/galaxy/goatsoup.ts';
import { LivingGalaxy } from '../src/galaxy/living.ts';
import {
  pirateThreat, markOf, memberTier, MAX_CONTRACTS,
  settleContracts, acceptContract, contractMessage,
} from '../src/game/contracts.ts';
import { killValue } from '../src/game/commander.ts';
import { Episode, type Controller } from '../src/ai-training/scenario.ts';
import { brainFromFile, randomBrain, type BrainFile } from '../src/ai-training/policy.ts';
import {
  makeRng, CLASSES, COLLISION, LASER, NPC_GUN, TURN,
  PLAYER_RATE_DECAY, NPC_RATE_DECAY,
} from '../src/ai-training/core.ts';

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
  // Sample a system whose price has ACTUALLY MOVED.
  //
  // This used to take `states.keys()[0]` and commodity 0, whose multiplier is
  // exactly 1.0 — the baseline every LivingGalaxy returns for a system it has
  // never touched. So the check passed whether load() restored the pressures
  // or restored nothing at all, which is the one failure it exists to catch.
  // The control below is what makes it a test: an unloaded galaxy must
  // DISAGREE at the same point.
  let sample = -1;
  let commodity = 0;
  let drift = 0;
  for (const [index] of living.states) {
    for (let i = 0; i < COMMODITIES.length; i++) {
      const d = Math.abs(living.priceMultiplier(index, i) - 1);
      if (d > drift) { drift = d; sample = index; commodity = i; }
    }
  }
  const at = (l: LivingGalaxy) => l.priceMultiplier(sample, commodity);
  check(`a price has drifted far enough to be worth comparing (x${(1 + drift).toFixed(3)})`,
    sample >= 0 && drift > 0.02);
  check(`save/load round-trips prices (${g1[sample]?.name} ${COMMODITIES[commodity]?.name}, `
    + `x${at(living).toFixed(3)})`,
  sample >= 0 && Math.abs(at(restored) - at(living)) < 0.002);
  check('...where a galaxy that never loaded gives the baseline instead (the control)',
    sample >= 0 && Math.abs(at(new LivingGalaxy(g1)) - at(living)) > 0.02);

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
  //
  // The bound was `> legal * 0.9`, which is satisfied by contraband being
  // TEN PER CENT LESS attractive than legal cargo — the opposite of the rule
  // it names, and it would have survived deleting the contraband premium
  // outright. Measured gap is 2.0x, so 1.5x is a real bar with real headroom.
  {
    const narcotics = at(mk({ 6: 10 })).appeal;   // contraband, base 235
    const luxuries = at(mk({ 5: 10 })).appeal;    // legal, base 196
    check(`contraband is worth more than its price alone `
      + `(narcotics ${narcotics.toFixed(3)} vs luxuries ${luxuries.toFixed(3)}, `
      + `${(narcotics / luxuries).toFixed(2)}x)`,
    narcotics > luxuries * 1.5);
    // ...and the same rule with price controlled for, which is the sharper
    // form: slaves are contraband at a base of 40 and still the better prize
    // than furs at 176.
    const slaves = at(mk({ 3: 10 })).appeal;
    const furs = at(mk({ 11: 10 })).appeal;
    check(`...even against legal cargo worth four times as much `
      + `(slaves ${slaves.toFixed(3)} vs furs ${furs.toFixed(3)})`,
    slaves > furs);
  }
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
const BRAINS = new URL('../src/ai-training/brains/', import.meta.url).pathname;
const load = (n: string) =>
  brainFromFile(JSON.parse(readFileSync(`${BRAINS}${n}.json`, 'utf8')) as BrainFile);
/**
 * The brains the GAME actually flies, read from brains.ts rather than typed
 * here.
 *
 * This block used to load 'pirate-attack-r2' and 'jameson-defend'. The game
 * ships 'pirate-attack-g3' and 'jameson-defend-g1' — r2 is the legacy control
 * behind window.__legacyPirates, and 'jameson-defend' is not shipped at all.
 * So the regression gate that exists to stop a bad brain reaching players was
 * measuring two brains that were not in the game. The list is derived now, so
 * retraining under a new name cannot silently orphan the check.
 */
const brainsSrc = readFileSync(new URL('../src/game/brains.ts', import.meta.url), 'utf8');
const shippedBrainFile = (which: string): string => {
  const m = brainsSrc.match(new RegExp(`import ${which}BrainFile from '[^']*brains/([^']+)\\.json'`));
  if (!m) throw new Error(`brains.ts no longer imports a ${which} brain`);
  return m[1];
};
const SHIPPED_PIRATE = shippedBrainFile('pirate');
const SHIPPED_DEFEND = shippedBrainFile('defend');
const shippedPirate = load(SHIPPED_PIRATE);
const jameson = load(SHIPPED_DEFEND);
const HOLD_OUT = 10_000_019;
/**
 * Episodes per baseline check.
 *
 * Was 12, which is 8.3% granularity — too coarse for a 35% bound, and an
 * audit showed three of six neighbouring HOLD_OUT seeds flipped the result.
 * It was measuring luck. 60 costs about a second and the suite runs in one.
 */
const N = 60;

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
  seed, pirates: [{ kind: 'policy', brain: shippedPirate }], trader: { kind: 'scripted' },
}));
const randomPirateKills = killRate((seed) => new Episode({
  seed, pirates: [{ kind: 'policy', brain: randomBrain(makeRng(seed)) }], trader: { kind: 'scripted' },
}));
// Bounds measured at N=60, DT=1/15 (the rate train/evolve.ts fits at) against
// the brains the game actually flies.
//
// The shipped pirate kills ~43% where the old r2 killed ~97%, and that is BY
// DESIGN — generation 3 is the first brain aimed at how the game feels rather
// than at lethality. CLAUDE.md invariant 8: "Lethality is a proxy for threat,
// and threat is not fun." So the bound is a floor on competence, not on
// killing: it must still beat an untrained policy by a mile.
check(`shipped pirate ${SHIPPED_PIRATE} is competent (${(shippedPirateKills * 100).toFixed(0)}%)`,
  shippedPirateKills >= 0.3);
check(`untrained policy kills almost nothing (${(randomPirateKills * 100).toFixed(0)}%)`,
  randomPirateKills <= 0.1);
check('shipped pirate beats the untrained baseline',
  shippedPirateKills > randomPirateKills + 0.25);

// two of whatever the game actually sends at you
const twoPirates = () => [
  { kind: 'policy' as const, brain: shippedPirate },
  { kind: 'policy' as const, brain: shippedPirate },
];
const jamesonDeaths = killRate((seed) => new Episode({
  seed, pirates: twoPirates(), trader: { kind: 'policy', brain: jameson }, traderArmed: true,
}));
const scriptedDeaths = killRate((seed) => new Episode({
  seed, pirates: twoPirates(), trader: { kind: 'scripted' }, traderArmed: true,
}));
// Bounds set from measurement, not hope. The old 0.35 was passing at N=12 on
// one lucky seed (three of six neighbouring seeds flipped it) and went red the
// moment RATE_DECAY was corrected to match the real player. Measured at N=60
// against the SHIPPED pirate, the shipped defence brain dies 48%.
check(`shipped defence ${SHIPPED_DEFEND} survives 2v1 (dies ${(jamesonDeaths * 100).toFixed(0)}%)`,
  jamesonDeaths <= 0.7);
// The real signal, and it is not marginal: a scripted trader dies in EVERY
// one of these fights. This gap is what "the brain works" means.
check(`scripted trader dies far more often (${(scriptedDeaths * 100).toFixed(0)}%)`,
  scriptedDeaths > jamesonDeaths + 0.25);

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

  const pirate = load('pirate-attack-r2');   // the collision study used r2
  const evader = load('trader-evade-r2');
  {
    const vScripted = rams(() => ({
      pirates: [{ kind: 'policy', brain: pirate }], trader: { kind: 'scripted' },
    }), 40);
    check(`pirate vs scripted trader rarely collides (${vScripted.toFixed(2)}/episode)`,
      vScripted < 0.3);
  }
  {
    // WAS known-bad, and the retrain that fixed it tightened the number as
    // this comment asked. The check now measures the SHIPPED brain, because
    // that is what a player meets:
    //
    //   pirate-attack-g3 (shipped)  0.78 rams/episode, self-destructs 15%
    //   pirate-attack-r2 (legacy)   2.00                              57%
    //
    // r2 got worse rather than better, and deliberately: pirate hulls now
    // carry ShipClass.minSpeed and cannot brake below ~43% of top speed, so a
    // brain trained before that rule cannot slow out of a collision. r2 ships
    // only behind window.__legacyPirates, and in the game RAM_GUARD breaks it
    // off at 220 units, which the sim does not model.
    const shipped = load('pirate-attack-g3');
    const vEvader = rams(() => ({
      pirates: [{ kind: 'policy', brain: shipped }], trader: { kind: 'policy', brain: evader },
    }), 40);
    check(`shipped pirate vs trained evader rarely collides (${vEvader.toFixed(2)}/episode)`,
      vEvader < 1.2);
  }
}

// --- the screen contract ----------------------------------------------------

// Real unit tests, not source-regex ones: screen-host.ts touches the DOM only
// inside methods, so it imports cleanly under node. That is deliberate — the
// host is the piece several people will build screens against at once, so its
// behaviour needs to be pinned rather than described.

console.log('\nscreen host');
{
  // enough DOM for runMenuCursor to no-op
  (globalThis as unknown as { document: unknown }).document = {
    querySelectorAll: () => [],
  };

  const made: string[] = [];
  const fake = (id: string, out: ScreenOutcome = 'stay'): Screen => ({
    id: id as Screen['id'],
    open: () => made.push(`open:${id}`),
    render: () => made.push(`render:${id}`),
    input: () => out,
    select: (row: number) => made.push(`select:${id}:${row}`),
  });
  const noInput = { pressed: () => false, injectPress: () => {} } as unknown as Parameters<ScreenHost['update']>[0];

  {
    let base = 0;
    const h = new ScreenHost(() => { base += 1; });
    h.register(fake('market'));
    check('empty stack has no top', h.topId === null && h.depth === 0);
    h.open('market');
    check('open pushes and calls open()', h.topId === 'market' && h.depth === 1 && made.includes('open:market'));
    check('a registered screen is handled', h.handled);
    h.back();
    check('back pops to empty', h.depth === 0 && h.topId === null);
    check('showBase fires when the last screen closes', base === 1);
    h.back();
    check('back on an empty stack does not re-paint the base', base === 1);
  }

  {
    let base = 0;
    const h = new ScreenHost(() => { base += 1; });
    h.register(fake('saves'));
    h.register(fake('naming'));
    h.open('saves'); h.open('naming');
    check('screens stack', h.depth === 2 && h.topId === 'naming');
    h.back();
    check('back returns to the screen underneath', h.topId === 'saves' && h.depth === 1);
    check('the uncovered screen re-paints', made.includes('render:saves'));
    check('showBase does NOT fire while a screen remains', base === 0);
    h.exit();
    check('exit clears the stack and paints the base', h.depth === 0 && base === 1);
  }

  {
    // an id with no implementation: the stack still tracks it, but the caller
    // is told to handle it — this is what lets screens migrate one at a time
    const h = new ScreenHost(() => {});
    h.open('chart');
    check('an unmigrated id still occupies the stack', h.topId === 'chart' && h.depth === 1);
    check('but reports itself unhandled', !h.handled);
    check('update() returns false so the caller falls through', h.update(noInput) === false);
  }

  {
    const h = new ScreenHost(() => {});
    h.register(fake('market', { open: 'data' }));
    h.register(fake('data'));
    h.open('market');
    h.update(noInput);
    check('an { open } outcome pushes', h.topId === 'data' && h.depth === 2);
  }

  {
    const h = new ScreenHost(() => {});
    h.register(fake('market'));
    h.open('market');
    const row = { dataset: { row: '7' } } as unknown as HTMLElement;
    check('a data-row click reaches select()', h.click(row, noInput) && made.includes('select:market:7'));
    const key = { dataset: { key: 'KeyB' } } as unknown as HTMLElement;
    check('a data-key click is consumed as a keystroke', h.click(key, noInput));
  }
}

// --- one owner for the chart metric -----------------------------------------

// The 1984 distance rule had grown three implementations — ui/screens.ts,
// game/contracts.ts and a hand-inlined squared copy in game.ts galacticJump —
// all correct, none the owner, kept in step by nothing. That is invariant 2's
// failure mode, and it bites harder here: test/campaign.ts validates the whole
// economy against its own copy, so a drift would leave the balance harness
// measuring a different game from the one that ships.
//
// galaxy/navigation.ts owns it now. These checks stop it re-forking.

console.log('\nchart metric has one owner');
{
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const files = [
    ['src/ui/screens.ts', read('../src/ui/screens.ts')],
    ['src/game/contracts.ts', read('../src/game/contracts.ts')],
    ['src/game/game.ts', read('../src/game/game.ts')],
    ['test/campaign.ts', read('../test/campaign.ts')],
  ] as const;
  // the metric itself: 4 * sqrt(dx^2 + (dy/2)^2)
  const forked = files.filter(([, src]) => /4 \* Math\.sqrt/.test(src)).map(([n]) => n);
  check(`only navigation.ts implements the distance metric${forked.length ? ' — found in ' + forked.join(', ') : ''}`,
    forked.length === 0);
  // the half-weight-y comparison, which galacticJump used to inline
  const inlined = files.filter(([, src]) => /\(s\.y - from\.y\) \/ 2|dy \* dy/.test(src)).map(([n]) => n);
  check(`nobody re-inlines the squared form${inlined.length ? ' — found in ' + inlined.join(', ') : ''}`,
    inlined.length === 0);
  // and the jump-day formula, which game.ts and campaign.ts each had a copy of
  const days = files.filter(([, src]) => /1 \+ Math\.ceil\([a-zA-Z.()\[\] ]*\/ 20\)/.test(src)).map(([n]) => n);
  check(`only navigation.ts computes jump days${days.length ? ' — found in ' + days.join(', ') : ''}`,
    days.length === 0);

  const nav = read('../src/galaxy/navigation.ts');
  check('navigation.ts imports nothing but the system type',
    (nav.match(/^import /gm) ?? []).length === 1 && /import type \{ StarSystem \}/.test(nav));
}

// --- how busy a system is ---------------------------------------------------

console.log('\nsystem population');
{
  const sys = (government: number) => ({ government, seed: [1, 2, 3] }) as unknown as Parameters<typeof planPopulation>[0];
  const half = () => 0.5;

  check('anarchies have NO police, which is what makes them worth the risk',
    policeFor(0) === 0);
  check('a feudal or multi-government system manages one patrol', policeFor(1) === 1);
  check('anything more organised runs two',
    policeFor(2) === 2 && policeFor(7) === 2);

  {
    // the living galaxy's convoys show up as traffic you can see
    const busy = planPopulation(sys(4), 'arrival', 3, null, half);
    check('convoys the living galaxy is sending become visible traders',
      busy.traders === 3);
    const swamped = planPopulation(sys(4), 'arrival', 99, null, half);
    check('...capped so a system never drowns in them', swamped.traders === 4);
    const quiet = planPopulation(sys(4), 'arrival', 0, null, half);
    check('...and there is always at least one', quiet.traders >= 1);
  }
  {
    const threat = { count: 3 } as unknown as Parameters<typeof planPopulation>[3];
    const arriving = planPopulation(sys(0), 'arrival', 1, threat, half);
    check('a reception is waiting when you arrive', arriving.pirates === 3);
    const launching = planPopulation(sys(0), 'launch', 1, threat, half);
    check('LAUNCHING from a station is safe — nobody organised for you',
      launching.pirates === 0 && launching.threat === null);
  }
}

// --- the world builds without a browser --------------------------------------
//
// CLAUDE.md claimed everything needing a GPU was confined to
// engine/render-stack.ts. It was not: sun.ts painted the corona sprite into a
// document.createElement('canvas') at build time, so World.build() — the
// station, planet and sun that massLocked(), checkHazards(), the docking
// checks and the compass all read — threw under node. An audit found it.
//
// This is the drop-dead requirement for training against the real world step,
// so it gets a test rather than a paragraph.

console.log('\nheadless world');
{
  const sys = generateGalaxy(1)[7];
  const world = new World();
  world.build(sys);
  check('World.build() runs with no document', !!world.scene3d);
  check('...and the station exists to dock with', !!world.station);
  check('...and the planet has a radius the hazard checks can read',
    world.planetRadius > 0);
  check('...and the sun has a position to skim',
    world.sunPos instanceof THREE.Vector3);
  check('...and a launching ship has somewhere to appear',
    world.spawnPosition instanceof THREE.Vector3);

  // and it must still STEP, not just build
  world.spawn('pirate', new THREE.Vector3(0, 0, -900), 1);
  world.update(1 / 60, 0);
  check('...and the world steps headlessly', world.npcs.length === 1);

  world.banishScenery();
  check('witch-space banishes the scenery out of every check',
    world.planetPos.length() > 1e7);
}

// --- and the world STEPS without a browser -----------------------------------
//
// The sequel to the block above, and the drop-dead requirement for training
// against the real engine: the five phases of flight used to be private
// methods of game.ts that called `this.hud.showMessage` fourteen times, so the
// simulation could not advance without a HUD, a keyboard and a WebGL context.
//
// They are world-step.ts now. Everything below constructs the pieces by hand —
// a World, a freshState, an Ordnance and a twelve-method StepHost stub — and
// flies them under node. None of this was expressible before the extraction.

console.log('\nheadless world step');
{
  /** Everything a step needs, plus a log of what it asked the host to do. */
  const arrival = (seed: number) => {
    seedWorld(seed);
    const state = freshState(newCommander());
    state.world.build(state.systems[state.commander.systemIndex]);
    const combat = new Combat(state.world);
    const ordnance = new Ordnance(state.world);
    const scratch = {
      a: new THREE.Vector3(), b: new THREE.Vector3(),
      q: new THREE.Quaternion(), ray: new THREE.Raycaster(),
    };
    const log = {
      deaths: [] as string[], saves: 0, docks: 0, shots: 0, damage: 0, hermits: 0,
    };
    // The host is the ONLY thing standing behind the step, and it is a stub:
    // no Hud, no screens, no localStorage, no renderer.
    const host: StepHost = {
      inFlight: () => log.deaths.length === 0 && log.docks === 0,
      applyPlayerDamage: (amount, from) => {
        log.damage += amount;
        combat.hitPlayer(state.sys, amount, from,
          state.player.position, state.player.quaternion, scratch);
      },
      destroyNpc: (npc) => { combat.destroy(state.commander, npc); },
      wreckNpc: (npc) => { combat.wreck(npc); },
      fireLaser: () => { log.shots += 1; },
      raiseLegal: () => {},
      die: (reason) => { log.deaths.push(reason); },
      dock: () => { log.docks += 1; },
      completeHyperspace: () => {},
      completeRescue: () => {},
      openHermitTrade: () => { log.hermits += 1; },
      autoSave: () => { log.saves += 1; },
    };

    // out at the witchpoint with the planet ahead, which is where an arrival
    // starts — and well clear of the sun, the station and the ground
    state.player.position.copy(state.world.station.position).normalize()
      .multiplyScalar(state.world.planetRadius * 16);
    state.player.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(
      state.player.position, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)));
    state.player.speed = 200;
    for (let i = 0; i < 3; i++) {
      state.world.spawn('pirate',
        state.player.position.clone().add(new THREE.Vector3(320 * (i - 1), 140, -1500)), i);
    }
    state.world.spawn('trader',
      state.player.position.clone().add(new THREE.Vector3(-900, -200, -2600)), 7);
    return { state, ordnance, log, step: new WorldStep(state, ordnance, host) };
  };

  const fly = (r: ReturnType<typeof arrival>, steps: number) => {
    const events: StepEvent[] = [];
    for (let i = 0; i < steps; i++) {
      events.push(...r.step.step(1 / 60, i / 60,
        { demand: { rollRate: 0.3, pitchRate: 0.15, throttle: 1, fire: true }, handsOn: false }));
    }
    return events;
  };

  /** What the run LOOKED like, to the byte — the determinism fixture. */
  const trace = (r: ReturnType<typeof arrival>) => JSON.stringify({
    npcs: r.state.world.npcs.map((n) => [
      n.role, n.hp,
      n.object.position.toArray().map((v) => v.toFixed(6)),
      n.object.quaternion.toArray().map((v) => v.toFixed(6)),
    ]),
    player: [
      r.state.player.position.toArray().map((v) => v.toFixed(6)),
      r.state.player.quaternion.toArray().map((v) => v.toFixed(6)),
      r.state.player.speed,
    ],
    sys: r.state.sys,
    session: r.state.session,
  });

  {
    const run = arrival(20_260_729);
    run.state.session.autoSaveTimer = 0.5;   // 600 steps is 10s; the timer is 20
    const before = run.state.player.position.clone();
    const flew = run.state.world.npcs.map((n) => n.object.position.clone());
    const events = fly(run, 600);

    check('600 steps of the real world run with no Hud, no Input and no renderer',
      run.state.player.position.distanceTo(before) > 100);
    check('...with ships still flying in it', run.state.world.npcs.length >= 3);
    check('...that have actually moved',
      run.state.world.npcs.some((n, i) => flew[i] && n.object.position.distanceTo(flew[i]) > 10));
    check('...the trigger reached the gun through the host', run.log.shots === 600);
    check('...the autosave asked the host rather than localStorage', run.log.saves >= 1);
    check('...and nothing it reported is anything but an event',
      events.every((e) => e.kind === 'message' && typeof e.text === 'string'));
  }

  // the fourteen hud.showMessage calls: the step REPORTS them now
  {
    const run = arrival(4242);
    run.state.session.torusEngaged = true;
    run.state.player.position.copy(run.state.world.station.position)
      .add(new THREE.Vector3(0, 0, 3000));   // inside the 5000-unit mass lock
    const events = fly(run, 1);
    check('a mass lock returns a message instead of calling a HUD',
      events.some((e) => e.kind === 'message' && e.text.startsWith('MASS LOCK')));
    check('...and the torus really disengaged', !run.state.session.torusEngaged);
  }
  {
    const run = arrival(4243);
    run.state.player.position.copy(run.state.world.planetPos);   // straight down
    fly(run, 1);
    check('flying into the ground ends the run through the host',
      run.log.deaths[0] === 'CRASHED INTO THE PLANET');
  }
  {
    const run = arrival(4244);
    run.state.player.position.copy(run.state.world.sunPos);
    fly(run, 1);
    check('...and so does flying into the sun', run.log.deaths[0] === 'FLEW INTO THE SUN');
  }

  // --- determinism: same seed, same inputs, same run -------------------------
  //
  // The step draws from ONE seeded stream (game/rng.ts) — NPC decisions, hit
  // rolls, misses, wrecks, encounter timers. Extracting it must not move a
  // single draw across a branch, and this is what says so.
  {
    const a = arrival(7_777_777);
    fly(a, 600);
    const first = trace(a);
    const b = arrival(7_777_777);
    fly(b, 600);
    check('the same seed and the same inputs give a byte-identical run',
      trace(b) === first);
    check('...and the fixture is not vacuously empty',
      a.state.world.npcs.length > 0 && first.length > 500);
    const c = arrival(8_888_888);
    fly(c, 600);
    check('...while a different seed does not', trace(c) !== first);
  }

  // massLocked() is the flight keys' rule and the torus drive's, and it is one
  // function over the state now rather than a method on the Game.
  {
    const run = arrival(4245);
    run.state.player.position.copy(run.state.world.station.position);
    check('mass lock is a free function over the state', massLocked(run.state));
    run.state.player.position.set(1e7, 1e7, 1e7);
    check('...and out in the deep it is clear', !massLocked(run.state));
  }

  // --- ...and it SAVES without a browser -------------------------------------
  //
  // captureSnapshot/restoreSnapshot were private methods of game.ts, so the
  // only thing this file could say about the save was a grep for field NAMES —
  // which is exactly the check that passed through all four historical "two
  // reloads agree with each other but not with the run they came from" bugs.
  //
  // They are persistence.ts now, behind a six-method host, so the real save can
  // be taken and put back under node: fly a world, capture it THROUGH JSON,
  // restore into a FRESH state, and demand the restored world continues the run
  // rather than merely resembling it.
  {
    const stubHost = (state: ReturnType<typeof freshState>, log: string[]): PersistenceHost => ({
      baseMode: () => 'flight',
      enterMode: (mode) => { log.push(`mode:${mode}`); },
      buildWorld: () => {
        state.world.build(state.systems[state.commander.systemIndex]);
        log.push('build');
      },
      enterWitchspace: () => { log.push('witchspace'); },
      isDead: () => false,
      message: (text) => { log.push(`say:${text}`); },
    });

    const a = arrival(31_337);
    // Re-spawn the pirates the way the GAME spawns them: with the hull their
    // threat tier calls for. The restore picks a pirate's hull back out of
    // `pirateSpecForTier(state.threatTier, seed)` — the tier is saved, the hull
    // is not — so a pirate spawned off the default roster comes back with a
    // different turn rate and flies a different fight. That is a real property
    // of the save, and the harness has to spawn the way the game does to test
    // it rather than trip over it.
    a.state.world.clearNpcs();
    for (let i = 0; i < 3; i++) {
      const p = a.state.world.spawn('pirate',
        a.state.player.position.clone().add(new THREE.Vector3(320 * (i - 1), 140, -1500)),
        i, pirateSpecForTier(1, i));
      p.threatTier = 1;
    }
    a.state.world.spawn('trader',
      a.state.player.position.clone().add(new THREE.Vector3(-900, -200, -2600)), 7);
    a.state.commander.credits = 12_345;
    a.state.chart.targetIndex = 42;
    fly(a, 300);
    const aLog: string[] = [];
    const snap = new Persistence(a.state, a.ordnance, new CombatComputer(), stubHost(a.state, aLog))
      .capture();

    check('the real save is taken with no Hud, no screens and no localStorage',
      snap.mode === 'flight' && snap.npcs.length > 0 && aLog.length === 0);
    // through JSON, because that is what a save IS
    const wire = JSON.stringify(snap);
    check('...and it is plain JSON', wire.length > 1000 && !wire.includes('undefined'));

    seedWorld(1);   // deliberately the WRONG stream: the restore must fix it
    const b = arrival(99);
    const bLog: string[] = [];
    new Persistence(b.state, b.ordnance, new CombatComputer(), stubHost(b.state, bLog))
      .restore(JSON.parse(wire) as WorldSnapshot);

    check('restoring rebuilds the scene before it places the ships',
      bLog[0] === 'build');
    check('...and hands the mode back to the orchestrator',
      bLog.includes('mode:flight'));
    check('...the commander came back', b.state.commander.credits === 12_345);
    check('...every flight flag and timer came back',
      JSON.stringify(b.state.session) === JSON.stringify(a.state.session));
    check('...the chart came back', b.state.chart.targetIndex === 42);
    check('...the sky came back',
      b.state.world.npcs.length === a.state.world.npcs.length
      && b.state.world.npcs.every((n, i) => n.role === a.state.world.npcs[i].role
        && n.object.position.distanceTo(a.state.world.npcs[i].object.position) === 0));
    check('...and the ship is where it was',
      b.state.player.position.distanceTo(a.state.player.position) === 0
      && b.state.player.speed === a.state.player.speed);
    check('...including the station\'s own orientation, which lives in the scene',
      b.state.world.station.quaternion.toArray().join()
      === a.state.world.station.quaternion.toArray().join());

    // THE property. A field-by-field comparison passes through every bug this
    // has ever had; continuing the run does not.
    const mark = rngState();
    fly(a, 200);
    restoreRng(mark);
    fly(b, 200);
    check('a restored world replays the run it came from, byte for byte',
      trace(b) === trace(a));

    // the negative control: an unrestored world must NOT match
    {
      const c = arrival(99);
      restoreRng(mark);
      fly(c, 200);
      check('...and a world that was not restored does not (the control)',
        trace(c) !== trace(a));
    }
  }
}

// --- resolving a hit ---------------------------------------------------------
//
// The bounty, the kill credit, the contract tick and the legal offence used to
// be one 33-line method reachable only through a Game. The events are the
// point: combat decides, and the caller is the one that launches the Vipers.

console.log('\ncombat');
{
  // Seeded: World.spawn and wreck() both draw from the global stream, so
  // without this the block inherits whatever position the tests above left.
  // The ordnance block in particular survives today only because pirate hulls
  // happen to have no ecmChance — give them one and a missile test becomes a
  // coin flip on stream position.
  seedWorld(4_242_424);
  const setup = () => {
    const world = new World();
    const combat = new Combat(world);
    const c = {
      credits: 0, kills: 0, combatScore: 0, systemIndex: 7, contracts: [],
      cargo: new Array(COMMODITIES.length).fill(0),
      equipment: { miningLaser: false },
      mission: { stage: 0, targetIndex: null },
    } as unknown as CommanderData;
    return { world, combat, c };
  };
  const at = (z: number) => new THREE.Vector3(0, 0, z);
  const kinds = (evs: { kind: string }[]) => evs.map((e) => e.kind);
  const msgs = (evs: { kind: string; text?: string }[]) =>
    evs.filter((e) => e.kind === 'message').map((e) => e.text);
  const offence = (evs: { kind: string; level?: number }[]) =>
    evs.find((e) => e.kind === 'offence')?.level;

  {
    const { world, combat, c } = setup();
    const pirate = world.spawn('pirate', at(-500), 1);
    const bounty = pirate.bounty;
    const evs = combat.destroy(c, pirate);
    check('a kill pays its bounty', c.credits === bounty && bounty > 0);
    check('...counts as a kill', c.kills === 1 && c.combatScore > 0);
    check('...is nobody\'s business legally', offence(evs) === CLEAN);
    check('...and takes the ship out of the sky',
      world.npcs.length === 0 && kinds(evs).includes('wrecked'));
  }
  {
    const { world, combat, c } = setup();
    const evs = combat.destroy(c, world.spawn('trader', at(-500), 1));
    check('destroying a trader makes you a fugitive', offence(evs) === FUGITIVE);
    check('...and pays nothing', c.credits === 0);
  }
  {
    const { world, combat, c } = setup();
    combat.destroy(c, world.spawn('asteroid', at(-500), 1));
    check('a rock is not a kill', c.kills === 0 && c.combatScore === 0);
  }
  {
    // the wreck path exists so a fight you only WATCHED does not pay you
    const { world, combat, c } = setup();
    const pirate = world.spawn('pirate', at(-500), 1);
    combat.wreck(pirate);
    check('an NPC-vs-NPC kill pays no bounty and no credit',
      c.credits === 0 && c.kills === 0 && world.npcs.length === 0);
  }
  {
    const { world, combat, c } = setup();
    c.contracts = [
      { kind: 'bounty', destination: 7, progress: 0, qty: 2 },
      { kind: 'bounty', destination: 99, progress: 0, qty: 2 },
    ] as never;
    combat.destroy(c, world.spawn('pirate', at(-500), 1));
    check('a bounty contract ticks up where it was taken',
      c.contracts[0].progress === 1);
    check('...and not for a contract from somewhere else',
      c.contracts[1].progress === 0);
    const evs = combat.destroy(c, world.spawn('pirate', at(-500), 2));
    check('...and says so when it completes',
      c.contracts[0].progress === 2
      && msgs(evs).some((m) => m!.includes('BOUNTY CONTRACT COMPLETE')));
    const after = combat.destroy(c, world.spawn('pirate', at(-500), 3));
    check('...only once', c.contracts[0].progress === 2
      && !msgs(after).some((m) => m!.includes('CONTRACT COMPLETE')));
  }
  {
    // thargons are drones: killing the mothership shuts them down
    const { world, combat, c } = setup();
    const goid = world.spawn('thargoid', at(-500), 1);
    const drone = world.spawn('thargon', at(-400), 2);
    const evs = combat.destroy(c, goid);
    check('the last thargoid dying deactivates its thargons',
      drone.inert === true
      && msgs(evs).some((m) => m!.includes('THARGONS DEACTIVATED')));
  }
  {
    const { world, combat, c } = setup();
    world.spawn('thargoid', at(-900), 9);
    const drone = world.spawn('thargon', at(-400), 2);
    combat.destroy(c, world.spawn('thargoid', at(-500), 1));
    check('...but not while another mothership is alive', drone.inert === false);
  }
}

// --- buying your way out ----------------------------------------------------
//
// A balance lever (how much cargo buys off a gang) that lived inside a 65-line
// method and had never been asserted.

console.log('\njettison');
{
  const hold = () => {
    const c = new Array(COMMODITIES.length).fill(0);
    c[0] = 3;                       // food, cheap
    c[10] = 2;                      // firearms, dear
    return c;
  };

  {
    const c = hold();
    const d = dumpCargo(c, 1);
    // the rule that makes jettisoning a real choice: it costs you the good stuff
    // The dearest thing IN THE HOLD, not in the whole table. The first version
    // reduced over all 17 commodities (giving 6, Narcotics, which was never
    // aboard) and then asserted `dearest !== undefined` — always true for a
    // number, so the clause was dead and the real comparison never happened.
    const inHold = c.map((qty, i) => ({ qty, i })).filter((x) => x.qty > 0);
    const dearest = inHold
      .reduce((a, b) => (COMMODITIES[a.i].basePrice > COMMODITIES[b.i].basePrice ? a : b)).i;
    check('the most valuable tonne goes first', d.tonnes[0] === dearest);
    check('...and it leaves the hold', c[10] === 1);
    check('...valued as markOf values it', d.value === COMMODITIES[10].basePrice * 4);
  }
  {
    const c = hold();
    const d = dumpCargo(c, 99);
    check('dumping more than you have empties the hold, not the array',
      d.tonnes.length === 5 && c.every((q) => q === 0));
  }
  {
    const d = dumpCargo(new Array(COMMODITIES.length).fill(0), 3);
    check('an empty hold dumps nothing', d.tonnes.length === 0 && d.value === 0);
  }

  {
    check('a gang wants more than an opportunist',
      appetiteOf(true, 10_000) > appetiteOf(false, 10_000));
    check('...and the demand scales with what you arrived carrying',
      appetiteOf(false, 100_000) > appetiteOf(false, 10_000));
    check('...but a near-empty hold is not a free pass',
      appetiteOf(false, 0) === OPPORTUNIST_FLOOR && appetiteOf(true, 0) === GANG_FLOOR);
  }

  {
    const pirate = (organised: boolean) => ({ alive: true, organised, satisfied: false });
    const gang = [pirate(false), pirate(false), pirate(true)];
    const arrival = 10_000;

    const tooLittle = offerBribe(gang, 100, arrival);
    check('a token handful buys nobody off',
      tooLittle.bought === 0 && tooLittle.stillWant !== null);
    check('...and it tells you the SMALLEST top-up that would work',
      tooLittle.stillWant === appetiteOf(false, arrival) - 100);

    const enough = offerBribe(gang, appetiteOf(false, arrival), arrival);
    check('paying the opportunist price peels off the opportunists',
      enough.bought === 2 && gang[0].satisfied && gang[1].satisfied);
    check('...but the gang leader is still coming', !gang[2].satisfied);

    // the toll accumulates across dumps — a second handful finishes the job
    const rest = offerBribe(gang, appetiteOf(true, arrival), arrival);
    check('a second dump finishes what the first started',
      rest.bought === 1 && gang[2].satisfied && rest.stillWant === null);
    check('...and nobody is bought twice', offerBribe(gang, 1e9, arrival).bought === 0);
  }
  {
    const dead = [{ alive: false, organised: false, satisfied: false }];
    check('the dead are not bribable', offerBribe(dead, 1e9, 0).bought === 0);
  }
}

// --- a hull breach costs you something ---------------------------------------

console.log('\nhull breach');
{
  const kit = (over: Record<string, boolean> = {}) => ({
    cargo: new Array(COMMODITIES.length).fill(0),
    equipment: { ecm: false, scoops: false, rearLaser: false, leftLaser: false,
      rightLaser: false, dockingComputer: false, combatComputer: false, ...over },
  }) as unknown as Parameters<typeof breachLoss>[0];

  {
    const c = kit();
    check('with nothing to lose, nothing is lost', breachLoss(c, () => 0).kind === 'nothing');
  }
  {
    const c = kit(); c.cargo[4] = 2;
    const lost = breachLoss(c, () => 0);
    check('cargo goes when there is cargo',
      lost.kind === 'cargo' && c.cargo[4] === 1);
  }
  {
    const c = kit({ ecm: true });
    const lost = breachLoss(c, () => 0);
    check('with an empty hold, equipment goes instead',
      lost.kind === 'equipment' && c.equipment.ecm === false);
  }
  {
    // equipment is rarer to lose than cargo: above the threshold, cargo survives
    const c = kit({ ecm: true }); c.cargo[4] = 1;
    check('a high roll takes the equipment',
      breachLoss(c, () => CARGO_LOSS_CHANCE).kind === 'equipment' && c.cargo[4] === 1);
    const c2 = kit({ ecm: true }); c2.cargo[4] = 1;
    check('...a low roll takes the cargo',
      breachLoss(c2, () => 0).kind === 'cargo' && c2.equipment.ecm === true);
  }
  {
    const c = kit({ combatComputer: true });
    const lost = breachLoss(c, () => 0);
    check('losing the combat computer is reported by key, so it can be disengaged',
      lost.kind === 'equipment' && lost.key === 'combatComputer');
  }
}

// --- the dashboard reads, it does not decide ---------------------------------
//
// The compass rule in particular: it decided where the needle points from
// inside a 100-line render method, so it had never been asserted.

console.log('\nhud binding');
{
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const sources = (over: Record<string, unknown>) => ({
    witchspace: false,
    playerPos: V(0, 0, 0),
    world: {
      planetPos: V(0, 0, 1e6), planetRadius: 1000,
      sunPos: V(0, 0, -1e6), station: { position: V(0, 0, 1e6) },
      npcs: [],
    },
    ...over,
  }) as unknown as Parameters<typeof compassTarget>[0];

  {
    const s = sources({});
    check('far from everything, the compass finds the planet',
      compassTarget(s) === s.world.planetPos);
  }
  {
    const s = sources({ playerPos: V(0, 0, -1e6 + 1000) });
    check('close to the sun it switches, so you can skim by compass',
      compassTarget(s) === s.world.sunPos);
  }
  {
    // inside three planet radii, the station takes over
    const s = sources({ playerPos: V(0, 0, 1e6 - 500) });
    check('near the planet it finds the station',
      compassTarget(s) === s.world.station.position);
  }
  {
    // witch-space banishes the scenery, so the needle hunts Thargoids instead
    const goid = { alive: true, inert: false, role: 'thargoid', object: { position: V(1, 2, 3) } };
    const s = sources({ witchspace: true, world: { ...sources({}).world, npcs: [goid] } });
    check('in witch-space it tracks the nearest Thargoid',
      compassTarget(s) === goid.object.position);
    const dead = { ...goid, alive: false };
    const s2 = sources({ witchspace: true, world: { ...sources({}).world, npcs: [dead] } });
    check('...and a dead one does not count',
      compassTarget(s2) !== dead.object.position);
  }
  {
    // the sun is 130k away here, but witch-space must win over the sun rule
    const s = sources({ witchspace: true, playerPos: V(0, 0, -1e6 + 1000) });
    check('witch-space beats the sun-skim rule', compassTarget(s) !== s.world.sunPos);
  }

  {
    const kit = (over: Record<string, boolean>) =>
      ({ equipment: { rearLaser: false, leftLaser: false, rightLaser: false, ...over } }) as never;
    check('the front mount always has a gun', hasLaserInView(kit({}), 0));
    check('...the others only when bought',
      !hasLaserInView(kit({}), 1) && hasLaserInView(kit({ rearLaser: true }), 1));
    check('...and each view reads its own mount',
      hasLaserInView(kit({ leftLaser: true }), 2)
      && !hasLaserInView(kit({ leftLaser: true }), 3));
  }
}

// --- rescuing someone is not smuggling ---------------------------------------
//
// The occupant of an escape capsule used to be stored as `cargo[3] += 1`, and
// commodity 3 is Slaves — which law.ts lists as contraband. Rescuing a pilot
// therefore tripped the police scan and made you an Offender for a good deed.

console.log('\nsurvivors');
{
  check('commodity 3 really is the one that would have bitten',
    COMMODITIES[3].name === 'Slaves' && isContraband(3));

  const c = newCommander();
  c.survivors = 2;
  check('a rescued pilot is not contraband',
    !carryingContraband(c.cargo) && contrabandTonnes(c.cargo) === 0);
  check('...but still takes up a bay', cargoTonnes(c) === 2);

  const withCargo = newCommander();
  withCargo.cargo[0] = 3;
  withCargo.survivors = 1;
  check('...and shares the hold with real cargo', cargoTonnes(withCargo) === 4);

  // a save written before the fix must still load
  const old = JSON.parse(JSON.stringify(newCommander())) as Record<string, unknown>;
  delete old.survivors;
  check('an old save with no survivors field is repaired, not NaN',
    cargoTonnes(old as never) === 0);
}

// --- flight demands: what the pilot wants, and who wanted it ----------------
//
// player.ts used to read the keyboard: `update(dt, input: Input)`. So the
// player, an autopilot and a replay were three different interfaces, the
// flight model could not be constructed outside a browser, and the combat
// computer had to reach past it and rotate the quaternion itself.
//
// Now `update(dt, demand)` flies a FlightDemand and the pilots produce one:
// `flightDemand()` from a keyboard, `CombatComputer.step()` from the defence
// brain. These tests exist because that swap must be invisible from the
// cockpit — same rates, same ramp, same mouse flight, same everything.

console.log('\nflight demands');
{
  const KEYS = {
    rollLeft: 'Comma', rollRight: 'Period', up: 'KeyX', down: 'KeyS',
    accel: 'Space', decel: 'Slash', shift: 'ShiftLeft', fire: 'KeyA',
  };

  /**
   * The pilot's hands. Structurally an `Input` as far as flightDemand cares,
   * which is the point of taking a shape rather than the class: this file
   * cannot construct an `Input` (it adds DOM listeners) and does not need to.
   */
  class Hands {
    down: Set<string>;
    mouseFlight = false;
    mouseX = 0;
    mouseY = 0;
    mouseFire = false;
    constructor(down: string[] = []) { this.down = new Set(down); }
    held(...codes: string[]): boolean { return codes.some((c) => this.down.has(c)); }
    /** Input's own self-centring, copied because Input itself needs a document. */
    decayMouse(dt: number): void {
      const k = Math.max(0, 1 - dt * 1.5);
      this.mouseX *= k;
      this.mouseY *= k;
    }
  }
  const hands = (...down: string[]): Hands & FlightControls => new Hands(down);
  const ship = () => new PlayerShip(new THREE.Vector3(1, 2, 3), new THREE.Vector3(0, 0, -1));
  const DT = 1 / 60;

  // --- the same input produces the same demand -------------------------------
  {
    const h = hands(KEYS.rollLeft, KEYS.accel, KEYS.fire);
    const rates = { rollRate: 0.3, pitchRate: -0.2 };
    const a = flightDemand(h, rates, DT);
    const b = flightDemand(h, rates, DT);
    check('the same controls produce the same demand, twice',
      a.rollRate === b.rollRate && a.pitchRate === b.pitchRate
      && a.throttle === b.throttle && a.fire === b.fire);
    check('...and reading the controls does not change them',
      h.down.size === 3 && h.mouseX === 0 && h.mouseY === 0);
    check('...and does not touch the rates it was handed',
      rates.rollRate === 0.3 && rates.pitchRate === -0.2);
  }

  // --- and it says the right thing -------------------------------------------
  {
    const one = (held: string[], from = { rollRate: 0, pitchRate: 0 }) =>
      flightDemand(hands(...held), from, DT);
    const ramped = (target: number) => rampFlightRate(0, target, true, DT);
    check('roll left asks for a left roll rate',
      one([KEYS.rollLeft]).rollRate === ramped(PLAYER_FLIGHT.maxRoll));
    check('...and roll right for the opposite',
      one([KEYS.rollRight]).rollRate === ramped(-PLAYER_FLIGHT.maxRoll));
    check('...and opposing rolls cancel', one([KEYS.rollLeft, KEYS.rollRight]).rollRate === 0);
    check('climb asks for nose up at the pitch cap',
      one([KEYS.up]).pitchRate === ramped(PLAYER_FLIGHT.maxPitch));
    check('...and dive for nose down', one([KEYS.down]).pitchRate === ramped(-PLAYER_FLIGHT.maxPitch));
    check('the rate RAMPS from where it was rather than snapping',
      one([KEYS.rollLeft], { rollRate: 1, pitchRate: 0 }).rollRate
        === rampFlightRate(1, PLAYER_FLIGHT.maxRoll, true, DT));
    check('...and released, it decays from where it was',
      one([], { rollRate: 1, pitchRate: 0 }).rollRate
        === rampFlightRate(1, 0, false, DT));
    check('the throttle opens', one([KEYS.accel]).throttle === 1);
    check('...and brakes', one([KEYS.decel]).throttle === -1);
    // the '?' guard: SHIFT+slash opens the controls guide, it does not brake
    check('shifted slash is the help key, not the brake',
      one([KEYS.decel, KEYS.shift]).throttle === 0);
    check('the trigger is the trigger', one([KEYS.fire]).fire);
    check('...and the mouse button is too', (() => {
      const h = hands();
      h.mouseFire = true;
      return flightDemand(h, { rollRate: 0, pitchRate: 0 }, DT).fire;
    })());
    check('a demand from a pilot with a ship of their own carries no limits',
      one([KEYS.accel]).limits === undefined);
  }

  // --- mouse flight ----------------------------------------------------------
  {
    const h = hands();
    h.mouseFlight = true;
    h.mouseX = 0.5;
    h.mouseY = -0.25;
    const d = flightDemand(h, { rollRate: 0, pitchRate: 0 }, DT);
    check('the virtual stick rolls the ship',
      d.rollRate === rampFlightRate(0, -0.5 * PLAYER_FLIGHT.maxRoll, true, DT));
    check('...and pitches it',
      d.pitchRate === rampFlightRate(0, -0.25 * PLAYER_FLIGHT.maxPitch, true, DT));
    h.down.add(KEYS.rollLeft);
    const withKey = flightDemand(h, { rollRate: 0, pitchRate: 0 }, DT);
    check('...and the keyboard still overrides the axis it touches',
      withKey.rollRate === rampFlightRate(0, PLAYER_FLIGHT.maxRoll, true, DT)
      && withKey.pitchRate === d.pitchRate);
  }

  // --- a demand produces the motion ------------------------------------------
  {
    const s = ship();
    s.speed = 0;
    s.update(DT, { rollRate: 0, pitchRate: 0, throttle: 1, fire: false });
    check('the throttle accelerates at the ship\'s own rate',
      s.speed === PLAYER_FLIGHT.accel * DT);
    s.speed = PLAYER_FLIGHT.maxSpeed;
    s.update(DT, { rollRate: 0, pitchRate: 0, throttle: 1, fire: false });
    check('...and cannot exceed the ship\'s top speed', s.speed === PLAYER_FLIGHT.maxSpeed);
    s.speed = 1;
    s.update(DT, { rollRate: 0, pitchRate: 0, throttle: -1, fire: false });
    check('...and braking stops at rest, not below it', s.speed === 0);

    const turning = ship();
    const before = turning.quaternion.clone();
    turning.speed = 0;
    turning.update(DT, { rollRate: 0, pitchRate: 0.5, throttle: 0, fire: false });
    // what it actually turned, in its OWN frame, against what it was asked for
    const turned = before.invert().multiply(turning.quaternion);
    const wanted = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5 * DT);
    check('the ship turns at exactly the rate it was asked for',
      Math.abs(turning.pitchRate - 0.5) < 1e-12 && turned.angleTo(wanted) < 1e-9);
    check('...and the ship never pulls its own trigger — the Game does',
      // firing is a consequence (bounties, legal status, the station's Vipers);
      // all the ship does is carry the flag back out
      turning.speed === 0);

    // A softer pilot: the combat computer cruises rather than sprints, and
    // that is expressed IN THE DEMAND rather than by a second code path.
    const cruising = ship();
    cruising.speed = 0;
    cruising.update(DT, {
      rollRate: 0, pitchRate: 0, throttle: 1, fire: false,
      limits: { accel: CC_ACCEL, maxSpeed: CC_MAX_SPEED },
    });
    check('a demand may fly a softer envelope than the hull allows',
      cruising.speed === CC_ACCEL * DT);
    cruising.speed = PLAYER_FLIGHT.maxSpeed;
    cruising.update(DT, {
      rollRate: 0, pitchRate: 0, throttle: 1, fire: false,
      limits: { accel: CC_ACCEL, maxSpeed: CC_MAX_SPEED },
    });
    check('...and asking for throttle above that cap pulls the ship back to it',
      cruising.speed === CC_MAX_SPEED);
  }

  // --- the refactor changed nothing a pilot can feel --------------------------
  //
  // The oracle below is the PRE-REFACTOR `PlayerShip.update(dt, input)`,
  // transcribed. It is a deliberate second home for a rule, kept because the
  // claim being tested is exactly "the new path and the old one are the same
  // path": every subset of the flight keys, from four starting speeds, forty
  // frames each, compared to the bit. It reads the constants through
  // PLAYER_FLIGHT and rampFlightRate, so a change to the flight envelope moves
  // both sides together and only a change to the STRUCTURE can fail it.
  {
    const AXIS_X = new THREE.Vector3(1, 0, 0);
    const AXIS_Z = new THREE.Vector3(0, 0, 1);
    const tmpQ = new THREE.Quaternion();
    const tmpV = new THREE.Vector3();
    const legacyUpdate = (s: PlayerShip, dt: number, input: Hands): void => {
      const keys = keymap();
      let rollIn = (input.held(...keys.rollLeft) ? 1 : 0) - (input.held(...keys.rollRight) ? 1 : 0);
      let pitchIn = (input.held(...keys.pitchUp) ? 1 : 0) - (input.held(...keys.pitchDown) ? 1 : 0);
      if (input.mouseFlight) {
        if (rollIn === 0) rollIn = -input.mouseX;
        if (pitchIn === 0) pitchIn = input.mouseY;
        input.decayMouse(dt);
      }
      s.rollRate = rampFlightRate(s.rollRate, rollIn * PLAYER_FLIGHT.maxRoll, rollIn !== 0, dt);
      s.pitchRate = rampFlightRate(s.pitchRate, pitchIn * PLAYER_FLIGHT.maxPitch, pitchIn !== 0, dt);
      if (input.held(...keys.accel)) {
        s.speed = Math.min(PLAYER_FLIGHT.maxSpeed, s.speed + PLAYER_FLIGHT.accel * dt);
      }
      const decelHeld = keys.decel.some((k) =>
        input.held(k) && (k !== 'Slash' || !input.held('ShiftLeft', 'ShiftRight')));
      if (decelHeld) s.speed = Math.max(0, s.speed - PLAYER_FLIGHT.accel * dt);
      if (s.rollRate !== 0) s.quaternion.multiply(tmpQ.setFromAxisAngle(AXIS_Z, s.rollRate * dt));
      if (s.pitchRate !== 0) s.quaternion.multiply(tmpQ.setFromAxisAngle(AXIS_X, s.pitchRate * dt));
      s.quaternion.normalize();
      s.position.addScaledVector(s.getForward(tmpV), s.speed * dt);
    };
    /** The new path, exactly as Game.pilotDemand + PlayerShip.update run it. */
    const newUpdate = (s: PlayerShip, dt: number, input: Hands): void => {
      const d = flightDemand(input, s, dt);
      if (input.mouseFlight) input.decayMouse(dt);
      s.update(dt, d);
    };
    const same = (a: PlayerShip, b: PlayerShip): boolean =>
      a.position.equals(b.position) && a.quaternion.equals(b.quaternion)
      && a.speed === b.speed && a.rollRate === b.rollRate && a.pitchRate === b.pitchRate;

    const CODES = [KEYS.rollLeft, KEYS.rollRight, KEYS.up, KEYS.down,
      KEYS.accel, KEYS.decel, KEYS.shift, KEYS.fire];
    let combos = 0;
    let diverged: string[] = [];
    for (let mask = 0; mask < (1 << CODES.length); mask++) {
      const held = CODES.filter((_, i) => mask & (1 << i));
      // Space AND slash together is the one input the two paths disagree on;
      // it has a check of its own below.
      if (held.includes(KEYS.accel) && held.includes(KEYS.decel)
        && !held.includes(KEYS.shift)) continue;
      for (const startSpeed of [0, 100, 399, 400]) {
        const was = ship();
        const now = ship();
        was.speed = startSpeed;
        now.speed = startSpeed;
        const h1 = new Hands(held);
        const h2 = new Hands(held);
        for (let f = 0; f < 40; f++) {
          legacyUpdate(was, DT, h1);
          newUpdate(now, DT, h2);
        }
        combos += 1;
        if (!same(was, now)) diverged.push(`${held.join('+') || 'nothing'} @${startSpeed}`);
      }
    }
    check(`every flight-key combination flies as it did (${combos} runs, ${diverged.length} adrift)`,
      diverged.length === 0, diverged.slice(0, 4).join(', '));

    // ...including the analogue path, where the stick decays between frames
    {
      const was = ship();
      const now = ship();
      const h1 = new Hands();
      const h2 = new Hands();
      h1.mouseFlight = true;
      h2.mouseFlight = true;
      for (let f = 0; f < 300; f++) {
        if (f % 20 === 0) {
          h1.mouseX = 0.4; h2.mouseX = 0.4;
          h1.mouseY = -0.3; h2.mouseY = -0.3;
        }
        if (f === 100) { h1.down.add(KEYS.rollLeft); h2.down.add(KEYS.rollLeft); }
        if (f === 150) { h1.down.delete(KEYS.rollLeft); h2.down.delete(KEYS.rollLeft); }
        legacyUpdate(was, DT, h1);
        newUpdate(now, DT, h2);
      }
      check('mouse flight is unchanged, decay and all',
        same(was, now) && h1.mouseX === h2.mouseX && h1.mouseY === h2.mouseY);
    }

    // --- the one input that does NOT fly as it did -----------------------------
    //
    // Holding accelerate AND brake together. The old code applied both, each
    // with its own clamp, so at the top of the range `min(400, s+a)` then
    // `s-a` left the ship hovering at 396.3 — a throttle that was really two
    // half-throttles. A demand has ONE throttle, so the two cancel and the
    // ship holds 400. It is the only difference the sweep above can find, it
    // needs two opposing controls held at once, and it is worth 0.9% of top
    // speed. Pinned here so it is a decision on the record rather than a
    // silent drift.
    {
      const was = ship();
      const now = ship();
      was.speed = PLAYER_FLIGHT.maxSpeed;
      now.speed = PLAYER_FLIGHT.maxSpeed;
      const h1 = new Hands([KEYS.accel, KEYS.decel]);
      const h2 = new Hands([KEYS.accel, KEYS.decel]);
      for (let f = 0; f < 40; f++) {
        legacyUpdate(was, DT, h1);
        newUpdate(now, DT, h2);
      }
      check('accelerate+brake together used to bleed one frame of speed at the cap',
        Math.abs(was.speed - (PLAYER_FLIGHT.maxSpeed - PLAYER_FLIGHT.accel * DT)) < 1e-9);
      check('...and now cancels cleanly instead', now.speed === PLAYER_FLIGHT.maxSpeed);
      check('...which is the ONLY behaviour this refactor changed',
        Math.abs(Math.abs(was.speed - now.speed) - PLAYER_FLIGHT.accel * DT) < 1e-9);
    }
  }

  // --- the autopilot is a pilot, not a special case ---------------------------
  //
  // The combat computer's demand must be flyable by the same update() the
  // human's is — including the softer throttle it deliberately cruises at,
  // which used to be applied by game.ts reaching into the ship.
  {
    seedWorld(20_260_729);
    const cc = new CombatComputer();
    const brain = defenceBrain();
    const player = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), speed: 200 };
    const sys = freshSystems();
    const pirate = new NpcShip('pirate', new THREE.Vector3(0, 0, -900), 5);
    pirate.provoked = true;
    pirate.provokedByPlayer = true;
    let flown = 0;
    let demand: FlightDemand | null = null;
    for (let f = 0; f < 20; f++) {
      const step = cc.step(DT, player, sys, [pirate], CLEAN, false, brain);
      if (step.kind === 'fly') { flown += 1; demand = step.demand; }
    }
    check('the combat computer produces a demand like anyone else', flown === 20 && demand !== null);
    check('...and it carries the cruise envelope it was always flown at',
      demand?.limits?.accel === CC_ACCEL && demand?.limits?.maxSpeed === CC_MAX_SPEED);
    check('...so the ship it is bolted to is the ship the human flies',
      Math.abs(demand!.pitchRate) <= CC_MAX_PITCH + 1e-9
      && Math.abs(demand!.rollRate) <= CC_MAX_ROLL + 1e-9);
    // a demand is a demand: the same one, flown by the same method
    const s = ship();
    s.speed = 300;
    s.update(DT, { ...demand!, throttle: 1 });
    check('...and applying it throttles at the autopilot\'s rate, not the commander\'s',
      s.speed === CC_MAX_SPEED);
  }
}

// --- the pure modules stay pure ----------------------------------------------
//
// The storage mechanism used to live in commander.ts, which made a module of
// plain data browser-only by association — and it bit: freshState() called
// loadCommander() and the state factory threw under node. storage.ts is the
// only file allowed to know localStorage exists.

console.log('\npurity');
{
  const PURE = [
    'commander.ts', 'shop.ts', 'contracts.ts', 'law.ts', 'jettison.ts',
    'systems.ts', 'trumbles.ts', 'hyperspace.ts', 'missions.ts', 'population.ts',
    'encounters.ts', 'gunnery.ts', 'docking.ts', 'state.ts', 'session.ts',
    // the whole world step, as of the extraction out of game.ts — this is the
    // line that says the simulation can advance without a browser
    'world-step.ts',
  ];
  for (const f of PURE) {
    const src = readFileSync(new URL(`../src/game/${f}`, import.meta.url), 'utf8')
      .replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    check(`${f} does not reach for the browser`,
      !/\b(localStorage|sessionStorage|document|window)\b/.test(src));
  }
  // The flight seam, outside src/game/: player.ts took an `Input` until the
  // demand layer went in, which made the flight model — the thing every
  // harness wants to fly — constructible only in a browser. The producer that
  // replaced that read is node-safe by construction, and this says so.
  for (const f of ['player.ts', 'engine/flight-controls.ts']) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
      .replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    check(`${f} does not reach for the browser`,
      !/\b(localStorage|sessionStorage|document|window)\b/.test(src));
  }
  check('...and the flight model no longer knows what an Input is',
    !/engine\/input/.test(readFileSync(new URL('../src/player.ts', import.meta.url), 'utf8')));

  const store = readFileSync(new URL('../src/game/storage.ts', import.meta.url), 'utf8');
  check('storage.ts is where localStorage lives', /localStorage/.test(store));
  // the keys are load-bearing: renaming one orphans every existing save
  check('...and the save keys are unchanged',
    store.includes("'elite-web-commander'") && store.includes("'elite-web-world'")
    && store.includes("'elite-web-slot'"));
}

// --- the fuel price has one home ---------------------------------------------
//
// It had four: a bare `* 0.4` inside equipRows in the RENDER layer, plus
// copies in test/campaign.ts, train/jameson-autopilot.js and a doc.

console.log('\nrefuelling');
{
  const tank = (fuel: number) => ({ fuel }) as never;
  check('an empty tank costs the full rate',
    refuelCost(tank(0)) === Math.round(MAX_FUEL * FUEL_PRICE));
  check('a full tank is free', refuelCost(tank(MAX_FUEL)) === 0);
  check('...and needs nothing', fuelNeeded(tank(MAX_FUEL)) === 0);
  check('half a tank is half the price',
    refuelCost(tank(MAX_FUEL / 2)) === Math.round((MAX_FUEL / 2) * FUEL_PRICE));
  // money is integer tenths (invariant 5), and a sun-skim leaves a fraction
  check('a scooped fractional tank still costs a whole number of tenths',
    Number.isInteger(refuelCost(tank(41.3))));

  // the outfitters' row must quote exactly what the rule says
  const c = newCommander();
  c.fuel = 20;
  const row = equipRows(generateGalaxy(1)[7], c).find((r) => r.id === 'fuel')!;
  check('the equipment screen quotes the shared rule', row.price === refuelCost(c));
  c.fuel = MAX_FUEL;
  check('...and reads OWNED at a full tank',
    equipRows(generateGalaxy(1)[7], c).find((r) => r.id === 'fuel')!.status === 'OWNED');

  // --- the quote the shops read ---------------------------------------------
  //
  // A shopper reads a price PER LIGHT YEAR; FUEL_PRICE is per tenth of one.
  // That conversion is the sum this file exists to stop being written twice.
  {
    const empty = newCommander();
    empty.fuel = 0;
    const q = fuelQuote(empty);
    check('the quote agrees with the rule it quotes',
      q.cost === refuelCost(empty) && q.needed === fuelNeeded(empty));
    // one LY short of full: what it costs to fill IS the per-LY price
    const shortOne = { fuel: MAX_FUEL - 10 } as never;
    check('a light year quoted costs a light year bought',
      q.perLightYear === refuelCost(shortOne));
    check('a full tank has nothing to quote',
      fuelQuote({ fuel: MAX_FUEL } as never).full && fuelQuote({ fuel: MAX_FUEL } as never).cost === 0);
    check('...and a dry one is not full', !q.full);
  }

  // --- and it reaches the market screen --------------------------------------
  //
  // The point of the feature: you could not see what fuel cost without leaving
  // the market for the outfitters. Rendered for real against a stub document,
  // because "the string is in the HTML" is the only thing that answers it.
  {
    const prev = (globalThis as unknown as { document: unknown }).document;
    let html = '';
    const cls = { add: () => {}, remove: () => {}, toggle: () => {} };
    (globalThis as unknown as { document: unknown }).document = {
      querySelectorAll: () => [],
      getElementById: () => ({ set innerHTML(v: string) { html = v; }, classList: cls }),
      body: { classList: cls },
    };
    try {
      const c = newCommander();
      c.fuel = 20; // 2.0 LY in the tank, 5.0 LY short
      const market = generateMarket(g1[7], 0);
      renderMarket(g1[7], market, c, 0, fuelQuote(c));
      check('the market screen prints the price of a light year',
        html.includes('FUEL 0.4 Cr/LY'));
      check('...and what filling up would cost', html.includes('2.0 Cr TO FILL'));
      check('...and how much is in the tank', html.includes('TANK 2.0/7.0 LY'));

      c.fuel = MAX_FUEL;
      renderMarket(g1[7], market, c, 0, fuelQuote(c));
      check('a full tank is told so rather than sold to',
        html.includes('TANK FULL') && !html.includes('TO FILL'));

      // a rock hermit trades cargo but cannot fill a tank: no quote at all
      renderMarket(g1[7], market, c, 0, null);
      check('a hermit quotes no fuel price it cannot honour', !html.includes('FUEL 0.4'));
    } finally {
      (globalThis as unknown as { document: unknown }).document = prev;
    }
  }

  // nobody may re-derive it. Deliberately fuel-specific: a bare /\* 0\.4/
  // also matches the commodity byte-to-credits scale, which is a different
  // 0.4 doing a different job.
  const reFuel = /(fuel|need)[A-Za-z]*\s*\*\s*0\.4/i;
  for (const f of ['../src/ui/screens.ts', '../src/game/screens/trade.ts',
    '../test/campaign.ts', '../train/jameson-autopilot.js']) {
    // comments stripped first — the explanatory note in jameson-autopilot.js
    // says `need * 0.4` while explaining why it must not, and tripped this.
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
      .replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    check(`${f.split('/').pop()} does not re-derive the fuel price`, !reFuel.test(src));
  }
}

// --- the law ----------------------------------------------------------------

console.log('\nthe law');
{
  check('slaves, narcotics and firearms are the illegal three',
    CONTRABAND.length === 3 && [3, 6, 10].every(isContraband));
  check('...and nothing else is', [0, 1, 2, 4, 5, 7, 8, 9].every((i) => !isContraband(i)));

  {
    const hold = new Array(17).fill(0);
    check('a clean hold passes a scan', !carryingContraband(hold));
    hold[6] = 2;
    check('two tonnes of narcotics does not',
      carryingContraband(hold) && contrabandTonnes(hold) === 2);
    hold[3] = 1;
    check('...and it counts every kind', contrabandTonnes(hold) === 3);
  }

  // THE point of law.ts: one definition where there were four. If these ever
  // disagree, someone has re-inlined [3, 6, 10] somewhere.
  {
    const hold = new Array(17).fill(0);
    CONTRABAND.forEach((i) => { hold[i] = 1; });
    const mark = markOf(
      { cargo: hold, kills: 0, equipment: { laser: 'pulse', largeBay: false } }, 0);
    check('contracts.ts counts the same set as law.ts',
      mark.contraband === CONTRABAND.length);
  }

  {
    check('a clean commander pays nothing', fineFor(CLEAN, 100_000) === 0);
    check('an offender pays 25 Cr', fineFor(OFFENDER, 100_000) === OFFENDER_FINE);
    check('a fugitive pays 75 Cr', fineFor(FUGITIVE, 100_000) === FUGITIVE_FINE);
    check('...but never more than you have', fineFor(FUGITIVE, 100) === 100);
    check('...and a broke fugitive pays nothing rather than going negative',
      fineFor(FUGITIVE, 0) === 0);
  }

  {
    check("shooting a pirate is nobody's business", offenceFor('pirate', false) === CLEAN);
    check('...destroying one, likewise', offenceFor('pirate', true) === CLEAN);
    check('...and thargoids and rocks too',
      offenceFor('thargoid', true) === CLEAN && offenceFor('asteroid', true) === CLEAN);
    for (const role of ['police', 'trader', 'hunter']) {
      check(`shooting a ${role} is an offence`, offenceFor(role, false) === OFFENDER);
      check(`...destroying a ${role} makes you a fugitive`,
        offenceFor(role, true) === FUGITIVE);
    }
  }
  check('every legal status has a name',
    LEGAL_NAMES.length === 3 && LEGAL_NAMES.every((n) => n.length > 0));
}

// --- which brain flies which ship -------------------------------------------
//
// Invariant 8 in CLAUDE.md is a paragraph of prose about who flies what. It
// used to be spread over three parts of npc.ts; now it is one function, so it
// can be asserted instead of described.

console.log('\nbrain selection');
{
  const flags = globalThis as unknown as Record<string, unknown>;
  const clear = () => {
    delete flags.__scriptedPirates; delete flags.__packBrain;
    delete flags.__sharpPirates; delete flags.__legacyPirates;
  };

  clear();
  {
    const solo = pirateBrainFor(0, false);
    check('an opportunist flies the solo brain', !!solo && !solo.pack);
    const gang = pirateBrainFor(2, true);
    check('an organised gang flies the pack policy', !!gang && gang.pack);
    check('...and they are different brains', solo!.brain !== gang!.brain);
    check('a tier-2 pirate flying ALONE still flies solo',
      pirateBrainFor(2, false)?.pack === false);
  }
  {
    // the guard is the range at which the brain hands back to the scripted
    // break-off; the generation brains do not ram, so theirs is tighter
    const now = pirateBrainFor(1, false)!;
    check('the current brain gets the tight guard', now.guard === 150);
    check('...and is told a floored target speed, not a fake 300',
      now.targetSpeed(0) === 150 && now.targetSpeed(400) === 400);
  }
  {
    flags.__scriptedPirates = true;
    check('__scriptedPirates turns every brain off',
      pirateBrainFor(0, false) === null && pirateBrainFor(2, true) === null
      && defenceBrain() === null);
    clear();
  }
  {
    flags.__packBrain = true;
    check('__packBrain forces the pack policy onto everyone',
      pirateBrainFor(0, false)?.pack === true);
    clear();
  }
  {
    const base = pirateBrainFor(0, false)!.brain;
    flags.__sharpPirates = 'pro';
    check("__sharpPirates='pro' leaves opportunists alone",
      pirateBrainFor(0, false)!.brain === base);
    check('...and re-arms professionals',
      pirateBrainFor(1, false)!.brain !== base);
    flags.__sharpPirates = true;
    check('__sharpPirates=true re-arms everyone',
      pirateBrainFor(0, false)!.brain !== base);
    clear();
  }
  check('the defence brain is fitted', defenceBrain() !== null);
}

// --- ordnance ---------------------------------------------------------------
//
// The point of these: there is no Game here, and no HUD. Ordnance used to need
// a context object with a message() callback, so none of this was reachable.

console.log('\nordnance');
{
  // Seeded: World.spawn and wreck() both draw from the global stream, so
  // without this the block inherits whatever position the tests above left.
  // The ordnance block in particular survives today only because pirate hulls
  // happen to have no ecmChance — give them one and a missile test becomes a
  // coin flip on stream position.
  seedWorld(7_070_707);
  const armed = () => {
    const world = new World();
    const ord = new Ordnance(world);
    const cmdr = {
      missiles: 4, equipment: { ecm: true, energyBomb: true },
    } as unknown as CommanderData;
    return { world, ord, cmdr };
  };
  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  {
    const { ord, cmdr } = armed();
    check('arming is a toggle', ord.arm(cmdr) === 'armed' && ord.arm(cmdr) === 'unarmed');
    cmdr.missiles = 0;
    check('...but not with an empty rack', ord.arm(cmdr) === 'noMissiles');
  }
  {
    const { world, ord, cmdr } = armed();
    const npc = world.spawn('pirate', at(0, 0, -800), 1);
    ord.arm(cmdr);
    check('a ship in the sight locks',
      ord.updateLock(at(0, 0, 0), at(0, 0, -1)) === 'locked' && ord.targetLock === npc);
    check('...and re-arming says so, rather than dropping it',
      ord.arm(cmdr) === 'alreadyLocked' && ord.targetLock === npc);
  }
  {
    const { world, ord, cmdr } = armed();
    world.spawn('asteroid', at(0, 0, -800), 1);
    ord.arm(cmdr);
    check('a rock does not', ord.updateLock(at(0, 0, 0), at(0, 0, -1)) === null);
  }
  {
    const { world, ord, cmdr } = armed();
    world.spawn('pirate', at(0, 0, 800), 1); // behind
    ord.arm(cmdr);
    check('nor does something behind you',
      ord.updateLock(at(0, 0, 0), at(0, 0, -1)) === null);
  }
  {
    const { world, ord, cmdr } = armed();
    const npc = world.spawn('pirate', at(0, 0, -800), 1);
    check('firing without a lock is refused',
      ord.launch(cmdr, at(0, 0, 0)) === 'noLock' && cmdr.missiles === 4);
    ord.arm(cmdr);
    ord.updateLock(at(0, 0, 0), at(0, 0, -1));
    check('firing with one spends a missile and puts it in the sky',
      ord.launch(cmdr, at(0, 0, 0)) === 'away'
      && cmdr.missiles === 3 && ord.missiles.length === 1);
    check('...and leaves the launcher empty-handed',
      ord.targetLock === null && !ord.armed);

    // it should reach an 800-unit target well inside its life
    let events: ReturnType<typeof ord.step> = [];
    for (let i = 0; i < 600 && !events.length; i++) events = ord.step(1 / 60, at(0, 0, 0));
    check('a missile runs its target down',
      events.some((e) => e.kind === 'killed' && e.npc === npc));
    check('...and is gone from the sky afterwards', ord.missiles.length === 0);
  }
  {
    const { ord, cmdr } = armed();
    ord.launchHostile(at(0, 0, -2000));
    check('an incoming missile hits the player',
      ord.missiles.length === 1);
    let events: ReturnType<typeof ord.step> = [];
    for (let i = 0; i < 900 && !events.length; i++) events = ord.step(1 / 60, at(0, 0, 0));
    check('...for real damage', events.some((e) => e.kind === 'hitPlayer' && e.damage > 0));

    // E.C.M. kills everything in the sky, ours included
    ord.launchHostile(at(0, 0, -2000));
    check('E.C.M. needs energy',
      ord.triggerEcm(cmdr, ECM_ENERGY_COST - 0.01) === 'noEnergy' && ord.missiles.length === 1);
    check('...and clears the sky when it has it',
      ord.triggerEcm(cmdr, ECM_ENERGY_COST) === 'ecmFired' && ord.missiles.length === 0);
    cmdr.equipment.ecm = false;
    check('...and is refused when not fitted', ord.triggerEcm(cmdr, 10) === 'noEcm');
  }
  {
    const { world, ord, cmdr } = armed();
    world.spawn('pirate', at(0, 0, -100), 1);
    world.spawn('thargoid', at(0, 0, -100), 2);
    world.spawn('pirate', at(0, 0, -900_000), 3);
    const r = ord.detonateEnergyBomb(cmdr, at(0, 0, 0));
    check('the energy bomb catches what is close', r.reply === 'bombFired' && r.caught.length === 1);
    check('...thargoids shrug it off',
      !r.caught.some((n) => n.role === 'thargoid'));
    check('...and it is a one-shot',
      ord.detonateEnergyBomb(cmdr, at(0, 0, 0)).reply === 'noBomb');
  }
  check('every reply has a line', ([
    'noMissiles', 'alreadyLocked', 'armed', 'unarmed', 'locked', 'noLock', 'away',
    'incoming', 'noEcm', 'noEnergy', 'ecmFired', 'noBomb', 'bombFired',
  ] as const).every((r) => ordnanceMessage(r).text.length > 0));
}

// --- hyperspace -------------------------------------------------------------

console.log('\nhyperspace');
{
  const sys = generateGalaxy(1);
  const cmdr = (systemIndex: number, fuel: number, stage = 0) =>
    ({ systemIndex, fuel, day: 0, mission: { stage } }) as unknown as CommanderData;
  // Lave -> Diso is a short hop; something far away is not
  const near = sys.reduce((best, s) => {
    const d = distanceTenths(sys[7], s);
    return s.index !== 7 && d > 0 && d < distanceTenths(sys[7], best) ? s : best;
  }, sys[0]);

  check('no target set is refused',
    checkJump(cmdr(7, 70), sys, null, false, false).ok === false);
  check('...and so is jumping to where you already are',
    checkJump(cmdr(7, 70), sys, 7, false, false).ok === false);
  {
    const r = checkJump(cmdr(7, 0), sys, near.index, false, false);
    check('an empty tank is refused', !r.ok && r.reason === 'noFuel');
    check('...with the right line',
      refusalMessage('noFuel', false).includes('RANGE')
      && refusalMessage('noFuel', true).includes('WITCH-SPACE'));
  }
  check('a countdown already running is not restarted',
    checkJump(cmdr(7, 70), sys, near.index, false, true).ok === false);
  {
    const r = checkJump(cmdr(7, 70), sys, near.index, false, false);
    check('a jump in range is allowed',
      r.ok && r.cost === distanceTenths(sys[7], near));
  }

  {
    // witch-space charges a flat rate regardless of how far the target is
    const far = sys.reduce((a, b) =>
      distanceTenths(sys[7], a) > distanceTenths(sys[7], b) ? a : b);
    check('escaping witch-space is a flat fare, not the chart distance',
      jumpCost(sys[7], far, true) === WITCHSPACE_ESCAPE_COST
      && jumpCost(sys[7], far, false) > WITCHSPACE_ESCAPE_COST);
    const c = cmdr(7, WITCHSPACE_ESCAPE_COST);
    check('...and is affordable on exactly that much fuel',
      checkJump(c, sys, far.index, true, false).ok === true);
    const r = resolveJump(c, sys, far.index, true, () => 0);
    check('...and cannot itself mis-jump', !r.misjump && c.fuel === 0);
  }

  {
    const c = cmdr(7, 70);
    const r = resolveJump(c, sys, near.index, false, () => 1); // never mis-jumps
    check('a jump moves you, spends fuel and takes time',
      c.systemIndex === near.index && c.fuel === 70 - jumpCost(sys[7], near, false)
      && r.days > 0 && c.day === r.days);
  }
  {
    // the original's cruelty: a mis-jump still charges full fare
    const c = cmdr(7, 70);
    const r = resolveJump(c, sys, near.index, false, () => 0); // always mis-jumps
    check('a mis-jump costs the fuel and gets you nowhere',
      r.misjump && r.days === 0 && c.systemIndex === 7
      && c.fuel === 70 - jumpCost(sys[7], near, false));
  }
  check('the courier run is the dangerous one',
    witchspaceChance(3) > witchspaceChance(0));
}

// --- trumbles ---------------------------------------------------------------

console.log('\ntrumbles');
{
  const cmdr = (trumbles: number, cargo: number[] = new Array(17).fill(0)) =>
    ({ trumbles, cargo: [...cargo] }) as unknown as Parameters<typeof stepTrumbles>[0];
  const half = () => 0.5;

  {
    const c = cmdr(0);
    const r = stepTrumbles(c, 1, 0, 0, half);
    check('no trumbles, nothing happens', r.events.length === 0 && c.trumbles === 0);
  }
  {
    const c = cmdr(1);
    const r = stepTrumbles(c, 1, 0, 0, half);
    check('they breed', c.trumbles > 1 && r.timer === BREED_INTERVAL);
  }
  {
    // one dt per brood interval, so each call is one generation
    const c = cmdr(1);
    let timer = 0;
    for (let i = 0; i < 8; i++) timer = stepTrumbles(c, BREED_INTERVAL, 0, timer, half).timer;
    check(`...exponentially (1 -> ${c.trumbles} in 8 broods)`, c.trumbles > 20);
    check('...but not without bound', c.trumbles <= MAX_TRUMBLES);
  }
  {
    const cargo = new Array(17).fill(0); cargo[0] = 10;
    const c = cmdr(16, cargo);
    const r = stepTrumbles(c, 1, 0, 0, half);
    check('a big enough brood eats the hold',
      c.cargo[0] < 10 && r.events.some((e) => e.kind === 'ate'));
  }
  {
    const cargo = new Array(17).fill(0); cargo[0] = 10;
    const c = cmdr(4, cargo);
    stepTrumbles(c, 1, 0, 0, half);
    check('a small one is not hungry enough to bite', c.cargo[0] === 10);
  }
  {
    // the cure is a sun-skim — the same manoeuvre that refuels you
    const c = cmdr(50);
    const r = stepTrumbles(c, 1, 0.9, BREED_INTERVAL, half);
    check('cabin heat drives them out', c.trumbles < 50 && r.timer === 0);
    const c2 = cmdr(1);
    const r2 = stepTrumbles(c2, 1, 0.9, 0, half);
    check('...to the last one', c2.trumbles === 0 && r2.events[0]?.kind === 'purged');
  }
  check('every event has a line', ['purged', 'fleeing', 'ate', 'breeding'].every((k) =>
    trumbleMessage({ kind: k, left: 1, total: 1, commodity: 0, tonnes: 1 } as never).length > 0));
}

// --- docking has one rule ---------------------------------------------------

// It had two. `arrived` in docking.ts, which NPC traders dock on and which
// has NO roll test, and a re-implementation in game.ts checkStation() with a
// bounding box, a slot channel and a roll test. An NPC could thread a
// letterbox the player could not, and only the NPC's half was testable.

console.log('\ndocking');
{
  const station = new THREE.Object3D();
  station.updateMatrixWorld(true);
  const DOCK_Z = 160;
  const scratch = { v: new THREE.Vector3(), q: new THREE.Quaternion(), r: new THREE.Vector3() };
  const level = new THREE.Quaternion();
  const rolled = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.2);
  const at = (x: number, y: number, z: number, q = level) =>
    dockingOutcome(new THREE.Vector3(x, y, z), q, station, DOCK_Z, scratch);

  check('far away is clear', at(0, 0, 5000) === 'clear');
  check('lined up in the slot, level, is docked', at(0, 0, -(DOCK_Z - 20)) === 'docked');
  check('...and rolled 69 degrees is a slot miss',
    at(0, 0, -(DOCK_Z - 20), rolled) === 'slotMiss');
  check('off to the side of the face is the hull', at(120, 0, -(DOCK_Z - 20)) === 'hull');
  check('too high in the channel is the hull', at(0, 40, -(DOCK_Z - 20)) === 'hull');
  check('the far side of the station is the hull', at(0, 0, DOCK_Z - 20) === 'hull');
  {
    // the roll tolerance is a real edge, not a formality
    const just = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ROLL_TOLERANCE - 0.05);
    const over = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ROLL_TOLERANCE + 0.05);
    check('just inside the roll tolerance docks', at(0, 0, -(DOCK_Z - 20), just) === 'docked');
    check('just outside it does not', at(0, 0, -(DOCK_Z - 20), over) === 'slotMiss');
  }
}

// --- the Navy mission -------------------------------------------------------

// A five-stage state machine that lived in three private methods of game.ts
// and one branch of destroyNpc, so nothing could advance a commander through
// it. game/missions.ts is pure, so these are its first tests.

console.log('\nNavy mission');
{
  const systems = generateGalaxy(1);
  const cmdr = (over: Record<string, unknown> = {}) => ({
    kills: 0, galaxy: 1, systemIndex: 7, credits: 1000,
    mission: { stage: 0, targetIndex: null }, ...over,
  }) as unknown as Parameters<typeof stepMissionAtDock>[0];
  const half = () => 0.5;

  {
    const c = cmdr({ kills: 15 });
    check('the Navy ignores you below the kill threshold',
      stepMissionAtDock(c, systems, half).length === 0 && c.mission.stage === 0);
  }
  {
    const c = cmdr({ kills: 16 });
    const ev = stepMissionAtDock(c, systems, half);
    check('...and briefs you at it', ev[0]?.kind === 'briefed' && c.mission.stage === 1);
    check('...with a target that is somewhere else', c.mission.targetIndex !== 7);
  }
  {
    const c = cmdr({ kills: 16, galaxy: 2 });
    check('the mission is galaxy 1 only',
      stepMissionAtDock(c, systems, half).length === 0);
  }
  {
    const c = cmdr({ mission: { stage: 1, targetIndex: 7 } });
    check('the Constrictor lurks where you were told', constrictorLurksHere(c));
    const before = c.credits;
    const e = constrictorDestroyed(c);
    check('killing it pays the Navy bounty and moves you to stage 2',
      e?.bounty === 25_000 && c.credits === before + 25_000 && c.mission.stage === 2);
    check('...and it cannot be claimed twice', constrictorDestroyed(c) === null);
  }
  {
    const c = cmdr({ mission: { stage: 2, targetIndex: null } });
    const ev = stepMissionAtDock(c, systems, half);
    check('reporting back gets the courier orders',
      ev[0]?.kind === 'courierOrders' && c.mission.stage === 3);
    // fly there and dock
    c.systemIndex = c.mission.targetIndex as number;
    const before = c.credits;
    const done = stepMissionAtDock(c, systems, half);
    check('delivering the plans pays and completes it',
      done[0]?.kind === 'delivered' && c.credits === before + 15_000 && c.mission.stage === 4);
  }
  {
    check('an idle commander has no mission line',
      missionHeadline(cmdr(), systems) === '');
    check('a briefed one names the system',
      missionHeadline(cmdr({ mission: { stage: 1, targetIndex: 7 } }), systems).includes('LAVE'));
  }
}

// --- taking work, and being paid for it -------------------------------------
//
// `settleContracts` and `acceptContract` were private methods of game.ts, so
// the rules that decide whether a job pays had NO tests at all — and
// test/campaign.ts, the harness the project quotes its balance figures from,
// carried its own transcription of the settlement rather than calling them.
// That is the exact arrangement CLAUDE.md's invariant 7 forbids. They are in
// contracts.ts now, and this is the coverage that was missing.

console.log('\ncontracts');
{
  const systems = generateGalaxy(1);
  const cargoRun = (over: Partial<Contract> = {}): Contract => ({
    kind: 'cargo', destination: 7, commodity: 0, qty: 5,
    reward: 500, deadlineDay: 10, progress: 0, ...over,
  });
  const cmdr = (over: Record<string, unknown> = {}): CommanderData => ({
    ...newCommander(), systemIndex: 7, day: 0, credits: 1000, contracts: [], ...over,
  } as CommanderData);

  // --- settlement ----------------------------------------------------------
  {
    const c = cmdr();
    c.contracts = [cargoRun()];
    c.cargo[0] = 5;
    const ev = settleContracts(c);
    check('a consignment delivered on time pays', ev[0]?.kind === 'paid');
    check('...the reward lands in the account', c.credits === 1500);
    check('...the goods leave the hold', c.cargo[0] === 0);
    check('...and the job leaves the list', c.contracts.length === 0);
  }
  {
    const c = cmdr();
    c.contracts = [cargoRun()];
    c.cargo[0] = 4;              // sold one on the way
    const ev = settleContracts(c);
    check('a short consignment is void, not paid', ev[0]?.kind === 'incomplete');
    check('...pays nothing and takes nothing', c.credits === 1000 && c.cargo[0] === 4);
    check('...and is off the list for good', c.contracts.length === 0);
  }
  {
    const c = cmdr({ day: 11 });
    c.contracts = [cargoRun()];
    c.cargo[0] = 5;
    const ev = settleContracts(c);
    check('a late delivery expires even standing on the doorstep',
      ev[0]?.kind === 'expired' && c.credits === 1000 && c.contracts.length === 0);
  }
  {
    const c = cmdr({ systemIndex: 8 });
    c.contracts = [cargoRun()];
    c.cargo[0] = 5;
    check('a job for somewhere else is left alone',
      settleContracts(c).length === 0 && c.contracts.length === 1 && c.cargo[0] === 5);
  }
  {
    const c = cmdr({ day: 11, systemIndex: 8 });
    c.contracts = [cargoRun()];
    check('...unless the deadline has passed, wherever you are',
      settleContracts(c)[0]?.kind === 'expired' && c.contracts.length === 0);
  }
  {
    // THE branch a re-implementation gets wrong, and the reason this is one
    // function now: an unfinished bounty job at its destination is neither
    // settled nor dropped — you may come back to it until the deadline.
    const c = cmdr();
    c.contracts = [cargoRun({ kind: 'bounty', qty: 3, progress: 1 })];
    check('an unfilled bounty at its destination is kept, not failed',
      settleContracts(c).length === 0 && c.contracts.length === 1);
    c.contracts[0].progress = 3;
    check('...and pays once the count is filled',
      settleContracts(c)[0]?.kind === 'paid' && c.credits === 1500);
  }
  {
    const c = cmdr();
    c.contracts = [cargoRun({ commodity: 0 }), cargoRun({ commodity: 1, reward: 300 })];
    c.cargo[0] = 5; c.cargo[1] = 5;
    check('several jobs settle in one dock', settleContracts(c).length === 2);
    check('...and both rewards are paid', c.credits === 1800);
  }

  // --- taking it on --------------------------------------------------------
  {
    const c = cmdr();
    const offers = [cargoRun({ destination: 8 })];
    const ev = acceptContract(c, offers, 0);
    check('accepting a cargo run loads the consignment on the spot',
      ev[0]?.kind === 'accepted' && c.cargo[0] === 5);
    check('...puts it on your list', c.contracts.length === 1);
    check('...and takes it off the board', offers.length === 0);
  }
  {
    const c = cmdr();
    c.contracts = [cargoRun(), cargoRun(), cargoRun()];   // MAX_CONTRACTS
    const offers = [cargoRun({ destination: 8 })];
    const ev = acceptContract(c, offers, 0);
    check(`no more than ${MAX_CONTRACTS} jobs at once`,
      ev[0]?.kind === 'refused' && ev[0].reason === 'tooMuchWork');
    check('...and a refusal changes nothing at all',
      c.contracts.length === 3 && offers.length === 1 && c.cargo[0] === 0);
  }
  {
    const c = cmdr();
    c.cargo[0] = cargoCapacity(c);   // hold already full
    const offers = [cargoRun({ destination: 8 })];
    const ev = acceptContract(c, offers, 0);
    check('a consignment that will not fit is refused',
      ev[0]?.kind === 'refused' && ev[0].reason === 'noHoldSpace');
    check('...and nothing is loaded', c.cargo[0] === cargoCapacity(c) && offers.length === 1);
  }
  {
    check('accepting nothing is nothing', acceptContract(cmdr(), [], 0).length === 0);
  }

  // --- phrasing lives with the rule, away from the AudioContext -------------
  {
    const paid = contractMessage({ kind: 'paid', contract: cargoRun() }, systems);
    check('a payment is announced with the money',
      paid.text.includes('CONTRACT PAID') && paid.beep?.hz === 1100);
    const acc = contractMessage(
      { kind: 'accepted', contract: cargoRun({ destination: 7 }) }, systems);
    check('...and an acceptance names the destination',
      acc.text.includes('LAVE') && acc.text === acc.text.toUpperCase());
    check('a void consignment does not beep',
      contractMessage({ kind: 'incomplete', contract: cargoRun() }, systems).beep === null);
  }
}

// --- NPCs actually fly ------------------------------------------------------

// The first executable tests of NPC behaviour. Until now npc.ts read `window`
// inside update(), so the largest module in the world step threw the moment it
// was asked to simulate anything outside a browser — which is why the sim/game
// parity invariant, the one guarding the bug that went undetected for six
// training rounds, is enforced by regex over source text.

console.log('\nNPC flight');
{
  // Seeded, because these assert emergent flight and NpcShip pulls from the
  // world RNG at construction. Without this the block inherits whatever stream
  // position the tests above happened to leave, so adding a test elsewhere
  // could fail one here — which is exactly what happened when combat.ts got
  // its own tests.
  seedWorld(20_260_727);
  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const makePlayer = (pos: THREE.Vector3) =>
    ({ position: pos, quaternion: new THREE.Quaternion(), speed: 100 }) as never;
  const station = new THREE.Object3D();

  {
    const npc = new NpcShip('pirate', at(0, 0, 3000), 3);
    const before = npc.object.position.clone();
    for (let i = 0; i < 120; i++) npc.update(1 / 60, makePlayer(at(0, 0, 0)), 0, station, [npc], 160);
    check('a pirate closes on the player',
      npc.object.position.distanceTo(at(0, 0, 0)) < before.distanceTo(at(0, 0, 0)));
    check('...and does not sit still doing it', npc.speed > 0);
  }
  {
    // A hostile ship fires: update returns a FireEvent rather than dealing damage.
    //
    // Measured before asserting, because the first version of this test failed
    // and the failure was informative: a pirate that starts 400 units out is
    // lined up on a stationary player for 2.8% of frames and fires 8 times
    // across 30s x 6 ships. At 800 it is 8.8% and 21 times. That is the same
    // knife-range dead zone that runs through docs/TRAINING-LOG.md — pirates
    // are hardest to be shot by exactly where the fight happens. The window
    // here is sized to that reality rather than to what I assumed.
    let fired = 0;
    for (let seed = 0; seed < 4; seed++) {
      const npc = new NpcShip('pirate', at(0, 0, 900), seed);
      for (let i = 0; i < 1800; i++) {
        const ev = npc.update(1 / 60, makePlayer(at(0, 0, 0)), 0, station, [npc], 160);
        if (ev && ev.at === 'player') fired += 1;
      }
    }
    check(`pirates shoot at the player (${fired} times over 30s x4)`, fired > 0);
  }
  {
    // and an NPC NEVER damages anything itself — the Game resolves consequences
    const npc = new NpcShip('pirate', at(0, 0, 400), 7);
    const player = makePlayer(at(0, 0, 0));
    for (let i = 0; i < 300; i++) npc.update(1 / 60, player, 0, station, [npc], 160);
    check('an NPC only ever RETURNS a fire event, never applies it',
      (player as unknown as { speed: number }).speed === 100);
  }
  {
    // A trader does not shoot at an unprovoking commander — over a whole
    // engagement, not on one frame.
    //
    // The previous version flew a trader for one second and asserted that the
    // NEXT frame returned null. Every role returns null on almost every frame
    // — a pirate parked at point-blank range fires about 24 times in six
    // minutes — so the check passed for a pirate, for a Thargoid, and for a
    // ship with no gun at all. The pirate control below is what stops it
    // becoming vacuous again: if the harness stops producing fire events, the
    // control fails rather than the trader silently "passing".
    const engagement = (role: 'trader' | 'pirate') => {
      let events = 0;
      for (let seed = 0; seed < 6; seed++) {
        const npc = new NpcShip(role, at(0, 0, 900), seed);
        for (let i = 0; i < 3600; i++) {
          const ev = npc.update(1 / 60, makePlayer(at(0, 0, 0)), 0, station, [npc], 160);
          if (ev && ev.at === 'player') events += 1;
        }
      }
      return events;
    };
    const traderShots = engagement('trader');
    const pirateShots = engagement('pirate');
    check(`a trader minds its own business rather than attacking `
      + `(${traderShots} shots over 6 x 60s at point-blank range)`,
    traderShots === 0);
    check(`...where a pirate in the same harness does shoot (${pirateShots} shots)`,
      pirateShots > 0);
    const unmolested = new NpcShip('trader', at(0, 0, 900), 2);
    for (let i = 0; i < 1800; i++) {
      unmolested.update(1 / 60, makePlayer(at(0, 0, 0)), 0, station, [unmolested], 160);
    }
    check('...and is not even provoked by being flown at',
      !unmolested.provoked && !unmolested.provokedByPlayer);
  }

  // --- a pirate about to die spends its missiles ---------------------------
  //
  // They used to go down with them still on the rail, and the reason is
  // structural: the launch was decided in game.ts off the back of a FireEvent,
  // so a missile could only leave at the moment its owner was lined up inside
  // the gun's 0.25 rad gate with the reload finished. A pirate that is nearly
  // dead is rarely either. Measured, not assumed — see the trial below.
  //
  // Seed 5 picks the Cobra Mk III out of SPECS.pirate, the only stock pirate
  // hull that carries a missile.
  {
    /** Fly a pirate at a stationary player and report what left the rail. */
    const fly = (frames: number, hull: number, dist = 900, seedBase = 4100, seeds = 8) => {
      let missiles = 0, launchedAtAll = 0;
      for (let s = 0; s < seeds; s++) {
        seedWorld(seedBase + s);
        const npc = new NpcShip('pirate', at(0, 0, dist), 5);
        npc.threatTier = 1;
        npc.hp = npc.maxHp * hull;
        let any = false;
        for (let i = 0; i < frames; i++) {
          const ev = npc.update(1 / 60, makePlayer(at(0, 0, 0)), 0, station, [npc], 160);
          if (ev && ev.at === 'player' && ev.weapon === 'missile' && npc.missiles > 0) {
            npc.missiles -= 1;   // the Game spends the round — see enemyLaunchMissile
            missiles += 1;
            any = true;
          }
        }
        if (any) launchedAtAll += 1;
      }
      return { missiles, launchedAtAll, seeds };
    };

    seedWorld(20_260_727);
    check('a stock pirate hull carries a missile to launch',
      new NpcShip('pirate', at(0, 0, 900), 5).missiles === 1);

    const hurt = fly(300, 0.35);
    check(`a pirate on its last legs gets the missile away (${hurt.launchedAtAll}/${hurt.seeds})`,
      hurt.launchedAtAll === hurt.seeds);
    const whole = fly(300, 1, 400);
    check('...where an undamaged one at the same knife range keeps it',
      whole.missiles === 0);
    check('...and it spends the round rather than firing the rail twice',
      hurt.missiles === hurt.launchedAtAll);

    // The headline: under sustained fire, does it die holding the missile?
    // 0.667 damage/second is the player's pulse laser (CLAUDE.md's figure).
    // Before this change the answer was 0 of 20 — the opportunistic launch
    // needs 1200+ units of separation, and the fight is not fought there.
    {
      let died = 0, armedToTheEnd = 0;
      for (let s = 0; s < 20; s++) {
        seedWorld(7000 + s);
        const npc = new NpcShip('pirate', at(0, 0, 1400), 5);
        npc.threatTier = 1;
        const player = makePlayer(at(0, 0, 0));
        for (let i = 0; i < 60 * 20 && npc.alive; i++) {
          const ev = npc.update(1 / 60, player, 0, station, [npc], 160);
          if (ev && ev.at === 'player' && ev.weapon === 'missile' && npc.missiles > 0) {
            npc.missiles -= 1;
          }
          npc.takeDamage(0.667 / 60, at(0, 0, 0), true);
        }
        if (!npc.alive) died += 1;
        if (!npc.alive && npc.missiles > 0) armedToTheEnd += 1;
      }
      check(`the trial killed all 20 pirates (${died})`, died === 20);
      check(`most die having launched, not holding (${20 - armedToTheEnd}/20 launched)`,
        armedToTheEnd < 10);
    }
  }
}

// --- anything that drives behaviour is state ------------------------------

// Chris's rule, and the one this whole refactor turned on: "anything that
// drives behaviour in the system that is not a constant" belongs in the state
// object, so it is persisted. A game constant may live outside it; a value
// worked out at runtime may not.
//
// The signature of a violation is a field initialised FROM THE DICE that sits
// outside the state literal — it cannot be re-derived on restore, because by
// then the stream is somewhere else entirely. Four of these were found by
// hand, one at a time, each costing a round of "two reloads agree with each
// other but not with the run they came from": packOffset, docksHere,
// tumbleAxis and the E.C.M. roll.

console.log('\nbehaviour-driving values are state');
{
  const npcSrc = readFileSync(new URL('../src/game/npc.ts', import.meta.url), 'utf8');
  const cls = npcSrc.slice(npcSrc.indexOf('export class NpcShip'));
  // field declarations at class level (two-space indent), not inside a method
  const fieldDecls = [...cls.matchAll(/^ {2}(?:private |readonly |protected )*([a-zA-Z_]+)\s*(?::[^=\n]+)?=\s*([^\n;]+);/gm)];
  const fromDice = fieldDecls.filter(([, , init]) =>
    /random\(\)|randomDirection\(|Math\.random/.test(init));
  check(`no NpcShip field is rolled outside state${fromDice.length ? ' — ' + fromDice.map((m) => m[1]).join(', ') : ''}`,
    fromDice.length === 0);

  const gameSrc = readFileSync(new URL('../src/game/game.ts', import.meta.url), 'utf8');
  const gcls = gameSrc.slice(gameSrc.indexOf('export class Game'));
  const gFields = [...gcls.matchAll(/^ {2}(?:private |readonly |protected )*([a-zA-Z_]+)\s*(?::[^=\n]+)?=\s*([^\n;]+);/gm)];
  const gDice = gFields.filter(([, , init]) => /random\(\)|randomDirection\(|Math\.random/.test(init));
  check(`no Game field is rolled outside state${gDice.length ? ' — ' + gDice.map((m) => m[1]).join(', ') : ''}`,
    gDice.length === 0);

  // and the state objects must actually be reachable for a generic walk
  check('NpcState is one object', /readonly state: NpcState;/.test(npcSrc));
  // Structural, not a regex over source. The previous version asserted the
  // literal text `readonly session: SessionState = {` inside game.ts, and
  // broke the moment the state moved to state.ts — the third scraping check
  // to break that way in this refactor. Build the state and look at it.
  {
    const st = freshState(newCommander());
    check('the game state is one object a walk can reach',
      typeof st === 'object' && st !== null);
    check('...with the flight session inside it',
      typeof st.session === 'object' && 'torusEngaged' in st.session);
    check('...and the ship systems, the dock plan and the charts',
      !!st.sys && !!st.dockPlan && !!st.chart && !!st.world && !!st.player);
    // the snapshot walks these generically, so they must be plain data
    check('...and the session is flat, so serialiseState can walk it',
      Object.values(st.session).every((v) => typeof v !== 'object'));

    // THE check this file was missing. The capture is a hand-written list, not
    // a generic walk — a comment in game.ts claimed otherwise and was wrong.
    // Three GameState fields (dockPlan, lastThreat, ecmDetectedTimer) were
    // silently unsaved, which is the fifth time this project has shipped a
    // snapshot that forgot a field. Naming them here means the sixth is a
    // failing test rather than a bug report.
    //
    // It reads persistence.ts now: the two methods left game.ts, and that is
    // the point of them leaving — the save is a module with a name rather than
    // two private methods only a grep could find.
    const src = readFileSync(new URL('../src/game/persistence.ts', import.meta.url), 'utf8');
    const capture = src.slice(src.indexOf('capture(): WorldSnapshot {'),
      src.indexOf('restore(snap'));
    const restore = src.slice(src.indexOf('restore(snap'),
      src.indexOf('autoSave(): void'));
    // `world` and `player` are objects the snapshot saves piecewise under
    // other names; every other field must appear by name on BOTH sides.
    const piecewise = new Set(['world', 'player']);
    for (const key of Object.keys(st)) {
      if (piecewise.has(key)) continue;
      check(`snapshot saves state.${key}`, capture.includes(key));
      check(`...and restores state.${key}`, restore.includes(key));
    }
  }
}

// --- the snapshot actually round-trips --------------------------------------

// snapshot.ts had no direct coverage at all. Everything above it is a grep
// over game.ts asking whether a field NAME appears in captureSnapshot and
// restoreSnapshot — which cannot see whether the value that came back is the
// value that went in, nor whether it landed in the object the renderer reads.
//
// That is exactly the gap the file's own history describes: four rounds of
// "two reloads agree with each other but not with the run they came from".
// A name-presence check passes through every one of them, because in each
// case the name WAS there.
//
// So: build state, fly it until nothing is at its default, serialise, restore
// into a FRESH object, and compare field by field — then step both on and
// demand they stay identical, which is the property the bug actually broke.

console.log('\nsnapshot round trip');
{
  /** Vector3 and Quaternion both look like this; nothing else in the state does. */
  const vecLike = (v: unknown): v is { x: number; y: number; z: number; w?: number } =>
    !!v && typeof v === 'object'
    && typeof (v as { x?: unknown }).x === 'number'
    && typeof (v as { y?: unknown }).y === 'number'
    && typeof (v as { z?: unknown }).z === 'number';

  /** Structural equality, treating a Vector3/Quaternion as its components. */
  const same = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true;
    if (vecLike(a) && vecLike(b)) {
      return a.x === b.x && a.y === b.y && a.z === b.z && (a.w ?? null) === (b.w ?? null);
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const ka = Object.keys(a).sort();
      const kb = Object.keys(b).sort();
      if (ka.join() !== kb.join()) return false;
      return ka.every((k) => same((a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k]));
    }
    return false;
  };

  /** Which fields differ, by name — so a failure says what was lost. */
  const diff = (a: Record<string, unknown>, b: Record<string, unknown>): string[] =>
    Object.keys(a).filter((k) => !same(a[k], b[k]));

  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const makePlayer = (pos: THREE.Vector3) =>
    ({ position: pos, quaternion: new THREE.Quaternion(), speed: 220 }) as never;
  const station = new THREE.Object3D();
  const fly = (npc: NpcShip, frames: number) => {
    for (let i = 0; i < frames; i++) {
      npc.update(1 / 60, makePlayer(at(0, 0, 0)), 0, station, [npc], 160);
    }
  };

  // --- NpcState ------------------------------------------------------------
  seedWorld(20_260_729);
  const flown = new NpcShip('pirate', at(120, -80, 1400), 5);
  flown.threatTier = 1;
  fly(flown, 600);

  // A round trip over unchanged defaults proves nothing, so insist the state
  // is genuinely dirty first — vectors moved, a decision cached, clocks part
  // way through.
  const live = flown.state as unknown as Record<string, unknown>;
  check('the ship being snapshotted has actually flown',
    flown.state.pos.length() > 0 && flown.state.speed > 0
    && flown.state.brainControl !== null && flown.state.brainTimer !== 0);

  // Through JSON, not structuredClone: this is what a save is, and it is the
  // step that would expose a THREE object or a function hiding in the state.
  const wire = JSON.stringify(serialiseState(live));
  check('an NpcState snapshot is plain JSON', wire.length > 0 && !wire.includes('undefined'));
  const saved = JSON.parse(wire) as Record<string, unknown>;
  check(`every NpcState field reaches the snapshot (${Object.keys(saved).length} fields)`,
    Object.keys(live).sort().join() === Object.keys(saved).sort().join(),
    `missing: ${Object.keys(live).filter((k) => !(k in saved)).join(', ')}`);
  check('...including the three vectors and the quaternion, as arrays',
    Array.isArray(saved.pos) && (saved.pos as unknown[]).length === 3
    && Array.isArray(saved.quat) && (saved.quat as unknown[]).length === 4
    && Array.isArray(saved.packOffset) && Array.isArray(saved.waypoint));
  check('...and the nested brain decision',
    !!saved.brainControl && typeof saved.brainControl === 'object'
    && 'pitch' in (saved.brainControl as object) && 'fire' in (saved.brainControl as object));

  const fresh = new NpcShip('pirate', at(0, 0, 0), 5);
  const meshPos = fresh.object.position;
  const meshQuat = fresh.object.quaternion;
  restoreState(fresh.state as unknown as Record<string, unknown>, saved);

  // THE aliasing rule. npc.ts documents state.pos and state.quat as the SAME
  // THREE objects the mesh uses; a restore that REPLACED them would still pass
  // a value comparison and would leave the renderer drawing the old position
  // for ever, because the mesh kept the object it was given at construction.
  check('restore writes INTO the live vectors rather than replacing them',
    fresh.state.pos === meshPos && fresh.state.quat === meshQuat);
  check('...so the mesh is where the snapshot said',
    meshPos.distanceTo(flown.object.position) === 0);

  const back = diff(live, fresh.state as unknown as Record<string, unknown>);
  check(`every NpcState field survives serialise → JSON → restore${back.length ? '' : ''}`,
    back.length === 0, `lost: ${back.join(', ')}`);

  // The property all four historical bugs broke, and the only one a field
  // list cannot fake: restore the run and it must CONTINUE the same, not
  // merely look the same. Both ships fly the next 300 frames from the same
  // generator state.
  const mark = rngState();
  fly(flown, 300);
  restoreRng(mark);
  fly(fresh, 300);
  check('a restored ship replays the run it came from — position',
    fresh.object.position.distanceTo(flown.object.position) === 0,
    `drifted ${fresh.object.position.distanceTo(flown.object.position).toFixed(4)}`);
  // angleTo, not ===: it is acos of a dot product that is only unit-length to
  // within rounding, so two BIT-IDENTICAL quaternions report about 5e-6 rather
  // than 0. The exact comparison is the field-by-field one below.
  check('...attitude',
    fresh.object.quaternion.angleTo(flown.object.quaternion) < 1e-5,
    `off by ${fresh.object.quaternion.angleTo(flown.object.quaternion)}`);
  check('...and every other field',
    diff(live, fresh.state as unknown as Record<string, unknown>).length === 0,
    `diverged: ${diff(live, fresh.state as unknown as Record<string, unknown>).join(', ')}`);

  // The negative control. If restoring is a no-op the checks above must fail,
  // not pass — the failure mode this whole block exists to catch is a save
  // that quietly restores nothing and is compared against a default.
  {
    seedWorld(20_260_729);
    const unrestored = new NpcShip('pirate', at(0, 0, 0), 5);
    restoreRng(mark);
    fly(unrestored, 300);
    check('...and a ship that was NOT restored does not (the control)',
      unrestored.object.position.distanceTo(flown.object.position) > 1);
  }

  // --- SessionState --------------------------------------------------------
  //
  // Flat by contract (the check above asserts it), so the round trip is about
  // completeness: twenty-three fields, of which a hand-written snapshot once
  // caught five, and `torusEngaged` — a field that changes your speed — was
  // among the eighteen it missed.
  {
    const session = freshState(newCommander()).session as unknown as Record<string, unknown>;
    const keys = Object.keys(session);
    // Give every field a value that is NOT its default, whatever its type, so
    // no field can round-trip by having never changed.
    let n = 0;
    for (const k of keys) {
      const v = session[k];
      if (typeof v === 'boolean') session[k] = !v;
      else if (typeof v === 'number') session[k] = v + (n += 1) + 0.5;
    }
    const dirty = structuredClone(session);
    const wireSession = JSON.stringify(serialiseState(session));
    const target = freshState(newCommander()).session as unknown as Record<string, unknown>;
    restoreState(target, JSON.parse(wireSession) as Record<string, unknown>);
    check(`every SessionState field round-trips (${keys.length} fields)`,
      diff(dirty, target).length === 0, `lost: ${diff(dirty, target).join(', ')}`);
    check('...and no field is silently added or dropped',
      Object.keys(target).sort().join() === keys.sort().join());
    // control: an untouched session must NOT match, or the check above is free
    check('...where an untouched session does not match (the control)',
      diff(dirty, freshState(newCommander()).session as unknown as Record<string, unknown>)
        .length === keys.length);
  }
}

// --- one source of randomness ----------------------------------------------

// A fixed timestep buys repeatable PHYSICS. It buys nothing at all while the
// world reaches for Math.random(), which is why both had to land together: an
// unrepeatable run cannot be replayed, regression tested, or trained against.
//
// game/rng.ts is the world's only source of chance. This check is what stops
// the next Math.random() from quietly punching a hole in it.

console.log('\nseeded world');
{
  // Widened twice. It began as game/*.ts only and missed the market seed in
  // screens/trade.ts (an unseeded seed, so a reload rerolled prices) and the
  // living galaxy's default rng. It also only looked for Math.random and
  // .randomDirection(), and missed THREE's Quaternion.random() — so every ship
  // in the galaxy faced a direction the seed knew nothing about.
  // Every world file, GLOBBED — not a hand-kept list.
  //
  // The list this replaced named 19 files, listed population.ts twice (the
  // tell), and omitted combat.ts, cargo.ts, effects.ts, spawning.ts,
  // ordnance.ts and world.ts. A `Math.random()` in spawning.ts — which decides
  // what you meet on arrival — passed CI. A list that must be maintained by
  // hand to guard against forgetting things is the thing it is guarding
  // against.
  const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir))
      : e.name.endsWith('.ts') ? [new URL(e.name, dir)] : []));
  const WORLD = ['game/', 'galaxy/', 'world/', 'hud/', 'engine/']
    .flatMap((d) => walk(new URL(`../src/${d}`, import.meta.url)));

  /**
   * Files allowed an unseeded stream, each for a stated reason.
   *
   * NOT a convenience list — anything added here must be genuinely outside the
   * world: something whose output no simulation reads, so it cannot change
   * what happens next.
   */
  const EXEMPT: Record<string, string> = {
    'rng.ts': 'defines the seeded generator; seeds from Math.random only when unseeded',
    'starfield.ts': 'the backdrop, drawn once and never read by the simulation',
  };

  const offenders: string[] = [];
  for (const url of WORLD) {
    const name = url.pathname.split('/').pop()!;
    if (EXEMPT[name]) continue;
    const raw = readFileSync(url, 'utf8');
    const src = raw.replace(/^\s*(\/\/|\*).*$/gm, '');   // drop comment lines
    const short = url.pathname.slice(url.pathname.indexOf('/src/') + 5);
    // `Math.random` WITHOUT parens too: a default parameter of
    // `rng: () => number = Math.random` is an unseeded stream hiding behind an
    // injectable-looking signature, and the parenthesised check missed five.
    if (/Math\.random\b/.test(src)) offenders.push(short);
    // ...and the bracketed form, which reads as a deliberate dodge
    if (/Math\s*\[\s*['"`]random/.test(src)) offenders.push(`${short} (Math['random'])`);
    // ...and destructuring it out of Math, which leaves no `Math.` at the call
    if (/\{[^}]*\brandom\b[^}]*\}\s*=\s*Math\b/.test(src)) {
      offenders.push(`${short} (destructured from Math)`);
    }
    // three.js has its own generators, and they all reach for Math.random
    if (/\.randomDirection\(\)/.test(src)) offenders.push(`${short} (THREE randomDirection)`);
    // Any `x.random()` — THREE's Quaternion.random() and friends.
    //
    // This check was DEAD for its whole life. It read
    // `/\.random\(\)/.test(src.replace(/\brandom\(\)/g, ''))`, and `\b`
    // matches between the `.` and the `r`, so the replace ate the very text
    // the regex was hunting. An audit smuggled `new THREE.Quaternion().random()`
    // into NpcShip's constructor and all 355 checks passed. The seeded
    // `random()` has no dot before it, so no replace was ever needed.
    if (/\.random\(\)/.test(src)) offenders.push(`${short} (a THREE .random())`);
  }
  check(`world code uses the seeded rng only${offenders.length ? ' — found in ' + offenders.join(', ') : ''}`,
    offenders.length === 0);

  // and the rng itself must actually be deterministic
  seedWorld(1234);
  const a = [random(), random(), random()];
  seedWorld(1234);
  const b = [random(), random(), random()];
  check('the same seed gives the same stream', JSON.stringify(a) === JSON.stringify(b));
  seedWorld(5678);
  const c = [random(), random(), random()];
  check('a different seed gives a different one', JSON.stringify(a) !== JSON.stringify(c));
  check('...and it is a real distribution, not a constant',
    new Set(a).size === 3 && a.every((n) => n >= 0 && n < 1));
}

// --- what the shot hit ------------------------------------------------------

// I nearly left this in game.ts on the grounds that a raycast cannot be tested
// without the hulls. Wrong: three.js maths runs under node with no canvas, so
// the hulls can just be BUILT here. They are.

console.log('\nshot tracing');
{
  const box = (x: number, y: number, z: number, size = 40) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(size, size, size));
    o.position.set(x, y, z);
    o.updateMatrixWorld(true);
    return o;
  };
  const ship = (x: number, y: number, z: number, over: Record<string, unknown> = {}) =>
    ({ object: box(x, y, z), alive: true, radius: 20, ...over });
  const ray = new THREE.Raycaster();
  const scratch = new THREE.Vector3();
  const origin = new THREE.Vector3(0, 0, 0);
  const ahead = new THREE.Vector3(0, 0, -1);
  const trace = (ships: unknown[], cargo: unknown[] = [], station: THREE.Object3D | null = null) =>
    traceShot(origin, ahead, ships as never, cargo as never, station, ray, scratch);

  check('a shot down the axis hits the ship in front of it',
    trace([ship(0, 0, -500)]).kind === 'ship');
  check('a shot into empty space misses',
    trace([ship(0, 6000, -500)]).kind === 'miss');
  check('a destroyed ship does not stop the beam',
    trace([ship(0, 0, -500, { alive: false })]).kind === 'miss');
  {
    const near = ship(0, 0, -300), far = ship(0, 0, -900);
    const hit = trace([far, near]);
    check('the NEAREST ship is hit, whatever order they are listed in',
      hit.kind === 'ship' && (hit as { ship: unknown }).ship === near);
  }
  check('beyond laser range, nothing is hit',
    trace([ship(0, 0, -9000)]).kind === 'miss');
  check('drifting cargo is solid',
    trace([], [{ object: box(0, 0, -400, 12) }]).kind === 'cargo');
  check('the station is solid',
    trace([], [], box(0, 0, -600, 300)).kind === 'station');
  {
    // the station wins a tie because anything at a shorter ray distance
    // "behind" it is in fact inside it
    const hit = trace([ship(0, 0, -700)], [], box(0, 0, -600, 400));
    check('the station stops a shot aimed at a ship inside it', hit.kind === 'station');
  }
  {
    // the graze pass: a near miss inside the assist cone still connects
    const offset = ship(14, 0, -400);
    check('a near miss inside the assist envelope still counts',
      trace([offset]).kind === 'ship');
    const wide = ship(300, 0, -400);
    check('...and a genuine miss does not', trace([wide]).kind === 'miss');
  }
}

// --- the player's guns ------------------------------------------------------

// systems.ts owns the heat and the cooldown; gunnery.ts decides what pulling
// the trigger means. Finding what the shot hit stays in game.ts — that is a
// raycast against the scene graph, and there is no honest way to test it
// without the hulls.

console.log('\ngunnery');
{
  const equip = (over: Record<string, unknown> = {}) => ({
    laser: 'pulse', rearLaser: false, leftLaser: false, rightLaser: false, ...over,
  }) as Parameters<typeof laserForView>[0];

  check('the front mount carries whatever is fitted',
    laserForView(equip({ laser: 'military' }), 0)?.damage === LASERS.military.damage);
  check('an empty rear mount does not fire', laserForView(equip(), 1) === null);
  check('a purchased rear mount fires a PULSE laser, whatever is up front',
    laserForView(equip({ laser: 'military', rearLaser: true }), 1)?.damage === LASERS.pulse.damage);
  check('left and right mounts behave the same way',
    laserForView(equip({ leftLaser: true }), 2) !== null
    && laserForView(equip({ rightLaser: true }), 3) !== null
    && laserForView(equip({ leftLaser: true }), 3) === null);

  {
    const sys = freshSystems();
    check('a cool, ready laser fires', canFire(sys));
    chargeShot(sys, LASERS.pulse);
    check('...and then has to cool down', !canFire(sys));
    sys.laserCooldown = 0;
    check('...and fires again once it has', canFire(sys));
    sys.laserTemp = 0.99;
    check('an overheated laser cuts out', !canFire(sys));
  }
  {
    // all mounts share one heat budget — a documented simplification
    const sys = freshSystems();
    for (let i = 0; i < 30; i++) { sys.laserCooldown = 0; if (canFire(sys)) chargeShot(sys, LASERS.pulse); }
    check('held fire eventually overheats the gun', !canFire(sys));
  }
  {
    check('the assist is full at knife range', assistAt(0) === AIM_ASSIST);
    check('...tapers with distance',
      assistAt(1500) > 0 && assistAt(1500) < AIM_ASSIST);
    check('...and is gone by the fade-out range', assistAt(3000) === 0);
    check('a bigger ship is easier to hit at the same range',
      hitCone(34, 1000) > hitCone(18, 1000));
    check('the same ship is harder to hit further away',
      hitCone(18, 2000) < hitCone(18, 500));
    check('cargo gets a flat tolerance and no assist',
      canisterCone(500) > 0 && canisterCone(3000) < canisterCone(500));
  }
  {
    // ...and the NPC's choice of weapon, which is gunnery.ts's too. The
    // opportunistic launch: a comfortable band, and dice.
    const mid = (MISSILE_MIN_RANGE + MISSILE_MAX_RANGE) / 2;
    check('an NPC swaps a bolt for a missile at a comfortable range',
      npcPrefersMissile(mid, MISSILE_CHANCE - 0.01));
    check('...only sometimes', !npcPrefersMissile(mid, MISSILE_CHANCE + 0.01));
    check('...and never at knife range or across the system',
      !npcPrefersMissile(MISSILE_MIN_RANGE - 1, 0) && !npcPrefersMissile(MISSILE_MAX_RANGE + 1, 0));

    // The last stand: a pirate that is about to die should not take its
    // missiles down with it.
    const dying = MISSILE_LAST_STAND_HULL - 0.01;
    check('a healthy ship saves its missile for a better moment',
      !npcMissileLastStand(1, 800, 0));
    check('...and a ship this close to death spends it',
      npcMissileLastStand(dying, 800, 0));
    check('...exactly at the threshold, not just below it',
      npcMissileLastStand(MISSILE_LAST_STAND_HULL, 800, 0)
      && !npcMissileLastStand(MISSILE_LAST_STAND_HULL + 0.01, 800, 0));
    check('it launches where it would never bother with one otherwise',
      npcMissileLastStand(dying, MISSILE_MIN_RANGE - 100, 0)
      && !npcPrefersMissile(MISSILE_MIN_RANGE - 100, 0));
    check('...on a bearing rather than a firing line, because the seeker aims',
      npcMissileLastStand(dying, 800, MISSILE_LAST_STAND_GATE - 0.01));
    check('...but not at something behind it',
      !npcMissileLastStand(dying, 800, MISSILE_LAST_STAND_GATE + 0.01));
    check('...nor point blank, where the player could not answer it',
      !npcMissileLastStand(dying, MISSILE_LAST_STAND_MIN_RANGE - 1, 0));
    check('...nor from further out than the seeker is worth',
      !npcMissileLastStand(dying, MISSILE_MAX_RANGE + 1, 0));
  }
}

// --- what turns up, and when ------------------------------------------------

// Traders arriving, pirate waves, Thargon drones. These rules decide how
// dangerous every system in the galaxy feels and had no test, because they ran
// as timers inline in updateFlight. game/encounters.ts now.

console.log('\nencounters');
{
  const conds = (over: Record<string, unknown> = {}) => ({
    witchspace: false, productivity: 10_000, government: 7,
    traderCount: 0, activeThargons: 0, hasThargoidMother: false,
    playerFarFromStation: true, ...over,
  }) as Parameters<typeof stepEncounters>[2];
  /** run until something is produced, or give up */
  const until = (t: Parameters<typeof stepEncounters>[0], c: Parameters<typeof stepEncounters>[2],
                 want: string, secs = 2000) => {
    for (let i = 0; i < secs * 10; i++) {
      for (const o of stepEncounters(t, 0.1, c, () => 0.5)) if (o.kind === want) return o;
    }
    return null;
  };

  check('traders arrive to keep the lanes alive',
    until({ trader: 1, pirateWave: 1e9, thargon: 1e9 }, conds(), 'trader') !== null);
  check('...but not once the system is already busy',
    until({ trader: 1, pirateWave: 1e9, thargon: 1e9 }, conds({ traderCount: 4 }), 'trader', 400) === null);
  check('nothing arrives in witch-space',
    until({ trader: 1, pirateWave: 1, thargon: 1e9 }, conds({ witchspace: true }), 'trader', 400) === null);

  {
    const anarchy = until({ trader: 1e9, pirateWave: 1, thargon: 1e9 },
      conds({ government: 0 }), 'pirateWave');
    check('anarchies send pirates two at a time',
      anarchy !== null && (anarchy as { count: number }).count === 2);
    const rough = until({ trader: 1e9, pirateWave: 1, thargon: 1e9 },
      conds({ government: 3 }), 'pirateWave');
    check('a merely lawless system sends one',
      rough !== null && (rough as { count: number }).count === 1);
    check('a corporate state sends none',
      until({ trader: 1e9, pirateWave: 1, thargon: 1e9 }, conds({ government: 7 }), 'pirateWave', 600) === null);
    check('and nobody ambushes you on the station doorstep',
      until({ trader: 1e9, pirateWave: 1, thargon: 1e9 },
        conds({ government: 0, playerFarFromStation: false }), 'pirateWave', 600) === null);
  }
  {
    check('a mothership deploys drones',
      until({ trader: 1e9, pirateWave: 1e9, thargon: 1 }, conds({ hasThargoidMother: true }), 'thargon') !== null);
    check('...up to a limit',
      until({ trader: 1e9, pirateWave: 1e9, thargon: 1 },
        conds({ hasThargoidMother: true, activeThargons: 4 }), 'thargon', 200) === null);
    check('...and not at all without one',
      until({ trader: 1e9, pirateWave: 1e9, thargon: 1 }, conds(), 'thargon', 200) === null);
  }
  {
    // a productive system discounts the gap between arrivals
    const busy = { trader: 0, pirateWave: 1e9, thargon: 1e9 };
    stepEncounters(busy, 0.1, conds({ productivity: 60_000 }), () => 0);
    const quiet = { trader: 0, pirateWave: 1e9, thargon: 1e9 };
    stepEncounters(quiet, 0.1, conds({ productivity: 0 }), () => 0);
    check('busy economies run busier lanes', busy.trader < quiet.trader);
  }
}

// --- who hunts whom ---------------------------------------------------------

// The fights the player is not in. This ran inline in updateFlight on a
// 2-second timer, which is why it never had a test; it is game/npc-targeting.ts
// now, pure over the fleet.

console.log('\nNPC targeting');
{
  const at = (x: number) => ({ position: { distanceTo: (o: { x: number }) => Math.abs(x - o.x), x } });
  let id = 0;
  const ship = (role: string, x: number, over: Record<string, unknown> = {}) => ({
    id: id++, role, alive: true, npcTarget: null as unknown, attackers: [] as unknown[],
    object: at(x), ...over,
  }) as unknown as Parameters<typeof assignNpcTargets>[0][number];
  const playerAt = (x: number) => ({ distanceTo: (o: { x: number }) => Math.abs(x - o.x), x }) as unknown as Parameters<typeof assignNpcTargets>[1];

  {
    const pirate = ship('pirate', 0), trader = ship('trader', 1000);
    assignNpcTargets([pirate, trader], playerAt(500_000), 0);
    check('a pirate with no player nearby goes after a trader', pirate.npcTarget === trader);
    check('...and the trader knows who is after it', trader.attackers.includes(pirate));
  }
  {
    const pirate = ship('pirate', 0), trader = ship('trader', 1000);
    assignNpcTargets([pirate, trader], playerAt(100), 0);
    check('a pirate with the PLAYER in reach ignores the trader', pirate.npcTarget === null);
  }
  {
    const pirate = ship('pirate', 0), trader = ship('trader', 50_000);
    assignNpcTargets([pirate, trader], playerAt(500_000), 0);
    check('a trader out of range is not worth chasing', pirate.npcTarget === null);
  }
  {
    const police = ship('police', 0), pirate = ship('pirate', 1000);
    assignNpcTargets([police, pirate], playerAt(500_000), 0);
    check('police hunt pirates', police.npcTarget === pirate);
  }
  {
    const hunter = ship('hunter', 0), pirate = ship('pirate', 1000);
    assignNpcTargets([hunter, pirate], playerAt(500_000), 0);
    check('a bounty hunter helps out when you are clean', hunter.npcTarget === pirate);
    const hunter2 = ship('hunter', 0), pirate2 = ship('pirate', 1000);
    assignNpcTargets([hunter2, pirate2], playerAt(500_000), 2);
    check('...and has better things to do when you are a fugitive',
      hunter2.npcTarget === null);
  }
  {
    const pirate = ship('pirate', 0), trader = ship('trader', 1000);
    assignNpcTargets([pirate, trader], playerAt(500_000), 0);
    const dead = ship('trader', 900);
    pirate.npcTarget = dead;
    (dead as unknown as { alive: boolean }).alive = false;
    assignNpcTargets([pirate, trader, dead], playerAt(500_000), 0);
    check('a ship whose quarry died picks a new one', pirate.npcTarget === trader);
  }
  {
    const trader = ship('trader', 0);
    const gone = ship('pirate', 100);
    trader.attackers.push(gone);
    (gone as unknown as { alive: boolean }).alive = false;
    assignNpcTargets([trader, gone], playerAt(500_000), 0);
    check('dead attackers are pruned from the list they are on',
      !trader.attackers.includes(gone));
  }
}

// --- the ship's own numbers -------------------------------------------------

// Energy, shields and heat ran inline in updateFlight, and the damage model
// sat inside applyPlayerDamage next to a call to flashDamage(). They are now
// game/systems.ts, which is pure and importable — so these are the first real
// tests of the numbers every balance claim in this project rests on.
//
// train/survivability.ts used to carry this model in a COMMENT and hard-code
// 3.0 and 4.0 from it. It calls durability() now.

console.log('\nship systems');
{
  check('durability from the front is 1 shield + 4 energy / 2 = 3',
    durability(false) === 3);
  check('manoeuvring so both faces take hits is worth 4',
    durability(true) === 4);

  {
    const s = freshSystems();
    const r = applyDamage(s, 0.4, true, () => 1);
    check('a hit from ahead is absorbed by the FORE shield',
      Math.abs(s.foreShield - 0.6) < 1e-9 && s.aftShield === 1 && s.energy === 4);
    check('...and does not reach the hull', !r.reachedHull && !r.destroyed);
  }
  {
    const s = freshSystems();
    applyDamage(s, 0.4, false, () => 1);
    check('a hit from behind is absorbed by the AFT shield',
      Math.abs(s.aftShield - 0.6) < 1e-9 && s.foreShield === 1);
  }
  {
    const s = freshSystems();
    applyDamage(s, 1.5, true, () => 1);   // 1.0 shield + 0.5 through
    check('overflow past a flattened shield costs energy at 2 per point',
      s.foreShield === 0 && Math.abs(s.energy - 3) < 1e-9);
  }
  {
    const s = freshSystems();
    const r = applyDamage(s, 3.0, true, () => 1);
    check('exactly 3.0 from the front destroys the ship', r.destroyed && s.energy <= 0);
  }
  {
    const s = freshSystems();
    const r = applyDamage(s, 2.9, true, () => 1);
    check('...and 2.9 does not', !r.destroyed && s.energy > 0);
  }
  {
    const s = freshSystems();
    const never = applyDamage(s, 1.5, true, () => 0.99);
    const always = applyDamage(freshSystems(), 1.5, true, () => 0.01);
    check('a hull hit rolls for wrecking a fitting',
      !never.wreckedSomething && always.wreckedSomething);
  }

  {
    // shields only come back once energy is healthy — a beaten ship has to
    // break off before it gets them back, which is the whole tactical point
    const s = freshSystems();
    s.energy = 0.5; s.foreShield = 0; s.aftShield = 0;
    regenerate(s, 1, { energyUnit: false });
    check('shields do NOT regenerate while energy is below 1',
      s.foreShield === 0 && s.aftShield === 0);
    s.energy = 2;
    regenerate(s, 1, { energyUnit: false });
    check('...and do once it recovers', s.foreShield > 0 && s.aftShield > 0);
  }
  {
    const plain = freshSystems(); plain.energy = 0;
    const boosted = freshSystems(); boosted.energy = 0;
    regenerate(plain, 1, { energyUnit: false });
    regenerate(boosted, 1, { energyUnit: true });
    check('an energy unit doubles the recharge rate',
      Math.abs(boosted.energy - plain.energy * 2) < 1e-9);
  }
  {
    const s = freshSystems();
    check('deep space is cold', !updateCabinTemp(s, 1, 1_000_000) && s.cabinTemp === 0);
    let dead = false;
    for (let i = 0; i < 600 && !dead; i++) dead = updateCabinTemp(s, 1 / 60, 0);
    check('sitting in the sun eventually kills you', dead);
  }
  {
    check('no scoops, no fuel', scoopFuel(1, 1000, false, 0, 70) === 0);
    check('scoops but too far out gathers nothing', scoopFuel(1, 200_000, true, 0, 70) === 0);
    check('scooping close in gathers fuel', scoopFuel(1, 1000, true, 0, 70) > 0);
    check('a full tank never overfills', scoopFuel(1, 1000, true, 70, 70) === 0);
    check('...and a nearly-full one fills exactly to the top',
      Math.abs(scoopFuel(1, 1000, true, 69.5, 70) - 0.5) < 1e-9);
  }
}

// --- police only care about what YOU did ------------------------------------

// takeDamage() sets `provoked` for damage from ANY source, including another
// NPC. isHostileToPlayer() used to read that flag, so a Viper fighting a
// pirate turned on a clean commander — which is what Chris flew into while
// approaching a station.
//
// These were four regex assertions against source text, because npc.ts could
// not be imported under node. It can now, so they call the function instead.

console.log('\npolice hostility');
{
  const npcLike = (role: string, over: Record<string, unknown> = {}) =>
    ({ alive: true, inert: false, satisfied: false, role, provoked: false,
       provokedByPlayer: false, ...over }) as unknown as Parameters<typeof isHostileToPlayer>[0];

  check('pirates are hostile to anyone',
    isHostileToPlayer(npcLike('pirate'), 0));
  check('a pirate paid off in cargo breaks off',
    !isHostileToPlayer(npcLike('pirate', { satisfied: true }), 0));
  check('police ignore a clean commander',
    !isHostileToPlayer(npcLike('police'), 0));
  check('police hunt a fugitive',
    isHostileToPlayer(npcLike('police', { legalStatus: 2 }), 2));
  check('POLICE IN A FIGHT WITH SOMEONE ELSE STAY FRIENDLY',
    !isHostileToPlayer(npcLike('police', { provoked: true }), 0));
  check('police you shot at come for you',
    isHostileToPlayer(npcLike('police', { provoked: true, provokedByPlayer: true }), 0));
  check('bounty hunters ignore a clean commander',
    !isHostileToPlayer(npcLike('hunter'), 0));
  check('bounty hunters in a fight with someone else stay friendly',
    !isHostileToPlayer(npcLike('hunter', { provoked: true }), 0));
  check('a destroyed ship is hostile to nobody',
    !isHostileToPlayer(npcLike('pirate', { alive: false }), 0));

  // the station's own Vipers are launched AT you, so they must read hostile
  const game = readFileSync(new URL('../src/game/game.ts', import.meta.url), 'utf8');
  check('station defence vipers still come for you',
    /viper\.provokedByPlayer = true/.test(game));
}

// --- sim/game combat parity (invariant 2) -----------------------------------

// The combat numbers exist twice — src/ai-training/core.ts and src/game/{npc,game}.ts
// — and CLAUDE.md asks you to change both together. That has been a manual
// promise until now, and it is exactly the kind nobody keeps: the two files
// are edited months apart, drift is silent, and every trained brain was
// fitted to the sim's copy. A balance conclusion drawn from the tournament is
// only as good as this parity.
//
// BOTH SIDES ARE IMPORTED VALUES. The block used to read core.ts as text on
// the grounds that "npc.ts pulls in three.js and touches window" — true of
// npc.ts once, and never true of core.ts, which is deliberately self-contained
// and node-safe precisely so the trainer can run it. Scraping it meant a
// regex per field, each one able to fail open (a renamed constant reads as
// null, a moved table reads as NaN) on a check whose whole job is to notice
// change. Only the module-PRIVATE constants are still read as text: player.ts's
// flight envelope and the RATE_RAMP/RATE_DECAY pair on each side.

console.log('\nsim/game combat parity');
{
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const core = read('../src/ai-training/core.ts');

  const num = (src: string, re: RegExp): number | null => {
    const m = src.match(re);
    return m ? Number(m[1]) : null;
  };

  // The PLAYER's laser, against the sim's model of it.
  //
  // This check used to compare core.ts's LASER — which is the player's pulse
  // laser — against game.ts's NPC damage roll, and passed because
  // 0.1 + 0.12/2 happens to equal 0.16. Two different weapons agreeing by
  // coincidence. Its real counterpart is LASERS.pulse in gunnery.ts, and that
  // was never checked at all.
  check(`pulse laser damage: sim ${LASER.damage} == game ${LASERS.pulse.damage}`,
    LASER.damage === LASERS.pulse.damage);
  check(`pulse laser cooldown: sim ${LASER.cooldown} == game ${LASERS.pulse.cooldown}`,
    LASER.cooldown === LASERS.pulse.cooldown);
  check(`pulse laser heat: sim ${LASER.heat} == game ${LASERS.pulse.heat}`,
    LASER.heat === LASERS.pulse.heat);
  check(`laser cool rate: sim ${LASER.coolRate} == game ${LASER_COOL_RATE}`,
    LASER.coolRate === LASER_COOL_RATE);
  // The player's reach. The NPC's was asserted below and this one was not,
  // though they are the same pair of duplicated numbers: a sim that lets the
  // commander open fire at a range the game refuses trains policies against a
  // threat envelope that does not exist.
  check(`pulse laser range: sim ${LASER.range} == game ${LASER_RANGE}`,
    LASER.range === LASER_RANGE);

  // IMPORTED VALUES, not regexes over source text.
  //
  // These were four `num(npc, /.../)` captures taking the FIRST match in the
  // file. Two consequences, both real: replacing a literal with a named
  // constant broke the check for no behavioural reason, and — worse — the
  // firing-gate check silently measured brainFly's 0.25 while attack()'s
  // drifted 0.22 sat forty lines below, unseen, on the path every police
  // ship, bounty hunter and thargoid actually fires from.
  check(`NPC fire rate: sim ${NPC_GUN.cooldownLo}+${NPC_GUN.cooldownSpread}`
    + ` == game ${NPC_COOLDOWN_LO}+${NPC_COOLDOWN_SPREAD}`,
  NPC_GUN.cooldownLo === NPC_COOLDOWN_LO && NPC_GUN.cooldownSpread === NPC_COOLDOWN_SPREAD);

  check(`NPC firing gate: sim ${NPC_GUN.gate} rad == game ${NPC_FIRE_GATE} rad`,
    NPC_GUN.gate === NPC_FIRE_GATE);

  check(`NPC laser range: sim ${NPC_GUN.range} == game ${NPC_LASER_RANGE}`,
    NPC_GUN.range === NPC_LASER_RANGE);

  // The whole NPC gun, compared as VALUES.
  //
  // These were two regexes over game.ts — a `Math.min(0.85, Math.max(` that
  // bound to the first such clamp in 2,800 lines, and a substring match on the
  // damage expression. Four of NPC_GUN's fields had no assertion at all, so
  // changing damageSpread in the sim would have gone unnoticed: the game's
  // NPC damage was only pinned indirectly, through the PLAYER's pulse laser
  // happening to average the same number.
  //
  // The literals live in gunnery.ts now, beside the player's gun, and both
  // sides import.
  check(`NPC hit cap: sim ${NPC_GUN.hitCap} == game ${NPC_HIT_CAP}`,
    NPC_GUN.hitCap === NPC_HIT_CAP);
  check(`NPC hit floor: sim ${NPC_GUN.hitFloor} == game ${NPC_HIT_FLOOR}`,
    NPC_GUN.hitFloor === NPC_HIT_FLOOR);
  check(`NPC hit base: sim ${NPC_GUN.hitBase} == game ${NPC_HIT_BASE}`,
    NPC_GUN.hitBase === NPC_HIT_BASE);
  check(`NPC hit falloff: sim ${NPC_GUN.hitFalloff} == game ${NPC_HIT_FALLOFF}`,
    NPC_GUN.hitFalloff === NPC_HIT_FALLOFF);
  check(`NPC damage: sim ${NPC_GUN.damageLo}+${NPC_GUN.damageSpread}`
    + ` == game ${NPC_DAMAGE_LO}+${NPC_DAMAGE_SPREAD}`,
  NPC_GUN.damageLo === NPC_DAMAGE_LO && NPC_GUN.damageSpread === NPC_DAMAGE_SPREAD);

  // and the curve itself, at both clamps and in between
  check('an NPC shot at point blank is capped, not certain', npcHitChance(0) === NPC_HIT_CAP);
  check('...and at extreme range it floors rather than reaching zero',
    npcHitChance(99_999) === NPC_HIT_FLOOR);
  check('...and falls off with distance between them',
    npcHitChance(500) > npcHitChance(2500));

  // The sim's model of the PLAYER must match the player. Its own comment says
  // it mirrors player.ts, and every field did except accel: 120 against the
  // real 220, so every pirate brain was fitted against a commander who took
  // nearly twice as long to reach speed as the one they actually hunt.
  const playerSrc = read('../src/player.ts');
  const realAccel = num(playerSrc, /const ACCEL = ([\d.]+);/);
  check(`player accel: game ${realAccel} == sim playerCobra ${CLASSES.playerCobra.accel}`,
    realAccel !== null && realAccel === CLASSES.playerCobra.accel);
  // The turn-rate ramp and decay. Decay had drifted (game 12.0, sim 5.0) —
  // the same failure as accel, in the adjacent field, unasserted for as long.
  const simRamp = num(core, /const RATE_RAMP = ([\d.]+);/);
  const playerDecay = num(playerSrc, /const RATE_DECAY = ([\d.]+);/);
  const playerRamp = num(playerSrc, /const RATE_RAMP = ([\d.]+);/);
  check(`RATE_RAMP: game ${playerRamp} == sim ${simRamp}`,
    playerRamp !== null && playerRamp === simRamp);

  // ...and the NPC's copy of the same pair, which nobody was comparing at all.
  //
  // core.ts's `ramp()` is what stepShip integrates during training; npc.ts's
  // brainFly has its own, and the two constants there are a THIRD copy of the
  // number — the sim's, the player's, and the NPCs'. The ramp agrees. The
  // decay does not, and it is the identical bug CLAUDE.md records for the
  // player: the sim moved to 12.0 and this side stayed at 5.0.
  check(`NPC turn-rate ramp: game ${BRAIN_RATE_RAMP} == sim ${simRamp}`,
    BRAIN_RATE_RAMP === simRamp);

  const realMaxSpeed = num(playerSrc, /const MAX_SPEED = ([\d.]+);/);
  check(`player top speed: game ${realMaxSpeed} == sim playerCobra ${CLASSES.playerCobra.maxSpeed}`,
    realMaxSpeed !== null && realMaxSpeed === CLASSES.playerCobra.maxSpeed);

  // playerCobra.turnRate is not a number anybody chose — it is MAX_PITCH
  // divided by TURN.pitch, because the sim multiplies the two back together in
  // stepShip. That quotient was worked out by hand in a comment and recomputed
  // by nothing, so a change to MAX_PITCH (it has moved twice) would leave the
  // sim modelling a commander who turns at the OLD rate, silently, for as long
  // as it took someone to reread the comment.
  //
  // Not exact by design: the stored 1.036 is 1.45/1.4 = 1.03571… rounded to
  // three places, which is 0.03% out and worth 0.0004 rad/s. The tolerance is
  // sized to that rounding, not to drift.
  const realPitch = num(playerSrc, /const MAX_PITCH = ([\d.]+);/);
  const wantTurn = (realPitch ?? NaN) / TURN.pitch;
  check(`player turn rate: game MAX_PITCH ${realPitch}/TURN.pitch ${TURN.pitch}`
    + ` = ${wantTurn.toFixed(5)} == sim playerCobra ${CLASSES.playerCobra.turnRate}`,
  Math.abs(CLASSES.playerCobra.turnRate - wantTurn) < 0.001);
  // The same ship's ROLL is a genuine mismatch rather than rounding — flagged,
  // not asserted, because which side is right is a retraining decision:
  // MAX_ROLL is 2.5 where the sim gives the player turnRate * TURN.roll.
  {
    const realRoll = num(playerSrc, /const MAX_ROLL = ([\d.]+);/);
    const simRoll = CLASSES.playerCobra.turnRate * TURN.roll;
    if (realRoll !== null && Math.abs(realRoll - simRoll) > 0.001) {
      console.log(`  note player roll rate: game MAX_ROLL ${realRoll}`
        + ` vs sim ${simRoll.toFixed(4)} (turnRate x TURN.roll) — see the TODO below`);
    }
  }

  // Ram damage moved out of game.ts into collisions.ts as a named constant,
  // which is an improvement on a bare 0.45 appearing three times — and this
  // check noticed the moment it moved, which is the check working.
  check(`collision damage: sim ${COLLISION.damage} == RAM_DAMAGE ${RAM_DAMAGE}`,
    COLLISION.damage === RAM_DAMAGE);
  // ...and what a ram costs you in SPEED, which was duplicated just as plainly
  // and never compared. It is the half of the rule that decides whether
  // ramming is an escape or a mistake: the damage says what it costs, this
  // says whether you get away afterwards.
  check(`collision speed kept: sim ${COLLISION.speedRetained}`
    + ` == game player ${PLAYER_SPEED_KEPT} / npc ${NPC_SPEED_KEPT}`,
  COLLISION.speedRetained === PLAYER_SPEED_KEPT
    && COLLISION.speedRetained === NPC_SPEED_KEPT);

  // hulls the sim models, and their game counterparts
  for (const [simKey, gameDef, role] of [
    ['pirateCobra', 'COBRA_MK3', 'pirate'],
    ['pirateSidewinder', 'SIDEWINDER', 'pirate'],
    ['traderCobra', 'COBRA_MK3', 'trader'],
  ] as const) {
    const sim = CLASSES[simKey];
    // The game's side is an IMPORTED VALUE, not scraped source. The regex
    // version broke every time these tables moved or a literal became a named
    // constant, and a parity check that silently reads NaN is worse than none.
    const spec = SPECS[role].find((x) => x.def === SHIP_DEFS[gameDef]);
    const hp = spec?.hp;
    const speed = spec?.maxSpeed;
    const turn = spec?.turnRate;
    check(`${simKey}: hp ${sim.hp}/${hp}, speed ${sim.maxSpeed}/${speed}, turn ${sim.turnRate}/${turn} match`,
      sim.hp === hp && sim.maxSpeed === speed && sim.turnRate === turn);
    // Radius is not cosmetic: fireLaser sizes its hit cone as
    // atan(target.radius * LASER.aim / dist), so a hull that is fatter in the
    // sim than in the game is one the trained policy expects to hit from
    // further out than it ever can. It was duplicated in both tables and
    // compared in neither.
    check(`${simKey} radius: sim ${sim.radius} == game ${spec?.radius}`,
      sim.radius === spec?.radius);
  }

  // --- the speed floor -------------------------------------------------------
  //
  // The sim gives each fighter hull an absolute `minSpeed`; the game applies
  // one fraction, MIN_CRUISE_FRACTION, to every hostile's top speed. Same
  // rule, expressed twice and never compared — and it is a load-bearing rule,
  // not a detail: it is the whole reason a pirate cannot stop dead and become
  // a turret (see the ShipClass.minSpeed comment, and CLAUDE.md invariant 8).
  //
  // Deliberately approximate, so this is a tolerance and not an equality:
  // 110/260 = 0.4231 and 130/300 = 0.4333 both round to "about 0.43". The 2%
  // window admits that and nothing else — moving either minSpeed by a single
  // step of 10 fails it.
  for (const key of ['pirateCobra', 'pirateSidewinder'] as const) {
    const sim = CLASSES[key];
    const gameFloor = sim.maxSpeed * MIN_CRUISE_FRACTION;
    const ratio = (sim.minSpeed ?? 0) / sim.maxSpeed;
    check(`${key} speed floor: sim ${sim.minSpeed} (${ratio.toFixed(4)} of top)`
      + ` == game ${gameFloor.toFixed(1)} (MIN_CRUISE_FRACTION ${MIN_CRUISE_FRACTION})`,
    sim.minSpeed !== undefined && Math.abs(sim.minSpeed - gameFloor) / gameFloor < 0.02);
  }
  // and the other half of the same rule: a trader is allowed to come to rest,
  // in both places. npc.ts gives the floor only to pirates and thargoids.
  check('traderCobra has no speed floor in the sim, as it has none in the game',
    CLASSES.traderCobra.minSpeed === undefined);

  // --- throttle authority ----------------------------------------------------
  //
  // The game accelerates EVERY brain-flown NPC at one flat rate; the sim gives
  // each hull its own. They agree for the pirate Cobra and disagree for the
  // other two — see the TODO below.
  check(`brain-flown NPC accel: game ${BRAIN_ACCEL} == sim pirateCobra ${CLASSES.pirateCobra.accel}`,
    BRAIN_ACCEL === CLASSES.pirateCobra.accel);

  // TODO(owner): per-hull accel does NOT match, and this test does not decide
  // who is right. npc.ts brainFly throttles every ship at BRAIN_ACCEL = 120,
  // where ai-training/core.ts gives:
  //
  //     pirateCobra      accel 120  ==  game 120   ok
  //     pirateSidewinder accel 140  vs  game 120   MISMATCH (+17%)
  //     traderCobra      accel 100  vs  game 120   MISMATCH (-17%)
  //
  // Both shipped attack brains were fitted in the sim, so a Sidewinder was
  // trained to close and break off with 17% more throttle authority than the
  // game gives it, and armed traders (jameson-defend-g1) were trained with
  // 17% less. Which side moves is a retraining decision — invariant 2 and
  // CLAUDE.md's RATE_DECAY precedent — so it is reported, not "fixed".
  // Uncomment once the owner has picked a side:
  //
  // for (const [simKey] of [['pirateCobra'], ['pirateSidewinder'], ['traderCobra']] as const) {
  //   check(`${simKey} accel: sim ${CLASSES[simKey].accel} == game ${BRAIN_ACCEL}`,
  //     CLASSES[simKey].accel === BRAIN_ACCEL);
  // }
  //
  // TODO(owner): so does the player's MAX_ROLL — 2.5 in player.ts against the
  // sim's playerCobra.turnRate * TURN.roll = 2.4864. Same call, same reason.
  // The `note` line above prints the live numbers.
  //
  // The NPC decay is now per-class and ASSERTED, both sides.
  //
  // The sim had ONE ramp where the game has two: the player decays at 12.0
  // (deliberately tightened so a light tap stops when you stop) and npc.ts's
  // brainFly at 5.0. A single constant could not be right for both, and
  // "correcting" it to 12.0 for the player silently broke the NPC half, which
  // had been the one that matched. core.ts takes rateDecay per ship class now.
  check(`NPC turn-rate decay: game ${BRAIN_RATE_DECAY} == sim ${NPC_RATE_DECAY}`,
    BRAIN_RATE_DECAY === NPC_RATE_DECAY);
  check(`player turn-rate decay: game ${playerDecay} == sim ${PLAYER_RATE_DECAY}`,
    playerDecay === PLAYER_RATE_DECAY);
  check('the player model in the sim really carries the player decay',
    CLASSES.playerCobra.rateDecay === PLAYER_RATE_DECAY
    && CLASSES.pirateCobra.rateDecay === undefined);
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
