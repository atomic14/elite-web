// Where a training fight opens, and whether the pilot can see it.
//
// The complaint this answers was flown, not derived: an exercise launched with
// the opponent off-screen, the only sign of it a target bracket at the edge of
// the view under the console, and hits already landing. So the assertions are in
// two halves and both are needed.
//
// The PLANS are held to rules that are invisible by inspection — outside their
// gun, inside their interest, and clear of the attack-run thresholds
// (combat-sim-report.ts's PASS_CLOSE/PASS_FAR), because a range picked for how a
// fight feels would silently change what TODO 34's pass count MEANS.
//
// The GEOMETRY is then flown through the real spawner over the real seeded
// stream, and measured HERE rather than read off the record: a report that
// checked its own arithmetic would pass while every ship sat behind the pilot.

import * as THREE from 'three';

import { newCommander } from '../src/game/commander.ts';
import { freshState } from '../src/game/state.ts';
import { Ordnance } from '../src/game/ordnance.ts';
import { Combat } from '../src/game/combat.ts';
import { CombatComputer } from '../src/game/combat-computer.ts';
import { Persistence, type PersistenceHost } from '../src/game/persistence.ts';
import { CombatSim, type SimHost } from '../src/game/combat-sim.ts';
import {
  PASS_CLOSE, PASS_FAR, makeSimLog, type CombatSimReport,
} from '../src/game/combat-sim-report.ts';
import {
  CUSTOM_OPENING, IN_VIEW_DEG, MIN_OPENING_RANGE, NO_OPENING, OPENING_RANGE,
  measureOpening, openingFor, openingPlacement, openingPlans,
} from '../src/game/combat-sim-opening.ts';
import { SCENARIOS, type ExerciseSpec, type ScenarioId } from '../src/game/combat-sim-scenarios.ts';
import { LASER_RANGE, NPC_LASER_RANGE } from '../src/game/gunnery.ts';
import { CONDITION_RED_RANGE } from '../src/game/npc.ts';
import { seedWorld } from '../src/game/rng.ts';
import { readFileSync } from 'node:fs';
import { check, eq } from './harness.ts';

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** The spawner scatters a ring by this much: `range * (0.85 + random() * 0.3)`. */
const NEAR = 0.85;
const FAR = 1.15;
/** …and a ship lands between these fractions of the cone off the axis. */
const CONE_MIN = 0.55;
const CONE_MAX = 1.45;

const deg = (rad: number): number => (rad * 180) / Math.PI;

// --- the plans ---------------------------------------------------------------

