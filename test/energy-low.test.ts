// One threshold, three consequences — asserted a point at a time.
//
// `energyLow` (game/systems.ts) is the whole of "you are into your last bank".
// Three things read it and a pilot sees all three at once: the shields stop
// recovering, the step flashes ENERGY LOW, and the console's last segment goes
// red. TODO 38 said they were one comparison and shipped three — `>` in
// systems.ts, `<` in world-step.ts and a fraction comparison in hud.ts — which
// left energy 64 exactly a dead band: shields frozen, console quiet, nothing
// telling the pilot why their shields would not come back.
//
// So this file walks the bank one point at a time and asserts the three AGREE,
// through the real code each time: `regenerate` for the shields, a real
// `WorldStep` frame for the warning, a real `buildHudFrame` for the gauge. A
// test that re-implemented any of the three would only be asserting against
// itself, which is how the dead band survived — test/hud-binding.test.ts pinned
// the gauge to the warning, and nothing held the shield cut-off to either.
//
// The second half is the other end of the same defect: `destroyed` used to be
// the absolute `sys.energy <= 0`, so a bank emptied by something that was NOT a
// hit — the E.C.M., the one path there is — made the next absorbed hit a kill.

import * as THREE from 'three';
import { newCommander } from '../src/game/commander.ts';
import { playerPoolPoints } from '../src/game/damage-units.ts';
import { Ordnance } from '../src/game/ordnance.ts';
import { ECM_ENERGY_COST } from '../src/constants/ordnance.ts';
import { restoreRng, rngState, seedWorld } from '../src/game/rng.ts';
import { COBRA_MK_3_HULL_ID } from '../src/game/ship-identity.ts';
import { freshState } from '../src/game/state.ts';
import {
  applyDamage, energyLow, freshSystems, regenerate,
} from '../src/game/systems.ts';
import { LOW_ENERGY, MAX_ENERGY, MAX_SHIELD } from '../src/constants/pools.ts';
import { World } from '../src/game/world.ts';
import { WorldStep, type StepHost } from '../src/game/world-step.ts';
import { buildHudFrame } from '../src/hud/hud-binding.ts';
import { check } from './harness.ts';

console.log('\nthe last energy bank, one point at a time');

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const COBRA = { shipId: COBRA_MK_3_HULL_ID, energyUnit: false };

/** The rng this file borrows to build a world, handed back at the end. */
const borrowed = rngState();
seedWorld(20_260_802);

// --- 1. the shields: does `regenerate` move them at this energy? -------------
//
// The bank is PINNED at the value under test each frame, so what is measured is
// the cut-off and not how long the bank takes to climb out of it.
const shieldsRecharge = (energy: number): boolean => {
  const sys = freshSystems();
  sys.foreShield = 0;
  sys.aftShield = 0;
  for (let i = 0; i < 30; i += 1) {
    sys.energy = energy;
    sys.energyCarry = 0;
    regenerate(sys, 1 / 60, COBRA);
  }
  return sys.foreShield > 0;
};

// --- 2. the warning: does the REAL step say ENERGY LOW? ----------------------
const state = freshState(newCommander());
state.world.build(state.systems[state.commander.systemIndex]);
const ordnance = new Ordnance(state.world);
const deaths: string[] = [];
const host: StepHost = {
  inFlight: () => deaths.length === 0,
  applyPlayerDamage: () => {}, destroyNpc: () => {}, wreckNpc: () => {},
  fireLaser: () => {}, raiseLegal: () => {}, die: (why) => { deaths.push(why); },
  dock: () => {}, completeHyperspace: () => {}, completeRescue: () => {},
  openHermitTrade: () => {}, autoSave: () => {},
};
const step = new WorldStep(state, ordnance, host);
// out at the witchpoint with nothing near: no NPCs, no hazard, no throttle
state.player.position.copy(state.world.station.position).normalize()
  .multiplyScalar(state.world.planetRadius * 16);
state.player.speed = 0;

let bankMoved = false;
const warns = (energy: number): boolean => {
  state.sys.energy = energy;
  state.sys.energyCarry = 0;
  state.session.energyLowTimer = 0;   // the flash is due this frame if it fires
  const events = step.step(1 / 60, 1,
    { demand: { rollRate: 0, pitchRate: 0, throttle: 0, fire: false }, handsOn: false });
  // a probe that let the frame regenerate a whole point would be reading the
  // wrong energy back, so it says so rather than passing quietly
  if (state.sys.energy !== energy) bankMoved = true;
  return events.some((e) => e.kind === 'message' && e.text === 'ENERGY LOW');
};

