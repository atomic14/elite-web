// Project tests — plain Node, no framework.
//
//   npm test
//
// These guard the invariants listed in CLAUDE.md: the 1984 galaxy must stay
// byte-accurate, the market model must match the original's tables, the sim
// must stay deterministic, and the shipped brains must still beat their
// baselines. Everything here is headless (no three.js, no DOM).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
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
  WorldStep, viewDirection, massLocked, FIXED_DT, SUN_KILL_DIST,
  type StepEvent, type StepHost,
} from '../src/game/world-step.ts';
import {
  arenaCentre, spawnOpposition, type OppositionUnit,
} from '../src/game/spawning.ts';
import { freshState } from '../src/game/state.ts';
import { Persistence, type PersistenceHost } from '../src/game/persistence.ts';
import type { WorldSnapshot } from '../src/game/snapshot.ts';
import {
  newCommander, cargoCapacity, MAX_FUEL, type Contract, defaultEquipment,
} from '../src/game/commander.ts';
import {
  FUEL_PRICE, fuelNeeded, refuelCost, fuelQuote,
} from '../src/game/shop.ts';
import { slotKeys, saveCommander } from '../src/game/storage.ts';
import { equipRows, renderMarket } from '../src/ui/screens.ts';
import { cargoTonnes } from '../src/game/commander.ts';
import { pirateBrainFor, defenceBrain, SHIPPED_BRAINS } from '../src/game/brains.ts';
import { compassTarget, hasLaserInView } from '../src/hud/hud-binding.ts';
import {
  dumpCargo, offerBribe, appetiteOf, OPPORTUNIST_FLOOR, GANG_FLOOR,
} from '../src/game/jettison.ts';
import { breachLoss, CARGO_LOSS_CHANCE } from '../src/game/systems.ts';
import {
  Combat, firePlayerLaser, damagePlayer,
  type CombatEvent, type DamageSource,
} from '../src/game/combat.ts';
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
  npcHitChance, NPC_HIT_CAP, NPC_HIT_FLOOR, LASER_RANGE,
} from '../src/game/gunnery.ts';
import { seedWorld, random, rngState, restoreRng } from '../src/game/rng.ts';
import { serialiseState, restoreState } from '../src/game/snapshot.ts';
import { ScreenHost, type Screen, type ScreenOutcome } from '../src/ui/screen-host.ts';
import { globalCommands, BINDINGS, type ControlMode } from '../src/game/controls.ts';
import {
  Autopilot, DOCK_COMPUTER_RANGE, type AutopilotEvent,
} from '../src/game/autopilot.ts';
import {
  isHostileToPlayer, NpcShip,
  NPC_COOLDOWN_LO, NPC_COOLDOWN_SPREAD, NPC_FIRE_GATE, NPC_LASER_RANGE,
  MIN_CRUISE_FRACTION, BRAIN_RATE_RAMP, BRAIN_RATE_DECAY,
} from '../src/game/npc.ts';
import { PLAYER_SPEED_KEPT, NPC_SPEED_KEPT, RAM_DAMAGE } from '../src/game/collisions.ts';
import { assignNpcTargets } from '../src/game/npc-targeting.ts';
import {
  SPECS, pirateSpecForTier, CONSTRICTOR_SPEC, type NpcSpec,
} from '../src/game/ship-specs.ts';
import { CombatSim, type SimHost } from '../src/game/combat-sim.ts';
import {
  CombatSimRecorder, combatSimJson, makeSimLog, installSimLog, aimAngle, quantile, mean,
  COMBAT_SIM_SCHEMA, SIX_CONE, MAX_SAMPLES,
  type ContactSample, type FrameSample, type ExerciseSetup, type PlayerLoadout,
  type CombatSimReport,
} from '../src/game/combat-sim-report.ts';
import {
  SCENARIOS, MODES, SCENARIO_TIMEOUT, MAX_TIER, WAVE_MAX_COUNT, WAVE_SATURATION,
  SHIPPED_SOLO_BRAIN, SHIPPED_PACK_BRAIN, SHIPPED_DEFENCE_BRAIN, SIM_BRAINS,
  scenarioOpposition, asTheyCome, oppositionFromThreat, oppositionShips, allShips,
  shipCount, describeOpposition, simHulls, waveOpposition, waveCount, waveTier,
  exerciseTimeout, nextOpposition, roundOutcome, OPPOSITION_ROLES,
  type Opposition, type BrainId, type ExerciseSpec, type ExerciseSession,
  type ThreatContext,
} from '../src/game/combat-sim-scenarios.ts';
import {
  PlayerShip, PLAYER_FLIGHT, rampFlightRate, rampToward, type FlightDemand,
} from '../src/player.ts';
import { flightDemand, type FlightControls } from '../src/engine/flight-controls.ts';
import { keymap } from '../src/engine/keymap.ts';
import {
  CombatComputer, ccRamp, CC_ACCEL, CC_MAX_SPEED, CC_MAX_PITCH, CC_MAX_ROLL,
} from '../src/game/combat-computer.ts';
import { COBRA_MK3, SIDEWINDER } from '../src/ships/geometry.ts';
import { stepEncounters } from '../src/game/encounters.ts';
import {
  stepMissionAtDock, constrictorDestroyed, constrictorLurksHere, missionHeadline,
} from '../src/game/missions.ts';
import { planPopulation, policeFor } from '../src/game/population.ts';
import {
  laserForView, canFire, chargeShot, assistAt, hitCone, canisterCone, LASERS, AIM_ASSIST,
  npcPrefersMissile, npcMissileLastStand,
  MISSILE_MIN_RANGE, MISSILE_MAX_RANGE, MISSILE_CHANCE,
  MISSILE_LAST_STAND_HULL, MISSILE_LAST_STAND_GATE, MISSILE_LAST_STAND_MIN_RANGE,
} from '../src/game/gunnery.ts';
import {
  freshSystems, applyDamage, regenerate, durability, updateCabinTemp, scoopFuel,
  SUN_HEAT_START,
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
import { makeRng } from '../src/game/rng.ts';
import { TURN, ACCEL_FRACTION, shipAccel } from '../src/game/ship-specs.ts';

// `check`, the counters and the shared fixtures live in test/harness.ts, so a
// second test file can import the SAME ones — see the header there for why the
// split starts at the bottom. Adding a test file is one import line below plus
// `import { check } from './harness.ts'` in the file itself.
import { check, eq, cmds, eqc, keys, summarise } from './harness.ts';
import './combat-sim.test.ts';

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
const DT = FIXED_DT;
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
      while (!ep.done) ep.step(DT);
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

// --- the command layer ------------------------------------------------------

// Key handling was a hand-written `else if` chain of `input.pressed(...)`
// inside game.ts, which is to say it was untestable: the only way to ask "does
// M open the market" was to open a browser and press M. controls.ts turns the
// bindings into a table over a two-method input, so these are the first tests
// this project has ever had of what a key does.
//
// What they pin is the three rules the chain encoded implicitly, and each of
// them is a real bug if it goes: one command per frame, the view keys running
// independently of the rest, and shift being read before the tap is consumed.

console.log('\ncommand layer');
{
  // `keys`, `cmds` and `eqc` are in test/harness.ts: the simulator's own binding
  // tests need the same fake keyboard, and two of them would drift.

  // --- the bindings themselves, which are the point ---------------------------
  eqc('L launches', cmds('docked', ['KeyL']), ['launch']);
  eqc('M opens the market', cmds('docked', ['KeyM']), ['openMarket']);
  eqc('D reports the system you are standing on', cmds('docked', ['KeyD']), ['openSystemData']);
  eqc('T arms a missile', cmds('flight', ['KeyT']), ['armMissile']);
  eqc('J is the torus drive', cmds('flight', ['KeyJ']), ['toggleTorus']);
  eqc('Enter is the only key that answers the game over screen',
    cmds('dead', ['Enter']), ['respawn']);
  eqc('...and nothing else does', cmds('dead', ['KeyL', 'KeyM', 'Space']), []);
  eqc('? is global, whatever the mode', globalCommands(keys(['Question'])), ['toggleHelp']);

  // --- shift, read before the tap is consumed ---------------------------------
  eqc('H jumps', cmds('flight', ['KeyH']), ['startHyperspace']);
  eqc('⇧H is the galactic jump', cmds('flight', ['KeyH'], ['ShiftLeft']), ['galacticJump']);
  eqc('...and the right-hand shift too', cmds('flight', ['KeyH'], ['ShiftRight']), ['galacticJump']);
  eqc('Y dumps one tonne', cmds('flight', ['KeyY']), ['jettison1']);
  eqc('⇧Y dumps five', cmds('flight', ['KeyY'], ['ShiftLeft']), ['jettison5']);
  // the failure this ordering exists to prevent: reading pressed('KeyH') on the
  // shifted entry first would eat the tap and leave the plain entry nothing
  check('an unshifted tap survives the shifted entry above it',
    cmds('flight', ['KeyH']).length === 1);

  // --- one command per frame ---------------------------------------------------
  eqc('two menu keys in one frame run the FIRST in table order, as the chain did',
    cmds('docked', ['KeyE', 'KeyL']), ['launch']);
  eqc('...and in the cockpit', cmds('flight', ['KeyJ', 'KeyT']), ['armMissile']);

  // --- the view keys are independent -------------------------------------------
  eqc('the four views are separate commands',
    cmds('flight', ['Digit1', 'Digit2', 'Digit3', 'Digit4']),
    ['view0', 'view1', 'view2', 'view3']);
  eqc('a view key does not swallow the rest of the frame',
    cmds('flight', ['Digit2', 'KeyG']), ['view1', 'openChart']);
  eqc('...and the view is applied BEFORE it, so the chart opens from the new view',
    cmds('flight', ['KeyG', 'Digit2']), ['view1', 'openChart']);

  // --- the confirmation swallows every other key --------------------------------
  eqc('Q asks before erasing a career', cmds('docked', ['KeyQ']), ['askNewGame']);
  eqc('Y confirms it', cmds('confirmNewGame', ['KeyY']), ['newGame']);
  eqc('X backs the commander up first', cmds('confirmNewGame', ['KeyX']), ['exportSave']);
  eqc('Escape backs out', cmds('confirmNewGame', ['Escape']), ['cancelNewGame']);
  eqc('...and so does Q, which is what asked', cmds('confirmNewGame', ['KeyQ']), ['cancelNewGame']);
  eqc('L does NOT launch you out of the confirmation',
    cmds('confirmNewGame', ['KeyL', 'KeyM', 'KeyE']), []);

  // --- the table is a key map, so it must not contain a collision ----------------
  //
  // Over `Object.keys(BINDINGS)` rather than a written-out list: the list was
  // written out, `simulator` was added, and a new mode was silently uncovered by
  // both checks below. A test that needs maintaining to keep working is the
  // failure it is guarding against.
  for (const mode of Object.keys(BINDINGS) as ControlMode[]) {
    const seen = new Set<string>();
    const clash = BINDINGS[mode].filter((b) => {
      const id = `${b.key}:${b.shift ?? '?'}`;
      if (seen.has(id)) return true;
      seen.add(id);
      return false;
    });
    check(`no two ${mode} bindings claim the same key and modifier`, clash.length === 0,
      clash.map((b) => b.key).join(','));
    // a plain entry ABOVE its shifted twin would consume the tap and lose the
    // modified command — the ⇧H bug, in table form
    for (let n = 0; n < BINDINGS[mode].length; n++) {
      const b = BINDINGS[mode][n];
      if (b.shift === undefined) continue;
      check(`${mode}: the shifted ${b.key} is listed above the plain one`,
        !BINDINGS[mode].slice(0, n).some((o) => o.key === b.key && o.shift === undefined));
    }
  }
}

// --- the ship's autopilots --------------------------------------------------

// Both computers were methods of game.ts that talked straight to the HUD and
// the AudioContext, so "does the docking computer refuse out of range" was a
// question only a browser could answer. autopilot.ts reports events instead,
// which makes the refusals — the half of this that players actually meet —
// assertable under node.

console.log('\nautopilots');
{
  const rig = (fit: Partial<Record<'dockingComputer' | 'combatComputer', boolean>> = {}) => {
    seedWorld(99);
    const state = freshState(newCommander());
    state.world.build(state.systems[state.commander.systemIndex]);
    Object.assign(state.commander.equipment, fit);
    // parked on the slot, so distance is not what is being tested
    state.player.position.copy(state.world.station.position);
    return { state, auto: new Autopilot(state, new CombatComputer()) };
  };
  const texts = (events: readonly AutopilotEvent[]): string[] =>
    events.flatMap((e) => (e.kind === 'message' ? [e.text] : []));

  {
    const { state, auto } = rig();
    eq('an unfitted docking computer refuses',
      texts(auto.toggleDocking())[0], 'NO DOCKING COMPUTER FITTED');
    check('...and does not engage', !state.session.dcEngaged);
    eq('an unfitted combat computer refuses',
      texts(auto.toggleCombat())[0], 'NO COMBAT COMPUTER FITTED');
    check('...and does not engage', !state.session.ccEngaged);
  }

  {
    const { state, auto } = rig({ dockingComputer: true });
    state.dockPlan.phase = 'run';
    const on = auto.toggleDocking();
    const phase: string = state.dockPlan.phase;
    check('the docking computer engages', state.session.dcEngaged);
    check('...and starts a fresh approach', phase === 'gate');
    check('...with the music on',
      on.some((e) => e.kind === 'dockingMusic' && e.on));
    const off = auto.toggleDocking();
    check('pressing it again hands the ship back', !state.session.dcEngaged);
    check('...and stops the music',
      off.some((e) => e.kind === 'dockingMusic' && !e.on));

    state.player.position.copy(state.world.station.position)
      .addScaledVector(new THREE.Vector3(1, 0, 0), DOCK_COMPUTER_RANGE + 1);
    eq('and it will not take the job from across the system',
      texts(auto.toggleDocking())[0], 'STATION OUT OF RANGE');
    check('...so it stays off', !state.session.dcEngaged);
  }

  {
    const { state, auto } = rig({ combatComputer: true });
    eq('the combat computer refuses an empty sky',
      texts(auto.toggleCombat())[0], 'NO HOSTILES — COMBAT COMPUTER IDLE');
    check('...and stays off', !state.session.ccEngaged);

    state.world.spawn('pirate',
      state.player.position.clone().add(new THREE.Vector3(0, 0, -1200)), 1);
    state.session.view = 2;
    auto.toggleCombat();
    check('with something hostile about, it engages', state.session.ccEngaged);
    check('...and swings to the front view, because it aims the front laser',
      state.session.view === 0);
    eq('pressing it again hands the ship back',
      texts(auto.toggleCombat())[0], 'COMBAT COMPUTER OFF');
    check('...and it is off', !state.session.ccEngaged);
  }

  {
    // the demand itself: the same FlightDemand a pair of hands produces
    const { state, auto } = rig({ combatComputer: true });
    state.world.spawn('pirate',
      state.player.position.clone().add(new THREE.Vector3(0, 0, -1200)), 1);
    auto.toggleCombat();
    const flying = auto.combatDemand(1 / 60, false, defenceBrain());
    check('it produces a demand, not a manoeuvre', flying.demand !== null);
    check('...at the cruise limits it was trained in',
      flying.demand?.limits?.maxSpeed === CC_MAX_SPEED);
    check('...and says nothing while it is working', flying.events.length === 0);

    const grabbed = auto.combatDemand(1 / 60, true, defenceBrain());
    check('touching the controls takes the ship straight back',
      grabbed.demand === null && !state.session.ccEngaged);
    eq('...and says so', texts(grabbed.events)[0], 'MANUAL OVERRIDE');

    // null brain = the weights failed to load; it must hand back, not fly blind
    state.session.ccEngaged = true;
    const noBrain = auto.combatDemand(1 / 60, false, null);
    check('no policy means no autopilot',
      noBrain.demand === null && !state.session.ccEngaged);
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
      /** every hit the player took, and what the step said did it */
      hits: [] as { amount: number; source: DamageSource }[],
    };
    // The host is the ONLY thing standing behind the step, and it is a stub:
    // no Hud, no screens, no localStorage, no renderer.
    const host: StepHost = {
      inFlight: () => log.deaths.length === 0 && log.docks === 0,
      applyPlayerDamage: (amount, from, source) => {
        log.damage += amount;
        log.hits.push({ amount, source });
        damagePlayer(state, combat, amount, from, scratch);
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
      events.every((e) => (e.kind === 'message'
        ? typeof e.text === 'string' && typeof e.seconds === 'number'
        : e.kind === 'npcFired' && typeof e.atPlayer === 'boolean')));
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

  // --- the player's gun and hull, assembled from a state ---------------------
  //
  // `Combat.fire` wants seven arguments and `hitPlayer` six, and game.ts built
  // every one of them out of `this` — so the player's own trigger could only be
  // pulled by a Game. combat.ts's firePlayerLaser/damagePlayer do the assembly
  // over a GameState instead, which is what lets another caller fire the real
  // gun and hand the events somewhere other than the HUD.
  //
  // The property that matters is not that the new functions work: it is that
  // they are the SAME call. So each of these runs the shot twice from an
  // identical seeded state — once with the arguments spelled out as game.ts
  // spelled them, once through the extraction — and demands the events, the
  // target's hp and the ship's systems all come out identical.
  {
    /** the same state twice: a pirate parked dead ahead, tough enough to live */
    const dueller = () => {
      seedWorld(60_606);
      const state = freshState(newCommander());
      state.world.build(state.systems[state.commander.systemIndex]);
      state.player.position.set(0, 0, 0);
      state.player.quaternion.identity();          // nose along -Z
      const npc = state.world.spawn('pirate', new THREE.Vector3(0, 0, -400), 1);
      npc.hp = 9;                                  // takes the hit, survives it
      // a ship spawned this frame has no world matrix yet, and the raycast
      // reads matrixWorld — without this the shot is tested against the origin
      npc.object.updateMatrixWorld(true);
      return {
        state, npc,
        combat: new Combat(state.world),
        scratch: {
          a: new THREE.Vector3(), b: new THREE.Vector3(),
          q: new THREE.Quaternion(), ray: new THREE.Raycaster(),
        },
      };
    };

    /** an event list as comparable text: kinds, and the numbers inside them */
    const digest = (events: readonly CombatEvent[]) => JSON.stringify(events.map((e) =>
      e.kind === 'message' ? [e.kind, e.text, e.seconds]
        : e.kind === 'offence' ? [e.kind, e.level]
          : e.kind === 'wrecked' ? [e.kind, e.npc.role]
            : e.kind === 'beam' ? [e.kind, e.at ? e.at.toArray() : null]
              : e.kind === 'died' ? [e.kind, e.reason] : [e.kind]));
    /** what the shot LEFT behind: the target's hp and the ship's systems */
    const after = (d: ReturnType<typeof dueller>) =>
      JSON.stringify([d.npc.hp, d.state.sys]);

    const tmp = new THREE.Vector3();
    const byHand = dueller();
    const handEvents = digest(byHand.combat.fire(
      byHand.state.commander, byHand.state.sys, byHand.state.player.position,
      viewDirection(byHand.state.player.quaternion, byHand.state.session.view, tmp),
      byHand.state.session.view, byHand.state.session.witchspace, byHand.scratch));

    const extracted = dueller();
    const outEvents = digest(
      firePlayerLaser(extracted.state, extracted.combat, extracted.scratch));

    check('the extracted trigger reports what game.ts\'s seven arguments did',
      handEvents === outEvents);
    check('...and it was a hit, so the comparison is not of two empty lists',
      handEvents.includes('"offence"') && byHand.npc.hp < 9);
    check('...leaving the same hp on the target and the same heat in the gun',
      after(byHand) === after(extracted));

    // The view is read from the state, not assumed to be the nose: a rear-view
    // shot hits what is BEHIND you, and that is the one argument of the seven
    // that was easiest to lose in the move.
    const rear = dueller();
    rear.npc.object.position.set(0, 0, 400);
    rear.npc.object.updateMatrixWorld(true);
    rear.state.session.view = 1;                   // looking aft
    rear.state.commander.equipment.rearLaser = true;
    const aft = digest(firePlayerLaser(rear.state, rear.combat, rear.scratch));
    check('a rear-view shot still hits what is behind you',
      aft.includes('"offence"') && rear.npc.hp < 9);
    // ...and without the mount there is nothing to fire, which is the other
    // half of the view reaching the gun
    const noMount = dueller();
    noMount.npc.object.position.set(0, 0, 400);
    noMount.npc.object.updateMatrixWorld(true);
    noMount.state.session.view = 1;
    check('...and with no rear mount fitted, nothing happens at all',
      firePlayerLaser(noMount.state, noMount.combat, noMount.scratch).length === 0
        && noMount.npc.hp === 9);

    // ...and the damage model, the same way. The shield absorbs it, so
    // applyDamage draws no rng and the two calls are directly comparable.
    const hitByHand = dueller();
    const shieldWas = hitByHand.state.sys.foreShield;
    const hitFrom = new THREE.Vector3(0, 0, -400);
    const handHit = digest(hitByHand.combat.hitPlayer(
      hitByHand.state.sys, 0.5, hitFrom,
      hitByHand.state.player.position, hitByHand.state.player.quaternion,
      hitByHand.scratch));
    const hitExtracted = dueller();
    const outHit = digest(
      damagePlayer(hitExtracted.state, hitExtracted.combat, 0.5, hitFrom,
        hitExtracted.scratch));
    check('the extracted damage path reports the same as the hand-built call',
      handHit === outHit);
    check('...and takes it off the same shield, which really did drop',
      JSON.stringify(hitByHand.state.sys) === JSON.stringify(hitExtracted.state.sys)
        && hitExtracted.state.sys.foreShield < shieldWas);

    // From behind it is the AFT shield. Which shield takes a hit is the one
    // thing hitPlayer resolves out of the player's transform, so it is the bit
    // the extraction could most easily have got wrong.
    const fromAft = dueller();
    damagePlayer(fromAft.state, fromAft.combat, 0.5, new THREE.Vector3(0, 0, 400),
      fromAft.scratch);
    check('a hit from astern lands on the aft shield',
      fromAft.state.sys.aftShield < shieldWas
        && fromAft.state.sys.foreShield === shieldWas);
  }

  // --- and every hit says what did it ----------------------------------------
  //
  // Five things can hurt the player and the step knows which one it is at each
  // call. It used to pass only the amount and a position, so anything wanting
  // to attribute the damage — test/combat-recorder.js, and the report a combat
  // simulator owes — had to classify it by magnitude: 0.1-0.221 laser, 0.45
  // ram, 1.3 missile. That cannot error, only be quietly wrong, and it already
  // overlapped (NPC_VS_NPC_DAMAGE is 0.11). `source` replaces the guess.
  {
    const SOURCES: DamageSource[] = ['laser', 'missile', 'ram', 'station', 'cargo'];
    const seen = new Set<DamageSource>();
    const tag = (r: ReturnType<typeof arrival>) => r.log.hits.map((h) => h.source);

    // an NPC's gun, over a long enough fight to connect
    const fight = arrival(4_246);
    fly(fight, 600);
    for (const s of tag(fight)) seen.add(s);
    check('an NPC laser hit is tagged "laser"',
      fight.log.hits.length > 0 && tag(fight).includes('laser'));
    check('...with the amount npcShotDamage produces, not a name for a number',
      fight.log.hits.filter((h) => h.source === 'laser')
        .every((h) => h.amount >= 0.1 && h.amount <= 0.221));

    // a canister on the hull, with no scoop fitted
    const canister = arrival(4_247);
    canister.state.commander.equipment.scoops = false;
    canister.state.world.cargo.spawn(canister.state.player.position.clone(), 1, [0]);
    fly(canister, 2);
    const onHull = canister.log.hits.filter((h) => h.source === 'cargo');
    check('a canister breaking on the hull is tagged "cargo"', onHull.length === 1);
    check('...at 0.06', onHull[0]?.amount === 0.06);
    for (const s of tag(canister)) seen.add(s);

    // a ship flying into you
    const ram = arrival(4_248);
    ram.state.world.spawn('pirate', ram.state.player.position.clone(), 2);
    fly(ram, 1);
    const rammed = ram.log.hits.filter((h) => h.source === 'ram');
    check('a ram is tagged "ram"', rammed.length >= 1);
    check(`...at RAM_DAMAGE (${RAM_DAMAGE})`,
      rammed.every((h) => h.amount === RAM_DAMAGE));
    for (const s of tag(ram)) seen.add(s);

    // the Coriolis wall
    const wall = arrival(4_249);
    wall.state.player.position.copy(wall.state.world.station.position);
    fly(wall, 1);
    const scraped = wall.log.hits.filter((h) => h.source === 'station');
    check('flying into the station is tagged "station"', scraped.length === 1);
    check('...at 0.9', scraped[0]?.amount === 0.9);
    for (const s of tag(wall)) seen.add(s);

    // a missile that got through
    const missile = arrival(4_250);
    missile.ordnance.launchHostile(
      missile.state.player.position.clone().add(new THREE.Vector3(0, 0, -600)));
    fly(missile, 300);
    const hit = missile.log.hits.filter((h) => h.source === 'missile');
    check('a missile getting through is tagged "missile"', hit.length >= 1);
    for (const s of tag(missile)) seen.add(s);

    check('all five ways to be hurt are named, and nothing else is',
      SOURCES.every((s) => seen.has(s)) && seen.size === SOURCES.length);
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
    // placement, including the training arena — a harness that wants to build
    // a fight under node has to be able to import this
    'spawning.ts',
    // the combat trainer's rules: who it sends at you and when it stops. It
    // names brains as strings rather than loading them, which is what keeps a
    // module about opposition free of the network, the DOM and the World.
    'combat-sim-scenarios.ts',
    'combat-sim-report.ts',
    // the whole world step, as of the extraction out of game.ts — this is the
    // line that says the simulation can advance without a browser
    'world-step.ts',
    // the two computers that fly the ship for you. They reported straight to
    // the HUD and the AudioContext; they report events now, which is the only
    // reason this line can exist
    'autopilot.ts',
    // and the keyboard, which is the surprising one. controls.ts reads a
    // two-method `CommandInput`, not `engine/input.ts` and not a DOM event, so
    // a replay or an AI can ask for a command with an object literal — which
    // is exactly what the tests above do.
    'controls.ts',
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

// --- the turn ramp is frame-rate independent ---------------------------------
//
// It was `min(1, rate * dt)`, a linear-in-dt approximation of exponential
// decay, so two half-steps did not equal one whole step. The same constant
// therefore produced different handling at different step rates — and it did:
// the training sim steps at 1/15 and the game at 1/60, so a released turn key
// settled 0.80 per step in training against 0.59 over the same elapsed time in
// the game. Same number in both files, different flight.

console.log('\nturn ramp');
{
  const after = (dt: number, secs: number) => {
    let v = 0;
    for (let i = 0; i < Math.round(secs / dt); i++) v = rampFlightRate(v, 2.5, true, dt);
    return v;
  };
  const at60 = after(1 / 60, 1);
  check('one second of ramp is the same at 60Hz and 15Hz',
    Math.abs(at60 - after(1 / 15, 1)) < 1e-9);
  check('...and at 144Hz', Math.abs(at60 - after(1 / 144, 1)) < 1e-9);
  check('...and at 30Hz', Math.abs(at60 - after(1 / 30, 1)) < 1e-9);

  // and it must still reproduce the shipped 60Hz feel, which is why the
  // constants were recalibrated rather than left at 4.0/12.0
  const oldForm = (cur: number, tgt: number, dt: number, r: number) =>
    cur + (tgt - cur) * Math.min(1, r * dt);
  let a = 0, b = 0;
  for (let i = 0; i < 120; i++) {
    a = rampFlightRate(a, 2.5, true, 1 / 60);
    b = oldForm(b, 2.5, 1 / 60, 4.0);
  }
  check(`60Hz behaviour is unchanged (${a.toFixed(6)} vs ${b.toFixed(6)})`,
    Math.abs(a - b) < 1e-6);

  check('a released rate still snaps to exactly zero',
    rampFlightRate(0.0005, 0, false, 1 / 60) === 0);
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
  // No setup and no teardown: the selection is an ARGUMENT now, so a case
  // cannot leak into the next one. It used to be four `window.__` globals with
  // a clear() after every block — which worked, and only by hand.
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
    check('brains.scripted turns every brain off',
      pirateBrainFor(0, false, { scripted: true }) === null
      && pirateBrainFor(2, true, { scripted: true }) === null
      && defenceBrain({ scripted: true }) === null);
  }
  {
    check('brains.pack forces the pack policy onto everyone',
      pirateBrainFor(0, false, { pack: true })?.pack === true);
  }
  {
    const base = pirateBrainFor(0, false)!.brain;
    check("brains.sharp='pro' leaves opportunists alone",
      pirateBrainFor(0, false, { sharp: 'pro' })!.brain === base);
    check('...and re-arms professionals',
      pirateBrainFor(1, false, { sharp: 'pro' })!.brain !== base);
    check('brains.sharp=true re-arms everyone',
      pirateBrainFor(0, false, { sharp: true })!.brain !== base);
    check("brains.legacy='pro' likewise splits by tier",
      pirateBrainFor(0, false, { legacy: 'pro' })!.brain === base
      && pirateBrainFor(1, false, { legacy: 'pro' })!.brain !== base);
  }
  {
    // The default is the shipped game, and it is frozen — a caller that
    // mutated it would move every other caller's brains.
    check('the shipped default carries no overrides',
      Object.keys(SHIPPED_BRAINS).length === 0 && Object.isFrozen(SHIPPED_BRAINS));
    check('an unspecified selection flies what the live game flies',
      pirateBrainFor(1, false)!.brain === pirateBrainFor(1, false, {})!.brain);
  }
  check('the defence brain is fitted', defenceBrain() !== null);
}

// --- the combat trainer's opposition ----------------------------------------
//
// The rules half of docs/COMBAT-SIM.md: who the training simulator sends at
// you, and when it stops. It is pure, so all of it is reachable here — the
// seven scenarios, the wave ramp, and the three modes as two functions.
//
// The load-bearing checks are the ones that stop the table drifting away from
// the game it is supposed to measure: every role is a role the roster knows,
// every named brain is a file that exists, and "as they come" is `pirateThreat`
// itself rather than a second opinion about what a reception looks like.

console.log('\ncombat trainer scenarios');
{
  // a laden Cobra at Lave, which is what "as they come" is worth asking about,
  // and the same commander with nothing aboard
  const cargo = (t: Record<number, number>) => {
    const c = new Array(17).fill(0);
    for (const [i, q] of Object.entries(t)) c[+i] = q;
    return c;
  };
  const ladenCommander = {
    cargo: cargo({ 7: 35 }), kills: 0, combatScore: 0,
    equipment: { laser: 'pulse', largeBay: true },
  };
  const brokeCommander = { ...ladenCommander, cargo: cargo({}) };
  const threatCtx: ThreatContext = {
    sys: g1[7], danger: 0.1, commander: ladenCommander, notoriety: 0,
  };

  const spec = (over: Partial<ExerciseSpec> = {}): ExerciseSpec => ({
    mode: 'scenario', scenario: 'single-pirate', tier: 1, seed: 1234, ...over,
  });
  const session = (over: Partial<ExerciseSession> = {}): ExerciseSession => ({
    spec: spec(), round: 0, spawned: 0, alive: 0, roundElapsed: 0,
    playerAlive: true, ...over,
  });
  const brainFileExists = (id: BrainId) => id === 'scripted'
    || existsSync(new URL(`../src/ai-training/brains/${id}.json`, import.meta.url));

  // 1 — the table resolves, all seven of it. One check per property rather
  // than one per ship: 55 lines of "ok Sidewinder has hp" is not a test
  // report, so the loop collects what is wrong and each check names it.
  {
    eq('there are seven scenarios', SCENARIOS.length, 7);
    const empty: string[] = [];
    const badRole: string[] = [];
    const badCount: string[] = [];
    const badTier: string[] = [];
    const badBrain: string[] = [];
    const badHull: string[] = [];
    let groups = 0;
    let ships = 0;
    for (const s of SCENARIOS) {
      for (const tier of s.tiered ? [0, 1, 2] : [1]) {
        const where = `${s.id}@${tier}`;
        const list = s.groups
          ? scenarioOpposition(spec({ scenario: s.id, tier }), 99)
          : asTheyCome(threatCtx, 99, makeRng(7));
        if (!list.length) empty.push(where);
        for (const o of list) {
          groups += 1;
          if (!SPECS[o.role]?.length) badRole.push(`${where} ${o.role}`);
          if (!(o.count >= 1)) badCount.push(`${where} ${o.count}`);
          if (o.tier < 0 || o.tier > MAX_TIER) badTier.push(`${where} ${o.tier}`);
          if (!brainFileExists(o.brain)) badBrain.push(`${where} ${o.brain}`);
          for (const ship of oppositionShips(o)) {
            ships += 1;
            if (!ship.spec.def || ship.spec.hp <= 0 || ship.spec.maxSpeed <= 0) {
              badHull.push(`${where} ${ship.spec.def?.name ?? 'nothing'}`);
            }
          }
        }
      }
    }
    check(`every scenario sends somebody (${groups} groups, ${ships} ships)`,
      empty.length === 0 && groups >= 9, empty.join(', '));
    check('every role is a role the roster knows', badRole.length === 0, badRole.join(', '));
    check('every group is at least one ship', badCount.length === 0, badCount.join(', '));
    check(`every tier is 0..${MAX_TIER}`, badTier.length === 0, badTier.join(', '));
    check('every named brain is a real brain file', badBrain.length === 0, badBrain.join(', '));
    check('every ship resolved to a hull that can fly',
      badHull.length === 0, badHull.join(', '));
  }

  // ...and the ids agree with what the game actually flies. This is the pairing
  // that matters: a report saying "g3" when the game flew something else is
  // worse than no report, and only brains.ts knows the truth.
  {
    const src = readFileSync(new URL('../src/game/brains.ts', import.meta.url), 'utf8');
    check(`the shipped solo brain is ${SHIPPED_SOLO_BRAIN}`,
      src.includes(`${SHIPPED_SOLO_BRAIN}.json`));
    check(`the shipped pack brain is ${SHIPPED_PACK_BRAIN}`,
      src.includes(`${SHIPPED_PACK_BRAIN}.json`));
    check(`the shipped defence brain is ${SHIPPED_DEFENCE_BRAIN}`,
      src.includes(`${SHIPPED_DEFENCE_BRAIN}.json`));
    check('every listed brain exists', SIM_BRAINS.every(brainFileExists));
  }

  // 2 — the individual fights are what the spec says they are
  {
    const hunter = scenarioOpposition(spec({ scenario: 'lone-hunter' }), 3);
    const hull = oppositionShips(hunter[0])[0].spec.def?.name;
    check(`a lone bounty hunter is one Fer-de-Lance or Asp (${hull})`,
      hunter.length === 1 && hunter[0].count === 1
      && (hull === 'Fer-de-Lance' || hull === 'Asp Mk II'));

    const police = scenarioOpposition(spec({ scenario: 'police' }), 3);
    check('police interdiction is two Vipers',
      police[0].count === 2
      && oppositionShips(police[0]).every((s) => s.spec.def?.name === 'Viper'));

    const pair = oppositionShips(scenarioOpposition(spec({ scenario: 'pirate-pair', tier: 1 }), 3)[0]);
    check('a pirate pair is two of the SAME tier',
      pair.length === 2 && pair.every((s) => s.tier === 1));

    const gang3 = scenarioOpposition(spec({ scenario: 'pirate-gang', tier: 1 }), 3)[0];
    const gang4 = scenarioOpposition(spec({ scenario: 'pirate-gang', tier: 2 }), 3)[0];
    check(`a gang is three, four at the top tier (${gang3.count}, ${gang4.count})`,
      gang3.count === 3 && gang4.count === 4);
    check('a gang is organised and flies the pack policy',
      gang4.organised && gang4.brain === SHIPPED_PACK_BRAIN);
    // ...and it is ringleaders plus hangers-on, which is contracts.ts's rule
    // and not a second one: two leaders, the rest a tier below.
    const gangTiers = oppositionShips(gang4).map((s) => s.tier);
    check(`a gang is ringleaders plus hangers-on (${gangTiers.join(',')})`,
      gangTiers.join(',') === [0, 1, 2, 3].map((i) => memberTier(2, i)).join(','));

    const thargoids = scenarioOpposition(spec({ scenario: 'thargoids', tier: 0 }), 3);
    const top = scenarioOpposition(spec({ scenario: 'thargoids', tier: 2 }), 3);
    check('a Thargoid ambush brings Thargons too',
      thargoids.length === 2 && thargoids[0].role === 'thargoid'
      && thargoids[1].role === 'thargon');
    check(`Thargoids come two or three (${thargoids[0].count}, ${top[0].count})`,
      thargoids[0].count === 2 && top[0].count === 3);
    check('Thargoids are scripted — the brains are pirates',
      thargoids.every((o) => o.brain === 'scripted'));
  }

  // 3 — as they come: the galaxy's own answer, not a second opinion
  {
    const threat = pirateThreat(threatCtx.sys, threatCtx.danger,
      markOf(threatCtx.commander, threatCtx.notoriety), makeRng(42));
    const mine = asTheyCome(threatCtx, 5, makeRng(42));
    check('as-they-come IS pirateThreat',
      JSON.stringify(mine) === JSON.stringify(oppositionFromThreat(threat, 5)));
    check(`...count, tier and organisation come straight from it `
      + `(${threat.count} at tier ${threat.tier})`,
    mine[0].count === Math.max(1, threat.count) && mine[0].tier === threat.tier
      && mine[0].organised === threat.organised);
    check('...and the group is ringleaders plus hangers-on, as spawning.ts builds it',
      mine[0].mixed);
    check('...flying the brain the live game gives them',
      mine[0].brain === (threat.organised ? SHIPPED_PACK_BRAIN : SHIPPED_SOLO_BRAIN));

    // the one deviation: you came here for a fight, so a reception of nobody
    // still sends one ship. An empty hold in a corporate state is genuinely
    // nobody, which is what makes the floor worth having.
    const quiet: ThreatContext = {
      sys: { ...threatCtx.sys, government: 7 }, danger: 0,
      commander: brokeCommander, notoriety: 0,
    };
    const raw = pirateThreat(quiet.sys, quiet.danger, markOf(quiet.commander), () => 0);
    const lone = asTheyCome(quiet, 5, () => 0);
    check(`a reception of nobody is still one opponent (pirateThreat said ${raw.count})`,
      raw.count === 0 && lone[0].count === 1 && shipCount(lone) === 1);

    // it reads the CAREER commander, which is the whole point of passing one in
    const rich = asTheyCome(threatCtx, 5, () => 0.5);
    const poor = asTheyCome({ ...threatCtx, commander: brokeCommander }, 5, () => 0.5);
    check(`a laden commander draws a hotter reception than an empty one `
      + `(tier ${rich[0].tier} vs ${poor[0].tier})`,
    rich[0].tier > poor[0].tier);
  }

  // 4 — the three modes, as two functions
  {
    check('a scenario spawns on round 0',
      nextOpposition(session({ spec: spec({ mode: 'scenario' }) })) !== null);
    check('...and never again',
      nextOpposition(session({ spec: spec({ mode: 'scenario' }), round: 1 })) === null);
    check('a scenario is running while they live',
      roundOutcome(session({ spawned: 2, alive: 2, roundElapsed: 10 })) === 'running');
    check('a scenario ends when the last one dies',
      roundOutcome(session({ spawned: 2, alive: 0 })) === 'over');
    check('...or when the player is destroyed',
      roundOutcome(session({ spawned: 2, alive: 2, playerAlive: false })) === 'over');
    check(`...or on the ${SCENARIO_TIMEOUT}s timeout`,
      roundOutcome(session({ spawned: 1, alive: 1, roundElapsed: SCENARIO_TIMEOUT })) === 'over');
    check('...and the timeout is configurable',
      roundOutcome(session({
        spec: spec({ timeoutSeconds: 30 }), spawned: 1, alive: 1, roundElapsed: 31,
      })) === 'over');
    check('nothing spawned yet is not a wipeout',
      roundOutcome(session({ spawned: 0, alive: 0 })) === 'running');
    check('quitting ends it',
      roundOutcome(session({ spawned: 1, alive: 1, quitting: true })) === 'over');

    // sparring: one opponent, endlessly, and the player gets patched up
    {
      const sp = spec({ mode: 'sparring', scenario: 'pirate-gang', tier: 2 });
      const rounds = [0, 1, 2, 3, 4, 5].map((round) =>
        nextOpposition(session({ spec: sp, round }))!);
      check('sparring sends exactly one opponent, every round',
        rounds.every((r) => shipCount(r) === 1));
      check('...alone, so not flying the pack policy',
        rounds.every((r) => !r[0].organised && r[0].brain === SHIPPED_SOLO_BRAIN));
      check('...on a fresh seed each round',
        new Set(rounds.map((r) => r[0].seed)).size === rounds.length);
      // ...and against the SAME hull each round, which is the mode's whole
      // point: you are learning what one ship does, not sampling the roster.
      check('...against the same hull every round',
        new Set(rounds.map((r) => oppositionShips(r[0])[0].spec.def?.name)).size === 1);
      check('...the hull a lone opponent of that fight would be',
        oppositionShips(rounds[0][0])[0].spec.def?.name
        === oppositionShips({ ...scenarioOpposition(sp, sp.seed, undefined)[0], count: 1 })[0]
          .spec.def?.name);
      check('a sparring kill starts another round',
        roundOutcome(session({ spec: sp, spawned: 1, alive: 0 })) === 'roundOver');
      check('...and death still ends it',
        roundOutcome(session({ spec: sp, spawned: 1, alive: 1, playerAlive: false })) === 'over');
      check('...it is never on a clock',
        exerciseTimeout(sp) === 0
        && roundOutcome(session({ spec: sp, spawned: 1, alive: 1, roundElapsed: 9999 })) === 'running');
      check('sparring restores the ship between rounds — it is for learning a hull',
        MODES.sparring.restoreBetweenRounds && MODES.sparring.record === 'kill');
      check('sparring is endless', nextOpposition(session({ spec: sp, round: 400 })) !== null);
    }

    // waves: the human-flown answer to "how many can I actually take?"
    {
      const wv = spec({ mode: 'waves' });
      const ns = Array.from({ length: 40 }, (_, i) => i + 1);
      const counts = ns.map(waveCount);
      const tiers = ns.map(waveTier);
      check('waves ramp monotonically in count',
        counts.every((c, i) => i === 0 || c >= counts[i - 1]));
      check('...and in tier', tiers.every((t, i) => i === 0 || t >= tiers[i - 1]));
      check(`...and both actually grow (${counts[0]}→${counts[9]} ships, `
        + `tier ${tiers[0]}→${tiers[9]})`,
      counts[9] > counts[0] && tiers[9] > tiers[0]);
      check(`...then saturate rather than diverge (${WAVE_MAX_COUNT} ships, `
        + `tier ${MAX_TIER}, from wave ${WAVE_SATURATION})`,
      counts.every((c) => c <= WAVE_MAX_COUNT) && tiers.every((t) => t <= MAX_TIER));
      const late = ns.filter((n) => n >= WAVE_SATURATION)
        .map((n) => JSON.stringify(waveOpposition(n, 0)));
      check(`every wave from ${WAVE_SATURATION} on is the same fight`,
        new Set(late).size === 1);
      check(`...and the wave before it is not (${WAVE_SATURATION - 1} differs)`,
        JSON.stringify(waveOpposition(WAVE_SATURATION - 1, 0)) !== late[0]);
      check('a top wave is an organised gang flying the pack policy',
        waveOpposition(WAVE_SATURATION)[0].organised
        && waveOpposition(WAVE_SATURATION)[0].brain === SHIPPED_PACK_BRAIN);
      check('wave 1 is a single opportunist',
        shipCount(waveOpposition(1)) === 1 && waveTier(1) === 0);
      check('the session asks for wave n+1 on round n',
        JSON.stringify(nextOpposition(session({ spec: wv, round: 3 }))!.map((o) => o.count))
        === JSON.stringify(waveOpposition(4).map((o) => o.count)));
      check('a cleared wave brings the next one',
        roundOutcome(session({ spec: wv, spawned: 3, alive: 0 })) === 'roundOver');
      check('...and dying ends the run — that is the score',
        roundOutcome(session({ spec: wv, spawned: 3, alive: 1, playerAlive: false })) === 'over');
      check('waves do NOT restore the ship — attrition is the question',
        !MODES.waves.restoreBetweenRounds && MODES.waves.score === 'waves');
    }
  }

  // 5 — determinism, and the A/B override
  {
    const s = session({ spec: spec({ scenario: 'pirate-gang', tier: 2 }) });
    const a = JSON.stringify(nextOpposition(s));
    const b = JSON.stringify(nextOpposition(s));
    check('the same seed sends the same opposition', a === b);
    check('...down to the hulls',
      JSON.stringify(allShips(nextOpposition(s)!).map((x) => x.spec.def?.name))
      === JSON.stringify(allShips(nextOpposition(s)!).map((x) => x.spec.def?.name)));
    const other = nextOpposition(session({
      spec: spec({ scenario: 'pirate-gang', tier: 2, seed: 999 }),
    }));
    check('a different seed sends a different draw', JSON.stringify(other) !== a);
    check('as-they-come is deterministic in its rng',
      JSON.stringify(asTheyCome(threatCtx, 1, makeRng(3)))
      === JSON.stringify(asTheyCome(threatCtx, 1, makeRng(3))));

    // the A/B rig: same fight, other brain — the question CLAUDE.md says the
    // numbers cannot answer
    const ab = nextOpposition(session({
      spec: spec({ scenario: 'thargoids', brain: 'pirate-attack-r2' }),
    }))!;
    check('one brain override reaches every opponent',
      ab.length > 1 && ab.every((o) => o.brain === 'pirate-attack-r2'));

    // the custom picker: a hull off the roster, and the fit
    const custom: Opposition = {
      role: 'pirate', count: 2, tier: 2, organised: false,
      brain: SHIPPED_SOLO_BRAIN, mixed: false, seed: 0,
      hull: simHulls().find((h) => h.name === 'Constrictor')!.spec,
      missiles: 4, ecm: 1,
    };
    const built = oppositionShips(custom);
    check('a custom hull overrides the roster pick',
      built.every((x) => x.spec.def?.name === 'Constrictor'));
    check('...and the fit overrides the hull',
      built.every((x) => x.spec.missiles === 4 && x.spec.ecmChance === 1));
    check('...without editing the roster entry',
      CONSTRICTOR_SPEC.missiles === 2);
    // the custom picker's roster is DERIVED from SPECS, so a new hull in the
    // game is a new hull here without anyone remembering to add it
    {
      const hulls = simHulls();
      const rostered = OPPOSITION_ROLES
        .flatMap((r) => SPECS[r]).filter((s) => s.def).length;
      check(`the picker offers the whole roster plus the Constrictor `
        + `(${hulls.length} hulls)`,
      hulls.length === rostered + 1
        && hulls.some((h) => h.name === 'Constrictor')
        && hulls.some((h) => h.name === 'Cobra Mk III')
        && hulls.every((h) => !!h.spec.def));
    }
    check('a custom exercise wins over the scenario table',
      nextOpposition(session({ spec: spec({ custom: [custom] }) }))![0].hull !== undefined);
  }

  check('opposition describes itself for the report',
    /2 × .+\(tier 1\)/.test(describeOpposition(
      scenarioOpposition(spec({ scenario: 'pirate-pair', tier: 1 }), 3))));
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

// --- no ambient globals -----------------------------------------------------
//
// The same shape as the ban above, and for the same reason: `Math.random` was a
// second source of chance, and a `window.__` flag is a second source of RULES.
// Five of them existed — `__scriptedPirates`, `__legacyPirates`, `__packBrain`,
// `__sharpPirates`, `__cheat` — read from inside NpcShip.update and the equip
// screen to decide which brain flew and what could be fitted.
//
// Each cost the same three things, and none of them was hypothetical:
//
//   1. the flag is not in the snapshot, and `globalThis` does not survive a
//      reload, so a save made with one set came back flying something else —
//      in a project whose headline property is that the world repeats
//   2. a test could only set it and remember to clear up; the discipline held
//      by hand, across 5,000 lines, which is not the same as being safe
//   3. the combat trainer needed a save-the-old/put-it-back dance around every
//      exercise, run FIRST in teardown, guarding a hazard instead of removing
//      it. Making the selection state deleted the dance.
//
// They are `GameState.brains` and `GameState.cheat` now. What is still allowed
// is a HANDLE — something the game WRITES so a console can reach in, which no
// rule reads and which branches on nothing — and those go through
// game/console.ts so this check has one exemption instead of an argument.

console.log('\nno ambient globals');
{
  const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir))
      : e.name.endsWith('.ts') ? [new URL(e.name, dir)] : []));
  const SEAM = 'game/console.ts';
  const offenders: string[] = [];
  for (const url of walk(new URL('../src/', import.meta.url))) {
    const short = url.pathname.slice(url.pathname.indexOf('/src/') + 5);
    if (short === SEAM) continue;
    // Strip `//`, ` *` AND a one-line `/** ... */` — that last form is not
    // pedantry: two stale references to the deleted flags were sitting in
    // exactly it, and the first version of this check walked straight past them.
    const src = readFileSync(url, 'utf8')
      .replace(/^\s*(\/\/|\*).*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/globalThis/.test(src)) offenders.push(`${short} (globalThis)`);
    // the older spelling of the same thing, and the one the flags actually used
    if (/window\s*\.\s*__/.test(src)) offenders.push(`${short} (window.__)`);
  }
  check(`only ${SEAM} touches globalThis`
    + `${offenders.length ? ' — found in ' + offenders.join(', ') : ''}`,
    offenders.length === 0);

  // ...and the seam is real rather than an empty file the check walks past
  const seam = readFileSync(new URL(`../src/${SEAM}`, import.meta.url), 'utf8');
  check('...and the seam publishes and reads back through one function each',
    /export function publish\(/.test(seam) && /export function handle\(/.test(seam));

  // The five that are gone stay gone, by name: a grep for the NAME catches a
  // reintroduction that spells its access differently to dodge the check above.
  for (const flag of ['__scriptedPirates', '__legacyPirates', '__packBrain',
    '__sharpPirates', '__cheat']) {
    const found = walk(new URL('../src/', import.meta.url)).filter((url) => {
      const src = readFileSync(url, 'utf8')
        .replace(/^\s*(\/\/|\*).*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      return src.includes(flag);
    });
    check(`${flag} is gone from src/`, found.length === 0,
      found.map((u) => u.pathname).join(', '));
  }

  // and the replacements are where the rules can find them
  check('brain selection is a field of the state, and it is saved',
    'brains' in freshState(newCommander()) && 'cheat' in freshState(newCommander()));
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

// --- one combat model, and the trainer flies it -----------------------------
//
// WHAT WAS HERE: about twenty checks comparing `src/ai-training/core.ts` to
// `src/game/{npc,gunnery,collisions}.ts` and `src/player.ts`, field by field —
// laser damage, cooldown, heat and range, the NPC gun's gate, cadence and hit
// curve, ram damage, the speed floor, per-hull hp/speed/turn/radius, two rate
// ramps and two decays. They existed because the combat model was written
// twice, and they were worth having: the block caught an NPC gun firing 5.4x
// too fast, an `accel: 120` against the player's real 220, and a turn decay
// that had drifted 35% at the two files' respective step rates.
//
// The duplication is gone. `ai-training/core.ts` is deleted and a training
// episode flies `NpcShip`, `PlayerShip`, `gunnery.ts`, `collisions.ts` and
// `rng.ts` — the game itself, with the sky emptied. A check that a number
// equals itself is not a test, so these checks are not replaced by other
// checks; they are replaced by there being one number.
//
// What survives is a different question, and a better one: does the trainer
// really fly the game? That is a property of the code now rather than of a
// promise in CLAUDE.md, and this is where it is asserted.

console.log('\none combat model (the trainer flies the game)');
{
  check('the parallel simulator is gone',
    !existsSync(new URL('../src/ai-training/core.ts', import.meta.url)));

  // 1. The target in a training episode IS the commander's ship.
  //
  // The old simulator modelled it as `CLASSES.playerCobra`, a hand-copied row
  // whose accel said 120 against the real 220 for every brain up to generation
  // 1, and whose roll cap was turnRate x TURN.roll = 2.4864 against the
  // player's 2.5. Both were REPORTED by this block and neither could be fixed
  // by it. There is nothing to copy now — the hull reads PLAYER_FLIGHT — so
  // this asserts the reading, once.
  const playerEp = new Episode({
    seed: 11, pirates: [{ kind: 'scripted' }], trader: { kind: 'scripted' },
    traderClass: 'playerCobra',
  });
  const hull = playerEp.trader.hull;
  check(`training target flies the player's envelope: speed ${hull.maxSpeed},`
    + ` accel ${hull.accel}, pitch ${hull.maxPitch}, roll ${hull.maxRoll}`,
  hull.maxSpeed === PLAYER_FLIGHT.maxSpeed && hull.accel === PLAYER_FLIGHT.accel
    && hull.maxPitch === PLAYER_FLIGHT.maxPitch && hull.maxRoll === PLAYER_FLIGHT.maxRoll);
  check('...ramping and decaying at the player\'s rates',
    hull.rateRamp === PLAYER_FLIGHT.rateRamp && hull.rateDecay === PLAYER_FLIGHT.rateDecay);
  check('...and it really is a PlayerShip, flown by a FlightDemand',
    playerEp.trader.ship instanceof PlayerShip);

  // 2. The pirates in a training episode ARE roster hulls.
  const gangEp = new Episode({
    seed: 12,
    pirates: [{ kind: 'scripted' }, { kind: 'scripted' }],
    trader: { kind: 'scripted' },
  });
  const cobraSpec = SPECS.pirate.find((s) => s.def === COBRA_MK3)!;
  const sideSpec = SPECS.pirate.find((s) => s.def === SIDEWINDER)!;
  check(`episode pirate 1 is the roster Cobra (hp ${cobraSpec.hp}, r ${cobraSpec.radius})`,
    gangEp.pirates[0].hp === cobraSpec.hp && gangEp.pirates[0].radius === cobraSpec.radius);
  check(`episode pirate 2 is the roster Sidewinder (hp ${sideSpec.hp}, r ${sideSpec.radius})`,
    gangEp.pirates[1].hp === sideSpec.hp && gangEp.pirates[1].radius === sideSpec.radius);

  // 3. Per-hull accel — the omission the merge exposed.
  //
  // npc.ts threw every brain-flown ship at a flat BRAIN_ACCEL = 120 while the
  // simulator gave each hull its own (140 / 120 / 100), so a Sidewinder was
  // trained with 17% more throttle authority than the game gave it and armed
  // traders with 17% less. This block carried a TODO asking an owner to pick a
  // side. The side is: hulls have accel, and it is a fraction of top speed.
  check('a Sidewinder now out-accelerates a pirate Cobra'
    + ` (${shipAccel(sideSpec).toFixed(0)} vs ${shipAccel(cobraSpec).toFixed(0)})`,
  shipAccel(sideSpec) > shipAccel(cobraSpec));
  check('...and the simulator\'s three hand-written accels are within a step of the rule',
    Math.abs(shipAccel(sideSpec) - 140) < 3
    && Math.abs(shipAccel(cobraSpec) - 120) < 3
    && Math.abs(shipAccel(SPECS.trader[0]) - 100) < 3);
  check(`every roster hull accelerates at ${ACCEL_FRACTION} of top speed unless told otherwise`,
    Object.values(SPECS).every((list) => list.every((s) =>
      s.accel !== undefined || shipAccel(s) === s.maxSpeed * ACCEL_FRACTION)));

  // 4. The speed floor, as BEHAVIOUR rather than as two constants agreeing.
  //
  // It is invariant 8's load-bearing rule — a fighter that can stop dead
  // becomes a turret — and it used to be checked by comparing a `minSpeed`
  // field in the simulator against MIN_CRUISE_FRACTION here. Now it is checked
  // by asking a ship to stop and watching it refuse.
  const brakeToStop = (role: 'pirate' | 'trader', spec: NpcSpec): number => {
    const ship = new NpcShip(role, new THREE.Vector3(), 5, spec);
    const state = (ship as unknown as {
      state: { brainControl: unknown; brainTimer: number };
    }).state;
    const ahead = new THREE.Vector3(0, 0, -5000);
    const level = new THREE.Quaternion();
    for (let i = 0; i < 900; i++) {
      // full brake, re-imposed each step so the 10 Hz cache cannot re-decide
      state.brainControl = { pitch: 0, roll: 0, throttle: -1, fire: false };
      state.brainTimer = 1;
      ship.brainFly(shippedPirate, 1 / 60, ahead, level, 300, 5000, null);
    }
    return ship.speed;
  };
  const pirateFloor = brakeToStop('pirate', cobraSpec);
  check(`a braking pirate stops at ${pirateFloor.toFixed(0)},`
    + ` its ${MIN_CRUISE_FRACTION} floor of ${cobraSpec.maxSpeed}`,
  Math.abs(pirateFloor - cobraSpec.maxSpeed * MIN_CRUISE_FRACTION) < 0.5);
  const traderFloor = brakeToStop('trader', SPECS.trader[0]);
  check(`...where a trader is allowed to come to rest (${traderFloor.toFixed(0)})`,
    traderFloor === 0);

  // 5. The gun an NPC actually carries, as behaviour.
  //
  // The old block asserted its cadence and gate by comparing two copies of the
  // numbers, and that is how the drift it was watching for got in anyway: the
  // check read the FIRST match in npc.ts, which was brainFly's 0.25, while
  // attack()'s 0.22 sat forty lines below on the path every police ship and
  // knife-range pirate fires from. Both paths are exercised here instead.
  const shotsIn = (bearing: number, range: number, seconds: number): number => {
    seedWorld(99);
    const ship = new NpcShip('pirate', new THREE.Vector3(), 5, cobraSpec);
    const target = new THREE.Vector3(
      Math.sin(bearing) * range, 0, -Math.cos(bearing) * range);
    const state = (ship as unknown as {
      state: { brainControl: unknown; brainTimer: number };
    }).state;
    ship.faceToward(new THREE.Vector3(0, 0, -1000)); // nose along -Z, target off it
    let shots = 0;
    for (let i = 0; i < seconds * 60; i++) {
      state.brainControl = { pitch: 0, roll: 0, throttle: 0, fire: true };
      state.brainTimer = 1;
      ship.object.position.set(0, 0, 0); // hold station, so only the gun varies
      if (ship.brainFly(shippedPirate, 1 / 60, target, new THREE.Quaternion(),
        300, range, 'player', null)) shots += 1;
    }
    return shots;
  };
  const insideGate = shotsIn(NPC_FIRE_GATE * 0.5, 800, 20);
  check(`an NPC lined up inside the ${NPC_FIRE_GATE} rad gate shoots (${insideGate} in 20s)`,
    insideGate > 0);
  check(`...at its own cadence, not faster than ${NPC_COOLDOWN_LO}s allows`,
    insideGate <= 20 / NPC_COOLDOWN_LO);
  check('...and mean cadence sits inside the cooldown spread',
    insideGate >= 20 / (NPC_COOLDOWN_LO + NPC_COOLDOWN_SPREAD));
  check('an NPC outside the gate never pulls the trigger',
    shotsIn(NPC_FIRE_GATE * 1.1, 800, 20) === 0);
  check(`...nor beyond ${NPC_LASER_RANGE} units, however well aimed`,
    shotsIn(0, NPC_LASER_RANGE + 10, 20) === 0);

  // ...and the hit curve, at both clamps and in between.
  check('an NPC shot at point blank is capped, not certain', npcHitChance(0) === NPC_HIT_CAP);
  check('...and at extreme range it floors rather than reaching zero',
    npcHitChance(99_999) === NPC_HIT_FLOOR);
  check('...and falls off with distance between them',
    npcHitChance(500) > npcHitChance(2500));

  // 6. The rate ramp had FOUR homes — player.ts, npc.ts, combat-computer.ts
  // and the simulator's stepShip — each with the constants written out again.
  // That is how the simulator sat at decay 5.0 while the player moved to 12.0,
  // and how "correcting" it silently broke the NPC half. One rule now, with
  // the constants passed in, so assert the rule rather than the copies.
  check('the shared ramp is what the player\'s controls use',
    rampFlightRate(0.4, 1.2, true, 1 / 60)
      === rampToward(0.4, 1.2, true, 1 / 60, PLAYER_FLIGHT.rateRamp, PLAYER_FLIGHT.rateDecay));
  check('...and what the combat computer uses, at the NPC constants',
    ccRamp(0.4, 1.2, false, 1 / 60)
      === rampToward(0.4, 1.2, false, 1 / 60, BRAIN_RATE_RAMP, BRAIN_RATE_DECAY));

  // 7. TURN belongs to the roster now (npc.ts used to import it from the
  // simulator), and the combat computer's caps derive from it rather than from
  // two multiplied literals.
  check(`combat computer caps track TURN (${CC_MAX_PITCH} / ${CC_MAX_ROLL})`,
    CC_MAX_PITCH === 0.5 * TURN.pitch && CC_MAX_ROLL === 0.5 * TURN.roll);

  // 8. Ramming: one constant, one speed rule, billed by the episode the way
  // world-step.ts bills it.
  check(`ramming costs the rammer RAM_DAMAGE (${RAM_DAMAGE}), and costs both the same speed`,
    PLAYER_SPEED_KEPT === NPC_SPEED_KEPT);
}

// --- the combat-training arena -----------------------------------------------
//
// arenaCentre() has to be safe in EVERY system, and "safe" is four separate
// rules owned by four other files — mass lock, the docking box, the ground and
// the sun. A bad spot is not cosmetic: the exercise ends by itself in a way the
// player cannot understand, or it docks you mid-fight. So this builds a REAL
// World for all 256 systems of galaxy 1 (plus a spot check in galaxy 3, where
// the planet radii and station orbits are drawn from different seeds) and asks
// the real functions.
//
// The mistake it exists to prevent is test/gang-trial.js's hardcoded
// (90000, 40000, 90000): an absolute point in a system whose furniture moves
// with the seed.

console.log('\ncombat arena');
{
  seedWorld(0xa4e_11a);
  const scratch = {
    v: new THREE.Vector3(), q: new THREE.Quaternion(), r: new THREE.Vector3(),
  };
  // one state, its world rebuilt per system: massLocked() is a rule over the
  // whole state, so the only honest way to ask it is to put the player there
  const state = freshState(newCommander());
  const worst = { alt: Infinity, sun: Infinity, station: Infinity };
  const where = { alt: '', sun: '', station: '' };
  let locked = 0, notClear = 0, systems = 0;

  for (const galaxy of [1, 3]) {
    for (const sys of generateGalaxy(galaxy)) {
      systems += 1;
      state.world.build(sys);
      const world = state.world;
      const centre = arenaCentre(world);
      state.player.position.copy(centre);

      const alt = centre.distanceTo(world.planetPos) - world.planetRadius;
      const sun = centre.distanceTo(world.sunPos);
      const station = centre.distanceTo(world.station.position);
      const at = `${galaxy}:${sys.name}`;
      if (alt < worst.alt) { worst.alt = alt; where.alt = at; }
      if (sun < worst.sun) { worst.sun = sun; where.sun = at; }
      if (station < worst.station) { worst.station = station; where.station = at; }

      if (massLocked(state)) locked += 1;
      if (dockingOutcome(centre, state.player.quaternion, world.station,
        world.stationDockZ, scratch) !== 'clear') notClear += 1;
    }
  }

  check(`the arena is never mass-locked (${systems} systems)`, locked === 0,
    `${locked} systems refuse the torus drive`);
  check('...and never inside the station\'s docking box', notClear === 0,
    `${notClear} systems dock you mid-fight`);
  check(`...comfortably above the planet (worst ${Math.round(worst.alt)} at ${where.alt})`,
    worst.alt > 20_000, 'mass lock starts at 4,000 and the ground at 80');
  check(`...clear of the station (worst ${Math.round(worst.station)} at ${where.station})`,
    worst.station > 20_000, 'the station mass-locks at 5,000');
  check(`...and so far from the sun the cabin never warms (worst ${Math.round(worst.sun)} at ${where.sun})`,
    worst.sun > SUN_HEAT_START && worst.sun > SUN_KILL_DIST * 10);

  // The player arrives pointing SOMEWHERE, and an exercise is fought in front
  // of the commander, so both spawn geometries have to hold.
  const arena = (): { world: World; origin: THREE.Vector3 } => {
    const world = new World();
    world.build(generateGalaxy(1)[7]);
    return { world, origin: arenaCentre(world) };
  };

  const GANG: readonly OppositionUnit[] = [
    { role: 'pirate', count: 1, tier: 2, brain: 'pack' },
    { role: 'pirate', count: 3, tier: 1, brain: 'pack' },
  ];

  {
    const { world, origin } = arena();
    seedWorld(4242);
    const ships = spawnOpposition(world, GANG, origin);
    eq('spawnOpposition produces exactly the count asked for', ships.length, 4);
    check('...and only those ships — it does not build a system',
      world.npcs.length === 4 && world.npcs.every((n) => n.role === 'pirate'));
    check('...with the tiers it was given',
      ships.map((n) => n.threatTier).join() === '2,1,1,1');
    check('...flying the pack policy, which is the `organised` flag',
      ships.every((n) => n.organised) &&
      ships.every((n) => pirateBrainFor(n.threatTier, n.organised)?.pack === true));

    // hulls come from the roster for that tier and nowhere else
    const tierHulls = (tier: number): NpcSpec[] =>
      [0, 1, 2, 3].map((k) => pirateSpecForTier(tier, k));
    const fromRoster = (n: NpcShip, tier: number) => tierHulls(tier).some((s) =>
      s.radius === n.radius && s.hp === n.maxHp);
    check('...and hulls from the tier roster',
      fromRoster(ships[0], 2) && ships.slice(1).every((n) => fromRoster(n, 1)));

    // the safety properties, for the ships as well as the centre
    check('...none of them in the planet',
      ships.every((n) => n.object.position.distanceTo(world.planetPos)
        - world.planetRadius > 20_000));
    check('...none of them in the station\'s safety zone',
      ships.every((n) => n.object.position.distanceTo(world.station.position) > 20_000));
    check('...none of them inside the docking box',
      ships.every((n) => dockingOutcome(n.object.position, n.object.quaternion,
        world.station, world.stationDockZ, scratch) === 'clear'));
    // and near enough that the fight starts: 9,000 is where an NPC begins to
    // care about the player at all (npc.ts update()).
    check('...all of them close enough to engage',
      ships.every((n) => n.object.position.distanceTo(origin) < 9000));
    // pointed at you — the constructor's orientation is random, which is right
    // for a system and wrong for a duel
    const nose = new THREE.Vector3();
    check('...and pointing at the commander, not at a random corner of space',
      ships.every((n) => {
        nose.set(0, 0, -1).applyQuaternion(n.object.quaternion);
        return nose.dot(scratch.v.copy(origin).sub(n.object.position).normalize()) > 0.99;
      }));
    // spread out, not stacked: the closest pair must clear both hulls
    let closest = Infinity;
    for (let i = 0; i < ships.length; i++) {
      for (let j = i + 1; j < ships.length; j++) {
        closest = Math.min(closest,
          ships[i].object.position.distanceTo(ships[j].object.position)
            - ships[i].radius - ships[j].radius);
      }
    }
    check(`...and not stacked on each other (closest pair ${Math.round(closest)} apart)`,
      closest > 200);
  }

  // Same seed, same sky — the property every replay, report and A/B depends on.
  {
    const fleet = (seed: number) => {
      const { world, origin } = arena();
      seedWorld(seed);
      return spawnOpposition(world, GANG, origin).map((n) => [
        n.role, n.maxHp, n.radius, n.hasEcm, n.missiles,
        ...n.object.position.toArray(), ...n.object.quaternion.toArray(),
      ].join(','));
    };
    const a = fleet(99), b = fleet(99), c = fleet(100);
    check('spawnOpposition is deterministic from the seed', a.join('|') === b.join('|'));
    check('...and a different seed is a different sky', a.join('|') !== c.join('|'));
  }

  // A cone in front of the commander, when the session says where they look.
  {
    const { world, origin } = arena();
    seedWorld(7);
    const facing = new THREE.Vector3(0, 0, -1);
    const ships = spawnOpposition(world, [{ role: 'hunter', count: 3 }], origin, { facing });
    const rel = new THREE.Vector3();
    check('a known facing puts every opponent in front of the commander',
      ships.every((n) => {
        rel.copy(n.object.position).sub(origin).normalize();
        return rel.dot(facing) > Math.cos(1.0);
      }));
    check('...out of the role\'s own roster',
      ships.every((n) => SPECS.hunter.some((s) => s.radius === n.radius && s.hp === n.maxHp)));
  }

  // The three ways to say which hull, and the fit-out overrides.
  {
    const { world, origin } = arena();
    seedWorld(11);
    const ships = spawnOpposition(world, [
      { role: 'police', count: 2, hostile: true, fit: { missiles: 3, ecm: false } },
      { role: 'pirate', count: 1, hull: CONSTRICTOR_SPEC },
      { role: 'trader', count: 1, variant: 2, fit: { ecm: true } },
    ], origin);
    eq('an explicit hull is used as given', ships[2].maxHp, CONSTRICTOR_SPEC.hp);
    eq('a variant index picks that roster entry', ships[3].maxHp, SPECS.trader[2].hp);
    check('a Viper is a Viper', ships[0].maxHp === SPECS.police[0].hp);
    check('the fit overrides the rack', ships[0].missiles === 3 && ships[1].missiles === 3);
    check('...and E.C.M., in both directions',
      !ships[0].hasEcm && !ships[1].hasEcm && ships[3].hasEcm);
    // Police ignore a clean commander unless provoked — an authored
    // interdiction has to say it was, or two Vipers fly past and nothing happens.
    check('`hostile` is what makes an authored interdiction fight at all',
      ships.slice(0, 2).every((n) => isHostileToPlayer(n, 0)));
    check('...and it is not the default',
      !isHostileToPlayer(ships[3], 0) && !ships[3].provokedByPlayer);
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

// --- the combat simulator's report ------------------------------------------
//
// src/game/combat-sim-report.ts is the measurement layer of the training
// simulator (docs/COMBAT-SIM.md), and it absorbs two console harnesses that
// could never be tested: test/combat-recorder.js (a fight a human flew) and
// test/arena.js's envelope() (how that human flies, which is what the trainer
// fits its target hull to).
//
// The samples here are BUILT BY HAND, which is the whole reason the module is
// pure: a statistic is only right if you can state the answer independently.
// Several of these tests exist specifically to pin down which average is which
// — combat-recorder.js reported a MEAN engagement range, and one pirate
// breaking off to 9000 while two knife-fight at 400 drags a mean out to a range
// nobody was ever at. Where the spec says median, a mean must fail.

console.log('\ncombat simulator report');
{
  const loadout: PlayerLoadout = {
    laser: 'beam', missiles: 4, ecm: true, energyUnit: true, energyBomb: false,
  };
  const setup = (over: Partial<ExerciseSetup> = {}): ExerciseSetup => ({
    seed: 90210,
    scenario: 'Pirate pair',
    mode: 'scenario',
    sampleHz: 10,
    player: loadout,
    opponents: [
      { hull: 'Sidewinder', brain: 'pirate-attack-r2', role: 'pirate', tier: 0 },
      { hull: 'Mamba', brain: 'scripted', role: 'pirate', tier: 1 },
    ],
    ...over,
  });
  const contact = (
    opponent: number, dist: number, theirAim: number, yourAim: number,
  ): ContactSample => ({ opponent, dist, theirAim, yourAim });
  const frame = (over: Partial<FrameSample> = {}): FrameSample => ({
    speed: 60, pitch: 0, roll: 0, foreShield: 1, aftShield: 1, energy: 4,
    contacts: [], ...over,
  });
  const near = (o: number) => contact(o, 800, 0.05, 0.05);

  // 1. Accuracy, both ways, and damage attributed to the cause the game named
  // rather than to the size of the number.
  {
    const rec = new CombatSimRecorder(setup());
    rec.playerShot({ opponent: 0, damage: 0.13 });
    rec.playerShot(null);
    rec.playerShot(null);
    rec.playerShot(null);
    rec.npcShot(0, 'laser');
    rec.npcShot(0, 'laser');
    rec.npcShot(1, 'laser');
    rec.npcShot(1, 'laser');
    rec.taken(0.18, 'laser', 0);
    rec.npcShot(1, 'missile');
    rec.taken(1.3, 'missile', 1);
    rec.taken(0.45, 'ram', 1);
    rec.taken(0.06, 'cargo');
    const r = rec.report('quit');

    eq('your accuracy is hits over DISCHARGES', r.you.accuracy, 0.25);
    eq('...and the damage you did is credited to the ship you hit',
      r.opponents[0].damageFromYou, 0.13);
    eq('their accuracy counts lasers only', r.them.accuracy, 0.25);
    eq('...a missile launch is not a shot that could have missed', r.them.missiles, 1);
    eq('...nor is the missile that landed a laser hit', r.them.hits, 1);
    eq('damage to you totals every cause', r.them.damageToYou, 1.99);
    eq('...split by the source the step reported, not by its magnitude',
      r.them.damageBySource.ram?.damage, 0.45);
    eq('...with a count per cause, so a ram is one event and not four shots',
      r.them.damageBySource.ram?.count, 1);
    eq('...and a cause that never happened is absent',
      r.them.damageBySource.station, undefined);
    eq('their damage is billed to the ship that landed it',
      r.opponents[1].damageToYou, 1.75);
    eq('...and a hit with no ship behind it still counts in the total',
      r.them.damageBySource.cargo?.damage, 0.06);
    eq('a shot nobody fired reports no accuracy rather than 0%',
      r.opponents[1].linedUpShare, null);
    eq('...and with no samples there is no shots-per-minute either',
      r.them.shotsPerMinutePerShip, null);
  }

  // 2. MEDIAN where the spec says median, MEAN where it says mean. This is the
  // test that fails if the two are ever swapped.
  {
    const rec = new CombatSimRecorder(setup({ opponents: [setup().opponents[0]] }));
    for (let i = 0; i < 8; i++) rec.frame(frame({ contacts: [contact(0, 400, 0, 0)] }));
    for (let i = 0; i < 2; i++) rec.frame(frame({ contacts: [contact(0, 9000, 0, 0)] }));
    const r = rec.report('quit');
    eq('engagement range is a MEDIAN — the range the fight happened at',
      r.range.median, 400);
    check('...and not the mean (2120), which no ship was ever at',
      r.range.median !== 2120);
    eq('closest range is the nearest it ever got', r.range.closest, 400);
    eq('...and the per-opponent line agrees', r.opponents[0].medianRange, 400);

    // aim error is the other way round: an average error IS a mean
    const aims = new CombatSimRecorder(setup({ opponents: [setup().opponents[0]] }));
    for (let i = 0; i < 9; i++) aims.frame(frame({ contacts: [contact(0, 400, 0, 0)] }));
    aims.frame(frame({ contacts: [contact(0, 400, Math.PI / 2, Math.PI / 2)] }));
    const a = aims.report('quit');
    eq('mean aim error is a MEAN, in degrees', a.meanAimErrorDeg.them, 9);
    check('...not a median, which would report nine frames of perfect aim',
      a.meanAimErrorDeg.them !== 0);

    // and the envelope: one dash for the horizon must not move the median speed
    const env = new CombatSimRecorder(setup({ opponents: [setup().opponents[0]] }));
    for (let i = 0; i < 9; i++) env.frame(frame({ speed: 0, pitch: 1.2, roll: 0.2 }));
    env.frame(frame({ speed: 400, pitch: 0, roll: 0 }));
    const e = env.report('quit').envelope;
    eq('the envelope\'s speed is a median (a mean would read 40)', e.speed?.median, 0);
    eq('...with the top speed kept separately', e.speed?.max, 400);
    eq('...and pitch is the magnitude, whichever way it was pulled',
      e.pitchRate?.median, 1.2);
    eq('a frame with nothing hostile in it contributes no engagement range',
      e.engagementRange, null);
  }

  // 3. "Lined up" is npc.ts's gate and the range cut-offs are the guns' own,
  // because combat-recorder.js wrote 14.3 degrees and 3500 into the harness and
  // a balance change would have moved the game without moving the measurement.
  {
    const rec = new CombatSimRecorder(setup({ opponents: [setup().opponents[0]] }));
    for (let i = 0; i < 3; i++) rec.frame(frame({ contacts: [contact(0, 1000, 0.1, 1)] }));
    for (let i = 0; i < 2; i++) rec.frame(frame({ contacts: [contact(0, 1000, 1, 0.1)] }));
    rec.frame(frame({ contacts: [contact(0, LASER_RANGE + 500, 0.1, 0.1)] }));
    for (let i = 0; i < 4; i++) rec.frame(frame({ contacts: [contact(0, 1000, 1, 1)] }));
    const r = rec.report('quit');
    eq('share of ship-frames they spent lined up on you', r.linedUpShare.them, 0.3);
    eq('...and you on them', r.linedUpShare.you, 0.2);
    eq('a ship aimed at you from beyond its range is not lined up',
      r.inRangeShare.them, 0.9);
    eq('every sampled frame with a hostile in it is time under attack',
      r.engagedSeconds, 1);

    const gate = new CombatSimRecorder(setup({ opponents: [setup().opponents[0]] }));
    gate.frame(frame({ contacts: [contact(0, 1000, NPC_FIRE_GATE - 0.001, Math.PI)] }));
    gate.frame(frame({ contacts: [contact(0, 1000, NPC_FIRE_GATE + 0.001, Math.PI)] }));
    eq(`lined up is NPC_FIRE_GATE (${NPC_FIRE_GATE} rad), not a hardcoded 14.3 degrees`,
      gate.report('quit').linedUpShare.them, 0.5);

    const reach = new CombatSimRecorder(setup({ opponents: [setup().opponents[0]] }));
    reach.frame(frame({ contacts: [contact(0, NPC_LASER_RANGE - 1, 0, Math.PI)] }));
    reach.frame(frame({ contacts: [contact(0, NPC_LASER_RANGE + 1, 0, Math.PI)] }));
    eq(`...and the cut-off is NPC_LASER_RANGE (${NPC_LASER_RANGE}), not a hardcoded 3500`,
      reach.report('quit').linedUpShare.them, 0.5);
  }

  // 4. On the six: a duration, so it is per FRAME. Two pirates back there at
  // once is one bad second, not two.
  {
    const behind = (o: number) => contact(o, 800, 0.05, Math.PI - 0.05);
    const rec = new CombatSimRecorder(setup());
    for (let i = 0; i < 10; i++) rec.frame(frame({ contacts: [behind(0), behind(1)] }));
    const r = rec.report('quit');
    eq('seconds they spent on your six', r.onSixSeconds.them, 1);
    check('...counted per frame, not doubled because two of them were there',
      r.onSixSeconds.them !== 2);
    eq('...and you were on nobody\'s six', r.onSixSeconds.you, 0);
    check('...though both were lined up on you the whole time',
      r.linedUpShare.them === 1 && r.linedUpShare.you === 0);

    const mirror = new CombatSimRecorder(setup({ opponents: [setup().opponents[0]] }));
    for (let i = 0; i < 5; i++) {
      mirror.frame(frame({ contacts: [contact(0, 800, Math.PI - 0.05, 0.05)] }));
    }
    eq('the mirror: astern of them and lined up is your six',
      mirror.report('quit').onSixSeconds.you, 0.5);

    const wide = new CombatSimRecorder(setup({ opponents: [setup().opponents[0]] }));
    wide.frame(frame({ contacts: [contact(0, 800, 0.05, Math.PI - SIX_CONE - 0.01)] }));
    eq(`a ship off your beam is not on your six (SIX_CONE ${SIX_CONE.toFixed(2)} rad)`,
      wide.report('quit').onSixSeconds.them, 0);
  }

  // 5. Low-water marks: the worst it got, not where it ended.
  {
    const rec = new CombatSimRecorder(setup());
    rec.frame(frame({ foreShield: 1, aftShield: 1, energy: 4 }));
    rec.frame(frame({ foreShield: 0.35, aftShield: 0.8, energy: 2.5 }));
    rec.frame(frame({ foreShield: 0.6, aftShield: 0.1, energy: 1.2 }));
    const r = rec.report('quit');
    eq('fore shield low-water mark', r.lowWater.foreShield, 0.35);
    eq('aft shield low-water mark', r.lowWater.aftShield, 0.1);
    eq('energy low-water mark', r.lowWater.energy, 1.2);
    eq('and nothing hostile means no engagement time', r.engagedSeconds, 0);
  }

  // 6. The clock: time to first and last kill, how long each opponent lived,
  // and the sampling cadence the durations are derived from.
  {
    const rec = new CombatSimRecorder(setup());
    const probe = () => frame({ contacts: [near(0), near(1)] });
    const advance = (secs: number) => {
      for (let i = 0; i < Math.round(secs * 60); i++) rec.tick(1 / 60, probe);
    };
    advance(3);
    rec.playerShot({ opponent: 0, damage: 0.5 });
    rec.opponentDown(0, true);
    advance(2);
    rec.opponentDown(1, false);
    const r = rec.report('cleared');

    eq('time to your first kill', r.kills.firstAt, 3);
    eq('...and to your last', r.kills.lastAt, 3);
    eq('kills credited to you', r.kills.yours, 1);
    eq('...and every ship that left the sky', r.kills.total, 2);
    eq('a ship that died to something else is not your kill',
      r.opponents[1].killedByYou, false);
    eq('how long the one you killed lived', r.opponents[0].livedSeconds, 3);
    eq('...and the one that saw the exercise out', r.opponents[1].livedSeconds, 5);
    eq('the exercise clock is the sum of the steps', r.seconds, 5);
    // 50 samples in 5 seconds at 10 Hz, exactly. combat-recorder.js zeroed its
    // accumulator instead of subtracting the interval, which at a 1/60 step
    // sampled every SEVEN steps — 43 samples here, 8.6 Hz calling itself 10 —
    // and every duration above is derived from a count of samples. The last
    // sample is float slack: six steps of 1/60 sum to 0.09999999999999999.
    eq('sampling holds at 10 Hz across a 1/60 step', r.envelope.samples, 50);
    eq('...so time under attack matches the clock', r.engagedSeconds, 5);
    eq('their fire rate is per ship, per minute', r.them.shotsPerMinutePerShip, 0);
  }

  // 7. The export: versioned, and it survives a round trip through JSON.
  {
    const rec = new CombatSimRecorder(setup({ wave: 2, mode: 'waves' }));
    rec.frame(frame({ contacts: [near(0), near(1)] }));
    rec.playerShot({ opponent: 1, damage: 0.16 });
    rec.opponentDown(1, true);
    const r = rec.report('destroyed');
    const back = JSON.parse(combatSimJson(r)) as CombatSimReport;

    eq('the export carries a schema version', back.schema, COMBAT_SIM_SCHEMA);
    eq('...the seed the fight ran on', back.seed, 90210);
    eq('...the scenario and mode', `${back.scenario}/${back.mode}/${back.wave}`,
      'Pirate pair/waves/2');
    eq('...your loadout', `${back.player.laser}/${back.player.missiles}`, 'beam/4');
    eq('...and every opponent\'s hull and brain',
      back.opponents.map((o) => `${o.hull}:${o.brain}`).join(','),
      'Sidewinder:pirate-attack-r2,Mamba:scripted');
    eq('the outcome is recorded', back.outcome, 'destroyed');
    check('the whole report survives JSON unchanged — no NaN, no Infinity',
      JSON.stringify(back) === JSON.stringify(r));
    check('and asking for the report twice gives the same answer',
      JSON.stringify(rec.report('destroyed')) === JSON.stringify(r));
  }

  // 8. The ring of recent exercises, and the fact that it is INSTALLED rather
  // than assigned at module scope — the rule brains.ts's installPolicyKit()
  // exists to keep, and the reason this file loads under node at all.
  {
    const rec = new CombatSimRecorder(setup());
    const r = rec.report('quit');
    const log = makeSimLog(3);
    for (let i = 1; i <= 5; i++) log.push({ ...r, seed: i });
    eq('the ring keeps the most recent N', log.records.length, 3);
    eq('...dropping the oldest', log.records[0].seed, 3);
    eq('...and last() is the newest', log.last()?.seed, 5);
    check('...and it is JSON on request', JSON.parse(log.json()).length === 3);
    log.clear();
    eq('...clear() empties it', log.records.length, 0);

    const host = globalThis as unknown as Record<string, unknown>;
    check('importing the module touches no global', host.__simLog === undefined);
    const installed = installSimLog(2);
    check('installSimLog() puts the ring on globalThis', host.__simLog === installed);
    check('...and a second call inherits the same ring rather than dropping it',
      installSimLog() === installed);
  }

  // 9. What it does when it stops understanding. A harness that says so beats
  // one that is confidently wrong — combat-recorder.js's `unknown` bucket.
  {
    const rec = new CombatSimRecorder(setup());
    rec.taken(0.2, 'plasma' as DamageSource, 0);
    rec.npcShot(7, 'laser');
    const r = rec.report('quit');
    eq('a cause DamageSource does not name lands in `unknown`',
      r.them.damageBySource.unknown?.damage, 0.2);
    check('...and the report says the game has grown a new way to hurt you',
      r.warnings.some((w) => w.includes('plasma')));
    check('...as it does for a ship this exercise never set up',
      r.warnings.some((w) => w.includes('opponent 7')));
  }

  // 10. The sample buffer is bounded, because sparring and waves are endless —
  // and it STOPS rather than dropping the oldest, so a median stays a median of
  // the fight instead of a median of the end of it.
  {
    const rec = new CombatSimRecorder(setup({ mode: 'sparring' }));
    for (let i = 0; i < MAX_SAMPLES + 5; i++) rec.frame(frame({ speed: i }));
    const r = rec.report('quit');
    eq(`the buffer stops at MAX_SAMPLES (${MAX_SAMPLES})`, r.envelope.samples, MAX_SAMPLES);
    check('...and says so rather than quietly reporting a shorter fight',
      r.warnings.some((w) => w.includes('sample buffer full')));
    eq('...keeping the START of the exercise, so the median is not the tail',
      r.envelope.speed?.median, MAX_SAMPLES / 2);
  }

  // 11. The two statistics helpers, on their own — the definitions everything
  // above rests on.
  {
    eq('quantile picks an element rather than interpolating', quantile([1, 2, 3, 4], 0.5), 3);
    eq('...and the mean of the same four is a different number', mean([1, 2, 3, 4]), 2.5);
    eq('quantile of nothing is null, because 0 is a speed', quantile([], 0.5), null);
    eq('...and so is the mean of nothing', mean([]), null);
    eq('p90 of a hundred samples', quantile(Array.from({ length: 100 }, (_, i) => i), 0.9), 90);
  }

  // 12. The geometry the samples are made of. Forward is −Z (ARCHITECTURE.md),
  // and NpcShip.facing() is the same rule from the other cockpit.
  {
    const origin = new THREE.Vector3();
    const level = new THREE.Quaternion();
    const at = (x: number, y: number, z: number) =>
      aimAngle(origin, level, new THREE.Vector3(x, y, z));
    check('a target dead ahead is 0 off the nose', Math.abs(at(0, 0, -100)) < 1e-9);
    check('...abeam is a right angle', Math.abs(at(100, 0, 0) - Math.PI / 2) < 1e-9);
    check('...and dead astern is pi', Math.abs(at(0, 0, 100) - Math.PI) < 1e-9);
    eq('...and a target in the same place as you is not an error', at(0, 0, 0), 0);
  }
}

// --- the exercise cannot touch the career ------------------------------------
//
// The safety-critical half of the combat simulator (docs/COMBAT-SIM.md). The one
// rule is that **nothing that happens in the simulator leaves it**, and the load
// -bearing case is that it must not advance you toward E L I T E: a training room
// that credited `kills` or `combatScore` would let a player grind the ladder for
// free, at a station, at no risk.
//
// This runs a FULL exercise headlessly — the real world step, the real gun, the
// real damage model — and kills by every route the game has, dies, breaches a
// hull and collects a bounty. Then it asks four things:
//
//   1. every field of the career commander is unchanged, to the byte
//   2. nothing was written to `elite-web-commander:*` or `elite-web-world:*`,
//      and nothing was REMOVED either — `Game.die` calls `clearWorld()` on
//      purpose, and a simulated death reaching it is data loss, not a leak
//   3. the rng stream is exactly where it was, so the career's next draw is the
//      draw it was about to make
//   4. the career, CONTINUED for 200 steps, is byte-identical to the same 200
//      steps with no excursion at all. A field-by-field comparison passes
//      through every historical snapshot bug in this project; continuing the run
//      does not.
//
// Plus a vacuity guard, which is not optional: the exercise's own record has to
// show kills, shots, damage taken, and an exercise commander whose kill count is
// ABOVE the career's. Without it, "unchanged" proves only that nothing happened.

console.log('\ncombat simulator: nothing leaves the exercise');
{
  /** A career worth protecting: rich, ranked, wanted, and carrying contraband. */
  const career = (): CommanderData => ({
    ...newCommander(),
    name: 'TEST COMMANDER',
    systemIndex: 7,
    credits: 123_456,
    fuel: 51,
    missiles: 3,
    kills: 137,
    combatScore: 642,
    cargo: COMMODITIES.map((_, i) =>
      (i === CONTRABAND[0] ? 4 : i === 0 ? 7 : i === 12 ? 3 : 0)),
    survivors: 1,
    legalStatus: FUGITIVE,
    equipment: {
      ...defaultEquipment(),
      laser: 'beam', rearLaser: true, ecm: true, scoops: true,
      energyBomb: true, energyUnit: true, escapePod: true, largeBay: true,
    },
    mission: { stage: 1, targetIndex: 42 },
    trumbles: 2,
    day: 88,
    contracts: [
      { kind: 'bounty', destination: 7, commodity: 0, qty: 4, reward: 5000,
        deadlineDay: 120, progress: 1 },
      { kind: 'cargo', destination: 12, commodity: 3, qty: 5, reward: 2200,
        deadlineDay: 130, progress: 0 },
    ],
  });

  // --- the fake save, and the spy over it ------------------------------------
  //
  // Node has no localStorage, and this is where the whole safety property is
  // observed, so it is a real object with real counters rather than a mock that
  // returns undefined. Slot 4 throughout: CLAUDE.md says harnesses never touch
  // slots 1-3, and this one cannot even reach a real browser's storage.
  const held = new Map<string, string>();
  const writes: string[] = [];
  const removes: string[] = [];
  const fakeStorage = {
    get length() { return held.size; },
    key: (i: number) => [...held.keys()][i] ?? null,
    getItem: (k: string) => held.get(k) ?? null,
    setItem: (k: string, v: string) => { writes.push(k); held.set(k, v); },
    removeItem: (k: string) => { removes.push(k); held.delete(k); },
    clear: () => { held.clear(); },
  };
  const globals = globalThis as unknown as { localStorage?: unknown };
  const hadStorage = 'localStorage' in globals;
  const previousStorage = globals.localStorage;
  globals.localStorage = fakeStorage;
  held.set('elite-web-slot', '4');
  const KEYS = slotKeys(4);
  // a good save already on disk — the thing a wrong restore would overwrite
  held.set(KEYS.commander, JSON.stringify(career()));

  const careerKeyTouched = (log: string[], from: number) =>
    log.slice(from).filter((k) => k === KEYS.commander || k === KEYS.world);

  // --- a career, and an exercise it can start -------------------------------

  interface Rig {
    state: ReturnType<typeof freshState>;
    ordnance: Ordnance;
    combat: Combat;
    persistence: Persistence;
    sim: CombatSim;
    said: string[];
    flashes: number;
    baseMode: 'docked' | 'flight' | 'dead';
    /** the CAREER's own step, for the flying either side of an excursion */
    step: WorldStep;
    t: number;
    dead: string[];
  }

  const rig = (seed: number, mode: 'docked' | 'flight' = 'docked'): Rig => {
    seedWorld(seed);
    const state = freshState(career());
    state.world.build(state.systems[state.commander.systemIndex]);
    const ordnance = new Ordnance(state.world);
    const combat = new Combat(state.world);
    const scratch = {
      a: new THREE.Vector3(), b: new THREE.Vector3(),
      q: new THREE.Quaternion(), ray: new THREE.Raycaster(),
    };
    const r = {
      state, ordnance, combat, said: [] as string[], flashes: 0,
      baseMode: mode, t: 0, dead: [] as string[],
    } as Rig;

    // The persistence host mimics the Game's, INCLUDING the one write that
    // matters: `enterMode('docked')` reaches `Station.dock`, which calls
    // `saveCommander`. That write is the whole reason the restore path is
    // suspended, so a stub that quietly left it out would test nothing.
    const pHost: PersistenceHost = {
      baseMode: () => r.baseMode,
      enterMode: (m) => {
        r.baseMode = m;
        if (m === 'docked') saveCommander(state.commander, 4);
      },
      buildWorld: () => { state.world.build(state.systems[state.commander.systemIndex]); },
      enterWitchspace: () => { state.world.banishScenery(); },
      isDead: () => r.baseMode === 'dead',
      message: (text) => r.said.push(text),
    };
    r.persistence = new Persistence(state, ordnance, new CombatComputer(), pHost);

    const simHost: SimHost = {
      enterFlight: () => { r.baseMode = 'flight'; },
      message: (text) => r.said.push(text),
      flashDamage: () => { r.flashes += 1; },
      aimBeams: () => {},
      finished: () => {},
    };
    r.sim = new CombatSim(state, ordnance, combat, r.persistence, simHost, makeSimLog());

    // The career's own host: what the Game does, minus the browser. It really
    // writes the save, so the storage spy is not vacuous — a career that never
    // wrote anything would make "nothing was written during the exercise" true
    // for the wrong reason.
    const careerHost: StepHost = {
      inFlight: () => r.baseMode === 'flight' && r.dead.length === 0,
      applyPlayerDamage: (amount, from) => {
        damagePlayer(state, combat, amount, from, scratch);
      },
      destroyNpc: (npc) => { combat.destroy(state.commander, npc); },
      wreckNpc: (npc) => { combat.wreck(npc); },
      fireLaser: () => { firePlayerLaser(state, combat, scratch); },
      raiseLegal: (level) => {
        if (level > state.commander.legalStatus) state.commander.legalStatus = level;
      },
      die: (reason) => { r.dead.push(reason); },
      dock: () => {},
      completeHyperspace: () => {},
      completeRescue: () => {},
      openHermitTrade: () => {},
      autoSave: () => { r.persistence.autoSave(); },
    };
    r.step = new WorldStep(state, ordnance, careerHost);
    return r;
  };

  const CRUISE: FlightDemand = { rollRate: 0, pitchRate: 0, throttle: 0, fire: false };

  /**
   * three.js updates world matrices at RENDER time, and `traceShot` raycasts
   * against them — so headless, the harness has to do the renderer's one job or
   * every shot is tested against the origin.
   */
  const settleMatrices = (r: Rig) => { r.state.world.scene.updateMatrixWorld(true); };

  /** Frames of exercise, with the career's teardown checked after each. */
  const beat = (r: Rig, steps: number, demand: FlightDemand = CRUISE,
    aim?: () => THREE.Vector3 | null) => {
    for (let i = 0; i < steps; i++) {
      if (aim) {
        const at = aim();
        if (at) {
          r.state.player.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(
            r.state.player.position, at, new THREE.Vector3(0, 1, 0)));
        }
      }
      r.sim.tick(FIXED_DT, r.t, { demand, handsOn: false });
      r.t += FIXED_DT;
      r.sim.settle();
      settleMatrices(r);
    }
  };

  /** Frames of ordinary career flight, through the career's own step. */
  const flyCareer = (r: Rig, steps: number, demand: FlightDemand) => {
    for (let i = 0; i < steps; i++) {
      r.step.step(FIXED_DT, r.t, { demand, handsOn: false });
      r.t += FIXED_DT;
      settleMatrices(r);
    }
  };

  /** Read `baseMode` without narrowing: the exercise changes it through a host. */
  const whereShipIs = (r: Rig): string => r.baseMode;

  const park = (npc: NpcShip, at: THREE.Vector3) => {
    npc.object.position.copy(at);
    npc.object.updateMatrixWorld(true);
  };

  /** Which fields of two commanders differ, by name. */
  const commanderDiff = (a: CommanderData, b: CommanderData): string[] =>
    Object.keys(a).filter((k) => JSON.stringify((a as unknown as Record<string, unknown>)[k])
      !== JSON.stringify((b as unknown as Record<string, unknown>)[k]));

  // --- one full exercise: every kill route, a death, a breach, a bounty ------

  {
    const r = rig(20_260_730, 'docked');
    const s = r.state;
    // A career that has been flying: the world blob exists, so a stray
    // `clearWorld()` would have something to destroy.
    r.baseMode = 'flight';
    s.player.position.copy(s.world.station.position).normalize()
      .multiplyScalar(s.world.planetRadius * 16);
    s.player.speed = 180;
    s.session.autoSaveTimer = 0.5;
    flyCareer(r, 120, CRUISE);
    r.baseMode = 'docked';
    check('the career writes its own save, so the storage spy is not vacuous',
      careerKeyTouched(writes, 0).length >= 2 && !!held.get(KEYS.world));
    // …and traffic in the sky, so "the sky came back" has something to come back
    for (let i = 0; i < 3; i++) {
      const t = s.world.spawn('trader',
        s.player.position.clone().add(new THREE.Vector3(900 * (i - 1), 200, -2400)), i);
      t.hp = 3 + i;
    }
    settleMatrices(r);

    const before = structuredClone(s.commander);
    // the career OBJECT itself, so a mid-exercise check can prove the swap
    // happened rather than that the teardown repaired it
    const careerObj = s.commander;
    const playerBefore = s.player.position.clone();
    const rngBefore = rngState();
    const skyBefore = s.world.npcs.map((n) => [n.role, n.hp,
      n.object.position.toArray().join()].join('|'));
    const writeMark = writes.length;
    const removeMark = removes.length;
    const worldBlob = held.get(KEYS.world);
    const savedCommander = held.get(KEYS.commander);

    // Five pirates, so there is still opposition alive when the commander dies.
    const custom: Opposition[] = [{
      role: 'pirate', count: 5, tier: 1, organised: false,
      brain: SHIPPED_SOLO_BRAIN, mixed: false, seed: 31,
    }];
    const spec: ExerciseSpec = {
      mode: 'scenario', scenario: 'single-pirate', tier: 1, seed: 4242, custom,
    };
    check('an exercise starts', r.sim.begin(spec));
    check('...and it is ordinary FLIGHT, not a screen', whereShipIs(r) === 'flight');
    check('...flying a commander that is not the career',
      r.sim.commander !== null && r.sim.commander !== before
      && s.commander !== before);
    check('...with no cargo, no contracts and a clean record aboard',
      r.sim.commander!.cargo.every((q) => q === 0)
      && r.sim.commander!.contracts.length === 0
      && r.sim.commander!.legalStatus === CLEAN);
    check('...and the career\'s kill count copied across, so credit is visible',
      r.sim.commander!.kills === before.kills);
    check('...in an arena with nothing in it but the opposition',
      s.world.npcs.length === 5 && s.world.npcs.every((n) => n.role === 'pirate'));
    check('...and the ambient traffic switched off',
      s.encounterTimers.pirateWave > 1e6 && s.encounterTimers.trader > 1e6
      && Number.isFinite(s.encounterTimers.trader));

    const foes = [...s.world.npcs];
    const fwd = s.player.getForward(new THREE.Vector3()).clone();
    // Out of the way until they are wanted — and each to its OWN corner, or
    // three ships sharing a coordinate ram each other to death and the round
    // clears itself while the harness is looking elsewhere.
    const corners = [
      new THREE.Vector3(30_000, 0, 0),
      new THREE.Vector3(0, 30_000, 0),
      new THREE.Vector3(0, 0, 30_000),
    ];
    [2, 3, 4].forEach((f, k) => park(foes[f], s.player.position.clone().add(corners[k])));

    // 1. A LASER kill — the path a host-only defence cannot see, because
    //    `Combat.fire` calls `destroy(commander, …)` internally.
    foes[0].hp = 0.1;   // one bolt's worth: a laser does ~0.16 a shot
    park(foes[0], s.player.position.clone().addScaledVector(fwd, 420));
    beat(r, 20, { ...CRUISE, fire: true }, () => foes[0].object.position);
    check('a kill by laser leaves the sky', !foes[0].alive);
    check('...and is credited to the EXERCISE commander, not the career',
      r.sim.commander!.kills === before.kills + 1 && before.kills === 137);

    // 2. A RAM kill — through the step's collision phase.
    foes[1].hp = 0.2;
    park(foes[1], s.player.position.clone().addScaledVector(fwd, 10));
    beat(r, 4);
    check('a kill by ram leaves the sky too', !foes[1].alive);

    // 3. A MISSILE kill — through `applyOrdnance`, and it spends the clone's rack.
    const rackBefore = r.sim.commander!.missiles;
    park(foes[2], s.player.position.clone().addScaledVector(fwd, 900));
    r.ordnance.targetLock = foes[2];
    r.ordnance.armed = true;
    r.ordnance.launch(r.sim.commander!, s.player.position);
    check('the missile came off the EXERCISE commander\'s rack',
      r.sim.commander!.missiles === rackBefore - 1);
    beat(r, 150, CRUISE, () => foes[2].object.position);
    check('a kill by missile leaves the sky', !foes[2].alive);

    // 4. An ENERGY BOMB kill — which reaches `Game.destroyNpc` from
    //    `runCommand`, not through the step at all. This is what the Game's
    //    one-line redirect into the exercise is for.
    park(foes[3], s.player.position.clone().addScaledVector(fwd, 1500));
    const bomb = r.ordnance.detonateEnergyBomb(r.sim.commander!, s.player.position);
    check('the bomb came off the exercise commander\'s hull', bomb.reply === 'bombFired');
    for (const npc of bomb.caught) {
      npc.takeDamage(99, s.player.position, true);
      r.sim.destroyNpc(npc);
    }
    beat(r, 2);
    check('a kill by energy bomb leaves the sky', !foes[3].alive);
    check('...and four kills went to the clone, which the career never sees',
      r.sim.commander!.kills === before.kills + 4);
    check('...as did the bounties on them',
      r.sim.commander!.credits > before.credits);
    check('...and the combat score that the E L I T E ladder reads',
      r.sim.commander!.combatScore > before.combatScore);

    // 5. A HULL BREACH — which costs a fitting, off the CLONE's hull.
    let breached = false;
    for (let i = 0; i < 60 && !breached; i++) {
      s.sys.foreShield = 0;
      s.sys.aftShield = 0;
      s.sys.energy = 4;
      r.sim.verbs.applyPlayerDamage(0.4, foes[4].object.position, 'laser');
      breached = !r.sim.commander!.equipment.ecm
        || !r.sim.commander!.equipment.scoops
        || !r.sim.commander!.equipment.rearLaser;
    }
    check('a hull breach costs the exercise commander a fitting', breached);

    // PREVENTION, not repair — asserted here, mid-exercise, ON PURPOSE.
    //
    // Every other career assertion in this block runs after settle(), and by
    // then the entry snapshot has restored the commander. So a BROKEN commander
    // swap would still pass them: the repair layer masks the prevention layer.
    // Verified by mutation — pointing the exercise at the career commander
    // instead of a clone left "every field of the career commander is
    // unchanged" green.
    //
    // The three layers are not interchangeable. The swap and the host refusals
    // PREVENT; the snapshot REPAIRS. Prevention is what protects a player,
    // because it is the layer that still holds when the other one has a bug.
    // So: the career object must be untouched WHILE the fight is running, four
    // kills and a bounty and a breach in.
    check('the career commander is untouched DURING the exercise, not just after',
      careerObj.kills === before.kills
      && careerObj.combatScore === before.combatScore
      && careerObj.credits === before.credits
      && careerObj.legalStatus === before.legalStatus);
    check('...and the exercise is flying a different object entirely',
      r.sim.commander !== careerObj);

    // 6. And a DEATH, which must never reach `Game.die` and its clearWorld().
    const clone = structuredClone(r.sim.commander!);
    s.sys.energy = 0.2;
    r.sim.verbs.applyPlayerDamage(9, foes[4].object.position, 'laser');
    check('a simulated death ends the exercise', !r.sim.fighting);
    const records = r.sim.settle() ?? [];
    check('...and the teardown produced a record', records.length === 1);

    // --- the vacuity guard ---------------------------------------------------
    const rec = records[0];
    check(`the record is of a real fight (${rec.you.kills} kills, `
      + `${rec.you.shots} shots, ${rec.them.damageToYou} damage taken)`,
      rec.you.kills >= 1 && rec.you.shots >= 1 && rec.them.damageToYou > 0);
    check('...that the commander lost', rec.outcome === 'destroyed');
    check('...with the exercise commander\'s kills above the career\'s',
      clone.kills > before.kills && clone.kills === before.kills + 4);
    check('...and every opponent named with the brain it flew',
      rec.opponents.length === 5
      && rec.opponents.every((o) => !!o.hull && o.brain === SHIPPED_SOLO_BRAIN));
    check('...and the geometry was sampled', rec.envelope.samples > 10);

    // --- and now the four properties ----------------------------------------
    const diff = commanderDiff(before, s.commander);
    check(`every field of the career commander is unchanged (${diff.join() || 'none differ'})`,
      diff.length === 0);
    check('...including the two the whole rule is about',
      s.commander.kills === 137 && s.commander.combatScore === 642);
    check('...and its credits, missiles, cargo and equipment',
      s.commander.credits === 123_456 && s.commander.missiles === 3
      && s.commander.equipment.energyBomb && s.commander.equipment.ecm
      && s.commander.cargo[CONTRABAND[0]] === 4);
    check('...and its legal status, which a simulated offence cannot move',
      s.commander.legalStatus === FUGITIVE);

    check('nothing was WRITTEN to the commander or the world during the exercise',
      careerKeyTouched(writes, writeMark).length === 0);
    check('...and nothing was REMOVED either — die() calls clearWorld()',
      careerKeyTouched(removes, removeMark).length === 0
      && held.get(KEYS.world) === worldBlob);
    check('...so the save on disk is the one that was there before',
      held.get(KEYS.commander) === savedCommander);
    check('...and the write the restore path DOES attempt was refused, '
      + 'which is what makes the suppression load-bearing',
      r.sim.refusedWrites.includes(KEYS.commander));

    check('the rng stream is exactly where the career left it',
      JSON.stringify(rngState()) === JSON.stringify(rngBefore));
    check('the sky came back',
      s.world.npcs.map((n) => [n.role, n.hp,
        n.object.position.toArray().join()].join('|')).join('#') === skyBefore.join('#')
      && skyBefore.length > 0);
    check('...and the ship is where it was, not out in the arena',
      whereShipIs(r) === 'docked'
      && s.player.position.distanceTo(playerBefore) === 0);
    check('the exercise is over and holds nothing', !r.sim.active);
    check('...and its record went into the ring for the trainer to read',
      r.sim.simLog.records.length === 1 && r.sim.simLog.last() === rec);
  }

  // --- every member of the alternative StepHost, driven directly ------------
  //
  // The second layer is a list of twelve verbs, and a defence whose only test is
  // that one fight happened to come out safe is not a tested defence. So: start
  // an exercise and call every one of them.

  {
    const r = rig(555_666, 'docked');
    const s = r.state;
    const spec: ExerciseSpec = {
      mode: 'scenario', scenario: 'pirate-pair', tier: 1, seed: 77,
    };
    r.sim.begin(spec);
    const clone = s.commander;
    const foes = [...s.world.npcs];
    const writeMark = writes.length;
    const removeMark = removes.length;
    const at = foes[0].object.position;

    check('StepHost.inFlight — true while the exercise is a fight',
      r.sim.verbs.inFlight() === true);

    r.sim.verbs.autoSave();
    check('StepHost.autoSave — REFUSED: the save is the career\'s',
      writes.length === writeMark && removes.length === removeMark);

    r.sim.verbs.dock();
    check('StepHost.dock — REFUSED: docking pays a fine and writes the save',
      r.sim.fighting && r.baseMode === 'flight' && writes.length === writeMark);

    r.sim.verbs.raiseLegal(FUGITIVE);
    check('StepHost.raiseLegal — REFUSED: an exercise cannot make you a Fugitive',
      clone.legalStatus === CLEAN);

    const wasSystem = clone.systemIndex;
    r.sim.verbs.completeHyperspace();
    check('StepHost.completeHyperspace — REFUSED: no fuel spent, no day passed',
      clone.systemIndex === wasSystem && clone.fuel === MAX_FUEL && clone.day === 88);

    r.sim.verbs.completeRescue();
    check('StepHost.completeRescue — REFUSED: nothing taken as salvage',
      clone.cargo.every((q) => q === 0) && clone.systemIndex === wasSystem);

    r.sim.verbs.openHermitTrade();
    check('StepHost.openHermitTrade — REFUSED: a market would stop the world',
      !s.session.hermitTrading && s.market.length === 0);

    const flashes = r.flashes;
    const shieldWas = s.sys.foreShield;
    r.sim.verbs.applyPlayerDamage(0.6, at, 'laser');
    check('StepHost.applyPlayerDamage — REDIRECTED: real damage, real flash',
      s.sys.foreShield < shieldWas && r.flashes === flashes + 1);

    r.sim.verbs.fireLaser();
    check('StepHost.fireLaser — REDIRECTED: the real gun, and the gun got hot',
      s.sys.laserTemp > 0);

    const killsWas = clone.kills;
    r.sim.verbs.wreckNpc(foes[0]);
    check('StepHost.wreckNpc — PASS-THROUGH: out of the sky, credited to nobody',
      !s.world.npcs.includes(foes[0]) && clone.kills === killsWas);

    r.sim.verbs.destroyNpc(foes[1]);
    check('StepHost.destroyNpc — REDIRECTED: credited to the clone',
      clone.kills === killsWas + 1 && !s.world.npcs.includes(foes[1]));

    r.sim.verbs.die('CABIN TEMPERATURE CRITICAL');
    check('StepHost.die — REDIRECTED: it ends the exercise…', !r.sim.fighting);
    check('…and NOT the career, whose world blob is untouched',
      careerKeyTouched(removes, removeMark).length === 0);

    const records = r.sim.settle() ?? [];
    check('the verb battery still left the career alone',
      commanderDiff(career(), s.commander).length === 0 && records.length === 1);
    check('...and the record says what the fight was worth',
      records[0].you.shots >= 1 && records[0].kills.total === 2);
  }

  // --- the stronger form: the career CONTINUES as if nothing happened -------

  {
    const demand: FlightDemand = { rollRate: 0.3, pitchRate: 0.15, throttle: 1, fire: true };
    /** What the run LOOKED like, to the byte. */
    const trace = (r: Rig) => JSON.stringify({
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
      commander: r.state.commander,
    });

    /** A career mid-flight, with a reception around it. */
    const flying = (seed: number): Rig => {
      const r = rig(seed, 'flight');
      const s = r.state;
      s.player.position.copy(s.world.station.position).normalize()
        .multiplyScalar(s.world.planetRadius * 16);
      s.player.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(
        s.player.position, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)));
      s.player.speed = 200;
      for (let i = 0; i < 3; i++) {
        const p = s.world.spawn('pirate',
          s.player.position.clone().add(new THREE.Vector3(320 * (i - 1), 140, -1500)),
          i, pirateSpecForTier(1, i));
        p.threatTier = 1;
      }
      settleMatrices(r);
      return r;
    };

    const control = flying(9_090_909);
    const mark = rngState();
    flyCareer(control, 200, demand);
    const wanted = trace(control);

    const excursion = flying(9_090_909);
    restoreRng(mark);
    // …and 400 frames of a live exercise in the middle of it, which spawns
    // ships, fires guns, spends missiles, draws from the stream and rebuilds the
    // world on the way out.
    excursion.sim.begin({ mode: 'waves', scenario: 'single-pirate', tier: 2, seed: 8_675_309 });
    beat(excursion, 600, { rollRate: 0.2, pitchRate: -0.1, throttle: 1, fire: true });
    const excursionRecords = excursion.sim.quit() ?? [];
    const flown = excursionRecords.reduce((n, x) => n + x.envelope.samples, 0);
    const fired = excursionRecords.reduce((n, x) => n + x.you.shots, 0);
    check(`the excursion was a real fight, not a formality (${excursionRecords.length} `
      + `records, ${flown} samples, ${fired} shots)`,
      excursionRecords.length >= 1 && flown > 60 && fired > 10);
    check('...and it was flying in FLIGHT mode, so it restored to flight',
      excursion.baseMode === 'flight');

    flyCareer(excursion, 200, demand);
    check('200 steps of career after an excursion are byte-identical to 200 with none',
      trace(excursion) === wanted);
    check('...and the fixture is not vacuously empty',
      wanted.length > 1000 && control.state.world.npcs.length > 0);

    // the negative control: a career that took a DIFFERENT excursion is allowed
    // to differ from neither of them — what must not differ is the one above
    const naive = flying(9_090_909);
    restoreRng(mark);
    flyCareer(naive, 199, demand);
    check('...while 199 steps do not (the control)', trace(naive) !== wanted);

    // --- the career's own brain selection survives an exercise --------------
    //
    // Which brain an NPC flies used to be four ambient `window.__` globals,
    // which cost this three ways: the flag was not in the snapshot, so a save
    // restored in a fresh tab flew DIFFERENT brains than the run it came from;
    // a test leaked its choice into the next unless it cleared up by hand; and
    // the trainer needed a save-the-old-value/put-it-back dance, run FIRST in
    // teardown, because a career left flying an exercise's A/B brain is a leak
    // nobody would ever notice.
    //
    // `state.brains` is a field of GameState, so it is in the entry snapshot
    // and the ordinary restore puts it back. The hazard is deleted rather than
    // guarded — which is only true if it is really in the snapshot, so: drop
    // `brains` from Persistence.capture() and the LAST check here fails. That
    // mutation passes every other test in this file, including the
    // name-presence grep above, which sees the field name and not the value.
    const ab = flying(5_150_515);
    ab.state.brains = { legacy: 'pro' };
    ab.sim.begin({
      mode: 'sparring', scenario: 'single-pirate', tier: 2, seed: 4_242,
      brain: 'pirate-pack-r4-selectonly',
    });
    check('an exercise flies the brain IT asked for, not the career\'s',
      ab.state.brains.pack === true && ab.state.brains.legacy === undefined);
    beat(ab, 120, demand);
    ab.sim.quit();
    check('...and the career\'s own selection is back when the exercise ends',
      ab.state.brains.legacy === 'pro' && !ab.state.brains.pack);
  }

  if (hadStorage) globals.localStorage = previousStorage;
  else delete globals.localStorage;
}


// --- result -----------------------------------------------------------------

// One total and one exit code for every imported test file — see test/harness.ts.
summarise();