console.log('\ncombat simulator — the opening each scenario asks for');
{
  const plans = openingPlans();
  const planFor = (scenario: ScenarioId) =>
    openingFor({ mode: 'scenario', scenario, tier: 1, seed: 1 });
  check('every scenario in the table states where its fight opens',
    SCENARIOS.every((s) => planFor(s.id) !== undefined));
  eq('...and the table holds those seven and the custom picker, and nothing else',
    plans.length, SCENARIOS.length + 1);
  eq('a custom fight is one you assembled to watch, so it opens in front of you',
    CUSTOM_OPENING.arc, 'ahead');
  eq('...whatever scenario row the picker happened to be on',
    openingFor({ mode: 'scenario', scenario: 'thargoids', tier: 1, seed: 1, custom: [] }).arc,
    'ahead');

  // The pass thresholds. This is the coupling that is invisible by inspection:
  // countPasses starts a fight "outside", so a ship that STARTS inside
  // PASS_CLOSE is already counted as in, and scores a completed run the first
  // time it leaves — a pass nobody flew. Starting in the 400-900 dead band
  // half-measures the first approach instead.
  for (const p of plans) {
    check(`an opening at ${p.range} clears the minimum ${MIN_OPENING_RANGE}`,
      p.range >= MIN_OPENING_RANGE);
    check('...so the nearest ship starts outside PASS_FAR even after the scatter',
      p.range * NEAR > PASS_FAR);
    check('...and nowhere near inside PASS_CLOSE, which would be a free pass',
      p.range * NEAR > PASS_CLOSE);
    check(`...and inside ${CONDITION_RED_RANGE}, where an NPC starts caring at all`,
      p.range * FAR < CONDITION_RED_RANGE);
  }

  // The arcs: six in view, one deliberately not.
  const astern = SCENARIOS.filter((s) => planFor(s.id).arc === 'astern');
  eq('exactly one scenario opens behind the pilot', astern.length, 1);
  eq('...and it is the ambush, which is what an ambush is', astern[0].id, 'thargoids');

  for (const s of SCENARIOS) {
    const p = planFor(s.id);
    if (p.arc === 'astern') continue;
    check(`${s.id} opens where the pilot is looking`,
      p.coneDeg * CONE_MAX <= IN_VIEW_DEG);
    // Outside their gun, so the exercise opens with an APPROACH — the seconds a
    // brain shows whether it commits or loiters in — rather than with a hit
    // from something the pilot has not found yet.
    check('...and outside their gun, so nobody is shot before they have looked',
      p.range * NEAR > NPC_LASER_RANGE);
    check('...but not outside your own, which would be a stare and not a fight',
      p.range * NEAR < CONDITION_RED_RANGE && p.range > LASER_RANGE);
  }
  const ambush = planFor('thargoids');
  check('the ambush opens INSIDE their gun, which is the point of one',
    ambush.range * FAR < NPC_LASER_RANGE);
  check('...and never so wide off your tail that one of them is in front of you',
    ambush.coneDeg * CONE_MAX < 90);

  eq('a record nobody placed says so, rather than inventing a geometry',
    `${NO_OPENING.range}/${NO_OPENING.nearest}/${NO_OPENING.inView}`, '0/null/false');
}

// --- what the pilot sees at t=0 ---------------------------------------------