// --- 3. the gauge: does the REAL frame read low? -----------------------------
const red = (energy: number): boolean => buildHudFrame({
  commander: state.commander, sys: { ...state.sys, energy }, world: state.world,
  camera: new THREE.PerspectiveCamera(), playerPos: V(0, 0, 0),
  playerQuat: new THREE.Quaternion(), playerForward: V(0, 0, -1), viewDir: V(0, 0, -1),
  missiles: [], canisters: [], targetLock: null, inFlight: true, exercise: null,
} as unknown as Parameters<typeof buildHudFrame>[0],
{ a: V(0, 0, 0), b: V(0, 0, 0), c: V(0, 0, 0), q: new THREE.Quaternion() }).energyLow;

{
  const disagree: string[] = [];
  const lowValues: number[] = [];
  for (let energy = 0; energy <= MAX_ENERGY; energy += 1) {
    const frozen = !shieldsRecharge(energy);
    const warning = warns(energy);
    const gauge = red(energy);
    if (frozen !== warning || frozen !== gauge || frozen !== energyLow(energy)) {
      disagree.push(`${energy}: shields ${frozen ? 'frozen' : 'recharging'},`
        + ` warning ${warning}, red ${gauge}, energyLow ${energyLow(energy)}`);
    }
    if (frozen) lowValues.push(energy);
  }
  check('the probe frame never moved the bank it was reading', !bankMoved);
  check('nothing killed the probe commander', deaths.length === 0);
  check('at every one of the 256 values a bank can hold, the shield cut-off, the'
    + ' ENERGY LOW warning and the red gauge agree',
    disagree.length === 0, disagree.slice(0, 4).join(' | '));
  check('...and they turn over at one bank left, inclusive — no dead band',
    lowValues.length === LOW_ENERGY + 1
    && lowValues[lowValues.length - 1] === LOW_ENERGY);
}

// --- the other end: a bank emptied by something that is not a hit ------------

{
  // `destroyed` is a fact about THIS hit. It was the absolute `energy <= 0`,
  // which is the same answer only while a hit is the one way to reach zero.
  const sys = freshSystems();
  sys.energy = 0;
  const absorbed = applyDamage(sys, playerPoolPoints(10), true, () => 1);
  check('with the bank at zero, a hit the shield swallows is not the hit that killed you',
    !absorbed.reachedHull && !absorbed.destroyed);
  const nothing = applyDamage(sys, playerPoolPoints(0), true, () => 1);
  check('...nor is a 0-point hit from a laser that cannot beat the hull armour',
    !nothing.reachedHull && !nothing.destroyed);
  const through = applyDamage(sys, playerPoolPoints(MAX_SHIELD), true, () => 1);
  check('...but a hit that reaches the hull with an empty bank still destroys you',
    through.reachedHull && through.destroyed);
}

{
  // And the path that could zero the bank without a hit is closed at its source:
  // the E.C.M. refuses at `<=` its cost, so it can never spend the last point.
  const commander = newCommander();
  commander.equipment.ecm = true;
  const ecm = new Ordnance(new World());
  let lowestBankAfterFiring = MAX_ENERGY;
  let fires = 0;
  let killedByAnAbsorbedHit = 0;
  for (let energy = 0; energy <= MAX_ENERGY; energy += 1) {
    const sys = freshSystems();
    sys.energy = energy;
    if (ecm.triggerEcm(commander, sys.energy).reply === 'ecmFired') {
      fires += 1;
      sys.energy -= ECM_ENERGY_COST;
      lowestBankAfterFiring = Math.min(lowestBankAfterFiring, sys.energy);
    }
    if (applyDamage(sys, playerPoolPoints(1), true, () => 1).destroyed) {
      killedByAnAbsorbedHit += 1;
    }
  }
  check('from every bank the E.C.M. will fire on, it leaves at least a point',
    fires === MAX_ENERGY - ECM_ENERGY_COST && lowestBankAfterFiring === 1);
  check('...so no commander who fired it dies to a hit their shields absorbed',
    killedByAnAbsorbedHit === 0);
}

restoreRng(borrowed);