console.log('\ncombat simulator — the opening, flown');
{
  interface Rig {
    sim: CombatSim;
    state: ReturnType<typeof freshState>;
  }

  /** A commander at a station, and a simulator that can put a fight in front of it. */
  const rig = (seed: number): Rig => {
    seedWorld(seed);
    const state = freshState(newCommander());
    state.world.build(state.systems[state.commander.systemIndex]);
    const ordnance = new Ordnance(state.world);
    const combat = new Combat(state.world);
    let mode: 'docked' | 'flight' | 'dead' = 'docked';
    const pHost: PersistenceHost = {
      baseMode: () => mode,
      enterMode: (m) => { mode = m; },
      buildWorld: () => { state.world.build(state.systems[state.commander.systemIndex]); },
      enterWitchspace: () => { state.world.banishScenery(); },
      isDead: () => mode === 'dead',
      message: () => {},
      saveCommander: () => {},
      saveWorld: () => {},
      readWorld: () => null,
      clearWorld: () => {},
      withoutSaving: (fn) => ({ value: fn(), refused: [] }),
    };
    const persistence = new Persistence(state, ordnance, new CombatComputer(), pHost);
    const simHost: SimHost = {
      enterFlight: () => { mode = 'flight'; },
      message: () => {},
      sound: () => {},
      flashDamage: () => {},
      aimBeams: () => {},
      finished: () => {},
    };
    return {
      state,
      sim: new CombatSim(state, ordnance, combat, persistence, simHost, makeSimLog()),
    };
  };

  /**
   * Launch one exercise, read the sky BEFORE the teardown puts the career back,
   * and end it. The record and the independent measurement of the same instant.
   */
  const launch = (spec: ExerciseSpec, seed = 4242): {
    report: CombatSimReport; ranges: number[]; bearings: number[];
  } => {
    const r = rig(seed);
    check(`an exercise starts (${spec.custom ? 'custom' : spec.scenario})`, r.sim.begin(spec));
    const { player, world } = r.state;
    const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion);
    const to = new THREE.Vector3();
    const ranges = world.npcs.map((n) => n.object.position.distanceTo(player.position));
    const bearings = world.npcs.map((n) => deg(nose.angleTo(
      to.copy(n.object.position).sub(player.position))));
    const records = r.sim.quit();
    check('...and ends with a record', !!records && records.length === 1);
    return { report: records![0], ranges, bearings };
  };

  const scenarioSpec = (scenario: ScenarioId, seed = 4242): ExerciseSpec =>
    ({ mode: 'scenario', scenario, tier: 1, seed });

  for (const s of SCENARIOS) {
    const plan = openingFor(scenarioSpec(s.id));
    const { report, ranges, bearings } = launch(scenarioSpec(s.id));
    const o = report.opening;
    check(`${s.id}: something is in the sky to fight`, ranges.length > 0);
    eq(`${s.id}: the record says which arc it opened in`, o.arc, plan.arc);
    eq('...and the range it was asked to open at', o.range, plan.range);
    eq('...and what the scatter made of it, to the nearest unit',
      `${o.nearest}/${o.furthest}`,
      `${Math.round(Math.min(...ranges))}/${Math.round(Math.max(...ranges))}`);
    eq('...and the widest any of them was off the nose',
      o.widestBearingDeg, Math.round(Math.max(...bearings)));
    check('...with every ship on the ring the scenario asked for',
      ranges.every((d) => d >= plan.range * NEAR - 1 && d <= plan.range * FAR + 1));
    check('...and none of them starting inside the attack-run thresholds, so the '
      + 'first run in the record is a run somebody flew',
      Math.min(...ranges) > PASS_FAR);
    // Off the ARC's axis, which for an ambush is your tail: the same band
    // either way, and it is the band the plan's cone claims.
    const offAxis = bearings.map((b) => (plan.arc === 'astern' ? 180 - b : b));
    check('...and every one of them inside the cone the plan asked for',
      offAxis.every((b) => b >= plan.coneDeg * CONE_MIN - 1
        && b <= plan.coneDeg * CONE_MAX + 1));

    if (plan.arc === 'ahead') {
      check(`${s.id}: every opponent is in the canopy at t=0 — the whole point`,
        bearings.every((b) => b <= IN_VIEW_DEG));
      check('...and the record says IN VIEW', o.inView);
      check('...and none of them can shoot before the approach has happened',
        Math.min(...ranges) > NPC_LASER_RANGE);
    } else {
      check(`${s.id}: the ambush opens behind the pilot, deliberately`,
        bearings.every((b) => b > 120));
      check('...and the record says NOT IN VIEW, so it reads as deliberate',
        !o.inView);
    }
    check('...and the event log carries the opening, at t=0',
      report.events.some((e) => e.t === 0 && e.what.startsWith('opening: ')
        && e.what.includes(plan.arc)));
  }

  // A fight the pilot built: ahead, like the six scenarios that are.
  {
    const spec: ExerciseSpec = {
      ...scenarioSpec('thargoids'),
      custom: [{
        role: 'pirate', count: 3, tier: 1, organised: false,
        brain: 'scripted', mixed: false, seed: 11,
      }],
    };
    const { report, bearings } = launch(spec);
    eq('a custom fight opens in front of you whatever scenario row it borrowed',
      report.opening.arc, 'ahead');
    check('...with all three of them in the canopy',
      bearings.length === 3 && bearings.every((b) => b <= IN_VIEW_DEG));
    eq('...at the range every visible opening uses', report.opening.range, OPENING_RANGE);
  }

  // Seeded, like everything else. The opening is drawn from the world stream
  // that `begin()` re-seeds, so a record quoting a seed rebuilds the fight it
  // describes — which is what a report is FOR.
  {
    const key = (r: { report: CombatSimReport; ranges: number[]; bearings: number[] }) =>
      [JSON.stringify(r.report.opening), r.ranges.map((d) => d.toFixed(6)).join(),
        r.bearings.map((b) => b.toFixed(6)).join()].join('|');
    const a = key(launch(scenarioSpec('pirate-gang', 90_210), 99));
    const b = key(launch(scenarioSpec('pirate-gang', 90_210), 99));
    const c = key(launch(scenarioSpec('pirate-gang', 90_211), 99));
    // The career's own stream is a different seed here, and the opening does
    // not move: `begin()` re-seeds from the EXERCISE seed, which is why the one
    // number on the record is enough to fly the fight again.
    const d = key(launch(scenarioSpec('pirate-gang', 90_210), 12_345));
    eq('the same seed gives the same opening, to the last decimal', a, b);
    check('...and a different one gives a different opening', a !== c);
    eq('...and the career the exercise interrupted does not change it', a, d);
  }

  // Waves and sparring re-open per round, around wherever the pilot has got to.
  {
    const r = rig(7);
    check('a wave exercise starts', r.sim.begin(
      { mode: 'waves', scenario: 'single-pirate', tier: 1, seed: 3 }));
    const { player, world } = r.state;
    const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion);
    const to = new THREE.Vector3();
    check('...with wave 1 in front of the pilot too',
      world.npcs.every((n) => deg(nose.angleTo(
        to.copy(n.object.position).sub(player.position))) <= IN_VIEW_DEG));
    r.sim.quit();
  }
}

// --- the measurement, stated independently ----------------------------------

console.log('\ncombat simulator — measuring an opening');
{
  const plan = { arc: 'ahead' as const, range: 4500, coneDeg: 8 };
  const from = new THREE.Vector3(0, 0, 0);
  const quat = new THREE.Quaternion();   // nose down -Z
  const o = measureOpening(plan, from, quat, [
    new THREE.Vector3(0, 0, -4000),                 // dead ahead, 4000 out
    new THREE.Vector3(1000, 0, -1000 * Math.sqrt(3)),   // 30 degrees off, 2000 out
  ]);
  eq('the nearest is the nearest', o.nearest, 2000);
  eq('...the furthest the furthest', o.furthest, 4000);
  eq('...and the widest bearing is the worst one, not the average', o.widestBearingDeg, 30);
  check('...which at 30 degrees is not in view', !o.inView);
  eq('an opening with nothing in it measures nothing rather than zero',
    `${measureOpening(plan, from, quat, []).nearest}`, 'null');

  // The axis, which is the whole of the ahead/astern difference.
  const forward = new THREE.Vector3(0, 0, -1);
  eq('an ahead opening points the cone down the nose',
    openingPlacement(plan, forward.clone()).facing!.z, -1);
  eq('...and an astern one straight back along it',
    openingPlacement({ ...plan, arc: 'astern' }, forward.clone()).facing!.z, 1);
  eq('...and the cone reaches the spawner in radians',
    openingPlacement(plan, forward.clone()).cone!.toFixed(4),
    ((8 * Math.PI) / 180).toFixed(4));
}

// --- one home ---------------------------------------------------------------
//
// Career spawning is NOT this file's business and must not learn about it: the
// reception in `spawnPopulation` is scattered down the corridor to the station
// on purpose, and being jumped there is the game working.

{
  const spawning = read('src/game/spawning.ts');
  const population = spawning.slice(0, spawning.indexOf('// --- the training arena'));
  check('spawnPopulation knows nothing about a trainer opening',
    !/opening|OPENING/i.test(population));
  const sim = read('src/game/combat-sim.ts');
  check('the exercise asks combat-sim-opening.ts where the fight starts',
    /from '\.\/combat-sim-opening\.ts'/.test(sim));
  check('...and states no geometry of its own',
    !/range:\s*\d/.test(sim) && !/cone/i.test(sim.replace(/^\s*\/\/.*$/gm, '')));
}
